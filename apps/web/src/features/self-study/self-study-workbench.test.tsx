import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LocalEntity } from "@logion/offline";

import {
  SelfStudyWorkbench,
  type SelfStudyWorkbenchProps,
} from "./self-study-workbench";

function entity(
  entityType: string,
  id: string,
  payload: Record<string, unknown>,
): LocalEntity {
  return {
    workspace_id: "workspace-1",
    entity_type: entityType,
    entity_id: id,
    server_version: 1,
    local_revision: 1,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:00.000Z",
    deleted_at: null,
    created_by: "user-1",
    updated_by: "user-1",
    payload: payload as LocalEntity["payload"],
    payload_hash: "hash",
    sync_status: "clean",
  };
}

function props(): SelfStudyWorkbenchProps {
  const track = {
    entity: entity("learning_track", "track-1", {}),
    payload: {
      objective: "建立稳定的系统设计能力",
      space_id: "space-1",
      title: "分布式系统",
    },
  };
  const project = {
    entity: entity("study_project", "project-1", {}),
    payload: {
      intended_outcome: "完成一份可复核设计说明",
      space_id: "space-1",
      title: "一致性模型复盘",
      track_id: "track-1",
    },
  };
  const inbox = {
    entity: entity("inbox_item", "inbox-1", {}),
    payload: { note: "待整理资料", space_id: "space-1", title: "Raft 论文" },
  };
  const deliverable = {
    entity: entity("deliverable", "deliverable-1", {}),
    payload: {
      completed_at: "2026-08-26T10:00:00.000Z",
      evidence_summary: "完成结构化笔记",
      project_id: "project-1",
      space_id: "space-1",
      title: "复盘笔记",
    },
  };
  return {
    actions: {
      loadContext: vi.fn(async () => undefined),
      setSpaceId: vi.fn(),
      setWorkspaceId: vi.fn(),
      submit: vi.fn(async () => true),
      synchronize: vi.fn(async () => undefined),
      unlock: vi.fn(async () => true),
    },
    context: {
      deviceId: "device-1",
      examState: "ready",
      selectedSpace: {
        created_at: "2026-08-26T00:00:00.000Z",
        id: "space-1",
        name: "个人空间",
        owner_user_id: "user-1",
        status: "active",
        updated_at: "2026-08-26T00:00:00.000Z",
        version: 1,
        visibility: "private",
        workspace_id: "workspace-1",
      },
      selectedWorkspace: {
        created_at: "2026-08-26T00:00:00.000Z",
        id: "workspace-1",
        membership_status: "active",
        name: "个人工作区",
        role: "owner",
        status: "active",
        updated_at: "2026-08-26T00:00:00.000Z",
        version: 1,
      },
      spaceId: "space-1",
      status: "自主学习资料已在应用内解锁。",
      unlocked: true,
      workspaceId: "workspace-1",
    },
    data: {
      deliverables: [deliverable],
      inbox: [inbox],
      projects: [project],
      summary: {
        deliverableCount: 1,
        orphanProjectCount: 0,
        projectCount: 1,
        projectCoverage: 100,
        trackCount: 1,
      },
      tracks: [track],
    },
  };
}

describe("Self-study workbench", () => {
  it("renders Inbox, Board, Timeline and Inspector with one page primary", () => {
    const html = renderToStaticMarkup(<SelfStudyWorkbench {...props()} />);

    expect(html).toContain("快速收件箱");
    expect(html).toContain("路线与项目");
    expect(html).toContain("成果时间线");
    expect(html).toContain('data-testid="self-study-inbox"');
    expect(html).toContain('data-testid="self-study-projects"');
    expect(html).toContain('data-testid="self-study-deliverables"');
    expect(html).toContain("成果检查器");
    expect(html).toContain("Raft 论文");
    expect(html).toContain("复盘笔记");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
    expect(html).not.toContain("planning-form");
    expect(html).not.toContain("ProductPanel");
  });

  it("uses unlock as the only page primary while the vault is locked", () => {
    const locked = props();
    locked.context.unlocked = false;
    locked.context.examState = "locked";
    const html = renderToStaticMarkup(<SelfStudyWorkbench {...locked} />);

    expect(html).toContain("self-study-unlock");
    expect(html).toContain("解锁资料");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });
});
