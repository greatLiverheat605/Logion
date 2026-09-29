"use client";

import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { components } from "@logion/contracts";
import { LogionApiError } from "@/lib/api/client";
import { Button, Sheet } from "@/platform/workbench/components";
import { errorMessage, workbenchRequest } from "@/platform/workbench/api";
import { useWorkbench } from "@/platform/workbench/provider";
import type { WorkbenchContext } from "@/platform/workbench/preferences";
import { AgentInbox } from "./agent-inbox";
import "./settings.css";
import "./agents.css";

type Token = components["schemas"]["AgentTokenView"];
type Issued = components["schemas"]["AgentTokenIssued"];
const path = "/api/v1/research/agent-tokens";

export function AgentSettings() {
  const { context } = useWorkbench();
  return (
    <div className="wb-page wb-config-page wb-agent-settings">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>Agent 与收件箱</h1>
          <p>让本机 Agent 协助整理，逐条审阅后再加入自己的研究记录。</p>
        </div>
      </div>
      {context ? (
        <AgentScope
          key={`${context.workspace_id}/${context.space_id}`}
          context={context}
        />
      ) : (
        <p>请先选择空间。</p>
      )}
    </div>
  );
}

function AgentScope({ context }: { context: WorkbenchContext }) {
  const client = useQueryClient();
  const queryKey = ["workbench", "agent-tokens"];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<components["schemas"]["AgentTokenPage"]>(path, {
        query: pageParam ? { cursor: pageParam } : {},
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [read, setRead] = useState(true);
  const [write, setWrite] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoke, setRevoke] = useState<Token | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await workbenchRequest<Issued>(path, {
        method: "POST",
        body: JSON.stringify({
          workspace_id: context.workspace_id,
          space_id: context.space_id,
          name,
          scopes: [
            ...(read ? ["read"] : []),
            ...(write ? ["inbox:write"] : []),
          ],
          expires_at: new Date(Date.now() + days * 86400000).toISOString(),
        }),
      });
      setSecret(value.token);
      setCopied(false);
      setName("");
      await client.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function confirmRevoke() {
    if (!revoke || busy) return;
    setBusy(true);
    setError(null);
    try {
      await workbenchRequest(`${path}/${revoke.id}/revoke`, { method: "POST" });
      setRevoke(null);
      await client.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  if (query.error instanceof LogionApiError && query.error.status === 404)
    return (
      <p role="status">当前服务器尚未启用本机 Agent。已有研究记录不受影响。</p>
    );
  if (query.isPending) return <p role="status">正在读取 Agent 设置…</p>;
  if (query.error)
    return (
      <>
        <p role="alert">{errorMessage(query.error)}</p>
        <Button onClick={() => void query.refetch()}>重新载入</Button>
      </>
    );
  return (
    <>
      <section
        className="wb-config-section"
        aria-labelledby="agent-tokens-title"
      >
        <h2 id="agent-tokens-title">个人访问令牌</h2>
        <p>
          令牌仅能读取所选空间的研究资料或提交收件箱。想法始终不可读，Agent
          不能直接修改、删除或接受记录。
        </p>
        <form
          onSubmit={(event) => void create(event)}
          className="wb-agent-form"
        >
          <label>
            令牌名称
            <input
              required
              maxLength={80}
              value={name}
              disabled={busy || !!secret}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            有效期
            <select
              value={days}
              disabled={busy || !!secret}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[1, 7, 30, 90, 365].map((value) => (
                <option key={value} value={value}>
                  {value} 天
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy || !!secret}>
            <legend>权限范围</legend>
            <label>
              <input
                type="checkbox"
                checked={read}
                onChange={(e) => setRead(e.target.checked)}
              />
              读取研究资料
            </label>
            <label>
              <input
                type="checkbox"
                checked={write}
                onChange={(e) => setWrite(e.target.checked)}
              />
              提交收件箱
            </label>
          </fieldset>
          <p className="wb-muted">
            绑定顶部当前选择的工作区和空间；之后切换空间不会改变已签发的令牌。
          </p>
          <Button
            type="submit"
            disabled={busy || !!secret || !name.trim() || (!read && !write)}
          >
            创建令牌
          </Button>
        </form>
        {secret && (
          <div className="wb-agent-secret" role="region" aria-label="新令牌">
            <p>
              令牌仅显示这一次。请存入本机密码管理器，再按安装说明通过环境变量提供给
              Agent。
            </p>
            <label>
              新令牌值
              <input
                type="password"
                readOnly
                value={secret}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="wb-config-actions">
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(secret)
                    .then(() => setCopied(true))
                    .catch(setError)
                }
              >
                复制令牌
              </Button>
              <Button onClick={() => setSecret(null)}>已保存，关闭显示</Button>
            </div>
            {copied && <p role="status">已复制令牌。</p>}
          </div>
        )}
        {!!error && !revoke && <p role="alert">{errorMessage(error)}</p>}
        <ul className="wb-config-list">
          {query.data?.pages
            .flatMap((page) => page.tokens)
            .map((token) => (
              <li key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <p>
                    {token.scopes
                      .map((scope) =>
                        scope === "read" ? "读取资料" : "提交收件箱",
                      )
                      .join(" · ")}
                  </p>
                  <p>
                    {token.revoked_at
                      ? "已撤销"
                      : new Date(token.expires_at).getTime() <= Date.now()
                        ? "已过期"
                        : `有效至 ${new Date(token.expires_at).toLocaleDateString("zh-CN")}`}
                  </p>
                </div>
                {!token.revoked_at && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setRevoke(token);
                    }}
                  >
                    撤销 {token.name}
                  </Button>
                )}
              </li>
            ))}
        </ul>
        {query.hasNextPage && (
          <Button
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            加载更多令牌
          </Button>
        )}
      </section>
      <AgentInbox context={context} />
      <Sheet
        open={!!revoke}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRevoke(null);
            setError(null);
          }
        }}
        title="撤销个人访问令牌"
        description="撤销后，本机 Agent 将无法继续使用此令牌。已有投稿与研究记录会保留。"
      >
        <p>{revoke?.name}</p>
        {!!error && <p role="alert">{errorMessage(error)}</p>}
        <div className="wb-config-actions">
          <Button disabled={busy} onClick={() => setRevoke(null)}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void confirmRevoke()}>
            确认撤销
          </Button>
        </div>
      </Sheet>
    </>
  );
}
