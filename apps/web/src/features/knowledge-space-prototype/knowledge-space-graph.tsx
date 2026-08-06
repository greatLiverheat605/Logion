/* ============================================================
   knowledge-space-prototype / knowledge-space-graph.tsx
   Reusable dynamic knowledge-space graph.

   Renders an interactive SVG graph, mobile list/tree fallback,
   context inspector, evidence trace, and scenario states.
   Accepts its data, layout, and read-only mode from the caller,
   so the same component can be used by the mock prototype and by
   real product views (e.g. ReviewCenter) without assuming backend
   coordinates or treating the mock dataset as production defaults.
   ============================================================ */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  ProductPageHeader,
  ProductProgress,
  ProductTag,
} from "@/components/product/product-ui";
import type {
  ConfirmState,
  KsData,
  KsEdge,
  KsNode,
  KsTraceStep,
  ViewMode,
} from "./ks-mock-data";
import { getConfirmColor, getConfirmLabel, getEdgeStyle } from "./ks-mock-data";

/* ============================================================
   Shared constants
   ============================================================ */

export type KnowledgeSpaceGraphState =
  | "ready"
  | "loading"
  | "error"
  | "empty"
  | "locked"
  | "online-only";

export type ReviewStatus = "accepted" | "edited" | "rejected";

export const SCENARIOS: ReadonlyArray<{
  id: KnowledgeSpaceGraphState;
  label: string;
}> = [
  { id: "ready", label: "正常" },
  { id: "loading", label: "加载中" },
  { id: "error", label: "错误" },
  { id: "empty", label: "空空间" },
  { id: "locked", label: "锁定" },
  { id: "online-only", label: "仅在线" },
];

const GRAPH_W = 700;
const GRAPH_H = 480;

const NODE_SHAPES: Record<string, string> = {
  topic: "rect",
  evidence: "ellipse",
  claim: "rect",
  action: "rect",
};

export const TYPE_LABELS: Record<KsNode["type"], string> = {
  topic: "主题",
  evidence: "证据",
  claim: "论断",
  action: "行动",
};

const PHASE_LABELS: Record<KsTraceStep["phase"], string> = {
  source: "来源",
  reasoning: "推理",
  conclusion: "结论",
  action: "行动",
};

const REVIEW_LABELS: Record<ReviewStatus, string> = {
  accepted: "已采纳",
  edited: "已编辑",
  rejected: "已拒绝",
};

const REVIEW_COLORS: Record<ReviewStatus, string> = {
  accepted: "var(--text-success)",
  edited: "var(--primary)",
  rejected: "var(--text-danger)",
};

export interface KnowledgeSpaceGraphProps {
  data: KsData;
  state: KnowledgeSpaceGraphState;
  eyebrow?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  selectedId?: string | null;
  onNodeSelect?: (id: string | null) => void;
  readOnly?: boolean;
  showSearch?: boolean;
  showViewControls?: boolean;
  showLegend?: boolean;
  showTrace?: boolean;
  searchPlaceholder?: string;
  onRetry?: () => void;
  onUnlock?: () => void;
  className?: string;
  children?: React.ReactNode;
}

/* ============================================================
   Layout helpers — client-side only, no backend coordinates required
   ============================================================ */

function computeNodePositions(
  nodes: readonly KsNode[],
): Record<string, { x: number; y: number }> {
  const hasPositions =
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        typeof node.x === "number" &&
        typeof node.y === "number" &&
        !Number.isNaN(node.x) &&
        !Number.isNaN(node.y),
    );

  if (hasPositions) {
    return Object.fromEntries(
      nodes.map((node) => [node.id, { x: node.x!, y: node.y! }]),
    );
  }

  const count = nodes.length;
  const radius = Math.min(200, Math.max(90, count * 14));
  const centerX = GRAPH_W / 2;
  const centerY = GRAPH_H / 2;
  return Object.fromEntries(
    nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / Math.max(1, count) - Math.PI / 2;
      return [
        node.id,
        {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
      ];
    }),
  );
}

function getNodeById(data: KsData, id: string | null): KsNode | undefined {
  if (id === null) return undefined;
  return data.nodes.find((node) => node.id === id);
}

function getEdgesForNode(data: KsData, nodeId: string | null): KsEdge[] {
  if (nodeId === null) return [];
  return data.edges.filter(
    (edge) => edge.source === nodeId || edge.target === nodeId,
  );
}

function getNeighborIds(data: KsData, nodeId: string): string[] {
  const ids = new Set<string>();
  for (const edge of data.edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return [...ids];
}

function getTraceStepsForNode(
  data: KsData,
  nodeId: string | null,
): KsTraceStep[] {
  if (nodeId === null) return [];
  return data.traceSteps.filter((step) => step.nodeId === nodeId);
}

function getTasksForNode(data: KsData, nodeId: string | null) {
  if (nodeId === null) return [];
  return data.tasks.filter((task) => task.nodeId === nodeId);
}

/* ============================================================
   Graph view (desktop)
   ============================================================ */

interface GraphViewProps {
  data: KsData;
  selectedId: string | null;
  focusedId: string | null;
  hoveredId: string | null;
  viewMode: ViewMode;
  chainIds: ReadonlySet<string>;
  searchQuery: string;
  reviews: Record<string, ReviewStatus>;
  confirmStateOverrides: Record<string, ConfirmState>;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  pan: { x: number; y: number };
  zoom: number;
  onPan: (pan: { x: number; y: number }) => void;
  onZoom: (zoom: number) => void;
}

function GraphView({
  data,
  selectedId,
  focusedId,
  hoveredId,
  viewMode,
  chainIds,
  searchQuery,
  reviews,
  confirmStateOverrides,
  onSelect,
  onHover,
  pan,
  zoom,
  onPan,
  onZoom,
}: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const dragNode = useRef<string | null>(null);

  const [nodePositions, setNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >(() => computeNodePositions(data.nodes));

  const nodeOrder = useMemo(
    () => data.nodes.map((node) => node.id),
    [data.nodes],
  );

  const handleNodeKeyDown = useCallback(
    (event: React.KeyboardEvent, nodeId: string) => {
      const index = nodeOrder.indexOf(nodeId);
      if (index === -1) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        const nextIndex = (index + 1) % nodeOrder.length;
        const nextId = nodeOrder[nextIndex];
        if (nextId) {
          onSelect(nextId);
          requestAnimationFrame(() => {
            svgRef.current
              ?.querySelector<HTMLElement>(`[data-node-id="${nextId}"]`)
              ?.focus();
          });
        }
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        const prevIndex = (index - 1 + nodeOrder.length) % nodeOrder.length;
        const prevId = nodeOrder[prevIndex];
        if (prevId) {
          onSelect(prevId);
          requestAnimationFrame(() => {
            svgRef.current
              ?.querySelector<HTMLElement>(`[data-node-id="${prevId}"]`)
              ?.focus();
          });
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(nodeId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onSelect(null);
      }
    },
    [nodeOrder, onSelect],
  );

  const { highlighted, dimmed } = useMemo(() => {
    const all = new Set(data.nodes.map((node) => node.id));
    let highlightedIds = new Set<string>();

    if (viewMode === "chain" && chainIds.size > 0) {
      highlightedIds = new Set(chainIds);
    } else {
      const anchor = hoveredId ?? (viewMode === "global" ? null : focusedId);
      if (anchor) {
        highlightedIds = new Set(getNeighborIds(data, anchor));
        highlightedIds.add(anchor);
      }
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      const matches = new Set(
        data.nodes
          .filter((node) => node.label.toLowerCase().includes(query))
          .map((node) => node.id),
      );
      highlightedIds =
        highlightedIds.size > 0
          ? new Set([...highlightedIds].filter((id) => matches.has(id)))
          : matches;
    }

    const dimmedIds =
      highlightedIds.size > 0
        ? new Set([...all].filter((id) => !highlightedIds.has(id)))
        : new Set<string>();

    return { highlighted: highlightedIds, dimmed: dimmedIds };
  }, [data, hoveredId, focusedId, viewMode, chainIds, searchQuery]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent, nodeId: string) => {
      event.preventDefault();
      isDragging.current = true;
      dragNode.current = nodeId;
      dragStart.current = { x: event.clientX, y: event.clientY };
      panStart.current = {
        x: nodePositions[nodeId]?.x ?? 0,
        y: nodePositions[nodeId]?.y ?? 0,
      };
    },
    [nodePositions],
  );

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (
        event.target === svgRef.current ||
        (event.target as SVGElement).classList.contains("ks-graph-svg-wrap")
      ) {
        isDragging.current = true;
        dragNode.current = null;
        dragStart.current = { x: event.clientX, y: event.clientY };
        panStart.current = { x: pan.x, y: pan.y };
        onSelect(null);
      }
    },
    [pan, onSelect],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isDragging.current) return;
      const dx = event.clientX - dragStart.current.x;
      const dy = event.clientY - dragStart.current.y;

      if (dragNode.current) {
        setNodePositions((previous) => ({
          ...previous,
          [dragNode.current!]: {
            x: panStart.current.x + dx / zoom,
            y: panStart.current.y + dy / zoom,
          },
        }));
      } else {
        onPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
      }
    },
    [zoom, onPan],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    dragNode.current = null;
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      onZoom(Math.max(0.3, Math.min(3, zoom + delta)));
    },
    [zoom, onZoom],
  );

  const renderNodeShape = (
    node: KsNode,
    className: string,
    isHigh: boolean,
  ) => {
    const position = nodePositions[node.id];
    if (!position) return null;
    const shape = NODE_SHAPES[node.type] ?? "rect";
    const size = node.type === "evidence" ? 28 : 24;
    const fill = isHigh ? "var(--primary)" : "var(--bg-surface)";
    const fillOpacity = isHigh ? 0.14 : 1;
    const stroke = isHigh ? "var(--primary)" : "var(--border-strong)";

    if (shape === "ellipse") {
      return (
        <ellipse
          className={className}
          cx={position.x}
          cy={position.y}
          rx={size}
          ry={size * 0.7}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={1.5}
        />
      );
    }

    if (node.type === "action") {
      return (
        <rect
          className={className}
          x={position.x - size}
          y={position.y - size * 0.5}
          width={size * 2}
          height={size}
          rx={8}
          ry={8}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      );
    }

    if (node.type === "claim") {
      return (
        <rect
          className={className}
          x={position.x - size * 0.7}
          y={position.y - size * 0.6}
          width={size * 1.4}
          height={size * 1.2}
          rx={2}
          ry={2}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={1.5}
        />
      );
    }

    return (
      <rect
        className={className}
        x={position.x - size * 0.7}
        y={position.y - size * 0.6}
        width={size * 1.4}
        height={size * 1.2}
        rx={8}
        ry={8}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={1.5}
      />
    );
  };

  return (
    <div
      className="ks-graph-svg-wrap"
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      <svg
        ref={svgRef}
        viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${GRAPH_W / zoom} ${GRAPH_H / zoom}`}
        aria-label="知识图谱：可用方向键导航节点，Enter 选择，Esc 取消选择"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="var(--border-strong)" />
          </marker>
          <marker
            id="arrowhead-highlight"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="var(--primary)" />
          </marker>
        </defs>

        <pattern
          id="grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
          patternTransform={`scale(${zoom})`}
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity="0.3"
          />
        </pattern>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {data.edges.map((edge) => {
          const source = nodePositions[edge.source];
          const target = nodePositions[edge.target];
          if (!source || !target) return null;

          const isDim = dimmed.has(edge.source) || dimmed.has(edge.target);
          const isHigh =
            highlighted.size > 0 &&
            highlighted.has(edge.source) &&
            highlighted.has(edge.target);
          const style = getEdgeStyle(edge.type);

          return (
            <g
              key={edge.id}
              className={`ks-gedge ${isDim ? "dimmed" : ""} ${isHigh ? "highlighted" : ""}`}
            >
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isHigh ? "var(--primary)" : "var(--border-strong)"}
                strokeWidth={isHigh ? 1.8 : 1.2}
                strokeDasharray={style.dashed ? style.dasharray : undefined}
                markerEnd={
                  isHigh ? "url(#arrowhead-highlight)" : "url(#arrowhead)"
                }
              />
              {isHigh && (
                <text
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2 - 6}
                  className="ks-gedge-label"
                  fill="var(--primary)"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {data.nodes.map((node) => {
          const position = nodePositions[node.id];
          if (!position) return null;

          const isSelected = selectedId === node.id;
          const isHovered = hoveredId === node.id;
          const isDim = dimmed.has(node.id) && !isSelected && !isHovered;
          const isHigh = highlighted.has(node.id) || isSelected || isHovered;
          const review = reviews[node.id];
          const confirmState =
            confirmStateOverrides[node.id] ?? node.confirmState;

          return (
            <g
              key={node.id}
              data-node-id={node.id}
              className={`ks-gnode ${isSelected ? "selected" : ""} ${isDim ? "dimmed" : ""} ${isHigh ? "highlighted" : ""}`}
              onPointerDown={(event) => handlePointerDown(event, node.id)}
              onClick={() => onSelect(node.id)}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover(null)}
              onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
              role="button"
              tabIndex={0}
              aria-label={`${node.label} — ${TYPE_LABELS[node.type]} — ${getConfirmLabel(confirmState)}`}
            >
              {isSelected && (
                <circle
                  className="ks-gnode-ripple"
                  cx={position.x}
                  cy={position.y}
                  r={20}
                  style={
                    {
                      "--ripple-start": "16px",
                      "--ripple-end": "36px",
                    } as React.CSSProperties
                  }
                />
              )}

              {renderNodeShape(node, "ks-gnode-body", isHigh)}

              {isSelected && renderNodeShape(node, "ks-gnode-ring", true)}

              <circle
                className="ks-gnode-confirm"
                cx={position.x + 16}
                cy={position.y - 14}
                r={3.5}
                fill={getConfirmColor(confirmState)}
                stroke="var(--bg-surface)"
                strokeWidth={1}
              />

              {review && confirmState !== "confirmed" && (
                <circle
                  className="ks-gnode-review"
                  cx={position.x + 16}
                  cy={position.y + 14}
                  r={3.5}
                  fill={REVIEW_COLORS[review]}
                  stroke="var(--bg-surface)"
                  strokeWidth={1}
                />
              )}

              <text
                x={position.x}
                y={position.y + (node.type === "evidence" ? 24 : 22)}
                className="ks-gnode-label"
                fill={isDim ? "var(--text-tertiary)" : "var(--text-secondary)"}
                fontWeight={isSelected ? 650 : 500}
              >
                <title>{node.label}</title>
                {node.label.length > 8
                  ? `${node.label.slice(0, 8)}…`
                  : node.label}
              </text>

              <text
                x={position.x}
                y={position.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="11"
                fill={isHigh ? "var(--primary)" : "var(--text-tertiary)"}
                pointerEvents="none"
                fontWeight={600}
              >
                {node.type === "evidence"
                  ? "E"
                  : node.type === "action"
                    ? "▶"
                    : node.type === "claim"
                      ? "C"
                      : "T"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================================================
   Mobile grouped list
   ============================================================ */

interface MobileTreeViewProps {
  data: KsData;
  selectedId: string | null;
  reviews: Record<string, ReviewStatus>;
  confirmStateOverrides: Record<string, ConfirmState>;
  searchQuery: string;
  onSelect: (id: string) => void;
}

function MobileTreeView({
  data,
  selectedId,
  reviews,
  confirmStateOverrides,
  searchQuery,
  onSelect,
}: MobileTreeViewProps) {
  const query = searchQuery.trim().toLowerCase();
  const groups = (["topic", "evidence", "claim", "action"] as const)
    .map((type) => ({
      type,
      nodes: data.nodes.filter(
        (node) =>
          node.type === type &&
          (!query || node.label.toLowerCase().includes(query)),
      ),
    }))
    .filter((group) => group.nodes.length > 0);

  if (groups.length === 0) {
    return (
      <div className="ks-mobile-tree">
        <p className="ks-mobile-tree-empty">没有匹配「{searchQuery}」的节点</p>
      </div>
    );
  }

  return (
    <nav className="ks-mobile-tree" aria-label="知识空间节点列表">
      {groups.map((group) => (
        <section
          key={group.type}
          className="ks-mobile-group"
          aria-label={`${TYPE_LABELS[group.type]}节点组`}
        >
          <h3>
            {TYPE_LABELS[group.type]}
            <span className="ks-mobile-group-count">{group.nodes.length}</span>
          </h3>
          <ul role="group">
            {group.nodes.map((node) => {
              const review = reviews[node.id];
              const isSelected = selectedId === node.id;
              const confirmState =
                confirmStateOverrides[node.id] ?? node.confirmState;
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    className={`ks-mobile-item ${isSelected ? "active" : ""}`}
                    onClick={() => onSelect(node.id)}
                    aria-pressed={isSelected}
                    aria-label={`${node.label}，${TYPE_LABELS[node.type]}，${getConfirmLabel(confirmState)}${review && confirmState !== "confirmed" ? `，${REVIEW_LABELS[review]}` : ""}`}
                  >
                    <span
                      className="ks-mobile-dot"
                      style={{ background: getConfirmColor(confirmState) }}
                      aria-hidden="true"
                    />
                    <span className="ks-mobile-label">{node.label}</span>
                    {review && confirmState !== "confirmed" && (
                      <span
                        className="ks-mobile-review"
                        style={{ color: REVIEW_COLORS[review] }}
                      >
                        {REVIEW_LABELS[review]}
                      </span>
                    )}
                    <AppIcon name="chevron-down" size={12} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/* ============================================================
   Inspector panel
   ============================================================ */

interface InspectorPanelProps {
  data: KsData;
  nodeId: string | null;
  reviews: Record<string, ReviewStatus>;
  confirmStateOverrides: Record<string, ConfirmState>;
  descOverrides: Record<string, string>;
  editDraft: string | null;
  readOnly: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEditStart: () => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onEditDraftChange: (value: string) => void;
  onResetReview: () => void;
}

function InspectorPanel({
  data,
  nodeId,
  reviews,
  confirmStateOverrides,
  descOverrides,
  editDraft,
  readOnly,
  onAccept,
  onReject,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditDraftChange,
  onResetReview,
}: InspectorPanelProps) {
  const node = getNodeById(data, nodeId);
  const tasks = getTasksForNode(data, nodeId);
  const traceSteps = getTraceStepsForNode(data, nodeId);
  const edges = getEdgesForNode(data, nodeId);

  if (!node) {
    return (
      <div className="ks-inspector-empty">
        <p>选择一个节点查看详情</p>
      </div>
    );
  }

  const review = reviews[node.id];
  const confirmState = confirmStateOverrides[node.id] ?? node.confirmState;
  const isFormal = confirmState === "confirmed";
  const description = descOverrides[node.id] ?? node.description;
  const editing = editDraft !== null;

  return (
    <div className="ks-inspector">
      <div className="ks-inspector-section">
        <div className="ks-inspector-tags">
          <ProductTag>{TYPE_LABELS[node.type]}</ProductTag>
          <ProductTag
            tone={
              confirmState === "confirmed"
                ? "good"
                : confirmState === "pending"
                  ? "warn"
                  : "bad"
            }
          >
            {getConfirmLabel(confirmState)}
          </ProductTag>
          {review && !isFormal && (
            <ProductTag
              tone={
                review === "accepted"
                  ? "good"
                  : review === "edited"
                    ? "info"
                    : "bad"
              }
            >
              {REVIEW_LABELS[review]}
            </ProductTag>
          )}
        </div>
        <h3 className="ks-inspector-title">{node.label}</h3>
      </div>

      {!isFormal && !readOnly && (
        <div className="ks-inspector-section">
          <h3>审批操作（本地模拟）</h3>
          {editing ? (
            <div className="ks-review-edit">
              <textarea
                value={editDraft}
                onChange={(event) => onEditDraftChange(event.target.value)}
                rows={4}
                aria-label="编辑节点摘要"
              />
              <div className="ks-review-actions">
                <button
                  type="button"
                  className="ks-review-btn ks-review-btn--primary"
                  onClick={onEditSave}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="ks-review-btn"
                  onClick={onEditCancel}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="ks-review-actions">
                <button
                  type="button"
                  className="ks-review-btn"
                  onClick={onAccept}
                  disabled={review === "accepted"}
                  aria-label={`采纳${node.label}`}
                >
                  <AppIcon name="shield" size={13} aria-hidden="true" />
                  采纳
                </button>
                <button
                  type="button"
                  className="ks-review-btn"
                  onClick={onEditStart}
                  aria-label={`编辑${node.label}`}
                >
                  <AppIcon name="clipboard" size={13} aria-hidden="true" />
                  编辑
                </button>
                <button
                  type="button"
                  className="ks-review-btn"
                  onClick={onReject}
                  disabled={review === "rejected"}
                  aria-label={`拒绝${node.label}`}
                >
                  <AppIcon name="close" size={13} aria-hidden="true" />
                  拒绝
                </button>
              </div>
              {review && (
                <button
                  type="button"
                  className="ks-review-reset"
                  onClick={onResetReview}
                >
                  撤销审批状态
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="ks-inspector-section">
        <h3>摘要{descOverrides[node.id] ? "（已编辑）" : ""}</h3>
        <p className="ks-inspector-text">{description}</p>
      </div>

      <div className="ks-inspector-section">
        <div className="ks-inspector-mastery">
          <ProductProgress
            label="掌握度"
            tone={
              node.mastery >= 0.7
                ? "good"
                : node.mastery >= 0.4
                  ? "info"
                  : "warn"
            }
            value={node.mastery * 100}
          />
        </div>
      </div>

      {node.source && (
        <div className="ks-inspector-section">
          <h3>来源详情</h3>
          <div className="ks-inspector-evidence">
            <div className="ks-source-card">
              <AppIcon name="book-open" size={13} aria-hidden="true" />
              <div>
                <strong>{node.source}</strong>
                <a
                  href={node.sourceUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看原始来源
                  <AppIcon name="chevron-down" size={11} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {edges.length > 0 && (
        <div className="ks-inspector-section">
          <h3>关系 ({edges.length})</h3>
          <div className="ks-inspector-edges">
            {edges.slice(0, 5).map((edge) => {
              const otherId =
                edge.source === nodeId ? edge.target : edge.source;
              const other = getNodeById(data, otherId);
              return (
                <div key={edge.id} className="ks-inspector-edge-item">
                  <span className="ks-inspector-edge-label">{edge.label}</span>
                  <span className="ks-inspector-edge-target">
                    {other?.label ?? otherId}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {node.tags.length > 0 && (
        <div className="ks-inspector-section">
          <h3>标签</h3>
          <div className="ks-inspector-tag-list">
            {node.tags.map((tag) => (
              <ProductTag key={tag}>{tag}</ProductTag>
            ))}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="ks-inspector-section">
          <h3>关联任务 ({tasks.length})</h3>
          <div className="ks-inspector-tasks">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`ks-inspector-task ${task.status === "open" ? "ks-inspector-task--open" : "ks-inspector-task--done"}`}
              >
                {task.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {traceSteps.length > 0 && (
        <div className="ks-inspector-section">
          <h3>证据轨迹</h3>
          <div className="ks-inspector-trace">
            {traceSteps.map((step) => (
              <div key={step.id} className="ks-inspector-trace-item">
                <span className="ks-inspector-trace-phase">
                  {PHASE_LABELS[step.phase]}
                </span>
                <div>{step.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ks-inspector-section">
        <h3>元信息</h3>
        <div className="ks-inspector-meta">
          <div className="ks-inspector-meta-item">
            <span>ID</span>
            <strong className="ks-inspector-meta-mono">{node.id}</strong>
          </div>
          <div className="ks-inspector-meta-item">
            <span>类型</span>
            <strong>{TYPE_LABELS[node.type]}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Evidence trace
   ============================================================ */

interface EvidenceTraceProps {
  steps: KsTraceStep[];
  collapsed: boolean;
  onToggle: () => void;
}

function EvidenceTrace({ steps, collapsed, onToggle }: EvidenceTraceProps) {
  if (collapsed) {
    return (
      <div className="ks-trace ks-trace--collapsed">
        <div className="ks-trace-header">
          <h3>证据轨迹 · {steps.length} 步</h3>
          <button
            className="ks-trace-toggle"
            onClick={onToggle}
            aria-expanded={false}
          >
            <AppIcon name="chevron-down" size={12} aria-hidden="true" />
            展开
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ks-trace">
      <div className="ks-trace-header">
        <h3>证据轨迹 · 来源 → 推理 → 结论 → 行动</h3>
        <button
          className="ks-trace-toggle"
          onClick={onToggle}
          aria-expanded={true}
        >
          <AppIcon name="chevron-down" size={12} aria-hidden="true" />
          折叠
        </button>
      </div>
      <div className="ks-trace-steps">
        {steps.length === 0 ? (
          <p className="ks-trace-empty">选择节点后显示其证据轨迹</p>
        ) : (
          steps.map((step) => (
            <div key={step.id} className="ks-trace-step">
              <div className="ks-trace-step-label">
                {PHASE_LABELS[step.phase]}
              </div>
              <div className="ks-trace-step-value">{step.detail}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Scenario state panel
   ============================================================ */

interface ScenarioStateProps {
  scenario: KnowledgeSpaceGraphState;
  onRetry?: () => void;
  onUnlock?: () => void;
}

function ScenarioState({ scenario, onRetry, onUnlock }: ScenarioStateProps) {
  if (scenario === "ready" || scenario === "empty") return null;

  if (scenario === "loading") {
    return (
      <div
        className="ks-state-panel"
        aria-busy="true"
        aria-label="知识空间加载中"
      >
        <div className="ks-skeleton ks-skeleton--bar ks-skeleton--32" />
        <div className="ks-skeleton-canvas">
          <div className="ks-skeleton ks-skeleton--node" />
          <div className="ks-skeleton ks-skeleton--node" />
          <div className="ks-skeleton ks-skeleton--node" />
          <div className="ks-skeleton ks-skeleton--node" />
        </div>
        <p className="ks-state-hint" role="status">
          正在加载知识空间…
        </p>
      </div>
    );
  }

  const copy = {
    error: {
      icon: "refresh" as const,
      title: "知识空间暂时无法读取",
      body: "读取失败不会被显示成空数据。",
      action: onRetry ? (
        <button type="button" className="ks-state-btn" onClick={onRetry}>
          重试
        </button>
      ) : null,
    },
    locked: {
      icon: "lock" as const,
      title: "知识空间已锁定",
      body: "解锁本地资料库之前不会展示任何节点内容。",
      action: onUnlock ? (
        <button type="button" className="ks-state-btn" onClick={onUnlock}>
          <AppIcon name="unlock" size={13} aria-hidden="true" />
          解锁
        </button>
      ) : null,
    },
    "online-only": {
      icon: "shield" as const,
      title: "知识图谱在线功能受限",
      body: "动态知识图谱计算、新知识关联与图谱生成均需在线连接，离线时不可用。",
      action: <ProductTag tone="warn">仅在线可用</ProductTag>,
    },
  }[scenario];

  return (
    <div className="ks-state-panel" role="status">
      <span className="ks-state-icon" aria-hidden="true">
        <AppIcon name={copy.icon} size={20} />
      </span>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      <div className="ks-state-action">{copy.action}</div>
    </div>
  );
}

/* ============================================================
   Main component
   ============================================================ */

export function KnowledgeSpaceGraph({
  data,
  state,
  eyebrow = "KNOWLEDGE SPACE",
  title = "知识空间",
  description,
  selectedId: controlledSelectedId,
  onNodeSelect,
  readOnly = false,
  showSearch = true,
  showViewControls = true,
  showLegend = true,
  showTrace = true,
  searchPlaceholder = "搜索节点…",
  onRetry,
  onUnlock,
  className,
  children,
}: KnowledgeSpaceGraphProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    null,
  );
  const selectedId = controlledSelectedId ?? internalSelectedId;
  const setSelectedId = useCallback(
    (id: string | null) => {
      setInternalSelectedId(id);
      onNodeSelect?.(id);
    },
    [onNodeSelect],
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("global");
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [reviews, setReviews] = useState<Record<string, ReviewStatus>>({});
  const [descOverrides, setDescOverrides] = useState<Record<string, string>>(
    {},
  );
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [confirmStateOverrides, setConfirmStateOverrides] = useState<
    Record<string, ConfirmState>
  >({});

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const handleViewMode = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      resetView();
      if (mode === "global") {
        setFocusId(null);
      } else if (selectedId) {
        setFocusId(selectedId);
      }
    },
    [selectedId, resetView],
  );

  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setEditDraft(null);
      if (id && viewMode !== "global") {
        setFocusId(id);
      }
    },
    [setSelectedId, viewMode],
  );

  const chainIds = useMemo<ReadonlySet<string>>(() => {
    if (viewMode !== "chain" || !selectedId) return new Set<string>();
    const chain = new Set<string>([selectedId]);
    for (const step of data.traceSteps) {
      if (chain.has(step.nodeId)) continue;
      if (getNeighborIds(data, step.nodeId).some((id) => chain.has(id))) {
        chain.add(step.nodeId);
      }
    }
    if (chain.size === 1) {
      for (const id of getNeighborIds(data, selectedId)) chain.add(id);
    }
    return chain;
  }, [data, viewMode, selectedId]);

  const traceSteps = useMemo(() => {
    if (!selectedId) return [];
    const nodeSteps = getTraceStepsForNode(data, selectedId);
    if (nodeSteps.length > 0) return nodeSteps;
    return data.traceSteps;
  }, [data, selectedId]);

  const zoomIn = useCallback(
    () => setZoom((value) => Math.min(3, value + 0.2)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((value) => Math.max(0.3, value - 0.2)),
    [],
  );

  const handleAccept = useCallback(() => {
    if (!selectedId) return;
    setConfirmStateOverrides((previous) => ({
      ...previous,
      [selectedId]: "confirmed",
    }));
    setReviews((previous) => ({ ...previous, [selectedId]: "accepted" }));
  }, [selectedId]);

  const handleReject = useCallback(() => {
    if (selectedId)
      setReviews((previous) => ({ ...previous, [selectedId]: "rejected" }));
  }, [selectedId]);

  const handleEditStart = useCallback(() => {
    if (!selectedId) return;
    const node = getNodeById(data, selectedId);
    setEditDraft(descOverrides[selectedId] ?? node?.description ?? "");
  }, [selectedId, data, descOverrides]);

  const handleEditSave = useCallback(() => {
    if (!selectedId || editDraft === null) return;
    setDescOverrides((previous) => ({
      ...previous,
      [selectedId]: editDraft,
    }));
    setReviews((previous) => ({ ...previous, [selectedId]: "edited" }));
    setEditDraft(null);
  }, [selectedId, editDraft]);

  const handleEditCancel = useCallback(() => setEditDraft(null), []);

  const handleResetReview = useCallback(() => {
    if (!selectedId) return;
    setReviews((previous) => {
      const next = { ...previous };
      delete next[selectedId];
      return next;
    });
    setDescOverrides((previous) => {
      const next = { ...previous };
      delete next[selectedId];
      return next;
    });
    setConfirmStateOverrides((previous) => {
      const next = { ...previous };
      delete next[selectedId];
      return next;
    });
  }, [selectedId]);

  const bodyBlocked =
    state === "loading" ||
    state === "error" ||
    state === "locked" ||
    state === "online-only";

  const isEmpty = state === "empty";

  const headerDescription = description ?? (
    <span>
      研究主题、论文证据、学习概念、推理结论与下一步行动之间的关系图谱。
      <span className="ks-page-subtitle">
        当前空间：{data.nodes.length} 个节点 · {data.edges.length} 条关系
      </span>
    </span>
  );

  return (
    <div className={`ks-page ${className ?? ""}`.trim()}>
      <ProductPageHeader
        eyebrow={eyebrow}
        title={title}
        description={headerDescription}
        actions={
          showSearch ? (
            <div className="product-search-field ks-search-field">
              <AppIcon name="search" size={15} aria-hidden="true" />
              <input
                type="search"
                placeholder={searchPlaceholder}
                aria-label="搜索知识空间"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          ) : null
        }
      />

      {bodyBlocked ? (
        <ScenarioState scenario={state} onRetry={onRetry} onUnlock={onUnlock} />
      ) : (
        <>
          <div className="ks-body">
            <div className="ks-canvas-zone">
              <div className="ks-canvas-toolbar">
                {showLegend && (
                  <div className="ks-legend-compact">
                    <span>
                      <span
                        className="ks-legend-shape ks-legend-shape--topic"
                        aria-hidden="true"
                      />
                      主题
                    </span>
                    <span>
                      <span
                        className="ks-legend-shape ks-legend-shape--evidence"
                        aria-hidden="true"
                      />
                      证据
                    </span>
                    <span>
                      <span
                        className="ks-legend-shape ks-legend-shape--claim"
                        aria-hidden="true"
                      />
                      论断
                    </span>
                    <span>
                      <span
                        className="ks-legend-shape ks-legend-shape--action"
                        aria-hidden="true"
                      />
                      行动
                    </span>
                    <span className="ks-legend-sep" aria-hidden="true" />
                    <span>
                      <span
                        className="ks-legend-dot ks-legend-dot--confirmed"
                        aria-hidden="true"
                      />
                      已确认
                    </span>
                    <span>
                      <span
                        className="ks-legend-dot ks-legend-dot--pending"
                        aria-hidden="true"
                      />
                      待验证
                    </span>
                    <span>
                      <span
                        className="ks-legend-dot ks-legend-dot--contested"
                        aria-hidden="true"
                      />
                      有争议
                    </span>
                  </div>
                )}

                <div className="ks-canvas-controls">
                  {showViewControls && (
                    <div
                      className="ks-view-controls"
                      role="radiogroup"
                      aria-label="视图模式"
                    >
                      <button
                        className={`ks-view-btn ${viewMode === "global" ? "active" : ""}`}
                        role="radio"
                        aria-checked={viewMode === "global"}
                        onClick={() => handleViewMode("global")}
                      >
                        全局
                      </button>
                      <button
                        className={`ks-view-btn ${viewMode === "focus" ? "active" : ""}`}
                        role="radio"
                        aria-checked={viewMode === "focus"}
                        onClick={() => handleViewMode("focus")}
                        disabled={!selectedId}
                        title={
                          selectedId
                            ? "聚焦所选节点的一跳邻居"
                            : "先选择一个节点"
                        }
                      >
                        聚焦
                      </button>
                      <button
                        className={`ks-view-btn ${viewMode === "chain" ? "active" : ""}`}
                        role="radio"
                        aria-checked={viewMode === "chain"}
                        onClick={() => handleViewMode("chain")}
                        disabled={!selectedId}
                        title={
                          selectedId ? "显示所选节点的证据链" : "先选择一个节点"
                        }
                      >
                        证据链
                      </button>
                    </div>
                  )}

                  <button
                    className="ks-zoom-btn"
                    onClick={zoomOut}
                    aria-label="缩小"
                    title="缩小"
                  >
                    −
                  </button>
                  <span
                    className="ks-zoom-label"
                    aria-live="polite"
                  >{`${Math.round(zoom * 100)}%`}</span>
                  <button
                    className="ks-zoom-btn"
                    onClick={zoomIn}
                    aria-label="放大"
                    title="放大"
                  >
                    +
                  </button>
                  <button
                    className="ks-zoom-btn"
                    onClick={resetView}
                    aria-label="重置视图"
                    title="重置视图"
                  >
                    <span className="ks-zoom-reset-icon" aria-hidden="true">
                      ⟲
                    </span>
                  </button>
                </div>
              </div>

              {isEmpty ? (
                <div className="ks-empty-canvas">
                  <span className="ks-state-icon" aria-hidden="true">
                    <AppIcon name="folder" size={20} />
                  </span>
                  <h3>当前空间暂无节点</h3>
                  <p>导入来源或创建主题后，知识图谱将在这里生成。</p>
                </div>
              ) : (
                <>
                  <GraphView
                    key={data.nodes.map((node) => node.id).join("|")}
                    data={data}
                    selectedId={selectedId}
                    focusedId={focusId}
                    hoveredId={hoveredId}
                    viewMode={viewMode}
                    chainIds={chainIds}
                    searchQuery={searchQuery}
                    reviews={reviews}
                    confirmStateOverrides={confirmStateOverrides}
                    onSelect={handleSelect}
                    onHover={setHoveredId}
                    pan={pan}
                    zoom={zoom}
                    onPan={setPan}
                    onZoom={setZoom}
                  />
                  <MobileTreeView
                    data={data}
                    selectedId={selectedId}
                    reviews={reviews}
                    confirmStateOverrides={confirmStateOverrides}
                    searchQuery={searchQuery}
                    onSelect={handleSelect}
                  />
                </>
              )}
            </div>

            <div className="ks-inspector-zone">
              <div className="product-panel ks-inspector-panel">
                <InspectorPanel
                  data={data}
                  nodeId={isEmpty ? null : selectedId}
                  reviews={reviews}
                  confirmStateOverrides={confirmStateOverrides}
                  descOverrides={descOverrides}
                  editDraft={editDraft}
                  readOnly={readOnly}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onEditStart={handleEditStart}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  onEditDraftChange={setEditDraft}
                  onResetReview={handleResetReview}
                />
              </div>
            </div>

            {showTrace && (
              <div className="ks-trace-zone">
                <EvidenceTrace
                  steps={isEmpty ? [] : traceSteps}
                  collapsed={traceCollapsed}
                  onToggle={() => setTraceCollapsed((value) => !value)}
                />
              </div>
            )}
          </div>

          {children}

          {viewMode !== "global" && !selectedId && (
            <p className="ks-view-hint">
              请选择一个节点以启用
              {viewMode === "focus" ? "聚焦" : "证据链"}视图
            </p>
          )}
        </>
      )}
    </div>
  );
}
