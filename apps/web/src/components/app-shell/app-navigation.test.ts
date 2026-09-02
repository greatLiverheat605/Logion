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
  it("keeps the sidebar on the frozen twelve-route persona contract", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(ALL_ROUTES);
  });

  it("groups command results and exposes integrations as a secondary route", () => {
    expect(COMMAND_GROUPS).toEqual(["学习", "研究", "系统", "创建"]);
    expect(COMMAND_ITEMS.some((item) => item.id === "integrations")).toBe(true);

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
    expect(commandItemMatches(sync, "冲突")).toBe(true);
    expect(commandItemMatches(sync, "设备")).toBe(true);
    expect(commandItemMatches(sync, "论文")).toBe(false);
  });
});
