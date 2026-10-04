import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogionApiError } from "@/lib/api/client";
import { FormDraftController } from "./form-draft";
import { workbenchRequest } from "./api";

vi.mock("./api", () => ({
  workbenchRequest: vi.fn(),
  errorMessage: () => "草稿未保存",
}));
const request = vi.mocked(workbenchRequest);
const remote = { id: "draft-1", version: 1, fields: { body: "server" } };
const controllers: FormDraftController[] = [];
async function open(draft: typeof remote | null = null) {
  request.mockResolvedValueOnce({ draft });
  const controller = new FormDraftController("/synthetic-draft");
  controllers.push(controller);
  controller.change({ body: "" });
  controller.start();
  await Promise.resolve();
  return controller;
}
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
});
afterEach(() => {
  controllers.splice(0).forEach((c) => c.stop());
  vi.useRealTimers();
});

describe("private server form drafts", () => {
  it("explicit submission after reconnect rechecks an uncertain save and submits without another click", async () => {
    const controller = await open();
    request.mockRejectedValueOnce(
      new LogionApiError({
        code: "WEB_NETWORK_UNAVAILABLE",
        message: "offline",
        status: 0,
      }),
    );
    controller.change({ body: "retained" });
    await vi.advanceTimersByTimeAsync(2000);
    request
      .mockResolvedValueOnce({ draft: null })
      .mockResolvedValueOnce({
        draft: { ...remote, fields: { body: "retained" } },
      });
    const action = vi.fn().mockResolvedValue("submitted");
    await expect(controller.submit(action)).resolves.toBe("submitted");
    expect(action).toHaveBeenCalledWith({ "X-Logion-Form-Draft": "draft-1:1" });
  });
  it("manual submission after a failed connection still refuses to overwrite a different remote draft", async () => {
    const controller = await open();
    request.mockRejectedValueOnce(
      new LogionApiError({
        code: "WEB_NETWORK_UNAVAILABLE",
        message: "offline",
        status: 0,
      }),
    );
    controller.change({ body: "retained" });
    await vi.advanceTimersByTimeAsync(2000);
    request.mockResolvedValueOnce({ draft: remote });
    const action = vi.fn();
    await expect(controller.submit(action)).rejects.toThrow("处理草稿提示");
    expect(action).not.toHaveBeenCalled();
    expect(controller.snapshot().status).toBe("offered");
  });
  it("requires an explicit restore and does not overwrite edits made during loading", async () => {
    const controller = await open(remote);
    controller.change({ body: "local typing" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(1);
    const restore = vi.fn();
    controller.restore(restore);
    expect(restore).toHaveBeenCalledWith({ body: "server" });
    controller.change({ body: "server" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("debounces edits, records only confirmed saves and consumes that exact revision", async () => {
    const controller = await open();
    controller.change({ body: "first" });
    await vi.advanceTimersByTimeAsync(1900);
    controller.change({ body: "second" });
    expect(controller.snapshot().status).toBe("pending");
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(controller.snapshot().status).toBe("saving");
    const action = vi.fn().mockResolvedValue("created");
    const submitted = controller.submit(action);
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    resolve({ draft: { ...remote, fields: { body: "second" } } });
    await expect(submitted).resolves.toBe("created");
    expect(action).toHaveBeenCalledWith({ "X-Logion-Form-Draft": "draft-1:1" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().remote).toBeNull();
  });
  it("stops after a conflict and rechecks before explicitly retaining the page text", async () => {
    const controller = await open();
    request.mockRejectedValueOnce(
      new LogionApiError({
        code: "FORM_DRAFT_CONFLICT",
        message: "conflict",
        status: 409,
      }),
    );
    controller.change({ body: "mine" });
    await vi.advanceTimersByTimeAsync(3000);
    controller.change({ body: "still mine" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValueOnce({ draft: remote });
    await controller.retry();
    expect(controller.snapshot().status).toBe("offered");
    request.mockResolvedValueOnce({
      draft: { ...remote, version: 2, fields: { body: "still mine" } },
    });
    controller.keepLocal();
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string)).toEqual({
      expected_id: "draft-1",
      expected_version: 1,
      fields: { body: "still mine" },
    });
  });
  it("keeps a draft on business failure and retries with its revision", async () => {
    const controller = await open(remote);
    controller.restore(() => {});
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("validation"))
      .mockResolvedValueOnce("ok");
    await expect(controller.submit(action)).rejects.toThrow("validation");
    expect(controller.snapshot().remote).toEqual(remote);
    await expect(controller.submit(action)).resolves.toBe("ok");
    expect(action.mock.calls).toEqual([
      [{ "X-Logion-Form-Draft": "draft-1:1" }],
      [{ "X-Logion-Form-Draft": "draft-1:1" }],
    ]);
  });
  it("does not queue failed network writes and cancels autosave on unmount", async () => {
    const controller = await open();
    request.mockRejectedValueOnce(
      new LogionApiError({
        code: "WEB_NETWORK_UNAVAILABLE",
        message: "offline",
        status: 0,
      }),
    );
    controller.change({ body: "keep on screen" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(controller.snapshot().status).toBe("error");
    await vi.advanceTimersByTimeAsync(60000);
    expect(request).toHaveBeenCalledTimes(2);
    const other = await open();
    other.change({ body: "leaving" });
    other.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("discards only the known identity and version without removing the current input", async () => {
    const controller = await open(remote);
    controller.change({ body: "unsaved local" });
    request.mockResolvedValueOnce(undefined);
    await controller.discard();
    expect(request).toHaveBeenLastCalledWith("/synthetic-draft", {
      method: "DELETE",
      query: { expected_id: "draft-1", expected_version: "1" },
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().remote).toBeNull();
  });
});
