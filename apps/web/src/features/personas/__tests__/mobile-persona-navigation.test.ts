import { describe, expect, it } from "vitest";

import { BUILTIN_PERSONAS } from "../persona-definitions";
import {
  DESK_MOBILE_AREAS,
  mobileDeskNavigation,
} from "../mobile-persona-navigation";

describe("mobileDeskNavigation", () => {
  it("always returns exactly 5 stable area entries regardless of persona", () => {
    for (const persona of BUILTIN_PERSONAS) {
      const nav = mobileDeskNavigation(persona);
      expect(nav).toHaveLength(5);
    }
    // Also stable for null persona and custom personas.
    expect(mobileDeskNavigation(null)).toHaveLength(5);
    expect(
      mobileDeskNavigation({
        description: "x",
        icon: "🎯",
        id: "custom-x",
        isBuiltin: false,
        name: "自定义",
        routes: ["/app/today", "/app/settings"],
      }),
    ).toHaveLength(5);
  });

  it("the 5 area labels and order are frozen", () => {
    const nav = mobileDeskNavigation(null);
    expect(nav.map((item) => item.label)).toEqual([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
    expect(nav.find((item) => item.area === "workbench")?.href).toBe(
      "/app/today",
    );
  });

  it("the 5 area IDs and icons are stable", () => {
    const nav = mobileDeskNavigation(null);
    expect(nav.map((item) => item.area)).toEqual([
      "today",
      "workbench",
      "knowledge",
      "collaboration",
      "system",
    ]);
    // Icons match DESK_MOBILE_AREAS.
    expect(nav.map((item) => item.icon)).toEqual(
      DESK_MOBILE_AREAS.map((entry) => entry.icon),
    );
  });

  it("today, collaboration and system entries have stable routes across personas", () => {
    for (const persona of BUILTIN_PERSONAS) {
      const nav = mobileDeskNavigation(persona);
      const byArea = Object.fromEntries(nav.map((item) => [item.area, item]));
      expect(byArea.today?.href).toBe("/app/today");
      expect(byArea.collaboration?.href).toBe("/app/workspaces");
      expect(byArea.system?.href).toBe("/app/settings");
    }
  });

  it("fixed personas keep their Workbench-specific entries", () => {
    const expected = {
      self: "/app/self-study",
      research: "/app/research",
      exam: "/app/exam",
      mentor: "/app/collaboration",
    } as const;
    for (const persona of BUILTIN_PERSONAS) {
      const nav = mobileDeskNavigation(persona);
      const workbench = nav.find((item) => item.area === "workbench");
      expect(workbench?.href).toBe(
        expected[persona.id as keyof typeof expected],
      );
    }
  });

  it("persona only affects default route, not authorization — entries are always 5", () => {
    // Even a persona with very few routes still sees all 5 mobile entries;
    // the default route is chosen from the persona's visible routes, but the
    // entry count and labels never change.
    const minimalPersona = {
      description: "minimal",
      icon: "🎯",
      id: "custom-min" as const,
      isBuiltin: false,
      name: "最小",
      routes: ["/app/today"],
    };
    const nav = mobileDeskNavigation(minimalPersona);
    expect(nav).toHaveLength(5);
    // Workbench fails closed to Today instead of inventing a visible route.
    expect(nav.find((item) => item.area === "today")?.href).toBe("/app/today");
    expect(nav.find((item) => item.area === "workbench")?.href).toBe(
      "/app/today",
    );
  });
});
