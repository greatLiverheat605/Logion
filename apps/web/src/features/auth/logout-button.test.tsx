// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LogoutButton } from "./logout-button";

const mocks = vi.hoisted(() => ({
  clearDrafts: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
}));
const authenticated = {
  status: "authenticated",
  user: { id: "01900000-0000-7000-8000-000000000001" },
};
vi.mock("@/features/offline/form-draft-cleanup", () => ({
  clearFormDraftsForUser: mocks.clearDrafts,
}));
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
  mocks.refresh.mockResolvedValue(authenticated);
  mocks.logout.mockRejectedValue(new Error("network unavailable"));
  render(<LogoutButton />);
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("alert");
  expect(mocks.logout).toHaveBeenCalledTimes(1);
  // Sealed form drafts are removed before the server session ends (ADR-0034).
  expect(mocks.clearDrafts).toHaveBeenCalledWith(authenticated.user.id);
  expect(mocks.clearDrafts.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.logout.mock.invocationCallOrder[0]!,
  );
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("alert");
  expect(mocks.logout).toHaveBeenCalledTimes(2);
});

it("clears this tab's workbench context only after a successful logout", async () => {
  const key = "logion:workbench-context:review";
  window.sessionStorage.setItem(key, JSON.stringify({ view: "reviews" }));
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign },
  });
  try {
    mocks.refresh.mockResolvedValue(authenticated);
    mocks.logout.mockRejectedValueOnce(new Error("network unavailable"));
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await screen.findByRole("alert");
    expect(window.sessionStorage.getItem(key)).not.toBeNull();

    mocks.logout.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login"));
    expect(window.sessionStorage.getItem(key)).toBeNull();
  } finally {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    window.sessionStorage.clear();
  }
});
