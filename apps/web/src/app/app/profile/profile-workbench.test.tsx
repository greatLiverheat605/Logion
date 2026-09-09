/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    refresh: vi.fn(),
    state: {
      sessionExpiresAt: "2026-08-28T12:00:00.000Z",
      status: "authenticated",
      user: { email: "researcher@example.com", id: "user-1" },
    },
  }),
}));

import ProfilePage from "./page";

describe("Profile workbench", () => {
  it("presents account identity, activity and security actions without a placeholder panel", () => {
    render(<ProfilePage />);

    expect(screen.getByTestId("profile-workbench")).toBeTruthy();
    expect(screen.getByText("researcher@example.com")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "账户摘要" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "最近活动" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "最近活动" }));
    expect(screen.getByRole("heading", { name: "最近活动" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "账户摘要" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "账户入口" }));
    expect(screen.getByRole("heading", { name: "账户入口" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "最近活动" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "打开安全中心" }).getAttribute("href"),
    ).toBe("/app/security");
    fireEvent.click(screen.getByRole("button", { name: "账户摘要" }));
    expect(screen.getByRole("heading", { name: "账户摘要" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "打开安全中心" })).toBeNull();
    expect(document.querySelector(".product-panel")).toBeNull();
  });
});
