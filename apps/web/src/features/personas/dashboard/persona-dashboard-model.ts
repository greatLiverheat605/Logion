import { type BuiltinPersonaId } from "../persona-definitions";

export type DashboardTone = "default" | "good" | "info" | "warn";

export interface PersonaDashboardSpace {
  id: string;
  visibility: "private" | "shared";
}

export interface PersonaDashboardMember {
  id: string;
  status: string;
}

export interface PersonaDashboardTask {
  dueAt: string | null;
  estimatedMinutes: number;
  plannedAt: string | null;
  spaceId: string;
  status: string;
  title: string;
}

export interface PersonaDashboardSession {
  manualMinutes: number | null;
  spaceId: string;
  startedAt: string;
  status: string;
}

export interface PersonaDashboardRecord {
  createdAt: string;
  entityType: string;
  id: string;
  payload: Readonly<Record<string, unknown>>;
  spaceId: string;
  syncStatus: "clean" | "conflict" | "pending";
  updatedAt: string;
}

export interface PersonaDashboardSource {
  members: readonly PersonaDashboardMember[];
  membersAvailable: boolean;
  now: Date;
  records: readonly PersonaDashboardRecord[];
  selectedSpaceId: string;
  sessions: readonly PersonaDashboardSession[];
  spaces: readonly PersonaDashboardSpace[];
  tasks: readonly PersonaDashboardTask[];
}

export interface PersonaDashboardMetric {
  detail: string;
  label: string;
  source: string;
  tone?: DashboardTone;
  value: number | string;
}

export interface PersonaDashboardAction {
  description: string;
  href: string;
  label: string;
  title: string;
}

export interface PersonaDashboardStep {
  complete: boolean;
  href: string;
  label: string;
}

export interface PersonaDashboardModel {
  description: string;
  empty: boolean;
  eyebrow: string;
  metrics: readonly PersonaDashboardMetric[];
  primaryAction: PersonaDashboardAction;
  steps: readonly PersonaDashboardStep[];
  title: string;
}

function recordsOf(
  source: PersonaDashboardSource,
  entityType: string,
  allowedSpaceIds: ReadonlySet<string>,
): PersonaDashboardRecord[] {
  return source.records.filter(
    (record) =>
      record.entityType === entityType && allowedSpaceIds.has(record.spaceId),
  );
}

function selectedSpaceIds(source: PersonaDashboardSource): ReadonlySet<string> {
  return new Set(source.selectedSpaceId ? [source.selectedSpaceId] : []);
}

function sharedSpaceIds(source: PersonaDashboardSource): ReadonlySet<string> {
  return new Set(
    source.spaces
      .filter((space) => space.visibility === "shared")
      .map((space) => space.id),
  );
}

function isSameCalendarDay(left: string, right: Date): boolean {
  const date = new Date(left);
  return (
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === right.getFullYear() &&
    date.getMonth() === right.getMonth() &&
    date.getDate() === right.getDate()
  );
}

function daysUntil(value: unknown, now: Date): string {
  if (typeof value !== "string") return "日期待定";
  const target = new Date(value);
  if (!Number.isFinite(target.getTime())) return "日期待定";
  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return `已过 ${Math.abs(days)} 天`;
  if (days === 0) return "今天";
  return `${days} 天`;
}

function buildExamDashboard(
  source: PersonaDashboardSource,
): PersonaDashboardModel {
  const scope = selectedSpaceIds(source);
  const exams = recordsOf(source, "exam", scope);
  const subjects = recordsOf(source, "exam_subject", scope);
  const syllabus = recordsOf(source, "syllabus_node", scope);
  const mocks = recordsOf(source, "mock_exam", scope);
  const scores = recordsOf(source, "score_record", scope);
  const schedules = recordsOf(source, "review_schedule", scope);
  const activeExam = [...exams]
    .filter((exam) => exam.payload.status !== "archived")
    .sort((left, right) => {
      const leftTime = new Date(String(left.payload.exam_at ?? "")).getTime();
      const rightTime = new Date(String(right.payload.exam_at ?? "")).getTime();
      return (
        (Number.isFinite(leftTime) ? leftTime : Infinity) -
        (Number.isFinite(rightTime) ? rightTime : Infinity)
      );
    })[0];
  const dueReviews = schedules.filter((schedule) => {
    if (["due", "in_progress"].includes(String(schedule.payload.status))) {
      return true;
    }
    const next = new Date(String(schedule.payload.next_review_at ?? ""));
    return Number.isFinite(next.getTime()) && next <= source.now;
  }).length;
  const todayMinutes = source.tasks
    .filter(
      (task) =>
        scope.has(task.spaceId) &&
        task.plannedAt !== null &&
        isSameCalendarDay(task.plannedAt, source.now) &&
        !["cancelled", "done", "verified"].includes(task.status),
    )
    .reduce((total, task) => total + task.estimatedMinutes, 0);
  const latestScore = [...scores].sort(
    (left, right) =>
      new Date(
        String(right.payload.completed_at ?? right.updatedAt),
      ).getTime() -
      new Date(String(left.payload.completed_at ?? left.updatedAt)).getTime(),
  )[0];
  const score = Number(latestScore?.payload.score);
  const scoreMaximum = Number(latestScore?.payload.score_scale_max);
  const scoreValue =
    latestScore && Number.isFinite(score) && scoreMaximum > 0
      ? `${score} / ${scoreMaximum}`
      : "暂无记录";
  const primaryAction = !activeExam
    ? {
        title: "先建立考试目标",
        description: "创建真实考试记录后，首页才能计算日期与后续准备顺序。",
        href: "/app/exam#exam-setup",
        label: "创建考试",
      }
    : subjects.length === 0
      ? {
          title: `为“${String(activeExam.payload.title)}”设置科目`,
          description: "科目是大纲、模考和成绩归属的必要上下文。",
          href: "/app/exam#exam-setup",
          label: "设置科目",
        }
      : syllabus.length === 0
        ? {
            title: "补充第一个大纲节点",
            description: "把考试范围拆成可覆盖、可复习的真实知识节点。",
            href: "/app/exam#exam-setup",
            label: "创建大纲节点",
          }
        : {
            title: dueReviews ? "先处理到期复习" : "推进下一项备考任务",
            description: dueReviews
              ? `${dueReviews} 项复习已经到期，不会用预测分数替代真实进度。`
              : mocks.length
                ? "继续执行已安排的备考任务或完成下一次模考。"
                : "大纲已建立，可以安排首场模考形成真实成绩基线。",
            href: dueReviews ? "/app/review" : "/app/exam",
            label: dueReviews
              ? "开始复习"
              : mocks.length
                ? "打开考试"
                : "安排模考",
          };

  return {
    eyebrow: "EXAM COMMAND",
    title: "用真实日期、复习与成绩安排备考",
    description: "只显示已创建考试、今日任务、复习计划和模考记录中的数据。",
    empty: exams.length === 0,
    primaryAction,
    metrics: [
      {
        label: "距目标日期",
        value: daysUntil(activeExam?.payload.exam_at, source.now),
        detail: activeExam ? String(activeExam.payload.title) : "尚未创建考试",
        source: "考试记录 exam.exam_at",
        tone: "info",
      },
      {
        label: "今日计划",
        value: `${todayMinutes}m`,
        detail: "未完成的今日任务预计时长",
        source: "任务 task.planned_at / estimated_minutes",
      },
      {
        label: "到期复习",
        value: dueReviews,
        detail: "已到期或进行中的复习计划",
        source: "复习计划 review_schedule",
        tone: dueReviews ? "warn" : "default",
      },
      {
        label: "最近成绩",
        value: scoreValue,
        detail: latestScore ? "最近一次真实模考" : "尚未录入模考成绩",
        source: "成绩记录 score_record",
        tone: latestScore ? "good" : "default",
      },
    ],
    steps: [
      {
        label: "创建考试",
        href: "/app/exam#exam-setup",
        complete: exams.length > 0,
      },
      {
        label: "设置科目",
        href: "/app/exam#exam-setup",
        complete: subjects.length > 0,
      },
      {
        label: "创建大纲节点",
        href: "/app/exam#exam-setup",
        complete: syllabus.length > 0,
      },
    ],
  };
}

function buildSelfDashboard(
  source: PersonaDashboardSource,
): PersonaDashboardModel {
  const scope = selectedSpaceIds(source);
  const goals = recordsOf(source, "learning_goal", scope);
  const tracks = recordsOf(source, "learning_track", scope);
  const projects = recordsOf(source, "study_project", scope);
  const deliverables = recordsOf(source, "deliverable", scope);
  const mastery = recordsOf(source, "mastery", scope).filter(
    (record) => record.payload.confirmed_level !== null,
  );
  const weekStart = source.now.getTime() - 7 * 86_400_000;
  const weeklyMinutes = source.sessions
    .filter((session) => {
      const startedAt = new Date(session.startedAt).getTime();
      return (
        scope.has(session.spaceId) &&
        session.status === "completed" &&
        Number.isFinite(startedAt) &&
        startedAt >= weekStart &&
        startedAt <= source.now.getTime()
      );
    })
    .reduce((total, session) => total + (session.manualMinutes ?? 0), 0);
  const latestProject = [...projects].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];
  const projectDeliverables = latestProject
    ? deliverables.filter(
        (record) => record.payload.project_id === latestProject.id,
      ).length
    : 0;
  const primaryAction = !goals.length
    ? {
        title: "先创建一个学习目标",
        description: "目标建立后，才能继续形成路线、项目与可验证成果。",
        href: "/app/planning",
        label: "创建目标",
      }
    : !tracks.length
      ? {
          title: "把目标拆成学习路线",
          description: "为现有目标建立长期主题和明确学习方向。",
          href: "/app/self-study",
          label: "创建路线",
        }
      : !projects.length
        ? {
            title: "把学习路线落到项目",
            description: "选择现有路线，定义一个有明确预期成果的学习项目。",
            href: "/app/self-study",
            label: "创建项目",
          }
        : {
            title: `推进“${String(latestProject?.payload.title)}”的下一个里程碑`,
            description: projectDeliverables
              ? `这个项目已有 ${projectDeliverables} 项真实成果，继续推进下一项。`
              : "为当前项目完成并登记第一项可验证成果。",
            href: "/app/self-study",
            label: "打开学习项目",
          };
  return {
    eyebrow: "LEARNING PROJECTS",
    title: "让目标、项目与成果形成连续进展",
    description:
      "首页从专注会话、项目、掌握确认与成果记录中生成，不填充课程或公开产出。",
    empty:
      goals.length + tracks.length + projects.length + deliverables.length ===
      0,
    primaryAction,
    metrics: [
      {
        label: "本周专注",
        value: `${weeklyMinutes}m`,
        detail: "最近 7 天已完成会话",
        source: "学习会话 study_session.manual_minutes",
        tone: "info",
      },
      {
        label: "项目进度",
        value: latestProject ? `${projectDeliverables} 项成果` : "尚无项目",
        detail: latestProject
          ? String(latestProject.payload.title)
          : "先创建学习项目",
        source: "学习项目 study_project / 成果 deliverable",
      },
      {
        label: "掌握确认",
        value: mastery.length,
        detail: "由用户明确确认的知识点",
        source: "掌握记录 mastery.confirmed_level",
        tone: mastery.length ? "good" : "default",
      },
      {
        label: "成果数量",
        value: deliverables.length,
        detail: "当前 Space 的真实成果",
        source: "成果 deliverable",
      },
    ],
    steps: [
      { label: "创建目标", href: "/app/planning", complete: goals.length > 0 },
      {
        label: "创建路线",
        href: "/app/self-study",
        complete: tracks.length > 0,
      },
      {
        label: "创建项目",
        href: "/app/self-study",
        complete: projects.length > 0,
      },
    ],
  };
}

function buildResearchDashboard(
  source: PersonaDashboardSource,
): PersonaDashboardModel {
  const scope = selectedSpaceIds(source);
  const questions = recordsOf(source, "research_question", scope);
  const papers = recordsOf(source, "paper_record", scope);
  const claims = recordsOf(source, "research_claim", scope);
  const runs = recordsOf(source, "experiment_run", scope);
  const feedback = recordsOf(source, "research_feedback", scope);
  const primaryAction = !questions.length
    ? {
        title: "先建立研究问题",
        description:
          "用明确问题约束论文、声明与实验运行，避免复制原型示例课题。",
        href: "/app/research",
        label: "建立研究问题",
      }
    : !papers.length
      ? {
          title: "录入第一篇真实论文",
          description: "登记来源后，再把可核验声明关联到具体论文。",
          href: "/app/research",
          label: "录入论文",
        }
      : !claims.length
        ? {
            title: "从论文提取可核验声明",
            description: "声明必须关联真实论文，并保留支持、反对或中立立场。",
            href: "/app/research",
            label: "创建声明",
          }
        : {
            title: runs.length ? "处理当前研究阻塞项" : "创建第一次研究运行",
            description: feedback.length
              ? `${feedback.length} 条真实反馈可用于决定下一步。`
              : "把研究问题转为一次可记录方法与结果的运行。",
            href: "/app/research",
            label: runs.length ? "打开研究工作台" : "创建运行",
          };
  return {
    eyebrow: "RESEARCH MISSION CONTROL",
    title: "把问题、论文、声明与运行放在同一证据链",
    description:
      "每个计数都来自当前 Space 的真实研究实体，不预设课题、论文或指标。",
    empty: questions.length + papers.length + claims.length + runs.length === 0,
    primaryAction,
    metrics: [
      {
        label: "论文",
        value: papers.length,
        detail: "已登记资料",
        source: "论文 paper_record",
      },
      {
        label: "声明证据",
        value: claims.length,
        detail: "关联到论文的声明",
        source: "研究声明 research_claim",
        tone: "info",
      },
      {
        label: "研究运行",
        value: runs.length,
        detail: "已记录方法与结果",
        source: "实验运行 experiment_run",
        tone: runs.length ? "good" : "default",
      },
      {
        label: "反馈请求",
        value: feedback.length,
        detail: "需要纳入下一步判断",
        source: "研究反馈 research_feedback",
        tone: feedback.length ? "warn" : "default",
      },
    ],
    steps: [
      {
        label: "建立研究问题",
        href: "/app/research",
        complete: questions.length > 0,
      },
      { label: "录入论文", href: "/app/research", complete: papers.length > 0 },
      {
        label: "创建运行或声明",
        href: "/app/research",
        complete: claims.length + runs.length > 0,
      },
    ],
  };
}

function buildMentorDashboard(
  source: PersonaDashboardSource,
): PersonaDashboardModel {
  const sharedScope = sharedSpaceIds(source);
  const rubrics = recordsOf(source, "rubric", sharedScope);
  const reviews = recordsOf(source, "group_review", sharedScope);
  const feedback = recordsOf(source, "group_feedback", sharedScope);
  const findings = recordsOf(source, "review_finding", sharedScope).filter(
    (record) => record.payload.status === "open",
  );
  const reviewedIds = new Set(
    feedback.map((record) => record.payload.review_id),
  );
  const pendingReviews = reviews.filter(
    (review) => !reviewedIds.has(review.id),
  );
  const activeMembers = source.members.filter(
    (member) => member.status === "active",
  ).length;
  const primaryAction =
    sharedScope.size === 0
      ? {
          title: "先创建共享 Space",
          description:
            "导师聚合只读取共享 Space，私人 Space 不会进入任何小组指标。",
          href: "/app/spaces",
          label: "创建共享 Space",
        }
      : source.membersAvailable && activeMembers <= 1
        ? {
            title: "邀请成员进入工作区",
            description:
              "成员身份由 Workspace 权限决定，与当前导师画像完全独立。",
            href: "/app/workspaces",
            label: "邀请成员",
          }
        : !rubrics.length
          ? {
              title: "建立第一份审阅 Rubric",
              description:
                "用共享空间中的明确标准发起审阅，不读取成员私人内容。",
              href: "/app/collaboration",
              label: "创建 Rubric",
            }
          : {
              title: pendingReviews.length
                ? "处理待审对象"
                : "检查小组阻塞与审计发现",
              description: pendingReviews.length
                ? `${pendingReviews.length} 项共享审阅尚未留下反馈。`
                : findings.length
                  ? `${findings.length} 项共享审查发现仍待处理。`
                  : "授权范围内当前没有待审对象。",
              href: pendingReviews.length ? "/app/collaboration" : "/app/audit",
              label: pendingReviews.length ? "进入协作审阅" : "查看审计",
            };
  return {
    eyebrow: "MENTOR & GROUP COMMAND",
    title: "只在授权共享范围内组织协作与审阅",
    description:
      "所有小组聚合先按 shared Space 过滤；画像不会授予 Workspace 权限。",
    empty: sharedScope.size === 0,
    primaryAction,
    metrics: [
      {
        label: "共享 Space",
        value: sharedScope.size,
        detail: "已排除所有私人 Space",
        source: "Space.visibility = shared",
        tone: "info",
      },
      {
        label: "成员",
        value: source.membersAvailable ? activeMembers : "需管理权限",
        detail: source.membersAvailable
          ? "当前工作区有效成员"
          : "当前 Workspace 角色不可读取成员列表",
        source: "Workspace members API（后端权限校验）",
      },
      {
        label: "待审",
        value: pendingReviews.length,
        detail: "尚无反馈的共享审阅",
        source: "group_review / group_feedback",
        tone: pendingReviews.length ? "warn" : "default",
      },
      {
        label: "审查发现",
        value: findings.length,
        detail: "共享 Space 中未解决项",
        source: "review_finding.status = open",
        tone: findings.length ? "warn" : "good",
      },
    ],
    steps: [
      {
        label: "创建共享 Space",
        href: "/app/spaces",
        complete: sharedScope.size > 0,
      },
      {
        label: "邀请成员",
        href: "/app/workspaces",
        complete: source.membersAvailable && activeMembers > 1,
      },
      {
        label: "创建审阅 Rubric",
        href: "/app/collaboration",
        complete: rubrics.length > 0,
      },
    ],
  };
}

export function buildPersonaDashboard(
  personaId: BuiltinPersonaId,
  source: PersonaDashboardSource,
): PersonaDashboardModel {
  if (personaId === "exam") return buildExamDashboard(source);
  if (personaId === "research") return buildResearchDashboard(source);
  if (personaId === "mentor") return buildMentorDashboard(source);
  return buildSelfDashboard(source);
}
