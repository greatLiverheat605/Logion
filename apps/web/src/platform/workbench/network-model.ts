import type { components } from "@logion/contracts";

export type Network = components["schemas"]["NetworkSnapshot"];
export type NetworkNode = components["schemas"]["NetworkNode"];
export type NetworkEdge = components["schemas"]["EdgeView"];
export const NODE_LABELS = {
  question: "研究问题",
  resource: "文献",
  topic: "概念",
  claim: "论断",
  idea: "私人想法",
} as const;
export const RELATION_LABELS = {
  addresses: "回应",
  defines: "定义",
  uses: "使用",
  extends: "扩展",
  contradicts: "反驳",
  supersedes: "取代",
  supports: "支持",
  challenges: "质疑",
  inspired_by: "启发于",
} as const;
export const RELATIONS: Record<string, NetworkEdge["relation"][]> = {
  "resource/question": ["addresses"],
  "resource/topic": ["defines", "uses"],
  "resource/resource": ["extends", "contradicts", "supersedes"],
  "claim/question": ["supports", "challenges"],
  "idea/resource": ["inspired_by"],
};
export const nodeKey = (node: Pick<NetworkNode, "kind" | "id">) =>
  `${node.kind}/${node.id}`;
export function networkHit(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const { x1, y1, x2, y2 } = networkLine(from, to);
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const x = ((y2 - y1) / length) * 9,
    y = ((x2 - x1) / length) * 9;
  return `M${x1 + x} ${y1 - y}L${x2 + x} ${y2 - y}L${x2 - x} ${y2 + y}L${x1 - x} ${y1 + y}Z`;
}
export function networkLayout(nodes: NetworkNode[]) {
  const columns = Math.min(
    4,
    Math.max(
      1,
      ...Object.keys(NODE_LABELS).map(
        (kind) => nodes.filter((n) => n.kind === kind).length,
      ),
    ),
  );
  const positions = new Map<string, { x: number; y: number }>();
  let top = 50;
  for (const kind of Object.keys(NODE_LABELS)) {
    const group = nodes.filter((node) => node.kind === kind);
    group.forEach((node, index) =>
      positions.set(nodeKey(node), {
        x: 125 + (index % 4) * 250,
        y: top + Math.floor(index / 4) * 100,
      }),
    );
    if (group.length) top += Math.ceil(group.length / 4) * 100 + 40;
  }
  return { positions, width: columns * 250, height: Math.max(400, top) };
}

export function networkLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const ratio = Math.min(
    dx ? 116 / Math.abs(dx) : Infinity,
    dy ? 32 / Math.abs(dy) : Infinity,
    0.45,
  );
  return {
    x1: from.x + dx * ratio,
    y1: from.y + dy * ratio,
    x2: to.x - dx * ratio,
    y2: to.y - dy * ratio,
  };
}
