/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("最近活动")).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开安全中心" }).getAttribute("href")).toBe(
      "/app/security",
    );
    expect(document.querySelector(".product-panel")).toBeNull();
  });
});
