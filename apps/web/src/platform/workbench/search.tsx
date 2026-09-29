"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import type { components } from "@logion/contracts";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { Button, Sheet } from "./components";
import "./search.css";

type Item = components["schemas"]["ResearchSearchItem"];
type Page = components["schemas"]["ResearchSearchPage"];
type Kind = Item["kind"];
export const SEARCH_LABELS: Record<Kind, string> = {
  resource: "文献",
  text: "全文",
  excerpt: "摘录",
  topic: "知识点",
  quiz: "回忆题",
};
export const normalizeSearch = (q: string) => q.normalize("NFC").trim();
function useResearchSearch(q: string, kind: Kind | "" = "") {
  const { context, pending } = useWorkbench();
  const scope = context
    ? `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/search`
    : "";
  const query = normalizeSearch(q);
  const result = useInfiniteQuery({
    queryKey: ["workbench", "research-search", scope, query, kind],
    enabled:
      Boolean(scope) && !pending && query.length >= 2 && query.length <= 120,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      workbenchRequest<Page>(scope, {
        signal,
        query: {
          q: query,
          ...(kind ? { kind } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
  return { ...result, scope, query };
}
export function searchHref(item: Item, query: string): string {
  if (item.kind === "topic")
    return item.personal
      ? `/search?${new URLSearchParams({ q: query, concept: item.id })}`
      : `/review?${new URLSearchParams({ topic: item.id })}`;
  if (item.kind === "quiz" && !item.personal)
    return `/review?${new URLSearchParams({ topic: item.topic_id! })}`;
  const params = new URLSearchParams();
  if (item.page) params.set("page", String(item.page));
  if (item.kind === "quiz") params.set("quiz", item.id);
  return `/read/${encodeURIComponent(item.resource_id!)}${params.size ? `?${params}` : ""}`;
}
function ResultText({ item }: { item: Item }) {
  return (
    <>
      <span className="wb-search-kind">
        {SEARCH_LABELS[item.kind]}
        {item.page ? ` · 第 ${item.page} 页` : ""}
      </span>
      <strong>{item.title}</strong>
      <span className="wb-search-snippet">{item.snippet}</span>
    </>
  );
}

export function ResearchSearch() {
  const { context } = useWorkbench();
  const params = useSearchParams();
  return context ? (
    <SearchScope
      key={`${context.workspace_id}/${context.space_id}/${params.get("q") ?? ""}/${params.get("kind") ?? ""}`}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}
function SearchScope() {
  const params = useSearchParams(),
    router = useRouter();
  const submitted = params.get("q") ?? "";
  const rawKind = params.get("kind") ?? "";
  const kind = Object.hasOwn(SEARCH_LABELS, rawKind) ? (rawKind as Kind) : "";
  const [input, setInput] = useState(submitted);
  const results = useResearchSearch(submitted, kind);
  const conceptId = params.get("concept");
  const concept = useQuery({
    queryKey: ["workbench", "research-concept", results.scope, conceptId],
    enabled: Boolean(conceptId && results.scope),
    queryFn: ({ signal }) =>
      workbenchRequest<components["schemas"]["ResearchSearchConcept"]>(
        `${results.scope}/concepts/${encodeURIComponent(conceptId!)}`,
        { signal },
      ),
    staleTime: 0,
  });
  function navigate(q: string, selectedKind = kind) {
    router.push(
      `/search?${new URLSearchParams({ q: normalizeSearch(q), ...(selectedKind ? { kind: selectedKind } : {}) })}`,
    );
  }
  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="wb-page wb-search-page">
      <div className="wb-page-heading">
        <div>
          <h1>搜索</h1>
          <p>在当前空间查找文献、全文、摘录、知识点和回忆题。</p>
        </div>
      </div>
      <form
        className="wb-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(input);
        }}
      >
        <label>
          关键词
          <input
            type="search"
            aria-label="搜索关键词"
            value={input}
            minLength={2}
            maxLength={120}
            required
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入至少两个字符"
          />
        </label>
        <Button type="submit" disabled={normalizeSearch(input).length < 2}>
          搜索
        </Button>
        <label>
          内容类型
          <select
            aria-label="搜索内容类型"
            value={kind}
            onChange={(e) => navigate(submitted, e.target.value as Kind | "")}
          >
            <option value="">全部</option>
            {Object.entries(SEARCH_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </form>
      {results.query.length < 2 ? (
        <p className="wb-muted">
          输入关键词后开始搜索，也可以在指令面板中直接检索。
        </p>
      ) : (
        <>
          {results.isFetching && <p role="status">正在搜索…</p>}
          {results.isError && (
            <div role="alert">
              {errorMessage(results.error)}{" "}
              <Button onClick={() => void results.refetch()}>重新搜索</Button>
            </div>
          )}
          {!results.isPending && !results.isError && items.length === 0 && (
            <p role="status">没有匹配的内容，请更换关键词。</p>
          )}
          <ul className="wb-search-results" aria-label="搜索结果">
            {items.map((item) => (
              <li key={`${item.kind}/${item.id}`}>
                <Link
                  href={searchHref(item, results.query)}
                  className="wb-search-result"
                >
                  <ResultText item={item} />
                </Link>
              </li>
            ))}
          </ul>
          {results.hasNextPage && (
            <Button
              disabled={results.isFetchingNextPage}
              onClick={() => void results.fetchNextPage()}
            >
              更多结果
            </Button>
          )}
        </>
      )}
      <Sheet
        title={concept.data?.title ?? "知识点"}
        description="查看当前有权访问的概念。"
        open={Boolean(conceptId)}
        onOpenChange={(open) => {
          if (!open) navigate(submitted);
        }}
      >
        {concept.isPending && <p role="status">正在读取知识点…</p>}
        {concept.isError && <p role="alert">{errorMessage(concept.error)}</p>}
        {concept.data && (
          <p className="wb-search-concept">
            {concept.data.description || "暂无说明。"}
          </p>
        )}
      </Sheet>
    </div>
  );
}

export function PaletteSearch({
  query,
  navigate,
}: {
  query: string;
  navigate: (href: string) => void;
}) {
  const result = useResearchSearch(query);
  if (result.query.length < 2 || result.query.length > 120) return null;
  const items = result.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Command.Group heading="当前空间的内容" forceMount>
      {result.isFetching && <p role="status">正在搜索内容…</p>}
      {result.isError && <p role="alert">{errorMessage(result.error)}</p>}
      {!result.isPending && !result.isError && !items.length && (
        <p role="status">没有匹配的内容。</p>
      )}
      {items.map((item) => (
        <Command.Item
          forceMount
          key={`${item.kind}/${item.id}`}
          value={`content:${item.kind}/${item.id}`}
          onSelect={() => navigate(searchHref(item, result.query))}
        >
          <span className="wb-search-result">
            <ResultText item={item} />
          </span>
        </Command.Item>
      ))}
      <Command.Item
        forceMount
        value="search:all"
        onSelect={() =>
          navigate(`/search?${new URLSearchParams({ q: result.query })}`)
        }
      >
        打开完整搜索结果
      </Command.Item>
    </Command.Group>
  );
}
