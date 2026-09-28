"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { components } from "@logion/contracts";
import { Button, Sheet } from "@/platform/workbench/components";
import { errorMessage, workbenchRequest } from "@/platform/workbench/api";
import { ZoteroSync } from "./zotero-sync";

type Status = components["schemas"]["IntegrationStatus"];
const names = { zotero: "Zotero", webdav: "坚果云" } as const;
const messages: Record<string, string> = {
  INTEGRATION_AUTH_FAILED: "凭据未获认可，请检查后重新配置。",
  ZOTERO_READ_ONLY_KEY_REQUIRED:
    "请使用允许读取个人文献库、没有写入权限的 Zotero Key。",
  INTEGRATION_KEY_UNAVAILABLE: "服务器尚未配置集成加密密钥，请联系维护者。",
  INTEGRATION_HOST_BLOCKED: "连接地址不在允许范围内，请联系维护者。",
  INTEGRATION_DNS_BLOCKED: "无法安全解析服务地址，请稍后重试。",
  INTEGRATION_UNAVAILABLE: "服务暂时不可用，请稍后重试。",
};

export function Integrations() {
  return (
    <section className="wb-integrations" aria-label="文献集成">
      <h2>文献集成</h2>
      <p>Zotero 仅用于读取文献。坚果云保存原文，凭据加密保存在服务器中。</p>
      {(["zotero", "webdav"] as const).map((provider) => (
        <IntegrationCard key={provider} provider={provider} />
      ))}
      <ZoteroSync />
    </section>
  );
}

function IntegrationCard({ provider }: { provider: "zotero" | "webdav" }) {
  const client = useQueryClient();
  const path = `/api/v1/research/integrations/${provider}`;
  const queryKey = ["workbench", "integration", provider];
  const status = useQuery({
    queryKey,
    queryFn: () => workbenchRequest<Status>(path),
  });
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: async (kind: "set" | "test" | "revoke") => {
      setError(null);
      if (kind === "revoke") {
        await workbenchRequest(path, { method: "DELETE" });
        setRevoking(false);
      } else {
        const result = await workbenchRequest<Status>(
          kind === "test" ? `${path}/test` : path,
          {
            method: kind === "test" ? "POST" : "PUT",
            ...(kind === "set"
              ? {
                  body: JSON.stringify({
                    credential,
                    ...(provider === "webdav" ? { username } : {}),
                  }),
                }
              : {}),
          },
        );
        client.setQueryData(queryKey, result);
        if (kind === "set") {
          setCredential("");
          setUsername("");
          setEditing(false);
        }
      }
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({
        queryKey: ["workbench", "zotero-sync"],
      });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const data = status.data;
  return (
    <section className="wb-integration" aria-label={`${names[provider]} 集成`}>
      <h3>{names[provider]}</h3>
      <p role="status">
        {status.isPending
          ? "正在读取连接状态…"
          : data?.connected
            ? "已连接"
            : data?.configured
              ? "已配置，待测试连接"
              : "未配置"}
      </p>
      {data?.last_sync_at && (
        <p>最近同步：{new Date(data.last_sync_at).toLocaleString("zh-CN")}</p>
      )}
      {data?.last_error_code && (
        <p role="alert">
          {messages[data.last_error_code] ?? "连接未完成，请检查配置后重试。"}
        </p>
      )}
      {(error || status.error) && (
        <p role="alert">{error ?? errorMessage(status.error)}</p>
      )}
      <div className="wb-integration-actions">
        <Button onClick={() => setEditing(true)} disabled={action.isPending}>
          配置 {names[provider]}
        </Button>
        <Button
          onClick={() => action.mutate("test")}
          disabled={!data?.configured || action.isPending}
        >
          测试连接
        </Button>
        {data?.configured && (
          <Button onClick={() => setRevoking(true)} disabled={action.isPending}>
            撤销连接
          </Button>
        )}
      </div>
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate("set");
          }}
        >
          {provider === "webdav" && (
            <label>
              坚果云账号
              <input
                required
                type="text"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={320}
              />
            </label>
          )}
          <label>
            {provider === "zotero" ? "只读 API Key" : "应用密码"}
            <input
              required
              type="password"
              autoComplete="new-password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              maxLength={4096}
            />
          </label>
          <p>已有凭据不会回显。配置和撤销需要最近登录验证。</p>
          <div className="wb-integration-actions">
            <Button type="submit" disabled={action.isPending}>
              保存凭据
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                setCredential("");
                setUsername("");
              }}
              disabled={action.isPending}
            >
              取消
            </Button>
          </div>
        </form>
      )}
      <Sheet
        title={`撤销 ${names[provider]} 连接`}
        description="将清除已保存的凭据，并停止通过此连接获取数据。你的文献和笔记会保留。"
        open={revoking}
        onOpenChange={setRevoking}
      >
        <Button
          onClick={() => action.mutate("revoke")}
          disabled={action.isPending}
        >
          确认撤销
        </Button>
        <Button onClick={() => setRevoking(false)} disabled={action.isPending}>
          取消
        </Button>
      </Sheet>
    </section>
  );
}
