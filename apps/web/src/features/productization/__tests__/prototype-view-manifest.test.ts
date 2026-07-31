import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALL_ROUTES } from "@/features/personas/persona-definitions";

import {
  PROTOTYPE_VIEW_IDS,
  PROTOTYPE_VIEW_TARGETS,
  SECONDARY_PRODUCT_ROUTES,
} from "../prototype-view-manifest";

const APP_ROUTE_DIRECTORY = fileURLToPath(
  new URL("../../../app/app/", import.meta.url),
);

function pageFile(route: string): string {
  const relativeRoute = route.replace(/^\/app\/?/, "");
  return resolve(APP_ROUTE_DIRECTORY, relativeRoute, "page.tsx");
}

describe("prototype productization manifest", () => {
  it("accounts for all sixteen reference-prototype views", () => {
    expect(PROTOTYPE_VIEW_IDS).toEqual([
      "command",
      "plans",
      "memory",
      "knowledge",
      "exam",
      "library",
      "reader",
      "tutor",
      "research",
      "experiments",
      "evidence",
      "reviews",
      "ai",
      "integrations",
      "sync",
      "security",
    ]);
    expect(Object.keys(PROTOTYPE_VIEW_TARGETS)).toEqual(PROTOTYPE_VIEW_IDS);
  });

  it("maps every productized view through the frozen persona route contract", () => {
    for (const target of Object.values(PROTOTYPE_VIEW_TARGETS)) {
      expect(ALL_ROUTES).toContain(target.primaryRoute);
      expect(existsSync(pageFile(target.primaryRoute))).toBe(true);

      if (target.status === "existing" && target.secondaryRoute) {
        expect(SECONDARY_PRODUCT_ROUTES).toContain(target.secondaryRoute);
        expect(existsSync(pageFile(target.secondaryRoute))).toBe(true);
      }
    }
  });

  it("keeps integrations deferred until a real audited contract exists", () => {
    expect(PROTOTYPE_VIEW_TARGETS.integrations).toEqual({
      primaryRoute: "/app/settings",
      reason: "No general connector or automation-rule CRUD exists in OpenAPI.",
      status: "deferred",
    });
  });
});
