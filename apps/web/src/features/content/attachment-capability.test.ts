/** @vitest-environment jsdom */
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ browserApiClient: { request } }));
import {
  checkAttachmentQueuePermission,
  useAttachmentCapability,
} from "./attachment-capability";
beforeEach(() => request.mockReset());
it("fails closed for disabled or unknown online capability and requires explicit offline staging", async () => {
  request
    .mockResolvedValueOnce({ ingest_enabled: false })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ ingest_enabled: true });
  await expect(
    checkAttachmentQueuePermission("workspace", "space", true),
  ).rejects.toThrow("未启用");
  await expect(
    checkAttachmentQueuePermission("workspace", "space", true),
  ).rejects.toThrow("无法确认");
  await expect(
    checkAttachmentQueuePermission("workspace", "space", true),
  ).resolves.toBeUndefined();
  request.mockClear();
  await expect(
    checkAttachmentQueuePermission("workspace", "space", false),
  ).rejects.toThrow("仅在本地暂存");
  await expect(
    checkAttachmentQueuePermission("workspace", "space", false, true),
  ).resolves.toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});
it("ignores old workspace responses and retries a failed capability read", async () => {
  let release!: (value: unknown) => void;
  request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ ingest_enabled: false });
  const hook = renderHook(
    ({ workspace }) => useAttachmentCapability(workspace, "space", true, true),
    { initialProps: { workspace: "one" } },
  );
  hook.rerender({ workspace: "two" });
  await waitFor(() => expect(hook.result.current.state).toBe("error"));
  await act(async () => release({ ingest_enabled: true }));
  expect(hook.result.current.state).toBe("error");
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.state).toBe("disabled"));
  hook.unmount();
});
