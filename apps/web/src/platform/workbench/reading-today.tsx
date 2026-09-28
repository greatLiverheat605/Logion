"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { Button, List } from "./components";
import type { WorkbenchContext } from "./preferences";

import { dayString, monday, shift } from "./calendar";
import "./weekly-plan.css";

type Page = components["schemas"]["LibraryPage"];

export function ReadingToday() {
  const { context } = useWorkbench();
  return context ? (
    <TodayScope
      key={`${context.workspace_id}/${context.space_id}`}
      context={context}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}

function TodayScope({ context }: { context: WorkbenchContext }) {
  const [day, setDay] = useState(() => dayString(new Date()));
  const scope = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}`;
  const week = monday(day);
  const path = `${scope}/research/weekly`;
  const plan = useQuery({
    queryKey: ["workbench", "weekly", path, week],
    queryFn: () =>
      workbenchRequest<components["schemas"]["WeeklyPlanView"]>(path, {
        query: { week_start: week },
      }),
  });
  const before = new Date(`${shift(day, 1)}T00:00:00`).toISOString();
  const reviews = useInfiniteQuery({
    queryKey: ["workbench", "review-queue", scope, before],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<components["schemas"]["OnlineReviewPage"]>(
        `${scope}/research/review-queue`,
        {
          query: { before, ...(pageParam ? { cursor: pageParam } : {}) },
        },
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const tasks =
    plan.data?.tasks.filter((task) => task.scheduled_on === day) ?? [];
  const query = useInfiniteQuery({
    queryKey: [
      "workbench",
      "library",
      context.workspace_id,
      context.space_id,
      "list",
      "reading",
      "",
    ],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<Page>(
        `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/library/resources`,
        {
          query: {
            status: "reading",
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  return (
    <div className="wb-page wb-today-page">
      <div className="wb-page-heading">
        <div>
          <h1>今日</h1>
          <p>回到正在读的论文，把理解接着写下去。</p>
        </div>
        <Link className="wb-button" href="/review">
          阅读复习
        </Link>
      </div>
      <nav className="wb-week-navigation" aria-label="选择日期">
        <Button
          disabled={day <= "1970-01-05"}
          onClick={() => setDay(shift(day, -1))}
        >
          前一天
        </Button>
        <label>
          日期
          <input
            type="date"
            min="1970-01-05"
            max="9998-12-21"
            value={day}
            onChange={(e) => {
              if (e.target.validity.valid && e.target.value)
                setDay(e.target.value);
            }}
          />
        </label>
        <Button
          disabled={day >= "9998-12-21"}
          onClick={() => setDay(shift(day, 1))}
        >
          后一天
        </Button>
        <Button onClick={() => setDay(dayString(new Date()))}>回到今天</Button>
      </nav>
      <div className="wb-weekly-columns">
        <section className="wb-weekly-tasks" aria-label="到期复习">
          <h2>到期复习</h2>
          <p className="wb-muted">截至所选日期结束，包含此前尚未完成的复习。</p>
          {reviews.isPending && <p role="status">正在载入复习…</p>}
          {reviews.error && (
            <p role="alert">
              {errorMessage(reviews.error)}{" "}
              <Button onClick={() => void reviews.refetch()}>
                重新载入复习
              </Button>
            </p>
          )}
          {reviews.data?.pages[0]?.items.length === 0 && (
            <p>所选日期暂无到期复习。</p>
          )}
          <ul className="wb-weekly-task-list">
            {reviews.data?.pages
              .flatMap((p) => p.items)
              .map((item) => (
                <li key={item.id}>
                  <h3>{item.title}</h3>
                  <p className="wb-muted">
                    {item.kind === "reading" ? "阅读测验" : "知识点与回忆题"} ·{" "}
                    {new Date(item.next_review_at).toLocaleDateString()}
                  </p>
                  <Link
                    className="wb-button"
                    href={`/review?topic=${item.topic_id}`}
                  >
                    开始复习
                  </Link>
                </li>
              ))}
          </ul>
          {reviews.hasNextPage && (
            <Button
              disabled={reviews.isFetchingNextPage}
              onClick={() => void reviews.fetchNextPage()}
            >
              加载更多到期复习
            </Button>
          )}
        </section>
        <section className="wb-weekly-tasks" aria-label="今日阅读计划">
          <h2>今日阅读计划</h2>
          {plan.isPending && <p role="status">正在载入阅读计划…</p>}
          {plan.error && (
            <p role="alert">
              {errorMessage(plan.error)}{" "}
              <Button onClick={() => void plan.refetch()}>重新载入计划</Button>
            </p>
          )}
          {plan.isSuccess && tasks.length === 0 && (
            <p>所选日期还没有阅读计划。</p>
          )}
          <ul className="wb-weekly-task-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <h3>{task.title}</h3>
                <p className="wb-muted">
                  {task.reading_mode === "close_read" ? "精读" : "略读"} ·{" "}
                  {task.estimated_minutes} 分钟 ·{" "}
                  {task.status === "done"
                    ? "已完成"
                    : task.status === "cancelled"
                      ? "已取消"
                      : "待完成"}
                </p>
                {task.resource_id && (
                  <Link
                    className="wb-button"
                    href={`/read/${task.resource_id}`}
                  >
                    打开文献
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Link className="wb-button" href="/plan">
            安排阅读计划
          </Link>
        </section>
      </div>
      <section aria-labelledby="continue-reading-title">
        <h2 id="continue-reading-title">继续阅读</h2>
        {query.isPending && <p role="status">正在加载在读文献…</p>}
        {query.error && (
          <p role="alert">
            {errorMessage(query.error)}{" "}
            <Button onClick={() => void query.refetch()}>重新加载</Button>
          </p>
        )}
        {query.data?.pages[0]?.resources.length === 0 && (
          <div className="wb-empty">
            <p>还没有在读文献。在阅读器点击“开始阅读”，下次就能从这里继续。</p>
            <Link className="wb-button" href="/library">
              前往文献库
            </Link>
          </div>
        )}
        <List label="在读文献">
          {query.data?.pages
            .flatMap((page) => page.resources)
            .map((item) => (
              <li key={item.id} className="wb-continue-reading">
                <div>
                  <h3>{item.title}</h3>
                  <p className="wb-muted">在读 · 仅自己可见</p>
                </div>
                <Link
                  className="wb-button"
                  href={`/read/${item.id}`}
                  aria-label={`继续阅读：${item.title}`}
                >
                  继续阅读
                </Link>
              </li>
            ))}
        </List>
        {query.hasNextPage && (
          <Button
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            加载更多
          </Button>
        )}
      </section>
    </div>
  );
}
