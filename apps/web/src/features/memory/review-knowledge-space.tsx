/* ============================================================
   features/memory/review-knowledge-space.tsx
   Product integration of the dynamic knowledge-space graph.

   Maps real Topic/TopicDependency/Mastery data from the review center
   into the reusable KnowledgeSpaceGraph. The graph is read-only here:
   accept/edit/reject are only available in the controlled prototype.
   ============================================================ */

"use client";

import { useMemo } from "react";

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
  topics: ReviewKnowledgeSpaceGraphTopic[];
  dependencies: ReviewKnowledgeSpaceGraphDependency[];
  state: KnowledgeSpaceGraphState;
  onRetry?: () => void;
  onUnlock?: () => void;
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

export function ReviewKnowledgeSpaceGraph({
  topics,
  dependencies,
  state,
  onRetry,
  onUnlock,
}: ReviewKnowledgeSpaceGraphProps) {
  const data = useMemo(
    () => buildReviewKnowledgeSpaceData(topics, dependencies),
    [topics, dependencies],
  );

  const isTruncated = false;

  return (
    <KnowledgeSpaceGraph
      data={data}
      state={state}
      eyebrow="REVIEW · KNOWLEDGE SPACE"
      title="知识空间"
      description={
        <span>
          当前 Space
          中知识点与先修依赖的关系图谱。节点位置由浏览器根据已有数据本地计算，不依赖服务端坐标。
          {isTruncated ? (
            <span className="ks-page-subtitle">
              已加载 {topics.length}{" "}
              个知识点；后端返回了截断标记，未完整展示全部数据。
            </span>
          ) : (
            <span className="ks-page-subtitle">
              {topics.length} 个知识点 · {dependencies.length} 条先修依赖
            </span>
          )}
        </span>
      }
      readOnly={true}
      showTrace={false}
      onRetry={onRetry}
      onUnlock={onUnlock}
    />
  );
}
