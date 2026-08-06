/* ============================================================
   knowledge-space-prototype / ks-mock-data.ts
   Mock data for Variant C — Knowledge Space dynamic graph.
   Local static data only, no API or backend assumptions.
   ============================================================ */

export type NodeType = "topic" | "evidence" | "claim" | "action";
export type EdgeType =
  | "supports"
  | "contradicts"
  | "leads_to"
  | "derives_from"
  | "evidence_for"
  | "prerequisite";
export type ConfirmState = "confirmed" | "pending" | "contested";
export type TaskStatus = "open" | "done";
export type ViewMode = "global" | "focus" | "chain";

export interface KsNode {
  id: string;
  label: string;
  type: NodeType;
  description: string;
  /** 0-1 mastery / confidence */
  mastery: number;
  confirmState: ConfirmState;
  /** Source URL for evidence nodes */
  sourceUrl?: string;
  source?: string;
  /** Optional x,y positions for a caller-supplied layout (0-600, 0-400). */
  x?: number;
  y?: number;
  /** Tags */
  tags: string[];
}

export interface KsEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label: string;
}

export interface KsTask {
  id: string;
  nodeId: string;
  label: string;
  status: TaskStatus;
}

export interface KsMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface KsTraceStep {
  id: string;
  nodeId: string;
  phase: "source" | "reasoning" | "conclusion" | "action";
  label: string;
  detail: string;
}

export interface KsData {
  nodes: KsNode[];
  edges: KsEdge[];
  tasks: KsTask[];
  messages: KsMessage[];
  traceSteps: KsTraceStep[];
}

/* ---------- projection types ---------- */

export type ProjectionTab = "today" | "review" | "records";

export interface KsProjectionItem {
  nodeId: string;
  label: string;
  type: NodeType;
  confirmState: ConfirmState;
  description: string;
  mastery: number;
  timestamp: string;
}

/* ---------- helper ---------- */

const now = "2026-08-05T10:00:00Z";
function daysAgo(n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/* ---------- data ---------- */

export const KS_DATA: KsData = {
  nodes: [
    // ── Topics ──
    {
      id: "topic-1",
      label: "间隔重复",
      type: "topic",
      description:
        "间隔重复（Spaced Repetition）是一种在逐渐增加的时间间隔内复习信息的记忆技术，被广泛认为是提高长期记忆保留最有效的方法之一。",
      mastery: 0.85,
      confirmState: "confirmed",
      x: 300,
      y: 140,
      tags: ["learning-science", "retention"],
    },
    {
      id: "topic-2",
      label: "主动回忆",
      type: "topic",
      description:
        "主动回忆（Active Recall）是通过主动从记忆中检索信息而非被动重读来加强学习效果的学习策略。",
      mastery: 0.78,
      confirmState: "confirmed",
      x: 140,
      y: 200,
      tags: ["learning-science", "testing-effect"],
    },
    {
      id: "topic-3",
      label: "交错练习",
      type: "topic",
      description:
        "交错练习（Interleaving）指在练习中混合不同主题或技能，而非一次专注于单一主题。研究表明这能提高长期学习迁移能力。",
      mastery: 0.62,
      confirmState: "pending",
      x: 460,
      y: 200,
      tags: ["practice", "mathematics"],
    },
    {
      id: "topic-4",
      label: "认知负荷理论",
      type: "topic",
      description:
        "认知负荷理论（Cognitive Load Theory）区分了内在、外在和相关认知负荷，为教学设计提供框架。",
      mastery: 0.45,
      confirmState: "contested",
      x: 200,
      y: 60,
      tags: ["instructional-design", "theory"],
    },
    {
      id: "topic-5",
      label: "睡眠与记忆巩固",
      type: "topic",
      description:
        "学习后12小时内的睡眠显著增强记忆巩固，对陈述性记忆任务效果最为明显。",
      mastery: 0.71,
      confirmState: "pending",
      x: 440,
      y: 60,
      tags: ["sleep", "consolidation"],
    },
    // ── Evidence ──
    {
      id: "ev-1",
      label: "间隔重复元分析 (2025)",
      type: "evidence",
      description:
        "47项研究的元分析证实，间隔重复相比集中练习长期记忆保留提高72%，效应量在各年龄段和学科领域均保持稳健。",
      mastery: 0.92,
      confirmState: "confirmed",
      source: "Journal of Cognitive Psychology, 2025",
      sourceUrl: "https://example.com/study-001",
      x: 300,
      y: 280,
      tags: ["meta-analysis", "spaced-repetition"],
    },
    {
      id: "ev-2",
      label: "主动回忆 RCT (2026)",
      type: "evidence",
      description:
        "随机对照试验（1200名参与者，6个月追踪）显示主动回忆测试比被动复习的长期记忆保留率高50%。",
      mastery: 0.88,
      confirmState: "confirmed",
      source: "Nature Human Behaviour, 2026",
      sourceUrl: "https://example.com/study-002",
      x: 140,
      y: 300,
      tags: ["active-recall", "RCT"],
    },
    {
      id: "ev-3",
      label: "交错练习数学成绩",
      type: "evidence",
      description:
        "跨主题交错练习比集中练习的考试成绩高25%，尽管学生报告初始难度更高。",
      mastery: 0.85,
      confirmState: "confirmed",
      source: "Educational Psychology Review, 2024",
      sourceUrl: "https://example.com/study-003",
      x: 460,
      y: 300,
      tags: ["interleaving", "mathematics"],
    },
    {
      id: "ev-4",
      label: "认知负荷预印本批评",
      type: "evidence",
      description:
        "该论文提出内在/外在/相关认知负荷的修订模型，但因缺乏实证支持受到批评。",
      mastery: 0.45,
      confirmState: "contested",
      source: "Pre-print, arXiv:2603.12345",
      sourceUrl: "https://example.com/preprint-006",
      x: 200,
      y: 380,
      tags: ["cognitive-load", "pre-print"],
    },
    {
      id: "ev-5",
      label: "睡眠巩固研究",
      type: "evidence",
      description:
        "学习后12小时内睡眠显著增加记忆巩固，对陈述性记忆任务效果最强。",
      mastery: 0.76,
      confirmState: "pending",
      source: "Sleep Research Society, 2025",
      sourceUrl: "https://example.com/study-004",
      x: 440,
      y: 380,
      tags: ["sleep", "consolidation"],
    },
    // ── Claims ──
    {
      id: "claim-1",
      label: "间隔重复 > 集中练习",
      type: "claim",
      description: "间隔重复在所有年龄段和学科领域均优于集中练习，效应量稳定。",
      mastery: 0.9,
      confirmState: "confirmed",
      x: 300,
      y: 200,
      tags: ["spaced-repetition", "comparison"],
    },
    {
      id: "claim-2",
      label: "主动回忆 > 被动重读",
      type: "claim",
      description:
        "主动检索强制记忆重建，比被动重读产生更深的编码和更强的提取路径。",
      mastery: 0.82,
      confirmState: "confirmed",
      x: 80,
      y: 250,
      tags: ["active-recall", "retrieval"],
    },
    {
      id: "claim-3",
      label: "值得期望的困难",
      type: "claim",
      description:
        "引入可控的困难（变化条件、间隔、交错）能增强长期记忆，尽管初始获取速度减慢。",
      mastery: 0.78,
      confirmState: "pending",
      x: 520,
      y: 250,
      tags: ["desirable-difficulties"],
    },
    // ── Actions ──
    {
      id: "action-1",
      label: "设计间隔重复课程",
      type: "action",
      description:
        "基于间隔重复和主动回忆的元分析证据，设计一门间隔重复课程，优化复习时间表。",
      mastery: 0.3,
      confirmState: "pending",
      x: 300,
      y: 440,
      tags: ["curriculum-design"],
    },
    {
      id: "action-2",
      label: "验证认知负荷模型",
      type: "action",
      description:
        "需要进一步实验验证修订后的认知负荷模型在真实教学环境中的预测效度。",
      mastery: 0.15,
      confirmState: "pending",
      x: 80,
      y: 440,
      tags: ["research", "validation"],
    },
  ],

  edges: [
    // supports
    {
      id: "e-1",
      source: "ev-1",
      target: "claim-1",
      type: "supports",
      label: "支持",
    },
    {
      id: "e-2",
      source: "ev-2",
      target: "claim-2",
      type: "supports",
      label: "支持",
    },
    {
      id: "e-3",
      source: "ev-3",
      target: "claim-3",
      type: "supports",
      label: "支持",
    },
    {
      id: "e-4",
      source: "ev-4",
      target: "topic-4",
      type: "evidence_for",
      label: "涉及",
    },
    {
      id: "e-5",
      source: "ev-5",
      target: "topic-5",
      type: "evidence_for",
      label: "涉及",
    },
    {
      id: "e-6",
      source: "ev-1",
      target: "topic-1",
      type: "evidence_for",
      label: "涉及",
    },
    {
      id: "e-7",
      source: "ev-2",
      target: "topic-2",
      type: "evidence_for",
      label: "涉及",
    },
    {
      id: "e-8",
      source: "ev-3",
      target: "topic-3",
      type: "evidence_for",
      label: "涉及",
    },
    // derives_from
    {
      id: "e-9",
      source: "claim-1",
      target: "topic-1",
      type: "derives_from",
      label: "源自",
    },
    {
      id: "e-10",
      source: "claim-2",
      target: "topic-2",
      type: "derives_from",
      label: "源自",
    },
    {
      id: "e-11",
      source: "claim-3",
      target: "topic-3",
      type: "derives_from",
      label: "源自",
    },
    // leads_to
    {
      id: "e-12",
      source: "claim-1",
      target: "action-1",
      type: "leads_to",
      label: "驱动",
    },
    {
      id: "e-13",
      source: "topic-4",
      target: "action-2",
      type: "leads_to",
      label: "需验证",
    },
    // contradicts
    {
      id: "e-14",
      source: "ev-4",
      target: "claim-1",
      type: "contradicts",
      label: "质疑",
    },
    // topic-topic
    {
      id: "e-15",
      source: "topic-1",
      target: "topic-2",
      type: "supports",
      label: "互补",
    },
    {
      id: "e-16",
      source: "topic-1",
      target: "topic-3",
      type: "supports",
      label: "互补",
    },
    {
      id: "e-17",
      source: "topic-4",
      target: "topic-1",
      type: "contradicts",
      label: "挑战",
    },
    // claim-claim
    {
      id: "e-18",
      source: "claim-1",
      target: "claim-3",
      type: "supports",
      label: "一致",
    },
    {
      id: "e-19",
      source: "claim-2",
      target: "claim-1",
      type: "supports",
      label: "强化",
    },
  ],

  tasks: [
    {
      id: "t-1",
      nodeId: "action-1",
      label: "审查间隔重复元分析论文",
      status: "open",
    },
    { id: "t-2", nodeId: "action-1", label: "起草课程大纲", status: "open" },
    {
      id: "t-3",
      nodeId: "action-1",
      label: "定义复习时间表算法",
      status: "done",
    },
    {
      id: "t-4",
      nodeId: "action-2",
      label: "设计验证实验方案",
      status: "open",
    },
    {
      id: "t-5",
      nodeId: "topic-5",
      label: "阅读睡眠巩固原始论文",
      status: "open",
    },
  ],

  messages: [
    {
      id: "msg-1",
      role: "user",
      content: "间隔重复和主动回忆哪个效果更好？",
      timestamp: daysAgo(14),
    },
    {
      id: "msg-2",
      role: "assistant",
      content:
        "两者都是高效的学习策略，但作用于不同阶段。间隔重复优化复习时间安排，主动回忆优化每次检索的深度。元分析表明两者结合使用效果最佳。",
      timestamp: daysAgo(14),
    },
    {
      id: "msg-3",
      role: "user",
      content: "能帮我设计一个结合两者的学习计划吗？",
      timestamp: daysAgo(10),
    },
    {
      id: "msg-4",
      role: "assistant",
      content:
        "当然。建议采用主动回忆为基础的自测，配合间隔重复算法安排复习时间。具体来说：新知识学习后1天、3天、7天、14天进行主动回忆测试。",
      timestamp: daysAgo(10),
    },
  ],

  traceSteps: [
    {
      id: "ts-1",
      nodeId: "ev-1",
      phase: "source",
      label: "来源",
      detail: "间隔重复元分析 (2025) — 47项研究，72%提升",
    },
    {
      id: "ts-2",
      nodeId: "ev-2",
      phase: "source",
      label: "来源",
      detail: "主动回忆 RCT (2026) — 1200人，50%提升",
    },
    {
      id: "ts-3",
      nodeId: "claim-1",
      phase: "reasoning",
      label: "推理",
      detail: "间隔重复和主动回忆各自独立且互补地增强记忆",
    },
    {
      id: "ts-4",
      nodeId: "claim-2",
      phase: "reasoning",
      label: "推理",
      detail: "主动检索强制记忆重建，产生更深编码",
    },
    {
      id: "ts-5",
      nodeId: "topic-1",
      phase: "conclusion",
      label: "结论",
      detail: "间隔重复是长期记忆保留最有效的方法之一",
    },
    {
      id: "ts-6",
      nodeId: "action-1",
      phase: "action",
      label: "行动",
      detail: "设计结合间隔重复和主动回忆的课程",
    },
  ],
};

/* ---------- Helpers ---------- */

export function getNodeById(id: string): KsNode | undefined {
  return KS_DATA.nodes.find((n) => n.id === id);
}

export function getEdgesForNode(nodeId: string): KsEdge[] {
  return KS_DATA.edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  );
}

export function getNeighborIds(nodeId: string): string[] {
  const ids = new Set<string>();
  for (const e of KS_DATA.edges) {
    if (e.source === nodeId) ids.add(e.target);
    if (e.target === nodeId) ids.add(e.source);
  }
  return [...ids];
}

export function getTasksForNode(nodeId: string): KsTask[] {
  return KS_DATA.tasks.filter((t) => t.nodeId === nodeId);
}

export function getTraceStepsForNode(nodeId: string): KsTraceStep[] {
  return KS_DATA.traceSteps.filter((s) => s.nodeId === nodeId);
}

export function getNodeColor(node: KsNode): string {
  switch (node.type) {
    case "topic":
      return "var(--primary)";
    case "evidence":
      return "var(--text-success)";
    case "claim":
      return "var(--text-warning)";
    case "action":
      return "var(--text-danger)";
  }
}

export function getConfirmColor(state: ConfirmState): string {
  switch (state) {
    case "confirmed":
      return "var(--text-success)";
    case "pending":
      return "var(--text-warning)";
    case "contested":
      return "var(--text-danger)";
  }
}

export function getConfirmLabel(state: ConfirmState): string {
  switch (state) {
    case "confirmed":
      return "已确认";
    case "pending":
      return "待验证";
    case "contested":
      return "有争议";
  }
}

export function getEdgeStyle(type: EdgeType): {
  dashed: boolean;
  dasharray?: string;
} {
  switch (type) {
    case "supports":
      return { dashed: false };
    case "contradicts":
      return { dashed: true, dasharray: "6 3" };
    case "leads_to":
      return { dashed: true, dasharray: "4 3" };
    case "derives_from":
      return { dashed: false };
    case "evidence_for":
      return { dashed: false };
    case "prerequisite":
      return { dashed: false };
  }
}

/* ---------- Projection helpers ---------- */

/**
 * Today projection: nodes that need attention today.
 * Pending/contested nodes, nodes with open tasks, or nodes with low mastery.
 */
export function getTodayProjection(): KsProjectionItem[] {
  const openTaskNodeIds = new Set(
    KS_DATA.tasks.filter((t) => t.status === "open").map((t) => t.nodeId),
  );
  return KS_DATA.nodes
    .filter(
      (n) =>
        n.confirmState === "pending" ||
        n.confirmState === "contested" ||
        openTaskNodeIds.has(n.id) ||
        n.mastery < 0.5,
    )
    .sort((a, b) => a.mastery - b.mastery)
    .map((n, i) => ({
      nodeId: n.id,
      label: n.label,
      type: n.type,
      confirmState: n.confirmState,
      description: n.description,
      mastery: n.mastery,
      timestamp: daysAgo(i),
    }));
}

/**
 * Review projection: all nodes without confirmed state, i.e. AI-suggested
 * items that may need human review.
 */
export function getReviewProjection(): KsProjectionItem[] {
  return KS_DATA.nodes
    .filter((n) => n.confirmState !== "confirmed")
    .sort((a, b) => {
      const order: Record<ConfirmState, number> = {
        contested: 0,
        pending: 1,
        confirmed: 2,
      };
      return (order[a.confirmState] ?? 0) - (order[b.confirmState] ?? 0);
    })
    .map((n, i) => ({
      nodeId: n.id,
      label: n.label,
      type: n.type,
      confirmState: n.confirmState,
      description: n.description,
      mastery: n.mastery,
      timestamp: daysAgo(i),
    }));
}

/**
 * Records projection: all nodes sorted by mastery descending (most established first).
 */
export function getRecordsProjection(): KsProjectionItem[] {
  return [...KS_DATA.nodes]
    .sort((a, b) => b.mastery - a.mastery)
    .map((n, i) => ({
      nodeId: n.id,
      label: n.label,
      type: n.type,
      confirmState: n.confirmState,
      description: n.description,
      mastery: n.mastery,
      timestamp: daysAgo(i),
    }));
}

export function getProjection(tab: ProjectionTab): KsProjectionItem[] {
  switch (tab) {
    case "today":
      return getTodayProjection();
    case "review":
      return getReviewProjection();
    case "records":
      return getRecordsProjection();
  }
}
