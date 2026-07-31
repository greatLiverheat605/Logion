import type { components } from "@logion/contracts";

import { LogionApiError } from "@/lib/api/client";

export type CalendarFeed = components["schemas"]["CalendarFeedResponse"];
export type DataExport = components["schemas"]["ExportResponse"];
export type DataImport = components["schemas"]["ImportPreviewResponse"];
export type Space = components["schemas"]["SpaceResponse"];
export type Workspace = components["schemas"]["WorkspaceResponse"];

export interface IntegrationCapabilitySummary {
  calendar: {
    active: number;
    revoked: number;
    total: number;
  };
  exports: Record<DataExport["status"], number> & { total: number };
  imports: Record<DataImport["status"], number> & { total: number };
  privateSpaces: number;
  unsupported: {
    automationRules: true;
    thirdPartyAccounts: true;
    tokenManagement: true;
    webhooks: true;
  };
}

export interface IntegrationCapabilityData {
  exports: DataExport[];
  feeds: CalendarFeed[];
  imports: DataImport[];
  privateSpaces: Space[];
}

export type IntegrationCapabilityErrorState =
  | { kind: "recent-auth-required"; requestId: string }
  | { code: string; kind: "error"; requestId: string }
  | { code: "UNKNOWN"; kind: "error"; requestId: "unavailable" };

export function summarizeIntegrationCapabilities(
  data: IntegrationCapabilityData,
): IntegrationCapabilitySummary {
  const calendar = { active: 0, revoked: 0, total: data.feeds.length };
  for (const feed of data.feeds) calendar[feed.status] += 1;

  const exports: IntegrationCapabilitySummary["exports"] = {
    cancelled: 0,
    expired: 0,
    failed: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    total: data.exports.length,
  };
  for (const item of data.exports) exports[item.status] += 1;

  const imports: IntegrationCapabilitySummary["imports"] = {
    expired: 0,
    imported: 0,
    previewed: 0,
    total: data.imports.length,
  };
  for (const item of data.imports) imports[item.status] += 1;

  return {
    calendar,
    exports,
    imports,
    privateSpaces: data.privateSpaces.length,
    unsupported: {
      automationRules: true,
      thirdPartyAccounts: true,
      tokenManagement: true,
      webhooks: true,
    },
  };
}

export function integrationCapabilityErrorState(
  error: unknown,
): IntegrationCapabilityErrorState {
  if (error instanceof LogionApiError) {
    if (error.code === "AUTH_RECENT_LOGIN_REQUIRED") {
      return { kind: "recent-auth-required", requestId: error.requestId };
    }
    return {
      code: error.code,
      kind: "error",
      requestId: error.requestId,
    };
  }
  return { code: "UNKNOWN", kind: "error", requestId: "unavailable" };
}
