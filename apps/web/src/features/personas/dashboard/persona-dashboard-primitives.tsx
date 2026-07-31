import Link from "next/link";
import { type ReactNode } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import { ProductMetric, ProductTag } from "@/components/product/product-ui";

import {
  type PersonaDashboardAction,
  type PersonaDashboardMetric,
  type PersonaDashboardModel,
  type PersonaDashboardStep,
} from "./persona-dashboard-model";

export interface DashboardEntry {
  description: string;
  href: string;
  icon: AppIconName;
  label: string;
}

export function PersonaDashboardHeader({
  controls,
  model,
  personaName,
  stale,
}: {
  controls: ReactNode;
  model: PersonaDashboardModel;
  personaName: string;
  stale: boolean;
}) {
  return (
    <header className="persona-dashboard-header">
      <div>
        <p className="product-eyebrow">{model.eyebrow}</p>
        <h2>{model.title}</h2>
        <p>{model.description}</p>
      </div>
      <div className="persona-dashboard-controls">
        <ProductTag tone={stale ? "warn" : "info"}>
          {stale ? "本机数据待同步" : `当前画像 · ${personaName}`}
        </ProductTag>
        {controls}
      </div>
    </header>
  );
}

export function PersonaDashboardMetrics({
  metrics,
}: {
  metrics: readonly PersonaDashboardMetric[];
}) {
  return (
    <div className="persona-dashboard-metrics">
      {metrics.map((metric) => (
        <ProductMetric
          detail={`${metric.detail} · 来源：${metric.source}`}
          key={metric.label}
          label={metric.label}
          tone={metric.tone}
          value={metric.value}
        />
      ))}
    </div>
  );
}

export function PersonaDashboardPrimaryAction({
  action,
}: {
  action: PersonaDashboardAction;
}) {
  return (
    <section className="persona-dashboard-action">
      <div>
        <p className="product-eyebrow">NEXT ACTION</p>
        <h3>{action.title}</h3>
        <p>{action.description}</p>
      </div>
      <Link className="product-action-link primary" href={action.href}>
        {action.label}
      </Link>
    </section>
  );
}

export function PersonaDashboardSteps({
  empty,
  steps,
}: {
  empty: boolean;
  steps: readonly PersonaDashboardStep[];
}) {
  return (
    <ol
      aria-label={empty ? "画像首页空态操作顺序" : "画像工作流状态"}
      className="persona-dashboard-steps"
    >
      {steps.map((step, index) => (
        <li className={step.complete ? "complete" : "pending"} key={step.label}>
          <span aria-hidden="true">{step.complete ? "✓" : index + 1}</span>
          <Link href={step.href}>{step.label}</Link>
        </li>
      ))}
    </ol>
  );
}

export function PersonaDashboardNavigation({
  entries,
  label,
}: {
  entries: readonly DashboardEntry[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="persona-dashboard-navigation">
      {entries.map((entry) => (
        <Link href={entry.href} key={entry.href}>
          <span aria-hidden="true">
            <AppIcon name={entry.icon} size={18} />
          </span>
          <span>
            <strong>{entry.label}</strong>
            <small>{entry.description}</small>
          </span>
        </Link>
      ))}
    </nav>
  );
}
