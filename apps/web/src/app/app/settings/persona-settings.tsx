"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { WorkbenchSheet } from "@/components/product/headless-ui";
import { IntegrationHubEntry } from "@/features/integrations/integration-hub-entry";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import {
  ALL_ROUTES,
  BUILTIN_PERSONAS,
  REQUIRED_PERSONA_ROUTES,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";
import { usePersona } from "@/features/personas/persona-context";

import styles from "./settings-workbench.module.css";

type SettingsSection = "persona" | "appearance" | "interaction" | "navigation";

const ICONS = ["🎯", "📚", "🔬", "📝", "🧭", "💡"] as const;
const REQUIRED_ROUTES = new Set<string>(REQUIRED_PERSONA_ROUTES);
const ROUTE_LABELS: Readonly<Record<(typeof ALL_ROUTES)[number], string>> = {
  "/app/today": "每日工作台",
  "/app/self-study": "自学",
  "/app/records": "记录",
  "/app/review": "复习",
  "/app/exam": "考试",
  "/app/planning": "规划",
  "/app/templates": "模板",
  "/app/audit": "审计",
  "/app/spaces": "空间",
  "/app/settings": "设置",
  "/app/profile": "个人",
  "/app/help": "帮助",
};

const SECTION_META: Readonly<Record<SettingsSection, { icon: "target" | "sun" | "timer" | "layout-template"; label: string; description: string }>> = {
  persona: { description: "决定优先显示哪些工作区入口。", icon: "target", label: "学习画像" },
  appearance: { description: "控制主题与显示表面。", icon: "sun", label: "界面与交互" },
  interaction: { description: "查看操作方式和系统反馈偏好。", icon: "timer", label: "操作偏好" },
  navigation: { description: "确认画像保留的系统入口。", icon: "layout-template", label: "导航入口" },
};

function personaIcon(persona: PersonaDefinition) {
  const iconById: Record<string, "book-open" | "flask" | "target" | "users"> = {
    exam: "target",
    mentor: "users",
    research: "flask",
    self: "book-open",
  };
  return <AppIcon name={iconById[persona.id] ?? "target"} size={16} />;
}

function PersonaSection({
  activePersona,
  customPersonas,
  pendingId,
  onChoose,
  onRemove,
}: Readonly<{
  activePersona: PersonaDefinition | null;
  customPersonas: PersonaDefinition[];
  pendingId: string | null;
  onChoose: (persona: PersonaDefinition) => void;
  onRemove: (persona: PersonaDefinition) => void;
}>) {
  const personas = [...BUILTIN_PERSONAS, ...customPersonas];
  return (
    <section className={styles.section} data-testid="settings-persona">
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.kicker}>PERSONA ROUTING</span>
          <h2>学习画像</h2>
          <p className={styles.sectionDescription}>画像只调整导航优先级，不改变 Workspace、Space 或任何权限。</p>
        </div>
      </header>
      <ul className={styles.personaList} aria-label="可用学习画像">
        {personas.map((persona) => {
          const selected = activePersona?.id === persona.id;
          return (
            <li key={persona.id}>
              <button
                aria-label={`切换到：${persona.name}，${persona.description}`}
                aria-pressed={selected}
                className={`${styles.personaRow} persona-card`}
                disabled={pendingId !== null}
                type="button"
                onClick={() => onChoose(persona)}
              >
                <span aria-hidden="true" className={styles.personaGlyph}>{personaIcon(persona)}</span>
                <span className={styles.rowCopy}>
                  <strong><span>{persona.name}</span><span aria-hidden="true">{persona.isBuiltin ? " · 官方画像" : " · 自定义"}</span></strong>
                  <small>{persona.description} · {persona.routes.length} 个入口</small>
                </span>
                {selected ? <span className={styles.selectedMark}>当前使用</span> : null}
              </button>
              {!persona.isBuiltin ? (
                <button
                  aria-label={`删除自定义画像：${persona.name}`}
                  className={styles.dangerAction}
                  disabled={pendingId !== null}
                  type="button"
                  onClick={() => onRemove(persona)}
                >
                  删除
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PersonaSettings() {
  const {
    activePersona,
    createCustomPersona,
    customPersonas,
    deleteCustomPersona,
    isLoading,
    setActivePersona,
  } = usePersona();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [section, setSection] = useState<SettingsSection>("persona");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState("偏好设置会保存到当前账户。");

  async function choose(persona: PersonaDefinition) {
    setPendingId(persona.id);
    try {
      await setActivePersona(persona.id);
      setStatus(`已切换到「${persona.name}」画像。`);
    } catch {
      setStatus("画像未能保存，请刷新数据后重试。");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(persona: PersonaDefinition) {
    setPendingId(persona.id);
    try {
      await deleteCustomPersona(persona.id);
      setStatus(`已删除「${persona.name}」。`);
    } catch {
      setStatus("画像未能保存，请刷新数据后重试。");
    } finally {
      setPendingId(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedRoutes = new Set(data.getAll("routes").map(String));
    for (const route of REQUIRED_ROUTES) selectedRoutes.add(route);
    const routes = ALL_ROUTES.filter((route) => selectedRoutes.has(route));
    const id = `custom-${crypto.randomUUID()}` as const;
    setPendingId(id);
    try {
      await createCustomPersona({
        description: String(data.get("description") ?? "").trim(),
        icon: String(data.get("icon") ?? ICONS[0]),
        id,
        name: String(data.get("name") ?? "").trim(),
        routes: [...routes],
      });
      form.reset();
      setSheetOpen(false);
      setStatus("自定义画像已创建。");
    } catch {
      setStatus("画像未能保存，请刷新数据后重试。");
    } finally {
      setPendingId(null);
    }
  }

  const meta = SECTION_META[section];
  const main = section === "persona" ? (
    <PersonaSection
      activePersona={activePersona}
      customPersonas={customPersonas}
      onChoose={(persona) => void choose(persona)}
      onRemove={(persona) => void remove(persona)}
      pendingId={pendingId}
    />
  ) : section === "appearance" ? (
    <section className={styles.section} data-testid="settings-appearance">
      <header className={styles.sectionHeader}><div><span className={styles.kicker}>SURFACE & THEME</span><h2>界面与交互</h2><p className={styles.sectionDescription}>主题切换立即生效，并保留在本机下次访问时使用。</p></div></header>
      <div className={styles.themeControl}><div><strong>主题</strong><p>选择浅色或深色工作台表面。</p></div><ThemeToggle className={styles.secondaryAction} /></div>
      <div className={styles.settingRow}><AppIcon className={styles.settingIcon} name="shield" size={16} /><span className={styles.rowCopy}><strong>中性表面</strong><small>页面使用稳定的中性层级，品牌色只强调当前动作和状态。</small></span></div>
    </section>
  ) : section === "interaction" ? (
    <section className={styles.section} data-testid="settings-interaction">
      <header className={styles.sectionHeader}><div><span className={styles.kicker}>INTERACTION</span><h2>操作偏好</h2><p className={styles.sectionDescription}>高频操作优先留在当前工作区，低频设置通过 Sheet 打开。</p></div></header>
      <ul className={styles.settingList}>
        <li className={styles.settingRow}><AppIcon className={styles.settingIcon} name="search" size={16} /><span className={styles.rowCopy}><strong>命令栏</strong><small>使用顶部搜索打开页面、命令和常用恢复动作。</small></span><kbd>Ctrl K</kbd></li>
        <li className={styles.settingRow}><AppIcon className={styles.settingIcon} name="target" size={16} /><span className={styles.rowCopy}><strong>聚焦上下文</strong><small>工作区、Space、Persona、权限和 Vault 在当前页面持续回显。</small></span></li>
        <li className={styles.settingRow}><AppIcon className={styles.settingIcon} name="timer" size={16} /><span className={styles.rowCopy}><strong>减少动态效果</strong><small>系统的 reduced-motion 偏好会自动禁用非必要动画。</small></span></li>
      </ul>
    </section>
  ) : (
    <section className={styles.section} data-testid="settings-navigation">
      <header className={styles.sectionHeader}><div><span className={styles.kicker}>NAVIGATION CONTRACT</span><h2>导航入口</h2><p className={styles.sectionDescription}>每日、设置、个人和帮助始终保留，其余入口由当前画像决定。</p></div></header>
      <ul className={styles.routeList} aria-label="当前画像导航入口">
        {ALL_ROUTES.map((route) => <li className={styles.routeRow} key={route}><AppIcon name={REQUIRED_ROUTES.has(route) ? "shield" : "layout-template"} size={15} /><span className={styles.rowCopy}><strong>{ROUTE_LABELS[route]}{REQUIRED_ROUTES.has(route) ? " · 必需" : ""}</strong><span className={styles.routePath}>{route}</span></span></li>)}
      </ul>
    </section>
  );

  return (
    <>
      <main className={styles.page} data-testid="settings-workbench" id="main-content">
        <WorkbenchFrame
          context={<WorkbenchContextBar context={{ persona: activePersona ? { id: activePersona.id, name: activePersona.name } : undefined, permission: { label: "仅个人偏好", tone: "good" }, sync: { label: isLoading ? "正在同步" : "已同步", tone: isLoading ? "warn" : "good" }, vault: { label: "本机偏好" } }} />}
          header={<WorkbenchHeader actions={<span className="product-tag tone-info">账户级偏好</span>} description="把常用学习场景、主题和导航入口整理成一套可持续使用的工作台。" eyebrow="PERSONAL WORKSPACE" title="设置" />}
          inspector={<aside className={styles.inspector} data-testid="settings-inspector"><InspectorSection title="当前偏好"><dl className={styles.inspectorList}><div><dt>当前画像</dt><dd>{activePersona?.name ?? "正在读取"}</dd></div><div><dt>可见入口</dt><dd>{activePersona?.routes.length ?? 0} 个路由</dd></div><div><dt>保存范围</dt><dd>当前账户</dd></div></dl></InspectorSection><InspectorSection title="安全边界"><p>偏好只控制导航和显示，不改变 Workspace 成员角色、Space 权限或 Vault 加密边界。</p><Link className={styles.inspectorLink} href="/app/security"><AppIcon name="shield" size={15} />打开安全中心</Link><IntegrationHubEntry /></InspectorSection></aside>}
          inspectorLabel="偏好检查器"
          label="个人设置工作台"
          main={<div data-testid="settings-main" className={styles.main}><div className={styles.mainHeader}><div><span className={styles.eyebrow}>{meta.label}</span><h2>{meta.label}</h2><p>{meta.description}</p></div><span className="product-tag tone-good">{isLoading ? "读取中" : "已同步"}</span></div><WorkbenchActionBar primary={section === "persona" ? <button ref={createButtonRef} className={styles.primaryAction} type="button" onClick={() => setSheetOpen(true)}><AppIcon name="plus" size={15} />新建自定义画像</button> : undefined} /><div className={styles.content}>{main}</div></div>}
          mainLabel="偏好设置"
          master={<aside className={styles.master} data-testid="settings-master"><div className={styles.masterHeader}><span className={styles.eyebrow}>SETTINGS INDEX</span><h2>设置分组</h2></div><nav aria-label="设置分组" className={styles.masterNav}>{(Object.entries(SECTION_META) as Array<[SettingsSection, (typeof SECTION_META)[SettingsSection]]>).map(([id, value]) => <button data-active={section === id} key={id} type="button" onClick={() => setSection(id)}><AppIcon name={value.icon} size={16} /><span className={styles.rowCopy}><strong>{value.label}</strong><small>{value.description}</small></span></button>)}</nav><p className={styles.masterHint}>设置在当前账户范围内生效；Workspace 权限请前往成员治理页面调整。</p></aside>}
          masterLabel="设置分组"
          toolbar={<WorkbenchToolbar label="设置状态"><span className={styles.status} aria-live="polite">{pendingId ? "正在保存偏好…" : status}</span></WorkbenchToolbar>}
        />
      </main>
      <WorkbenchSheet description="自定义画像会保存到当前账户，并始终保留每日、设置、个人和帮助入口。" onOpenChange={setSheetOpen} open={sheetOpen} restoreFocusRef={createButtonRef} title="新建自定义画像">
        <form id="custom-persona-form" onSubmit={(event) => void create(event)}>
          <label htmlFor="custom-persona-name">名称</label><input data-modal-autofocus id="custom-persona-name" maxLength={40} name="name" placeholder="例如：我的研考混合" required />
          <label htmlFor="custom-persona-icon">图标</label><select id="custom-persona-icon" name="icon" defaultValue={ICONS[0]}>{ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select>
          <label htmlFor="custom-persona-description">说明</label><textarea id="custom-persona-description" maxLength={160} name="description" placeholder="简要说明这个场景的用途" rows={3} />
          <fieldset><legend>可见入口</legend><p>每日、设置、个人和帮助为必需入口。</p>{ALL_ROUTES.map((route) => { const required = REQUIRED_ROUTES.has(route); return <label key={route}><input defaultChecked={required} disabled={required} name="routes" type="checkbox" value={route} /><span>{ROUTE_LABELS[route]}</span></label>; })}</fieldset>
          <footer><button className={styles.secondaryAction} type="button" onClick={() => setSheetOpen(false)}>取消</button><button className={styles.primaryAction} disabled={pendingId !== null} form="custom-persona-form" type="submit">{pendingId ? "正在保存…" : "保存"}</button></footer>
        </form>
      </WorkbenchSheet>
    </>
  );
}
