// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LogoutButton } from "./logout-button";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), logout: vi.fn() }));
vi.mock("./session", () => ({
  createAuthApi: vi.fn(),
  createWebLockRefreshCoordinator: vi.fn(),
  createSessionCoordinator: () => ({ refresh: mocks.refresh }),
}));
vi.mock("./public-auth-api", () => ({
  createPublicAuthApi: () => ({ logout: mocks.logout }),
}));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("does not claim logout when session verification fails", async () => {
  mocks.refresh.mockResolvedValue({ status: "error" });
  render(<LogoutButton />);
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "退出未完成，请检查网络后重试。",
  );
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "退出登录" }).hasAttribute("disabled"),
  ).toBe(false);
});

it("reports a failed logout and waits for an explicit retry", async () => {
  mocks.refresh.mockResolvedValue({ status: "authenticated" });
  mocks.logout.mockRejectedValue(new Error("network unavailable"));
  render(<LogoutButton />);
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("alert");
  expect(mocks.logout).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("alert");
  expect(mocks.logout).toHaveBeenCalledTimes(2);
});
