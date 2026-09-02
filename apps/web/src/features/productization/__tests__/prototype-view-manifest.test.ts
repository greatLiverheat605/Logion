import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALL_ROUTES } from "@/features/personas/persona-definitions";

import {
  APP_PRODUCT_ROUTES,
  PROTOTYPE_VIEW_IDS,
  PROTOTYPE_VIEW_TARGETS,
  PUBLIC_FLOW_ROUTES,
  SECONDARY_PRODUCT_ROUTES,
} from "../prototype-view-manifest";

const APP_ROUTE_DIRECTORY = fileURLToPath(
  new URL("../../../app/app/", import.meta.url),
);

function pageFile(route: string): string {
  const relativeRoute = route.replace(/^\/app\/?/, "");
  return resolve(APP_ROUTE_DIRECTORY, relativeRoute, "page.tsx");
}

const APP_DIRECTORY = resolve(APP_ROUTE_DIRECTORY, "..");

function publicPageFile(route: string): string {
  const relativeRoute = route.replace(/^\//, "");
  return resolve(APP_DIRECTORY, relativeRoute, "page.tsx");
}

describe("prototype productization manifest", () => {
  it("keeps integrations outside the frozen twelve-route persona contract", () => {
    expect(ALL_ROUTES).toEqual([
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
    ]);
    expect(ALL_ROUTES).not.toContain("/app/integrations");
  });

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

  it("maps integrations to a secondary route without changing primary routes", () => {
    expect(PROTOTYPE_VIEW_TARGETS.integrations).toEqual({
      primaryRoute: "/app/settings",
      secondaryRoute: "/app/integrations",
      status: "existing",
    });
    expect(SECONDARY_PRODUCT_ROUTES).toContain("/app/integrations");
  });

  it("freezes all twenty-one application routes without duplicates", () => {
    expect(APP_PRODUCT_ROUTES).toHaveLength(21);
    expect(new Set(APP_PRODUCT_ROUTES).size).toBe(21);

    for (const route of APP_PRODUCT_ROUTES) {
      expect(existsSync(pageFile(route))).toBe(true);
    }
  });

  it("tracks only public flows that exist in the formal Next router", () => {
    expect(PUBLIC_FLOW_ROUTES).toContain("/auth/callback");
    expect(PUBLIC_FLOW_ROUTES).not.toContain("/auth/passkey");

    for (const route of PUBLIC_FLOW_ROUTES) {
      expect(existsSync(publicPageFile(route))).toBe(true);
    }
  });
});
