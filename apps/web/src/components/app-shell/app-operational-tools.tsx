"use client";

import Link from "next/link";
import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  OfflineStorageError,
  ProtectedOfflineRepository,
  SyncClient,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type OfflineVault,
  type SyncTransport,
} from "@logion/offline";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { AppIcon } from "@/components/app-shell/app-icon";
import { AppModal } from "@/components/app-shell/app-modal";
import { operationalEventName } from "@/components/app-shell/app-operational-events";
import { useSession } from "@/features/auth/session-provider";
import { offlineCapabilityMessage } from "@/features/offline/offline-error-message";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import {
  incompleteSyncMessage,
  matchesVaultSession,
} from "@/features/sync/sync-diagnostics";
import { browserApiClient, LogionApiError } from "@/lib/api/client";
import { feedback as globalFeedback } from "@/lib/feedback";
import { mutationTimestamp } from "@/lib/offline/mutation-timestamp";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];
type OperationalOverlay = "capture" | "focus" | "vault";
type CaptureType = "inbox_item" | "note";
type FeedbackTone = "error" | "loading" | "success" | "warning";
type RetryAction = "context" | "focus" | "sync";

export const GLOBAL_CAPTURE_TRIGGER_CLASS =
  "app-icon-button app-capture-trigger";

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

interface Feedback {
  message: string;
  retry?: RetryAction;
  tone: FeedbackTone;
}

interface TaskPayload extends JsonObject {
  space_id: string;
  goal_id: string;
  phase_id: string | null;
  title: string;
  description: string;
  status:
    | "backlog"
    | "blocked"
    | "cancelled"
    | "done"
    | "in_progress"
    | "planned"
    | "submitted"
    | "verified";
  priority: number;
  estimated_minutes: number;
  planned_at: string | null;
  due_at: string | null;
  blocked_reason: string | null;
}

interface SessionPayload extends JsonObject {
  space_id: string;
  task_id: string;
  status: "active" | "completed" | "abandoned";
  started_at: string;
  ended_at: string | null;
  manual_minutes: number | null;
  reflection: string;
  outcome: "completed" | "abandoned" | null;
}

interface LocalView<T extends JsonObject> {
  entity: LocalEntity;
  payload: T;
}

function actionError(error: unknown): string {
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null) return capabilityMessage;
  if (error instanceof LogionApiError) {
    return `操作未完成（请求编号：${error.requestId}）。`;
  }
  if (
    error instanceof OfflineStorageError &&
    error.code === "OFFLINE_INPUT_INVALID"
  ) {
    return "本地数据或同步响应未通过安全校验。";
  }
  if (error instanceof OfflineStorageError) {
    return `本地资料操作未完成（${error.code}）。`;
  }
  return "操作未完成，请检查网络与本地资料状态后重试。";
}

function unlockError(error: unknown): string {
  if (
    error instanceof OfflineStorageError &&
    error.code === "OFFLINE_INPUT_INVALID"
  ) {
    return "本地口令不正确，或输入不符合要求。";
  }
  return actionError(error);
}

function transport(workspaceId: string): SyncTransport {
  const call = (path: string, request: unknown, csrf = false) =>
    browserApiClient.request(`/api/v1/workspaces/${workspaceId}/sync/${path}`, {
      method: "POST",
      csrf,
      body: JSON.stringify(request),
    });
  return {
    push: (request) => call("push", request, true),
    pull: (request) => call("pull", request),
  };
}

async function ensureBootstrap(
  database: LogionOfflineDatabase,
  vault: OfflineVault,
  workspaceId: string,
  deviceId: string,
  isCurrent: () => boolean,
): Promise<void> {
  const current = await database.syncState.get(workspaceId);
  if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
  if (current?.bootstrap_state === "ready" && current.device_id === deviceId) {
    return;
  }
  const repository = new BootstrapRepository(database, {}, vault);
  const fetchChunk = (snapshotId: string | null, chunkIndex: number | null) =>
    browserApiClient.request<unknown>(
      `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
      {
        method: "POST",
        body: JSON.stringify({
          message_type: "bootstrap_request",
          protocol_version: "sync-v1",
          workspace_id: workspaceId,
          device_id: deviceId,
          known_sync_epoch: current?.sync_epoch ?? null,
          snapshot_id: snapshotId,
          chunk_index: chunkIndex,
        }),
      },
    );
  const first = await fetchChunk(null, null);
  if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
  const validation = validateSyncV1Message(first);
  if (
    !validation.ok ||
    validation.value.message_type !== "bootstrap_response"
  ) {
    throw new Error("invalid bootstrap response");
  }
  const manifest = validation.value;
  await repository.prepareDeviceRebootstrap(first, {
    workspace_id: workspaceId,
    device_id: deviceId,
  });
  if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
  await repository.stageChunk(first, {
    workspace_id: workspaceId,
    device_id: deviceId,
  });
  for (let index = 1; index < manifest.chunk_count; index += 1) {
    if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
    const chunk = await fetchChunk(manifest.snapshot_id, index);
    if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
    await repository.stageChunk(chunk, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
  }
}

async function synchronizeWorkspace(
  database: LogionOfflineDatabase,
  vault: OfflineVault,
  workspaceId: string,
  deviceId: string,
  isCurrent: () => boolean,
): Promise<void> {
  await ensureBootstrap(database, vault, workspaceId, deviceId, isCurrent);
  if (!isCurrent()) throw new Error("操作上下文已改变，请重新操作。");
  const result = await new SyncClient(
    database,
    transport(workspaceId),
    vault,
  ).synchronize(workspaceId, deviceId);
  const entries = await database.outbox
    .where("workspace_id")
    .equals(workspaceId)
    .toArray();
  const incomplete = incompleteSyncMessage(result, entries);
  if (incomplete) throw new Error(incomplete);
}

async function decrypt<T extends JsonObject>(
  vault: OfflineVault,
  entity: LocalEntity,
): Promise<LocalView<T>> {
  const reference = entity.payload.encrypted_payload_ref;
  const payload =
    typeof reference === "string"
      ? await vault.get(reference, entity.workspace_id)
      : entity.payload;
  if (payload === null) throw new Error("protected payload unavailable");
  return { entity, payload: payload as T };
}

function formatElapsed(startedAt: string, now: number): string {
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function OperationFeedback({
  feedback,
  onRetry,
}: Readonly<{
  feedback: Feedback | null;
  onRetry: (action: RetryAction) => void;
}>) {
  if (feedback === null) return null;
  return (
    <div
      aria-live="polite"
      className={`app-operation-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true" className="app-operation-indicator" />
      <span>{feedback.message}</span>
      {feedback.retry ? (
        <button type="button" onClick={() => onRetry(feedback.retry!)}>
          重试
        </button>
      ) : null}
    </div>
  );
}

function AppOperationalToolsContent() {
  const { state: session } = useSession();
  const {
    activeDatabase,
    activeVault,
    database,
    expiresAt,
    lock,
    markChanged,
    phase: vaultPhase,
    revision,
    unlock,
    vault,
  } = useVaultSession();
  const [overlay, setOverlay] = useState<OperationalOverlay | null>(null);
  const [captureType, setCaptureType] = useState<CaptureType>("inbox_item");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<LocalView<TaskPayload>[]>([]);
  const [sessions, setSessions] = useState<LocalView<SessionPayload>[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const mounted = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );
  const vaultButtonRef = useRef<HTMLButtonElement>(null);
  const captureButtonRef = useRef<HTMLButtonElement>(null);
  const focusButtonRef = useRef<HTMLButtonElement>(null);
  const captureInFlight = useRef<number | null>(null);
  const unlocked = vaultPhase === "unlocked";
  const generation = useRef(0);
  const contextRequest = useRef(0);
  const spaceRequest = useRef(0);
  const focusRequest = useRef(0);
  const currentWorkspace = useRef(workspaceId);
  const [spacesWorkspace, setSpacesWorkspace] = useState("");

  useLayoutEffect(() => {
    const version = ++generation.current;
    currentWorkspace.current = workspaceId;
    focusRequest.current += 1;
    queueMicrotask(() => {
      if (version !== generation.current) return;
      setTasks([]);
      setSessions([]);
      setSelectedTaskId("");
      setFeedback(null);
      setBusy(false);
    });
    return () => {
      generation.current += 1;
    };
  }, [activeDatabase, activeVault, workspaceId, deviceId, spaceId, overlay]);

  const operationIsCurrent = useCallback(() => {
    const version = generation.current;
    return () =>
      version === generation.current &&
      matchesVaultSession(database, vault, activeDatabase, activeVault);
  }, [activeDatabase, activeVault, database, vault]);

  const openOverlay = useCallback((nextOverlay: OperationalOverlay) => {
    if (nextOverlay === "focus" || nextOverlay === "vault")
      setClockNow(Date.now());
    setFeedback(null);
    setOverlay(nextOverlay);
  }, []);

  useEffect(() => {
    const openCapture = () => openOverlay("capture");
    const openFocus = () => openOverlay("focus");
    window.addEventListener(operationalEventName("capture"), openCapture);
    window.addEventListener(operationalEventName("focus"), openFocus);
    return () => {
      window.removeEventListener(operationalEventName("capture"), openCapture);
      window.removeEventListener(operationalEventName("focus"), openFocus);
    };
  }, [openOverlay]);

  const loadContext = useCallback(async () => {
    const request = ++contextRequest.current;
    setFeedback({ message: "正在读取工作区与设备…", tone: "loading" });
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      if (request !== contextRequest.current) return;
      const nextWorkspaces = workspaceResult.workspaces;
      const currentDevice = deviceResult.devices.find((item) => item.current);
      setWorkspaces(nextWorkspaces);
      setWorkspaceId((current) =>
        nextWorkspaces.some((item) => item.id === current)
          ? current
          : (nextWorkspaces[0]?.id ?? ""),
      );
      setDeviceId(currentDevice?.id ?? "");
      setFeedback(
        currentDevice
          ? null
          : {
              message: "没有找到当前设备，暂时不能保存离线记录。",
              retry: "context",
              tone: "error",
            },
      );
    } catch (error) {
      if (request !== contextRequest.current) return;
      setFeedback({
        message: actionError(error),
        retry: "context",
        tone: "error",
      });
    }
  }, []);

  const loadSpaces = useCallback(async (selectedWorkspaceId: string) => {
    const request = ++spaceRequest.current;
    setSpaces([]);
    setSpaceId("");
    setSpacesWorkspace("");
    try {
      const result = await browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${selectedWorkspaceId}/spaces`,
      );
      if (
        request !== spaceRequest.current ||
        selectedWorkspaceId !== currentWorkspace.current
      )
        return;
      setSpaces(result.spaces);
      setSpacesWorkspace(selectedWorkspaceId);
      setSpaceId((current) =>
        result.spaces.some((item) => item.id === current)
          ? current
          : (result.spaces[0]?.id ?? ""),
      );
    } catch (error) {
      if (
        request !== spaceRequest.current ||
        selectedWorkspaceId !== currentWorkspace.current
      )
        return;
      setSpaces([]);
      setSpaceId("");
      setFeedback({
        message: actionError(error),
        retry: "context",
        tone: "error",
      });
    }
  }, []);

  useEffect(() => {
    if (session.status === "authenticated") {
      queueMicrotask(() => void loadContext());
    }
    return () => {
      contextRequest.current += 1;
    };
  }, [loadContext, session.status]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadSpaces(workspaceId));
    return () => {
      spaceRequest.current += 1;
    };
  }, [loadSpaces, workspaceId]);

  const readFocusData = useCallback(async () => {
    const db = activeDatabase;
    const localVault = activeVault;
    if (
      !matchesVaultSession(database, vault, db, localVault) ||
      db === null ||
      localVault === null ||
      !workspaceId
    )
      return;
    const version = generation.current;
    const request = ++focusRequest.current;
    const [taskRows, sessionRows] = await Promise.all([
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "task"])
        .toArray(),
      db.entities
        .where("[workspace_id+entity_type]")
        .equals([workspaceId, "study_session"])
        .toArray(),
    ]);
    const [nextTasks, nextSessions] = await Promise.all([
      Promise.all(
        taskRows.map((item) => decrypt<TaskPayload>(localVault, item)),
      ),
      Promise.all(
        sessionRows.map((item) => decrypt<SessionPayload>(localVault, item)),
      ),
    ]);
    if (
      version !== generation.current ||
      request !== focusRequest.current ||
      !matchesVaultSession(database, vault, db, localVault)
    )
      return;
    setTasks(nextTasks);
    setSessions(nextSessions);
  }, [activeDatabase, activeVault, database, vault, workspaceId]);

  const loadFocusData = useCallback(async () => {
    const db = activeDatabase;
    const localVault = activeVault;
    if (db === null || localVault === null || !workspaceId || !deviceId) return;
    const isCurrent = operationIsCurrent();
    if (!isCurrent()) return;
    setBusy(true);
    setFeedback({ message: "正在读取真实任务与专注会话…", tone: "loading" });
    let syncError: unknown;
    try {
      await synchronizeWorkspace(
        db,
        localVault,
        workspaceId,
        deviceId,
        isCurrent,
      );
      if (!isCurrent()) return;
      markChanged();
    } catch (error) {
      syncError = error;
    }
    try {
      if (!isCurrent()) return;
      await readFocusData();
      if (!isCurrent()) return;
      setFeedback(
        syncError
          ? {
              message: "已显示本机任务；服务器同步暂未完成。",
              retry: "focus",
              tone: "warning",
            }
          : { message: "任务与专注会话已更新。", tone: "success" },
      );
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({
        message: actionError(error),
        retry: "focus",
        tone: "error",
      });
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [
    activeDatabase,
    activeVault,
    deviceId,
    markChanged,
    operationIsCurrent,
    readFocusData,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      overlay === "focus" &&
      unlocked &&
      workspaceId &&
      deviceId &&
      spaceId &&
      spacesWorkspace === workspaceId
    ) {
      queueMicrotask(() => void loadFocusData());
    }
  }, [
    deviceId,
    loadFocusData,
    overlay,
    unlocked,
    workspaceId,
    spaceId,
    spacesWorkspace,
  ]);

  useEffect(() => {
    if (overlay !== "focus" || !unlocked) return;
    queueMicrotask(() => {
      const isCurrent = operationIsCurrent();
      void readFocusData().catch((error: unknown) => {
        if (isCurrent())
          setFeedback({
            message: actionError(error),
            retry: "focus",
            tone: "error",
          });
      });
    });
  }, [revision, spaceId, overlay, unlocked, operationIsCurrent, readFocusData]);

  const activeSession = sessions.find(
    (item) => item.payload.status === "active",
  );
  const actionableTasks = useMemo(
    () =>
      tasks.filter(
        (item) =>
          item.payload.space_id === spaceId &&
          ["planned", "in_progress"].includes(item.payload.status),
      ),
    [spaceId, tasks],
  );
  const selectedTask =
    actionableTasks.find((item) => item.entity.entity_id === selectedTaskId) ??
    actionableTasks[0];

  useEffect(() => {
    if (
      overlay !== "vault" &&
      (overlay !== "focus" || activeSession === undefined)
    )
      return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeSession, overlay]);

  async function commitEntity(
    isCurrent: () => boolean,
    entityType: "inbox_item" | "note" | "study_session" | "task",
    entityId: string,
    payload: JsonObject,
    existing?: LocalEntity,
    dependencies: string[] = [],
  ) {
    if (!isCurrent() || session.status !== "authenticated") {
      throw new Error("context changed");
    }
    const db = activeDatabase;
    const localVault = activeVault;
    if (db === null || localVault === null) throw new Error("vault locked");
    const now = new Date().toISOString();
    return new ProtectedOfflineRepository(db, localVault).commitMutation({
      operation_id: crypto.randomUUID(),
      protocol_version: "sync-v1",
      workspace_id: workspaceId,
      device_id: deviceId,
      entity_type: entityType,
      entity_id: entityId,
      operation_type: existing ? "update" : "create",
      base_version: existing?.server_version ?? 0,
      local_revision: (existing?.local_revision ?? 0) + 1,
      client_occurred_at: now,
      created_at: existing?.created_at ?? now,
      updated_at: mutationTimestamp(existing, now),
      deleted_at: null,
      created_by: existing?.created_by ?? session.user.id,
      updated_by: session.user.id,
      payload,
      dependencies,
    });
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setFeedback({ message: "正在派生本地密钥…", tone: "loading" });
    try {
      const result = await unlock(
        String(new FormData(form).get("passphrase") ?? ""),
      );
      if (!form.isConnected) return;
      form.reset();
      setFeedback({
        message: result.initialized
          ? "本地 Vault 已初始化并解锁。"
          : "本地 Vault 已解锁，可在应用内访问加密资料。",
        tone: "success",
      });
    } catch (error) {
      if (!form.isConnected) return;
      setFeedback({ message: unlockError(error), tone: "error" });
    } finally {
      if (form.isConnected) setBusy(false);
    }
  }

  async function retrySync() {
    const db = activeDatabase;
    const localVault = activeVault;
    if (db === null || localVault === null || !workspaceId || !deviceId) return;
    const isCurrent = operationIsCurrent();
    if (!isCurrent()) return;
    setBusy(true);
    setFeedback({ message: "正在重试同步…", tone: "loading" });
    try {
      await synchronizeWorkspace(
        db,
        localVault,
        workspaceId,
        deviceId,
        isCurrent,
      );
      if (!isCurrent()) return;
      markChanged();
      if (!isCurrent()) return;
      await readFocusData();
      if (!isCurrent()) return;
      setFeedback({ message: "本地修改已与服务器同步。", tone: "success" });
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({
        message: `${actionError(error)} 本地记录仍保留。`,
        retry: "sync",
        tone: "error",
      });
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  function retry(action: RetryAction) {
    if (action === "context") {
      void loadContext();
      if (workspaceId) void loadSpaces(workspaceId);
    }
    if (action === "focus") void loadFocusData();
    if (action === "sync") void retrySync();
  }

  async function saveCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const captureVersion = generation.current;
    if (captureInFlight.current === captureVersion) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const closeAfterSave =
      submitter instanceof HTMLButtonElement && submitter.value === "close";
    const db = activeDatabase;
    const localVault = activeVault;
    if (
      db === null ||
      localVault === null ||
      !workspaceId ||
      !spaceId ||
      spacesWorkspace !== workspaceId ||
      !spaces.some((space) => space.id === spaceId)
    )
      return;
    const data = new FormData(form);
    const isCurrent = operationIsCurrent();
    if (!isCurrent()) return;
    captureInFlight.current = captureVersion;
    let saved = false;
    setBusy(true);
    setFeedback({ message: "正在加密保存…", tone: "loading" });
    try {
      await ensureBootstrap(db, localVault, workspaceId, deviceId, isCurrent);
      if (!isCurrent()) return;
      markChanged();
      const title = String(data.get("title") ?? "").trim();
      const body = String(data.get("body") ?? "").trim();
      await commitEntity(
        isCurrent,
        captureType,
        crypto.randomUUID(),
        captureType === "note"
          ? {
              space_id: spaceId,
              task_id: null,
              title,
              markdown_body: body,
            }
          : { space_id: spaceId, title, note: body },
      );
      if (!isCurrent()) return;
      markChanged();
      if (!isCurrent()) return;
      form.reset();
      saved = true;
      const destination = captureType === "note" ? "笔记" : "学习收件箱内容";
      let result: Feedback;
      try {
        await synchronizeWorkspace(
          db,
          localVault,
          workspaceId,
          deviceId,
          isCurrent,
        );
        if (!isCurrent()) return;
        result = {
          message: `${destination}已加密保存并同步。`,
          tone: "success",
        };
      } catch {
        if (!isCurrent()) return;
        result = {
          message: `${destination}已加密保存在本机；服务器同步暂未完成。`,
          retry: "sync",
          tone: "warning",
        };
      }
      if (closeAfterSave) {
        closeOverlay();
        globalFeedback.success(result.message);
      } else {
        setFeedback(result);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({ message: actionError(error), tone: "error" });
    } finally {
      if (captureInFlight.current === captureVersion)
        captureInFlight.current = null;
      if (isCurrent()) {
        setBusy(false);
        if (saved)
          requestAnimationFrame(() => {
            if (isCurrent())
              form.querySelector<HTMLInputElement>('[name="title"]')?.focus();
          });
      }
    }
  }

  async function startFocus() {
    if (selectedTask === undefined || activeSession !== undefined) return;
    const db = activeDatabase;
    const localVault = activeVault;
    if (db === null || localVault === null) return;
    const isCurrent = operationIsCurrent();
    if (!isCurrent()) return;
    setBusy(true);
    setFeedback({ message: "正在开始专注会话…", tone: "loading" });
    try {
      let taskEntity = selectedTask.entity;
      let dependencies: string[] = [];
      if (selectedTask.payload.status === "planned") {
        const transition = await commitEntity(
          isCurrent,
          "task",
          selectedTask.entity.entity_id,
          {
            ...selectedTask.payload,
            status: "in_progress",
            blocked_reason: null,
          },
          selectedTask.entity,
        );
        taskEntity = transition.entity;
        dependencies = [transition.operation.operation_id];
      }
      await commitEntity(
        isCurrent,
        "study_session",
        crypto.randomUUID(),
        {
          space_id: selectedTask.payload.space_id,
          task_id: taskEntity.entity_id,
          status: "active",
          started_at: new Date().toISOString(),
          ended_at: null,
          manual_minutes: null,
          reflection: "",
          outcome: null,
        },
        undefined,
        dependencies,
      );
      if (!isCurrent()) return;
      markChanged();
      if (!isCurrent()) return;
      await readFocusData();
      try {
        await synchronizeWorkspace(
          db,
          localVault,
          workspaceId,
          deviceId,
          isCurrent,
        );
        if (!isCurrent()) return;
        if (!isCurrent()) return;
        await readFocusData();
        if (!isCurrent()) return;
        setFeedback({ message: "专注会话已开始并同步。", tone: "success" });
      } catch {
        if (!isCurrent()) return;
        setFeedback({
          message: "专注会话已在本机开始；服务器同步暂未完成。",
          retry: "sync",
          tone: "warning",
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({ message: actionError(error), tone: "error" });
      if (!isCurrent()) return;
      await readFocusData();
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function finishFocus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeSession === undefined) return;
    const db = activeDatabase;
    const localVault = activeVault;
    if (db === null || localVault === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const outcome = String(data.get("outcome")) as "abandoned" | "completed";
    const isCurrent = operationIsCurrent();
    if (!isCurrent()) return;
    setBusy(true);
    setFeedback({ message: "正在保存会话结果…", tone: "loading" });
    try {
      await commitEntity(
        isCurrent,
        "study_session",
        activeSession.entity.entity_id,
        {
          ...activeSession.payload,
          status: outcome,
          outcome,
          ended_at: new Date().toISOString(),
          manual_minutes: Number(data.get("manual_minutes") ?? 0),
          reflection: String(data.get("reflection") ?? ""),
        },
        activeSession.entity,
      );
      if (!isCurrent()) return;
      markChanged();
      if (!isCurrent()) return;
      form.reset();
      if (!isCurrent()) return;
      await readFocusData();
      try {
        await synchronizeWorkspace(
          db,
          localVault,
          workspaceId,
          deviceId,
          isCurrent,
        );
        if (!isCurrent()) return;
        setFeedback({
          message: "会话结果已保存并同步；任务状态未被自动验收。",
          tone: "success",
        });
      } catch {
        if (!isCurrent()) return;
        setFeedback({
          message: "会话结果已保存在本机；服务器同步暂未完成。",
          retry: "sync",
          tone: "warning",
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({ message: actionError(error), tone: "error" });
      if (!isCurrent()) return;
      await readFocusData();
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  function closeOverlay() {
    generation.current += 1;
    setOverlay(null);
    setFeedback(null);
  }

  const contextFields = (
    <div className="app-operation-context">
      <label>
        工作区
        <select
          aria-label="工作区"
          disabled={busy}
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        空间
        <select
          aria-label="Space"
          disabled={busy || spacesWorkspace !== workspaceId}
          value={spaceId}
          onChange={(event) => setSpaceId(event.target.value)}
        >
          {(spacesWorkspace === workspaceId ? spaces : []).map((space) => (
            <option key={space.id} value={space.id}>
              {space.name} · {space.visibility === "private" ? "私有" : "共享"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <>
      <button
        aria-label={`本地资料${unlocked ? "已解锁" : "已锁定"}`}
        className={`app-vault-trigger ${unlocked ? "unlocked" : "locked"}`}
        ref={vaultButtonRef}
        title={`本地资料${unlocked ? "已解锁" : "已锁定"}`}
        type="button"
        onClick={() => openOverlay("vault")}
      >
        <AppIcon name={unlocked ? "unlock" : "lock"} size={16} />
        <span>{unlocked ? "已解锁" : "已锁定"}</span>
      </button>
      <button
        aria-label="打开专注计时"
        className="app-icon-button app-focus-trigger"
        ref={focusButtonRef}
        type="button"
        onClick={() => openOverlay("focus")}
      >
        <AppIcon name="timer" />
      </button>
      <button
        aria-label="打开快速捕获"
        className={GLOBAL_CAPTURE_TRIGGER_CLASS}
        ref={captureButtonRef}
        title="打开快速捕获"
        type="button"
        onClick={() => openOverlay("capture")}
      >
        <AppIcon name="plus" size={17} />
      </button>

      {mounted
        ? createPortal(
            <>
              {overlay === "vault" ? (
                <AppModal
                  eyebrow="LOCAL VAULT"
                  returnFocusRef={vaultButtonRef}
                  title="本地资料保护"
                  onClose={closeOverlay}
                >
                  <div
                    className={`app-vault-card ${unlocked ? "unlocked" : "locked"}`}
                  >
                    <span aria-hidden="true" className="app-vault-card-icon">
                      <AppIcon name={unlocked ? "unlock" : "lock"} size={22} />
                    </span>
                    <div>
                      <strong>
                        {unlocked ? "本地资料已解锁" : "本地资料已锁定"}
                      </strong>
                      <p>
                        {unlocked
                          ? "密钥仅存内存；解锁 30 分钟后自动锁定，刷新页面也会锁定。"
                          : "输入本地口令后，今日、计划、复习、笔记与同步中心共享本次解锁状态。"}
                      </p>
                    </div>
                  </div>
                  {unlocked && expiresAt ? (
                    <p aria-label="解锁剩余时间">
                      自动锁定剩余{" "}
                      {Math.max(0, Math.ceil((expiresAt - clockNow) / 60000))}{" "}
                      分钟
                    </p>
                  ) : null}
                  {unlocked ? (
                    <div className="app-modal-actions">
                      <button
                        className="app-secondary-link"
                        type="button"
                        onClick={() => {
                          lock();
                          setTasks([]);
                          setSessions([]);
                          setFeedback({
                            message: "本地资料已锁定。",
                            tone: "success",
                          });
                        }}
                      >
                        立即锁定
                      </button>
                      <Link
                        className="app-primary-link"
                        href="/app/sync"
                        onClick={closeOverlay}
                      >
                        打开同步中心
                      </Link>
                    </div>
                  ) : (
                    <form className="app-operation-form" onSubmit={unlockVault}>
                      <label htmlFor="app-vault-passphrase">本地口令</label>
                      <input
                        autoComplete="current-password"
                        data-modal-autofocus
                        id="app-vault-passphrase"
                        minLength={10}
                        name="passphrase"
                        required
                        type="password"
                      />
                      <button
                        className="app-primary-link"
                        disabled={busy}
                        type="submit"
                      >
                        {busy ? "正在解锁…" : "解锁本地资料"}
                      </button>
                    </form>
                  )}
                  <OperationFeedback feedback={feedback} onRetry={retry} />
                </AppModal>
              ) : null}

              {overlay === "capture" ? (
                <AppModal
                  eyebrow="UNIVERSAL CAPTURE"
                  returnFocusRef={captureButtonRef}
                  title="快速捕获"
                  onClose={closeOverlay}
                >
                  {!unlocked ? (
                    <div className="app-locked-callout">
                      <AppIcon name="lock" size={20} />
                      <div>
                        <strong>先解锁本地资料</strong>
                        <p>
                          捕获内容会先在本机加密，再进入现有收件箱或笔记库。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openOverlay("vault")}
                      >
                        前往解锁
                      </button>
                    </div>
                  ) : (
                    <form
                      aria-busy={busy}
                      className="app-operation-form"
                      onSubmit={saveCapture}
                    >
                      <div
                        className="app-capture-types"
                        role="group"
                        aria-label="捕获类型"
                      >
                        <button
                          disabled={busy}
                          aria-pressed={captureType === "inbox_item"}
                          className={
                            captureType === "inbox_item" ? "active" : ""
                          }
                          type="button"
                          onClick={() => setCaptureType("inbox_item")}
                        >
                          学习收件箱
                        </button>
                        <button
                          disabled={busy}
                          aria-pressed={captureType === "note"}
                          className={captureType === "note" ? "active" : ""}
                          type="button"
                          onClick={() => setCaptureType("note")}
                        >
                          Markdown 笔记
                        </button>
                      </div>
                      {contextFields}
                      <label htmlFor="app-capture-title">标题</label>
                      <input
                        data-modal-autofocus
                        id="app-capture-title"
                        disabled={busy}
                        maxLength={200}
                        name="title"
                        placeholder="先记录，稍后再整理"
                        required
                      />
                      <label htmlFor="app-capture-body">
                        {captureType === "note" ? "Markdown 正文" : "补充说明"}
                      </label>
                      <textarea
                        id="app-capture-body"
                        disabled={busy}
                        maxLength={10000}
                        name="body"
                        placeholder={
                          captureType === "note"
                            ? "写下观点、来源和下一步…"
                            : "记录触发原因、待整理方向或下一步…"
                        }
                        rows={5}
                      />
                      <div className="app-modal-actions">
                        <button
                          className="app-primary-link"
                          disabled={
                            busy ||
                            !deviceId ||
                            !spaceId ||
                            spacesWorkspace !== workspaceId
                          }
                          type="submit"
                          value="continue"
                        >
                          {busy ? "正在保存…" : "保存并继续"}
                        </button>
                        <button
                          className="app-secondary-link"
                          type="button"
                          onClick={closeOverlay}
                        >
                          取消
                        </button>
                        <button
                          className="app-secondary-link"
                          disabled={
                            busy ||
                            !deviceId ||
                            !spaceId ||
                            spacesWorkspace !== workspaceId
                          }
                          type="submit"
                          value="close"
                        >
                          保存并关闭
                        </button>
                      </div>
                    </form>
                  )}
                  <OperationFeedback feedback={feedback} onRetry={retry} />
                </AppModal>
              ) : null}

              {overlay === "focus" ? (
                <AppModal
                  eyebrow="FOCUS SESSION"
                  returnFocusRef={focusButtonRef}
                  title="专注计时"
                  onClose={closeOverlay}
                >
                  {!unlocked ? (
                    <div className="app-locked-callout">
                      <AppIcon name="lock" size={20} />
                      <div>
                        <strong>先解锁本地资料</strong>
                        <p>解锁后会读取现有任务和真实进行中的专注会话。</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openOverlay("vault")}
                      >
                        前往解锁
                      </button>
                    </div>
                  ) : (
                    <div aria-busy={busy} className="app-focus-workflow">
                      {contextFields}
                      {activeSession ? (
                        <>
                          <div className="app-focus-stage active">
                            <span className="tag good">
                              FOCUS SESSION · 进行中
                            </span>
                            <div
                              aria-label="本次已专注时间"
                              className="app-focus-clock"
                            >
                              {formatElapsed(
                                activeSession.payload.started_at,
                                clockNow,
                              )}
                            </div>
                            <h3>
                              {tasks.find(
                                (task) =>
                                  task.entity.entity_id ===
                                  activeSession.payload.task_id,
                              )?.payload.title ?? "当前专注任务"}
                            </h3>
                            <p className="muted">
                              计时来自真实会话开始时间，不会自动完成或验收任务。
                            </p>
                          </div>
                          <form
                            className="app-operation-form"
                            onSubmit={finishFocus}
                          >
                            <div className="app-operation-context">
                              <label>
                                实际分钟
                                <input
                                  defaultValue={Math.max(
                                    0,
                                    Math.round(
                                      (clockNow -
                                        Date.parse(
                                          activeSession.payload.started_at,
                                        )) /
                                        60000,
                                    ),
                                  )}
                                  max={1440}
                                  min={0}
                                  name="manual_minutes"
                                  required
                                  type="number"
                                />
                              </label>
                              <label>
                                结束方式
                                <select defaultValue="completed" name="outcome">
                                  <option value="completed">
                                    完成本次会话
                                  </option>
                                  <option value="abandoned">
                                    放弃本次会话
                                  </option>
                                </select>
                              </label>
                            </div>
                            <label htmlFor="app-focus-reflection">
                              反思与下一步
                            </label>
                            <textarea
                              id="app-focus-reflection"
                              maxLength={10000}
                              name="reflection"
                              placeholder="本次完成了什么，下一步从哪里继续？"
                              rows={4}
                            />
                            <button
                              className="app-primary-link"
                              disabled={busy}
                              type="submit"
                            >
                              {busy ? "正在保存…" : "结束并保存会话"}
                            </button>
                          </form>
                        </>
                      ) : (
                        <>
                          <div className="app-focus-picker">
                            <label htmlFor="app-focus-task">选择真实任务</label>
                            <select
                              data-modal-autofocus
                              id="app-focus-task"
                              aria-label="选择真实任务"
                              value={selectedTask?.entity.entity_id ?? ""}
                              onChange={(event) =>
                                setSelectedTaskId(event.target.value)
                              }
                            >
                              {actionableTasks.map((task) => (
                                <option
                                  key={task.entity.entity_id}
                                  value={task.entity.entity_id}
                                >
                                  {task.payload.title} ·{" "}
                                  {task.payload.estimated_minutes} 分钟
                                </option>
                              ))}
                            </select>
                            {selectedTask ? (
                              <div className="app-focus-task-preview">
                                <span className="tag info">
                                  {selectedTask.payload.status === "in_progress"
                                    ? "正在推进"
                                    : "计划中"}
                                </span>
                                <strong>{selectedTask.payload.title}</strong>
                                <p>
                                  {selectedTask.payload.description ||
                                    `预计投入 ${selectedTask.payload.estimated_minutes} 分钟`}
                                </p>
                              </div>
                            ) : (
                              <div className="app-empty-note">
                                当前空间没有计划中或进行中的任务。请先在今日或计划页安排任务。
                              </div>
                            )}
                          </div>
                          <div className="app-modal-actions">
                            <button
                              className="app-primary-link"
                              disabled={busy || selectedTask === undefined}
                              type="button"
                              onClick={() => void startFocus()}
                            >
                              {busy ? "正在开始…" : "开始专注会话"}
                            </button>
                            <Link
                              className="app-secondary-link"
                              href="/app/today#focus-session"
                              onClick={closeOverlay}
                            >
                              打开今日中心
                            </Link>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <OperationFeedback feedback={feedback} onRetry={retry} />
                </AppModal>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </>
  );
}

export function AppOperationalTools() {
  const { state } = useSession();
  return (
    <AppOperationalToolsContent
      key={state.status === "authenticated" ? state.user.id : "anonymous"}
    />
  );
}
