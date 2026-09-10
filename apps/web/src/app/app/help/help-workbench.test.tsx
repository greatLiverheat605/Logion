/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    refresh: vi.fn(),
    state: {
      status: "authenticated",
      user: { email: "help@example.com", id: "user-1" },
    },
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => ({ phase: "locked", revision: 0 }),
}));

import HelpPage from "./page";

describe("Help workbench", () => {
  it("starts with help search and exposes diagnostics and recovery paths", () => {
    render(<HelpPage />);

    expect(screen.getByTestId("help-workbench")).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: "搜索帮助" });
    expect(search).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "环境诊断" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "环境诊断" }));
    expect(screen.getByRole("heading", { name: "环境诊断" })).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "恢复路径" }));
    expect(screen.getByRole("heading", { name: "恢复路径" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "环境诊断" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /同步工作台/ }).getAttribute("href"),
    ).toBe("/app/sync");
    fireEvent.click(screen.getByRole("button", { name: "搜索帮助" }));
    fireEvent.change(search, { target: { value: "Vault" } });
    fireEvent.click(screen.getByRole("button", { name: "常见问题" }));
    expect(screen.getByRole("heading", { name: "常见问题" })).toBeTruthy();
    expect(
      screen.getByTestId("help-faq").querySelectorAll("details"),
    ).toHaveLength(1);
    expect(screen.getByTestId("help-faq").textContent).toContain(
      "如何解锁 Vault",
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索帮助" }));
    expect(screen.getByRole("searchbox")).toBe(search);
    expect(search.getAttribute("value")).toBe("Vault");
    expect(document.querySelector(".product-panel")).toBeNull();
  });
});
