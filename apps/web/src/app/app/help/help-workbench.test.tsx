/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    refresh: vi.fn(),
    state: { status: "authenticated", user: { email: "help@example.com", id: "user-1" } },
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
    expect(screen.getByText("环境诊断")).toBeTruthy();
    expect(screen.getByText("恢复路径")).toBeTruthy();
    expect(screen.getByText("常见问题")).toBeTruthy();
    fireEvent.change(search, { target: { value: "Vault" } });
    expect(screen.getByText(/Vault/)).toBeTruthy();
    expect(document.querySelector(".product-panel")).toBeNull();
  });
});
