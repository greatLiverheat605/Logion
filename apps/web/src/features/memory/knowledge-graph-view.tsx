import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";

import { type KnowledgeGraphNode } from "./review-workbench-model";

export function KnowledgeGraphView({
  masteryByTopicId,
  nodes,
}: {
  masteryByTopicId: ReadonlyMap<string, string>;
  nodes: readonly KnowledgeGraphNode[];
}) {
  if (nodes.length === 0) {
    return (
      <ProductEmptyState
        description="新增至少一个知识点后，真实先修关系会显示在这里。"
        title="知识图谱还是空的"
      />
    );
  }

  const relationCount = nodes.reduce(
    (total, node) => total + node.dependents.length,
    0,
  );
  return (
    <div
      aria-label={`知识关系图，共 ${nodes.length} 个知识点、${relationCount} 条有效依赖`}
      className="product-knowledge-map"
      role="img"
    >
      <p className="product-muted-note">
        连线语义以文字同时呈现；关系只来自已保存的 topic_dependency。
      </p>
      <div className="product-knowledge-node-grid">
        {nodes.map((node) => (
          <article className="product-knowledge-node" key={node.id}>
            <header>
              <strong>{node.title}</strong>
              <ProductTag
                tone={masteryByTopicId.has(node.id) ? "good" : "default"}
              >
                {masteryByTopicId.get(node.id) ?? "未确认"}
              </ProductTag>
            </header>
            <p>{node.description || "暂无说明"}</p>
            <dl>
              <div>
                <dt>前置</dt>
                <dd>{node.prerequisites.join("、") || "无"}</dd>
              </div>
              <div>
                <dt>后续</dt>
                <dd>{node.dependents.join("、") || "无"}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
