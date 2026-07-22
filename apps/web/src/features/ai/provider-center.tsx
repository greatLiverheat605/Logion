"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Provider = components["schemas"]["AIProviderResponse"];

function errorText(error: unknown) {
  if (error instanceof LogionApiError) {
    if (error.code === "AI_PROVIDER_URL_BLOCKED")
      return "Base URL 必须是公开 HTTPS 地址，且不能指向本机、私网或内部域名。";
    if (error.status === 403) return "当前角色无权配置 AI Provider。";
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  return "操作未完成；核心学习功能不受影响。";
}

export function ProviderCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerWorkspaceId, setProviderWorkspaceId] = useState("");
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState("正在读取 Provider 配置……");
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const canConfigure =
    selectedWorkspace?.role === "owner" || selectedWorkspace?.role === "admin";

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces");
      const next = Array.isArray(result.workspaces) ? result.workspaces : [];
      setWorkspaces(next);
      setWorkspaceId((current) =>
        next.some((item) => item.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }, []);

  const loadProviders = useCallback(async (selected: string) => {
    try {
      const result = await browserApiClient.request<{
        providers: Provider[];
      }>(`/api/v1/workspaces/${selected}/ai/providers`);
      const next = Array.isArray(result.providers) ? result.providers : [];
      setProviders(next);
      setProviderWorkspaceId(selected);
      setStatus(
        next.length
          ? "Provider 配置已更新；密钥仅保存在服务端。"
          : "尚未配置 Provider；AI 不可用，但学习、复习和研究功能仍可使用。",
      );
    } catch (error) {
      setProviders([]);
      setProviderWorkspaceId(selected);
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId && canConfigure && online)
      queueMicrotask(() => void loadProviders(workspaceId));
  }, [canConfigure, loadProviders, online, workspaceId]);

  const visibleProviders =
    canConfigure && providerWorkspaceId === workspaceId ? providers : [];
  const visibleStatus = !online
    ? "当前离线：已有学习数据仍可编辑，Provider 配置暂时只读。"
    : selectedWorkspace && !canConfigure
      ? "当前角色无权查看或配置服务端 Provider。核心学习功能仍可使用。"
      : status;

  async function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canConfigure || !online) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/providers`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name: String(data.get("name") ?? ""),
            provider_type: "openai_compatible",
            base_url: String(data.get("base_url") ?? ""),
            credential: String(data.get("credential") ?? ""),
            enabled: true,
            timeout_seconds: Number(data.get("timeout_seconds") ?? 30),
            max_retries: Number(data.get("max_retries") ?? 2),
          }),
        },
      );
      form.reset();
      setStatus("Provider 已加密保存；浏览器不会保留密钥。尚未执行连接测试。");
      await loadProviders(workspaceId);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function toggleProvider(provider: Provider) {
    if (!workspaceId || !canConfigure || !online) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/providers/${provider.id}`,
        {
          method: "PUT",
          csrf: true,
          body: JSON.stringify({
            expected_version: provider.version,
            name: provider.name,
            base_url: provider.base_url,
            credential: null,
            enabled: !provider.enabled,
            timeout_seconds: provider.timeout_seconds,
            max_retries: provider.max_retries,
          }),
        },
      );
      await loadProviders(workspaceId);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function deleteProvider(provider: Provider) {
    if (!workspaceId || !canConfigure || !online) return;
    if (
      !window.confirm(
        `删除 Provider“${provider.name}”并立即清除服务端密钥？此操作不能撤销。`,
      )
    )
      return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/providers/${provider.id}`,
        {
          method: "DELETE",
          csrf: true,
          body: JSON.stringify({ expected_version: provider.version }),
        },
      );
      setStatus(`${provider.name} 已删除，服务端密文已清除。`);
      await loadProviders(workspaceId);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · AI GATEWAY</p>
        <h1>AI Provider</h1>
        <p aria-live="polite">{visibleStatus}</p>
      </header>
      <section className="settings-card">
        <h2>安全边界</h2>
        <p>
          Provider 密钥仅在服务端信封加密保存，不进入
          IndexedDB、导出、日志或浏览器响应。
          本页面目前只保存配置，不会自动连接外部服务。
        </p>
        {!online ? (
          <p role="status">
            当前离线：已有学习数据仍可编辑，Provider 配置暂时只读。
          </p>
        ) : null}
        <label htmlFor="ai-workspace">工作区</label>
        <select
          id="ai-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option value={workspace.id} key={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </section>
      <section className="settings-card">
        <h2>新增 OpenAI-compatible Provider</h2>
        <form className="planning-form" onSubmit={createProvider}>
          <label htmlFor="provider-name">名称</label>
          <input id="provider-name" name="name" maxLength={120} required />
          <label htmlFor="provider-url">公开 HTTPS Base URL</label>
          <input
            id="provider-url"
            name="base_url"
            type="url"
            inputMode="url"
            placeholder="https://api.example.com/v1"
            maxLength={2048}
            required
          />
          <label htmlFor="provider-credential">API 密钥</label>
          <input
            id="provider-credential"
            name="credential"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={8192}
            required
          />
          <label htmlFor="provider-timeout">超时（秒）</label>
          <input
            id="provider-timeout"
            name="timeout_seconds"
            type="number"
            min={1}
            max={300}
            defaultValue={30}
            required
          />
          <label htmlFor="provider-retries">最大重试次数</label>
          <input
            id="provider-retries"
            name="max_retries"
            type="number"
            min={0}
            max={5}
            defaultValue={2}
            required
          />
          <button disabled={!online || !canConfigure || !workspaceId}>
            加密保存配置
          </button>
        </form>
      </section>
      <section className="settings-card">
        <h2>已配置 Provider</h2>
        {visibleProviders.length ? (
          <ul className="item-list">
            {visibleProviders.map((provider) => (
              <li key={provider.id}>
                <span>
                  <strong>{provider.name}</strong>
                  <small>
                    {provider.base_url} ·{" "}
                    {provider.enabled ? "已启用" : "已停用"} · 密钥
                    {provider.credential_configured ? "已配置" : "缺失"}
                  </small>
                </span>
                <span className="app-actions">
                  <button
                    type="button"
                    disabled={!online || !canConfigure}
                    onClick={() => void toggleProvider(provider)}
                  >
                    {provider.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    disabled={!online || !canConfigure}
                    aria-label={`删除 Provider ${provider.name} 并清除服务端密钥`}
                    onClick={() => void deleteProvider(provider)}
                  >
                    删除并清除密钥
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>没有可显示的 Provider 配置。</p>
        )}
      </section>
    </main>
  );
}
