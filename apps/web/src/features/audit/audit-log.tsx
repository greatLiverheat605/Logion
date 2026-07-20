"use client";

import type { components } from "@logion/contracts";
import { useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type AuditEvent = components["schemas"]["AuditEventResponse"];

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState("正在读取审计记录…");
  useEffect(() => {
    queueMicrotask(
      () =>
        void browserApiClient
          .request<{ events: AuditEvent[] }>("/api/v1/audit/me")
          .then((result) => {
            setEvents(Array.isArray(result.events) ? result.events : []);
            setStatus("审计记录已更新。");
          })
          .catch((error: unknown) =>
            setStatus(
              error instanceof LogionApiError
                ? `读取失败（请求编号：${error.requestId}）`
                : "读取失败。",
            ),
          ),
    );
  }, []);
  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · AUDIT</p>
        <h1>安全审计</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <h2>我的身份活动</h2>
        <ul className="item-list">
          {events.map((event) => (
            <li key={event.id}>
              <span>
                <strong>{event.event_type}</strong>
                <small>
                  {new Date(event.occurred_at).toLocaleString()} ·{" "}
                  {event.result}
                </small>
              </span>
              <code>{event.target_type}</code>
            </li>
          ))}
        </ul>
        {events.length === 0 ? <p>暂无可显示的记录。</p> : null}
      </section>
    </main>
  );
}
