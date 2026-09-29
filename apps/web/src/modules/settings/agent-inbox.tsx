"use client";

import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { components } from "@logion/contracts";
import { Button } from "@/platform/workbench/components";
import { errorMessage, workbenchRequest } from "@/platform/workbench/api";
import type { WorkbenchContext } from "@/platform/workbench/preferences";

type Item = components["schemas"]["AgentInboxView"];
type Payload = components["schemas"]["AgentSubmission"]["payload"];
type Status = Item["status"];
const kinds = {
  source: "文献条目",
  report: "研究报告",
  summary: "摘要",
  edge: "建议连线",
};
const relations: Record<string, string> = {
  addresses: "回应",
  defines: "定义",
  uses: "使用",
  extends: "扩展",
  contradicts: "相矛盾",
  supersedes: "替代",
  supports: "支持",
  challenges: "质疑",
};

export function AgentInbox({ context }: { context: WorkbenchContext }) {
  const path = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/agent-inbox`;
  const [status, setStatus] = useState<Status>("pending");
  const key = ["workbench", "agent-inbox", path, status];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<components["schemas"]["AgentInboxPage"]>(path, {
        query: { status, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  return (
    <section className="wb-config-section" aria-labelledby="agent-inbox-title">
      <h2 id="agent-inbox-title">收件箱</h2>
      <p>仅你可见。确认内容后逐条接受，也可以先编辑或丢弃。</p>
      <label className="wb-agent-filter">
        处理状态
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
        >
          <option value="pending">待审阅</option>
          <option value="accepted">已接受</option>
          <option value="discarded">已丢弃</option>
        </select>
      </label>
      {query.isPending && <p role="status">正在读取投稿…</p>}
      {query.error && (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>重新载入收件箱</Button>
        </>
      )}
      {query.data?.pages[0]?.items.length === 0 && (
        <p className="wb-muted">
          当前没有
          {status === "pending"
            ? "待审阅"
            : status === "accepted"
              ? "已接受"
              : "已丢弃"}
          的投稿。
        </p>
      )}
      <div className="wb-agent-items">
        {query.data?.pages
          .flatMap((page) => page.items)
          .map((item) => (
            <InboxCard
              key={`${item.id}/${item.version}`}
              item={item}
              path={path}
            />
          ))}
      </div>
      {query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多投稿
        </Button>
      )}
    </section>
  );
}

function InboxCard({ item, path }: { item: Item; path: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [payload, setPayload] = useState<Payload>(
    item.accepted_payload ?? item.payload,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function decide(decision: "accepted" | "discarded") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await workbenchRequest<Item>(`${path}/${item.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          expected_version: item.version,
          decision,
          ...(editing && decision === "accepted" ? { payload } : {}),
        }),
      });
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["workbench", "agent-inbox", path],
        }),
        client.invalidateQueries({ queryKey: ["workbench", "records"] }),
        client.invalidateQueries({ queryKey: ["workbench", "library"] }),
      ]);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="wb-agent-item" aria-label={`${kinds[item.kind]}投稿`}>
      <header>
        <h3>{kinds[item.kind]}</h3>
        <span>
          {item.agent_name} ·{" "}
          {new Date(item.created_at).toLocaleDateString("zh-CN")}
        </span>
      </header>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void decide("accepted");
          }}
        >
          <fieldset disabled={busy}>
            <legend>编辑后接受</legend>
            <PayloadFields value={payload} onChange={setPayload} />
            <div className="wb-config-actions">
              <Button type="submit">接受编辑后的内容</Button>
              <Button
                onClick={() => {
                  setPayload(item.payload);
                  setEditing(false);
                  setError(null);
                }}
              >
                取消编辑
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <PayloadPreview value={payload} references={item.references ?? []} />
      )}
      {!!error && <p role="alert">{errorMessage(error)}</p>}
      {item.status === "pending" && !editing && (
        <div className="wb-config-actions">
          <Button disabled={busy} onClick={() => void decide("accepted")}>
            接受
          </Button>
          <Button disabled={busy} onClick={() => setEditing(true)}>
            编辑后接受
          </Button>
          <Button disabled={busy} onClick={() => void decide("discarded")}>
            丢弃
          </Button>
        </div>
      )}
      {item.receipt?.id && (
        <Link
          className="wb-button"
          href={
            item.receipt.entity_type === "note"
              ? `/records?note=${encodeURIComponent(item.receipt.id)}&agent=1`
              : item.receipt.entity_type === "resource"
                ? "/library"
                : "/graph"
          }
        >
          {item.receipt.entity_type === "note"
            ? "打开私人笔记"
            : item.receipt.entity_type === "resource"
              ? "查看文献库"
              : "查看知识网"}
        </Link>
      )}
    </article>
  );
}

function PayloadPreview({
  value,
  references,
}: {
  value: Payload;
  references: string[];
}) {
  if (value.kind === "edge")
    return (
      <>
        <p>
          {references[0]} → {relations[value.relation] ?? value.relation} →{" "}
          {references[1]}
        </p>
        <p className="wb-agent-body">{value.reason || "未附说明"}</p>
      </>
    );
  if (value.kind === "report" || value.kind === "summary")
    return (
      <>
        <h4>{value.title}</h4>
        <p className="wb-agent-body">{value.markdown_body}</p>
      </>
    );
  if (value.kind !== "source") return null;
  return (
    <>
      <h4>{value.title}</h4>
      <dl>
        {[
          ["DOI", value.doi],
          ["arXiv", value.arxiv_id],
          ["PMID", value.pmid],
          ["来源", value.source_url],
          ["引用键", value.citation_key],
        ]
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {value.csl?.abstract && (
        <p className="wb-agent-body">{value.csl.abstract}</p>
      )}
    </>
  );
}

function PayloadFields({
  value,
  onChange,
}: {
  value: Payload;
  onChange: (payload: Payload) => void;
}) {
  if (value.kind === "edge")
    return (
      <>
        <label>
          关系
          <select
            value={value.relation}
            onChange={(e) =>
              onChange({
                ...value,
                relation: e.target.value as typeof value.relation,
              })
            }
          >
            {(value.from_type === "claim"
              ? ["supports", "challenges"]
              : value.to_type === "question"
                ? ["addresses"]
                : value.to_type === "topic"
                  ? ["defines", "uses"]
                  : ["extends", "contradicts", "supersedes"]
            ).map((v) => (
              <option value={v} key={v}>
                {relations[v]}
              </option>
            ))}
          </select>
        </label>
        <label>
          理由
          <textarea
            maxLength={1000}
            value={value.reason ?? ""}
            onChange={(e) => onChange({ ...value, reason: e.target.value })}
          />
        </label>
      </>
    );
  if (value.kind === "report" || value.kind === "summary")
    return (
      <>
        <label>
          标题
          <input
            required
            maxLength={200}
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </label>
        <label>
          正文
          <textarea
            required
            maxLength={50000}
            value={value.markdown_body}
            onChange={(e) =>
              onChange({ ...value, markdown_body: e.target.value })
            }
          />
        </label>
      </>
    );
  if (value.kind !== "source") return null;
  return (
    <>
      <label>
        文献标题
        <input
          required
          maxLength={300}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        文献类型
        <select
          value={value.resource_type ?? "paper"}
          onChange={(e) =>
            onChange({
              ...value,
              resource_type: e.target.value as typeof value.resource_type,
            })
          }
        >
          {[
            ["paper", "论文"],
            ["book", "书籍"],
            ["preprint", "预印本"],
            ["web", "网页"],
          ].map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["DOI", "doi", 255],
          ["arXiv", "arxiv_id", 80],
          ["PMID", "pmid", 20],
          ["来源网址", "source_url", 4096],
          ["引用键", "citation_key", 160],
        ] as const
      ).map(([label, key, max]) => (
        <label key={key}>
          {label}
          <input
            maxLength={max}
            value={value[key] ?? ""}
            onChange={(e) =>
              onChange({ ...value, [key]: e.target.value || null })
            }
          />
        </label>
      ))}
      <label>
        摘要
        <textarea
          maxLength={30000}
          value={value.csl?.abstract ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              csl: { ...value.csl, abstract: e.target.value || null },
            })
          }
        />
      </label>
    </>
  );
}
