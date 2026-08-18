// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  projectWorkbenchInspectorObject,
  WorkbenchObjectInspector,
  workbenchInspectorContextKey,
} from "./workbench-object-inspector";

afterEach(cleanup);

describe("WorkbenchObjectInspector", () => {
  it("invalidates a same-route selection when its Workbench Persona changes", () => {
    const context = {
      personaId: "self",
      spaceId: "space-1",
      unlocked: true,
      vaultRevision: 1,
      workbench: "self-study",
      workspaceId: "workspace-1",
    } as const;
    const selectedContextKey = workbenchInspectorContextKey(context);

    expect(
      workbenchInspectorContextKey({ ...context, personaId: "custom-study" }),
    ).not.toBe(selectedContextKey);
    expect(
      workbenchInspectorContextKey({ ...context, workbench: "research" }),
    ).not.toBe(selectedContextKey);
    expect(
      workbenchInspectorContextKey({ ...context, vaultRevision: 2 }),
    ).not.toBe(selectedContextKey);
    expect(
      workbenchInspectorContextKey({ ...context, unlocked: false }),
    ).not.toBe(selectedContextKey);
  });

  it("projects only a matching authorized object context", () => {
    const record = {
      entity: {
        deleted_at: null,
        entity_id: "review-1",
        entity_type: "group_review",
        sync_status: "clean",
        updated_at: "2026-08-18T00:00:00Z",
        workspace_id: "workspace-1",
      },
      payload: {
        space_id: "shared-space",
        subject_title: "Shared review",
      },
    };
    const input = {
      allowedKinds: ["group_review"],
      records: [record],
      selection: { id: "review-1", kind: "group_review" },
      spaceId: "shared-space",
      workspaceId: "workspace-1",
    } as const;
    const snapshot = JSON.stringify(record);

    expect(projectWorkbenchInspectorObject(input)?.title).toBe("Shared review");
    expect(JSON.stringify(record)).toBe(snapshot);
    expect(
      projectWorkbenchInspectorObject({
        ...input,
        workspaceId: "workspace-2",
      }),
    ).toBeNull();
    expect(
      projectWorkbenchInspectorObject({ ...input, spaceId: "private-space" }),
    ).toBeNull();
    expect(
      projectWorkbenchInspectorObject({ ...input, contextAllowed: false }),
    ).toBeNull();
    expect(
      projectWorkbenchInspectorObject({
        ...input,
        allowedKinds: ["paper_record"],
      }),
    ).toBeNull();
    expect(
      projectWorkbenchInspectorObject({
        ...input,
        records: [
          {
            ...record,
            entity: {
              ...record.entity,
              deleted_at: "2026-08-18T01:00:00Z",
            },
          },
        ],
      }),
    ).toBeNull();
    expect(
      projectWorkbenchInspectorObject({
        ...input,
        records: [
          {
            ...record,
            payload: { ...record.payload, space_id: ["shared-space"] },
          },
        ],
      }),
    ).toBeNull();
  });

  it("renders only the supplied authorized snapshot", () => {
    render(
      <WorkbenchObjectInspector
        object={{
          description: "A verified object",
          fields: [{ label: "状态", value: "ready" }],
          id: "object-1",
          kind: "deliverable",
          sourceUrl: "https://example.test/source",
          spaceId: "space-1",
          status: "ready",
          title: "Evaluation report",
        }}
      />,
    );

    expect(screen.getByText("Evaluation report")).toBeTruthy();
    expect(screen.getByText("object-1")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "打开外部来源" }).getAttribute("href"),
    ).toBe("https://example.test/source");
    expect(screen.getByText("仅显示当前授权范围内的对象快照。")).toBeTruthy();
  });

  it("rejects unsafe source URLs and fails closed for a missing object", () => {
    const { rerender } = render(
      <WorkbenchObjectInspector
        object={{
          id: "object-2",
          kind: "source",
          sourceUrl: "javascript:alert(1)",
          title: '<img src=x onerror="alert(1)">',
        }}
      />,
    );

    expect(screen.queryByRole("link", { name: "打开外部来源" })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(screen.getByText("当前对象没有可用的外部来源。")).toBeTruthy();

    rerender(<WorkbenchObjectInspector object={null} />);
    expect(screen.getByRole("status").textContent).toContain(
      "对象详情暂不可用",
    );
    expect(screen.queryByText("object-2")).toBeNull();
  });
});
