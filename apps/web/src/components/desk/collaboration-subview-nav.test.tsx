/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CollaborationSubviewNav } from "./collaboration-subview-nav";

afterEach(cleanup);

describe("CollaborationSubviewNav", () => {
  it("keeps review and workspace governance as separate deep links", () => {
    render(<CollaborationSubviewNav activePath="/app/workspaces" />);

    expect(
      screen.getByRole("navigation", { name: "协作空间视图" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "审阅与反馈" }).getAttribute("href"),
    ).toBe("/app/collaboration");
    expect(
      screen.getByRole("link", { name: "空间与成员" }).getAttribute("href"),
    ).toBe("/app/workspaces");
    expect(
      screen
        .getByRole("link", { name: "空间与成员" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
