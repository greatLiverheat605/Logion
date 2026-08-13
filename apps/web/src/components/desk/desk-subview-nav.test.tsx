/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeskSubviewNav, type DeskSubviewLink } from "./desk-subview-nav";

afterEach(cleanup);

const items: readonly DeskSubviewLink[] = [
  { href: "/app/records", icon: "files", label: "来源与记录" },
  { href: "/app/review", icon: "refresh", label: "复习" },
  { href: "/app/spaces", icon: "folder", label: "知识库管理" },
];

describe("DeskSubviewNav", () => {
  it("renders all route links and marks only the active path", () => {
    render(
      <DeskSubviewNav
        activePath="/app/records"
        ariaLabel="知识库视图"
        items={items}
      />,
    );

    expect(screen.getByRole("navigation", { name: "知识库视图" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(
      screen
        .getByRole("link", { name: "来源与记录" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "复习" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("preserves the route hrefs for deep links", () => {
    render(
      <DeskSubviewNav
        activePath="/app/research"
        ariaLabel="工作台视图"
        items={[
          { href: "/app/research", icon: "flask", label: "研究" },
          { href: "/app/self-study", icon: "book-open", label: "自学" },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "研究" }).getAttribute("href"),
    ).toBe("/app/research");
    expect(
      screen.getByRole("link", { name: "自学" }).getAttribute("href"),
    ).toBe("/app/self-study");
  });
});
