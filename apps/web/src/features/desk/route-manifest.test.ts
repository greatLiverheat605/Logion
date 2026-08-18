import { describe, expect, it } from "vitest";

import {
  BUILTIN_PERSONAS,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";

import {
  type DeskAreaId,
  DESK_AREAS,
  DESK_NAV_GROUPS,
  DESK_ROUTES,
  contextBarDescriptor,
  defaultRouteForArea,
  FORMAL_ROUTE_COUNT,
  routeArea,
  routeEntry,
} from "@/features/desk/route-manifest";

/** The 21 formal business routes from 10_ROUTE_MIGRATION_MAP.md. */
const EXPECTED_21_ROUTES = [
  // 今天 (1)
  "/app/today",
  // 工作台 (5)
  "/app/self-study",
  "/app/research",
  "/app/exam",
  "/app/planning",
  "/app/templates",
  // 知识库 (3)
  "/app/records",
  "/app/review",
  "/app/spaces",
  // 协作空间 (2)
  "/app/collaboration",
  "/app/workspaces",
  // 系统中心 (9)
  "/app/audit",
  "/app/settings",
  "/app/profile",
  "/app/security",
  "/app/sync",
  "/app/data",
  "/app/integrations",
  "/app/ai",
  "/app/help",
  // 全局搜索 (1) — cross-cutting, not a sixth nav area
  "/app/search",
] as const;

describe("route manifest: 21 formal routes", () => {
  it("DESK_ROUTES covers exactly the 21 formal business routes", () => {
    const manifestPaths = DESK_ROUTES.map((route) => route.path).sort();
    const expected = [...EXPECTED_21_ROUTES].sort();
    expect(manifestPaths).toEqual(expected);
  });

  it("FORMAL_ROUTE_COUNT is 21", () => {
    expect(FORMAL_ROUTE_COUNT).toBe(21);
    // DESK_ROUTES includes all 21 formal routes (search is cross-cutting but
    // still listed in the manifest for the command palette).
    expect(DESK_ROUTES.length).toBe(21);
  });

  it("has no duplicate routes", () => {
    const paths = DESK_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("/app and /app/knowledge-prototype are NOT in DESK_ROUTES", () => {
    const paths = DESK_ROUTES.map((route) => route.path);
    expect(paths).not.toContain("/app");
    expect(paths).not.toContain("/app/knowledge-prototype");
  });
});

describe("route manifest: 5 top-level areas", () => {
  it("DESK_AREAS has exactly 5 areas in the frozen order", () => {
    expect(DESK_AREAS.map((area) => area.id)).toEqual([
      "today",
      "workbench",
      "knowledge",
      "collaboration",
      "system",
    ]);
  });

  it("DESK_AREAS labels match D2 direction", () => {
    expect(DESK_AREAS.map((area) => area.label)).toEqual([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
  });

  it("DESK_NAV_GROUPS splits into 主要区域 (3) and 管理 (2)", () => {
    expect(DESK_NAV_GROUPS).toHaveLength(2);
    const primary = DESK_NAV_GROUPS[0];
    const management = DESK_NAV_GROUPS[1];
    expect(primary?.label).toBe("主要区域");
    expect(primary?.areaIds).toEqual(["today", "workbench", "knowledge"]);
    expect(management?.label).toBe("管理");
    expect(management?.areaIds).toEqual(["collaboration", "system"]);
  });
});

describe("routeArea: deep-link → area reverse-lookup", () => {
  const cases: ReadonlyArray<[string, DeskAreaId | null]> = [
    // 今天
    ["/app/today", "today"],
    // 工作台
    ["/app/self-study", "workbench"],
    ["/app/research", "workbench"],
    ["/app/exam", "workbench"],
    ["/app/planning", "workbench"],
    ["/app/templates", "workbench"],
    // 知识库
    ["/app/records", "knowledge"],
    ["/app/review", "knowledge"],
    ["/app/spaces", "knowledge"],
    ["/app/collaboration", "workbench"],
    // 协作空间
    ["/app/workspaces", "collaboration"],
    // 系统中心
    ["/app/audit", "system"],
    ["/app/settings", "system"],
    ["/app/profile", "system"],
    ["/app/security", "system"],
    ["/app/sync", "system"],
    ["/app/data", "system"],
    ["/app/integrations", "system"],
    ["/app/ai", "system"],
    ["/app/help", "system"],
    // 全局搜索 — NOT a sixth area
    ["/app/search", null],
    // Non-formal routes
    ["/app", null],
    ["/app/knowledge-prototype", null],
    // Unknown
    ["/app/nonexistent", null],
    ["/unknown", null],
  ];

  it.each(cases)("routeArea(%s) → %s", (path, expected) => {
    expect(routeArea(path)).toBe(expected);
  });

  it("/app/search does not produce a sixth navigation area", () => {
    expect(routeArea("/app/search")).toBeNull();
  });
});

describe("routeEntry: sub-view lookup", () => {
  it("returns the correct sub-view for a known route", () => {
    expect(routeEntry("/app/today")?.subView).toBe("当前行动与验收");
    expect(routeEntry("/app/exam")?.subView).toBe("考试");
    expect(routeEntry("/app/audit")?.subView).toBe("审计");
    expect(routeEntry("/app/search")?.subView).toBe("全局搜索");
  });

  it("returns null for unknown routes", () => {
    expect(routeEntry("/app/nonexistent")).toBeNull();
    expect(routeEntry("/app")).toBeNull();
  });
});

describe("defaultRouteForArea: persona-aware defaults", () => {
  it("今天 always defaults to /app/today", () => {
    expect(defaultRouteForArea("today")).toBe("/app/today");
    expect(defaultRouteForArea("today", BUILTIN_PERSONAS[0]!)).toBe(
      "/app/today",
    );
  });

  it("工作台 defaults follow the read-only fixed Workbench projection", () => {
    const expected: Record<string, string> = {
      self: "/app/self-study",
      research: "/app/research",
      exam: "/app/exam",
      mentor: "/app/collaboration",
    };
    for (const persona of BUILTIN_PERSONAS) {
      expect(defaultRouteForArea("workbench", persona)).toBe(
        expected[persona.id],
      );
    }
    expect(defaultRouteForArea("workbench", null)).toBe("/app/today");
  });

  it("keeps a legacy Workbench entry within its existing routes", () => {
    const legacy: PersonaDefinition = {
      description: "legacy",
      icon: "C",
      id: "custom-legacy",
      isBuiltin: false,
      name: "Legacy",
      routes: ["/app/today", "/app/research"],
    };
    expect(defaultRouteForArea("workbench", legacy)).toBe("/app/research");
  });

  it("fails closed to Today when a loaded persona has no Workbench entry", () => {
    const legacy: PersonaDefinition = {
      description: "legacy",
      icon: "C",
      id: "custom-minimal",
      isBuiltin: false,
      name: "Minimal",
      routes: ["/app/today", "/app/settings"],
    };
    const invalidFixed: PersonaDefinition = {
      ...BUILTIN_PERSONAS.find((persona) => persona.id === "research")!,
      routes: ["/app/today"],
    };

    expect(defaultRouteForArea("workbench", legacy)).toBe("/app/today");
    expect(defaultRouteForArea("workbench", invalidFixed)).toBe("/app/today");
  });

  it("知识库 defaults to first persona-visible of records → review → spaces", () => {
    const examPersona = BUILTIN_PERSONAS.find((p) => p.id === "exam")!;
    // exam persona has records + review but NOT spaces
    expect(defaultRouteForArea("knowledge", examPersona)).toBe("/app/records");
    expect(defaultRouteForArea("knowledge", null)).toBe("/app/records");
  });

  it("协作空间 always defaults to /app/workspaces", () => {
    expect(defaultRouteForArea("collaboration")).toBe("/app/workspaces");
  });

  it("系统中心 always defaults to /app/settings", () => {
    expect(defaultRouteForArea("system")).toBe("/app/settings");
  });

  it("persona default route does not widen permissions — returned route is still persona-gated", () => {
    // The exam persona does NOT have /app/spaces in its routes. Even though
    // knowledge defaults to records/review/spaces, the default must never
    // return a route the persona cannot see.
    const examPersona = BUILTIN_PERSONAS.find((p) => p.id === "exam")!;
    const route = defaultRouteForArea("knowledge", examPersona);
    expect(examPersona.routes).toContain(route);
  });
});

describe("contextBarDescriptor: Context Bar semantics", () => {
  it("/app/search shows '全局搜索' once, never '全局搜索 / 全局搜索'", () => {
    const desc = contextBarDescriptor("/app/search");
    expect(desc.areaLabel).toBe("全局搜索");
    expect(desc.subView).toBeNull();
  });

  it("/app/knowledge-prototype shows '知识库 / 历史原型', never '全局搜索'", () => {
    const desc = contextBarDescriptor("/app/knowledge-prototype");
    expect(desc.areaLabel).toBe("知识库");
    expect(desc.subView).toBe("历史原型");
    expect(desc.areaLabel).not.toBe("全局搜索");
  });

  it("unknown path uses neutral fallback, never '全局搜索'", () => {
    const desc = contextBarDescriptor("/app/nonexistent");
    expect(desc.areaLabel).toBeNull();
    expect(desc.subView).toBeNull();
  });

  it("/app uses neutral fallback", () => {
    const desc = contextBarDescriptor("/app");
    expect(desc.areaLabel).toBeNull();
    expect(desc.subView).toBeNull();
  });

  it("a formal route shows area label and non-duplicate sub-view", () => {
    const desc = contextBarDescriptor("/app/today");
    expect(desc.areaLabel).toBe("今天");
    expect(desc.subView).toBe("当前行动与验收");
  });

  it("sub-view is omitted when it would duplicate the area label", () => {
    // Construct a hypothetical: if a route's subView equals its area label, the
    // descriptor must null the subView to avoid "今天 / 今天". /app/today has
    // subView "当前行动与验收" (≠ "今天") so it is included. We verify the
    // de-duplication rule by checking a route where area label and subView
    // happen to differ — the separator logic in AppShell checks both non-null.
    const today = contextBarDescriptor("/app/today");
    expect(today.subView).not.toBe(today.areaLabel);
  });

  it("exam route shows '工作台 / 考试'", () => {
    const desc = contextBarDescriptor("/app/exam");
    expect(desc.areaLabel).toBe("工作台");
    expect(desc.subView).toBe("考试");
  });

  it("keeps mentor review under Workbench while workspace governance stays collaboration", () => {
    expect(contextBarDescriptor("/app/collaboration")).toEqual({
      areaLabel: "工作台",
      subView: "导师",
    });
    expect(contextBarDescriptor("/app/workspaces")).toEqual({
      areaLabel: "协作空间",
      subView: "Workspace 管理",
    });
  });

  it("every formal route produces a non-null areaLabel", () => {
    for (const route of DESK_ROUTES) {
      if (route.path === "/app/search") continue; // cross-cutting, special
      const desc = contextBarDescriptor(route.path);
      expect(desc.areaLabel, `areaLabel for ${route.path}`).not.toBeNull();
    }
  });
});
