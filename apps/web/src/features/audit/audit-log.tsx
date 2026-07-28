"use client";

import type { components } from "@logion/contracts";
import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  ProductEmptyState,
  ProductHero,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

type AuditEvent = components["schemas"]["AuditEventResponse"];
type AuditResultFilter = "all" | "success" | "other";

export function filterAuditEvents(
  events: readonly AuditEvent[],
  query: string,
  resultFilter: AuditResultFilter,
  targetType: string,
): AuditEvent[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return events.filter((event) => {
    const isSuccessful = event.result.toLocaleLowerCase() === "success";
    if (resultFilter === "success" && !isSuccessful) return false;
    if (resultFilter === "other" && isSuccessful) return false;
    if (targetType !== "all" && event.target_type !== targetType) return false;
    if (!normalizedQuery) return true;

    return [event.event_type, event.result, event.target_type].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState("正在读取审计记录…");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>("all");
  const [targetType, setTargetType] = useState("all");

  useEffect(() => {
    queueMicrotask(
      () =>
        void browserApiClient
          .request<{ events: AuditEvent[] }>("/api/v1/audit/me")
          .then((result) => {
            setEvents(Array.isArray(result.events) ? result.events : []);
            setStatus("审计记录已更新。");
            setLoadState("ready");
          })
          .catch((error: unknown) => {
            setStatus(
              error instanceof LogionApiError
                ? `读取失败（请求编号：${error.requestId}）`
                : "读取失败。",
            );
            setLoadState("error");
          }),
    );
  }, []);

  const targetTypes = useMemo(
    () =>
      [...new Set(events.map((event) => event.target_type))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [events],
  );
  const filteredEvents = useMemo(
    () => filterAuditEvents(events, query, resultFilter, targetType),
    [events, query, resultFilter, targetType],
  );
  const successfulEvents = events.filter(
    (event) => event.result.toLocaleLowerCase() === "success",
  ).length;
  const otherEvents = events.length - successfulEvents;
  const latestEvent = events[0];
  const hasActiveFilters =
    query.trim().length > 0 || resultFilter !== "all" || targetType !== "all";

  return (
    <main id="main-content" className="settings-page">
      <ProductPageHeader
        eyebrow="AUDIT · IDENTITY ACTIVITY"
        title="把安全事件变成可筛选、可解释的时间线"
        description={
          <>
            <p>默认展示人能读懂的事件摘要；原始对象类型和结果仍可展开核对。</p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
      />
      <ProductHero
        badge={
          <ProductTag tone={otherEvents ? "warn" : "good"}>
            {otherEvents ? `${otherEvents} 条需留意` : "未发现异常结果"}
          </ProductTag>
        }
        title={
          latestEvent
            ? `最近活动：${latestEvent.event_type}`
            : "等待第一条身份活动记录"
        }
        progressLabel="成功事件占比"
        progressValue={
          events.length ? (successfulEvents / events.length) * 100 : 0
        }
      >
        审计页只展示与你身份相关的最小必要记录，便于核对时间、结果和目标类型。
      </ProductHero>
      <div className="product-metric-grid product-metric-grid-compact">
        <ProductMetric
          label="全部事件"
          value={events.length}
          detail="当前可见范围"
          tone="info"
        />
        <ProductMetric
          label="成功"
          value={successfulEvents}
          detail="正常完成"
          tone="good"
        />
        <ProductMetric
          label="其他结果"
          value={otherEvents}
          detail="建议逐项核对"
          tone={otherEvents ? "warn" : "default"}
        />
      </div>
      <section
        className="product-toolbar product-audit-toolbar"
        aria-label="审计记录筛选"
      >
        <label className="product-search-field" htmlFor="audit-search">
          <AppIcon name="search" size={17} />
          <input
            id="audit-search"
            type="search"
            value={query}
            placeholder="搜索事件、结果或目标类型"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="product-segmented" aria-label="事件结果" role="group">
          {(
            [
              ["all", "全部"],
              ["success", "成功"],
              ["other", "其他"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={resultFilter === value}
              className={resultFilter === value ? "active" : ""}
              key={value}
              type="button"
              onClick={() => setResultFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="product-filter-field" htmlFor="audit-target-type">
          <span>目标类型</span>
          <span className="product-filter-select">
            <select
              id="audit-target-type"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
            >
              <option value="all">全部类型</option>
              {targetTypes.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
            <AppIcon name="chevron-down" size={15} />
          </span>
        </label>
      </section>
      <ProductPanel
        title="我的身份活动"
        description={
          hasActiveFilters
            ? `已从 ${events.length} 条事件中筛选出 ${filteredEvents.length} 条。`
            : "按服务器返回顺序展示事件类型、时间、结果与目标。"
        }
        aside={
          <ProductTag tone={hasActiveFilters ? "info" : "default"}>
            {filteredEvents.length} / {events.length} 条
          </ProductTag>
        }
      >
        <ol className="product-audit-timeline">
          {filteredEvents.map((event) => {
            const isSuccessful = event.result.toLocaleLowerCase() === "success";
            return (
              <li
                key={event.id}
                className={isSuccessful ? "is-success" : "is-attention"}
              >
                <span className="product-audit-marker" aria-hidden="true">
                  <AppIcon name={isSuccessful ? "shield" : "bell"} size={16} />
                </span>
                <span className="product-audit-event-copy">
                  <span className="product-audit-event-head">
                    <strong>{event.event_type}</strong>
                    <ProductTag tone={isSuccessful ? "good" : "warn"}>
                      {event.result}
                    </ProductTag>
                  </span>
                  <small>{new Date(event.occurred_at).toLocaleString()}</small>
                </span>
                <span className="product-audit-target">
                  <small>目标类型</small>
                  <code>{event.target_type}</code>
                </span>
              </li>
            );
          })}
        </ol>
        {loadState === "loading" ? (
          <ProductEmptyState
            icon="⌁"
            title="正在读取审计记录"
            description="正在建立与你身份相关的安全活动时间线。"
          />
        ) : null}
        {loadState === "error" ? (
          <ProductEmptyState
            icon="?"
            title="暂时无法读取审计记录"
            description={status}
          />
        ) : null}
        {loadState === "ready" && events.length === 0 ? (
          <ProductEmptyState
            icon="✓"
            title="暂无可显示的记录"
            description="重要的登录与身份安全活动会出现在这里。"
          />
        ) : null}
        {loadState === "ready" &&
        events.length > 0 &&
        filteredEvents.length === 0 ? (
          <ProductEmptyState
            icon="⌕"
            title="没有符合条件的事件"
            description="尝试调整关键词、事件结果或目标类型。"
            action={
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setQuery("");
                  setResultFilter("all");
                  setTargetType("all");
                }}
              >
                清除筛选
              </button>
            }
          />
        ) : null}
      </ProductPanel>
    </main>
  );
}
