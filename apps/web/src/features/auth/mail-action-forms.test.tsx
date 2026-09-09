// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { PasswordRecoveryForm } from "./password-recovery-form";
import { VerifyEmailForm } from "./verify-email-form";

const token = "synthetic-mail-fragment-".repeat(3);
const password = "Synthetic-password-42!";
const flows = [
  {
    name: "verification",
    path: "/auth/verify",
    Form: VerifyEmailForm,
    command: "确认邮箱并设置密码",
    endpoint: "/api/v1/auth/email-verification/confirmations",
    body: { token, password },
    success: "邮箱已确认，密码已设置。",
  },
  {
    name: "recovery",
    path: "/auth/recover",
    Form: PasswordRecoveryForm,
    command: "更新密码并退出所有设备",
    endpoint: "/api/v1/auth/password-recovery/completions",
    body: { token, new_password: password },
    success: "密码已更新，请重新登录。",
  },
] as const;

beforeEach(() => {
  vi.spyOn(browserApiClient, "request").mockRejectedValue(
    new Error("Unexpected API request"),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function openForm(flow: (typeof flows)[number]) {
  window.history.replaceState(null, "", `${flow.path}#${token}`);
  render(
    <StrictMode>
      <flow.Form />
    </StrictMode>,
  );
  expect(window.location.hash).toBe("");
  fireEvent.change(await screen.findByLabelText("新密码"), {
    target: { value: password },
  });
  if (flow.name === "verification") {
    fireEvent.change(screen.getByLabelText("再次输入密码"), {
      target: { value: password },
    });
  }
  return screen.getByRole<HTMLButtonElement>("button", { name: flow.command });
}

describe.each(flows)("mail action $name", (flow) => {
  it("submits the Worker fragment once and waits for confirmed success", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(browserApiClient.request).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const button = await openForm(flow);
    expect(browserApiClient.request).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(browserApiClient.request).toHaveBeenCalledExactlyOnceWith(
      flow.endpoint,
      { method: "POST", body: JSON.stringify(flow.body) },
    );
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(button);
    expect(browserApiClient.request).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ status: "ok" }));
    expect(screen.getByRole("status").textContent).toContain(flow.success);
    expect(screen.queryByLabelText("新密码")).toBeNull();
    expect(window.location.pathname).toBe(flow.path);
    expect(
      screen.getByRole("link", { name: "返回登录" }).getAttribute("href"),
    ).toBe("/auth/login");
  });

  it("keeps rejected input editable and focuses the request ID without reporting success", async () => {
    vi.mocked(browserApiClient.request).mockRejectedValueOnce(
      new LogionApiError({
        code: "AUTH_TOKEN_INVALID",
        status: 400,
        requestId: "request-mail-expired-or-replayed",
        message: "Private server detail must not be rendered",
      }),
    );
    const button = await openForm(flow);
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("request-mail-expired-or-replayed");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(document.body.textContent).not.toContain("Private server detail");
    expect(screen.queryByRole("status")).toBeNull();
    expect(button.disabled).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("新密码").value).toBe(
      password,
    );
    expect(window.location.hash).toBe("");
    expect(browserApiClient.request).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed success response", async () => {
    vi.mocked(browserApiClient.request).mockResolvedValueOnce({});
    fireEvent.click(await openForm(flow));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "unavailable",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("新密码")).toBeTruthy();
  });
});

it("blocks mismatched verification passwords before requesting the API", async () => {
  const button = await openForm(flows[0]);
  fireEvent.change(screen.getByLabelText("再次输入密码"), {
    target: { value: `${password}-different` },
  });
  fireEvent.click(button);
  expect(screen.getByRole("alert").textContent).toContain(
    "两次输入的密码不一致",
  );
  expect(
    screen.getByLabelText("再次输入密码").getAttribute("aria-invalid"),
  ).toBe("true");
  expect(browserApiClient.request).not.toHaveBeenCalled();
});

it.each([
  { method: "totp", label: "动态码", code: "123456" },
  { method: "recovery_code", label: "恢复码", code: "synthetic-recovery-code" },
])(
  "requires and submits the selected $method factor",
  async ({ method, label, code }) => {
    vi.mocked(browserApiClient.request).mockResolvedValue({ status: "ok" });
    const button = await openForm(flows[1]);
    fireEvent.click(screen.getByRole("radio", { name: label }));
    fireEvent.click(button);
    expect(browserApiClient.request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("第二因素验证码"), {
      target: { value: code },
    });
    fireEvent.click(button);
    expect((await screen.findByRole("status")).textContent).toContain(
      flows[1].success,
    );
    expect(browserApiClient.request).toHaveBeenCalledExactlyOnceWith(
      flows[1].endpoint,
      {
        method: "POST",
        body: JSON.stringify({ ...flows[1].body, method, code }),
      },
    );
  },
);
