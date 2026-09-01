"use client";

import type { components } from "@logion/contracts";
import type { JsonObject, LocalEntity } from "@logion/offline";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchDropdownMenu,
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
  WorkbenchTooltip,
  type WorkbenchTab,
} from "@/components/product/headless-ui";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import { ProductTag } from "@/components/product/product-ui";
import {
  ProductWorkbenchStateNotice as StateNotice,
  type ProductWorkbenchState,
} from "@/components/product/product-workbench-state";

import {
  collaborationCapabilities,
  type CollaborationEntityType,
  type CollaborationRole,
} from "./research-collaboration-contract";

import styles from "./collaboration-workbench.module.css";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];

export interface CollaborationView {
  entity: LocalEntity;
  payload: JsonObject;
}

export interface CollaborationWorkbenchData {
  visibleFeedback: CollaborationView[];
  visibleReviews: CollaborationView[];
  visibleRubrics: CollaborationView[];
  visibleSnapshots: CollaborationView[];
}

export interface CollaborationWorkbenchContext {
  collaborationState: ProductWorkbenchState;
  contextPhase: "error" | "loading" | "ready";
  dataPhase: "error" | "idle" | "loading" | "ready";
  deviceId: string;
  selectedSpace?: Space;
  selectedWorkspace?: Workspace;
  sharedSpaces: Space[];
  spaceId: string;
  status: string;
  unlocked: boolean;
  workspaceId: string;
  workspaces: Workspace[];
}

export interface CollaborationWorkbenchActions {
  loadContext: () => Promise<void>;
  setSpaceId: (value: string) => void;
  setWorkspaceId: (value: string) => void;
  submitCollaboration: (
    event: FormEvent<HTMLFormElement>,
    kind: CollaborationEntityType,
  ) => Promise<boolean>;
  synchronize: () => Promise<void>;
  unlock: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}

export interface CollaborationWorkbenchProps {
  actions: CollaborationWorkbenchActions;
  context: CollaborationWorkbenchContext;
  data: CollaborationWorkbenchData;
}

type SheetName = "feedback" | "report" | "review" | "rubric" | "unlock" | null;

function text(payload: JsonObject, key: string, fallback = "") {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function EmptyPane({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className={styles.emptyPane} role="status">
      <span aria-hidden="true">
        <AppIcon name="users" size={18} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function StatusLine({ children }: { children: string }) {
  return (
    <p aria-live="polite" className={styles.statusLine} role="status">
      <span aria-hidden="true" />
      {children}
    </p>
  );
}

function ContextToolbar({
  actions,
  context,
}: {
  actions: CollaborationWorkbenchActions;
  context: CollaborationWorkbenchContext;
}) {
  return (
    <WorkbenchToolbar label="共享审阅上下文操作">
      <WorkbenchSelect
        label="选择 Workspace"
        onValueChange={actions.setWorkspaceId}
        options={context.workspaces.map((workspace) => ({
          label: workspace.name,
          value: workspace.id,
        }))}
        placeholder="Workspace"
        value={context.workspaceId || undefined}
      />
      <WorkbenchSelect
        disabled={!context.selectedWorkspace}
        label="选择共享 Space"
        onValueChange={actions.setSpaceId}
        options={context.sharedSpaces.map((space) => ({
          label: space.name,
          value: space.id,
        }))}
        placeholder="共享 Space"
        value={context.spaceId || undefined}
      />
      <span className={styles.toolbarSpacer} />
      <WorkbenchTooltip content="推送本地变更并拉取远端记录">
        <button
          aria-label="立即同步"
          className={styles.iconButton}
          disabled={!context.unlocked}
          onClick={() => void actions.synchronize()}
          type="button"
        >
          <AppIcon name="refresh" size={16} />
        </button>
      </WorkbenchTooltip>
    </WorkbenchToolbar>
  );
}

function UnlockSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
}: {
  actions: CollaborationWorkbenchActions;
  context: CollaborationWorkbenchContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="本地共享资料由 Vault 解密；解锁后才会读取当前共享 Space 的加密记录。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            解锁资料
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="解锁共享审阅资料"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const ok = await actions.unlock(event);
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-passphrase`}>本地口令</label>
        <input
          autoComplete="current-password"
          autoFocus
          id={`${formId}-passphrase`}
          minLength={10}
          name="passphrase"
          required
          type="password"
        />
        <p className={styles.formHint}>
          当前 Workspace：{context.selectedWorkspace?.name ?? "未选择"}；仅共享
          Space 的资料会进入此工作台。
        </p>
      </form>
    </WorkbenchSheet>
  );
}

function RubricSheet({
  actions,
  onOpenChange,
  open,
}: {
  actions: CollaborationWorkbenchActions;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="Rubric 只允许写入当前共享 Space；每行一条可检查标准。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            创建 Rubric
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="创建 Rubric"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const ok = await actions.submitCollaboration(event, "rubric");
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-title`}>Rubric 名称</label>
        <input id={`${formId}-title`} maxLength={160} name="title" required />
        <label htmlFor={`${formId}-criteria`}>验收标准</label>
        <textarea
          id={`${formId}-criteria`}
          maxLength={20000}
          name="criteria"
          required
          rows={6}
        />
      </form>
    </WorkbenchSheet>
  );
}

function ReviewSheet({
  actions,
  data,
  onOpenChange,
  open,
}: {
  actions: CollaborationWorkbenchActions;
  data: CollaborationWorkbenchData;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="选择共享 Rubric，并只填写共享对象的标题与摘要。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            发起审阅
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="发起审阅"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const ok = await actions.submitCollaboration(event, "group_review");
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-rubric`}>审阅 Rubric</label>
        <select id={`${formId}-rubric`} name="rubric_id" required>
          <option value="">请选择 Rubric</option>
          {data.visibleRubrics.map((rubric) => (
            <option
              key={rubric.entity.entity_id}
              value={rubric.entity.entity_id}
            >
              {text(rubric.payload, "title", "未命名 Rubric")}
            </option>
          ))}
        </select>
        <label htmlFor={`${formId}-subject`}>审阅对象（仅共享内容）</label>
        <input
          autoFocus
          id={`${formId}-subject`}
          maxLength={240}
          name="subject_title"
          required
        />
        <label htmlFor={`${formId}-summary`}>提交摘要</label>
        <textarea
          id={`${formId}-summary`}
          maxLength={20000}
          name="summary"
          rows={4}
        />
      </form>
    </WorkbenchSheet>
  );
}

function FeedbackSheet({
  actions,
  data,
  onOpenChange,
  open,
  selectedReviewId,
}: {
  actions: CollaborationWorkbenchActions;
  data: CollaborationWorkbenchData;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedReviewId: string | null;
}) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="反馈追加到明确的共享审阅对象；建议动作帮助成员形成下一步。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            提交反馈
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="提交反馈"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const ok = await actions.submitCollaboration(event, "group_feedback");
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-review`}>关联审阅</label>
        <select
          defaultValue={selectedReviewId ?? ""}
          id={`${formId}-review`}
          name="review_id"
          required
        >
          <option value="">请选择审阅</option>
          {data.visibleReviews.map((review) => (
            <option
              key={review.entity.entity_id}
              value={review.entity.entity_id}
            >
              {text(review.payload, "subject_title", "未命名审阅")}
            </option>
          ))}
        </select>
        <label htmlFor={`${formId}-feedback`}>反馈</label>
        <textarea
          autoFocus
          id={`${formId}-feedback`}
          maxLength={20000}
          name="feedback"
          required
          rows={5}
        />
        <label htmlFor={`${formId}-action`}>建议动作（可选）</label>
        <input id={`${formId}-action`} maxLength={2000} name="action" />
      </form>
    </WorkbenchSheet>
  );
}

function SnapshotSheet({
  actions,
  data,
  onOpenChange,
  open,
  selectedReviewId,
}: {
  actions: CollaborationWorkbenchActions;
  data: CollaborationWorkbenchData;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedReviewId: string | null;
}) {
  const formId = useId();
  const [error, setError] = useState("");
  return (
    <WorkbenchSheet
      description="快照发布后不可更新或删除；如需修正，只能发布新的快照版本。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            发布不可变快照
          </button>
        </>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError("");
        onOpenChange(nextOpen);
      }}
      open={open}
      title="发布不可变报告快照"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (String(form.get("confirm_phrase") ?? "").trim() !== "PUBLISH") {
            setError("请输入确认短语 PUBLISH，确认当前反馈会冻结为只读快照。");
            return;
          }
          const ok = await actions.submitCollaboration(
            event,
            "report_snapshot",
          );
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-review`}>关联审阅</label>
        <select
          defaultValue={selectedReviewId ?? ""}
          id={`${formId}-review`}
          name="review_id"
          required
        >
          <option value="">请选择审阅</option>
          {data.visibleReviews.map((review) => (
            <option
              key={review.entity.entity_id}
              value={review.entity.entity_id}
            >
              {text(review.payload, "subject_title", "未命名审阅")}
            </option>
          ))}
        </select>
        <label htmlFor={`${formId}-summary`}>只读报告摘要</label>
        <textarea
          autoFocus
          id={`${formId}-summary`}
          maxLength={20000}
          name="summary"
          required
          rows={5}
        />
        <label htmlFor={`${formId}-phrase`}>确认短语</label>
        <input
          id={`${formId}-phrase`}
          name="confirm_phrase"
          required
          spellCheck={false}
        />
        <p className={styles.dangerNote} role={error ? "alert" : undefined}>
          {error ||
            "影响范围：当前共享 Space 的此审阅及其现有反馈；权限：shared_plan.write。"}
        </p>
        <p className={styles.formHint}>
          恢复路径：不能编辑此版本，需追加发布新的快照版本。
        </p>
      </form>
    </WorkbenchSheet>
  );
}

function ReviewMaster({
  context,
  data,
  onCreateRubric,
  onSelect,
  selectedId,
}: {
  context: CollaborationWorkbenchContext;
  data: CollaborationWorkbenchData;
  onCreateRubric: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const role = context.selectedWorkspace?.role as CollaborationRole | undefined;
  const capabilities = collaborationCapabilities(role);
  return (
    <div className={styles.master} data-testid="collaboration-queue">
      <header className={styles.paneHeader}>
        <div>
          <p className={styles.eyebrow}>REVIEW QUEUE</p>
          <h2>审阅请求</h2>
        </div>
        <span className={styles.count}>{data.visibleReviews.length}</span>
      </header>
      <div className={styles.sharedScope}>
        <div>
          <span className={styles.scopeLabel}>SHARED SPACE</span>
          <strong>{context.selectedSpace?.name ?? "尚未选择"}</strong>
        </div>
        <span className={styles.scopeMeta}>
          {context.selectedSpace ? "成员可见" : "需要共享 Space"}
        </span>
      </div>
      <button
        className={styles.sectionAction}
        disabled={!capabilities.canPlanShared || !context.selectedSpace}
        onClick={onCreateRubric}
        type="button"
      >
        <AppIcon name="plus" size={14} />
        创建 Rubric
      </button>
      <div aria-label="当前共享 Space 的审阅请求" className={styles.reviewList}>
        {data.visibleReviews.map((review) => {
          const feedbackCount = data.visibleFeedback.filter(
            (item) => item.payload.review_id === review.entity.entity_id,
          ).length;
          const snapshotCount = data.visibleSnapshots.filter(
            (item) => item.payload.review_id === review.entity.entity_id,
          ).length;
          const selected = selectedId === review.entity.entity_id;
          return (
            <button
              aria-current={selected ? "true" : undefined}
              className={styles.reviewRow}
              data-selected={selected}
              key={review.entity.entity_id}
              onClick={() => onSelect(review.entity.entity_id)}
              type="button"
            >
              <span className={styles.reviewIcon}>
                <AppIcon name="users" size={15} />
              </span>
              <span className={styles.reviewCopy}>
                <strong>
                  {text(review.payload, "subject_title", "未命名审阅")}
                </strong>
                <small>
                  {text(review.payload, "submission_summary", "等待摘要") ||
                    "等待摘要"}
                </small>
              </span>
              <span className={styles.rowMeta}>
                {feedbackCount} 反馈 · {snapshotCount} 快照
              </span>
            </button>
          );
        })}
        {data.visibleReviews.length === 0 ? (
          <EmptyPane
            description="创建 Rubric 后，从页面主操作发起一次共享审阅。"
            title="当前还没有审阅"
          />
        ) : null}
      </div>
      <footer className={styles.masterFooter}>
        <span>{data.visibleRubrics.length} 个 Rubric</span>
        <span>{data.visibleSnapshots.length} 个只读快照</span>
      </footer>
    </div>
  );
}

function RubricBlock({ rubric }: { rubric: CollaborationView | null }) {
  const criteria = rubric
    ? text(rubric.payload, "criteria")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return (
    <section className={styles.rubricBlock} data-testid="collaboration-rubric">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>RUBRIC</p>
          <h3>
            {rubric
              ? text(rubric.payload, "title", "未命名 Rubric")
              : "尚未关联 Rubric"}
          </h3>
        </div>
        <ProductTag tone="info">{criteria.length} 项标准</ProductTag>
      </header>
      {criteria.length ? (
        <ol className={styles.criteriaList}>
          {criteria.map((criterion, index) => (
            <li key={`${criterion}-${index}`}>
              <span>{index + 1}</span>
              <p>{criterion}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>该审阅没有可显示的标准。</p>
      )}
    </section>
  );
}

function FeedbackTimeline({
  data,
  reviewId,
}: {
  data: CollaborationWorkbenchData;
  reviewId: string;
}) {
  const feedback = data.visibleFeedback.filter(
    (item) => item.payload.review_id === reviewId,
  );
  return (
    <section className={styles.section} data-testid="collaboration-feedback">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>FEEDBACK TIMELINE</p>
          <h3>反馈与建议动作</h3>
        </div>
        <span className={styles.sectionMeta}>{feedback.length}</span>
      </header>
      {feedback.length ? (
        <ol className={styles.timeline}>
          {feedback.map((item) => (
            <li key={item.entity.entity_id}>
              <span className={styles.timelineMarker} aria-hidden="true">
                <AppIcon name="clipboard" size={14} />
              </span>
              <div className={styles.timelineBody}>
                <div className={styles.timelineMeta}>
                  <strong>共享成员反馈</strong>
                  <time>{formatDate(item.entity.updated_at)}</time>
                </div>
                <p>{text(item.payload, "feedback", "未填写反馈")}</p>
                <small>
                  建议动作：
                  {text(item.payload, "recommended_action", "暂未指定") ||
                    "暂未指定"}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyPane
          description="提交第一条反馈后，成员建议会按时间顺序追加在这里。"
          title="还没有反馈"
        />
      )}
    </section>
  );
}

function SnapshotList({
  data,
  reviewId,
}: {
  data: CollaborationWorkbenchData;
  reviewId: string;
}) {
  const snapshots = data.visibleSnapshots.filter(
    (item) => item.payload.review_id === reviewId,
  );
  return (
    <section className={styles.section} data-testid="collaboration-snapshot">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>IMMUTABLE REPORT</p>
          <h3>报告快照</h3>
        </div>
        <span className={styles.sectionMeta}>{snapshots.length}</span>
      </header>
      {snapshots.length ? (
        <div className={styles.snapshotList}>
          {snapshots.map((snapshot) => (
            <article
              className={styles.snapshotRow}
              key={snapshot.entity.entity_id}
            >
              <div>
                <strong>
                  只读版本 · {formatDate(snapshot.entity.updated_at)}
                </strong>
                <p>{text(snapshot.payload, "summary", "未填写摘要")}</p>
              </div>
              <ProductTag tone="default">不可变</ProductTag>
            </article>
          ))}
        </div>
      ) : (
        <EmptyPane
          description="反馈确认后可发布第一版只读报告；发布后只能追加新版本。"
          title="尚无报告快照"
        />
      )}
    </section>
  );
}

function ReviewMain({
  context,
  data,
  onFeedback,
  onReport,
  selectedReview,
}: {
  context: CollaborationWorkbenchContext;
  data: CollaborationWorkbenchData;
  onFeedback: () => void;
  onReport: () => void;
  selectedReview: CollaborationView | null;
}) {
  const role = context.selectedWorkspace?.role as CollaborationRole | undefined;
  const capabilities = collaborationCapabilities(role);
  const rubric = selectedReview
    ? (data.visibleRubrics.find(
        (item) => item.entity.entity_id === selectedReview.payload.rubric_id,
      ) ?? null)
    : null;
  const tabs: WorkbenchTab[] = [
    { label: "反馈时间线", value: "feedback" },
    { label: "报告快照", value: "snapshots" },
  ];
  const [tab, setTab] = useState("feedback");

  if (!selectedReview) {
    return (
      <div className={styles.main} data-testid="collaboration-main">
        <EmptyPane
          description="从左侧选择审阅请求；页面主操作会根据共享权限提供发起审阅或解锁入口。"
          title="小组审阅闭环"
        />
      </div>
    );
  }

  const status = text(selectedReview.payload, "status", "open");
  return (
    <div className={styles.main} data-testid="collaboration-main">
      <section className={styles.reviewHeader}>
        <div className={styles.reviewHeaderCopy}>
          <p className={styles.eyebrow}>
            REVIEW REQUEST · {formatDate(selectedReview.entity.created_at)}
          </p>
          <h2>{text(selectedReview.payload, "subject_title", "未命名审阅")}</h2>
          <p>
            {text(
              selectedReview.payload,
              "submission_summary",
              "暂无提交摘要",
            ) || "暂无提交摘要"}
          </p>
        </div>
        <div className={styles.reviewHeaderMeta}>
          <ProductTag tone={status === "closed" ? "default" : "info"}>
            {status === "closed" ? "已关闭" : "进行中"}
          </ProductTag>
          <WorkbenchDropdownMenu
            items={[
              {
                disabled: !capabilities.canSubmitFeedback,
                icon: <AppIcon name="clipboard" size={14} />,
                id: "feedback",
                label: "提交反馈",
                onSelect: onFeedback,
              },
              {
                disabled: !capabilities.canPublishSnapshot,
                icon: <AppIcon name="files" size={14} />,
                id: "report",
                label: "发布不可变快照",
                onSelect: onReport,
              },
            ]}
            label="审阅操作"
            trigger={
              <button
                aria-label="审阅操作"
                className={styles.iconButton}
                type="button"
              >
                <AppIcon name="more" size={16} />
              </button>
            }
          />
        </div>
      </section>
      <RubricBlock rubric={rubric} />
      <WorkbenchTabs
        label="审阅内容视图"
        onValueChange={setTab}
        tabs={tabs}
        value={tab}
      >
        <WorkbenchTabPanel forceMount value="feedback">
          <FeedbackTimeline
            data={data}
            reviewId={selectedReview.entity.entity_id}
          />
        </WorkbenchTabPanel>
        <WorkbenchTabPanel forceMount value="snapshots">
          <SnapshotList
            data={data}
            reviewId={selectedReview.entity.entity_id}
          />
        </WorkbenchTabPanel>
      </WorkbenchTabs>
      <p className={styles.mainNote}>
        共享 Space
        只展示明确共享对象；私人笔记、错题与未提交草稿不会进入此审阅。
      </p>
    </div>
  );
}

function MemberInspector({
  context,
  data,
  onCreateRubric,
  selectedReview,
}: {
  context: CollaborationWorkbenchContext;
  data: CollaborationWorkbenchData;
  onCreateRubric: () => void;
  selectedReview: CollaborationView | null;
}) {
  const role = context.selectedWorkspace?.role as CollaborationRole | undefined;
  const capabilities = collaborationCapabilities(role);
  const roleLabel: Record<string, string> = {
    admin: "Admin",
    contributor: "Contributor",
    editor: "Editor",
    owner: "Owner",
    reviewer: "Reviewer",
    viewer: "Viewer",
  };
  return (
    <div className={styles.inspector} data-testid="collaboration-inspector">
      <header className={styles.inspectorHeader}>
        <p className={styles.eyebrow}>MEMBER INSPECTOR</p>
        <h2>{roleLabel[role ?? ""] ?? "只读成员"}</h2>
        <p>当前成员能力与共享范围</p>
      </header>
      <InspectorSection title="角色与能力">
        <dl className={styles.metaList}>
          <div>
            <dt>角色</dt>
            <dd>{roleLabel[role ?? ""] ?? "Viewer"}</dd>
          </div>
          <div>
            <dt>共享写入</dt>
            <dd>{capabilities.canPlanShared ? "shared_plan.write" : "无"}</dd>
          </div>
          <div>
            <dt>反馈追加</dt>
            <dd>{capabilities.canSubmitFeedback ? "review.write" : "无"}</dd>
          </div>
          <div>
            <dt>快照发布</dt>
            <dd>{capabilities.canPublishSnapshot ? "允许追加" : "无"}</dd>
          </div>
        </dl>
      </InspectorSection>
      <InspectorSection title="Shared Space 范围">
        <dl className={styles.metaList}>
          <div>
            <dt>空间</dt>
            <dd>{context.selectedSpace?.name ?? "尚未选择"}</dd>
          </div>
          <div>
            <dt>可见性</dt>
            <dd>
              {context.selectedSpace?.visibility === "shared"
                ? "成员可见"
                : "不可用"}
            </dd>
          </div>
          <div>
            <dt>当前审阅</dt>
            <dd>
              {selectedReview
                ? text(selectedReview.payload, "subject_title", "未命名审阅")
                : "未选择"}
            </dd>
          </div>
        </dl>
      </InspectorSection>
      <p className={styles.inspectorNote}>
        私人笔记、错题、未提交草稿和其他 Private Space
        对象不会被读取、写入或展示。
      </p>
      {capabilities.canPlanShared ? (
        <button
          className={styles.secondaryButton}
          onClick={onCreateRubric}
          type="button"
        >
          <AppIcon name="plus" size={14} />
          创建 Rubric
        </button>
      ) : null}
      <p className={styles.inspectorMeta}>
        {data.visibleReviews.length} 项审阅 · {data.visibleFeedback.length}{" "}
        条反馈 · {data.visibleSnapshots.length} 个快照
      </p>
    </div>
  );
}

export function CollaborationWorkbench({
  actions,
  context,
  data,
}: CollaborationWorkbenchProps) {
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(
    data.visibleReviews[0]?.entity.entity_id ?? null,
  );
  const [sheet, setSheet] = useState<SheetName>(null);
  const unlockRef = useRef<HTMLButtonElement>(null);
  const activeReviewId =
    selectedReviewId &&
    data.visibleReviews.some(
      (item) => item.entity.entity_id === selectedReviewId,
    )
      ? selectedReviewId
      : (data.visibleReviews[0]?.entity.entity_id ?? null);
  const selectedReview = useMemo(
    () =>
      data.visibleReviews.find(
        (item) => item.entity.entity_id === activeReviewId,
      ) ?? null,
    [activeReviewId, data.visibleReviews],
  );
  const role = context.selectedWorkspace?.role as CollaborationRole | undefined;
  const capabilities = collaborationCapabilities(role);
  const primary = context.unlocked ? (
    selectedReview ? (
      <button
        className={styles.primaryButton}
        data-workbench-primary="true"
        disabled={!capabilities.canSubmitFeedback}
        onClick={() => setSheet("feedback")}
        type="button"
      >
        <AppIcon name="clipboard" size={16} />
        提交反馈
      </button>
    ) : (
      <button
        className={styles.primaryButton}
        data-workbench-primary="true"
        disabled={!capabilities.canPlanShared || !context.selectedSpace}
        onClick={() => setSheet("review")}
        type="button"
      >
        <AppIcon name="plus" size={16} />
        发起审阅
      </button>
    )
  ) : (
    <button
      className={styles.primaryButton}
      data-workbench-primary="true"
      disabled={!context.workspaceId || !context.deviceId}
      id="collaboration-unlock"
      onClick={() => setSheet("unlock")}
      ref={unlockRef}
      type="button"
    >
      <AppIcon name="unlock" size={16} />
      解锁资料
    </button>
  );
  return (
    <main className={styles.root} id="main-content">
      <WorkbenchFrame
        context={
          <WorkbenchContextBar
            context={{
              permission: {
                label: context.selectedWorkspace?.role ?? "只读",
                tone:
                  context.selectedWorkspace?.role === "viewer"
                    ? "warn"
                    : "good",
              },
              space: context.selectedSpace
                ? {
                    id: context.selectedSpace.id,
                    name: context.selectedSpace.name,
                  }
                : undefined,
              sync: {
                label:
                  context.collaborationState === "offline-stale"
                    ? "待同步"
                    : "已同步",
                tone:
                  context.collaborationState === "offline-stale"
                    ? "warn"
                    : "good",
              },
              vault: {
                label: context.unlocked ? "已解锁" : "已锁定",
                tone: context.unlocked ? "good" : "warn",
              },
              workspace: context.selectedWorkspace
                ? {
                    id: context.selectedWorkspace.id,
                    name: context.selectedWorkspace.name,
                  }
                : undefined,
            }}
          />
        }
        header={
          <WorkbenchHeader
            actions={primary}
            description="在明确共享对象上发起审阅，沿 Rubric 收集反馈，并发布不可变报告快照。"
            eyebrow="COLLABORATION · SHARED REVIEW WORKBENCH"
            title="小组审阅工作台"
          />
        }
        initialPane="master"
        inspector={
          <MemberInspector
            context={context}
            data={data}
            onCreateRubric={() => setSheet("rubric")}
            selectedReview={selectedReview}
          />
        }
        inspectorLabel="成员 Inspector"
        label="共享审阅工作台"
        main={
          <>
            <StateNotice
              action={
                context.collaborationState === "locked" ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setSheet("unlock")}
                    type="button"
                  >
                    解锁本地资料
                  </button>
                ) : context.collaborationState === "empty" ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={!capabilities.canPlanShared}
                    onClick={() => setSheet("rubric")}
                    type="button"
                  >
                    创建 Rubric
                  </button>
                ) : undefined
              }
              emptyDescription="共享 Space 已就绪；创建 Rubric 后即可发起可追溯审阅。"
              emptyTitle="当前共享 Space 还没有审阅"
              onRetry={() => void actions.loadContext()}
              state={context.collaborationState}
            />
            <StatusLine>{context.status}</StatusLine>
            <ReviewMain
              context={context}
              data={data}
              onFeedback={() => setSheet("feedback")}
              onReport={() => setSheet("report")}
              selectedReview={selectedReview}
            />
          </>
        }
        mainLabel="Rubric 与反馈"
        master={
          <ReviewMaster
            context={context}
            data={data}
            onCreateRubric={() => setSheet("rubric")}
            onSelect={(id) => setSelectedReviewId(id)}
            selectedId={activeReviewId}
          />
        }
        masterLabel="审阅请求"
        toolbar={<ContextToolbar actions={actions} context={context} />}
      />
      {sheet === "unlock" ? (
        <UnlockSheet
          actions={actions}
          context={context}
          onOpenChange={(open) => setSheet(open ? "unlock" : null)}
          open
          restoreFocusRef={unlockRef}
        />
      ) : null}
      {sheet === "rubric" ? (
        <RubricSheet
          actions={actions}
          onOpenChange={(open) => setSheet(open ? "rubric" : null)}
          open
        />
      ) : null}
      {sheet === "review" ? (
        <ReviewSheet
          actions={actions}
          data={data}
          onOpenChange={(open) => setSheet(open ? "review" : null)}
          open
        />
      ) : null}
      {sheet === "feedback" ? (
        <FeedbackSheet
          actions={actions}
          data={data}
          onOpenChange={(open) => setSheet(open ? "feedback" : null)}
          open
          selectedReviewId={activeReviewId}
        />
      ) : null}
      {sheet === "report" ? (
        <SnapshotSheet
          actions={actions}
          data={data}
          onOpenChange={(open) => setSheet(open ? "report" : null)}
          open
          selectedReviewId={activeReviewId}
        />
      ) : null}
    </main>
  );
}
