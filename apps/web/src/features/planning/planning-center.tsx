"use client";

import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  databaseNameForUser,
  OfflineVault,
  openOfflineDatabase,
  ProtectedOfflineRepository,
  SyncClient,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "@logion/offline";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useSession } from "@/features/auth/session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];

function message(error: unknown): string {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）`
    : "操作未完成，已保留本地数据。";
}

export function PlanningCenter() {
  const { state: session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("正在准备规划工作台……");
  const database = useRef<LogionOfflineDatabase | null>(null);
  const vault = useRef<OfflineVault | null>(null);

  const loadContext = useCallback(async () => {
    try {
      const [workspaceResult, deviceResult] = await Promise.all([
        browserApiClient.request<{ workspaces: Workspace[] }>(
          "/api/v1/workspaces",
        ),
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
      ]);
      const nextWorkspaces = workspaceResult.workspaces;
      const currentDevice = deviceResult.devices.find(
        (device) => device.current,
      );
      setWorkspaces(nextWorkspaces);
      setWorkspaceId((current) => current || nextWorkspaces[0]?.id || "");
      setDeviceId(currentDevice?.id ?? "");
      setStatus(
        currentDevice ? "请选择空间并解锁本地资料。" : "未找到当前设备。 ",
      );
    } catch (error) {
      setStatus(message(error));
    }
  }, []);

  const loadSpaces = useCallback(async (selectedWorkspace: string) => {
    try {
      const result = await browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${selectedWorkspace}/spaces`,
      );
      setSpaces(result.spaces);
      setSpaceId((current) =>
        result.spaces.some((space) => space.id === current)
          ? current
          : (result.spaces[0]?.id ?? ""),
      );
    } catch (error) {
      setSpaces([]);
      setSpaceId("");
      setStatus(message(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadContext());
    return () => database.current?.close();
  }, [loadContext]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadSpaces(workspaceId));
  }, [loadSpaces, workspaceId]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    try {
      database.current?.close();
      const db = await openOfflineDatabase({
        databaseName: databaseNameForUser(session.user.id),
        indexedDB: globalThis.indexedDB ?? null,
        IDBKeyRange: globalThis.IDBKeyRange ?? null,
      });
      const nextVault = new OfflineVault(db);
      if ((await db.vaultMetadata.get(session.user.id)) === undefined) {
        await nextVault.initialize(session.user.id, passphrase);
      } else {
        await nextVault.unlock(session.user.id, passphrase);
      }
      database.current = db;
      vault.current = nextVault;
      setUnlocked(true);
      setStatus("本地资料已解锁。密钥只保留在当前页面内存中。");
      event.currentTarget.reset();
    } catch (error) {
      setUnlocked(false);
      setStatus(message(error));
    }
  }

  async function ensureBootstrap(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
  ) {
    const current = await db.syncState.get(workspaceId);
    if (current?.bootstrap_state === "ready" && current.device_id === deviceId)
      return;
    const repository = new BootstrapRepository(db, {}, localVault);
    const first = await browserApiClient.request<unknown>(
      `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
      {
        method: "POST",
        body: JSON.stringify({
          message_type: "bootstrap_request",
          protocol_version: "sync-v1",
          workspace_id: workspaceId,
          device_id: deviceId,
          known_sync_epoch: current?.sync_epoch ?? null,
          snapshot_id: null,
          chunk_index: null,
        }),
      },
    );
    const validation = validateSyncV1Message(first);
    if (
      !validation.ok ||
      validation.value.message_type !== "bootstrap_response"
    ) {
      throw new Error("invalid bootstrap response");
    }
    const manifest = validation.value;
    await repository.stageChunk(first, {
      workspace_id: workspaceId,
      device_id: deviceId,
    });
    for (let index = 1; index < manifest.chunk_count; index += 1) {
      const chunk = await browserApiClient.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
        {
          method: "POST",
          body: JSON.stringify({
            message_type: "bootstrap_request",
            protocol_version: "sync-v1",
            workspace_id: workspaceId,
            device_id: deviceId,
            known_sync_epoch: manifest.sync_epoch,
            snapshot_id: manifest.snapshot_id,
            chunk_index: index,
          }),
        },
      );
      await repository.stageChunk(chunk, {
        workspace_id: workspaceId,
        device_id: deviceId,
      });
    }
  }

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const db = database.current;
    const localVault = vault.current;
    if (
      !unlocked ||
      db === null ||
      localVault === null ||
      !workspaceId ||
      !spaceId ||
      !deviceId
    ) {
      setStatus("请先选择工作区和空间，并解锁本地资料。");
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const operationId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      space_id: spaceId,
      plan_id: crypto.randomUUID(),
      plan_version_id: crypto.randomUUID(),
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      desired_outcome: String(data.get("outcome") ?? ""),
      weekly_minutes: Number(data.get("weekly_minutes") ?? 0),
      target_date: String(data.get("target_date") || "") || null,
      phases: [
        {
          id: crypto.randomUUID(),
          title: String(data.get("phase_title") ?? ""),
          description: "",
          position: 0,
          estimated_minutes: Number(data.get("phase_minutes") ?? 0),
          acceptance_criteria: [String(data.get("criterion") ?? "")],
        },
      ],
    };
    try {
      await ensureBootstrap(db, localVault);
      await new ProtectedOfflineRepository(db, localVault).commitMutation({
        operation_id: operationId,
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        entity_type: "learning_goal",
        entity_id: goalId,
        operation_type: "create",
        base_version: 0,
        local_revision: 1,
        client_occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by:
          session.status === "authenticated" ? session.user.id : goalId,
        updated_by:
          session.status === "authenticated" ? session.user.id : goalId,
        payload,
      });
      const transport: SyncTransport = {
        push: (request) =>
          browserApiClient.request(
            `/api/v1/workspaces/${workspaceId}/sync/push`,
            {
              method: "POST",
              csrf: true,
              body: JSON.stringify(request),
            },
          ),
        pull: (request) =>
          browserApiClient.request(
            `/api/v1/workspaces/${workspaceId}/sync/pull`,
            {
              method: "POST",
              body: JSON.stringify(request),
            },
          ),
      };
      try {
        await new SyncClient(db, transport, localVault).synchronize(
          workspaceId,
          deviceId,
        );
        setStatus("目标已保存到本地并同步。发布计划前仍可继续检查草稿。");
      } catch {
        setStatus("目标已安全保存在本地，将在网络恢复后同步。");
      }
      form.reset();
    } catch (error) {
      setStatus(message(error));
    }
  }

  return (
    <main id="main-content" className="settings-page planning-page">
      <header>
        <p className="eyebrow">LOGION · PLAN</p>
        <h1>建立可验收的学习目标</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <h2>工作上下文</h2>
        <div className="inline-form">
          <label htmlFor="planning-workspace">工作区</label>
          <select
            id="planning-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <label htmlFor="planning-space">空间</label>
          <select
            id="planning-space"
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} ·{" "}
                {space.visibility === "private" ? "私有" : "共享"}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="settings-card">
        <h2>本地解锁</h2>
        <form className="inline-form" onSubmit={unlock}>
          <label htmlFor="planning-passphrase">本地口令</label>
          <input
            id="planning-passphrase"
            name="passphrase"
            type="password"
            minLength={10}
            autoComplete="current-password"
            required
          />
          <button type="submit">{unlocked ? "重新解锁" : "解锁"}</button>
        </form>
      </section>
      <section className="settings-card">
        <h2>目标与首个阶段</h2>
        <form className="planning-form" onSubmit={createGoal}>
          <label htmlFor="goal-title">目标名称</label>
          <input id="goal-title" name="title" maxLength={160} required />
          <label htmlFor="goal-outcome">希望产出什么可验收结果？</label>
          <textarea
            id="goal-outcome"
            name="outcome"
            maxLength={5000}
            required
          />
          <label htmlFor="goal-description">背景说明</label>
          <textarea
            id="goal-description"
            name="description"
            maxLength={10000}
          />
          <label htmlFor="weekly-minutes">每周投入（分钟）</label>
          <input
            id="weekly-minutes"
            name="weekly_minutes"
            type="number"
            min={0}
            max={10080}
            defaultValue={360}
            required
          />
          <label htmlFor="target-date">目标日期（可选）</label>
          <input id="target-date" name="target_date" type="date" />
          <label htmlFor="phase-title">首个阶段</label>
          <input id="phase-title" name="phase_title" maxLength={160} required />
          <label htmlFor="phase-minutes">阶段预计分钟</label>
          <input
            id="phase-minutes"
            name="phase_minutes"
            type="number"
            min={0}
            max={1000000}
            defaultValue={600}
            required
          />
          <label htmlFor="criterion">阶段验收标准</label>
          <input id="criterion" name="criterion" maxLength={500} required />
          <button type="submit" disabled={!unlocked}>
            本地保存并同步
          </button>
        </form>
      </section>
    </main>
  );
}
