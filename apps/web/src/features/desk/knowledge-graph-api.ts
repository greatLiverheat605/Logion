import type { components } from "@logion/contracts";

import type {
  ConfirmState,
  EdgeType,
  KsData,
  KsEdge,
  KsNode,
  NodeType,
} from "@/features/knowledge-space-prototype/ks-mock-data";

/* ---- Contract type aliases ----------------------------------------------- */

type Schemas = components["schemas"];
export type KnowledgeGraphResponse = Schemas["KnowledgeGraphResponse"];
export type KnowledgeGraphNode = Schemas["KnowledgeGraphNode"];
export type KnowledgeGraphEdge = Schemas["KnowledgeGraphEdge"];
export type KnowledgeGraphRoot = Schemas["KnowledgeGraphRoot"];
export type KnowledgeGraphLimits = Schemas["KnowledgeGraphLimits"];
export type KnowledgeTargetType = Schemas["KnowledgeTargetType"];
export type GraphEdgeType = Schemas["GraphEdgeType"];
export type GraphDirection = Schemas["GraphDirection"];
export type GraphTruncationReason = Schemas["GraphTruncationReason"];

export const KNOWLEDGE_GRAPH_MAX_NODES = 150;
export const KNOWLEDGE_GRAPH_MAX_EDGES = 400;
const KNOWLEDGE_GRAPH_MAX_BYTES = 1_048_576;
const KNOWLEDGE_GRAPH_MAX_CURSOR_LENGTH = 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_TYPES = new Set<KnowledgeTargetType>([
  "note",
  "quiz_item",
  "research_claim",
  "topic",
]);
const EDGE_TYPES = new Set<GraphEdgeType>([
  "contradiction",
  "definition",
  "derivation",
  "example",
  "source",
  "support",
  "topic_dependency",
]);
const TRUNCATION_REASONS = new Set<GraphTruncationReason>([
  "byte_limit",
  "edge_limit",
  "node_limit",
  "row_limit",
  "time_limit",
]);

export class KnowledgeGraphResponseError extends Error {
  constructor() {
    super("The knowledge graph response is invalid.");
    this.name = "KnowledgeGraphResponseError";
  }
}

function responseInvalid(): never {
  throw new KnowledgeGraphResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

const RESPONSE_KEYS = new Set([
  "depth",
  "edges",
  "limits",
  "next_cursor",
  "nodes",
  "root",
  "truncated",
  "truncation_reasons",
]);
const ROOT_KEYS = new Set(["id", "type"]);
const NODE_KEYS = new Set([
  "excerpt_preview",
  "id",
  "label",
  "type",
  "version",
]);
const EXCERPT_KEYS = new Set(["excerpt_id", "stale", "text"]);
const EDGE_KEYS = new Set(["id", "source", "state", "target", "type"]);
const LIMIT_KEYS = new Set(["bytes", "edges", "nodes"]);

function isWithinResponseByteLimit(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      KNOWLEDGE_GRAPH_MAX_BYTES
    );
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRoot(
  value: unknown,
): value is { id: string; type: KnowledgeTargetType } {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    typeof value.type === "string" &&
    NODE_TYPES.has(value.type as KnowledgeTargetType)
  );
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

/**
 * Runtime validation for the generated compile-time contract. Browser JSON is
 * untrusted at runtime, so the renderer fails closed when the service returns
 * an over-limit, dangling, duplicated or internally inconsistent graph.
 */
export function validateKnowledgeGraphResponse(
  value: unknown,
): asserts value is KnowledgeGraphResponse {
  if (
    !isRecord(value) ||
    !isWithinResponseByteLimit(value) ||
    !hasOnlyKeys(value, RESPONSE_KEYS) ||
    !isRoot(value.root) ||
    !hasOnlyKeys(value.root, ROOT_KEYS) ||
    !isBoundedInteger(value.depth, 1, 2) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.truncation_reasons) ||
    !isRecord(value.limits) ||
    !hasOnlyKeys(value.limits, LIMIT_KEYS)
  ) {
    responseInvalid();
  }

  const limits = value.limits;
  if (
    !isBoundedInteger(limits.nodes, 1, KNOWLEDGE_GRAPH_MAX_NODES) ||
    !isBoundedInteger(limits.edges, 1, KNOWLEDGE_GRAPH_MAX_EDGES) ||
    !isBoundedInteger(limits.bytes, 1, KNOWLEDGE_GRAPH_MAX_BYTES) ||
    value.nodes.length > limits.nodes ||
    value.nodes.length > KNOWLEDGE_GRAPH_MAX_NODES ||
    value.edges.length > limits.edges ||
    value.edges.length > KNOWLEDGE_GRAPH_MAX_EDGES
  ) {
    responseInvalid();
  }

  const nodeTypes = new Map<string, KnowledgeTargetType>();
  for (const node of value.nodes) {
    const graphNode = node as KnowledgeGraphNode;
    if (
      !isRoot(graphNode) ||
      !isRecord(graphNode) ||
      !hasOnlyKeys(graphNode, NODE_KEYS) ||
      typeof graphNode.label !== "string" ||
      graphNode.label.length < 1 ||
      graphNode.label.length > 500 ||
      !isBoundedInteger(graphNode.version, 1, Number.MAX_SAFE_INTEGER) ||
      nodeTypes.has(graphNode.id)
    ) {
      responseInvalid();
    }
    const excerpt = graphNode.excerpt_preview;
    if (
      excerpt !== undefined &&
      excerpt !== null &&
      (!isRecord(excerpt) ||
        !hasOnlyKeys(excerpt, EXCERPT_KEYS) ||
        !isUuid(excerpt.excerpt_id) ||
        typeof excerpt.text !== "string" ||
        excerpt.text.length > 500 ||
        typeof excerpt.stale !== "boolean")
    ) {
      responseInvalid();
    }
    nodeTypes.set(graphNode.id, graphNode.type);
  }

  if (
    value.nodes.length > 0 &&
    nodeTypes.get(value.root.id) !== value.root.type
  ) {
    responseInvalid();
  }

  const edgeIds = new Set<string>();
  for (const edge of value.edges) {
    if (
      !isRecord(edge) ||
      !hasOnlyKeys(edge, EDGE_KEYS) ||
      !isUuid(edge.id) ||
      edgeIds.has(edge.id) ||
      typeof edge.type !== "string" ||
      !EDGE_TYPES.has(edge.type as GraphEdgeType) ||
      edge.state !== "accepted" ||
      !isRoot(edge.source) ||
      !hasOnlyKeys(edge.source, ROOT_KEYS) ||
      !isRoot(edge.target) ||
      !hasOnlyKeys(edge.target, ROOT_KEYS) ||
      nodeTypes.get(edge.source.id) !== edge.source.type ||
      nodeTypes.get(edge.target.id) !== edge.target.type
    ) {
      responseInvalid();
    }
    edgeIds.add(edge.id);
  }

  const reasons = value.truncation_reasons;
  if (
    reasons.length > TRUNCATION_REASONS.size ||
    reasons.some(
      (reason) =>
        typeof reason !== "string" ||
        !TRUNCATION_REASONS.has(reason as GraphTruncationReason),
    ) ||
    new Set(reasons).size !== reasons.length ||
    value.truncated !== reasons.length > 0 ||
    (value.next_cursor !== undefined &&
      value.next_cursor !== null &&
      (typeof value.next_cursor !== "string" ||
        value.next_cursor.length === 0 ||
        value.next_cursor.length > KNOWLEDGE_GRAPH_MAX_CURSOR_LENGTH ||
        !value.truncated))
  ) {
    responseInvalid();
  }
}

/* ---- Depth clamp --------------------------------------------------------- */

/**
 * The contract only allows depth 1 or 2. This clamp prevents the frontend
 * from ever requesting a wider scope — the server enforces the same, but the
 * client must not attempt to expand beyond the bounded 1/2-hop view.
 */
export function clampDepth(depth: number): 1 | 2 {
  return depth >= 2 ? 2 : 1;
}

/* ---- Type mapping: contract → prototype ViewModel ----------------------- */

/**
 * Maps a contract `KnowledgeTargetType` to the prototype `NodeType` for
 * rendering. The prototype only has four visual node kinds; all contract
 * types collapse onto those:
 *
 * - `topic` → `topic`
 * - `quiz_item` → `topic` (a quiz is a knowledge check, rendered as a topic)
 * - `research_claim` → `claim`
 * - `note` → `topic` (notes are rendered as topic-like cards)
 */
export function mapNodeType(type: KnowledgeTargetType): NodeType {
  switch (type) {
    case "research_claim":
      return "claim";
    case "topic":
    case "quiz_item":
    case "note":
      return "topic";
  }
}

/**
 * Maps a contract `GraphEdgeType` to the prototype `EdgeType` plus a
 * human-readable Chinese label for the SVG edge.
 */
export function mapEdgeType(type: GraphEdgeType): {
  type: EdgeType;
  label: string;
} {
  switch (type) {
    case "topic_dependency":
      return { label: "先修", type: "prerequisite" };
    case "source":
      return { label: "来源", type: "evidence_for" };
    case "definition":
      return { label: "定义", type: "derives_from" };
    case "support":
      return { label: "支持", type: "supports" };
    case "contradiction":
      return { label: "矛盾", type: "contradicts" };
    case "example":
      return { label: "示例", type: "leads_to" };
    case "derivation":
      return { label: "推导", type: "derives_from" };
  }
}

/**
 * Maps a `GraphTruncationReason` to a human-readable Chinese explanation so
 * the user understands *why* the bounded view was truncated (not just that it
 * was).
 */
export function truncationReasonLabel(reason: GraphTruncationReason): string {
  switch (reason) {
    case "node_limit":
      return "节点数达到服务端上限";
    case "edge_limit":
      return "边数达到服务端上限";
    case "row_limit":
      return "结果行数达到查询上限";
    case "byte_limit":
      return "响应体达到字节上限";
    case "time_limit":
      return "查询时间达到上限";
  }
}

/* ---- Graph meta (truncation / limits / cursor) -------------------------- */

/**
 * Structured metadata extracted from the API response. The graph component
 * renders this so truncation, limits and pagination state are fully visible —
 * never silently dropped.
 */
export interface GraphMeta {
  depth: number;
  limits: KnowledgeGraphLimits;
  nextCursor: string | null;
  truncated: boolean;
  truncationReasons: readonly GraphTruncationReason[];
}

/* ---- Main mapper: KnowledgeGraphResponse → KsData + meta ---------------- */

/**
 * Maps a full `KnowledgeGraphResponse` from the server-authorised bounded
 * graph endpoint into the `KsData` ViewModel consumed by
 * `KnowledgeSpaceGraph`, plus a `GraphMeta` for truncation/limits display.
 *
 * - Nodes are mapped with their contract type → prototype NodeType. The root
 *   node gets a "根节点" tag so it is visually identifiable. Excerpt previews
 *   are surfaced in the node description so source evidence is not lost.
 * - Edges are mapped with their contract type → prototype EdgeType + label.
 *   Edge `state: "accepted"` maps to `confirmed`.
 * - All metadata (truncated, truncation_reasons, limits, next_cursor, depth)
 *   is preserved in `GraphMeta` — nothing is silently dropped.
 */
export function mapKnowledgeGraphResponse(response: unknown): {
  data: KsData;
  meta: GraphMeta;
} {
  validateKnowledgeGraphResponse(response);
  const rootNode = response.root;

  const nodes: KsNode[] = response.nodes.map((node) => {
    const tags: string[] = [];
    const isRoot = node.id === rootNode.id && node.type === rootNode.type;
    if (isRoot) tags.push("根节点");

    const description = node.excerpt_preview?.text?.trim()
      ? node.excerpt_preview.text
      : "暂无说明";

    return {
      confirmState: "confirmed" satisfies ConfirmState,
      description,
      id: node.id,
      label: node.label,
      mastery: 0,
      tags,
      type: mapNodeType(node.type),
    };
  });

  const edges: KsEdge[] = response.edges.map((edge) => {
    const mapped = mapEdgeType(edge.type);
    return {
      id: edge.id,
      label: mapped.label,
      source: edge.source.id,
      target: edge.target.id,
      type: mapped.type,
    };
  });

  const data: KsData = {
    edges,
    messages: [],
    nodes,
    tasks: [],
    traceSteps: [],
  };

  const meta: GraphMeta = {
    depth: response.depth,
    limits: response.limits,
    nextCursor: response.next_cursor ?? null,
    truncated: response.truncated,
    truncationReasons: response.truncation_reasons,
  };

  return { data, meta };
}
