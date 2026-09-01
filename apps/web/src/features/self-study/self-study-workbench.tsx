"use client";

import type { components } from "@logion/contracts";
import type { JsonObject, LocalEntity } from "@logion/offline";
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
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
  ProductWorkbenchStateNotice,
  type ProductWorkbenchState,
} from "@/components/product/product-workbench-state";

import { buildSelfStudySummary } from "./self-study-workbench-model";

import styles from "./self-study-workbench.module.css";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];

export type SelfStudyKind =
  | "deliverable"
  | "inbox_item"
  | "learning_track"
  | "study_project";

export interface SelfStudyView {
  entity: LocalEntity;
  payload: JsonObject;
}

export interface SelfStudyWorkbenchData {
  deliverables: SelfStudyView[];
  inbox: SelfStudyView[];
  projects: SelfStudyView[];
  summary: ReturnType<typeof buildSelfStudySummary>;
  tracks: SelfStudyView[];
}

export interface SelfStudyWorkbenchContext {
  deviceId: string;
  examState: ProductWorkbenchState;
  selectedSpace: Space | undefined;
  selectedWorkspace: Workspace | undefined;
  spaceId: string;
  status: string;
  unlocked: boolean;
  workspaceId: string;
}

export interface SelfStudyWorkbenchActions {
  loadContext: () => Promise<void>;
  setSpaceId: (id: string) => void;
  setWorkspaceId: (id: string) => void;
  submit: (event: FormEvent<HTMLFormElement>, kind: SelfStudyKind) => Promise<boolean>;
  synchronize: () => Promise<void>;
  unlock: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}

export interface SelfStudyWorkbenchProps {
  actions: SelfStudyWorkbenchActions;
  context: SelfStudyWorkbenchContext;
  data: SelfStudyWorkbenchData;
}

type SelectedItem =
  | { id: string; kind: "deliverable" | "inbox" | "project" | "track" }
  | null;

const KIND_LABELS: Record<NonNullable<SelectedItem>["kind"], string> = {
  deliverable: "成果",
  inbox: "收件箱条目",
  project: "项目",
  track: "学习路线",
};

function text(payload: JsonObject, key: string, fallback = "") {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function EmptyPane({ action, description, title }: { action?: ReactNode; description: string; title: string }) {
  return <div className={styles.emptyPane}><span aria-hidden="true"><AppIcon name="folder" size={17} /></span><div><strong>{title}</strong><p>{description}</p>{action}</div></div>;
}

function SectionHeading({ action, eyebrow, title, count }: { action?: ReactNode; eyebrow: string; title: string; count?: number }) {
  return <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>{eyebrow}</p><h2>{title}</h2></div><div className={styles.sectionActions}>{count === undefined ? null : <span className={styles.sectionMeta}>{count}</span>}{action}</div></header>;
}

function UnlockSheet({ actions, context, onOpenChange, open, restoreFocusRef }: { actions: SelfStudyWorkbenchActions; context: SelfStudyWorkbenchContext; onOpenChange: (open: boolean) => void; open: boolean; restoreFocusRef: RefObject<HTMLButtonElement | null> }) {
  const formId = useId();
  return <WorkbenchSheet description="口令只在当前应用会话内存中使用；学习资料保持端侧加密。" footer={<><button className={styles.secondaryButton} onClick={() => onOpenChange(false)} type="button">取消</button><button className={styles.primaryButton} form={formId} type="submit">解锁资料</button></>} onOpenChange={onOpenChange} open={open} restoreFocusRef={restoreFocusRef} title="解锁本地学习资料"><form className={styles.sheetForm} id={formId} onSubmit={async (event) => { const ok = await actions.unlock(event); if (ok) onOpenChange(false); }}><label htmlFor={`${formId}-passphrase`}>本地口令</label><input autoComplete="current-password" autoFocus id={`${formId}-passphrase`} minLength={10} name="passphrase" required type="password" /><p className={styles.formHint}>{context.workspaceId ? "当前 Workspace 的私有资料将在解锁后读取。" : "请先选择 Workspace 与设备。"}</p></form></WorkbenchSheet>;
}

function RecordSheet({ actions, data, initialTitle, kind, onOpenChange, open, selectedTrackId, selectedProjectId }: { actions: SelfStudyWorkbenchActions; data: SelfStudyWorkbenchData; initialTitle?: string; kind: "deliverable" | "inbox_item" | "learning_track" | "study_project"; onOpenChange: (open: boolean) => void; open: boolean; selectedTrackId?: string; selectedProjectId?: string }) {
  const formId = useId();
  const title = { deliverable: "记录已完成成果", inbox_item: "快速收集想法", learning_track: "新建学习路线", study_project: "新建学习项目" }[kind];
  return <WorkbenchSheet description={kind === "deliverable" ? "成果是仅追加的完成证据，必须带完成时间。" : "保存后写入当前 Space 的本地加密资料并尝试同步。"} footer={<><button className={styles.secondaryButton} onClick={() => onOpenChange(false)} type="button">取消</button><button className={styles.primaryButton} form={formId} type="submit">{title}</button></>} onOpenChange={onOpenChange} open={open} title={title}><form className={styles.sheetForm} id={formId} onSubmit={async (event) => { const ok = await actions.submit(event, kind); if (ok) onOpenChange(false); }}>
    {kind === "inbox_item" ? <><label htmlFor={`${formId}-title`}>想法或资料标题</label><input defaultValue={initialTitle} id={`${formId}-title`} maxLength={160} name="title" required /><label htmlFor={`${formId}-note`}>备注</label><textarea id={`${formId}-note`} maxLength={20000} name="note" rows={4} /></> : null}
    {kind === "learning_track" ? <><label htmlFor={`${formId}-title`}>路线名称</label><input defaultValue={initialTitle} id={`${formId}-title`} maxLength={160} name="title" required /><label htmlFor={`${formId}-objective`}>路线目标</label><textarea id={`${formId}-objective`} maxLength={20000} name="objective" rows={3} /></> : null}
    {kind === "study_project" ? <><label htmlFor={`${formId}-track`}>所属路线</label><select defaultValue={selectedTrackId ?? data.tracks[0]?.entity.entity_id ?? ""} id={`${formId}-track`} name="track_id" required><option value="">请选择路线</option>{data.tracks.map((track) => <option key={track.entity.entity_id} value={track.entity.entity_id}>{text(track.payload, "title")}</option>)}</select><label htmlFor={`${formId}-title`}>项目名称</label><input defaultValue={initialTitle} id={`${formId}-title`} maxLength={160} name="title" required /><label htmlFor={`${formId}-outcome`}>预期成果</label><textarea id={`${formId}-outcome`} maxLength={20000} name="outcome" required rows={3} /></> : null}
    {kind === "deliverable" ? <><label htmlFor={`${formId}-project`}>所属项目</label><select defaultValue={selectedProjectId ?? data.projects[0]?.entity.entity_id ?? ""} id={`${formId}-project`} name="project_id" required><option value="">请选择项目</option>{data.projects.map((project) => <option key={project.entity.entity_id} value={project.entity.entity_id}>{text(project.payload, "title")}</option>)}</select><label htmlFor={`${formId}-title`}>成果名称</label><input defaultValue={initialTitle} id={`${formId}-title`} maxLength={160} name="title" required /><label htmlFor={`${formId}-evidence`}>完成证据摘要</label><textarea id={`${formId}-evidence`} maxLength={20000} name="evidence" required rows={4} /><p className={styles.formHint}>完成时间将记录为当前时间（ISO 8601 带时区）。</p></> : null}
  </form></WorkbenchSheet>;
}

function ContextToolbar({ actions, context }: { actions: SelfStudyWorkbenchActions; context: SelfStudyWorkbenchContext }) {
  return <WorkbenchToolbar label="自主学习上下文操作"><WorkbenchSelect disabled={!context.selectedWorkspace} label="选择 Workspace" onValueChange={actions.setWorkspaceId} options={context.selectedWorkspace ? [{ label: context.selectedWorkspace.name, value: context.workspaceId }] : []} placeholder="Workspace" value={context.workspaceId || undefined} /><WorkbenchSelect disabled={!context.selectedSpace} label="选择 Space" onValueChange={actions.setSpaceId} options={context.selectedSpace ? [{ label: context.selectedSpace.name, value: context.spaceId }] : []} placeholder="Space" value={context.spaceId || undefined} /><span className={styles.toolbarSpacer} /><WorkbenchTooltip content="同步当前 Workspace"><button aria-label="同步当前 Workspace" className={styles.iconButton} disabled={!context.unlocked} onClick={() => void actions.synchronize()} type="button"><AppIcon name="refresh" size={16} /></button></WorkbenchTooltip></WorkbenchToolbar>;
}

function InboxMaster({ data, onSelect, selectedId, onCapture }: { data: SelfStudyWorkbenchData; onCapture: () => void; onSelect: (item: SelectedItem) => void; selectedId: string | null }) {
  const projectsByTrack = useMemo(() => new Map(data.tracks.map((track) => [track.entity.entity_id, data.projects.filter((candidate) => text(candidate.payload, "track_id") === track.entity.entity_id)])), [data.projects, data.tracks]);
  return <div className={styles.master}><SectionHeading action={<button className={styles.sectionAction} onClick={onCapture} type="button">快速收集</button>} count={data.inbox.length} eyebrow="INBOX" title="快速收件箱" /><p className={styles.masterHint}>先捕获，后分诊</p><div className={styles.itemList} data-testid="self-study-inbox">{data.inbox.map((item) => <button aria-current={selectedId === item.entity.entity_id ? "true" : undefined} className={styles.itemRow} data-selected={selectedId === item.entity.entity_id} key={item.entity.entity_id} onClick={() => onSelect({ id: item.entity.entity_id, kind: "inbox" })} type="button"><span className={styles.itemIcon}><AppIcon name="folder" size={15} /></span><span className={styles.itemCopy}><strong>{text(item.payload, "title", "未命名条目")}</strong><small>{text(item.payload, "note", "待分诊") || "待分诊"}</small></span><ProductTag tone="warn">待分诊</ProductTag></button>)}{data.inbox.length === 0 ? <p className={styles.emptyInline}>收件箱为空。</p> : null}</div><SectionHeading action={<button className={styles.sectionAction} onClick={() => onSelect({ id: "", kind: "track" })} type="button">查看路线</button>} count={data.tracks.length} eyebrow="ROUTES" title="路线与项目" /><div className={styles.treeList} data-testid="self-study-projects">{data.tracks.map((track) => { const projects = projectsByTrack.get(track.entity.entity_id) ?? []; return <div className={styles.treeGroup} key={track.entity.entity_id}><button aria-current={selectedId === track.entity.entity_id ? "true" : undefined} className={styles.itemRow} data-selected={selectedId === track.entity.entity_id} onClick={() => onSelect({ id: track.entity.entity_id, kind: "track" })} type="button"><span className={styles.itemIcon}><AppIcon name="layout-template" size={15} /></span><span className={styles.itemCopy}><strong>{text(track.payload, "title", "未命名路线")}</strong><small>{text(track.payload, "objective", "暂无目标") || "暂无目标"}</small></span><span className={styles.rowMeta}>{projects.length} 项目</span></button>{projects.map((project) => <button aria-current={selectedId === project.entity.entity_id ? "true" : undefined} className={`${styles.itemRow} ${styles.nestedRow}`} data-selected={selectedId === project.entity.entity_id} key={project.entity.entity_id} onClick={() => onSelect({ id: project.entity.entity_id, kind: "project" })} type="button"><span className={styles.itemIcon}><AppIcon name="target" size={14} /></span><span className={styles.itemCopy}><strong>{text(project.payload, "title", "未命名项目")}</strong><small>{text(project.payload, "intended_outcome", "暂无预期成果")}</small></span></button>)}</div>; })}{data.tracks.length === 0 ? <p className={styles.emptyInline}>暂无学习路线。</p> : null}</div><div className={styles.masterFooter}><span>{data.summary.deliverableCount} 项成果证据</span><span>{data.summary.projectCoverage === null ? "尚无项目进度" : `${Math.round(data.summary.projectCoverage)}% 项目有成果`}</span></div></div>;
}

function DetailMain({ data, selected, onOpenSheet }: { data: SelfStudyWorkbenchData; onOpenSheet: (kind: "deliverable" | "inbox_item" | "learning_track" | "study_project") => void; selected: SelectedItem }) {
  if (!selected) return <EmptyPane action={<button className={styles.primaryButton} onClick={() => onOpenSheet("inbox_item")} type="button">开始捕获</button>} description="捕获 → 分诊为路线或项目 → 留下可运行的成果证据。" title="从收件箱开始" />;
  if (selected.kind === "inbox") { const item = data.inbox.find((candidate) => candidate.entity.entity_id === selected.id); return <section className={styles.detailStack}><div className={styles.detailHero}><p className={styles.eyebrow}>INBOX ITEM</p><h2>{text(item?.payload ?? {}, "title", "收件箱条目")}</h2><p>{text(item?.payload ?? {}, "note", "暂无备注") || "暂无备注"}</p><small>选择下一步，将它带入正式学习结构。</small></div><SectionHeading eyebrow="TRIAGE" title="分诊下一步" /><div className={styles.actionGrid}><button className={styles.secondaryButton} disabled={!data.tracks.length} onClick={() => onOpenSheet("study_project")} type="button"><AppIcon name="target" size={15} />建立项目</button><button className={styles.secondaryButton} onClick={() => onOpenSheet("learning_track")} type="button"><AppIcon name="layout-template" size={15} />建立路线</button><button className={styles.secondaryButton} disabled={!data.projects.length} onClick={() => onOpenSheet("deliverable")} type="button"><AppIcon name="shield" size={15} />记录成果</button></div></section>; }
  if (selected.kind === "track") { const track = data.tracks.find((candidate) => candidate.entity.entity_id === selected.id); const projects = data.projects.filter((project) => text(project.payload, "track_id") === selected.id); return <section className={styles.detailStack}><div className={styles.detailHero}><p className={styles.eyebrow}>LEARNING ROUTE</p><h2>{text(track?.payload ?? {}, "title", "学习路线")}</h2><p>{text(track?.payload ?? {}, "objective", "暂无目标") || "暂无目标"}</p></div><SectionHeading action={<button className={styles.sectionAction} onClick={() => onOpenSheet("study_project")} type="button">新建项目</button>} count={projects.length} eyebrow="PROJECT BOARD" title="路线下的项目" />{projects.length ? <div className={styles.timelineList}>{projects.map((project) => <button className={styles.timelineRow} key={project.entity.entity_id} onClick={() => onOpenSheet("deliverable")} type="button"><span className={styles.timelineMarker}><AppIcon name="target" size={14} /></span><span><strong>{text(project.payload, "title")}</strong><small>{text(project.payload, "intended_outcome", "暂无预期成果")}</small></span><AppIcon name="chevron-down" size={15} /></button>)}</div> : <EmptyPane description="为路线建立第一个项目，项目成果会在时间线中累积。" title="路线下暂无项目" />}</section>; }
  if (selected.kind === "project") { const project = data.projects.find((candidate) => candidate.entity.entity_id === selected.id); const deliverables = data.deliverables.filter((deliverable) => text(deliverable.payload, "project_id") === selected.id); return <section className={styles.detailStack}><div className={styles.detailHero}><p className={styles.eyebrow}>STUDY PROJECT</p><h2>{text(project?.payload ?? {}, "title", "学习项目")}</h2><p>预期成果：{text(project?.payload ?? {}, "intended_outcome", "尚未定义")}</p><div className={styles.heroMetric}><strong>{deliverables.length}</strong><span>项成果</span></div></div><SectionHeading action={<button className={styles.sectionAction} onClick={() => onOpenSheet("deliverable")} type="button">记录成果</button>} count={deliverables.length} eyebrow="DELIVERABLES" title="成果时间线" />{deliverables.length ? <div className={styles.timelineList}>{deliverables.map((deliverable) => <article className={styles.timelineRow} key={deliverable.entity.entity_id}><span className={styles.timelineMarker}><AppIcon name="shield" size={14} /></span><span><strong>{text(deliverable.payload, "title")}</strong><small>{text(deliverable.payload, "evidence_summary", "暂无证据摘要")}</small></span><time>{dateLabel(text(deliverable.payload, "completed_at"))}</time></article>)}</div> : <EmptyPane description="成果必须带完成时间，并由你明确确认完成。" title="项目还没有成果" />}</section>; }
  const deliverable = data.deliverables.find((candidate) => candidate.entity.entity_id === selected.id); return <section className={styles.detailStack}><div className={styles.detailHero}><p className={styles.eyebrow}>DELIVERABLE</p><h2>{text(deliverable?.payload ?? {}, "title", "交付成果")}</h2><p>{text(deliverable?.payload ?? {}, "evidence_summary", "暂无证据摘要")}</p><small>完成时间：{dateLabel(text(deliverable?.payload ?? {}, "completed_at"))}</small></div><p className={styles.note}>成果是仅追加的完成证据，系统不会把 AI 草稿标记为已完成。</p></section>;
}

function TimelineMain({ data, onOpenSheet }: { data: SelfStudyWorkbenchData; onOpenSheet: (kind: "deliverable") => void }) {
  const entries = [...data.deliverables].sort((a, b) => text(b.payload, "completed_at").localeCompare(text(a.payload, "completed_at")));
  return <section className={styles.detailStack} data-testid="self-study-deliverables"><SectionHeading action={<button className={styles.sectionAction} disabled={!data.projects.length} onClick={() => onOpenSheet("deliverable")} type="button">记录成果</button>} count={entries.length} eyebrow="DELIVERABLE TIMELINE" title="成果时间线" /><p className={styles.sectionDescription}>沿项目保留真实完成证据，完成时间由当前设备记录。</p>{entries.length ? <div className={styles.timelineList}>{entries.map((deliverable) => <article className={styles.timelineRow} key={deliverable.entity.entity_id}><span className={styles.timelineMarker}><AppIcon name="shield" size={14} /></span><span><strong>{text(deliverable.payload, "title")}</strong><small>{text(deliverable.payload, "evidence_summary")}</small></span><time>{dateLabel(text(deliverable.payload, "completed_at"))}</time></article>)}</div> : <EmptyPane description="记录第一个成果后，路线与项目的推进会有可追溯证据。" title="还没有成果证据" />}</section>;
}

function Inspector({ context, data, selected }: { context: SelfStudyWorkbenchContext; data: SelfStudyWorkbenchData; selected: SelectedItem }) {
  const item = selected ? [
    ...data.inbox.map((value) => ({ ...value, kind: "inbox" as const })),
    ...data.tracks.map((value) => ({ ...value, kind: "track" as const })),
    ...data.projects.map((value) => ({ ...value, kind: "project" as const })),
    ...data.deliverables.map((value) => ({ ...value, kind: "deliverable" as const })),
  ].find((value) => value.entity.entity_id === selected.id) : null;
  if (!item) return <div className={styles.inspector}><header className={styles.inspectorHeader}><p className={styles.eyebrow}>DELIVERABLE TIMELINE</p><h2>成果检查器</h2><p>选择收件箱、路线、项目或成果查看其上下文。</p></header><EmptyPane description="选中 Master 中的对象后，这里会显示其关系和同步边界。" title="尚未选择对象" /></div>;
  const parentId = text(item.payload, "track_id") || text(item.payload, "project_id");
  return <div className={styles.inspector} data-testid="self-study-inspector"><header className={styles.inspectorHeader}><p className={styles.eyebrow}>OBJECT INSPECTOR</p><h2>{text(item.payload, "title", KIND_LABELS[item.kind])}</h2><p>{KIND_LABELS[item.kind]} · 当前 Space 作用域</p></header><InspectorSection title="对象上下文"><dl className={styles.metaList}><div><dt>类型</dt><dd>{KIND_LABELS[item.kind]}</dd></div><div><dt>状态</dt><dd>{item.entity.sync_status === "clean" ? "已同步" : "等待同步"}</dd></div><div><dt>权限</dt><dd>{context.selectedWorkspace?.role ?? "只读"}</dd></div><div><dt>Vault</dt><dd>{context.unlocked ? "已解锁" : "已锁定"}</dd></div>{parentId ? <div><dt>上级对象</dt><dd>{parentId}</dd></div> : null}</dl></InspectorSection><p className={styles.note}>Workspace、Space、权限、Vault 和 Sync 状态持续绑定到当前对象；不会跨空间读取或写入。</p></div>;
}

export function SelfStudyWorkbench({ actions, context, data }: SelfStudyWorkbenchProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<NonNullable<SelectedItem>["kind"] | null>(null);
  const [tab, setTab] = useState("board");
  const [sheet, setSheet] = useState<"deliverable" | "inbox_item" | "learning_track" | "study_project" | "unlock" | null>(null);
  const unlockRef = useRef<HTMLButtonElement>(null);
  const selected: SelectedItem = selectedId && selectedKind ? { id: selectedId, kind: selectedKind } : null;
  const select = (item: SelectedItem) => { setSelectedId(item?.id || null); setSelectedKind(item?.kind ?? null); if (item?.kind === "inbox") setTab("inbox"); else if (item) setTab("board"); };
  const untriaged = data.inbox[0];
  const primary = context.unlocked ? <button className={styles.primaryButton} data-workbench-primary="true" disabled={!context.spaceId} onClick={() => { if (untriaged) select({ id: untriaged.entity.entity_id, kind: "inbox" }); else setSheet("inbox_item"); }} type="button"><AppIcon name={untriaged ? "folder" : "plus"} size={16} />{untriaged ? "开始分诊" : "开始捕获"}</button> : <button className={styles.primaryButton} data-workbench-primary="true" disabled={!context.workspaceId || !context.deviceId} id="self-study-unlock" onClick={() => setSheet("unlock")} ref={unlockRef} type="button"><AppIcon name="unlock" size={16} />解锁资料</button>;
  const tabs: WorkbenchTab[] = [{ label: "收件箱", value: "inbox", count: data.inbox.length }, { label: "路线与项目", value: "board", count: data.projects.length }, { label: "成果时间线", value: "timeline", count: data.deliverables.length }];
  return <main className={styles.root} id="main-content"><WorkbenchFrame context={<WorkbenchContextBar context={{ permission: { label: context.selectedWorkspace?.role ?? "只读", tone: context.selectedWorkspace?.role === "viewer" ? "warn" : "good" }, space: context.selectedSpace ? { id: context.selectedSpace.id, name: context.selectedSpace.name } : undefined, sync: { label: context.examState === "offline-stale" ? "待同步" : "已同步", tone: context.examState === "offline-stale" ? "warn" : "good" }, vault: { label: context.unlocked ? "已解锁" : "已锁定", tone: context.unlocked ? "good" : "warn" }, workspace: context.selectedWorkspace ? { id: context.selectedWorkspace.id, name: context.selectedWorkspace.name } : undefined }} />} header={<WorkbenchHeader actions={primary} description="从收件箱捕获想法，分诊为路线或项目，再用真实成果推进学习。" eyebrow="SELF-STUDY · OUTCOME WORKBENCH" title="把想法推进为可验证成果" />} initialPane="master" inspector={<Inspector context={context} data={data} selected={selected} />} inspectorLabel="成果检查器" label="自主学习工作台" main={<><ProductWorkbenchStateNotice action={context.examState === "locked" ? <button className={styles.secondaryButton} onClick={() => setSheet("unlock")} type="button">解锁本地资料</button> : context.examState === "empty" ? <button className={styles.secondaryButton} onClick={() => setSheet("inbox_item")} type="button">收集第一条想法</button> : undefined} emptyDescription="当前 Space 尚无收件箱、路线、项目或成果；先捕获一条想法。" emptyTitle="当前 Space 还没有自主学习记录" onRetry={() => void actions.loadContext()} state={context.examState} /><div className={styles.main} data-testid="self-study-main"><div className={styles.statusLine} aria-live="polite"><span />{context.status}</div><div data-testid="self-study-tabs"><WorkbenchTabs label="自主学习视图" onValueChange={setTab} tabs={tabs} value={tab}><WorkbenchTabPanel forceMount value="inbox"><DetailMain data={data} onOpenSheet={setSheet} selected={selected?.kind === "inbox" ? selected : null} /></WorkbenchTabPanel><WorkbenchTabPanel forceMount value="board"><DetailMain data={data} onOpenSheet={setSheet} selected={selected?.kind === "track" || selected?.kind === "project" ? selected : null} /></WorkbenchTabPanel><WorkbenchTabPanel forceMount value="timeline"><TimelineMain data={data} onOpenSheet={(kind) => setSheet(kind)} /></WorkbenchTabPanel></WorkbenchTabs></div></div></>} mainLabel="路线与项目工作面" master={<InboxMaster data={data} onCapture={() => setSheet("inbox_item")} onSelect={select} selectedId={selectedId} />} masterLabel="收件箱与路线" toolbar={<ContextToolbar actions={actions} context={context} />} />{sheet === "unlock" ? <UnlockSheet actions={actions} context={context} onOpenChange={(open) => setSheet(open ? "unlock" : null)} open restoreFocusRef={unlockRef} /> : null}{sheet && sheet !== "unlock" ? <RecordSheet actions={actions} data={data} initialTitle={selected?.kind === "inbox" ? text(data.inbox.find((item) => item.entity.entity_id === selected.id)?.payload ?? {}, "title") : undefined} kind={sheet} onOpenChange={(open) => setSheet(open ? sheet : null)} open selectedProjectId={selected?.kind === "project" ? selected.id : undefined} selectedTrackId={selected?.kind === "track" ? selected.id : undefined} /> : null}</main>;
}
