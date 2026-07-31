import { describe, expect, it } from "vitest";

import {
  ALL_ROUTES,
  BUILTIN_PERSONAS,
  REQUIRED_PERSONA_ROUTES,
} from "../persona-definitions";

const FROZEN_PERSONA_ROUTES = [
  "/app/today",
  "/app/self-study",
  "/app/records",
  "/app/review",
  "/app/exam",
  "/app/planning",
  "/app/templates",
  "/app/audit",
  "/app/spaces",
  "/app/settings",
  "/app/profile",
  "/app/help",
] as const;

const FROZEN_BUILTIN_MAPPING = {
  exam: [
    "/app/today",
    "/app/exam",
    "/app/review",
    "/app/records",
    "/app/settings",
    "/app/profile",
    "/app/help",
  ],
  self: [
    "/app/today",
    "/app/self-study",
    "/app/records",
    "/app/planning",
    "/app/templates",
    "/app/settings",
    "/app/profile",
    "/app/help",
  ],
  research: [
    "/app/today",
    "/app/self-study",
    "/app/records",
    "/app/review",
    "/app/planning",
    "/app/templates",
    "/app/settings",
    "/app/profile",
    "/app/help",
  ],
  mentor: [
    "/app/today",
    "/app/self-study",
    "/app/planning",
    "/app/templates",
    "/app/audit",
    "/app/spaces",
    "/app/settings",
    "/app/profile",
    "/app/help",
  ],
} as const;

describe("persona route contract", () => {
  it("keeps the twelve approved primary routes in their defined order", () => {
    expect(ALL_ROUTES).toEqual(FROZEN_PERSONA_ROUTES);
    expect(new Set(ALL_ROUTES).size).toBe(12);
  });

  it("keeps universal account routes available to every persona", () => {
    expect(REQUIRED_PERSONA_ROUTES).toEqual([
      "/app/today",
      "/app/settings",
      "/app/profile",
      "/app/help",
    ]);

    for (const persona of BUILTIN_PERSONAS) {
      const expected =
        FROZEN_BUILTIN_MAPPING[
          persona.id as keyof typeof FROZEN_BUILTIN_MAPPING
        ];
      expect(persona.routes).toEqual(expected);
      expect(new Set(persona.routes).size).toBe(persona.routes.length);
      expect(
        REQUIRED_PERSONA_ROUTES.every((route) =>
          persona.routes.includes(route),
        ),
      ).toBe(true);
    }
  });
});
