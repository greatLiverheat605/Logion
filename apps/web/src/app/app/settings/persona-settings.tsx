"use client";

import { type FormEvent, useRef, useState } from "react";

import { AppModal } from "@/components/app-shell/app-modal";
import {
  ALL_ROUTES,
  BUILTIN_PERSONAS,
  REQUIRED_PERSONA_ROUTES,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";
import { usePersona } from "@/features/personas/persona-context";

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

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? "画像未能保存，请刷新数据后重试。"
    : "画像未能保存，请稍后重试。";
}

export function PersonaSettings() {
  const {
    activePersona,
    createCustomPersona,
    customPersonas,
    deleteCustomPersona,
    setActivePersona,
  } = usePersona();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function choose(persona: PersonaDefinition) {
    setPendingId(persona.id);
    setStatus(null);
    try {
      await setActivePersona(persona.id);
      setStatus(`已切换到「${persona.name}」画像。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(persona: PersonaDefinition) {
    setPendingId(persona.id);
    setStatus(null);
    try {
      await deleteCustomPersona(persona.id);
      setStatus(`已删除「${persona.name}」。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedRoutes = new Set(
      data.getAll("routes").map((route) => String(route)),
    );
    for (const route of REQUIRED_ROUTES) selectedRoutes.add(route);
    const routes = ALL_ROUTES.filter((route) => selectedRoutes.has(route));
    const id = `custom-${crypto.randomUUID()}` as const;
    setPendingId(id);
    setStatus(null);
    try {
      await createCustomPersona({
        id,
        name: String(data.get("name") ?? "").trim(),
        icon: String(data.get("icon") ?? ICONS[0]),
        description: String(data.get("description") ?? "").trim(),
        routes: [...routes],
      });
      form.reset();
      setDialogOpen(false);
      setStatus("自定义画像已创建。");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <section
        aria-labelledby="builtin-personas-title"
        className="product-panel"
      >
        <header className="product-panel-head">
          <div>
            <h2 id="builtin-personas-title">预设画像</h2>
            <div className="product-panel-description">
              选择最接近当前目标的场景；画像只优化导航，不改变工作区权限。
            </div>
          </div>
        </header>
        <div className="persona-grid">
          {BUILTIN_PERSONAS.map((persona) => {
            const selected = activePersona?.id === persona.id;
            return (
              <button
                aria-label={`${selected ? "当前画像" : "切换到"}：${persona.name}，${persona.description}`}
                aria-pressed={selected}
                className={`persona-card${selected ? " active" : ""}`}
                disabled={pendingId !== null}
                key={persona.id}
                type="button"
                onClick={() => void choose(persona)}
              >
                <span aria-hidden="true" className="persona-card-icon">
                  {persona.icon}
                </span>
                <strong>{persona.name}</strong>
                <span>{persona.description}</span>
                <small>{persona.routes.length} 个可见入口</small>
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="custom-personas-title"
        className="product-panel"
      >
        <header className="product-panel-head">
          <div>
            <h2 id="custom-personas-title">自定义画像</h2>
            <div className="product-panel-description">
              自由组合需要的入口；每日与系统入口始终保留。
            </div>
          </div>
          <button
            className="primary-action"
            ref={createButtonRef}
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            新建自定义画像
          </button>
        </header>
        {customPersonas.length ? (
          <div className="custom-persona-list">
            {customPersonas.map((persona) => {
              const selected = activePersona?.id === persona.id;
              return (
                <article className="custom-persona-item" key={persona.id}>
                  <button
                    aria-label={`${selected ? "当前画像" : "切换到"}：${persona.name}`}
                    aria-pressed={selected}
                    className="custom-persona-choice"
                    disabled={pendingId !== null}
                    type="button"
                    onClick={() => void choose(persona)}
                  >
                    <span aria-hidden="true">{persona.icon}</span>
                    <span>
                      <strong>{persona.name}</strong>
                      <small>{persona.description || "自定义学习场景"}</small>
                    </span>
                  </button>
                  <button
                    aria-label={`删除自定义画像：${persona.name}`}
                    className="persona-delete-button"
                    disabled={pendingId !== null}
                    type="button"
                    onClick={() => void remove(persona)}
                  >
                    删除
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="persona-empty">尚未创建自定义画像。</p>
        )}
      </section>

      {status ? (
        <p aria-live="polite" className="persona-status" role="status">
          {status}
        </p>
      ) : null}

      {dialogOpen ? (
        <AppModal
          eyebrow="CUSTOM PERSONA"
          returnFocusRef={createButtonRef}
          title="新建自定义画像"
          onClose={() => setDialogOpen(false)}
        >
          <form className="persona-dialog-form" onSubmit={create}>
            <label htmlFor="custom-persona-name">名称</label>
            <input
              data-modal-autofocus
              id="custom-persona-name"
              maxLength={40}
              name="name"
              placeholder="例如：我的研考混合"
              required
            />
            <label htmlFor="custom-persona-icon">图标</label>
            <select
              id="custom-persona-icon"
              name="icon"
              defaultValue={ICONS[0]}
            >
              {ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
            <label htmlFor="custom-persona-description">说明</label>
            <textarea
              id="custom-persona-description"
              maxLength={160}
              name="description"
              placeholder="简要说明这个场景的用途"
              rows={3}
            />
            <fieldset className="persona-route-fieldset">
              <legend>可见路由</legend>
              <p>每日、设置、个人和帮助为必需入口。</p>
              <div className="persona-route-grid">
                {ALL_ROUTES.map((route) => {
                  const required = REQUIRED_ROUTES.has(route);
                  return (
                    <label key={route}>
                      <input
                        defaultChecked={required}
                        disabled={required}
                        name="routes"
                        type="checkbox"
                        value={route}
                      />
                      <span>
                        {ROUTE_LABELS[route]}
                        <small>{route}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="persona-dialog-actions">
              <button
                className="secondary-button"
                disabled={pendingId !== null}
                type="button"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="primary-action"
                disabled={pendingId !== null}
                type="submit"
              >
                {pendingId ? "正在保存…" : "保存"}
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}
    </>
  );
}
