import { ProductEmptyState } from "@/components/product/product-ui";

import { type buildMetricComparison } from "./research-workbench-model";

type Comparison = ReturnType<typeof buildMetricComparison>;

export type ResearchEvidenceRelationKind =
  | "experiment_run"
  | "metric_record"
  | "research_claim"
  | "research_feedback";

export interface ResearchEvidenceRelation {
  id: string;
  kind: ResearchEvidenceRelationKind;
  label: string;
  relation: string;
  status: string;
}

export function ResearchEvidenceRelations({
  onSelect,
  relationships,
}: {
  onSelect: (kind: ResearchEvidenceRelationKind, id: string) => void;
  relationships: readonly ResearchEvidenceRelation[];
}) {
  if (relationships.length === 0) return null;
  return (
    <div aria-label="研究证据关系" className="product-evidence-relations">
      {relationships.map((relationship) => (
        <article key={`${relationship.kind}-${relationship.id}`}>
          <strong>{relationship.relation}</strong>
          <p>{relationship.label}</p>
          <small>{relationship.status}</small>
          <button
            aria-label={`查看${relationship.relation}详情`}
            className="product-action-link"
            type="button"
            onClick={() => onSelect(relationship.kind, relationship.id)}
          >
            查看详情
          </button>
        </article>
      ))}
    </div>
  );
}

export function ResearchExperimentComparison({
  comparison,
}: {
  comparison: Comparison;
}) {
  if (comparison.length === 0) {
    return (
      <ProductEmptyState
        description="至少两个运行记录同名、同单位指标后才能并列比较；系统不会换算不同单位。"
        title="尚无可比较指标"
      />
    );
  }
  return (
    <div className="product-experiment-comparison">
      {comparison.map((group) => (
        <section key={`${group.name}-${group.unit}`}>
          <h3>
            {group.name} {group.unit ? `(${group.unit})` : ""}
          </h3>
          <ul>
            {group.values.map((item, index) => (
              <li key={`${item.runTitle}-${index}`}>
                <span>{item.runTitle}</span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
