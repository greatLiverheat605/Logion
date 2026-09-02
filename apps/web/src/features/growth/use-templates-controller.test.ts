import { describe, expect, it } from "vitest";

import {
  buildTemplateInstallPayload,
  buildTemplateRevokePayload,
  buildTemplateSharePayload,
  deriveTemplateCapabilities,
  parseTemplateImportText,
  TEMPLATES_COMMAND_KEYS,
} from "./use-templates-controller";

describe("Templates controller contract", () => {
  it("keeps every formal template and sharing command reachable", () => {
    expect(TEMPLATES_COMMAND_KEYS).toEqual([
      "createShare",
      "createTemplate",
      "importTemplate",
      "installTemplate",
      "loadContext",
      "loadWorkspaceData",
      "revokeShare",
      "setInstallStartDate",
      "setSelectedTemplateId",
      "setSpaceId",
      "setTemplateQuery",
      "setTemplateScope",
      "setWorkspaceId",
      "synchronize",
    ]);
  });

  it("requires a start date only when a template carries relative dates", () => {
    expect(
      buildTemplateInstallPayload({
        id: "installation-1",
        requiresStartDate: true,
        startDate: "",
        targetSpaceId: "space-1",
        templateId: "template-1",
      }),
    ).toEqual({ ok: false, reason: "start-date-required" });

    expect(
      buildTemplateInstallPayload({
        id: "installation-1",
        requiresStartDate: true,
        startDate: "2026-08-27",
        targetSpaceId: "space-1",
        templateId: "template-1",
      }),
    ).toEqual({
      ok: true,
      payload: {
        id: "installation-1",
        start_date: "2026-08-27",
        target_space_id: "space-1",
        template_id: "template-1",
      },
    });

    expect(
      buildTemplateInstallPayload({
        id: "installation-2",
        requiresStartDate: false,
        startDate: "ignored",
        targetSpaceId: "space-1",
        templateId: "template-1",
      }),
    ).toMatchObject({ ok: true, payload: { start_date: null } });
  });

  it("rejects oversized or non-object imports before an API request", () => {
    expect(parseTemplateImportText('{"name":"ok"}', 1_000_001)).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(parseTemplateImportText("[]", 2)).toEqual({
      ok: false,
      reason: "invalid-root",
    });
    expect(parseTemplateImportText("{bad", 4)).toEqual({
      ok: false,
      reason: "invalid-json",
    });
    expect(parseTemplateImportText('{"name":"ok"}', 14)).toEqual({
      ok: true,
      value: { name: "ok" },
    });
  });

  it("limits share payloads to selected fields and preserves one-time token semantics", () => {
    expect(
      buildTemplateSharePayload({
        fields: ["title", "description"],
        expiresInDays: 7,
        id: "share-1",
        sourceGoalId: "goal-1",
        sourceSpaceId: "space-1",
        title: "只读路线",
      }),
    ).toEqual({
      id: "share-1",
      source_goal_id: "goal-1",
      source_space_id: "space-1",
      title: "只读路线",
      fields: ["title", "description"],
      expires_in_days: 7,
    });
  });

  it("uses the server revision for revocation and derives role capabilities", () => {
    expect(buildTemplateRevokePayload(4)).toEqual({ expected_version: 4 });
    expect(
      deriveTemplateCapabilities({
        online: true,
        role: "viewer",
        spaceId: "space-1",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      canCreate: false,
      canImport: false,
      canInstall: false,
      canRevoke: false,
      canShare: false,
      canSync: true,
      canWrite: false,
    });
    expect(
      deriveTemplateCapabilities({
        online: true,
        role: "editor",
        spaceId: "space-1",
        workspaceId: "workspace-1",
      }).canInstall,
    ).toBe(true);
  });

  it("keeps official templates installable while removing tenant mutations", () => {
    expect(
      deriveTemplateCapabilities({
        online: true,
        role: "editor",
        spaceId: "space-1",
        workspaceId: "workspace-1",
        official: true,
      }),
    ).toMatchObject({
      canCreate: false,
      canInstall: true,
      canRevoke: false,
      canShare: false,
      canWrite: true,
    });
  });

  it("exposes the official category in the controller scope contract", async () => {
    const controllerModule = await import("./use-templates-controller");
    expect(controllerModule.TEMPLATE_SCOPE_VALUES).toEqual([
      "all",
      "official",
      "private",
      "workspace",
    ]);
  });
});
