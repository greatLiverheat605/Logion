import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LocalEntity } from "@logion/offline";

import { ExamWorkbench, type ExamWorkbenchProps } from "./exam-workbench";

function entity(entityType: string, id: string, payload: Record<string, unknown>): LocalEntity {
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

function props(): ExamWorkbenchProps {
  const exam = {
    entity: entity("exam", "exam-1", {}),
    payload: {
      date_status: "scheduled" as const,
      exam_at: "2026-11-07T01:00:00.000Z",
      score_scale_max: 100,
      space_id: "space-1",
      status: "planning" as const,
      target_score: 80,
      timezone: "Asia/Shanghai",
      title: "系统架构设计师",
    },
  };
  const subject = {
    entity: entity("exam_subject", "subject-1", {}),
    payload: {
      exam_id: "exam-1",
      name: "架构基础",
      space_id: "space-1",
      status: "active" as const,
      weight_basis_points: 3000,
    },
  };
  const node = {
    entity: entity("syllabus_node", "node-1", {}),
    payload: {
      coverage_status: "in_progress" as const,
      importance: 4,
      parent_id: null,
      space_id: "space-1",
      subject_id: "subject-1",
      title: "一致性模型",
    },
  };
  const mock = {
    entity: entity("mock_exam", "mock-1", {}),
    payload: {
      duration_limit_seconds: 5400,
      exam_id: "exam-1",
      space_id: "space-1",
      title: "第一次全真模考",
    },
  };
  return {
    actions: {
      createExam: vi.fn(async () => true),
      createMockExam: vi.fn(async () => true),
      createScoreRecord: vi.fn(async () => true),
      createSubject: vi.fn(async () => true),
      createSyllabusNode: vi.fn(async () => true),
      loadContext: vi.fn(async () => undefined),
      setDateStatus: vi.fn(),
      setSpaceId: vi.fn(),
      setSyllabusSubjectId: vi.fn(),
      setWorkspaceId: vi.fn(),
      synchronize: vi.fn(async () => true),
      unlock: vi.fn(async () => true),
    },
    context: {
      contextPhase: "ready",
      dataPhase: "ready",
      dateStatus: "scheduled",
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
      spaces: [],
      status: "备考资料已在应用内解锁。",
      syllabusSubjectId: "subject-1",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [],
    },
    data: {
      coveredNodes: 0,
      coverageRate: 0,
      latestNormalizedScore: 0,
      normalizedScores: [],
      primaryExam: exam,
      visibleExams: [exam],
      visibleMocks: [mock],
      visibleNodes: [node],
      visibleScores: [],
      visibleSubjects: [subject],
    },
  };
}

describe("ExamWorkbench", () => {
  it("renders Exam Master, Coverage Main and Inspector without legacy panels", () => {
    const html = renderToStaticMarkup(<ExamWorkbench {...props()} />);

    expect(html).toContain("EXAM MASTER");
    expect(html).toContain("覆盖概览");
    expect(html).toContain("EXAM INSPECTOR");
    expect(html).toContain('data-testid="exam-list"');
    expect(html).toContain('data-testid="exam-coverage"');
    expect(html).toContain('data-testid="exam-syllabus"');
    expect(html).toContain('data-testid="exam-mocks"');
    expect(html).toContain('data-testid="exam-weaknesses"');
    expect(html).toContain("系统架构设计师");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
    expect(html).not.toContain("planning-form");
    expect(html).not.toContain("ProductPanel");
  });

  it("uses unlock as the only page primary while the vault is locked", () => {
    const locked = props();
    locked.context.unlocked = false;
    locked.context.examState = "locked";
    const html = renderToStaticMarkup(<ExamWorkbench {...locked} />);

    expect(html).toContain("exam-unlock");
    expect(html).toContain("解锁资料");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });
});
