"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { LogionApiError } from "@/lib/api/client";
import { useWorkbench } from "@/platform/workbench/provider";
import { workbenchRequest, errorMessage } from "@/platform/workbench/api";
import { Button, Menu, Sheet } from "@/platform/workbench/components";
import "./settings.css";

type S = components["schemas"];
type Provider = S["AIProviderResponse"];
type Model = S["AIModelResponse"];
type Route = S["AITaskRouteResponse"];
type Budget = S["AIWorkspaceBudgetResponse"];
type Editor =
  | { kind: "provider"; row?: Provider }
  | { kind: "model"; row?: Model }
  | { kind: "route"; row?: Route }
  | { kind: "budget"; row: Budget }
  | { kind: "presets" };
const labels = {
  provider: "服务商",
  model: "模型",
  route: "任务路由",
  budget: "月度预算",
  presets: "研究路由预设",
};
const taskLabels: Record<string, string> = {
  translate: "翻译",
  explain: "解释与提问",
  close_reading: "精读草稿",
  quiz_generate: "理解测验出题",
  quiz_grade: "理解测验批改",
  link_suggest: "连线建议",
  weekly_comment: "周回顾点评",
};
function settingsError(error: unknown): string {
  if (error instanceof LogionApiError) {
    const known: Record<string, string> = {
      AI_PROVIDER_URL_BLOCKED: "服务地址必须是允许的公网 HTTPS 地址。",
      AI_PROVIDER_DNS_BLOCKED: "服务地址解析到了受限网络，连接已阻止。",
      AI_PROVIDER_DNS_UNRESOLVABLE:
        "无法解析服务地址，请检查配置和服务端网络。",
      AI_PROVIDER_AUTH_FAILED: "服务商拒绝了密钥，请更新凭据后重试。",
      RESOURCE_VERSION_CONFLICT:
        "配置已变化，或名称、任务类型已存在。当前输入已保留，请核对最新配置后再编辑。",
    };
    const message = known[error.code];
    if (message) return message;
    return `${errorMessage(error)}（${error.code}）`;
  }
  return errorMessage(error);
}
function Failure({ error }: { error: unknown }) {
  return error ? <p role="alert">{settingsError(error)}</p> : null;
}
export function AISettings() {
  const { context, workspaces } = useWorkbench();
  const workspace = workspaces.find((w) => w.id === context?.workspace_id);
  return (
    <div className="wb-page wb-config-page">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>AI 服务商与路由</h1>
          <p>为当前工作区配置模型、研究任务和月度预算。</p>
        </div>
      </div>
      {!workspace ? (
        <p>请先选择工作区。</p>
      ) : !["owner", "admin"].includes(workspace.role) ? (
        <p role="status">只有工作区所有者或管理员可以配置 AI。</p>
      ) : (
        <Configuration key={workspace.id} workspaceId={workspace.id} />
      )}
    </div>
  );
}
function Configuration({ workspaceId }: { workspaceId: string }) {
  const path = `/api/v1/workspaces/${workspaceId}/ai`;
  const key = ["workbench", "ai-settings", workspaceId];
  const client = useQueryClient();
  const providers = useQuery({
    queryKey: [...key, "providers"],
    queryFn: ({ signal }) =>
      workbenchRequest<S["AIProviderList"]>(`${path}/providers`, { signal }),
  });
  const models = useQuery({
    queryKey: [...key, "models"],
    queryFn: ({ signal }) =>
      workbenchRequest<S["AIModelList"]>(`${path}/models`, { signal }),
  });
  const routes = useQuery({
    queryKey: [...key, "routes"],
    queryFn: ({ signal }) =>
      workbenchRequest<S["AITaskRouteList"]>(`${path}/routes`, { signal }),
  });
  const budget = useQuery({
    queryKey: [...key, "budget"],
    queryFn: ({ signal }) =>
      workbenchRequest<Budget>(`${path}/budget`, { signal }),
  });
  const presets = useQuery({
    queryKey: [...key, "presets"],
    queryFn: ({ signal }) =>
      workbenchRequest<S["ResearchPresets"]>(
        `/api/v1/workspaces/${workspaceId}/research/ai/presets`,
        { signal },
      ),
  });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: "discover" | "provider" | "route";
    row: Provider | Route;
  } | null>(null);
  const [status, setStatus] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const action = useMutation({
    mutationFn: async () => {
      if (!confirmation) return;
      const { kind, row } = confirmation;
      await workbenchRequest(
        `${path}/${kind === "route" ? "routes" : "providers"}/${row.id}${kind === "discover" ? "/discover-models" : ""}`,
        {
          method: kind === "discover" ? "POST" : "DELETE",
          ...(kind === "discover"
            ? {}
            : { body: JSON.stringify({ expected_version: row.version }) }),
        },
      );
    },
    onSuccess: async () => {
      setStatus(
        confirmation?.kind === "discover"
          ? "连接检查完成，模型列表已更新。"
          : "配置已删除。已有学习内容保留。",
      );
      setConfirmation(null);
      await refresh();
    },
  });
  const open = (value: Editor) => {
    setStatus("");
    setEditor(value);
  };
  const confirm = (value: NonNullable<typeof confirmation>) => {
    action.reset();
    setConfirmation(value);
  };
  const ps = providers.data?.providers ?? [],
    ms = models.data?.models ?? [];
  const refreshing =
    providers.isFetching ||
    models.isFetching ||
    routes.isFetching ||
    budget.isFetching ||
    presets.isFetching;
  const pending =
    providers.isPending ||
    models.isPending ||
    routes.isPending ||
    budget.isPending ||
    presets.isPending;
  return (
    <>
      <p className="wb-muted">
        密钥加密保存在服务端，不会回显。保存配置和测试连接需要最近认证；只有明确测试或运行任务时才会访问服务商。
      </p>
      <Failure
        error={
          providers.error ||
          models.error ||
          routes.error ||
          budget.error ||
          presets.error
        }
      />
      <Button onClick={() => void refresh()} disabled={refreshing}>
        刷新配置
      </Button>
      {pending && <p role="status">正在读取配置…</p>}
      {status && <p role="status">{status}</p>}
      <section className="wb-config-section" aria-label="服务商连接">
        <header>
          <h2>服务商连接</h2>
          <Button onClick={() => open({ kind: "provider" })}>添加服务商</Button>
        </header>
        {!pending && !ps.length && (
          <p>还没有服务商。可以先保存连接，再测试并发现模型。</p>
        )}
        <ul className="wb-config-list">
          {ps.map((p) => (
            <li key={p.id}>
              <div>
                <h3>{p.name}</h3>
                <p className="wb-config-break">{p.base_url}</p>
                <p>
                  {p.enabled ? "已启用" : "已停用"} ·{" "}
                  {p.credential_configured ? "密钥已配置" : "未配置密钥"} ·{" "}
                  {
                    {
                      unknown: "尚未测试",
                      healthy: "连接正常",
                      unhealthy: "连接异常",
                    }[p.last_health_status]
                  }
                </p>
                {p.last_health_checked_at && (
                  <p className="wb-muted">
                    最近检查：
                    {new Date(p.last_health_checked_at).toLocaleString()}
                  </p>
                )}
                {p.last_health_error_code && (
                  <p role="alert">错误码：{p.last_health_error_code}</p>
                )}
              </div>
              <div className="wb-config-actions">
                <Button
                  onClick={() => confirm({ kind: "discover", row: p })}
                  disabled={!p.enabled || action.isPending}
                >
                  测试并发现模型
                </Button>
                <Menu
                  label={`${p.name} 更多`}
                  items={[
                    {
                      label: "编辑连接与密钥",
                      disabled: providers.isFetching,
                      action: () => open({ kind: "provider", row: p }),
                    },
                    {
                      label: "删除服务商",
                      disabled: providers.isFetching,
                      action: () => confirm({ kind: "provider", row: p }),
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="wb-config-section" aria-label="可用模型">
        <header>
          <h2>可用模型</h2>
          <Button disabled={!ps.length} onClick={() => open({ kind: "model" })}>
            手动添加模型
          </Button>
        </header>
        {!pending && !ms.length && (
          <p>测试服务商后可发现模型，也可以填写服务商提供的模型标识。</p>
        )}
        <ul className="wb-config-list">
          {ms.map((m) => (
            <li key={m.id}>
              <div>
                <h3>{m.display_name}</h3>
                <p className="wb-config-break">
                  {ps.find((p) => p.id === m.provider_id)?.name ??
                    "服务商不可用"}{" "}
                  · {m.provider_model_id}
                </p>
                <p>
                  {m.enabled ? "已启用" : "已停用"} · JSON{" "}
                  {m.supports_json ? "支持" : "未声明"} · 流式{" "}
                  {m.supports_stream ? "支持" : "未声明"}
                </p>
              </div>
              <Button onClick={() => open({ kind: "model", row: m })}>
                编辑模型
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="wb-config-section" aria-label="任务路由">
        <header>
          <h2>任务路由</h2>
          <div className="wb-config-actions">
            <Button
              disabled={!ms.length || !presets.data}
              onClick={() => open({ kind: "presets" })}
            >
              配置研究预设
            </Button>
            <Button
              disabled={!ms.length}
              onClick={() => open({ kind: "route" })}
            >
              添加路由
            </Button>
          </div>
        </header>
        <p className="wb-muted">
          模型按列表顺序作为首选与备选；连通性、能力和预算均由服务端检查。
        </p>
        {!pending && !routes.data?.routes.length && (
          <p>还没有路由。研究预设会按经济档和高质量档创建任务路由。</p>
        )}
        <ul className="wb-config-list">
          {routes.data?.routes.map((r) => (
            <li key={r.id}>
              <div>
                <h3>{r.name}</h3>
                <p>
                  {taskLabels[r.task_type] ?? r.task_type} ·{" "}
                  {r.enabled ? "已启用" : "已停用"}
                </p>
                <ol>
                  {r.model_ids.map((id) => (
                    <li key={id}>
                      {ms.find((m) => m.id === id)?.display_name ??
                        "模型不可用"}
                    </li>
                  ))}
                </ol>
                <p>
                  输入上限 {r.max_input_tokens} · 输出上限 {r.max_output_tokens}{" "}
                  tokens
                </p>
              </div>
              <Menu
                label={`${r.name} 更多`}
                items={[
                  {
                    label: "编辑路由",
                    disabled: routes.isFetching,
                    action: () => open({ kind: "route", row: r }),
                  },
                  {
                    label: "删除路由",
                    disabled: routes.isFetching,
                    action: () => confirm({ kind: "route", row: r }),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      </section>
      <section className="wb-config-section" aria-label="月度预算">
        <header>
          <h2>月度预算</h2>
          <Button
            disabled={!budget.data || budget.isFetching}
            onClick={() =>
              budget.data && open({ kind: "budget", row: budget.data })
            }
          >
            编辑预算
          </Button>
        </header>
        {budget.data && (
          <p>
            Token 上限：{budget.data.monthly_token_budget ?? "未设置"}
            ；费用上限：
            {budget.data.monthly_cost_budget_minor == null
              ? "未设置"
              : `${budget.data.monthly_cost_budget_minor} ${budget.data.currency} 最小货币单位`}
            。
          </p>
        )}
      </section>
      {editor && (
        <ConfigEditor
          key={`${editor.kind}/${"row" in editor ? (editor.row?.version ?? "new") : "new"}`}
          editor={editor}
          path={path}
          providers={ps}
          models={ms}
          presets={presets.data?.presets ?? []}
          close={() => setEditor(null)}
          saved={async () => {
            setStatus("配置已保存。");
            await refresh();
            setEditor(null);
          }}
        />
      )}
      <Sheet
        title={
          confirmation?.kind === "discover" ? "测试服务商连接" : "删除配置"
        }
        description={
          confirmation?.kind === "discover"
            ? "将发送一次最小认证请求并读取模型列表，不发送笔记、全文或想法。"
            : "此操作需要最近认证；删除服务商还会立即清除其密钥，无法撤销。请先确认没有任务依赖此配置。"
        }
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !action.isPending) setConfirmation(null);
        }}
      >
        <p>{confirmation?.row.name}</p>
        <Failure error={action.error} />
        <div className="wb-config-actions">
          <Button disabled={action.isPending} onClick={() => action.mutate()}>
            {confirmation?.kind === "discover"
              ? "确认测试连接"
              : "确认删除配置"}
          </Button>
          <Button
            disabled={action.isPending}
            onClick={() => setConfirmation(null)}
          >
            取消
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      {children}
    </label>
  );
}
function ModelOrder({
  name,
  initial,
  models,
}: {
  name: string;
  initial: string[];
  models: Model[];
}) {
  const [ids, setIds] = useState(initial.length ? initial : [""]);
  return (
    <fieldset className="wb-model-order">
      <legend>{name}</legend>
      {ids.map((id, index) => (
        <div className="wb-model-row" key={index}>
          <Field label={`${name} ${index === 0 ? "首选" : `备选 ${index}`}`}>
            <select
              required
              name={name}
              value={id}
              onChange={(e) =>
                setIds(
                  ids.map((value, i) => (i === index ? e.target.value : value)),
                )
              }
            >
              <option value="">选择模型</option>
              {models
                .filter((m) => m.id === id || !ids.includes(m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                    {m.enabled ? "" : "（已停用）"}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            aria-label={`${name}移除第 ${index + 1} 个模型`}
            disabled={ids.length === 1}
            onClick={() => setIds(ids.filter((_, i) => i !== index))}
          >
            移除
          </Button>
        </div>
      ))}
      <Button
        disabled={ids.length >= 10 || ids.length >= models.length}
        onClick={() => setIds([...ids, ""])}
      >
        添加{name}备选
      </Button>
    </fieldset>
  );
}
function ConfigEditor({
  editor,
  path,
  providers,
  models,
  presets,
  close,
  saved,
}: {
  editor: Editor;
  path: string;
  providers: Provider[];
  models: Model[];
  presets: S["ResearchPreset"][];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [id] = useState(() => crypto.randomUUID());
  const [credentialCleared, setCredentialCleared] = useState(false);
  const title = `${"row" in editor && editor.row ? "编辑" : "配置"}${labels[editor.kind]}`;
  const save = useMutation({
    mutationFn: async () => {
      const data = new FormData(form.current!);
      const text = (name: string) => String(data.get(name) ?? "");
      const number = (name: string) => Number(text(name));
      const optionalNumber = (name: string) =>
        text(name).trim() ? number(name) : null;
      const checked = (name: string) => data.has(name);
      let endpoint = path,
        method = "PUT",
        body: object;
      switch (editor.kind) {
        case "provider": {
          const row = editor.row;
          endpoint += `/providers${row ? `/${row.id}` : ""}`;
          method = row ? "PUT" : "POST";
          body = {
            ...(row
              ? { expected_version: row.version }
              : { id, provider_type: "openai_compatible" }),
            name: text("name"),
            base_url: text("base_url"),
            credential: text("credential") || null,
            enabled: checked("enabled"),
            timeout_seconds: number("timeout_seconds"),
            max_retries: number("max_retries"),
          };
          break;
        }
        case "model": {
          const row = editor.row;
          endpoint += `/models${row ? `/${row.id}` : ""}`;
          method = row ? "PUT" : "POST";
          body = {
            ...(row
              ? { expected_version: row.version }
              : {
                  id,
                  provider_id: text("provider_id"),
                  provider_model_id: text("provider_model_id"),
                }),
            display_name: text("display_name"),
            enabled: checked("enabled"),
            supports_json: checked("supports_json"),
            supports_stream: checked("supports_stream"),
            context_window: optionalNumber("context_window"),
            pricing_currency: text("pricing_currency"),
            input_cost_per_million_minor: number("input_price"),
            output_cost_per_million_minor: number("output_price"),
          };
          break;
        }
        case "route": {
          const row = editor.row;
          endpoint += `/routes${row ? `/${row.id}` : ""}`;
          method = row ? "PUT" : "POST";
          body = {
            ...(row ? { expected_version: row.version } : { id }),
            name: text("name"),
            task_type: text("task_type"),
            enabled: checked("enabled"),
            requires_json: checked("requires_json"),
            requires_stream: checked("requires_stream"),
            model_ids: data.getAll("路由模型"),
            max_input_tokens: number("max_input_tokens"),
            max_output_tokens: number("max_output_tokens"),
          };
          break;
        }
        case "budget":
          endpoint += "/budget";
          body = {
            expected_version: editor.row.version || null,
            monthly_token_budget: optionalNumber("monthly_token_budget"),
            monthly_cost_budget_minor: optionalNumber(
              "monthly_cost_budget_minor",
            ),
            currency: text("currency"),
          };
          break;
        case "presets":
          endpoint = path.replace(/\/ai$/, "/research/ai/presets");
          method = "POST";
          body = {
            economical_model_ids: data.getAll("经济档"),
            quality_model_ids: data.getAll("高质量档"),
            max_input_tokens: number("max_input_tokens"),
            max_output_tokens: number("max_output_tokens"),
          };
          break;
      }
      // Credential-bearing payload stays out of mutation variables and browser storage.
      try {
        await workbenchRequest(endpoint, {
          method,
          body: JSON.stringify(body),
        });
      } finally {
        const credential = form.current?.elements.namedItem("credential");
        if (credential instanceof HTMLInputElement) {
          credential.value = "";
          setCredentialCleared(true);
        }
      }
    },
    onSuccess: saved,
  });
  return (
    <Sheet
      title={title}
      description="保存会检查当前权限和版本。发生冲突时保留输入；关闭后可重新打开最新配置。"
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <form
        ref={form}
        className="wb-config-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Failure error={save.error} />
        {credentialCleared && save.isError && (
          <p>密钥输入已清空。如需更新密钥，请重新输入后再提交。</p>
        )}
        <fieldset disabled={save.isPending}>
          {editor.kind === "provider" && (
            <>
              <Field label="服务商名称">
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={editor.row?.name}
                />
              </Field>
              <Field label="服务地址">
                <input
                  name="base_url"
                  type="url"
                  required
                  maxLength={2048}
                  defaultValue={editor.row?.base_url}
                />
              </Field>
              <Field
                label={
                  editor.row ? "更新 API 密钥（留空保留已有密钥）" : "API 密钥"
                }
              >
                <input
                  name="credential"
                  type="password"
                  required={!editor.row}
                  minLength={8}
                  maxLength={8192}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="连接超时（秒）">
                <input
                  name="timeout_seconds"
                  type="number"
                  min={1}
                  max={300}
                  required
                  defaultValue={editor.row?.timeout_seconds ?? 30}
                />
              </Field>
              <Field label="最大重试次数">
                <input
                  name="max_retries"
                  type="number"
                  min={0}
                  max={5}
                  required
                  defaultValue={editor.row?.max_retries ?? 2}
                />
              </Field>
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={editor.row?.enabled ?? true}
                />
                启用服务商
              </label>
            </>
          )}
          {editor.kind === "model" && (
            <>
              {!editor.row && (
                <>
                  <Field label="所属服务商">
                    <select name="provider_id" required defaultValue="">
                      <option value="">选择服务商</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="模型标识">
                    <input name="provider_model_id" required maxLength={255} />
                  </Field>
                </>
              )}
              <Field label="模型显示名称">
                <input
                  name="display_name"
                  required
                  maxLength={255}
                  defaultValue={editor.row?.display_name}
                />
              </Field>
              <Field label="上下文窗口（tokens，可留空）">
                <input
                  name="context_window"
                  type="number"
                  min={1}
                  max={10000000}
                  defaultValue={editor.row?.context_window ?? ""}
                />
              </Field>
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={editor.row?.enabled ?? true}
                />
                启用模型
              </label>
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="supports_json"
                  defaultChecked={editor.row?.supports_json ?? false}
                />
                支持 JSON 输出
              </label>
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="supports_stream"
                  defaultChecked={editor.row?.supports_stream ?? false}
                />
                支持流式输出
              </label>
              <p className="wb-muted">
                按服务商实际能力填写；研究路由要求 JSON 输出。
              </p>
              <Field label="计价币种">
                <input
                  name="pricing_currency"
                  required
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  defaultValue={editor.row?.pricing_currency ?? "USD"}
                />
              </Field>
              <Field label="每百万输入 tokens 费用（最小货币单位）">
                <input
                  type="number"
                  name="input_price"
                  min={0}
                  max={1000000000}
                  required
                  defaultValue={editor.row?.input_cost_per_million_minor ?? 0}
                />
              </Field>
              <Field label="每百万输出 tokens 费用（最小货币单位）">
                <input
                  type="number"
                  name="output_price"
                  min={0}
                  max={1000000000}
                  required
                  defaultValue={editor.row?.output_cost_per_million_minor ?? 0}
                />
              </Field>
            </>
          )}
          {editor.kind === "route" && (
            <>
              <Field label="路由名称">
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={editor.row?.name}
                />
              </Field>
              <Field label="任务类型">
                <input
                  name="task_type"
                  required
                  maxLength={64}
                  pattern="[a-z][a-z0-9_.\-]*"
                  list="research-task-types"
                  defaultValue={editor.row?.task_type}
                />
              </Field>
              <datalist id="research-task-types">
                {presets.map((p) => (
                  <option key={p.task_type} value={p.task_type}>
                    {taskLabels[p.task_type] ?? p.task_type}
                  </option>
                ))}
              </datalist>
              <ModelOrder
                name="路由模型"
                initial={editor.row?.model_ids ?? []}
                models={models}
              />
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={editor.row?.enabled ?? true}
                />
                启用路由
              </label>
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="requires_json"
                  defaultChecked={editor.row?.requires_json ?? true}
                />
                要求 JSON 输出
              </label>
              <label className="wb-config-check">
                <input
                  type="checkbox"
                  name="requires_stream"
                  defaultChecked={editor.row?.requires_stream ?? false}
                />
                要求流式输出
              </label>
            </>
          )}
          {editor.kind === "presets" && (
            <>
              <p>
                为尚未配置的研究任务一起创建路由；若已有同名任务路由，整批保留原配置，请改用逐条编辑。
              </p>
              <ul>
                {presets.map((p) => (
                  <li key={p.task_type}>
                    {taskLabels[p.task_type] ?? p.task_type}：
                    {p.tier === "economical" ? "经济档" : "高质量档"}
                  </li>
                ))}
              </ul>
              <ModelOrder name="经济档" initial={[]} models={models} />
              <ModelOrder name="高质量档" initial={[]} models={models} />
            </>
          )}
          {(editor.kind === "route" || editor.kind === "presets") && (
            <>
              <Field label="输入 Token 上限">
                <input
                  name="max_input_tokens"
                  type="number"
                  min={1}
                  max={10000000}
                  required
                  defaultValue={
                    editor.kind === "route"
                      ? (editor.row?.max_input_tokens ?? 16000)
                      : 16000
                  }
                />
              </Field>
              <Field label="输出 Token 上限">
                <input
                  name="max_output_tokens"
                  type="number"
                  min={1}
                  max={editor.kind === "presets" ? 100000 : 1000000}
                  required
                  defaultValue={
                    editor.kind === "route"
                      ? (editor.row?.max_output_tokens ?? 2000)
                      : 2000
                  }
                />
              </Field>
            </>
          )}
          {editor.kind === "budget" && (
            <>
              <Field label="月度 Token 上限（留空不设上限）">
                <input
                  name="monthly_token_budget"
                  type="number"
                  min={1}
                  max={10000000000}
                  defaultValue={editor.row.monthly_token_budget ?? ""}
                />
              </Field>
              <Field label="月度费用上限（最小货币单位，留空不设上限）">
                <input
                  name="monthly_cost_budget_minor"
                  type="number"
                  min={1}
                  max={10000000000}
                  defaultValue={editor.row.monthly_cost_budget_minor ?? ""}
                />
              </Field>
              <Field label="预算币种">
                <input
                  name="currency"
                  required
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  defaultValue={editor.row.currency}
                />
              </Field>
              <p>例如美元以美分填写。费用估算采用上方模型配置的价格。</p>
            </>
          )}
          <div className="wb-config-actions">
            <Button type="submit">
              {save.isPending ? "正在保存…" : "保存配置"}
            </Button>
            <Button onClick={close}>取消</Button>
          </div>
        </fieldset>
      </form>
    </Sheet>
  );
}
