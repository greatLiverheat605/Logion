"use client";

import { useId, useRef, useState, type RefObject } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchDropdownMenu,
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import {
  ProductOperationalStateNotice,
  ProductWorkbenchStateNotice as StateNotice,
} from "@/components/product/product-workbench-state";
import { ProductTag } from "@/components/product/product-ui";

import { TEMPLATE_SCOPE_VALUES } from "./use-templates-controller";
import type {
  TemplatesControllerActions,
  TemplatesControllerContext,
  TemplatesControllerResult,
  TemplateScope,
} from "./use-templates-controller";

import styles from "./templates-workbench.module.css";

type Template = NonNullable<TemplatesControllerContext["selectedTemplate"]>;
type Share = TemplatesControllerContext["shares"][number];

export type TemplatesWorkbenchProps = TemplatesControllerResult;

type SheetName = "create" | "import" | "install" | "revoke" | "share" | null;

function templateHasRelativeDate(template: Template) {
  const plan = template.object_graph.goal_plan;
  return (
    typeof plan === "object" &&
    plan !== null &&
    typeof (plan as { target_day_offset?: unknown }).target_day_offset ===
      "number"
  );
}

function templateGraph(template: Template) {
  const plan = template.object_graph.goal_plan;
  if (!plan || typeof plan !== "object") return { phases: 0, tasks: 0 };
  const phases: unknown[] = Array.isArray((plan as { phases?: unknown }).phases)
    ? ((plan as { phases: unknown[] }).phases ?? [])
    : [];
  const tasks = phases.reduce<number>((total, phase) => {
    if (!phase || typeof phase !== "object") return total;
    const phaseTasks = (phase as { tasks?: unknown }).tasks;
    return total + (Array.isArray(phaseTasks) ? phaseTasks.length : 0);
  }, 0);
  return { phases: phases.length, tasks };
}

function externalLinks(template: Template) {
  const links = template.risk_metadata.external_links;
  return Array.isArray(links) ? links.map((link) => String(link)) : [];
}

function StatusLine({ children }: { children: string }) {
  return (
    <p aria-live="polite" className={styles.statusLine} role="status">
      <span aria-hidden="true" />
      {children}
    </p>
  );
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
        <AppIcon name="layout-template" size={18} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ContextToolbar({
  actions,
  context,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
}) {
  return (
    <WorkbenchToolbar label="模板工作台上下文与筛选操作">
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
        label="选择安装 Space"
        onValueChange={actions.setSpaceId}
        options={context.visibleSpaces.map((space) => ({
          label: `${space.name} · ${space.visibility === "private" ? "私有" : "共享"}`,
          value: space.id,
        }))}
        placeholder="安装 Space"
        value={context.spaceId || undefined}
      />
      <label className={styles.searchField} htmlFor="templates-search">
        <AppIcon name="search" size={15} />
        <input
          aria-label="搜索模板"
          id="templates-search"
          placeholder="搜索模板、作者或适用场景"
          type="search"
          value={context.templateQuery}
          onChange={(event) => actions.setTemplateQuery(event.target.value)}
        />
      </label>
      <div aria-label="模板可见性" className={styles.segmented} role="group">
        {TEMPLATE_SCOPE_VALUES.map((value) => {
          const label = {
            all: "全部",
            official: "官方",
            private: "仅自己",
            workspace: "工作区",
          }[value];
          return (
            <button
              aria-pressed={context.templateScope === value}
              className={
                context.templateScope === value
                  ? styles.activeSegment
                  : undefined
              }
              key={value}
              onClick={() => actions.setTemplateScope(value)}
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className={styles.toolbarSpacer} />
      <WorkbenchTooltip content="重新读取模板、目标和分享目录">
        <button
          aria-label="刷新模板目录"
          className={styles.iconButton}
          onClick={() => void actions.synchronize()}
          type="button"
        >
          <AppIcon name="refresh" size={15} />
        </button>
      </WorkbenchTooltip>
    </WorkbenchToolbar>
  );
}

function CategoryMaster({
  actions,
  context,
  onSelect,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onSelect: (id: string) => void;
}) {
  const categories: Array<{
    label: string;
    value: TemplateScope;
    count: number;
  }> = [
    { label: "全部模板", value: "all", count: context.templates.length },
    {
      label: "官方模板",
      value: "official",
      count: context.templates.filter(
        (template) => template.visibility === "official",
      ).length,
    },
    {
      label: "仅自己的模板",
      value: "private",
      count: context.templates.filter(
        (template) => template.visibility === "private",
      ).length,
    },
    {
      label: "工作区模板",
      value: "workspace",
      count: context.templates.filter(
        (template) => template.visibility === "workspace",
      ).length,
    },
  ];
  return (
    <div className={styles.master} data-testid="templates-category-master">
      <header className={styles.paneHeader}>
        <div>
          <p className={styles.eyebrow}>TEMPLATE CATEGORIES</p>
          <h2>模板分类</h2>
        </div>
        <span className={styles.count}>{context.visibleTemplates.length}</span>
      </header>
      <nav
        aria-label="模板分类"
        className={styles.categoryList}
        data-testid="templates-categories"
      >
        {categories.map((category) => (
          <button
            aria-current={
              context.templateScope === category.value ? "true" : undefined
            }
            className={
              context.templateScope === category.value
                ? styles.categoryActive
                : styles.categoryRow
            }
            key={category.value}
            onClick={() => actions.setTemplateScope(category.value)}
            type="button"
          >
            <span>{category.label}</span>
            <span>{category.count}</span>
          </button>
        ))}
      </nav>
      <div className={styles.masterDivider} />
      <header className={styles.listHeader}>
        <div>
          <p className={styles.eyebrow}>TEMPLATE LIST</p>
          <h3>版本列表</h3>
        </div>
        <span className={styles.listMeta}>
          {context.visibleTemplates.length} 个结果
        </span>
      </header>
      <div
        aria-label="模板版本"
        className={styles.templateList}
        data-testid="templates-list"
      >
        {context.visibleTemplates.map((template) => {
          const selected = context.selectedTemplate?.id === template.id;
          return (
            <button
              aria-current={selected ? "true" : undefined}
              className={
                selected ? styles.templateRowSelected : styles.templateRow
              }
              key={template.id}
              onClick={() => onSelect(template.id)}
              type="button"
            >
              <span className={styles.templateIcon} aria-hidden="true">
                <AppIcon name="layout-template" size={15} />
              </span>
              <span className={styles.templateCopy}>
                <strong>{template.name}</strong>
                <small>{template.description || "未填写说明"}</small>
                <span>
                  {template.visibility === "official"
                    ? "Logion 官方"
                    : template.author_name}{" "}
                  · v{template.version_number}
                </span>
              </span>
              <span className={styles.rowTags}>
                {template.visibility === "official" ? (
                  <ProductTag tone="default">官方</ProductTag>
                ) : null}
                <ProductTag
                  tone={template.status === "active" ? "good" : "warn"}
                >
                  {template.status === "active" ? "可用" : "撤回"}
                </ProductTag>
              </span>
            </button>
          );
        })}
        {context.visibleTemplates.length === 0 ? (
          <EmptyPane
            description={
              context.templates.length
                ? "清除搜索词或切换分类后再试。"
                : "从现有目标创建模板，或导入经过检查的结构化模板包。"
            }
            title={context.templates.length ? "没有匹配模板" : "模板库为空"}
          />
        ) : null}
      </div>
      <footer className={styles.masterFooter}>
        <span>{context.visibleGoals.length} 个可用来源目标</span>
        <span>
          {
            context.visibleShares.filter((share) => share.status === "active")
              .length
          }{" "}
          个有效分享
        </span>
      </footer>
    </div>
  );
}

function TemplateDetail({
  actions,
  context,
  onOpenInstall,
  onOpenShare,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenInstall: () => void;
  onOpenShare: () => void;
}) {
  const template = context.selectedTemplate;
  if (!template) {
    return (
      <div className={styles.main} data-testid="templates-detail-main">
        <EmptyPane
          description="从左侧选择一个模板版本；这里会展示来源、差异和安装条件。"
          title="安装预览"
        />
      </div>
    );
  }
  const graph = templateGraph(template);
  const relativeDate = template ? templateHasRelativeDate(template) : false;
  const links = externalLinks(template);
  return (
    <div className={styles.main} data-testid="templates-detail-main">
      <header className={styles.detailHeader}>
        <div className={styles.detailTitle}>
          <span className={styles.detailIcon} aria-hidden="true">
            <AppIcon name="layout-template" size={21} />
          </span>
          <div>
            <p className={styles.eyebrow}>
              TEMPLATE DETAIL · VERSION {template.version_number}
            </p>
            <h2>{template.name}</h2>
            <p>{template.description || "未填写模板说明。"}</p>
          </div>
        </div>
        <ProductTag tone={template.status === "active" ? "good" : "warn"}>
          {template.status === "active" ? "可安装" : "已撤回"}
        </ProductTag>
      </header>
      <StatusLine>{context.status}</StatusLine>
      <section
        className={styles.sourceDetails}
        aria-label="模板来源与风险"
        data-testid="templates-source-details"
      >
        <div>
          <span>来源</span>
          <strong>
            {template.visibility === "official"
              ? "Logion 官方目录"
              : template.author_name}
          </strong>
        </div>
        <div>
          <span>版本</span>
          <strong>v{template.version_number}</strong>
        </div>
        <div>
          <span>许可</span>
          <strong>{template.license}</strong>
        </div>
        <div>
          <span>风险</span>
          <strong>
            {externalLinks(template).length
              ? externalLinks(template).length + " 个外部链接"
              : "无外部链接"}
          </strong>
        </div>
      </section>
      <section
        className={styles.detailSection}
        aria-labelledby="template-structure-title"
        data-testid="templates-preview"
      >
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>INSTALL DIFF</p>
            <h3 id="template-structure-title">安装预览</h3>
          </div>
          <span className={styles.sectionMeta}>
            {graph.phases} 个阶段 · {graph.tasks} 个任务
          </span>
        </header>
        <div className={styles.diffGrid}>
          <div>
            <strong>会创建</strong>
            <span>新的目标、阶段和任务 ID</span>
          </div>
          <div>
            <strong>不会复制</strong>
            <span>原计划的学习记录和个人身份数据</span>
          </div>
          <div>
            <strong>日期策略</strong>
            <span>{relativeDate ? "安装时需要起始日期" : "不含相对日期"}</span>
          </div>
          <div>
            <strong>当前目标 Space</strong>
            <span>{context.selectedSpace?.name ?? "尚未选择"}</span>
          </div>
        </div>
      </section>
      <section
        className={styles.detailSection}
        aria-labelledby="template-changelog-title"
      >
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>VERSION HISTORY</p>
            <h3 id="template-changelog-title">版本变更</h3>
          </div>
          <span className={styles.sectionMeta}>v{template.version_number}</span>
        </header>
        <p className={styles.longCopy}>
          {template.changelog || "此版本没有附加变更说明。"}
        </p>
      </section>
      <div className={styles.detailActions}>
        <button
          className={styles.primaryButton}
          disabled={
            template.status !== "active" || !context.capabilities.canInstall
          }
          onClick={onOpenInstall}
          type="button"
        >
          <AppIcon name="download" size={15} />
          安装为独立副本
        </button>
        {template.visibility === "official" ? (
          <p className={styles.readOnlyNote} role="note">
            官方模板不可编辑、分享或撤销；安装会复制为当前 Space 的独立副本。
          </p>
        ) : (
          <button
            className={styles.secondaryButton}
            disabled={
              !context.visibleGoals.length || !context.capabilities.canShare
            }
            onClick={onOpenShare}
            type="button"
          >
            <AppIcon name="share" size={15} />
            分享当前路线
          </button>
        )}
      </div>
      {links.length ? (
        <section className={styles.sourceStrip} aria-label="模板外部链接">
          <strong>{links.length} 个外部链接</strong>
          <span>安装前请在检查器中确认来源风险。</span>
        </section>
      ) : null}
      <button
        className={styles.subtleLink}
        onClick={() => actions.setTemplateScope("all")}
        type="button"
      >
        查看全部版本
      </button>
    </div>
  );
}

function TemplateInspector({
  actions,
  context,
  onOpenCreate,
  onOpenImport,
  onOpenRevoke,
  onOpenShare,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenCreate: () => void;
  onOpenImport: () => void;
  onOpenRevoke: (share: Share) => void;
  onOpenShare: () => void;
}) {
  const template = context.selectedTemplate;
  const links = template ? externalLinks(template) : [];
  return (
    <div className={styles.inspector} data-testid="templates-inspector">
      <InspectorSection title="模板风险与来源">
        {template ? (
          <dl className={styles.metaList}>
            <div>
              <dt>作者</dt>
              <dd>{template.author_name}</dd>
            </div>
            <div>
              <dt>许可</dt>
              <dd>{template.license}</dd>
            </div>
            <div>
              <dt>语言</dt>
              <dd>{template.locale}</dd>
            </div>
            <div>
              <dt>内容 Hash</dt>
              <dd className={styles.hash}>{template.content_hash}</dd>
            </div>
            <div>
              <dt>外部链接</dt>
              <dd>{links.length ? `${links.length} 个，需人工检查` : "无"}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.muted}>选择模板后显示来源、许可和风险。</p>
        )}
      </InspectorSection>
      <InspectorSection title="安装目标">
        <div className={styles.scopeBlock}>
          <span>Workspace</span>
          <strong>{context.selectedWorkspace?.name ?? "尚未选择"}</strong>
          <span>Space</span>
          <strong>{context.selectedSpace?.name ?? "尚未选择"}</strong>
        </div>
        <p className={styles.muted}>
          安装只会写入当前 Space，并为所有对象生成独立 ID。
        </p>
      </InspectorSection>
      <InspectorSection title="当前权限">
        <p className={styles.muted}>
          {context.capabilities.canWrite
            ? "当前角色可创建模板、安装独立副本并管理只读分享。"
            : `当前角色（${context.selectedWorkspace?.role ?? "只读"}）仅可浏览；需要 Workspace 写权限才能执行模板写入操作。`}
        </p>
        <p className={styles.policyNote}>
          Logion 官方模板不可编辑、分享或撤销；仅可安装独立副本。
        </p>
      </InspectorSection>
      <InspectorSection title="已安装副本">
        <div
          className={styles.installSummary}
          data-testid="templates-installed"
        >
          <strong>{context.visibleGoals.length}</strong>
          <span>个当前 Space 目标</span>
        </div>
        <p className={styles.muted}>
          安装成功后，新目标会在规划工作台中继续编辑。
        </p>
      </InspectorSection>
      <InspectorSection title="低频操作">
        <div className={styles.inspectorActions}>
          <button
            className={styles.inspectorAction}
            data-template-sheet="create"
            disabled={!context.capabilities.canCreate}
            onClick={onOpenCreate}
            type="button"
          >
            <AppIcon name="plus" size={14} /> 创建模板版本
          </button>
          <button
            className={styles.inspectorAction}
            data-template-sheet="import"
            disabled={!context.capabilities.canImport}
            onClick={onOpenImport}
            type="button"
          >
            <AppIcon name="upload" size={14} /> 导入模板包
          </button>
          <button
            className={styles.inspectorAction}
            data-template-sheet="share"
            disabled={
              !context.visibleGoals.length || !context.capabilities.canShare
            }
            onClick={onOpenShare}
            type="button"
          >
            <AppIcon name="share" size={14} /> 创建只读分享
          </button>
        </div>
      </InspectorSection>
      <InspectorSection title="只读分享">
        {context.newShareToken ? (
          <p className={styles.tokenNotice} role="status">
            新链接只显示一次：
            <a href={`/shares/${context.newShareToken}`} rel="noreferrer">
              打开只读分享
            </a>
          </p>
        ) : null}
        {context.visibleShares.length ? (
          <ul className={styles.shareList}>
            {context.visibleShares.map((share) => (
              <li key={share.id}>
                <span>
                  <strong>{share.title}</strong>
                  <small>
                    {share.status} ·{" "}
                    {new Date(share.expires_at).toLocaleDateString("zh-CN")}
                  </small>
                </span>
                {share.status === "active" ? (
                  <button onClick={() => onOpenRevoke(share)} type="button">
                    撤销
                  </button>
                ) : (
                  <ProductTag tone="default">已失效</ProductTag>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>当前 Space 还没有只读分享。</p>
        )}
      </InspectorSection>
      <button
        className={styles.refreshLink}
        onClick={() => void actions.synchronize()}
        type="button"
      >
        刷新目录
      </button>
    </div>
  );
}

function InstallSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const template = context.selectedTemplate;
  const formId = useId();
  const relativeDate = template ? templateHasRelativeDate(template) : false;
  const [startDate, setStartDate] = useState(
    template ? (context.installStartDates[template.id] ?? "") : "",
  );
  if (!template) return null;
  return (
    <WorkbenchSheet
      description="安装会创建新的目标、阶段和任务 ID，不会覆盖当前内容。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            form={formId}
            type="submit"
            disabled={
              !context.capabilities.canInstall || template.status !== "active"
            }
          >
            确认安装
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="安装独立模板副本"
    >
      <form
        id={formId}
        className={styles.sheetForm}
        onSubmit={async (event) => {
          event.preventDefault();
          actions.setInstallStartDate(template.id, startDate);
          const ok = await actions.installTemplate(template, startDate);
          if (ok) onOpenChange(false);
        }}
      >
        <div className={styles.sheetSummary}>
          <span>模板</span>
          <strong>
            {template.name} · v{template.version_number}
          </strong>
          <span>目标 Space</span>
          <strong>{context.selectedSpace?.name ?? "尚未选择"}</strong>
          <span>安装范围</span>
          <strong>
            {templateGraph(template).phases} 个阶段 ·{" "}
            {templateGraph(template).tasks} 个任务
          </strong>
          <span>写入策略</span>
          <strong>创建独立对象，不会覆盖现有内容</strong>
        </div>
        {relativeDate ? (
          <label htmlFor={`${formId}-date`}>
            安装起始日期
            <input
              autoFocus
              id={`${formId}-date`}
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
        ) : (
          <p className={styles.formHint}>
            此模板不包含相对日期，安装后可直接调整目标日期。
          </p>
        )}
        <fieldset className={styles.impactFieldset}>
          <legend>影响范围</legend>
          <p>
            只创建独立副本，不修改原模板或已有目标；失败时保留当前页面和输入。
          </p>
        </fieldset>
        <p className={styles.recoveryNote}>
          恢复路径：删除新建目标前，请先在规划工作台核对对象列表。
        </p>
        <StatusLine>{context.status}</StatusLine>
      </form>
    </WorkbenchSheet>
  );
}

function CreateSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="从当前 Space 的目标创建一个新的不可变模板版本。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            form={formId}
            type="submit"
            disabled={
              !context.capabilities.canCreate || !context.visibleGoals.length
            }
          >
            创建版本
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="创建模板版本"
    >
      <form
        id={formId}
        className={styles.sheetForm}
        onSubmit={async (event) => {
          const ok = await actions.createTemplate(event);
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-goal`}>
          来源目标
          <select id={`${formId}-goal`} name="source_goal_id" required>
            {context.visibleGoals.map((goal) => (
              <option key={goal.goal_id} value={goal.goal_id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${formId}-name`}>
          模板名称
          <input
            autoFocus
            id={`${formId}-name`}
            name="name"
            maxLength={160}
            required
          />
        </label>
        <label htmlFor={`${formId}-description`}>
          说明
          <textarea
            id={`${formId}-description`}
            name="description"
            maxLength={1000}
            rows={3}
          />
        </label>
        <div className={styles.twoColumn}>
          <label htmlFor={`${formId}-author`}>
            作者显示名
            <input id={`${formId}-author`} name="author_name" required />
          </label>
          <label htmlFor={`${formId}-license`}>
            许可证
            <input
              id={`${formId}-license`}
              name="license"
              placeholder="CC-BY-4.0"
              required
            />
          </label>
        </div>
        <div className={styles.twoColumn}>
          <label htmlFor={`${formId}-locale`}>
            语言
            <input
              defaultValue="zh-CN"
              id={`${formId}-locale`}
              name="locale"
              required
            />
          </label>
          <label htmlFor={`${formId}-personas`}>
            适用人群
            <input
              id={`${formId}-personas`}
              name="target_personas"
              placeholder="self-study,research"
              required
            />
          </label>
        </div>
        <label htmlFor={`${formId}-changelog`}>
          变更说明
          <textarea id={`${formId}-changelog`} name="changelog" rows={2} />
        </label>
        <label htmlFor={`${formId}-visibility`}>
          可见性
          <select
            defaultValue="private"
            id={`${formId}-visibility`}
            name="visibility"
          >
            <option value="private">仅自己</option>
            <option value="workspace">工作区成员</option>
          </select>
        </label>
        <StatusLine>{context.status}</StatusLine>
      </form>
    </WorkbenchSheet>
  );
}

function ImportSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="导入前校验结构、来源 Hash、许可和外部链接；导入只加入私有模板库。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            form={formId}
            type="submit"
            disabled={!context.capabilities.canImport}
          >
            校验并导入
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="导入模板包"
    >
      <form
        id={formId}
        className={styles.sheetForm}
        onSubmit={async (event) => {
          const ok = await actions.importTemplate(event);
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-file`}>
          结构化模板包（JSON，最大 1 MB）
          <input
            autoFocus
            id={`${formId}-file`}
            name="template_file"
            type="file"
            accept="application/json,.json"
            required
          />
        </label>
        <p className={styles.formHint}>
          示例包位于 <code>examples/templates</code>；不会创建学习记录。
        </p>
        <fieldset className={styles.impactFieldset}>
          <legend>导入边界</legend>
          <p>
            导入包默认是私有版本；检查来源、许可证和外部链接后，仍需单独安装。
          </p>
        </fieldset>
        <StatusLine>{context.status}</StatusLine>
      </form>
    </WorkbenchSheet>
  );
}

function ShareSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const formId = useId();
  const fields = [
    "title",
    "description",
    "desired_outcome",
    "status",
    "weekly_minutes",
    "target_date",
    "phases",
  ];
  return (
    <WorkbenchSheet
      description="只读分享只公开你勾选的字段，并在有效期后自动失效。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            form={formId}
            type="submit"
            disabled={
              !context.capabilities.canShare || !context.visibleGoals.length
            }
          >
            创建只读链接
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="创建只读分享"
    >
      <form
        id={formId}
        className={styles.sheetForm}
        onSubmit={async (event) => {
          const ok = await actions.createShare(event);
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-goal`}>
          来源目标
          <select id={`${formId}-goal`} name="source_goal_id" required>
            {context.visibleGoals.map((goal) => (
              <option key={goal.goal_id} value={goal.goal_id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${formId}-title`}>
          分享标题
          <input
            autoFocus
            id={`${formId}-title`}
            name="title"
            maxLength={160}
            required
          />
        </label>
        <fieldset className={styles.checkboxFieldset}>
          <legend>公开字段</legend>
          <div className={styles.checkboxGrid}>
            {fields.map((field, index) => (
              <label key={field}>
                <input
                  defaultChecked={index < 2}
                  name="fields"
                  type="checkbox"
                  value={field}
                />
                {field}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={`${formId}-expires`}>
          有效天数
          <input
            defaultValue={30}
            id={`${formId}-expires`}
            max={365}
            min={1}
            name="expires_in_days"
            required
            type="number"
          />
        </label>
        <p className={styles.recoveryNote}>
          恢复路径：创建后可在检查器中立即撤销；Token 只显示一次。
        </p>
        <StatusLine>{context.status}</StatusLine>
      </form>
    </WorkbenchSheet>
  );
}

function RevokeSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
  share,
}: {
  actions: TemplatesControllerActions;
  context: TemplatesControllerContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLElement | null>;
  share: Share | null;
}) {
  if (!share) return null;
  return (
    <WorkbenchSheet
      description="撤销后原链接立即失效，已被查看的只读内容不会被删除。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            保留链接
          </button>
          <button
            className={styles.dangerButton}
            disabled={
              !context.capabilities.canWrite ||
              !context.online ||
              !context.workspaceId
            }
            onClick={async () => {
              const ok = await actions.revokeShare(share);
              if (ok) onOpenChange(false);
            }}
            type="button"
          >
            确认撤销
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="撤销只读分享"
    >
      <div className={styles.dangerSummary}>
        <strong>{share.title}</strong>
        <p>
          影响范围：当前 Workspace 的这条分享链接；权限：需要当前 Workspace
          写权限。
        </p>
        <p>恢复路径：撤销不可逆；如需继续分享，请创建一条新的短期链接。</p>
      </div>
      <StatusLine>{context.status}</StatusLine>
    </WorkbenchSheet>
  );
}

export function TemplatesWorkbench({
  actions,
  context,
}: TemplatesWorkbenchProps) {
  const [sheet, setSheet] = useState<SheetName>(null);
  const [revokeTarget, setRevokeTarget] = useState<Share | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const openSheet = (name: Exclude<SheetName, null>) => setSheet(name);
  const closeSheet = (open: boolean) => {
    if (!open) setSheet(null);
  };
  const stateAction = context.recentAuthRequired ? (
    <a className={styles.noticeAction} href="/auth/login?next=/app/templates">
      重新认证
    </a>
  ) : context.templateState === "error" ? (
    <button
      className={styles.noticeAction}
      onClick={() => void actions.loadContext()}
      type="button"
    >
      重试读取
    </button>
  ) : context.templateState === "needs-context" ? (
    <a className={styles.noticeAction} href="#templates-context">
      选择 Workspace / Space
    </a>
  ) : (
    <button
      className={styles.noticeAction}
      onClick={() => void actions.synchronize()}
      type="button"
    >
      刷新模板目录
    </button>
  );
  const primaryLabel = context.selectedTemplate ? "安装独立副本" : "创建模板";
  const primaryAction = context.selectedTemplate
    ? () => openSheet("install")
    : () => openSheet("create");
  const header = (
    <WorkbenchHeader
      actions={
        <div className={styles.headerActions}>
          <button
            ref={actionRef}
            className={styles.primaryButton}
            data-workbench-primary="true"
            disabled={
              context.selectedTemplate?.status === "withdrawn" ||
              (!context.selectedTemplate &&
                (!context.visibleGoals.length ||
                  !context.capabilities.canCreate)) ||
              (Boolean(context.selectedTemplate) &&
                !context.capabilities.canInstall)
            }
            onClick={primaryAction}
            type="button"
          >
            <AppIcon
              name={context.selectedTemplate ? "download" : "plus"}
              size={15}
            />
            {primaryLabel}
          </button>
          <button
            className={styles.headerButton}
            data-template-sheet="create"
            disabled={!context.capabilities.canCreate}
            onClick={() => openSheet("create")}
            type="button"
          >
            创建模板
          </button>
          <WorkbenchDropdownMenu
            label="模板工具"
            items={[
              {
                id: "import",
                label: "导入模板包",
                icon: <AppIcon name="upload" size={14} />,
                disabled: !context.capabilities.canImport,
                onSelect: () => openSheet("import"),
              },
              {
                id: "share",
                label: "创建只读分享",
                icon: <AppIcon name="share" size={14} />,
                disabled:
                  !context.visibleGoals.length ||
                  !context.capabilities.canShare,
                onSelect: () => openSheet("share"),
              },
            ]}
            trigger={
              <button
                aria-label="更多模板操作"
                className={styles.iconButton}
                type="button"
              >
                <AppIcon name="more-horizontal" size={16} />
              </button>
            }
          />
        </div>
      }
      eyebrow="TEMPLATES · VERSIONED KNOWLEDGE"
      title="模板工作台"
      description="核对来源与安装差异，再将可信模板复制为当前 Space 的独立计划。"
    />
  );
  return (
    <main className={styles.root} id="main-content">
      <WorkbenchFrame
        context={
          <div id="templates-context">
            <WorkbenchContextBar
              context={{
                permission: context.selectedWorkspace
                  ? {
                      label: context.selectedWorkspace.role,
                      tone: context.capabilities.canWrite ? "good" : "warn",
                    }
                  : undefined,
                space: context.selectedSpace
                  ? {
                      id: context.selectedSpace.id,
                      name: context.selectedSpace.name,
                    }
                  : undefined,
                sync: {
                  label: context.online ? "在线" : "离线",
                  tone: context.online ? "good" : "warn",
                },
                workspace: context.selectedWorkspace
                  ? {
                      id: context.selectedWorkspace.id,
                      name: context.selectedWorkspace.name,
                    }
                  : undefined,
              }}
            />
          </div>
        }
        header={header}
        label="Templates 模板工作台"
        main={
          <TemplateDetail
            actions={actions}
            context={context}
            onOpenInstall={() => openSheet("install")}
            onOpenShare={() => openSheet("share")}
          />
        }
        master={
          <CategoryMaster
            actions={actions}
            context={context}
            onSelect={actions.setSelectedTemplateId}
          />
        }
        inspector={
          <TemplateInspector
            actions={actions}
            context={context}
            onOpenCreate={() => openSheet("create")}
            onOpenImport={() => openSheet("import")}
            onOpenRevoke={(share) => {
              setRevokeTarget(share);
              openSheet("revoke");
            }}
            onOpenShare={() => openSheet("share")}
          />
        }
        inspectorLabel="模板检查器"
        mainLabel="模板详情"
        masterLabel="模板分类"
        toolbar={<ContextToolbar actions={actions} context={context} />}
      />
      {context.recentAuthRequired ? (
        <ProductOperationalStateNotice
          state={{
            kind: "error",
            title: "需要重新认证",
            description: context.status,
            impact: "当前操作尚未执行；已有模板、目标和分享数据保持不变。",
            recovery: {
              kind: "link",
              href: "/auth/login?next=/app/templates",
              label: "重新认证",
            },
          }}
        />
      ) : (
        <StateNotice
          action={stateAction}
          emptyDescription="当前 Workspace 与 Space 已就绪；选择模板或创建第一个模板版本。"
          emptyTitle="当前模板范围暂无内容"
          onRetry={() => void actions.loadContext()}
          state={context.templateState}
        />
      )}
      <InstallSheet
        actions={actions}
        context={context}
        onOpenChange={closeSheet}
        open={sheet === "install"}
        restoreFocusRef={actionRef}
      />
      <CreateSheet
        actions={actions}
        context={context}
        onOpenChange={closeSheet}
        open={sheet === "create"}
        restoreFocusRef={actionRef}
      />
      <ImportSheet
        actions={actions}
        context={context}
        onOpenChange={closeSheet}
        open={sheet === "import"}
        restoreFocusRef={actionRef}
      />
      <ShareSheet
        actions={actions}
        context={context}
        onOpenChange={closeSheet}
        open={sheet === "share"}
        restoreFocusRef={actionRef}
      />
      <RevokeSheet
        actions={actions}
        context={context}
        onOpenChange={(open) => {
          closeSheet(open);
          if (!open) setRevokeTarget(null);
        }}
        open={sheet === "revoke"}
        restoreFocusRef={actionRef}
        share={revokeTarget}
      />
    </main>
  );
}
