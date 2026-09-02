/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({
    activePersona: {
      description: "自主学习",
      icon: "P",
      id: "self",
      isBuiltin: true,
      name: "学",
      routes: ["/app/today", "/app/settings", "/app/profile", "/app/help"],
    },
    allPersonas: [],
    createCustomPersona: vi.fn(),
    customPersonas: [],
    deleteCustomPersona: vi.fn(),
    isLoading: false,
    isRouteVisible: () => true,
    setActivePersona: vi.fn(),
  }),
}));

import SettingsPage from "./page";

describe("Settings workbench", () => {
  it("uses grouped settings list and keeps secondary persona editing discoverable", () => {
    render(<SettingsPage />);

    expect(screen.getByTestId("settings-workbench")).toBeTruthy();
    expect(screen.getByTestId("settings-master")).toBeTruthy();
    expect(screen.getByTestId("settings-main")).toBeTruthy();
    expect(screen.getByText("界面与交互")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建自定义画像" })).toBeTruthy();
    expect(document.querySelector(".product-panel")).toBeNull();
    expect(document.querySelector(".planning-form")).toBeNull();
  });
});
