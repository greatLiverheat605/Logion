/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserApiClient, LogionApiError } from "@/lib/api/client";
import { LoginForm } from "./login-form";

beforeEach(() => {
  vi.spyOn(browserApiClient, "request").mockRejectedValue(
    new Error("Unexpected request"),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openLogin() {
  render(<LoginForm />);
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "登录",
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

it("shows inline errors, focuses the first invalid field and sends no authentication request", async () => {
  const button = await openLogin();
  fireEvent.click(button);
  const email = screen.getByLabelText<HTMLInputElement>("邮箱");
  expect(document.activeElement).toBe(email);
  expect(email.getAttribute("aria-describedby")).toBe("login-email-error");
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("请输入邮箱。")).toBeTruthy();
  expect(screen.getByText("请输入密码。")).toBeTruthy();
  fireEvent.input(email, { target: { value: "invalid-email" } });
  expect(screen.queryByText("请输入邮箱。")).toBeNull();
  fireEvent.click(button);
  expect(screen.getByText("请输入有效的邮箱地址。")).toBeTruthy();
  expect(browserApiClient.request).not.toHaveBeenCalled();
});

it("retains rejected input, prevents duplicate submissions and permits correction and retry", async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(browserApiClient.request).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const button = await openLogin();
  const email = screen.getByLabelText<HTMLInputElement>("邮箱");
  const password = screen.getByLabelText<HTMLInputElement>("密码", {
    exact: true,
  });
  fireEvent.input(email, { target: { value: "synthetic@example.com" } });
  fireEvent.input(password, { target: { value: "Synthetic-password-42!" } });
  fireEvent.click(button);
  fireEvent.submit(button.closest("form")!);
  expect(browserApiClient.request).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  await act(async () =>
    reject(
      new LogionApiError({
        status: 401,
        code: "AUTH_INVALID_CREDENTIALS",
        requestId: "synthetic-rejection",
        message: "private detail",
      }),
    ),
  );
  expect(screen.getByRole("alert").textContent).not.toContain("private detail");
  expect(email.value).toBe("synthetic@example.com");
  expect(password.value).toBe("Synthetic-password-42!");
  expect(button.disabled).toBe(false);
  vi.mocked(browserApiClient.request).mockResolvedValueOnce({
    status: "mfa_required",
    challenge_token: "synthetic-challenge",
    expires_at: "2030-01-01T00:00:00Z",
    methods: ["totp"],
  });
  fireEvent.click(button);
  expect(await screen.findByLabelText("验证码")).toBeTruthy();
  expect(browserApiClient.request).toHaveBeenCalledTimes(2);
});
