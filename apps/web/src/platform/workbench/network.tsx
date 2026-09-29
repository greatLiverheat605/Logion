"use client";

import "./network.css";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { Button, Inspector, Segmented, Sheet } from "./components";
import { errorMessage, workbenchRequest } from "./api";
import { useWorkbench } from "./provider";
import { readingAiError } from "./reading-ai";
import {
  NODE_LABELS,
  RELATION_LABELS,
  RELATIONS,
  networkLayout,
  networkLine,
  networkHit,
  nodeKey,
  type Network,
  type NetworkNode,
  type NetworkEdge,
} from "./network-model";

const phoneQuery = "(max-width: 767px)";
const subscribePhone = (update: () => void) => {
  const media = window.matchMedia(phoneQuery);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
};
const isPhone = () => window.matchMedia(phoneQuery).matches;

type Run = components["schemas"]["AIRunResponse"];
type Draft = components["schemas"]["AIOutputDraftResponse"];

export function KnowledgeNetwork() {
  const { context } = useWorkbench();
  const params = useSearchParams();
  const router = useRouter();
  if (!context) return <p>请先选择空间。</p>;
  const scope = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}`;
  return (
    <div className="wb-page wb-network-page">
      <div className="wb-page-heading">
        <div>
          <h1>知识网</h1>
          <p>围绕研究问题整理证据，每一条连线由你确认。</p>
        </div>
      </div>
      <NetworkScope
        key={scope}
        scope={scope}
        workspaceId={context.workspace_id}
        focusType={params.get("question") ? "question" : undefined}
        focusId={params.get("question") ?? undefined}
        onFocus={(id) =>
          router.push(
            id ? `/graph?question=${encodeURIComponent(id)}` : "/graph",
          )
        }
      />
    </div>
  );
}

export function NetworkScope({
  scope,
  workspaceId,
  focusType,
  focusId,
  onFocus,
  compact = false,
}: {
  scope: string;
  workspaceId: string;
  focusType?: "question" | "resource";
  focusId?: string;
  onFocus?: (id: string) => void;
  compact?: boolean;
}) {
  const client = useQueryClient();
  const readOnly = useSyncExternalStore(subscribePhone, isPhone, () => true);
  const [selection, select] = useState<string | null>(null);
  const [editor, setEditor] = useState<"manual" | "ai" | null>(null);
  if (readOnly && editor) setEditor(null);
  const [runId, setRunId] = useState<string | null>(null);
  const path = `${scope}/research/knowledge`;
  const key = ["workbench", "network", path];
  const query = useQuery({
    queryKey: [...key, focusType, focusId],
    queryFn: () =>
      workbenchRequest<Network>(`${path}/graph`, {
        query:
          focusType && focusId
            ? { focus_type: focusType, focus_id: focusId }
            : {},
      }),
  });
  const questions = useInfiniteQuery({
    queryKey: ["workbench", "questions", `${scope}/research/question-tree`],
    enabled: Boolean(onFocus),
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<components["schemas"]["QuestionPage"]>(
        `${scope}/research/question-tree`,
        { query: pageParam ? { cursor: pageParam } : {} },
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const network = query.data;
  const catalog = useQuery({
    queryKey: [...key, undefined, undefined],
    enabled: editor !== null,
    queryFn: () => workbenchRequest<Network>(`${path}/graph`),
  });
  const candidates = [
    ...new Map(
      [...(catalog.data?.nodes ?? []), ...(network?.nodes ?? [])].map((n) => [
        nodeKey(n),
        n,
      ]),
    ).values(),
  ];
  const node = network?.nodes.find((item) => nodeKey(item) === selection);
  const edge = network?.edges.find((item) => item.id === selection);
  const lookup = useMemo(
    () => new Map(network?.nodes.map((n) => [nodeKey(n), n]) ?? []),
    [network],
  );
  const label = (kind: string, id: string) =>
    lookup.get(`${kind}/${id}`)?.title ?? "内容已更新";
  const decision = useMutation({
    mutationFn: ({
      edge,
      status,
    }: {
      edge: NetworkEdge;
      status: "confirmed" | "rejected";
    }) =>
      workbenchRequest(`${path}/edges/${edge.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ status, expected_version: edge.version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
      select(null);
    },
  });
  return (
    <section
      className={`wb-network${compact ? " wb-network-compact" : ""}`}
      aria-label={compact ? "知识网局部" : "私人知识网"}
    >
      <div className="wb-research-actions">
        {onFocus && (
          <label>
            聚焦研究问题
            <select
              aria-label="聚焦研究问题"
              value={focusId ?? ""}
              onChange={(e) => {
                select(null);
                onFocus(e.target.value);
              }}
            >
              <option value="">全部</option>
              {focusId &&
                !questions.data?.pages.some((p) =>
                  p.questions.some((q) => q.id === focusId),
                ) && (
                  <option value={focusId}>
                    {network?.nodes.find((n) => n.id === focusId)?.title ??
                      "当前问题"}
                  </option>
                )}
              {questions.data?.pages
                .flatMap((p) => p.questions)
                .map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.question}
                  </option>
                ))}
            </select>
          </label>
        )}
        {questions.hasNextPage && (
          <Button
            disabled={questions.isFetchingNextPage}
            onClick={() => void questions.fetchNextPage()}
          >
            载入更多问题
          </Button>
        )}
        {!readOnly && (
          <Button
            disabled={!network?.nodes.length}
            onClick={() => setEditor("manual")}
          >
            手动连线
          </Button>
        )}
        {!readOnly && (
          <Button
            disabled={!network?.nodes.length}
            onClick={() => setEditor("ai")}
          >
            AI 建议连线
          </Button>
        )}
        <Button
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新知识网
        </Button>
      </div>
      {readOnly && (
        <p className="wb-muted">手机端仅供查看，建立和确认连线请使用电脑。</p>
      )}
      <p className="wb-network-legend">
        <span>实线 · 已确认</span>
        <span>虚线 · AI 建议</span>
        <span>私人想法 · 仅自己可见，AI 不可读</span>
      </p>
      {(query.error || questions.error || decision.error) && (
        <p role="alert">
          {errorMessage(query.error ?? questions.error ?? decision.error)}
        </p>
      )}
      {query.isPending && <p role="status">正在载入知识网…</p>}
      {runId && (
        <NetworkRun workspaceId={workspaceId} runId={runId} path={path} />
      )}
      {network && (
        <>
          {network.truncated && (
            <p role="status">
              当前显示最多 200 个节点、400 条连线，请聚焦问题查看局部关系。
            </p>
          )}
          {!network.nodes.length ? (
            <div className="wb-empty">
              <h2>知识网还没有内容</h2>
              <p>先添加研究问题、文献或概念，再建立联系。</p>
              <Link href="/questions">添加研究问题</Link>
            </div>
          ) : (
            <div className="wb-network-columns">
              <NetworkCanvas
                network={network}
                selection={selection}
                onSelect={(value) => {
                  decision.reset();
                  select(value);
                }}
                compact={compact}
              />
              <Inspector title="知识网详情">
                {edge ? (
                  <>
                    <span className="wb-research-status">
                      {edge.status === "suggested"
                        ? "AI 建议 · 尚未确认"
                        : "本人已确认"}
                    </span>
                    <h3>{label(edge.from_type, edge.from_id)}</h3>
                    <p>
                      {RELATION_LABELS[edge.relation]} →{" "}
                      {label(edge.to_type, edge.to_id)}
                    </p>
                    <p className="wb-research-body">
                      {edge.reason || "本人手动建立的连线。"}
                    </p>
                    {edge.origin === "ai" && (
                      <p className="wb-muted">AI 建议需要结合原文核实。</p>
                    )}
                    {!readOnly && (
                      <div className="wb-research-actions">
                        {edge.status === "suggested" && (
                          <Button
                            disabled={decision.isPending}
                            onClick={() =>
                              decision.mutate({ edge, status: "confirmed" })
                            }
                          >
                            确认连线
                          </Button>
                        )}
                        <Button
                          disabled={decision.isPending}
                          onClick={() =>
                            decision.mutate({ edge, status: "rejected" })
                          }
                        >
                          拒绝连线
                        </Button>
                      </div>
                    )}
                    {!readOnly && (
                      <p className="wb-muted">
                        拒绝后隐藏，之后不再建议这条关系。
                      </p>
                    )}
                  </>
                ) : node ? (
                  <>
                    <span className="wb-research-status">
                      {NODE_LABELS[node.kind]}
                    </span>
                    <h3>{node.title}</h3>
                    {node.kind === "idea" && (
                      <p>仅自己可见，AI 不可读。只能手动建立连线。</p>
                    )}
                    {node.kind === "resource" && node.personal && (
                      <Link className="wb-button" href={`/read/${node.id}`}>
                        打开文献
                      </Link>
                    )}
                    {node.kind === "question" && (
                      <Link
                        className="wb-button"
                        href={`/graph?question=${node.id}`}
                      >
                        聚焦此问题
                      </Link>
                    )}
                  </>
                ) : (
                  <p>选择节点或连线查看详情。虚线的理由也可悬停查看。</p>
                )}
              </Inspector>
            </div>
          )}
        </>
      )}
      <Sheet
        title={editor === "ai" ? "选择 AI 上下文" : "手动连线"}
        description={
          editor === "ai"
            ? "只发送你勾选的内容；想法和已有连线不参与。建议需本人逐条确认。"
            : "选择节点和关系。保存表示本人确认这条连线。"
        }
        open={!readOnly && editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {catalog.error && (
          <p role="alert">
            {errorMessage(catalog.error)}{" "}
            <Button onClick={() => void catalog.refetch()}>重新载入来源</Button>
          </p>
        )}
        {catalog.isFetching && <p role="status">正在载入可关联内容…</p>}
        {catalog.data?.truncated && (
          <p>当前来源列表已达显示上限。可先按问题聚焦补充相关内容。</p>
        )}
        {catalog.data && editor === "manual" && (
          <ManualLink
            nodes={candidates}
            path={path}
            onSaved={async () => {
              await client.invalidateQueries({ queryKey: key });
              setEditor(null);
            }}
          />
        )}
        {catalog.data && editor === "ai" && (
          <SuggestLinks
            nodes={candidates}
            scope={scope}
            onQueued={(id) => {
              setRunId(id);
              setEditor(null);
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function NetworkRun({
  workspaceId,
  runId,
  path,
}: {
  workspaceId: string;
  runId: string;
  path: string;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["workbench", "research-ai", workspaceId, runId],
    queryFn: () =>
      workbenchRequest<{ run: Run; draft: Draft | null }>(
        `/api/v1/workspaces/${workspaceId}/research/ai/runs/${runId}`,
      ),
    refetchInterval: (q) =>
      q.state.error
        ? false
        : ["queued", "running"].includes(q.state.data?.run.status ?? "queued")
          ? 1000
          : false,
  });
  const status = query.data?.run.status;
  useEffect(() => {
    if (status === "succeeded")
      void client.invalidateQueries({
        queryKey: ["workbench", "network", path],
      });
  }, [status, client, path]);
  if (query.error) return <p role="alert">{errorMessage(query.error)}</p>;
  if (!status || ["queued", "running"].includes(status))
    return <p role="status">AI 正在整理连线建议…</p>;
  if (status !== "succeeded")
    return (
      <p role="alert">{readingAiError(query.data?.run.error_code ?? null)}</p>
    );
  return (
    <p role="status">
      建议已处理。有效的新建议以虚线显示；已有或拒绝的关系不会重复加入。
    </p>
  );
}

function ManualLink({
  nodes,
  path,
  onSaved,
}: {
  nodes: NetworkNode[];
  path: string;
  onSaved: () => Promise<void>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [relation, setRelation] = useState("");
  const [reason, setReason] = useState("");
  const source = nodes.find((n) => nodeKey(n) === from),
    target = nodes.find((n) => nodeKey(n) === to);
  const relations =
    source && target ? (RELATIONS[`${source.kind}/${target.kind}`] ?? []) : [];
  const selectedRelation = relations.includes(
    relation as NetworkEdge["relation"],
  )
    ? relation
    : relations[0];
  const mutation = useMutation({
    mutationFn: () =>
      workbenchRequest(`${path}/edges`, {
        method: "POST",
        body: JSON.stringify({
          from_type: source!.kind,
          from_id: source!.id,
          to_type: target!.kind,
          to_id: target!.id,
          relation: selectedRelation,
          reason,
        }),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="wb-library-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (source && target && selectedRelation) mutation.mutate();
      }}
    >
      <label>
        起点
        <select
          required
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setTo("");
          }}
        >
          <option value="">请选择</option>
          {nodes
            .filter((n) => ["resource", "claim", "idea"].includes(n.kind))
            .map((n) => (
              <option value={nodeKey(n)} key={nodeKey(n)}>
                {NODE_LABELS[n.kind]} · {n.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        终点
        <select required value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">请选择</option>
          {nodes
            .filter(
              (n) =>
                nodeKey(n) !== from && RELATIONS[`${source?.kind}/${n.kind}`],
            )
            .map((n) => (
              <option value={nodeKey(n)} key={nodeKey(n)}>
                {NODE_LABELS[n.kind]} · {n.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        关系
        <select
          required
          value={selectedRelation ?? ""}
          onChange={(e) => setRelation(e.target.value)}
        >
          {!relations.length && <option value="">请先选择节点</option>}
          {relations.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABELS[r]} · {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        理由（可选）
        <textarea
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {mutation.error && <p role="alert">{errorMessage(mutation.error)}</p>}
      <Button type="submit" disabled={mutation.isPending || !selectedRelation}>
        保存连线
      </Button>
    </form>
  );
}

function SuggestLinks({
  nodes,
  scope,
  onQueued,
}: {
  nodes: NetworkNode[];
  scope: string;
  onQueued: (id: string) => void;
}) {
  const available = nodes.filter((n) => n.kind !== "idea");
  const [chosen, setChosen] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const refs = available
        .filter((n) => chosen.includes(nodeKey(n)))
        .map((n) => ({
          entity_type:
            n.kind === "question"
              ? "research_question"
              : n.kind === "claim"
                ? "research_claim"
                : n.kind,
          id: n.id,
          version: n.version,
        }));
      return workbenchRequest<Run>(`${scope}/research/ai/runs`, {
        method: "POST",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          idempotency_key: crypto.randomUUID(),
          task_type: "link_suggest",
          target: refs[0],
          context_entities: refs.slice(1),
          expected_output_fields: ["links"],
          requested_output_tokens: 1500,
          send_confirmed: consent,
        }),
      });
    },
    onSuccess: (run) => onQueued(run.id),
  });
  return (
    <form
      className="wb-library-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (consent && chosen.length >= 2) mutation.mutate();
      }}
    >
      <fieldset className="wb-network-choices">
        <legend>选择 2–32 项内容</legend>
        {available.map((n) => (
          <label key={nodeKey(n)}>
            <input
              type="checkbox"
              checked={chosen.includes(nodeKey(n))}
              disabled={!chosen.includes(nodeKey(n)) && chosen.length >= 32}
              onChange={(e) =>
                setChosen((prev) =>
                  e.target.checked
                    ? [...prev, nodeKey(n)]
                    : prev.filter((id) => id !== nodeKey(n)),
                )
              }
            />
            {NODE_LABELS[n.kind]} · {n.title}
          </label>
        ))}
      </fieldset>
      <label className="wb-network-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        我确认将以上所选内容发送给已配置的 AI 服务商
      </label>
      {mutation.error && <p role="alert">{errorMessage(mutation.error)}</p>}
      <Button
        type="submit"
        disabled={!consent || chosen.length < 2 || mutation.isPending}
      >
        生成连线建议
      </Button>
    </form>
  );
}

function NetworkCanvas({
  network,
  selection,
  onSelect,
  compact,
}: {
  network: Network;
  selection: string | null;
  onSelect: (id: string) => void;
  compact: boolean;
}) {
  const [view, setView] = useState("canvas"),
    [zoom, setZoom] = useState(1);
  const marker = useId().replaceAll(":", "");
  const layout = useMemo(() => networkLayout(network.nodes), [network.nodes]);
  const lookup = useMemo(
    () => new Map(network.nodes.map((n) => [nodeKey(n), n])),
    [network.nodes],
  );
  const edgeLabel = (edge: NetworkEdge) =>
    `${lookup.get(`${edge.from_type}/${edge.from_id}`)?.title} → ${RELATION_LABELS[edge.relation]} → ${lookup.get(`${edge.to_type}/${edge.to_id}`)?.title} · ${edge.status === "suggested" ? "AI 建议" : "已确认"}`;
  return (
    <div className="wb-network-view" data-view={view}>
      <div className="wb-network-view-tools wb-research-actions">
        <Segmented
          label="知识网视图"
          value={view}
          onChange={setView}
          options={[
            { id: "canvas", label: "画布" },
            { id: "list", label: "列表" },
          ]}
        />
        <Button disabled={zoom <= 0.5} onClick={() => setZoom((z) => z - 0.25)}>
          缩小
        </Button>
        <Button disabled={zoom >= 2} onClick={() => setZoom((z) => z + 0.25)}>
          放大
        </Button>
        <Button onClick={() => setZoom(1)}>重置缩放</Button>
      </div>
      <p className="wb-muted">
        {network.nodes.length} 个节点 ·{" "}
        {network.edges.length + network.prerequisites.length} 条连线
      </p>
      <div
        className="wb-network-canvas"
        tabIndex={0}
        role="region"
        aria-label="知识网画布，可滚动；Tab 选择节点或连线"
      >
        <svg
          width={layout.width * zoom}
          height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-label="知识关系画布"
        >
          <defs>
            <marker
              markerUnits="userSpaceOnUse"
              id={marker}
              markerWidth="8"
              markerHeight="8"
              refX="8"
              refY="4"
              orient="auto"
            >
              <path d="M0 0L8 4L0 8" fill="currentColor" />
            </marker>
          </defs>
          {network.edges.map((edge) => {
            const from = layout.positions.get(
                `${edge.from_type}/${edge.from_id}`,
              )!,
              to = layout.positions.get(`${edge.to_type}/${edge.to_id}`)!;
            const label = edgeLabel(edge);
            return (
              <g
                key={edge.id}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={selection === edge.id}
                className="wb-network-edge"
                data-status={edge.status}
                data-selected={selection === edge.id}
                onClick={() => onSelect(edge.id)}
                onKeyDown={(e) => {
                  if (["Enter", " "].includes(e.key)) {
                    e.preventDefault();
                    onSelect(edge.id);
                  }
                }}
              >
                <title>
                  {label}：{edge.reason || "手动建立"}
                </title>
                <path className="wb-network-hit" d={networkHit(from, to)} />
                <line
                  className="wb-network-stroke"
                  {...networkLine(from, to)}
                  markerEnd={`url(#${marker})`}
                />
              </g>
            );
          })}
          {network.prerequisites.map((edge) => {
            const from = layout.positions.get(`topic/${edge.prerequisite_id}`)!,
              to = layout.positions.get(`topic/${edge.dependent_id}`)!;
            return (
              <line
                key={edge.id}
                className="wb-network-prerequisite"
                {...networkLine(from, to)}
                markerEnd={`url(#${marker})`}
              >
                <title>概念先修关系（只读）</title>
              </line>
            );
          })}
          {network.nodes.map((node) => {
            const pos = layout.positions.get(nodeKey(node))!;
            return (
              <g
                key={nodeKey(node)}
                transform={`translate(${pos.x - 112}, ${pos.y - 28})`}
                className="wb-network-node"
                data-kind={node.kind}
                role="button"
                tabIndex={0}
                aria-label={`${NODE_LABELS[node.kind]}：${node.title}`}
                aria-pressed={selection === nodeKey(node)}
                onClick={() => onSelect(nodeKey(node))}
                onKeyDown={(e) => {
                  if (["Enter", " "].includes(e.key)) {
                    e.preventDefault();
                    onSelect(nodeKey(node));
                  }
                }}
              >
                <title>
                  {node.title}
                  {node.kind === "idea" ? " · 仅自己可见，AI 不可读" : ""}
                </title>
                <rect
                  width="224"
                  height="56"
                  rx={node.kind === "question" ? 24 : 8}
                />
                <text x="112" y="22" textAnchor="middle">
                  {node.title.length > 14
                    ? `${node.title.slice(0, 13)}…`
                    : node.title}
                </text>
                <text
                  className="wb-network-kind"
                  x="112"
                  y="42"
                  textAnchor="middle"
                >
                  {node.kind === "idea"
                    ? "私人想法 · AI 不可读"
                    : NODE_LABELS[node.kind]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="wb-network-list" aria-label="知识网文字列表">
        <details open={!compact}>
          <summary>节点（{network.nodes.length}）</summary>
          <ul>
            {network.nodes.map((n) => (
              <li key={nodeKey(n)}>
                <Button
                  aria-pressed={selection === nodeKey(n)}
                  onClick={() => onSelect(nodeKey(n))}
                >
                  {NODE_LABELS[n.kind]} · {n.title}
                </Button>
              </li>
            ))}
          </ul>
        </details>
        <details open>
          <summary>连线（{network.edges.length}）</summary>
          <ul>
            {network.edges.map((edge) => (
              <li key={edge.id}>
                <Button
                  title={edge.reason}
                  aria-pressed={selection === edge.id}
                  onClick={() => onSelect(edge.id)}
                >
                  {edgeLabel(edge)}
                </Button>
              </li>
            ))}
          </ul>
          {!network.edges.length && (
            <p>还没有连线，可手动建立或请求 AI 建议。</p>
          )}
        </details>
        {network.prerequisites.length > 0 && (
          <details>
            <summary>概念先修（只读）</summary>
            <ul>
              {network.prerequisites.map((edge) => (
                <li key={edge.id}>
                  {lookup.get(`topic/${edge.prerequisite_id}`)?.title} →{" "}
                  {lookup.get(`topic/${edge.dependent_id}`)?.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
