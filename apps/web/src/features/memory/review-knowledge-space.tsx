/* ============================================================
   features/memory/review-knowledge-space.tsx
   Product integration of the dynamic knowledge-space graph.

   Maps real Topic/TopicDependency/Mastery data from the review center
   into the reusable KnowledgeSpaceGraph. The graph is read-only here:
   accept/edit/reject are only available in the controlled prototype.

   The rendered graph only accepts data from the server-authorised bounded
   graph API. Local sync-v1 Topic/Dependency data remains available to the
   Review list and edit flows, but is never presented as a successful online
   graph fallback.
   ============================================================ */

"use client";

import { ProductTag } from "@/components/product/product-ui";
import {
  type GraphMeta,
  truncationReasonLabel,
} from "@/features/desk/knowledge-graph-api";
import {
  KnowledgeSpaceGraph,
  type KnowledgeSpaceGraphState,
} from "@/features/knowledge-space-prototype/knowledge-space-graph";
import type {
  ConfirmState,
  KsData,
  KsEdge,
  KsNode,
} from "@/features/knowledge-space-prototype/ks-mock-data";

import "@/features/knowledge-space-prototype/knowledge-space.css";

export interface ReviewKnowledgeSpaceGraphTopic {
  id: string;
  title: string;
  description?: string;
  confirmedLevel?: string | null;
  suggestedLevel?: string | null;
  nextReviewAt?: string | null;
  due?: boolean;
}

export interface ReviewKnowledgeSpaceGraphDependency {
  prerequisiteId: string;
  dependentId: string;
}

export interface ReviewKnowledgeSpaceGraphProps {
  state: KnowledgeSpaceGraphState;
  onRetry?: () => void;
  onUnlock?: () => void;
  graphData: KsData | null;
  graphMeta: GraphMeta | null;
  selectedId?: string | null;
  onNodeSelect?: (id: string | null) => void;
}

const MASTERY_ORDER = [
  "unknown",
  "exposed",
  "practicing",
  "familiar",
  "proficient",
  "mastered",
];

function levelToMastery(level: string | null | undefined): number {
  if (!level) return 0;
  const index = MASTERY_ORDER.indexOf(level);
  return index >= 0 ? index / (MASTERY_ORDER.length - 1) : 0;
}

function levelToConfirmState(
  confirmedLevel: string | null | undefined,
  suggestedLevel: string | null | undefined,
): ConfirmState {
  if (confirmedLevel && confirmedLevel !== "unknown") return "confirmed";
  if (suggestedLevel && suggestedLevel !== "unknown") return "pending";
  return "contested";
}

export function buildReviewKnowledgeSpaceData(
  topics: ReviewKnowledgeSpaceGraphTopic[],
  dependencies: ReviewKnowledgeSpaceGraphDependency[],
): KsData {
  const nodeIds = new Set(topics.map((topic) => topic.id));
  const validDependencies = dependencies.filter(
    (dependency) =>
      nodeIds.has(dependency.prerequisiteId) &&
      nodeIds.has(dependency.dependentId) &&
      dependency.prerequisiteId !== dependency.dependentId,
  );

  const nodes: KsNode[] = topics.map((topic) => {
    const tags: string[] = [];
    if (topic.due) tags.push("今日到期");
    if (topic.nextReviewAt && !topic.due) tags.push("已安排复习");

    return {
      id: topic.id,
      label: topic.title,
      type: "topic",
      description: topic.description?.trim() || "暂无说明",
      mastery: levelToMastery(
        topic.confirmedLevel ?? topic.suggestedLevel ?? null,
      ),
      confirmState: levelToConfirmState(
        topic.confirmedLevel,
        topic.suggestedLevel,
      ),
      tags,
    };
  });

  const edges: KsEdge[] = validDependencies.map((dependency, index) => ({
    id: `dep-${index}`,
    source: dependency.prerequisiteId,
    target: dependency.dependentId,
    type: "prerequisite",
    label: "先修",
  }));

  return {
    nodes,
    edges,
    tasks: [],
    messages: [],
    traceSteps: [],
  };
}

/**
 * Builds the truncation/limits description shown under the graph title. When
 * the server-authorised API returned data (graphMeta), the description
 * reflects the real truncation state, limits and pagination cursor — never
 * silently dropped. When using local fallback data, the description shows the
 * local node/edge count without a truncation claim.
 */
function buildGraphDescription(
  graphData: KsData | null,
  graphMeta: GraphMeta | null,
): React.ReactNode {
  if (graphData && graphMeta) {
    const nodeCount = graphData.nodes.length;
    const edgeCount = graphData.edges.length;
    const parts: React.ReactNode[] = [];

    parts.push(
      <span key="source">
        服务端授权 · {graphMeta.depth} 跳 · {nodeCount} 个节点 · {edgeCount}{" "}
        条边（上限 {graphMeta.limits.nodes} 节点 / {graphMeta.limits.edges} 边）
      </span>,
    );

    if (graphMeta.truncated) {
      const reasons = graphMeta.truncationReasons.map((r) =>
        truncationReasonLabel(r),
      );
      parts.push(
        <span className="ks-page-subtitle" key="truncated">
          数据已截断：{reasons.join("、")}。当前为局部视图。
        </span>,
      );
    }

    if (graphMeta.nextCursor) {
      parts.push(
        <span className="ks-page-subtitle" key="more">
          还有更多数据可加载。
        </span>,
      );
    }

    return (
      <span>
        当前 Space
        中知识点与依赖的关系图谱。节点位置由浏览器本地计算，不依赖服务端坐标。
        {parts}
      </span>
    );
  }

  return (
    <span>
      当前 Space 的服务端授权局部图谱。选择根节点后加载 1/2
      跳范围；请求失败时不会回退为本地成功数据。
    </span>
  );
}

const EMPTY_GRAPH_DATA: KsData = {
  edges: [],
  messages: [],
  nodes: [],
  tasks: [],
  traceSteps: [],
};

const NODE_TYPE_LABELS = {
  action: "行动",
  claim: "论断",
  evidence: "证据",
  topic: "主题",
} as const;

export function ReviewKnowledgeSpaceInspector({
  data,
  graphMeta,
  nodeId,
}: Readonly<{
  data: KsData;
  graphMeta: GraphMeta | null;
  nodeId: string;
}>) {
  const node = data.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return <p>所选节点已不在当前有界视图中。</p>;

  const relations = data.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );

  return (
    <div className="ks-inspector">
      <section className="ks-inspector-section">
        <div className="ks-inspector-tags">
          <ProductTag>{NODE_TYPE_LABELS[node.type]}</ProductTag>
          {node.tags.map((tag) => (
            <ProductTag key={tag}>{tag}</ProductTag>
          ))}
        </div>
        <h3 className="ks-inspector-title">{node.label}</h3>
        <p className="ks-inspector-text">{node.description}</p>
      </section>

      <section className="ks-inspector-section">
        <h3>当前范围</h3>
        <p className="ks-inspector-text">
          {graphMeta
            ? `${graphMeta.depth} 跳授权视图 · ${data.nodes.length} 个节点 · ${data.edges.length} 条边`
            : "正在等待服务端授权范围。"}
        </p>
        {graphMeta?.truncated ? (
          <p className="ks-inspector-text">
            已截断：
            {graphMeta.truncationReasons
              .map((reason) => truncationReasonLabel(reason))
              .join("、")}
          </p>
        ) : null}
      </section>

      <section className="ks-inspector-section">
        <h3>关系 ({relations.length})</h3>
        {relations.length ? (
          <div className="ks-inspector-edges">
            {relations.slice(0, 12).map((edge) => {
              const otherId =
                edge.source === node.id ? edge.target : edge.source;
              const other = data.nodes.find(
                (candidate) => candidate.id === otherId,
              );
              return (
                <div className="ks-inspector-edge-item" key={edge.id}>
                  <span className="ks-inspector-edge-label">{edge.label}</span>
                  <span className="ks-inspector-edge-target">
                    {other?.label ?? otherId}
                  </span>
                </div>
              );
            })}
            {relations.length > 12 ? (
              <p className="ks-inspector-text">
                另有 {relations.length - 12} 条关系未在详情栏展开。
              </p>
            ) : null}
          </div>
        ) : (
          <p className="ks-inspector-text">当前范围内没有关联边。</p>
        )}
      </section>

      <section className="ks-inspector-section">
        <h3>对象标识</h3>
        <strong className="ks-inspector-meta-mono">{node.id}</strong>
      </section>
    </div>
  );
}

export function ReviewKnowledgeSpaceGraph({
  state,
  onRetry,
  onUnlock,
  graphData,
  graphMeta,
  selectedId,
  onNodeSelect,
}: ReviewKnowledgeSpaceGraphProps) {
  const data = graphData ?? EMPTY_GRAPH_DATA;
  const description = buildGraphDescription(graphData, graphMeta);

  return (
    <KnowledgeSpaceGraph
      data={data}
      state={state}
      eyebrow="REVIEW · KNOWLEDGE SPACE"
      title="知识空间"
      headingLevel="h2"
      description={description}
      selectedId={selectedId}
      onNodeSelect={onNodeSelect}
      readOnly={true}
      showInspector={false}
      showTrace={false}
      onRetry={onRetry}
      onUnlock={onUnlock}
    />
  );
}
