import { ProductEmptyState } from "@/components/product/product-ui";

import { type buildMetricComparison } from "./research-workbench-model";

type Comparison = ReturnType<typeof buildMetricComparison>;

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
