"use client";

import Link from "next/link";
import type { components } from "@logion/contracts";
import { validateSyncV1Message } from "@logion/contracts";
import {
  BootstrapRepository,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "@logion/offline";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ProductDisclosure,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductProgress,
  ProductTag,
  ProductTaskRow,
  ProductWorkflowStage,
} from "@/components/product/product-ui";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Device = components["schemas"]["DeviceResponse"];

interface PlanningGoalPayload extends JsonObject {
  space_id: string;
  plan_id: string;
  plan_version_id: string;
  title: string;
  description: string;
  desired_outcome: string;
  weekly_minutes: number;
  target_date: string | null;
  phases: {
    id: string;
    title: string;
    description: string;
    position: number;
    estimated_minutes: number;
    acceptance_criteria: string[];
  }[];
}

interface PlanningGoalView {
  entity: LocalEntity;
  payload: PlanningGoalPayload;
}

async function decryptedGoal(
  localVault: OfflineVault,
  entity: LocalEntity,
): Promise<PlanningGoalView> {
  const reference = entity.payload.encrypted_payload_ref;
  if (typeof reference !== "string") {
    return { entity, payload: entity.payload as PlanningGoalPayload };
  }
  const payload = await localVault.get(reference, entity.workspace_id);
  if (payload === null) throw new Error("protected payload unavailable");
  return { entity, payload: payload as PlanningGoalPayload };
}

function message(error: unknown): string {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）`
    : "操作未完成，已保留本地数据。";
}

export function PlanningCenter() {
  const { state: session } = useSession();
  const {
    database,
    phase: vaultPhase,
    revision: vaultRevision,
    unlock: unlockVault,
    vault,
  } = useVaultSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const unlocked = vaultPhase === "unlocked";
  const [status, setStatus] = useState("正在准备规划工作台……");
  const [goals, setGoals] = useState<PlanningGoalView[]>([]);

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
  }, [loadContext]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadSpaces(workspaceId));
  }, [loadSpaces, workspaceId]);

  async function refreshGoals(
    db: LogionOfflineDatabase,
    localVault: OfflineVault,
  ) {
    if (!workspaceId) return;
    const rows = await db.entities
      .where("[workspace_id+entity_type]")
      .equals([workspaceId, "learning_goal"])
      .toArray();
    const nextGoals = await Promise.all(
      rows
        .filter((item) => item.deleted_at === null)
        .map((item) => decryptedGoal(localVault, item)),
    );
    setGoals(nextGoals);
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session.status !== "authenticated") return;
    const passphrase = String(
      new FormData(event.currentTarget).get("passphrase") ?? "",
    );
    try {
      const { database: db, vault: nextVault } = await unlockVault(passphrase);
      await refreshGoals(db, nextVault);
      setStatus("本地资料已解锁。密钥只保留在当前应用会话内存中。");
      event.currentTarget.reset();
    } catch (error) {
      setStatus(message(error));
    }
  }

  useEffect(() => {
    const db = database.current;
    const localVault = vault.current;
    if (!unlocked || db === null || localVault === null || !workspaceId) return;
    queueMicrotask(
      () =>
        void refreshGoals(db, localVault)
          .then(() => setStatus("规划资料已在应用内解锁。"))
          .catch((error: unknown) => setStatus(message(error))),
    );
    // Refresh follows the shared Vault revision and selected workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, vaultRevision, workspaceId]);

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
      await refreshGoals(db, localVault);
      form.reset();
    } catch (error) {
      setStatus(message(error));
    }
  }

  const visibleGoals = goals.filter(
    (goal) => goal.payload.space_id === spaceId,
  );
  const currentGoal = visibleGoals.at(-1);
  const planningReadiness = currentGoal
    ? [
        currentGoal.payload.title.trim() !== "",
        currentGoal.payload.desired_outcome.trim() !== "",
        currentGoal.payload.weekly_minutes > 0,
        currentGoal.payload.phases.length > 0,
        currentGoal.payload.phases.every(
          (phase) => phase.acceptance_criteria.length > 0,
        ),
      ].filter(Boolean).length * 20
    : unlocked && spaceId
      ? 40
      : workspaceId
        ? 20
        : 0;
  const missingAcceptanceCriteria =
    currentGoal?.payload.phases.filter(
      (phase) => phase.acceptance_criteria.length === 0,
    ).length ?? 0;

  return (
    <main id="main-content" className="settings-page planning-page">
      <ProductPageHeader
        eyebrow="PLANNING · DEPENDENCY ROADMAP"
        title="把目标拆成可验收的学习路径"
        description={
          <>
            <p>
              阶段、依赖、容量与证据放在同一视图里，避免“创建目标后不知道下一步”。
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
        actions={
          <>
            {!unlocked ? (
              <a className="product-action-link" href="#planning-vault">
                解锁本地资料
              </a>
            ) : null}
            <a className="product-action-link primary" href="#goal-builder">
              {currentGoal ? "新建路线" : "建立第一条路线"}
            </a>
          </>
        }
      />

      <ProductWorkflowStage
        badge={
          <ProductTag tone={currentGoal ? "good" : "info"}>
            {currentGoal
              ? `CURRENT PLAN · ${currentGoal.payload.phases.length} PHASES`
              : "目标设计向导"}
          </ProductTag>
        }
        title={currentGoal?.payload.title ?? "先定义成果，再安排学习"}
        stepsLabel="学习路线设计流程"
        steps={[
          {
            label: "定义可验收成果",
            detail:
              currentGoal?.payload.desired_outcome || "说明完成后能展示什么",
            state: currentGoal ? "complete" : "current",
          },
          {
            label: "拆分首个阶段",
            detail: currentGoal
              ? `${currentGoal.payload.phases.length} 个阶段 · ${missingAcceptanceCriteria} 项待补标准`
              : "给第一阶段设置时间和验收标准",
            state: !currentGoal
              ? "pending"
              : missingAcceptanceCriteria
                ? "attention"
                : "complete",
          },
          {
            label: "安排到今日执行",
            detail: "把当前阶段拆成一次专注可完成的任务",
            state: planningReadiness === 100 ? "current" : "pending",
          },
        ]}
        actions={
          currentGoal ? (
            <Link className="product-action-link primary" href="/app/today">
              安排下一项任务
            </Link>
          ) : (
            <a className="product-action-link primary" href="#goal-builder">
              开始设计路线
            </a>
          )
        }
      >
        {currentGoal?.payload.desired_outcome ||
          "用明确的期望成果、阶段投入和验收标准建立第一版路线。保存后可在“今日”继续拆解任务。"}
      </ProductWorkflowStage>

      <div className="product-metric-grid product-metric-grid-workflow">
        <ProductMetric
          label="学习路线"
          value={visibleGoals.length}
          detail="当前空间中的真实目标"
          tone="info"
        />
        <ProductMetric
          label="路线阶段"
          value={currentGoal?.payload.phases.length ?? 0}
          detail={currentGoal?.payload.phases[0]?.title ?? "建立目标后生成阶段"}
          tone={currentGoal ? "good" : "default"}
        />
        <ProductMetric
          label="每周投入"
          value={
            currentGoal
              ? `${Math.round((currentGoal.payload.weekly_minutes / 60) * 10) / 10}h`
              : "0h"
          }
          detail="来自当前路线设置"
        />
        <ProductMetric
          label="目标日期"
          value={currentGoal?.payload.target_date ?? "未设置"}
          detail="可随计划继续调整"
          tone={currentGoal?.payload.target_date ? "good" : "warn"}
        />
      </div>

      {currentGoal ? (
        <>
          <ProductPanel
            title={currentGoal.payload.title}
            description={
              currentGoal.payload.description || "当前学习路线的阶段与验收标准"
            }
            aside={
              <ProductTag tone={planningReadiness === 100 ? "good" : "warn"}>
                {planningReadiness === 100 ? "结构完整" : "需要补充"}
              </ProductTag>
            }
          >
            <div className="product-plan-timeline">
              {currentGoal.payload.phases.map((phase, index) => (
                <article className="product-plan-phase" key={phase.id}>
                  <header>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <ProductTag tone={index === 0 ? "info" : "default"}>
                      {phase.estimated_minutes} MIN
                    </ProductTag>
                  </header>
                  <h3>{phase.title}</h3>
                  <p>
                    {phase.description ||
                      phase.acceptance_criteria[0] ||
                      "尚未补充阶段说明"}
                  </p>
                  <small>{phase.acceptance_criteria.length} 条验收标准</small>
                </article>
              ))}
            </div>
          </ProductPanel>

          <div className="product-dashboard-grid product-dashboard-grid-wide">
            <ProductPanel
              title="本周容量"
              description="按照当前路线设置核对真实可支配时间。"
            >
              <ProductProgress
                label="已规划投入"
                value={Math.min(
                  100,
                  (currentGoal.payload.phases.reduce(
                    (total, phase) => total + phase.estimated_minutes,
                    0,
                  ) /
                    Math.max(currentGoal.payload.weekly_minutes, 1)) *
                    100,
                )}
                tone="info"
              />
              <p className="product-muted-note">
                每周预算 {currentGoal.payload.weekly_minutes}{" "}
                分钟；阶段总投入将在路线细化时持续更新。
              </p>
            </ProductPanel>
            <ProductPanel
              title="计划健康度"
              description="只检查当前路线内部可以确定的结构风险。"
              aside={
                <ProductTag
                  tone={
                    missingAcceptanceCriteria > 0 ||
                    !currentGoal.payload.target_date
                      ? "warn"
                      : "good"
                  }
                >
                  {missingAcceptanceCriteria +
                    (currentGoal.payload.target_date ? 0 : 1)}{" "}
                  项
                </ProductTag>
              }
            >
              {!currentGoal.payload.target_date ? (
                <div className="product-signal warn">
                  <strong>尚未设置目标日期</strong>
                  <small>路线仍可执行，但无法判断时间风险。</small>
                </div>
              ) : null}
              {missingAcceptanceCriteria > 0 ? (
                <div className="product-signal bad">
                  <strong>
                    {missingAcceptanceCriteria} 个阶段缺少验收标准
                  </strong>
                  <small>补充可观察结果后再进入今日任务。</small>
                </div>
              ) : null}
              {missingAcceptanceCriteria === 0 &&
              currentGoal.payload.target_date ? (
                <div className="product-signal">
                  <strong>路线结构可以继续推进</strong>
                  <small>下一步是把当前阶段拆成今日任务。</small>
                </div>
              ) : null}
            </ProductPanel>
          </div>
        </>
      ) : null}

      <ProductDisclosure
        id="planning-vault"
        summary="目标保存位置与本地资料"
        description="选择工作区、空间并解锁端侧加密资料"
        defaultOpen={!unlocked}
      >
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
          <button type="submit">{unlocked ? "重新解锁" : "解锁资料"}</button>
        </form>
      </ProductDisclosure>

      <ProductDisclosure
        id="goal-builder"
        summary={currentGoal ? "新建另一条学习路线" : "创建第一条学习路线"}
        description="用成果、投入与验收标准生成真实目标数据"
        defaultOpen={!currentGoal}
      >
        <div className="product-dashboard-grid product-dashboard-grid-form">
          <ProductPanel
            className="product-form-panel"
            title="创建目标草稿"
            description="所有字段都用于现有目标数据结构；保存前可随时调整。"
            aside={
              <ProductTag tone={unlocked ? "good" : "warn"}>
                {unlocked ? "可以保存" : "请先解锁"}
              </ProductTag>
            }
          >
            <form className="planning-form" onSubmit={createGoal}>
              <fieldset className="product-form-step">
                <legend>
                  <span>01</span> 定义终点
                </legend>
                <p>用成果描述学习完成后的可见变化。</p>
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
              </fieldset>

              <fieldset className="product-form-step">
                <legend>
                  <span>02</span> 约束投入
                </legend>
                <p>给路线一个现实的时间预算，而不是理想化排期。</p>
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
              </fieldset>

              <fieldset className="product-form-step">
                <legend>
                  <span>03</span> 建立首个里程碑
                </legend>
                <p>只规划能够立即开始并能够检查的第一个阶段。</p>
                <label htmlFor="phase-title">首个阶段</label>
                <input
                  id="phase-title"
                  name="phase_title"
                  maxLength={160}
                  required
                />
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
                <input
                  id="criterion"
                  name="criterion"
                  maxLength={500}
                  required
                />
              </fieldset>
              <button type="submit" disabled={!unlocked}>
                保存目标并同步
              </button>
            </form>
          </ProductPanel>

          <aside className="product-sticky-column">
            <ProductPanel
              title="一条可执行路线应当包含"
              description="保存后仍可通过现有工作流继续细化。"
            >
              <div className="product-task-list">
                <ProductTaskRow
                  icon="◎"
                  title="清晰成果"
                  description="能够展示、说明或提交的具体结果"
                />
                <ProductTaskRow
                  icon="◫"
                  title="现实投入"
                  description="与每周可支配时间匹配的学习预算"
                />
                <ProductTaskRow
                  icon="◇"
                  title="可验收阶段"
                  description="有时间估算，也有完成判断标准"
                />
              </div>
            </ProductPanel>
            <ProductPanel title="保存后如何推进">
              <ol className="product-checklist">
                <li>到“今日”把阶段拆成下一项任务</li>
                <li>用专注会话记录实际投入</li>
                <li>提交笔记、资料或链接作为证据</li>
                <li>人工验收后关闭任务</li>
              </ol>
            </ProductPanel>
          </aside>
        </div>
      </ProductDisclosure>
    </main>
  );
}
