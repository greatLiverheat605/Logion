import { describe, expect, it } from "vitest";

import {
  ALL_ROUTES,
  BUILTIN_PERSONAS,
} from "@/features/personas/persona-definitions";
import { SECONDARY_PRODUCT_ROUTES } from "@/features/productization/prototype-view-manifest";

import {
  COMMAND_GROUPS,
  COMMAND_ITEMS,
  commandItemMatches,
  isCommandItemVisible,
  navGroupsForPersona,
  NAV_ITEMS,
} from "./app-navigation";

function builtinPersona(id: string) {
  const persona = BUILTIN_PERSONAS.find((item) => item.id === id);
  expect(persona).toBeDefined();
  return persona!;
}

function visibleCommands(id: string) {
  const persona = builtinPersona(id);
  const routes = new Set(persona.routes);
  return COMMAND_ITEMS.filter((item) =>
    isCommandItemVisible(item, persona, (route) => routes.has(route)),
  );
}

describe("application navigation manifest", () => {
  it("sidebar has exactly 5 top-level area entries (not 12 routes)", () => {
    expect(NAV_ITEMS).toHaveLength(5);
    expect(NAV_ITEMS.map((item) => item.area)).toEqual([
      "today",
      "workbench",
      "knowledge",
      "collaboration",
      "system",
    ]);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
  });

  it("command palette covers all 21 formal routes plus operational actions", () => {
    const routeItems = COMMAND_ITEMS.filter((item) => item.kind === "route");
    const actionItems = COMMAND_ITEMS.filter((item) => item.kind === "action");
    // 21 manifest routes + 2 operational actions (capture, focus).
    expect(routeItems.length).toBe(21);
    expect(actionItems.length).toBe(2);
    expect(COMMAND_ITEMS.length).toBe(23);
  });

  it("command groups are the 5 areas plus 创建", () => {
    expect(COMMAND_GROUPS).toEqual([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
      "创建",
    ]);
  });

  it("exposes integrations as a route item", () => {
    expect(COMMAND_ITEMS.some((item) => item.id === "integrations")).toBe(true);
  });

  it("command routes outside ALL_ROUTES are all in SECONDARY_PRODUCT_ROUTES", () => {
    const secondaryHrefs = COMMAND_ITEMS.flatMap((item) =>
      item.kind === "route" && !ALL_ROUTES.includes(item.href as never)
        ? [item.href]
        : [],
    );
    expect(
      secondaryHrefs.every((href) =>
        SECONDARY_PRODUCT_ROUTES.includes(href as never),
      ),
    ).toBe(true);
  });

  it("shows secondary workbenches only through an eligible persona gate", () => {
    const examIds = visibleCommands("exam").map((item) => item.id);
    expect(examIds).not.toContain("research");
    expect(examIds).not.toContain("collaboration");
    expect(examIds).not.toContain("ai");
    expect(examIds).not.toContain("integrations");
    expect(examIds).toContain("sync");
    expect(examIds).toContain("security");

    const researchIds = visibleCommands("research").map((item) => item.id);
    expect(researchIds).toContain("research");
    expect(researchIds).toContain("collaboration");
    expect(researchIds).toContain("ai");
    expect(researchIds).toContain("integrations");

    expect(visibleCommands("self").map((item) => item.id)).toContain(
      "integrations",
    );
    expect(visibleCommands("mentor").map((item) => item.id)).toContain(
      "integrations",
    );
  });

  it("searches labels, descriptions and keywords", () => {
    const sync = COMMAND_ITEMS.find((item) => item.id === "sync")!;
    expect(sync).toBeDefined();
    expect(commandItemMatches(sync, "冲突")).toBe(true);
    expect(commandItemMatches(sync, "设备")).toBe(true);
    expect(commandItemMatches(sync, "论文")).toBe(false);
  });

  it("the exam persona can see the exam command but not research", () => {
    const examCommands = visibleCommands("exam");
    const examRoute = examCommands.find((item) => item.id === "exam");
    expect(examRoute).toBeDefined();
    expect(examCommands.find((item) => item.id === "research")).toBeUndefined();
  });

  it("/app/search is reachable via command palette for eligible personas", () => {
    const selfCommands = visibleCommands("self");
    expect(selfCommands.find((item) => item.id === "search")).toBeDefined();
  });
});

describe("navGroupsForPersona: persona-aware sidebar defaults", () => {
  function flatAreas(
    groups: ReadonlyArray<{ items: ReadonlyArray<{ area: string }> }>,
  ) {
    return groups.flatMap((g) => g.items.map((item) => item.area));
  }

  it.each(["exam", "self", "research", "mentor"] as const)(
    "always shows exactly 5 areas in the frozen order for %s persona",
    (id) => {
      const persona = builtinPersona(id);
      const groups = navGroupsForPersona(persona);
      expect(flatAreas(groups)).toEqual([
        "today",
        "workbench",
        "knowledge",
        "collaboration",
        "system",
      ]);
    },
  );

  it("shows 5 areas for null persona (no crash)", () => {
    const groups = navGroupsForPersona(null);
    expect(flatAreas(groups)).toHaveLength(5);
    expect(
      groups
        .flatMap((group) => [...group.items])
        .find((item) => item.area === "workbench")?.href,
    ).toBe("/app/today");
  });

  it("exam persona workbench href is /app/exam", () => {
    const groups = navGroupsForPersona(builtinPersona("exam"));
    const workbench = groups
      .flatMap((g) => [...g.items])
      .find((item) => item.area === "workbench");
    expect(workbench?.href).toBe("/app/exam");
  });

  it("fixed personas keep their Workbench-specific entries", () => {
    const expected = {
      self: "/app/self-study",
      research: "/app/research",
      exam: "/app/exam",
      mentor: "/app/collaboration",
    } as const;
    for (const id of Object.keys(expected) as Array<keyof typeof expected>) {
      const groups = navGroupsForPersona(builtinPersona(id));
      const workbench = groups
        .flatMap((g) => [...g.items])
        .find((item) => item.area === "workbench");
      expect(workbench?.href).toBe(expected[id]);
    }
  });

  it("knowledge href uses persona-visible default", () => {
    const examGroups = navGroupsForPersona(builtinPersona("exam"));
    const examKnowledge = examGroups
      .flatMap((g) => [...g.items])
      .find((item) => item.area === "knowledge");
    // exam persona has records + review but not spaces → defaults to records.
    expect(examKnowledge?.href).toBe("/app/records");
  });

  it("today/collaboration/system hrefs are stable across personas", () => {
    for (const id of ["exam", "self", "research", "mentor"] as const) {
      const groups = navGroupsForPersona(builtinPersona(id));
      const items = Object.fromEntries(
        groups.flatMap((g) => [...g.items]).map((item) => [item.area, item]),
      );
      expect(items.today?.href).toBe("/app/today");
      expect(items.collaboration?.href).toBe("/app/workspaces");
      expect(items.system?.href).toBe("/app/settings");
    }
  });

  it("labels and icons are stable (persona only affects href)", () => {
    const examGroups = navGroupsForPersona(builtinPersona("exam"));
    const selfGroups = navGroupsForPersona(builtinPersona("self"));
    const examLabels = examGroups
      .flatMap((g) => [...g.items])
      .map((item) => `${item.label}:${item.icon}`);
    const selfLabels = selfGroups
      .flatMap((g) => [...g.items])
      .map((item) => `${item.label}:${item.icon}`);
    expect(examLabels).toEqual(selfLabels);
    expect(examLabels).toEqual([
      "今天:home",
      "工作台:book-open",
      "知识库:files",
      "协作空间:users",
      "系统中心:shield",
    ]);
  });
});
