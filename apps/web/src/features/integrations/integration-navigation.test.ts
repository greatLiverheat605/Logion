import { describe, expect, it } from "vitest";

import { BUILTIN_PERSONAS } from "@/features/personas/persona-definitions";

import { isIntegrationEntryVisible } from "./integration-navigation";

describe("integration entry visibility", () => {
  it("shows a persistent entry to self, research and mentor only", () => {
    const visibility = Object.fromEntries(
      BUILTIN_PERSONAS.map((persona) => [
        persona.id,
        isIntegrationEntryVisible(persona),
      ]),
    );
    expect(visibility).toEqual({
      exam: false,
      mentor: true,
      research: true,
      self: true,
    });
    expect(
      isIntegrationEntryVisible({
        ...BUILTIN_PERSONAS[1]!,
        id: "custom-123",
        isBuiltin: false,
      }),
    ).toBe(false);
  });
});
