/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const preference = vi.hoisted(() => ({
  id: "self",
  isBuiltin: true,
  visible: true,
}));

vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({
    activePersona: {
      description: "自主学习",
      icon: "P",
      id: preference.id,
      isBuiltin: preference.isBuiltin,
      name: "学",
      routes: ["/app/today", "/app/settings", "/app/profile", "/app/help"],
    },
    allPersonas: [],
    createCustomPersona: vi.fn(),
    customPersonas: [],
    deleteCustomPersona: vi.fn(),
    isLoading: false,
    isRouteVisible: () => preference.visible,
    setActivePersona: vi.fn(),
  }),
}));

import SettingsPage from "./page";

describe("Settings workbench", () => {
  afterEach(() => {
    cleanup();
    Object.assign(preference, { id: "self", isBuiltin: true, visible: true });
  });

  it("uses grouped settings list and keeps secondary persona editing discoverable", () => {
    render(<SettingsPage />);

    expect(screen.getByTestId("settings-workbench")).toBeTruthy();
    expect(screen.getByTestId("settings-master")).toBeTruthy();
    expect(screen.getByTestId("settings-main")).toBeTruthy();
    expect(screen.getByText("界面与交互")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建自定义画像" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "AI / Provider" }).getAttribute("href"),
    ).toBe("/app/ai#ai-provider-center");
    expect(document.querySelector(".product-panel")).toBeNull();
    expect(document.querySelector(".planning-form")).toBeNull();
  });

  it.each([
    ["mentor", true, true, true],
    ["exam", true, true, false],
    ["custom", false, true, true],
    ["self", true, false, false],
  ])(
    "keeps the AI entry consistent with command visibility (%s)",
    (id, isBuiltin, visible, expected) => {
      Object.assign(preference, { id, isBuiltin, visible });
      render(<SettingsPage />);
      expect(
        Boolean(screen.queryByRole("link", { name: "AI / Provider" })),
      ).toBe(expected);
    },
  );
});
