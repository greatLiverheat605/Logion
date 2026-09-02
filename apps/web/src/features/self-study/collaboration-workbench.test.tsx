import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LocalEntity } from "@logion/offline";

import {
  CollaborationWorkbench,
  type CollaborationWorkbenchProps,
} from "./collaboration-workbench";

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

function props(): CollaborationWorkbenchProps {
  const rubric = {
    entity: entity("rubric", "rubric-1", {}),
    payload: {
      criteria: "说明证据来源\n给出下一步动作",
      space_id: "space-1",
      title: "设计评审标准",
    },
  };
  const review = {
    entity: entity("group_review", "review-1", {}),
    payload: {
      rubric_id: "rubric-1",
      space_id: "space-1",
      status: "open",
      subject_title: "研究工作台评审",
      submission_summary: "请确认证据链和后续动作。",
    },
  };
  const feedback = {
    entity: entity("group_feedback", "feedback-1", {}),
    payload: {
      feedback: "证据来源清晰，可以继续补充边界条件。",
      recommended_action: "补充离线场景测试。",
      review_id: "review-1",
      space_id: "space-1",
    },
  };
  const snapshot = {
    entity: entity("report_snapshot", "snapshot-1", {}),
    payload: {
      review_id: "review-1",
      space_id: "space-1",
      summary: "第一版评审结论。",
    },
  };
  return {
    actions: {
      loadContext: vi.fn(async () => undefined),
      setSpaceId: vi.fn(),
      setWorkspaceId: vi.fn(),
      submitCollaboration: vi.fn(async () => true),
      synchronize: vi.fn(async () => undefined),
      unlock: vi.fn(async () => true),
    },
    context: {
      collaborationState: "ready",
      contextPhase: "ready",
      dataPhase: "ready",
      deviceId: "device-1",
      selectedSpace: {
        created_at: "2026-08-26T00:00:00.000Z",
        id: "space-1",
        name: "项目共享空间",
        owner_user_id: "user-1",
        status: "active",
        updated_at: "2026-08-26T00:00:00.000Z",
        version: 1,
        visibility: "shared",
        workspace_id: "workspace-1",
      },
      selectedWorkspace: {
        created_at: "2026-08-26T00:00:00.000Z",
        id: "workspace-1",
        membership_status: "active",
        name: "团队工作区",
        role: "owner",
        status: "active",
        updated_at: "2026-08-26T00:00:00.000Z",
        version: 1,
      },
      sharedSpaces: [],
      spaceId: "space-1",
      status: "共享审阅资料已在应用内解锁。",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [],
    },
    data: {
      visibleFeedback: [feedback],
      visibleReviews: [review],
      visibleRubrics: [rubric],
      visibleSnapshots: [snapshot],
    },
  };
}

describe("Collaboration workbench", () => {
  it("renders queue, rubric feedback, snapshot and member inspector as one workbench", () => {
    const html = renderToStaticMarkup(<CollaborationWorkbench {...props()} />);

    expect(html).toContain("审阅请求");
    expect(html).toContain("设计评审标准");
    expect(html).toContain("证据来源清晰");
    expect(html).toContain("第一版评审结论");
    expect(html).toContain("成员 Inspector");
    expect(html).toContain('data-testid="collaboration-queue"');
    expect(html).toContain('data-testid="collaboration-rubric"');
    expect(html).toContain('data-testid="collaboration-feedback"');
    expect(html).toContain('data-testid="collaboration-snapshot"');
    expect(html).toContain('data-testid="collaboration-inspector"');
    expect(html).toContain("私人笔记、错题、未提交草稿");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
    expect(html).not.toContain("planning-form");
    expect(html).not.toContain("ProductPanel");
  });

  it("uses unlock as the only page primary while the Vault is locked", () => {
    const locked = props();
    locked.context.unlocked = false;
    locked.context.collaborationState = "locked";
    const html = renderToStaticMarkup(<CollaborationWorkbench {...locked} />);

    expect(html).toContain('id="collaboration-unlock"');
    expect(html).toContain("解锁资料");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });
});
