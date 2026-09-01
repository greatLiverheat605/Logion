"use client";

import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import { ProductTag } from "@/components/product/product-ui";
import {
  ProductWorkbenchStateNotice as StateNotice,
  type ProductWorkbenchState,
} from "@/components/product/product-workbench-state";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";

import type {
  ExamView,
  MockExamPayload,
  ProtectedView,
  ScoreRecordPayload,
  Space,
  SubjectPayload,
  SyllabusNodePayload,
  Workspace,
} from "./exam-center";
import { examCountdown } from "./exam-workbench-model";

import styles from "./exam-workbench.module.css";

type SubmitAction = (event: FormEvent<HTMLFormElement>) => Promise<boolean>;

export interface ExamWorkbenchContext {
  contextPhase: "error" | "loading" | "ready";
  dataPhase: "error" | "idle" | "loading" | "ready";
  dateStatus: "scheduled" | "undetermined";
  deviceId: string;
  examState: ProductWorkbenchState;
  selectedSpace?: Space;
  selectedWorkspace?: Workspace;
  spaceId: string;
  spaces: Space[];
  status: string;
  syllabusSubjectId: string;
  unlocked: boolean;
  workspaceId: string;
  workspaces: Workspace[];
}

export interface ExamWorkbenchData {
  coveredNodes: number;
  coverageRate: number | null;
  latestNormalizedScore: number;
  normalizedScores: number[];
  primaryExam: ExamView | undefined;
  visibleExams: ExamView[];
  visibleMocks: ProtectedView<MockExamPayload>[];
  visibleNodes: ProtectedView<SyllabusNodePayload>[];
  visibleScores: ProtectedView<ScoreRecordPayload>[];
  visibleSubjects: ProtectedView<SubjectPayload>[];
}

export interface ExamWorkbenchActions {
  createExam: SubmitAction;
  createMockExam: SubmitAction;
  createScoreRecord: SubmitAction;
  createSubject: SubmitAction;
  createSyllabusNode: SubmitAction;
  loadContext: () => Promise<void>;
  setDateStatus: (value: "scheduled" | "undetermined") => void;
  setSpaceId: (value: string) => void;
  setSyllabusSubjectId: (value: string) => void;
  setWorkspaceId: (value: string) => void;
  synchronize: () => Promise<boolean>;
  unlock: SubmitAction;
}

export interface ExamWorkbenchProps {
  actions: ExamWorkbenchActions;
  context: ExamWorkbenchContext;
  data: ExamWorkbenchData;
}

function formatDate(value: string | null): string {
  if (!value) return "日期待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期无效";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function EmptyPane({ description, title }: { description: string; title: string }) {
  return (
    <div className={styles.emptyPane} role="status">
      <span aria-hidden="true"><AppIcon name="target" size={18} /></span>
      <div><strong>{title}</strong><p>{description}</p></div>
    </div>
  );
}

function StatusLine({ children }: { children: string }) {
  return <p aria-live="polite" className={styles.statusLine}><span aria-hidden="true" />{children}</p>;
}

function scoreForMock(
  scores: ProtectedView<ScoreRecordPayload>[],
  mockId: string,
) {
  return scores.filter((score) => score.payload.mock_exam_id === mockId).at(-1);
}

function ExamMaster({
  context,
  data,
  onSelect,
  onCreate,
  selectedId,
}: {
  context: ExamWorkbenchContext;
  data: ExamWorkbenchData;
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <div className={styles.master} data-testid="exam-list">
      <header className={styles.paneHeader}>
        <div><p className={styles.eyebrow}>EXAM MASTER</p><h2>考试列表</h2></div>
        <span className={styles.count} aria-label={`${data.visibleExams.length} 项考试`}>{data.visibleExams.length}</span>
      </header>
      <button
        className={styles.masterPrimary}
        data-testid="exam-create"
        disabled={!context.unlocked || !context.spaceId}
        onClick={onCreate}
        type="button"
      >
        <AppIcon name="plus" size={15} /> 创建考试
      </button>
      <div aria-label="当前 Space 的考试" className={styles.examList}>
        {data.visibleExams.length ? data.visibleExams.map((exam) => {
          const active = selectedId === exam.entity.entity_id;
          return (
            <button
              aria-current={active ? "true" : undefined}
              className={styles.examRow}
              data-selected={active}
              key={exam.entity.entity_id}
              onClick={() => onSelect(exam.entity.entity_id)}
              type="button"
            >
              <span className={styles.examIcon} aria-hidden="true"><AppIcon name="target" size={15} /></span>
              <span className={styles.examCopy}>
                <strong>{exam.payload.title}</strong>
                <small>{examCountdown(exam.payload.exam_at)} · {formatDate(exam.payload.exam_at)}</small>
                <span className={styles.rowTags}>
                  <ProductTag tone={exam.entity.sync_status === "clean" ? "good" : "info"}>
                    {exam.entity.sync_status === "clean" ? "已同步" : "待同步"}
                  </ProductTag>
                  {exam.payload.target_score !== null ? <ProductTag tone="warn">目标 {exam.payload.target_score}</ProductTag> : null}
                </span>
              </span>
            </button>
          );
        }) : <EmptyPane description="创建考试后，这里会形成可选择的备考目标。" title="当前 Space 还没有考试" />}
      </div>
      <footer className={styles.masterFooter}>
        <span>{context.unlocked ? "Vault 已解锁" : "Vault 已锁定"}</span>
        <span>{context.selectedWorkspace?.role ?? "只读"}</span>
      </footer>
    </div>
  );
}

function CoverageMain({
  actions,
  data,
  onOpenSheet,
  selectedExam,
}: {
  actions: ExamWorkbenchActions;
  data: ExamWorkbenchData;
  onOpenSheet: (sheet: "subject" | "syllabus" | "mock" | "score") => void;
  selectedExam: ExamView | null;
}) {
  const subjectRows = data.visibleSubjects.filter((subject) => subject.payload.exam_id === selectedExam?.entity.entity_id);
  const nodeRows = data.visibleNodes.filter((node) => subjectRows.some((subject) => subject.entity.entity_id === node.payload.subject_id));
  const mocks = data.visibleMocks.filter((mock) => mock.payload.exam_id === selectedExam?.entity.entity_id);
  const weakNodes = [...nodeRows].filter((node) => node.payload.coverage_status !== "covered").sort((a, b) => b.payload.importance - a.payload.importance);
  const coverageText = data.coverageRate === null ? "尚无节点" : `${Math.round(data.coverageRate)}%`;

  return (
    <div className={styles.main}>
      <StatusLine>{"考试数据来自当前 Space 的加密本地记录；每次写入后会尝试同步。"}</StatusLine>
      <section className={styles.examHero} aria-label="当前考试摘要">
        <div>
          <p className={styles.eyebrow}>SELECTED EXAM</p>
          <h2>{selectedExam?.payload.title ?? "建立你的第一个备考目标"}</h2>
          <p>{selectedExam ? `${formatDate(selectedExam.payload.exam_at)} · ${examCountdown(selectedExam.payload.exam_at)}` : "从考试日期、科目权重和大纲覆盖开始。"}</p>
        </div>
        <div className={styles.heroMetric}><strong>{selectedExam ? coverageText : "—"}</strong><span>大纲覆盖</span></div>
      </section>

      <section className={styles.section} data-testid="exam-coverage" aria-label="考试覆盖概览">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>COVERAGE</p><h2>覆盖概览</h2></div><div className={styles.sectionActions}><span className={styles.sectionMeta}>{data.coveredNodes}/{nodeRows.length || 0} 个节点</span><button className={styles.sectionAction} disabled={!selectedExam} onClick={() => onOpenSheet("subject")} type="button">添加科目</button></div></header>
        <div className={styles.metricStrip}>
          <div><span>覆盖率</span><strong>{selectedExam ? coverageText : "—"}</strong></div>
          <div><span>科目</span><strong>{subjectRows.length}</strong></div>
          <div><span>模考</span><strong>{mocks.length}</strong></div>
          <div><span>最近得分率</span><strong>{data.normalizedScores.length ? `${Math.round(data.latestNormalizedScore)}%` : "—"}</strong></div>
        </div>
        <div className={styles.subjectList}>
          {subjectRows.length ? subjectRows.map((subject) => {
            const nodes = nodeRows.filter((node) => node.payload.subject_id === subject.entity.entity_id);
            const covered = nodes.filter((node) => node.payload.coverage_status === "covered").length;
            const rate = nodes.length ? (covered / nodes.length) * 100 : 0;
            return <article className={styles.subjectRow} key={subject.entity.entity_id}>
              <div><strong>{subject.payload.name}</strong><small>权重 {(subject.payload.weight_basis_points / 100).toFixed(0)}% · {covered}/{nodes.length} 节点已覆盖</small></div>
              <div aria-label={`${subject.payload.name} 覆盖率`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(rate)} className={styles.meter} role="progressbar"><span style={{ width: `${rate}%` }} /></div>
              <span className={styles.percent}>{Math.round(rate)}%</span>
            </article>;
          }) : <EmptyPane description="为当前考试添加科目后，覆盖率会按真实大纲节点计算。" title="还没有科目权重" />}
        </div>
      </section>

      <section className={styles.section} data-testid="exam-syllabus" aria-label="考试大纲">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>SYLLABUS</p><h2>考试大纲</h2><p>覆盖状态由本人显式记录，不把推测当作掌握。</p></div><button className={styles.sectionAction} disabled={!selectedExam || !data.visibleSubjects.length} onClick={() => { actions.setSyllabusSubjectId(subjectRows[0]?.entity.entity_id ?? ""); onOpenSheet("syllabus"); }} type="button">添加大纲节点</button></header>
        <div className={styles.syllabusList}>
          {nodeRows.length ? nodeRows.map((node) => {
            const subject = subjectRows.find((item) => item.entity.entity_id === node.payload.subject_id);
            const labels = { covered: "已覆盖", in_progress: "进行中", not_started: "未开始" } as const;
            return <div className={styles.syllabusRow} key={node.entity.entity_id}>
              <span className={styles.treeIndent} aria-hidden="true">{node.payload.parent_id ? "↳" : "•"}</span>
              <div><strong>{node.payload.title}</strong><small>{subject?.payload.name ?? "科目"} · 重要度 {node.payload.importance}/5</small></div>
              <ProductTag tone={node.payload.coverage_status === "covered" ? "good" : node.payload.coverage_status === "in_progress" ? "info" : "warn"}>{labels[node.payload.coverage_status]}</ProductTag>
            </div>;
          }) : <EmptyPane description="添加科目后建立树状大纲；父节点关系会在本地提交前校验。" title="还没有大纲节点" />}
        </div>
      </section>

      <section className={styles.section} data-testid="exam-mocks" aria-label="模考与成绩">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>MOCKS</p><h2>模考与成绩</h2><p>安排限时练习，完成后追加真实成绩记录。</p></div><div className={styles.sectionActions}><button className={styles.sectionAction} disabled={!selectedExam} onClick={() => onOpenSheet("mock")} type="button">安排模考</button>{mocks.length ? <button className={styles.sectionAction} disabled={!selectedExam} onClick={() => onOpenSheet("score")} type="button">记录成绩</button> : null}</div></header>
        <div className={styles.mockList}>
          {mocks.length ? mocks.map((mock) => {
            const score = scoreForMock(data.visibleScores, mock.entity.entity_id);
            return <div className={styles.mockRow} key={mock.entity.entity_id}>
              <div><strong>{mock.payload.title}</strong><small>{Math.round(mock.payload.duration_limit_seconds / 60)} 分钟 · {score ? `最近 ${score.payload.score}/${score.payload.score_scale_max}` : "尚未记录成绩"}</small></div>
              <button aria-label={score ? `追加 ${mock.payload.title} 成绩` : `录入 ${mock.payload.title} 成绩`} className={styles.textButton} disabled={!selectedExam} onClick={() => onOpenSheet("score")} type="button">{score ? "追加成绩" : "记录成绩"}</button>
            </div>;
          }) : <EmptyPane description="安排第一场模考后，成绩趋势和用时会在这里持续累积。" title="尚未安排模考" />}
        </div>
      </section>

      <section className={styles.section} data-testid="exam-weaknesses" aria-label="薄弱项">
        <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>WEAKNESS</p><h2>薄弱项</h2><p>根据未覆盖节点和重要度排序，不生成虚构的错题结论。</p></div></header>
        {weakNodes.length ? <div className={styles.weakList}>{weakNodes.slice(0, 4).map((node) => <a className={styles.weakRow} href="#exam-syllabus" key={node.entity.entity_id}><span><strong>{node.payload.title}</strong><small>重要度 {node.payload.importance}/5 · {node.payload.coverage_status === "in_progress" ? "进行中" : "尚未开始"}</small></span><AppIcon name="chevron-down" size={15} /></a>)}</div> : <EmptyPane description="当大纲节点尚未覆盖时，这里会按重要度提示需要补强的内容。" title="暂未形成薄弱项" />}
      </section>
    </div>
  );
}

function ExamInspector({ selectedExam, data, context }: { selectedExam: ExamView | null; data: ExamWorkbenchData; context: ExamWorkbenchContext }) {
  const subjects = data.visibleSubjects.filter((item) => item.payload.exam_id === selectedExam?.entity.entity_id);
  const nodes = data.visibleNodes.filter((item) => subjects.some((subject) => subject.entity.entity_id === item.payload.subject_id));
  return <div className={styles.inspector} data-testid="exam-inspector">
    <header className={styles.inspectorHeader}><p className={styles.eyebrow}>EXAM INSPECTOR</p><h2>{selectedExam?.payload.title ?? "考试详情"}</h2><p>{selectedExam ? "当前考试的范围、目标与本地同步边界。" : "选择一场考试查看详情。"}</p></header>
    {selectedExam ? <>
      <InspectorSection title="考试范围"><dl className={styles.metaList}><div><dt>日期</dt><dd>{formatDate(selectedExam.payload.exam_at)}</dd></div><div><dt>倒计时</dt><dd>{examCountdown(selectedExam.payload.exam_at)}</dd></div><div><dt>目标分</dt><dd>{selectedExam.payload.target_score === null ? "未设置" : `${selectedExam.payload.target_score} / ${selectedExam.payload.score_scale_max}`}</dd></div><div><dt>科目</dt><dd>{subjects.length} 个</dd></div><div><dt>大纲</dt><dd>{nodes.length} 个节点</dd></div></dl></InspectorSection>
      <InspectorSection title="权限与同步"><dl className={styles.metaList}><div><dt>权限</dt><dd>{context.selectedWorkspace?.role ?? "只读"}</dd></div><div><dt>可见范围</dt><dd>仅本人可见（user_id 边界）</dd></div><div><dt>Vault</dt><dd>{context.unlocked ? "已解锁" : "已锁定"}</dd></div><div><dt>记录状态</dt><dd>{selectedExam.entity.sync_status === "clean" ? "已同步" : "等待同步"}</dd></div></dl></InspectorSection>
      <p className={styles.inspectorNote}>AI 只能解释大纲或提供规划草稿；考试、科目、模考和成绩由本人明确创建。</p>
    </> : <EmptyPane description="选择 Master 中的考试，查看目标分、权限与同步状态。" title="没有选中的考试" />}
  </div>;
}

function ContextToolbar({ actions, context }: { actions: ExamWorkbenchActions; context: ExamWorkbenchContext }) {
  return <WorkbenchToolbar label="备考上下文操作">
    <WorkbenchSelect disabled={!context.workspaces.length} label="选择 Workspace" onValueChange={actions.setWorkspaceId} options={context.workspaces.map((item) => ({ label: item.name, value: item.id }))} placeholder="Workspace" value={context.workspaceId || undefined} />
    <WorkbenchSelect disabled={!context.spaces.length} label="选择 Space" onValueChange={actions.setSpaceId} options={context.spaces.map((item) => ({ label: item.name, value: item.id }))} placeholder="Space" value={context.spaceId || undefined} />
    <span className={styles.toolbarSpacer} />
    <WorkbenchTooltip content="同步当前 Workspace">
      <button aria-label="同步当前 Workspace" className={styles.iconButton} disabled={!context.unlocked} onClick={() => void actions.synchronize()} type="button"><AppIcon name="refresh" size={16} /></button>
    </WorkbenchTooltip>
  </WorkbenchToolbar>;
}

function UnlockSheet({ actions, context, onOpenChange, open, restoreFocusRef }: { actions: ExamWorkbenchActions; context: ExamWorkbenchContext; onOpenChange: (open: boolean) => void; open: boolean; restoreFocusRef: RefObject<HTMLButtonElement | null> }) {
  const formId = useId();
  return <WorkbenchSheet description="口令只在当前应用会话内存中使用；考试数据保持端侧加密。" footer={<><button className={styles.secondaryButton} onClick={() => onOpenChange(false)} type="button">取消</button><button className={styles.primaryButton} form={formId} type="submit">解锁资料</button></>} onOpenChange={onOpenChange} open={open} restoreFocusRef={restoreFocusRef} title="解锁本地备考资料">
    <form className={styles.sheetForm} id={formId} onSubmit={async (event) => { const ok = await actions.unlock(event); if (ok) onOpenChange(false); }}><label htmlFor={`${formId}-passphrase`}>本地口令</label><input autoComplete="current-password" autoFocus id={`${formId}-passphrase`} minLength={10} name="passphrase" required type="password" /><p className={styles.formHint}>{context.workspaceId ? "当前 Workspace 的本地资料将在解锁后读取。" : "请先选择 Workspace 与设备。"}</p></form>
  </WorkbenchSheet>;
}

function FormSheet({ actions, context, kind, onOpenChange, open, data, selectedExamId }: { actions: ExamWorkbenchActions; context: ExamWorkbenchContext; kind: "exam" | "subject" | "syllabus" | "mock" | "score"; onOpenChange: (open: boolean) => void; open: boolean; data: ExamWorkbenchData; selectedExamId?: string }) {
  const formId = useId();
  const [dateStatus, setDateStatus] = useState(context.dateStatus);
  const title = { exam: "创建考试", subject: "添加科目", syllabus: "添加大纲节点", mock: "安排模考", score: "记录成绩" }[kind];
  const submit = { exam: actions.createExam, subject: actions.createSubject, syllabus: actions.createSyllabusNode, mock: actions.createMockExam, score: actions.createScoreRecord }[kind];
  return <WorkbenchSheet description="低频字段在此局部编辑；保存后会加密写入本地并尝试同步。" footer={<><button className={styles.secondaryButton} onClick={() => onOpenChange(false)} type="button">取消</button><button className={styles.primaryButton} form={formId} type="submit">{title}</button></>} onOpenChange={onOpenChange} open={open} title={title}>
    <form className={styles.sheetForm} id={formId} onSubmit={async (event) => { const ok = await submit(event); if (ok) onOpenChange(false); }}>
      {kind === "exam" ? <><label htmlFor={`${formId}-title`}>考试名称</label><input id={`${formId}-title`} maxLength={160} name="title" required /><fieldset className={styles.choiceField}><legend>日期状态</legend><label><input checked={dateStatus === "scheduled"} name="date_status" onChange={() => { setDateStatus("scheduled"); actions.setDateStatus("scheduled"); }} type="radio" value="scheduled" /> 日期已确定</label><label><input checked={dateStatus === "undetermined"} name="date_status" onChange={() => { setDateStatus("undetermined"); actions.setDateStatus("undetermined"); }} type="radio" value="undetermined" /> 日期待定</label></fieldset>{dateStatus === "scheduled" ? <><label htmlFor={`${formId}-at`}>考试时间（本地时区）</label><input id={`${formId}-at`} name="exam_at" required type="datetime-local" /></> : null}<div className={styles.formGrid}><label htmlFor={`${formId}-target`}>目标分（可选）</label><input id={`${formId}-target`} min={0} name="target_score" type="number" /><label htmlFor={`${formId}-scale`}>满分（与目标分成对）</label><input id={`${formId}-scale`} min={1} name="score_scale_max" type="number" /></div></> : null}
      {kind === "subject" ? <><label htmlFor={`${formId}-exam`}>所属考试</label><select defaultValue={selectedExamId ?? data.primaryExam?.entity.entity_id ?? ""} id={`${formId}-exam`} name="exam_id" required><option value="">请选择</option>{data.visibleExams.map((exam) => <option key={exam.entity.entity_id} value={exam.entity.entity_id}>{exam.payload.title}</option>)}</select><label htmlFor={`${formId}-name`}>科目名称</label><input id={`${formId}-name`} maxLength={160} name="name" required /><label htmlFor={`${formId}-weight`}>权重（百分比）</label><input defaultValue="0" id={`${formId}-weight`} max={100} min={0} name="weight_percent" required step="0.01" type="number" /></> : null}
      {kind === "syllabus" ? <><label htmlFor={`${formId}-subject`}>所属科目</label><select id={`${formId}-subject`} name="subject_id" required value={context.syllabusSubjectId} onChange={(event) => actions.setSyllabusSubjectId(event.target.value)}><option value="">请选择</option>{data.visibleSubjects.map((subject) => <option key={subject.entity.entity_id} value={subject.entity.entity_id}>{subject.payload.name}</option>)}</select><label htmlFor={`${formId}-parent`}>父节点（可选）</label><select id={`${formId}-parent`} name="parent_id"><option value="">顶层节点</option>{data.visibleNodes.filter((node) => node.payload.subject_id === context.syllabusSubjectId).map((node) => <option key={node.entity.entity_id} value={node.entity.entity_id}>{node.payload.title}</option>)}</select><label htmlFor={`${formId}-node-title`}>节点名称</label><input id={`${formId}-node-title`} maxLength={240} name="title" required /><label htmlFor={`${formId}-importance`}>重要度</label><select defaultValue="3" id={`${formId}-importance`} name="importance"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></> : null}
      {kind === "mock" ? <><label htmlFor={`${formId}-mock-exam`}>所属考试</label><select defaultValue={selectedExamId ?? data.primaryExam?.entity.entity_id ?? ""} id={`${formId}-mock-exam`} name="exam_id" required><option value="">请选择</option>{data.visibleExams.map((exam) => <option key={exam.entity.entity_id} value={exam.entity.entity_id}>{exam.payload.title}</option>)}</select><label htmlFor={`${formId}-mock-title`}>模考名称</label><input id={`${formId}-mock-title`} maxLength={160} name="title" required /><label htmlFor={`${formId}-duration`}>限时（分钟）</label><input defaultValue="90" id={`${formId}-duration`} max={1440} min={1} name="duration_minutes" required type="number" /></> : null}
      {kind === "score" ? <><label htmlFor={`${formId}-score-mock`}>已完成模考</label><select id={`${formId}-score-mock`} name="mock_exam_id" required><option value="">请选择</option>{data.visibleMocks.map((mock) => <option key={mock.entity.entity_id} value={mock.entity.entity_id}>{mock.payload.title}</option>)}</select><label htmlFor={`${formId}-score`}>得分</label><input id={`${formId}-score`} min={0} name="score" required type="number" /><label htmlFor={`${formId}-score-scale`}>满分</label><input id={`${formId}-score-scale`} min={1} name="score_scale_max" required type="number" /><label htmlFor={`${formId}-score-duration`}>实际用时（分钟）</label><input id={`${formId}-score-duration`} max={1440} min={0} name="duration_minutes" required type="number" /></> : null}
    </form>
  </WorkbenchSheet>;
}

export function ExamWorkbench({ actions, context, data }: ExamWorkbenchProps) {
  const [selectedId, setSelectedId] = useState<string | null>(data.primaryExam?.entity.entity_id ?? null);
  const [sheet, setSheet] = useState<"exam" | "subject" | "syllabus" | "mock" | "score" | "unlock" | null>(null);
  const unlockButtonRef = useRef<HTMLButtonElement>(null);
  const effectiveSelectedId = selectedId && data.visibleExams.some((exam) => exam.entity.entity_id === selectedId)
    ? selectedId
    : data.primaryExam?.entity.entity_id ?? data.visibleExams[0]?.entity.entity_id ?? null;
  const selectedExam = data.visibleExams.find((exam) => exam.entity.entity_id === effectiveSelectedId) ?? null;
  const primary = context.unlocked ? <button className={styles.primaryButton} data-workbench-primary="true" disabled={!context.spaceId} onClick={() => setSheet("exam")} type="button"><AppIcon name="plus" size={16} /> 创建考试</button> : <button className={styles.primaryButton} data-workbench-primary="true" disabled={!context.workspaceId || !context.deviceId} id="exam-unlock" onClick={() => setSheet("unlock")} ref={unlockButtonRef} type="button"><AppIcon name="unlock" size={16} /> 解锁资料</button>;
  return <main className={styles.root} id="main-content">
    <WorkbenchFrame
      context={<WorkbenchContextBar context={{ permission: { label: context.selectedWorkspace?.role ?? "只读", tone: context.selectedWorkspace?.role === "viewer" ? "warn" : "good" }, space: context.selectedSpace ? { id: context.selectedSpace.id, name: context.selectedSpace.name } : undefined, sync: { label: context.examState === "offline-stale" ? "待同步" : "已同步", tone: context.examState === "offline-stale" ? "warn" : "good" }, vault: { label: context.unlocked ? "已解锁" : "已锁定", tone: context.unlocked ? "good" : "warn" }, workspace: context.selectedWorkspace ? { id: context.selectedWorkspace.id, name: context.selectedWorkspace.name } : undefined }} />}
      header={<WorkbenchHeader actions={primary} description="Exam · 以最近考试为中心安排科目覆盖、大纲推进和模考反馈；所有对象在当前 Space 内完成。" eyebrow="EXAM · PREPARATION WORKBENCH" title="围绕最近考试推进覆盖与模考" />}
      initialPane="master"
      inspector={<ExamInspector context={context} data={data} selectedExam={selectedExam} />}
      inspectorLabel="考试 Inspector"
      label="Exam 备考覆盖工作台"
      main={<><StatusLine>{context.status}</StatusLine><StateNotice action={context.examState === "locked" ? <button className={styles.secondaryButton} onClick={() => setSheet("unlock")} type="button">解锁本地资料</button> : context.examState === "empty" ? <button className={styles.secondaryButton} onClick={() => setSheet("exam")} type="button">建立第一场考试</button> : undefined} emptyDescription="当前 Space 尚无考试、科目或模考记录；先创建考试再逐步配置大纲。" emptyTitle="当前 Space 还没有备考项目" onRetry={() => void actions.loadContext()} state={context.examState} /><CoverageMain actions={actions} data={data} onOpenSheet={(next) => setSheet(next)} selectedExam={selectedExam} /></>}
      mainLabel="覆盖工作面"
      master={<ExamMaster context={context} data={data} onCreate={() => setSheet("exam")} onSelect={setSelectedId} selectedId={effectiveSelectedId} />}
      masterLabel="考试列表"
      toolbar={<ContextToolbar actions={actions} context={context} />}
    />
    {sheet === "unlock" ? <UnlockSheet actions={actions} context={context} onOpenChange={(open) => setSheet(open ? "unlock" : null)} open restoreFocusRef={unlockButtonRef} /> : null}
    {sheet && sheet !== "unlock" ? <FormSheet actions={actions} context={context} data={data} kind={sheet} onOpenChange={(open) => setSheet(open ? sheet : null)} open selectedExamId={selectedExam?.entity.entity_id} /> : null}
  </main>;
}
