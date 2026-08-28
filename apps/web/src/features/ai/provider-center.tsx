"use client";

import type { components } from "@logion/contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ProductEmptyState,
  ProductTag,
} from "@/components/product/product-ui";
import { AppIcon } from "@/components/app-shell/app-icon";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
  type WorkbenchSelectOption,
} from "@/components/product/headless-ui";
import {
  isRecentAuthRequired,
  LogionApiError,
} from "@/lib/api/client";

import styles from "./ai-governance-workbench.module.css";
import { useProviderController } from "./use-provider-controller";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Provider = components["schemas"]["AIProviderResponse"];
type Model = components["schemas"]["AIModelResponse"];
type Route = components["schemas"]["AITaskRouteResponse"];
type Budget = components["schemas"]["AIWorkspaceBudgetResponse"];

function requestSuffix(error: LogionApiError): string {
  return error.requestId === "unavailable"
    ? ""
    : `（请求编号：${error.requestId}）`;
}

function errorText(error: unknown) {
  if (isRecentAuthRequired(error)) {
    return `需要重新认证后继续此操作${requestSuffix(error)}。`;
  }
  if (error instanceof LogionApiError) {
    if (error.code === "AI_PROVIDER_URL_BLOCKED")
      return "Base URL 必须是公开 HTTPS 地址，且不能指向本机、私网或内部域名。";
    if (error.code === "AI_PROVIDER_DNS_BLOCKED")
      return "Provider 域名解析结果包含非公网地址，连接已阻止。";
    if (error.code === "AI_PROVIDER_AUTH_FAILED")
      return "Provider 拒绝了密钥，请更新凭据后重试。";
    if (error.code.startsWith("AI_PROVIDER_"))
      return `Provider 检查失败（${error.code}）；核心学习功能不受影响。`;
    if (error.status === 403)
      return `当前角色无权配置 AI Provider${requestSuffix(error)}。`;
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  return "操作未完成；核心学习功能不受影响。";
}

export function ProviderCenter() {
  const { request } = useProviderController();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [providerWorkspaceId, setProviderWorkspaceId] = useState("");
  const [modelsWorkspaceId, setModelsWorkspaceId] = useState("");
  const [online, setOnline] = useState(true);
  const [recentAuthRequired, setRecentAuthRequired] = useState(false);
  const [status, setStatus] = useState("正在读取 Provider 配置……");
  const [tab, setTab] = useState("providers");
  const [providerSheetOpen, setProviderSheetOpen] = useState(false);
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [modelSheet, setModelSheet] = useState<Model | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const canConfigure =
    selectedWorkspace?.role === "owner" || selectedWorkspace?.role === "admin";

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await request<{
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
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }, [request]);

  const loadProviderData = useCallback(async (selected: string) => {
    try {
      const [providerResult, modelResult, routeResult, budgetResult] =
        await Promise.all([
          request<{ providers: Provider[] }>(
            `/api/v1/workspaces/${selected}/ai/providers`,
          ),
          request<{ models: Model[] }>(
            `/api/v1/workspaces/${selected}/ai/models`,
          ),
          request<{ routes: Route[] }>(
            `/api/v1/workspaces/${selected}/ai/routes`,
          ),
          request<Budget>(
            `/api/v1/workspaces/${selected}/ai/budget`,
          ),
        ]);
      const nextProviders = Array.isArray(providerResult.providers)
        ? providerResult.providers
        : [];
      const nextModels = Array.isArray(modelResult.models)
        ? modelResult.models
        : [];
      setProviders(nextProviders);
      setModels(nextModels);
      setRoutes(Array.isArray(routeResult.routes) ? routeResult.routes : []);
      setBudget(budgetResult);
      setProviderWorkspaceId(selected);
      setModelsWorkspaceId(selected);
      setRecentAuthRequired(false);
      setStatus(
        nextProviders.length
          ? "Provider 与模型状态已更新；密钥仅保存在服务端。"
          : "尚未配置 Provider；AI 不可用，但学习、复习和研究功能仍可使用。",
      );
    } catch (error) {
      setProviders([]);
      setModels([]);
      setRoutes([]);
      setBudget(null);
      setProviderWorkspaceId(selected);
      setModelsWorkspaceId(selected);
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }, [request]);

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
      queueMicrotask(() => void loadProviderData(workspaceId));
  }, [canConfigure, loadProviderData, online, workspaceId]);

  const visibleProviders =
    canConfigure && providerWorkspaceId === workspaceId ? providers : [];
  const visibleModels =
    canConfigure && modelsWorkspaceId === workspaceId ? models : [];
  const visibleProviderById = useMemo(
    () =>
      new Map(
        (canConfigure && providerWorkspaceId === workspaceId
          ? providers
          : []
        ).map((provider) => [provider.id, provider]),
      ),
    [canConfigure, providerWorkspaceId, providers, workspaceId],
  );
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
      await request(
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
      await loadProviderData(workspaceId);
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function toggleProvider(provider: Provider) {
    if (!workspaceId || !canConfigure || !online) return;
    try {
      await request(
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
      await loadProviderData(workspaceId);
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
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
      await request(
        `/api/v1/workspaces/${workspaceId}/ai/providers/${provider.id}`,
        {
          method: "DELETE",
          csrf: true,
          body: JSON.stringify({ expected_version: provider.version }),
        },
      );
      setStatus(`${provider.name} 已删除，服务端密文已清除。`);
      await loadProviderData(workspaceId);
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function discoverModels(provider: Provider) {
    if (!workspaceId || !canConfigure || !online || !provider.enabled) return;
    if (
      !window.confirm(
        `将向“${provider.name}”发送一次最小认证请求以检查连接并读取模型列表。继续吗？`,
      )
    )
      return;
    try {
      const result = await request<{
        model_count: number;
      }>(
        `/api/v1/workspaces/${workspaceId}/ai/providers/${provider.id}/discover-models`,
        { method: "POST", csrf: true },
      );
      await loadProviderData(workspaceId);
      setStatus(`连接检查成功，发现 ${result.model_count} 个模型。`);
    } catch (error) {
      await loadProviderData(workspaceId);
      setStatus(errorText(error));
    }
  }

  async function updateBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canConfigure || !online) return;
    const data = new FormData(event.currentTarget);
    const tokenValue = String(data.get("monthly_token_budget") ?? "").trim();
    try {
      await request(
        `/api/v1/workspaces/${workspaceId}/ai/budget`,
        {
          method: "PUT",
          csrf: true,
          body: JSON.stringify({
            expected_version: budget?.version ? budget.version : null,
            monthly_token_budget: tokenValue ? Number(tokenValue) : null,
            monthly_cost_budget_minor: null,
            currency: "USD",
          }),
        },
      );
      await loadProviderData(workspaceId);
      setStatus("AI 月度 Token 上限已更新。正式运行会在服务端再次校验用量。");
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function updateModel(event: FormEvent<HTMLFormElement>, model: Model) {
    event.preventDefault();
    if (!workspaceId || !canConfigure || !online) return;
    const data = new FormData(event.currentTarget);
    try {
      await request(
        `/api/v1/workspaces/${workspaceId}/ai/models/${model.id}`,
        {
          method: "PUT",
          csrf: true,
          body: JSON.stringify({
            expected_version: model.version,
            display_name: String(data.get("display_name") ?? ""),
            enabled: data.get("enabled") === "on",
            supports_json: data.get("supports_json") === "on",
            supports_stream: data.get("supports_stream") === "on",
            context_window: Number(data.get("context_window")) || null,
            pricing_currency: "USD",
            input_cost_per_million_minor: 0,
            output_cost_per_million_minor: 0,
          }),
        },
      );
      await loadProviderData(workspaceId);
      setStatus(`${model.display_name} 的能力配置已更新。`);
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function createRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canConfigure || !online) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await request(
        `/api/v1/workspaces/${workspaceId}/ai/routes`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            name: String(data.get("name") ?? ""),
            task_type: String(data.get("task_type") ?? ""),
            requires_json: data.get("requires_json") === "on",
            requires_stream: data.get("requires_stream") === "on",
            max_input_tokens: Number(data.get("max_input_tokens") ?? 1),
            max_output_tokens: Number(data.get("max_output_tokens") ?? 1),
            enabled: true,
            model_ids: data.getAll("model_ids").map(String),
          }),
        },
      );
      form.reset();
      await loadProviderData(workspaceId);
      setStatus("AI 任务路由已创建；模型顺序决定主选与降级顺序。");
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function deleteRoute(route: Route) {
    if (!workspaceId || !canConfigure || !online) return;
    if (!window.confirm(`删除路由“${route.name}”？`)) return;
    try {
      await request(
        `/api/v1/workspaces/${workspaceId}/ai/routes/${route.id}`,
        {
          method: "DELETE",
          csrf: true,
          body: JSON.stringify({ expected_version: route.version }),
        },
      );
      await loadProviderData(workspaceId);
      setStatus("AI 任务路由已删除。");
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  const selectedProvider =
    visibleProviders.find((provider) => provider.id === selectedProviderId) ??
    visibleProviders[0] ??
    null;
  const workspaceOptions: WorkbenchSelectOption[] = workspaces.map((workspace) => ({
    label: `${workspace.name} · ${workspace.role}`,
    value: workspace.id,
  }));

  return (
    <section className={styles.root} id="ai-provider-center" aria-labelledby="provider-center-heading" data-testid="ai-provider">
      <WorkbenchFrame
        label="AI 模型治理工作台"
        header={<WorkbenchHeader eyebrow="AI · 模型设置" title={<span id="provider-center-heading">模型连接与任务路由</span>} description="Provider、模型能力和任务路由集中治理；密钥只在服务端加密保存。" actions={<button className={styles.secondaryButton} type="button" onClick={() => setProviderSheetOpen(true)}><AppIcon name="plus" size={14} />新增 Provider</button>} />}
        context={<WorkbenchContextBar context={{ workspace: selectedWorkspace ? { id: selectedWorkspace.id, name: selectedWorkspace.name } : undefined, permission: selectedWorkspace ? { label: canConfigure ? "管理员配置" : "只读状态", tone: canConfigure ? "good" : "warn" } : undefined, sync: { label: online ? "在线" : "离线", tone: online ? "good" : "warn" }, vault: { label: "服务端上下文" } }} />}
        toolbar={<WorkbenchToolbar label="AI 模型工作区工具"><div className={styles.toolbarLead} aria-live="polite">{visibleStatus}{recentAuthRequired ? <a className={styles.reauthAction} href="/auth/login?next=/app/ai">重新认证</a> : null}</div><WorkbenchSelect label="AI 工作区" onValueChange={setWorkspaceId} options={workspaceOptions} placeholder="选择工作区" value={workspaceId} /></WorkbenchToolbar>}
        masterLabel="AI 资源目录"
        master={<aside className={styles.masterPane}><div className={styles.paneHeading}><span className={styles.eyebrow}>AI WORKSPACE</span><strong>治理目录</strong></div><nav className={styles.masterNav} aria-label="AI 设置分区"><button className={tab === "providers" ? styles.masterNavActive : undefined} type="button" onClick={() => setTab("providers")}><AppIcon name="ai" size={14} />Provider <ProductTag>{visibleProviders.length}</ProductTag></button><button className={tab === "models" ? styles.masterNavActive : undefined} type="button" onClick={() => setTab("models")}><AppIcon name="files" size={14} />模型 <ProductTag>{visibleModels.length}</ProductTag></button><button className={tab === "routes" ? styles.masterNavActive : undefined} type="button" onClick={() => setTab("routes")}><AppIcon name="target" size={14} />任务路由 <ProductTag>{routes.length}</ProductTag></button><button className={tab === "budget" ? styles.masterNavActive : undefined} type="button" onClick={() => setTab("budget")}><AppIcon name="timer" size={14} />预算</button></nav><div className={styles.masterList}>{visibleProviders.map((provider) => <button className={provider.id === selectedProvider?.id ? styles.selectedRow : undefined} key={provider.id} type="button" onClick={() => { setSelectedProviderId(provider.id); setTab("providers"); }}><span className={styles.providerDot} data-enabled={provider.enabled} /><span><strong>{provider.name}</strong><small>{provider.enabled ? "已启用" : "已停用"} · 密钥{provider.credential_configured ? "已配置" : "缺失"}</small></span></button>)}{visibleProviders.length === 0 ? <ProductEmptyState icon="◇" title="尚未配置 Provider" description="核心学习功能不受影响；需要 AI 时再添加连接。" /> : null}</div><button className={styles.masterCreate} type="button" onClick={() => setProviderSheetOpen(true)}><AppIcon name="plus" size={14} />添加连接</button></aside>}
        mainLabel="模型设置"
        main={<div className={styles.mainPane}><WorkbenchActionBar secondary={<button type="button" onClick={() => void loadProviderData(workspaceId)} disabled={!workspaceId || !online}><AppIcon name="refresh" size={14} />刷新</button>} primary={tab === "providers" ? selectedProvider ? <button className={styles.primaryButton} type="button" disabled={!online || !canConfigure || !selectedProvider.enabled} onClick={() => void discoverModels(selectedProvider)}><AppIcon name="refresh" size={14} />测试并发现模型</button> : <button className={styles.primaryButton} type="button" disabled={!online || !canConfigure || !workspaceId} onClick={() => setProviderSheetOpen(true)}><AppIcon name="plus" size={14} />新增 Provider</button> : tab === "routes" ? <button className={styles.primaryButton} type="button" disabled={!online || !canConfigure || !workspaceId} onClick={() => setRouteSheetOpen(true)}><AppIcon name="plus" size={14} />创建路由</button> : tab === "budget" ? <button className={styles.primaryButton} type="button" disabled={!online || !canConfigure || !workspaceId} onClick={() => setBudgetSheetOpen(true)}><AppIcon name="files" size={14} />编辑预算</button> : undefined} /><WorkbenchTabs label="模型治理视图" onValueChange={setTab} tabs={[{ label: "Provider", value: "providers", count: visibleProviders.length }, { label: "模型", value: "models", count: visibleModels.length }, { label: "任务路由", value: "routes", count: routes.length }, { label: "预算", value: "budget" }]} value={tab}>
          <WorkbenchTabPanel value="providers"><section className={styles.dataSection}><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>PROVIDER HEALTH</span><h2>Provider 健康状态</h2></div><ProductTag tone={canConfigure ? "good" : "warn"}>{canConfigure ? "可配置" : "只读"}</ProductTag></header>{selectedProvider ? <div className={styles.providerDetail}><div><strong>{selectedProvider.name}</strong><span>{selectedProvider.base_url}</span><span>密钥{selectedProvider.credential_configured ? "已配置" : "缺失"} · 最近检查 {selectedProvider.last_health_status}{selectedProvider.last_health_error_code ? ` · ${selectedProvider.last_health_error_code}` : ""}</span></div><div className={styles.inlineActions}><button type="button" disabled={!online || !canConfigure} onClick={() => void toggleProvider(selectedProvider)}>{selectedProvider.enabled ? "停用" : "启用"}</button><button type="button" disabled={!online || !canConfigure} onClick={() => void deleteProvider(selectedProvider)}>删除并清除密钥</button></div></div> : <ProductEmptyState icon="◇" title="尚未配置 Provider" description="添加一个公开 HTTPS Provider 后再进行连接检查。" />}</section></WorkbenchTabPanel>
          <WorkbenchTabPanel value="models"><section className={styles.dataSection}><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>DISCOVERED MODELS</span><h2>已发现模型</h2></div><ProductTag>{visibleModels.length} 个</ProductTag></header>{visibleModels.length ? <div className={styles.dataTable} role="table" aria-label="已发现模型"><div className={styles.tableHead} role="row"><span>模型</span><span>能力</span><span>上下文</span><span>操作</span></div>{visibleModels.map((model) => { const provider = visibleProviderById.get(model.provider_id); return <div className={styles.tableRow} role="row" key={`${model.id}:${model.version}`}><span><strong>{model.display_name}</strong><small>{provider?.name ?? "未知 Provider"} · {model.source}</small></span><span>{model.enabled ? "启用" : "停用"} · JSON {model.supports_json ? "是" : "否"} · Stream {model.supports_stream ? "是" : "否"}</span><span>{model.context_window ?? "未声明"}</span><button type="button" onClick={() => setModelSheet(model)}>编辑能力</button></div>; })}</div> : <ProductEmptyState icon="⌁" title="尚未发现模型" description="选择一个已启用 Provider 执行测试并发现模型。" />}</section></WorkbenchTabPanel>
          <WorkbenchTabPanel value="routes"><section className={styles.dataSection} id="ai-route-center"><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>TASK ROUTING</span><h2>任务路由</h2></div><button className={styles.secondaryButton} type="button" onClick={() => setRouteSheetOpen(true)} disabled={!canConfigure || !online}><AppIcon name="plus" size={14} />创建路由</button></header>{routes.length ? <ul className={styles.dataList}>{routes.map((route) => <li key={route.id}><span><strong>{route.name}</strong><small>{route.task_type} · {route.model_ids.length} 个主备模型 · 输入 {route.max_input_tokens} / 输出 {route.max_output_tokens}</small></span><button type="button" disabled={!online || !canConfigure} onClick={() => void deleteRoute(route)}>删除路由</button></li>)}</ul> : <ProductEmptyState icon="⇢" title="尚未配置任务路由" description="发现并启用模型后，为常用任务建立明确路由。" />}</section></WorkbenchTabPanel>
          <WorkbenchTabPanel value="budget"><section className={styles.dataSection} id="ai-budget-center"><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>RESOURCE GUARDRAIL</span><h2>AI Token 使用上限</h2></div><ProductTag tone="info">{budget?.monthly_token_budget ?? "未设置"}</ProductTag></header><p className={styles.muted}>留空表示不设置月度 Token 上限；正式运行会在服务端再次校验。</p><button className={styles.secondaryButton} type="button" onClick={() => setBudgetSheetOpen(true)} disabled={!canConfigure || !online}><AppIcon name="files" size={14} />编辑预算</button></section></WorkbenchTabPanel>
        </WorkbenchTabs></div>}
        inspectorLabel="AI 治理检查器"
        inspector={<div className={styles.inspectorPane}><InspectorSection title="当前 Workspace"><dl className={styles.kvList}><div><dt>名称</dt><dd>{selectedWorkspace?.name ?? "未选择"}</dd></div><div><dt>角色</dt><dd>{selectedWorkspace?.role ?? "-"}</dd></div><div><dt>Provider</dt><dd>{visibleProviders.length} 个 · {visibleProviders.filter((item) => item.enabled).length} 个启用</dd></div><div><dt>月度 Token</dt><dd>{budget?.monthly_token_budget ?? "未设置"}</dd></div></dl></InspectorSection><InspectorSection title="安全边界"><p className={styles.inspectorCopy}>密钥只在服务端信封加密保存，不进入浏览器响应、IndexedDB、导出或日志。连接测试必须由你明确触发。</p>{!online ? <p className={styles.stateWarn} role="status">当前离线：Provider 配置只读，核心学习功能仍可用。</p> : selectedWorkspace && !canConfigure ? <p className={styles.stateWarn} role="status">当前角色无权配置 Provider；可继续查看核心学习内容。</p> : null}</InspectorSection><InspectorSection title="操作状态"><p className={styles.inspectorCopy} aria-live="polite">{visibleStatus}</p></InspectorSection></div>}
      />
      <WorkbenchSheet description="加密保存服务地址、密钥和连接策略；密钥不会回显。" onOpenChange={setProviderSheetOpen} open={providerSheetOpen} title="新增 OpenAI-compatible Provider"><form className={styles.sheetForm} onSubmit={(event) => { void createProvider(event).then(() => setProviderSheetOpen(false)); }}><label htmlFor="provider-name">名称</label><input id="provider-name" name="name" maxLength={120} required /><label htmlFor="provider-url">公开 HTTPS Base URL</label><input id="provider-url" name="base_url" type="url" inputMode="url" placeholder="https://api.example.com/v1" maxLength={2048} required /><label htmlFor="provider-credential">API 密钥</label><input id="provider-credential" name="credential" type="password" autoComplete="new-password" minLength={8} maxLength={8192} required /><div className={styles.formGrid}><label htmlFor="provider-timeout">超时（秒）<input id="provider-timeout" name="timeout_seconds" type="number" min={1} max={300} defaultValue={30} required /></label><label htmlFor="provider-retries">最大重试次数<input id="provider-retries" name="max_retries" type="number" min={0} max={5} defaultValue={2} required /></label></div><footer className={styles.sheetActions}><button type="button" onClick={() => setProviderSheetOpen(false)}>取消</button><button className={styles.primaryButton} disabled={!online || !canConfigure || !workspaceId}>加密保存配置</button></footer></form></WorkbenchSheet>
      <WorkbenchSheet description="留空表示不设置月度 Token 上限。" onOpenChange={setBudgetSheetOpen} open={budgetSheetOpen} title="编辑 AI 预算"><form key={budget?.version ?? 0} className={styles.sheetForm} onSubmit={(event) => { void updateBudget(event).then(() => setBudgetSheetOpen(false)); }}><label htmlFor="monthly-token-budget">Token 上限<input id="monthly-token-budget" name="monthly_token_budget" type="number" min={1} defaultValue={budget?.monthly_token_budget ?? ""} /></label><footer className={styles.sheetActions}><button type="button" onClick={() => setBudgetSheetOpen(false)}>取消</button><button className={styles.primaryButton} disabled={!online || !canConfigure || !workspaceId}>保存 Token 上限</button></footer></form></WorkbenchSheet>
      <WorkbenchSheet description="按顺序使用已勾选模型，首个为主选，其余为降级候选。" onOpenChange={setRouteSheetOpen} open={routeSheetOpen} title="创建任务路由"><form className={styles.sheetForm} onSubmit={(event) => { void createRoute(event).then(() => setRouteSheetOpen(false)); }}><label>路由名称<input name="name" maxLength={120} required /></label><label>任务类型<input name="task_type" pattern="[a-z][a-z0-9_.-]*" placeholder="user.my-task" maxLength={64} required /></label><div className={styles.formGrid}><label>最大输入 Token<input name="max_input_tokens" type="number" min={1} defaultValue={4000} required /></label><label>最大输出 Token<input name="max_output_tokens" type="number" min={1} defaultValue={1000} required /></label></div><label className={styles.checkRow}><input name="requires_json" type="checkbox" />要求结构化 JSON</label><label className={styles.checkRow}><input name="requires_stream" type="checkbox" />要求流式输出</label><fieldset><legend>模型顺序</legend>{visibleModels.map((model) => <label className={styles.checkRow} key={model.id}><input name="model_ids" type="checkbox" value={model.id} />{model.display_name}</label>)}</fieldset><footer className={styles.sheetActions}><button type="button" onClick={() => setRouteSheetOpen(false)}>取消</button><button className={styles.primaryButton} disabled={!online || !canConfigure || !workspaceId || !visibleModels.length}>创建路由</button></footer></form></WorkbenchSheet>
      <WorkbenchSheet description="模型能力来自明确触发的 Provider 发现结果。" onOpenChange={(open) => { if (!open) setModelSheet(null); }} open={modelSheet !== null} title="编辑模型能力">{modelSheet ? <form className={styles.sheetForm} onSubmit={(event) => { void updateModel(event, modelSheet).then(() => setModelSheet(null)); }}><label>显示名称<input name="display_name" defaultValue={modelSheet.display_name} maxLength={255} required /></label><label className={styles.checkRow}><input name="enabled" type="checkbox" defaultChecked={modelSheet.enabled} />启用</label><label className={styles.checkRow}><input name="supports_json" type="checkbox" defaultChecked={modelSheet.supports_json} />支持结构化 JSON</label><label className={styles.checkRow}><input name="supports_stream" type="checkbox" defaultChecked={modelSheet.supports_stream} />支持流式输出</label><label>上下文窗口<input name="context_window" type="number" min={1} max={10_000_000} defaultValue={modelSheet.context_window ?? ""} /></label><footer className={styles.sheetActions}><button type="button" onClick={() => setModelSheet(null)}>取消</button><button className={styles.primaryButton} disabled={!online || !canConfigure}>保存模型配置</button></footer></form> : null}</WorkbenchSheet>
    </section>
  );
}
