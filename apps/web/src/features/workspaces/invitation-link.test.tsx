/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InvitationLink, invitationLoginHref } from "./invitation-link";
import { AcceptInvitationForm } from "./accept-invitation-form";
import { LogionApiError } from "@/lib/api/client";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual("@/lib/api/client")),
  browserApiClient: { request },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  request.mockReset();
});
const token = "a".repeat(40);
it("copies a full same-origin fragment URL and offers manual recovery on failure", async () => {
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("blocked"));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<InvitationLink token={token} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  await waitFor(() =>
    expect(input.value).toBe(
      `${window.location.origin}/invitations/accept#token=${token}`,
    ),
  );
  fireEvent.click(screen.getByText("复制邀请链接"));
  await screen.findByText("邀请链接已复制，请仅发送给受邀者。");
  expect(writeText).toHaveBeenCalledWith(input.value);
  fireEvent.click(screen.getByText("复制邀请链接"));
  await screen.findByText("复制失败，请手动选择并复制完整邀请链接。");
});
it.each([
  [401, "AUTH_REQUIRED", "请先登录"],
  [403, "WEB_CSRF_MISSING", "请先登录"],
  [404, "INVITATION_INVALID", "邀请无效"],
  [409, "INVITATION_CONFLICT", "已有成员"],
])(
  "handles invitation refusal %s without exposing raw errors",
  async (status, code, text) => {
    window.history.replaceState(null, "", `/invitations/accept#${token}`);
    request.mockRejectedValue(
      new LogionApiError({ status, code, message: "private detail" }),
    );
    render(<AcceptInvitationForm />);
    await waitFor(() =>
      expect(screen.queryByTestId("invite-action")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("接受邀请"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(text),
    );
    expect(document.body.textContent).not.toContain("private detail");
    expect(window.location.hash).toBe("");
    const href = screen.getByText("先登录并完成验证").getAttribute("href")!;
    expect(href).toBe(invitationLoginHref(token));
    expect(new URL(href, window.location.origin).search).not.toContain(token);
  },
);
it("accepts once with the original token and shows the confirmed workspace", async () => {
  window.history.replaceState(null, "", `/invitations/accept#token=${token}`);
  request.mockResolvedValue({ name: "测试工作区", role: "viewer" });
  render(<AcceptInvitationForm />);
  await waitFor(() =>
    expect(screen.queryByTestId("invite-action")).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("接受邀请"));
  await screen.findByText("已加入工作区");
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith(
    "/api/v1/invitations/accept",
    expect.objectContaining({
      method: "POST",
      csrf: true,
      body: JSON.stringify({ token }),
    }),
  );
});
it("rejects malformed fragments before any request", async () => {
  window.history.replaceState(null, "", "/invitations/accept#bad");
  render(<AcceptInvitationForm />);
  await waitFor(() => expect(window.location.hash).toBe(""));
  expect(screen.getByText("缺少或无效的邀请链接")).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
