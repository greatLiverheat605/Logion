import { type ALL_ROUTES } from "@/features/personas/persona-definitions";

export type PersonaPrimaryRoute = (typeof ALL_ROUTES)[number];

export const PROTOTYPE_VIEW_IDS = [
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
] as const;

export type PrototypeViewId = (typeof PROTOTYPE_VIEW_IDS)[number];

export const SECONDARY_PRODUCT_ROUTES = [
  "/app/research",
  "/app/collaboration",
  "/app/ai",
  "/app/sync",
  "/app/security",
  "/app/data",
  "/app/search",
  "/app/workspaces",
  "/app/integrations",
] as const;

export type SecondaryProductRoute = (typeof SECONDARY_PRODUCT_ROUTES)[number];

interface ExistingPrototypeViewTarget {
  primaryRoute: PersonaPrimaryRoute;
  secondaryRoute?: SecondaryProductRoute;
  status: "existing";
}

interface DeferredPrototypeViewTarget {
  primaryRoute: PersonaPrimaryRoute;
  reason: string;
  status: "deferred";
}

export type PrototypeViewTarget =
  | ExistingPrototypeViewTarget
  | DeferredPrototypeViewTarget;

/**
 * Productization boundary for the reference prototype.
 *
 * The persona contract continues to expose twelve primary routes. Prototype
 * views that already have a dedicated workbench use an existing secondary
 * route. The integrations route aggregates existing audited capabilities and
 * keeps unsupported connectors explicit instead of simulating success.
 */
export const PROTOTYPE_VIEW_TARGETS: Readonly<
  Record<PrototypeViewId, PrototypeViewTarget>
> = {
  command: { primaryRoute: "/app/today", status: "existing" },
  plans: { primaryRoute: "/app/planning", status: "existing" },
  memory: { primaryRoute: "/app/review", status: "existing" },
  knowledge: { primaryRoute: "/app/review", status: "existing" },
  exam: { primaryRoute: "/app/exam", status: "existing" },
  library: { primaryRoute: "/app/records", status: "existing" },
  reader: {
    primaryRoute: "/app/records",
    secondaryRoute: "/app/research",
    status: "existing",
  },
  tutor: {
    primaryRoute: "/app/self-study",
    secondaryRoute: "/app/ai",
    status: "existing",
  },
  research: {
    primaryRoute: "/app/self-study",
    secondaryRoute: "/app/research",
    status: "existing",
  },
  experiments: {
    primaryRoute: "/app/self-study",
    secondaryRoute: "/app/research",
    status: "existing",
  },
  evidence: {
    primaryRoute: "/app/today",
    status: "existing",
  },
  reviews: {
    primaryRoute: "/app/audit",
    secondaryRoute: "/app/collaboration",
    status: "existing",
  },
  ai: {
    primaryRoute: "/app/settings",
    secondaryRoute: "/app/ai",
    status: "existing",
  },
  integrations: {
    primaryRoute: "/app/settings",
    secondaryRoute: "/app/integrations",
    status: "existing",
  },
  sync: {
    primaryRoute: "/app/settings",
    secondaryRoute: "/app/sync",
    status: "existing",
  },
  security: {
    primaryRoute: "/app/settings",
    secondaryRoute: "/app/security",
    status: "existing",
  },
};
