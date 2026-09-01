"use client";

import type { components } from "@logion/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  deriveProductWorkbenchState,
  type ProductWorkbenchState,
} from "@/components/product/product-workbench-state";
import {
  browserApiClient,
  isRecentAuthRequired,
  LogionApiError,
} from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Goal = components["schemas"]["GoalPlanResponse"];
type Template = components["schemas"]["TemplatePackageResponse"];
type Share = components["schemas"]["ShareSnapshotResponse"];
type WorkspaceRole = components["schemas"]["WorkspaceRole"];

export const TEMPLATE_SCOPE_VALUES = [
  "all",
  "official",
  "private",
  "workspace",
] as const;

export type TemplateScope = (typeof TEMPLATE_SCOPE_VALUES)[number];

export const TEMPLATES_COMMAND_KEYS = [
  "createShare",
  "createTemplate",
  "importTemplate",
  "installTemplate",
  "loadContext",
  "loadWorkspaceData",
  "revokeShare",
  "setInstallStartDate",
  "setSelectedTemplateId",
  "setSpaceId",
  "setTemplateQuery",
  "setTemplateScope",
  "setWorkspaceId",
  "synchronize",
] as const;

export interface TemplateCapabilities {
  canCreate: boolean;
  canImport: boolean;
  canInstall: boolean;
  canRevoke: boolean;
  canShare: boolean;
  canSync: boolean;
  canWrite: boolean;
}

export function deriveTemplateCapabilities({
  official = false,
  online,
  role,
  spaceId,
  workspaceId,
}: {
  official?: boolean;
  online: boolean;
  role: WorkspaceRole;
  spaceId: string;
  workspaceId: string;
}): TemplateCapabilities {
  const canWrite = !["reviewer", "viewer"].includes(role);
  const hasWorkspace = Boolean(workspaceId);
  const hasSpace = Boolean(spaceId);
  return {
    canCreate: !official && canWrite && online && hasWorkspace && hasSpace,
    canImport: canWrite && online && hasWorkspace,
    canInstall: canWrite && online && hasWorkspace && hasSpace,
    canRevoke: !official && canWrite && online && hasWorkspace,
    canShare: !official && canWrite && online && hasWorkspace && hasSpace,
    canSync: online && hasWorkspace,
    canWrite,
  };
}

export function buildTemplateInstallPayload({
  id,
  requiresStartDate,
  startDate,
  targetSpaceId,
  templateId,
}: {
  id: string;
  requiresStartDate: boolean;
  startDate: string;
  targetSpaceId: string;
  templateId: string;
}):
  | { ok: false; reason: "start-date-required" }
  | {
      ok: true;
      payload: {
        id: string;
        start_date: string | null;
        target_space_id: string;
        template_id: string;
      };
    } {
  if (requiresStartDate && !startDate) {
    return { ok: false, reason: "start-date-required" };
  }
  return {
    ok: true,
    payload: {
      id,
      start_date: requiresStartDate ? startDate : null,
      target_space_id: targetSpaceId,
      template_id: templateId,
    },
  };
}

export function parseTemplateImportText(
  text: string,
  byteLength: number,
):
  | { ok: false; reason: "invalid-json" | "invalid-root" | "too-large" }
  | { ok: true; value: Record<string, unknown> } {
  if (byteLength > 1_000_000) return { ok: false, reason: "too-large" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "invalid-root" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export function buildTemplateSharePayload({
  expiresInDays,
  fields,
  id,
  sourceGoalId,
  sourceSpaceId,
  title,
}: {
  expiresInDays: number;
  fields: string[];
  id: string;
  sourceGoalId: string;
  sourceSpaceId: string;
  title: string;
}) {
  return {
    id,
    source_goal_id: sourceGoalId,
    source_space_id: sourceSpaceId,
    title,
    fields,
    expires_in_days: expiresInDays,
  };
}

export function buildTemplateRevokePayload(expectedVersion: number) {
  return { expected_version: expectedVersion };
}

export interface TemplatesControllerContext {
  capabilities: TemplateCapabilities;
  contextPhase: "error" | "loading" | "ready";
  dataPhase: "error" | "idle" | "loading" | "ready";
  goals: Goal[];
  installStartDates: Record<string, string>;
  newShareToken: string;
  online: boolean;
  recentAuthRequired: boolean;
  selectedSpace?: Space;
  selectedTemplate: Template | null;
  selectedTemplateIsOfficial: boolean;
  selectedWorkspace?: Workspace;
  shares: Share[];
  spaceId: string;
  spaces: Space[];
  status: string;
  templateQuery: string;
  templateScope: TemplateScope;
  templates: Template[];
  templateState: ProductWorkbenchState;
  visibleGoals: Goal[];
  visibleShares: Share[];
  visibleSpaces: Space[];
  visibleTemplates: Template[];
  workspaceId: string;
  workspaces: Workspace[];
}

export interface TemplatesControllerActions {
  createShare: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  createTemplate: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  importTemplate: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  installTemplate: (template: Template, startDate?: string) => Promise<boolean>;
  loadContext: () => Promise<void>;
  loadWorkspaceData: (workspaceId: string) => Promise<void>;
  revokeShare: (share: Share) => Promise<boolean>;
  setInstallStartDate: (templateId: string, value: string) => void;
  setSelectedTemplateId: (value: string) => void;
  setSpaceId: (value: string) => void;
  setTemplateQuery: (value: string) => void;
  setTemplateScope: (value: TemplateScope) => void;
  setWorkspaceId: (value: string) => void;
  synchronize: () => Promise<void>;
}

export interface TemplatesControllerResult {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
}

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
    if (error.code === "TEMPLATE_PRIVATE_SOURCE_BLOCKED")
      return "私有 Space 只能创建私有模板；workspace 模板必须来自共享 Space。";
    if (error.code === "TEMPLATE_START_DATE_REQUIRED")
      return "此模板包含相对日期；请选择安装起始日期。";
    if (error.status === 403)
      return `当前角色或 Space 权限不允许此操作${requestSuffix(error)}。`;
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "操作未完成；已有学习数据不受影响。";
}

function contextSelectionKey() {
  return "logion:workbench-context:templates";
}

function readContextSelection() {
  if (typeof window === "undefined") return { spaceId: "", workspaceId: "" };
  try {
    const raw = window.sessionStorage.getItem(contextSelectionKey());
    if (!raw) return { spaceId: "", workspaceId: "" };
    const parsed = JSON.parse(raw) as {
      spaceId?: unknown;
      workspaceId?: unknown;
    };
    return {
      spaceId: typeof parsed.spaceId === "string" ? parsed.spaceId : "",
      workspaceId:
        typeof parsed.workspaceId === "string" ? parsed.workspaceId : "",
    };
  } catch {
    return { spaceId: "", workspaceId: "" };
  }
}

export function templateHasRelativeDate(
  template: Pick<Template, "object_graph">,
) {
  const goalPlan = template.object_graph.goal_plan;
  return (
    typeof goalPlan === "object" &&
    goalPlan !== null &&
    typeof (goalPlan as { target_day_offset?: unknown }).target_day_offset ===
      "number"
  );
}

export function useTemplatesController(): TemplatesControllerResult {
  const [initialSelection] = useState(readContextSelection);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(initialSelection.workspaceId);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState(initialSelection.spaceId);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [goalsSpaceId, setGoalsSpaceId] = useState("");
  const [newShareToken, setNewShareToken] = useState("");
  const [installStartDates, setInstallStartDates] = useState<
    Record<string, string>
  >({});
  const [online, setOnline] = useState(true);
  const [recentAuthRequired, setRecentAuthRequired] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateScope, setTemplateScope] = useState<TemplateScope>("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const [status, setStatus] = useState(
    "模板安装会复制为独立对象；分享默认只读且可撤销。",
  );
  const dataRequestRef = useRef(0);

  const loadContext = useCallback(async () => {
    setContextPhase("loading");
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
      setContextPhase("ready");
    } catch (error) {
      setContextPhase("error");
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }, []);

  const loadWorkspaceData = useCallback(async (selected: string) => {
    const requestId = ++dataRequestRef.current;
    setDataPhase("loading");
    try {
      const [spaceResult, templateResult, shareResult] =
        await Promise.allSettled([
          browserApiClient.request<{ spaces: Space[] }>(
            `/api/v1/workspaces/${selected}/spaces`,
          ),
          browserApiClient.request<{ templates: Template[] }>(
            `/api/v1/workspaces/${selected}/templates`,
          ),
          browserApiClient.request<{ shares: Share[] }>(
            `/api/v1/workspaces/${selected}/shares`,
          ),
        ]);
      if (requestId !== dataRequestRef.current) return;
      if (spaceResult.status === "rejected") throw spaceResult.reason;
      if (templateResult.status === "rejected") throw templateResult.reason;
      const nextSpaces = Array.isArray(spaceResult.value.spaces)
        ? spaceResult.value.spaces
        : [];
      setSpaces(nextSpaces);
      setTemplates(
        Array.isArray(templateResult.value.templates)
          ? templateResult.value.templates
          : [],
      );
      setShares(
        shareResult.status === "fulfilled" &&
          Array.isArray(shareResult.value.shares)
          ? shareResult.value.shares
          : [],
      );
      setDataWorkspaceId(selected);
      setSpaceId((current) =>
        nextSpaces.some((item) => item.id === current)
          ? current
          : (nextSpaces[0]?.id ?? ""),
      );
      setDataPhase("ready");
    } catch (error) {
      if (requestId !== dataRequestRef.current) return;
      setSpaces([]);
      setTemplates([]);
      setShares([]);
      setDataWorkspaceId(selected);
      setDataPhase("error");
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }, []);

  const loadGoals = useCallback(async (workspace: string, space: string) => {
    try {
      const result = await browserApiClient.request<{ goals: Goal[] }>(
        `/api/v1/workspaces/${workspace}/spaces/${space}/goals`,
      );
      setGoals(Array.isArray(result.goals) ? result.goals : []);
      setGoalsSpaceId(space);
    } catch (error) {
      setGoals([]);
      setGoalsSpaceId(space);
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadContext());
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [loadContext]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        contextSelectionKey(),
        JSON.stringify({ spaceId, workspaceId }),
      );
    } catch {
      // Session storage is optional; API context remains authoritative.
    }
  }, [spaceId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !online) return;
    queueMicrotask(() => void loadWorkspaceData(workspaceId));
  }, [loadWorkspaceData, online, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !spaceId || !online) return;
    queueMicrotask(() => void loadGoals(workspaceId, spaceId));
  }, [loadGoals, online, spaceId, workspaceId]);

  const visibleSpaces = useMemo(
    () => (dataWorkspaceId === workspaceId ? spaces : []),
    [dataWorkspaceId, spaces, workspaceId],
  );
  const visibleGoals = useMemo(
    () => (goalsSpaceId === spaceId ? goals : []),
    [goals, goalsSpaceId, spaceId],
  );
  const visibleTemplates = useMemo(
    () => (dataWorkspaceId === workspaceId ? templates : []),
    [dataWorkspaceId, templates, workspaceId],
  );
  const visibleShares = useMemo(
    () => (dataWorkspaceId === workspaceId ? shares : []),
    [dataWorkspaceId, shares, workspaceId],
  );
  const filteredTemplates = useMemo(() => {
    const normalized = templateQuery.trim().toLocaleLowerCase();
    return visibleTemplates.filter((template) => {
      const matchesScope =
        templateScope === "all" || template.visibility === templateScope;
      const matchesQuery =
        !normalized ||
        [
          template.name,
          template.description,
          template.author_name,
          template.license,
          ...template.target_personas,
        ].some((value) => value.toLocaleLowerCase().includes(normalized));
      return matchesScope && matchesQuery;
    });
  }, [templateQuery, templateScope, visibleTemplates]);
  const selectedTemplate =
    filteredTemplates.find((template) => template.id === selectedTemplateId) ??
    filteredTemplates[0] ??
    null;
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const selectedSpace = visibleSpaces.find((item) => item.id === spaceId);
  const capabilities = deriveTemplateCapabilities({
    official: selectedTemplate?.visibility === "official",
    online,
    role: selectedWorkspace?.role ?? "viewer",
    spaceId,
    workspaceId,
  });
  const templateState = deriveProductWorkbenchState({
    contextPhase,
    dataPhase,
    hasContext: Boolean(workspaceId && spaceId),
    hasData: visibleTemplates.length > 0 || visibleGoals.length > 0,
    stale: !online,
    unlocked: true,
  });

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities.canCreate || !visibleGoals.length) return false;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const created = await browserApiClient.request<{ id: string }>(
        `/api/v1/workspaces/${workspaceId}/templates/from-goal`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            template_key: crypto.randomUUID(),
            previous_template_id: null,
            source_space_id: spaceId,
            source_goal_id: String(data.get("source_goal_id") ?? ""),
            name: String(data.get("name") ?? ""),
            description: String(data.get("description") ?? ""),
            product_min_version: "0.1.0",
            author_name: String(data.get("author_name") ?? ""),
            license: String(data.get("license") ?? ""),
            locale: String(data.get("locale") ?? "zh-CN"),
            target_personas: String(data.get("target_personas") ?? "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            changelog: String(data.get("changelog") ?? ""),
            visibility: String(data.get("visibility") ?? "private"),
          }),
        },
      );
      form.reset();
      await loadWorkspaceData(workspaceId);
      setRecentAuthRequired(false);
      setSelectedTemplateId(created.id);
      setStatus("模板版本已创建；安装时会生成全新的目标、计划和阶段 ID。");
      return true;
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function installTemplate(template: Template, startDate = "") {
    if (!capabilities.canInstall) return false;
    const effectiveStartDate =
      startDate || installStartDates[template.id] || "";
    const install = buildTemplateInstallPayload({
      id: crypto.randomUUID(),
      requiresStartDate: templateHasRelativeDate(template),
      startDate: effectiveStartDate,
      targetSpaceId: spaceId,
      templateId: template.id,
    });
    if (!install.ok) {
      setStatus("此模板包含相对日期；请先选择安装起始日期。");
      return false;
    }
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/template-installations`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify(install.payload),
        },
      );
      await loadGoals(workspaceId, spaceId);
      setRecentAuthRequired(false);
      setStatus("模板已安装为独立计划；后续模板版本不会覆盖此副本。");
      return true;
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function importTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities.canImport) return false;
    const form = event.currentTarget;
    const file = new FormData(form).get("template_file");
    if (!(file instanceof File) || file.size === 0) return false;
    try {
      const parsed = parseTemplateImportText(await file.text(), file.size);
      if (!parsed.ok) {
        setStatus(
          parsed.reason === "too-large"
            ? "模板文件超过 1 MB 上限，未读取或上传。"
            : parsed.reason === "invalid-json"
              ? "模板不是有效 JSON。"
              : "模板包根节点必须是 JSON 对象。",
        );
        return false;
      }
      const imported = await browserApiClient.request<{ id: string }>(
        `/api/v1/workspaces/${workspaceId}/templates/import`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify(parsed.value),
        },
      );
      form.reset();
      await loadWorkspaceData(workspaceId);
      setRecentAuthRequired(false);
      setSelectedTemplateId(imported.id);
      setStatus(
        "模板包已通过结构校验并加入私有模板库；检查风险链接后再选择日期安装。",
      );
      return true;
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities.canShare || !visibleGoals.length) return false;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await browserApiClient.request<{ token: string }>(
        `/api/v1/workspaces/${workspaceId}/shares`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify(
            buildTemplateSharePayload({
              expiresInDays: Number(data.get("expires_in_days") ?? 30),
              fields: data.getAll("fields").map(String),
              id: crypto.randomUUID(),
              sourceGoalId: String(data.get("source_goal_id") ?? ""),
              sourceSpaceId: spaceId,
              title: String(data.get("title") ?? ""),
            }),
          ),
        },
      );
      setNewShareToken(result.token);
      form.reset();
      await loadWorkspaceData(workspaceId);
      setRecentAuthRequired(false);
      setStatus("只读分享已创建。请立即保存链接；Token 不会再次显示。");
      return true;
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
      return false;
    }
  }

  async function revokeShare(share: Share) {
    if (!capabilities.canWrite || !online || !workspaceId) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/shares/${share.id}/revoke`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify(buildTemplateRevokePayload(share.version)),
        },
      );
      await loadWorkspaceData(workspaceId);
      setRecentAuthRequired(false);
      setStatus("分享已撤销，原链接立即失效。");
      return true;
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
      return false;
    }
  }

  const context: TemplatesControllerContext = {
    capabilities,
    contextPhase,
    dataPhase,
    goals,
    installStartDates,
    newShareToken,
    online,
    recentAuthRequired,
    selectedSpace,
    selectedTemplate,
    selectedTemplateIsOfficial: selectedTemplate?.visibility === "official",
    selectedWorkspace,
    shares,
    spaceId,
    spaces,
    status,
    templateQuery,
    templateScope,
    templates,
    templateState,
    visibleGoals,
    visibleShares,
    visibleSpaces,
    visibleTemplates: filteredTemplates,
    workspaceId,
    workspaces,
  };

  const actions: TemplatesControllerActions = {
    createShare,
    createTemplate,
    importTemplate,
    installTemplate,
    loadContext,
    loadWorkspaceData,
    revokeShare,
    setInstallStartDate: (templateId, value) =>
      setInstallStartDates((current) => ({ ...current, [templateId]: value })),
    setSelectedTemplateId,
    setSpaceId,
    setTemplateQuery,
    setTemplateScope,
    setWorkspaceId: (value) => {
      setWorkspaceId(value);
      setSpaceId("");
      setGoals([]);
      setGoalsSpaceId("");
    },
    synchronize: async () => {
      if (!online) {
        setStatus("当前离线；模板配置保留在本机，恢复连接后可继续。");
        return;
      }
      if (workspaceId) await loadWorkspaceData(workspaceId);
      setStatus("模板与分享目录已刷新。");
    },
  };

  return { actions, context };
}
