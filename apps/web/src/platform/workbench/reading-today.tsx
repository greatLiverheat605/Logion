"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { Button, List } from "./components";
import type { WorkbenchContext } from "./preferences";

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
