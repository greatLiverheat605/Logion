/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SYSTEM_CENTER_NAV_GROUPS,
  SystemCenterFrame,
} from "./system-center-frame";

afterEach(cleanup);

describe("SystemCenterFrame", () => {
  it("renders grouped settings links and marks the deep-linked detail", () => {
    render(
      <SystemCenterFrame activePath="/app/security">
        <main id="main-content">安全详情</main>
      </SystemCenterFrame>,
    );

    expect(
      screen.getByRole("navigation", { name: "系统中心设置" }),
    ).toBeTruthy();
    expect(SYSTEM_CENTER_NAV_GROUPS).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: /安全/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("安全详情")).toBeTruthy();
  });

  it("keeps all eight system routes discoverable", () => {
    render(
      <SystemCenterFrame activePath="/app/profile">
        <main id="main-content">账户详情</main>
      </SystemCenterFrame>,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(9);
    for (const href of [
      "/app/profile",
      "/app/settings",
      "/app/help",
      "/app/security",
      "/app/sync",
      "/app/data",
      "/app/audit",
      "/app/integrations",
      "/app/ai",
    ]) {
      expect(links.some((link) => link.getAttribute("href") === href)).toBe(
        true,
      );
    }
  });
});
