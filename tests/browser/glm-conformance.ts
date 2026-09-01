import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

export const GLM_AUXILIARY_ROUTES = ["/offline", "/404"] as const;

interface GlmDeviation {
  approvedAt?: string;
  approvedBy?: string;
  reason: string;
  recovery?: string;
  scope?: string;
  status: "approved" | "none";
}

interface GlmAsset {
  path: string;
  sha256: string;
  viewport: { height: number; width: number };
}

export interface GlmRouteContract {
  deviation: GlmDeviation;
  kind: "app" | "auxiliary" | "public";
  layoutTree: string[];
  primary: string;
  regions: string[];
  route: string;
  targets: string[];
  task: string;
}

export interface GlmTargetManifest {
  acceptance: {
    evidencePhases: string[];
    fullPagePixelMatch: boolean;
    maxVisiblePrimary: number;
    primarySelector: string;
    requiresProductOwnerReview: boolean;
    viewports: Array<{ height: number; width: number }>;
  };
  approvedAt: string;
  assets: Record<string, GlmAsset>;
  excludedAssets: Array<{ asset: string; reason: string }>;
  geometry: {
    desktopMinWidthPx: number;
    shell: {
      selectors: { main: string; sidebar: string; topbar: string };
      sidebarPx: number;
      topbarPx: number;
    };
    tabletMinWidthPx: number;
    tolerancePx: number;
    workbench: {
      inspectorPx: number;
      masterPx: number;
      selectors: { inspector: string; main: string; master: string };
    };
  };
  globalDeviations: Array<{
    approvedAt: string;
    approvedBy: string;
    reason: string;
    recovery: string;
    scope: string;
  }>;
  routes: GlmRouteContract[];
  schemaVersion: number;
  source: {
    root: string;
    screenshotsDirectory: string;
    specs: string[];
  };
}

const REPOSITORY_ROOT = resolve(
  process.env.LOGION_REPOSITORY_ROOT?.trim() || process.cwd(),
);
export const GLM_TARGET_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "reports",
  "ui-refactor",
  "glm-target-manifest.json",
);

export function loadGlmTargetManifest(): GlmTargetManifest {
  return JSON.parse(
    readFileSync(GLM_TARGET_MANIFEST_PATH, "utf8"),
  ) as GlmTargetManifest;
}

export function glmTargetRoot(manifest: GlmTargetManifest): string {
  const override = process.env.LOGION_GLM_TARGET_ROOT?.trim();
  return override ? resolve(override) : resolve(manifest.source.root);
}

export function isGlmTargetSourceAvailable(
  manifest: GlmTargetManifest,
): boolean {
  const root = glmTargetRoot(manifest);
  return (
    existsSync(root) &&
    manifest.source.specs.every((spec) => existsSync(resolve(root, spec)))
  );
}

function sameMembers(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((item) => actual.includes(item))
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateDeviation(
  deviation: GlmDeviation | undefined,
  label: string,
  errors: string[],
) {
  if (!deviation || !hasText(deviation.reason)) {
    errors.push(`${label} has no deviation record or reason`);
    return;
  }
  if (deviation.status !== "approved") return;
  for (const field of [
    "approvedAt",
    "approvedBy",
    "recovery",
    "scope",
  ] as const) {
    if (!hasText(deviation[field])) {
      errors.push(`${label} approved deviation has no ${field}`);
    }
  }
}

export function validateGlmManifestStructure(
  manifest: GlmTargetManifest,
  expected: {
    appRoutes: readonly string[];
    publicRoutes: readonly string[];
  },
): string[] {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) {
    errors.push(`unsupported schemaVersion ${manifest.schemaVersion}`);
  }
  if (!hasText(manifest.approvedAt)) errors.push("approvedAt is missing");

  const routes = manifest.routes ?? [];
  const routeNames = routes.map((contract) => contract.route);
  if (new Set(routeNames).size !== routeNames.length) {
    errors.push("route contracts contain duplicates");
  }
  const actualAppRoutes = routes
    .filter((contract) => contract.kind === "app")
    .map((contract) => contract.route);
  const actualPublicRoutes = routes
    .filter((contract) => contract.kind === "public")
    .map((contract) => contract.route);
  const actualAuxiliaryRoutes = routes
    .filter((contract) => contract.kind === "auxiliary")
    .map((contract) => contract.route);
  if (!sameMembers(actualAppRoutes, expected.appRoutes)) {
    errors.push(
      `app route coverage differs: ${JSON.stringify(actualAppRoutes)}`,
    );
  }
  if (!sameMembers(actualPublicRoutes, expected.publicRoutes)) {
    errors.push(
      `public route coverage differs: ${JSON.stringify(actualPublicRoutes)}`,
    );
  }
  if (!sameMembers(actualAuxiliaryRoutes, GLM_AUXILIARY_ROUTES)) {
    errors.push(
      `auxiliary route coverage differs: ${JSON.stringify(actualAuxiliaryRoutes)}`,
    );
  }

  const referencedAssets = new Set<string>();
  for (const contract of routes) {
    const label = `route ${contract.route}`;
    if (!hasText(contract.task)) errors.push(`${label} has no task`);
    if (!hasText(contract.primary)) errors.push(`${label} has no primary`);
    if (!contract.layoutTree?.length) {
      errors.push(`${label} has no layoutTree`);
    }
    if (
      !contract.regions?.length ||
      new Set(contract.regions).size !== contract.regions.length
    ) {
      errors.push(`${label} has no unique key regions`);
    }
    if (!contract.targets?.length) errors.push(`${label} has no GLM Target`);
    validateDeviation(contract.deviation, label, errors);
    for (const target of contract.targets ?? []) {
      referencedAssets.add(target);
      if (!manifest.assets[target]) {
        errors.push(`${label} references unknown target ${target}`);
      }
    }
  }

  const excluded = new Set<string>();
  for (const entry of manifest.excludedAssets ?? []) {
    excluded.add(entry.asset);
    if (!manifest.assets[entry.asset]) {
      errors.push(`excluded asset ${entry.asset} does not exist`);
    }
    if (!hasText(entry.reason)) {
      errors.push(`excluded asset ${entry.asset} has no reason`);
    }
  }
  for (const asset of Object.keys(manifest.assets ?? {})) {
    if (!referencedAssets.has(asset) && !excluded.has(asset)) {
      errors.push(`asset ${asset} is neither targeted nor explicitly excluded`);
    }
  }

  if (
    manifest.geometry.shell.sidebarPx !== 232 ||
    manifest.geometry.shell.topbarPx !== 48 ||
    manifest.geometry.workbench.masterPx !== 264 ||
    manifest.geometry.workbench.inspectorPx !== 316
  ) {
    errors.push("frozen Shell or Workbench geometry has drifted");
  }
  if (
    manifest.acceptance.fullPagePixelMatch !== false ||
    manifest.acceptance.maxVisiblePrimary !== 1 ||
    manifest.acceptance.requiresProductOwnerReview !== true
  ) {
    errors.push("acceptance policy has drifted");
  }
  if (manifest.globalDeviations.length < 2) {
    errors.push(
      "global accessibility and formal-semantics deviations are missing",
    );
  }
  return errors;
}

function isInside(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

function pngViewport(buffer: Buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || buffer.length < 24) return null;
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

export function validateGlmTargetAssets(manifest: GlmTargetManifest): string[] {
  const errors: string[] = [];
  const root = glmTargetRoot(manifest);
  for (const spec of manifest.source.specs) {
    const specPath = resolve(root, spec);
    if (!isInside(root, specPath) || !existsSync(specPath)) {
      errors.push(`GLM spec is missing or outside source root: ${spec}`);
    }
  }
  for (const [assetName, asset] of Object.entries(manifest.assets)) {
    const targetPath = resolve(root, asset.path);
    if (!isInside(root, targetPath)) {
      errors.push(`${assetName} resolves outside the GLM source root`);
      continue;
    }
    if (!existsSync(targetPath)) {
      errors.push(`${assetName} is missing at ${targetPath}`);
      continue;
    }
    const buffer = readFileSync(targetPath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== asset.sha256) {
      errors.push(`${assetName} SHA-256 mismatch: ${sha256}`);
    }
    const viewport = pngViewport(buffer);
    if (
      !viewport ||
      viewport.width !== asset.viewport.width ||
      viewport.height !== asset.viewport.height
    ) {
      errors.push(
        `${assetName} viewport mismatch: ${JSON.stringify(viewport)}`,
      );
    }
  }
  return errors;
}

export function glmRouteContract(
  manifest: GlmTargetManifest,
  route: string,
): GlmRouteContract {
  const contract = manifest.routes.find((entry) => entry.route === route);
  if (!contract) throw new Error(`No GLM route contract exists for ${route}`);
  return contract;
}

async function expectWidth(
  page: Page,
  selector: string,
  expectedPx: number,
  tolerancePx: number,
  label: string,
) {
  const locator = page.locator(selector);
  await expect(locator, `${label} must be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} must have measurable geometry`).not.toBeNull();
  expect(
    Math.abs((box?.width ?? 0) - expectedPx),
    `${label} width must be ${expectedPx}px ± ${tolerancePx}px`,
  ).toBeLessThanOrEqual(tolerancePx);
}

export async function assertGlmShellGeometry(
  page: Page,
  manifest: GlmTargetManifest,
) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width < manifest.geometry.desktopMinWidthPx) return;
  const { selectors, sidebarPx, topbarPx } = manifest.geometry.shell;
  await expectWidth(
    page,
    selectors.sidebar,
    sidebarPx,
    manifest.geometry.tolerancePx,
    "App Sidebar",
  );
  const topbar = page.locator(selectors.topbar);
  await expect(topbar, "App Topbar must be visible").toBeVisible();
  const topbarBox = await topbar.boundingBox();
  expect(topbarBox, "App Topbar must have measurable geometry").not.toBeNull();
  expect(
    Math.abs((topbarBox?.height ?? 0) - topbarPx),
    `App Topbar height must be ${topbarPx}px ± ${manifest.geometry.tolerancePx}px`,
  ).toBeLessThanOrEqual(manifest.geometry.tolerancePx);
}

export async function assertGlmWorkbenchGeometry(
  page: Page,
  manifest: GlmTargetManifest,
) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width < manifest.geometry.desktopMinWidthPx) return;
  const { inspectorPx, masterPx, selectors } = manifest.geometry.workbench;
  await expectWidth(
    page,
    selectors.master,
    masterPx,
    manifest.geometry.tolerancePx,
    "Workbench Master",
  );
  await expect(
    page.locator(selectors.main),
    "Workbench Main must be visible",
  ).toBeVisible();
  await expectWidth(
    page,
    selectors.inspector,
    inspectorPx,
    manifest.geometry.tolerancePx,
    "Workbench Inspector",
  );
}

export async function assertGlmRouteRegions(
  page: Page,
  manifest: GlmTargetManifest,
  route: string,
) {
  const contract = glmRouteContract(manifest, route);
  for (const region of contract.regions) {
    await expect(
      page.getByTestId(region),
      `${route} must expose the GLM region ${region}`,
    ).toBeAttached();
  }
}

export async function assertGlmPrimaryContract(
  page: Page,
  manifest: GlmTargetManifest,
  route: string,
) {
  const primaries = page.locator(
    `${manifest.acceptance.primarySelector}:visible`,
  );
  const count = await primaries.count();
  expect(
    count,
    `${route} exposes ${count} visible primary actions; contract is ${glmRouteContract(manifest, route).primary}`,
  ).toBeLessThanOrEqual(manifest.acceptance.maxVisiblePrimary);
}
