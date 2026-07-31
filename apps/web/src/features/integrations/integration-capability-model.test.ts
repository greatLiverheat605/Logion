import { describe, expect, it } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import {
  integrationCapabilityErrorState,
  summarizeIntegrationCapabilities,
  type CalendarFeed,
  type DataExport,
  type DataImport,
  type Space,
} from "./integration-capability-model";

describe("integration capability model", () => {
  it("derives every visible count from contract-backed records", () => {
    const feeds = [
      { status: "active" },
      { status: "revoked" },
      { status: "active" },
    ] as CalendarFeed[];
    const exports = [
      { status: "queued" },
      { status: "running" },
      { status: "succeeded" },
      { status: "failed" },
      { status: "cancelled" },
      { status: "expired" },
    ] as DataExport[];
    const imports = [
      { status: "previewed" },
      { status: "imported" },
      { status: "expired" },
    ] as DataImport[];

    expect(
      summarizeIntegrationCapabilities({
        exports,
        feeds,
        imports,
        privateSpaces: [{ visibility: "private" }] as Space[],
      }),
    ).toEqual({
      calendar: { active: 2, revoked: 1, total: 3 },
      exports: {
        cancelled: 1,
        expired: 1,
        failed: 1,
        queued: 1,
        running: 1,
        succeeded: 1,
        total: 6,
      },
      imports: { expired: 1, imported: 1, previewed: 1, total: 3 },
      privateSpaces: 1,
      unsupported: {
        automationRules: true,
        thirdPartyAccounts: true,
        tokenManagement: true,
        webhooks: true,
      },
    });
  });

  it("distinguishes recent authentication from ordinary request errors", () => {
    expect(
      integrationCapabilityErrorState(
        new LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          message: "sign in again",
          requestId: "request-auth",
          status: 403,
        }),
      ),
    ).toEqual({
      kind: "recent-auth-required",
      requestId: "request-auth",
    });
    expect(
      integrationCapabilityErrorState(
        new LogionApiError({
          code: "WORKSPACE_FORBIDDEN",
          message: "forbidden",
          requestId: "request-error",
          status: 403,
        }),
      ),
    ).toEqual({
      code: "WORKSPACE_FORBIDDEN",
      kind: "error",
      requestId: "request-error",
    });
    expect(integrationCapabilityErrorState(new Error("network"))).toEqual({
      code: "UNKNOWN",
      kind: "error",
      requestId: "unavailable",
    });
  });
});
