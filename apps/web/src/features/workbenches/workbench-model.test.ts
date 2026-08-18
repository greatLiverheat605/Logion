import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BUILTIN_PERSONAS,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";

import {
  FIXED_WORKBENCHES,
  projectPersonaToWorkbench,
} from "./workbench-model";

describe("workbench persona projection", () => {
  it("keeps the fixed workbench mapping and gate routes deeply readonly", () => {
    expect(FIXED_WORKBENCHES).toEqual([
      {
        entryPath: "/app/self-study",
        gateRoute: "/app/self-study",
        id: "learning",
        name: "学习",
        personaId: "self",
      },
      {
        entryPath: "/app/research",
        gateRoute: "/app/self-study",
        id: "research",
        name: "研究",
        personaId: "research",
      },
      {
        entryPath: "/app/exam",
        gateRoute: "/app/exam",
        id: "exam",
        name: "考试",
        personaId: "exam",
      },
      {
        entryPath: "/app/collaboration",
        gateRoute: "/app/self-study",
        id: "mentor",
        name: "导师",
        personaId: "mentor",
      },
    ]);

    expectTypeOf(FIXED_WORKBENCHES[0]).toEqualTypeOf<{
      readonly entryPath: "/app/self-study";
      readonly gateRoute: "/app/self-study";
      readonly id: "learning";
      readonly name: "学习";
      readonly personaId: "self";
    }>();
  });

  it("maps the four valid built-in personas through their existing gate routes", () => {
    for (const persona of BUILTIN_PERSONAS) {
      const definition = FIXED_WORKBENCHES.find(
        (item) => item.personaId === persona.id,
      )!;
      const projection = projectPersonaToWorkbench(persona)!;
      expect(projection.entryPath).toBe(definition.entryPath);
      expect(definition.entryPath).toBe(
        persona.id === "research"
          ? "/app/research"
          : persona.id === "mentor"
            ? "/app/collaboration"
            : persona.id === "exam"
              ? "/app/exam"
              : "/app/self-study",
      );
      expect(definition.gateRoute).toBe(
        persona.id === "exam" ? "/app/exam" : "/app/self-study",
      );
      expect(projection).toMatchObject({
        id: definition.id,
        kind: "fixed",
        name: definition.name,
        sourcePersonaId: persona.id,
      });
      expect(projection.visibleRoutes).toEqual(persona.routes);
    }
  });

  it("exposes a fixed entry only when the persona contains its gate route", () => {
    for (const persona of BUILTIN_PERSONAS) {
      const definition = FIXED_WORKBENCHES.find(
        (item) => item.personaId === persona.id,
      )!;
      const routes = persona.routes.filter(
        (route) => route !== definition.gateRoute,
      );
      const projection = projectPersonaToWorkbench({ ...persona, routes })!;

      expect(projection.entryPath).toBeNull();
      expect(projection.visibleRoutes).toEqual(routes);
    }
  });

  it("projects a custom persona without creating a workbench definition", () => {
    const persona: PersonaDefinition = {
      description: "现有考试与学习入口",
      icon: "C",
      id: "custom-existing",
      isBuiltin: false,
      name: "旧自定义",
      routes: ["/app/today", "/app/exam", "/app/self-study"],
    };

    expect(projectPersonaToWorkbench(persona)).toEqual({
      description: persona.description,
      entryPath: "/app/exam",
      icon: persona.icon,
      id: "legacy:custom-existing",
      kind: "legacy-persona",
      name: persona.name,
      sourcePersonaId: persona.id,
      visibleRoutes: persona.routes,
    });
  });

  it("returns no entry for a legacy persona without a workbench route", () => {
    const persona: PersonaDefinition = {
      description: "只有系统入口",
      icon: "C",
      id: "custom-minimal",
      isBuiltin: false,
      name: "最小画像",
      routes: ["/app/today", "/app/settings"],
    };

    const projection = projectPersonaToWorkbench(persona)!;
    expect(projection.entryPath).toBeNull();
    expect(projection.visibleRoutes).toEqual(persona.routes);
    expect(projection).not.toHaveProperty("role");
    expect(projection).not.toHaveProperty("spaceId");
  });

  it("fails closed for contradictory identities and null input", () => {
    const builtinIdMarkedCustom: PersonaDefinition = {
      ...BUILTIN_PERSONAS.find((persona) => persona.id === "self")!,
      isBuiltin: false,
    };
    const customIdMarkedBuiltin: PersonaDefinition = {
      description: "矛盾身份",
      icon: "C",
      id: "custom-forged",
      isBuiltin: true,
      name: "伪内置",
      routes: ["/app/self-study"],
    };
    const truthyMalformedBuiltin = {
      ...builtinIdMarkedCustom,
      isBuiltin: "false",
    } as unknown as PersonaDefinition;
    const falseyMalformedCustom = {
      ...customIdMarkedBuiltin,
      isBuiltin: 0,
    } as unknown as PersonaDefinition;

    expect(projectPersonaToWorkbench(builtinIdMarkedCustom)).toBeNull();
    expect(projectPersonaToWorkbench(customIdMarkedBuiltin)).toBeNull();
    expect(projectPersonaToWorkbench(truthyMalformedBuiltin)).toBeNull();
    expect(projectPersonaToWorkbench(falseyMalformedCustom)).toBeNull();
    expect(projectPersonaToWorkbench(null)).toBeNull();
  });

  it("returns a route snapshot instead of mutating the legacy persona", () => {
    const persona: PersonaDefinition = {
      description: "兼容快照",
      icon: "C",
      id: "custom-snapshot",
      isBuiltin: false,
      name: "快照",
      routes: ["/app/today", "/app/self-study"],
    };
    const projection = projectPersonaToWorkbench(persona)!;

    persona.routes.push("/app/settings");

    expect(projection.visibleRoutes).toEqual(["/app/today", "/app/self-study"]);
  });
});
