import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LocalEntity } from "@logion/offline";

import {
  ResearchWorkbench,
  type ResearchWorkbenchProps,
} from "./research-workbench";
import { buildMetricComparison } from "./research-workbench-model";

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

function props(): ResearchWorkbenchProps {
  const question = {
    entity: entity("research_question", "question-1", {}),
    payload: {
      question: "缓存一致性是否能降低读取延迟？",
      rationale: "需要用可复核实验验证假设。",
      space_id: "space-1",
    },
  };
  const paper = {
    entity: entity("paper_record", "paper-1", {}),
    payload: {
      citation_key: "cache2026",
      source_url: "https://example.com/paper",
      space_id: "space-1",
      title: "缓存一致性研究",
    },
  };
  const claim = {
    entity: entity("research_claim", "claim-1", {}),
    payload: {
      paper_id: "paper-1",
      space_id: "space-1",
      stance: "supports",
      statement: "缓存一致性降低了读取延迟。",
    },
  };
  const run = {
    entity: entity("experiment_run", "run-1", {}),
    payload: {
      completed_at: "2026-08-26T10:00:00.000Z",
      method_summary: "在两个负载档位运行基准测试。",
      question_id: "question-1",
      space_id: "space-1",
      title: "基准运行",
    },
  };
  const metric = {
    entity: entity("metric_record", "metric-1", {}),
    payload: {
      name: "p95 latency",
      run_id: "run-1",
      space_id: "space-1",
      unit: "ms",
      value: 42,
    },
  };
  return {
    actions: {
      loadContext: vi.fn(async () => undefined),
      setSpaceId: vi.fn(),
      setWorkspaceId: vi.fn(),
      submitResearch: vi.fn(async () => true),
      synchronize: vi.fn(async () => undefined),
      unlock: vi.fn(async () => true),
    },
    context: {
      contextPhase: "ready",
      dataPhase: "ready",
      deviceId: "device-1",
      researchState: "ready",
      selectedSpace: {
        created_at: "2026-08-26T00:00:00.000Z",
        id: "space-1",
        name: "研究空间",
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
      status: "研究资料已在应用内解锁。",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [],
    },
    data: {
      comparison: buildMetricComparison(
        [{ id: "run-1", title: "基准运行" }],
        [{ id: "metric-1", name: "p95 latency", runId: "run-1", unit: "ms", value: 42 }],
      ),
      coverage: 100,
      visibleClaims: [claim],
      visibleFeedback: [],
      visibleMetrics: [metric],
      visiblePapers: [paper],
      visibleQuestions: [question],
      visibleRuns: [run],
    },
  };
}

describe("Research workbench", () => {
  it("renders the question master, evidence tabs and inspector as one workbench", () => {
    const html = renderToStaticMarkup(<ResearchWorkbench {...props()} />);

    expect(html).toContain("研究问题");
    expect(html).toContain("声明与证据");
    expect(html).toContain("论文");
    expect(html).toContain("实验与指标");
    expect(html).toContain('data-testid="research-questions"');
    expect(html).toContain('data-testid="research-claims"');
    expect(html).toContain('data-testid="research-evidence"');
    expect(html).toContain('data-testid="research-experiments"');
    expect(html).toContain("缓存一致性降低了读取延迟。");
    expect(html).toContain("问题链路");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
    expect(html).not.toContain("planning-form");
    expect(html).not.toContain("ProductPanel");
  });

  it("uses unlock as the only page primary while the Vault is locked", () => {
    const locked = props();
    locked.context.unlocked = false;
    locked.context.researchState = "locked";
    const html = renderToStaticMarkup(<ResearchWorkbench {...locked} />);

    expect(html).toContain('id="research-unlock"');
    expect(html).toContain("解锁资料");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });
});
