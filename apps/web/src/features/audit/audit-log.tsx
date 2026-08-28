"use client";

import type { components } from "@logion/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import { LogionApiError } from "@/lib/api/client";

import styles from "./audit-workbench.module.css";
import { useAuditController } from "./use-audit-controller";

type AuditEvent = components["schemas"]["AuditEventResponse"];
type AuditPage = components["schemas"]["AuditEventPageResponse"];
export type AuditResultFilter = "all" | "success" | "other";
type LoadState = "loading" | "ready" | "error";

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

    return [
      event.event_type,
      event.result,
      event.target_type,
      event.target_id ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}

function eventTone(event: AuditEvent): "good" | "warn" {
  return event.result.toLocaleLowerCase() === "success" ? "good" : "warn";
}

function errorMessage(error: unknown): string {
  return error instanceof LogionApiError
    ? `读取失败（请求编号：${error.requestId}）`
    : "读取失败，请稍后重试。";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function AuditLog() {
  const { request } = useAuditController();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("正在读取审计记录…");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>("all");
  const [targetType, setTargetType] = useState("all");
  const requestVersion = useRef(0);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      const version = ++requestVersion.current;
      setLoadState("loading");
      const query: Record<string, string> = { page_size: "50" };
      if (cursor) query.cursor = cursor;
      if (resultFilter === "success") query.result = "success";

      try {
        const result = await request<AuditPage>(
          "/api/v1/audit/me",
          { query },
        );
        if (version !== requestVersion.current) return;
        const pageEvents = Array.isArray(result.events) ? result.events : [];
        setEvents((current) =>
          append ? [...current, ...pageEvents] : pageEvents,
        );
        setNextCursor(result.next_cursor ?? null);
        setSelectedId((current) =>
          append
            ? current ?? pageEvents[0]?.id ?? null
            : pageEvents[0]?.id ?? null,
        );
        setStatus("审计记录已更新。");
        setLoadState("ready");
      } catch (error) {
        if (version !== requestVersion.current) return;
        setStatus(errorMessage(error));
        setLoadState("error");
      }
    },
    [request, resultFilter],
  );

  useEffect(() => {
    queueMicrotask(() => void load(null, false));
  }, [load]);

  const targetTypes = useMemo(
    () =>
      [...new Set(events.map((event) => event.target_type))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [events],
  );
  const filteredEvents = useMemo(
    () => filterAuditEvents(events, query, resultFilter, targetType),
    [events, query, resultFilter, targetType],
  );
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedId) ??
    filteredEvents[0] ??
    null;
  const successfulEvents = events.filter(
    (event) => event.result.toLocaleLowerCase() === "success",
  ).length;
  const otherEvents = events.length - successfulEvents;
  const hasActiveFilters =
    query.trim().length > 0 || resultFilter !== "all" || targetType !== "all";
  const primaryAction = hasActiveFilters ? (
    <button
      className={styles.primaryButton}
      data-testid="audit-clear-filters"
      type="button"
      onClick={() => {
        setQuery("");
        setResultFilter("all");
        setTargetType("all");
      }}
    >
      清除筛选
    </button>
  ) : nextCursor ? (
    <button
      className={styles.primaryButton}
      type="button"
      onClick={() => void load(nextCursor, true)}
    >
      加载更多
    </button>
  ) : undefined;

  return (
    <main id="main-content" className={styles.root}>
      <WorkbenchFrame
        label="审计时间线工作台"
        header={
          <WorkbenchHeader
            eyebrow="AUDIT · IDENTITY ACTIVITY"
            title="审计时间线"
            description="筛选与你身份相关的活动，在当前工作区核对结果、目标和事件追踪信息。"
            actions={
              <ProductTag tone={otherEvents ? "warn" : "good"}>
                {otherEvents ? `${otherEvents} 条需留意` : "未发现异常结果"}
              </ProductTag>
            }
          />
        }
        context={
          <WorkbenchContextBar
            context={{
              permission: { label: "仅本人身份事件", tone: "good" },
              sync: { label: "只读审计流", tone: "good" },
              vault: { label: "服务器记录" },
            }}
          />
        }
        toolbar={
          <WorkbenchToolbar label="审计工具">
            <span className={styles.toolbarStatus} aria-live="polite">
              {status}
            </span>
          </WorkbenchToolbar>
        }
        masterLabel="审计筛选"
        master={
          <aside className={styles.masterPane} data-testid="audit-filters">
            <div className={styles.paneHeading}>
              <span className={styles.eyebrow}>FILTER COMMAND BAR</span>
              <strong>审计筛选</strong>
            </div>
            <label className={styles.searchField} htmlFor="audit-search">
              <AppIcon name="search" size={15} />
              <span className={styles.srOnly}>搜索事件</span>
              <input
                id="audit-search"
                type="search"
                value={query}
                placeholder="事件、结果或目标"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <fieldset className={styles.filterBlock}>
              <legend>结果</legend>
              <div
                className={styles.filterOptions}
                role="group"
                aria-label="事件结果"
              >
                {(["all", "success", "other"] as const).map((value) => (
                  <button
                    className={
                      resultFilter === value
                        ? styles.filterButtonActive
                        : styles.filterButton
                    }
                    aria-pressed={resultFilter === value}
                    key={value}
                    type="button"
                    onClick={() => setResultFilter(value)}
                  >
                    {value === "all"
                      ? "全部"
                      : value === "success"
                        ? "成功"
                        : "需留意"}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.filterBlock}>
              <legend>目标类型</legend>
              <div
                className={styles.filterOptions}
                role="group"
                aria-label="目标类型"
              >
                <button
                  className={
                    targetType === "all"
                      ? styles.filterButtonActive
                      : styles.filterButton
                  }
                  aria-pressed={targetType === "all"}
                  type="button"
                  onClick={() => setTargetType("all")}
                >
                  全部类型
                </button>
                {targetTypes.map((value) => (
                  <button
                    className={
                      targetType === value
                        ? styles.filterButtonActive
                        : styles.filterButton
                    }
                    aria-pressed={targetType === value}
                    key={value}
                    type="button"
                    onClick={() => setTargetType(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className={styles.filterHint}>
              个人审计只返回身份相关事件；筛选不会扩大权限范围。
            </div>
          </aside>
        }
        mainLabel="活动时间线"
        main={
          <div className={styles.mainPane}>
            <WorkbenchActionBar
              secondary={
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void load(null, false)}
                >
                  <AppIcon name="refresh" size={14} />
                  刷新
                </button>
              }
              primary={primaryAction}
            />
            <section className={styles.timelineSection} data-testid="audit-timeline">
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>IDENTITY EVENT STREAM</span>
                  <h2>活动时间线</h2>
                </div>
                <span className={styles.resultMeta}>
                  {filteredEvents.length} / {events.length} 条
                </span>
              </header>
              {loadState === "error" ? (
                <ProductEmptyState
                  action={
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => void load(null, false)}
                    >
                      重新读取
                    </button>
                  }
                  description={status}
                  icon="?"
                  title="审计记录暂时不可用"
                />
              ) : null}
              {loadState === "loading" && events.length === 0 ? (
                <ProductEmptyState
                  description="正在建立与你身份相关的只读时间线。"
                  icon="⌁"
                  title="正在读取审计记录"
                />
              ) : null}
              {loadState === "ready" && events.length === 0 ? (
                <ProductEmptyState
                  description="重要的登录与身份安全活动会出现在这里。"
                  icon="✓"
                  title="暂无可显示的记录"
                />
              ) : null}
              {loadState === "ready" &&
              events.length > 0 &&
              filteredEvents.length === 0 ? (
                <ProductEmptyState
                  action={
                    <button
                      className={styles.secondaryButton}
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
                  description="尝试调整关键词、事件结果或目标类型。"
                  icon="⌕"
                  title="没有符合条件的事件"
                />
              ) : null}
              {filteredEvents.length > 0 ? (
                <ol className={styles.timeline}>
                  {filteredEvents.map((event) => {
                    const tone = eventTone(event);
                    return (
                      <li key={event.id}>
                        <button
                          aria-pressed={selectedEvent?.id === event.id}
                          className={
                            selectedEvent?.id === event.id
                              ? styles.eventRowActive
                              : styles.eventRow
                          }
                          type="button"
                          onClick={() => setSelectedId(event.id)}
                        >
                          <span className={styles.eventRail} aria-hidden="true">
                            <AppIcon
                              name={tone === "good" ? "shield" : "bell"}
                              size={15}
                            />
                          </span>
                          <span className={styles.eventContent}>
                            <span className={styles.eventHead}>
                              <strong>{event.event_type}</strong>
                              <ProductTag tone={tone}>{event.result}</ProductTag>
                            </span>
                            <small>{formatDate(event.occurred_at)}</small>
                          </span>
                          <span className={styles.eventTarget}>
                            <small>{event.target_type}</small>
                            {event.target_id ? (
                              <code>{event.target_id}</code>
                            ) : (
                              <span>无目标 ID</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </section>
          </div>
        }
        inspectorLabel="事件详情"
        inspector={
          <aside className={styles.inspectorPane} data-testid="audit-event-detail">
            <InspectorSection title="事件详情">
              {selectedEvent ? (
                <dl className={styles.kvList}>
                  <div>
                    <dt>事件</dt>
                    <dd>{selectedEvent.event_type}</dd>
                  </div>
                  <div>
                    <dt>结果</dt>
                    <dd>
                      <ProductTag tone={eventTone(selectedEvent)}>
                        {selectedEvent.result}
                      </ProductTag>
                    </dd>
                  </div>
                  <div>
                    <dt>发生时间</dt>
                    <dd>{formatDate(selectedEvent.occurred_at)}</dd>
                  </div>
                  <div>
                    <dt>目标类型</dt>
                    <dd>{selectedEvent.target_type}</dd>
                  </div>
                  <div>
                    <dt>目标 ID</dt>
                    <dd>{selectedEvent.target_id ?? "无"}</dd>
                  </div>
                  <div>
                    <dt>事件 ID</dt>
                    <dd>
                      <code>{selectedEvent.id}</code>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className={styles.inspectorNotice}>
                  从时间线选择一条事件查看完整字段。
                </p>
              )}
            </InspectorSection>
            <InspectorSection title="解释与追踪">
              {selectedEvent && eventTone(selectedEvent) === "warn" ? (
                <p className={styles.stateWarn}>
                  该事件未以 success 结果完成，请核对结果、目标与事件 ID。读取失败时，API 会另外提供 request ID。
                </p>
              ) : (
                <p className={styles.muted}>
                  审计事件只读展示；事件 ID 用于定位服务器记录，不会扩大当前身份的可见范围。
                </p>
              )}
            </InspectorSection>
            <InspectorSection title="当前查询">
              <p className={styles.muted} aria-live="polite">
                {hasActiveFilters
                  ? `已筛选 ${filteredEvents.length} 条事件。`
                  : `当前显示 ${events.length} 条事件。`}
              </p>
            </InspectorSection>
          </aside>
        }
      />
    </main>
  );
}
