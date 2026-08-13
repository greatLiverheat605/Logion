import { describe, expect, it } from "vitest";

import {
  KnowledgeGraphResponseError,
  clampDepth,
  mapEdgeType,
  mapKnowledgeGraphResponse,
  mapNodeType,
  truncationReasonLabel,
} from "@/features/desk/knowledge-graph-api";
import type { KnowledgeGraphResponse } from "@/features/desk/knowledge-graph-api";

const ROOT_ID = "00000000-0000-4000-8000-000000000001";
const NODE_2_ID = "00000000-0000-4000-8000-000000000002";
const NODE_3_ID = "00000000-0000-4000-8000-000000000003";
const EDGE_1_ID = "00000000-0000-4000-8000-000000000101";
const EDGE_2_ID = "00000000-0000-4000-8000-000000000102";

function makeNode(
  id: string,
  label: string,
  type: KnowledgeGraphResponse["nodes"][number]["type"],
  excerpt?: string,
): KnowledgeGraphResponse["nodes"][number] {
  return {
    excerpt_preview: excerpt
      ? {
          excerpt_id: "00000000-0000-4000-8000-000000000201",
          stale: false,
          text: excerpt,
        }
      : null,
    id,
    label,
    type,
    version: 1,
  };
}

function makeEdge(
  id: string,
  sourceId: string,
  targetId: string,
  type: KnowledgeGraphResponse["edges"][number]["type"],
): KnowledgeGraphResponse["edges"][number] {
  return {
    id,
    source: { id: sourceId, type: "topic" },
    state: "accepted",
    target: { id: targetId, type: "topic" },
    type,
  };
}

function makeResponse(
  overrides: Partial<KnowledgeGraphResponse> = {},
): KnowledgeGraphResponse {
  return {
    depth: 1,
    edges: [],
    limits: { bytes: 1048576, edges: 400, nodes: 150 },
    next_cursor: null,
    nodes: [],
    root: { id: ROOT_ID, type: "topic" },
    truncated: false,
    truncation_reasons: [],
    ...overrides,
  };
}

describe("clampDepth", () => {
  it("clamps to 1 for values < 1", () => {
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(-5)).toBe(1);
  });
  it("returns 1 for depth 1", () => {
    expect(clampDepth(1)).toBe(1);
  });
  it("returns 2 for depth 2", () => {
    expect(clampDepth(2)).toBe(2);
  });
  it("clamps to 2 for values > 2", () => {
    expect(clampDepth(3)).toBe(2);
    expect(clampDepth(10)).toBe(2);
  });
});

describe("mapNodeType", () => {
  it("maps topic → topic", () => {
    expect(mapNodeType("topic")).toBe("topic");
  });
  it("maps quiz_item → topic", () => {
    expect(mapNodeType("quiz_item")).toBe("topic");
  });
  it("maps note → topic", () => {
    expect(mapNodeType("note")).toBe("topic");
  });
  it("maps research_claim → claim", () => {
    expect(mapNodeType("research_claim")).toBe("claim");
  });
});

describe("mapEdgeType", () => {
  it("maps topic_dependency → prerequisite / 先修", () => {
    expect(mapEdgeType("topic_dependency")).toEqual({
      label: "先修",
      type: "prerequisite",
    });
  });
  it("maps support → supports / 支持", () => {
    expect(mapEdgeType("support")).toEqual({
      label: "支持",
      type: "supports",
    });
  });
  it("maps contradiction → contradicts / 矛盾", () => {
    expect(mapEdgeType("contradiction")).toEqual({
      label: "矛盾",
      type: "contradicts",
    });
  });
  it("maps all edge types without crashing", () => {
    const types = [
      "topic_dependency",
      "source",
      "definition",
      "support",
      "contradiction",
      "example",
      "derivation",
    ] as const;
    for (const type of types) {
      const result = mapEdgeType(type);
      expect(result.label).toBeTruthy();
      expect(result.type).toBeTruthy();
    }
  });
});

describe("truncationReasonLabel", () => {
  it("returns a Chinese label for each reason", () => {
    expect(truncationReasonLabel("node_limit")).toContain("节点");
    expect(truncationReasonLabel("edge_limit")).toContain("边");
    expect(truncationReasonLabel("row_limit")).toContain("行");
    expect(truncationReasonLabel("byte_limit")).toContain("字节");
    expect(truncationReasonLabel("time_limit")).toContain("时间");
  });
});

describe("mapKnowledgeGraphResponse", () => {
  it("maps a minimal response with no nodes/edges", () => {
    const { data, meta } = mapKnowledgeGraphResponse(makeResponse());
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.messages).toEqual([]);
    expect(data.traceSteps).toEqual([]);
    expect(meta.truncated).toBe(false);
    expect(meta.nextCursor).toBeNull();
    expect(meta.depth).toBe(1);
    expect(meta.limits.nodes).toBe(150);
    expect(meta.limits.edges).toBe(400);
  });

  it("maps nodes with correct types and root tag", () => {
    const response = makeResponse({
      nodes: [
        makeNode(ROOT_ID, "根知识点", "topic"),
        makeNode(NODE_2_ID, "研究声明", "research_claim"),
        makeNode(NODE_3_ID, "笔记", "note"),
      ],
    });
    const { data } = mapKnowledgeGraphResponse(response);
    expect(data.nodes).toHaveLength(3);
    // Root node gets "根节点" tag.
    expect(data.nodes[0]!.tags).toContain("根节点");
    expect(data.nodes[0]!.type).toBe("topic");
    // research_claim → claim.
    expect(data.nodes[1]!.type).toBe("claim");
    expect(data.nodes[1]!.tags).not.toContain("根节点");
    // note → topic.
    expect(data.nodes[2]!.type).toBe("topic");
  });

  it("surfaces excerpt_preview text into node description", () => {
    const response = makeResponse({
      nodes: [makeNode(ROOT_ID, "来源节点", "topic", "这是来源摘录文本")],
    });
    const { data } = mapKnowledgeGraphResponse(response);
    expect(data.nodes[0]!.description).toBe("这是来源摘录文本");
  });

  it("uses default description when excerpt_preview is absent or empty", () => {
    const response = makeResponse({
      nodes: [makeNode(ROOT_ID, "无摘录节点", "topic")],
    });
    const { data } = mapKnowledgeGraphResponse(response);
    expect(data.nodes[0]!.description).toBe("暂无说明");
  });

  it("maps edges with correct types and labels", () => {
    const response = makeResponse({
      nodes: [
        makeNode(ROOT_ID, "根", "topic"),
        makeNode(NODE_2_ID, "子", "topic"),
      ],
      edges: [
        makeEdge(EDGE_1_ID, ROOT_ID, NODE_2_ID, "topic_dependency"),
        makeEdge(EDGE_2_ID, NODE_2_ID, ROOT_ID, "support"),
      ],
    });
    const { data } = mapKnowledgeGraphResponse(response);
    expect(data.edges).toHaveLength(2);
    expect(data.edges[0]!.type).toBe("prerequisite");
    expect(data.edges[0]!.label).toBe("先修");
    expect(data.edges[1]!.type).toBe("supports");
    expect(data.edges[1]!.label).toBe("支持");
  });

  it("preserves truncation metadata", () => {
    const response = makeResponse({
      truncated: true,
      truncation_reasons: ["node_limit", "edge_limit"],
      next_cursor: "cursor-abc",
      depth: 2,
    });
    const { meta } = mapKnowledgeGraphResponse(response);
    expect(meta.truncated).toBe(true);
    expect(meta.truncationReasons).toEqual(["node_limit", "edge_limit"]);
    expect(meta.nextCursor).toBe("cursor-abc");
    expect(meta.depth).toBe(2);
  });

  it("preserves server-defined limits", () => {
    const response = makeResponse({
      limits: { bytes: 524288, edges: 200, nodes: 75 },
    });
    const { meta } = mapKnowledgeGraphResponse(response);
    expect(meta.limits.nodes).toBe(75);
    expect(meta.limits.edges).toBe(200);
    expect(meta.limits.bytes).toBe(524288);
  });

  it("fails closed when the response exceeds the node hard limit", () => {
    const nodes = Array.from({ length: 151 }, (_, index) =>
      makeNode(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        `节点 ${index + 1}`,
        "topic",
      ),
    );
    expect(() => mapKnowledgeGraphResponse(makeResponse({ nodes }))).toThrow(
      KnowledgeGraphResponseError,
    );
  });

  it("fails closed on dangling edges", () => {
    const response = makeResponse({
      nodes: [makeNode(ROOT_ID, "根", "topic")],
      edges: [
        makeEdge(
          EDGE_1_ID,
          ROOT_ID,
          "00000000-0000-4000-8000-000000000999",
          "support",
        ),
      ],
    });
    expect(() => mapKnowledgeGraphResponse(response)).toThrow(
      KnowledgeGraphResponseError,
    );
  });

  it("fails closed on inconsistent truncation metadata", () => {
    expect(() =>
      mapKnowledgeGraphResponse(
        makeResponse({ truncated: true, truncation_reasons: [] }),
      ),
    ).toThrow(KnowledgeGraphResponseError);
  });

  it("fails closed on duplicate node ids", () => {
    const duplicate = makeNode(ROOT_ID, "重复", "topic");
    expect(() =>
      mapKnowledgeGraphResponse(
        makeResponse({ nodes: [duplicate, { ...duplicate }] }),
      ),
    ).toThrow(KnowledgeGraphResponseError);
  });

  it("fails closed when parsed response content exceeds 1 MiB", () => {
    const response = {
      ...makeResponse(),
      padding: "x".repeat(1_048_576),
    };
    expect(
      new TextEncoder().encode(JSON.stringify(response)).byteLength,
    ).toBeGreaterThan(1_048_576);
    expect(() => mapKnowledgeGraphResponse(response)).toThrow(
      KnowledgeGraphResponseError,
    );
  });

  it("fails closed on contract fields that the renderer does not understand", () => {
    const response = {
      ...makeResponse(),
      root: { ...makeResponse().root, private_detail: "must not render" },
    };
    expect(() => mapKnowledgeGraphResponse(response)).toThrow(
      KnowledgeGraphResponseError,
    );
  });

  it("fails closed on a cursor longer than the server contract", () => {
    expect(() =>
      mapKnowledgeGraphResponse(
        makeResponse({
          next_cursor: "x".repeat(1025),
          truncated: true,
          truncation_reasons: ["row_limit"],
        }),
      ),
    ).toThrow(KnowledgeGraphResponseError);
  });
});
