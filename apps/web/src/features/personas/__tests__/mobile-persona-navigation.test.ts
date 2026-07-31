import { describe, expect, it } from "vitest";

import { ALL_ROUTES, BUILTIN_PERSONAS } from "../persona-definitions";
import { mobileNavigationForPersona } from "../mobile-persona-navigation";

describe("mobileNavigationForPersona", () => {
  it.each([
    [
      "exam",
      ["今日", "备考", "复习", "错题"],
      ["/app/today", "/app/exam", "/app/review", "/app/records"],
    ],
    [
      "self",
      ["今日", "计划", "自学", "记录"],
      ["/app/today", "/app/planning", "/app/self-study", "/app/records"],
    ],
    [
      "research",
      ["今日", "计划", "自学", "复习"],
      ["/app/today", "/app/planning", "/app/self-study", "/app/review"],
    ],
    [
      "mentor",
      ["今日", "计划", "空间", "审计"],
      ["/app/today", "/app/planning", "/app/spaces", "/app/audit"],
    ],
  ] as const)("uses the fixed %s 4-slot mapping", (id, labels, routes) => {
    const persona = BUILTIN_PERSONAS.find((item) => item.id === id);
    expect(persona).toBeDefined();
    const navigation = mobileNavigationForPersona(persona!);

    expect(navigation.primary.map((item) => item.label)).toEqual(labels);
    expect(navigation.primary.map((item) => item.href)).toEqual(routes);
    expect(navigation.overflow.map((item) => item.href)).toEqual(
      persona!.routes.filter((route) => !routes.includes(route as never)),
    );
    expect(
      [...navigation.primary, ...navigation.overflow].every((item) =>
        ALL_ROUTES.includes(item.href),
      ),
    ).toBe(true);
  });

  it("uses the first four custom routes and sends the remainder to more", () => {
    const routes = [
      "/app/today",
      "/app/exam",
      "/app/templates",
      "/app/settings",
      "/app/profile",
      "/app/help",
    ];
    const navigation = mobileNavigationForPersona({
      id: "custom-123e4567-e89b-42d3-a456-426614174000",
      name: "自定义",
      icon: "🎯",
      description: "自定义移动入口",
      isBuiltin: false,
      routes,
    });

    expect(navigation.primary.map((item) => item.href)).toEqual(
      routes.slice(0, 4),
    );
    expect(navigation.overflow.map((item) => item.href)).toEqual(
      routes.slice(4),
    );
    expect([...navigation.primary, ...navigation.overflow]).not.toContainEqual(
      expect.objectContaining({ href: "/app/research" }),
    );
  });
});
