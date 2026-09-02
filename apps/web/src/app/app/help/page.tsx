"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import { ProductTag } from "@/components/product/product-ui";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";

import styles from "./help-workbench.module.css";

type HelpSection = "search" | "diagnostics" | "recovery" | "faq";

const FAQS = [
  {
    id: "context",
    question: "Workspace、Space 和 Persona 为什么会持续显示？",
    answer: "这些上下文决定当前页面的权限和数据边界；帮助页不会修改它们。",
    keywords: "workspace space persona 权限",
  },
  {
    id: "vault",
    question: "如何解锁 Vault？",
    answer:
      "回到记录、复习或数据工作台，使用本机口令解锁；口令不会上传服务器。",
    keywords: "vault 解锁 口令 本机",
  },
  {
    id: "sync",
    question: "离线后如何恢复同步？",
    answer:
      "先确认网络恢复，再打开同步工作台查看 Outbox 和冲突处理；冲突不会被静默覆盖。",
    keywords: "offline 离线 sync 同步 outbox 冲突",
  },
  {
    id: "permission",
    question: "为什么某个操作显示没有权限？",
    answer:
      "检查当前 Workspace、Space 和成员角色；安全中心与空间治理页会给出下一步入口。",
    keywords: "permission 权限 workspace space role",
  },
  {
    id: "account",
    question: "Session 过期后怎么办？",
    answer:
      "刷新账户状态；若仍未登录，回到登录页重新认证。未保存的本地草稿不会被帮助页清除。",
    keywords: "session 登录 过期 认证",
  },
] as const;

function statusLabel(
  status: "loading" | "anonymous" | "authenticated" | "error",
) {
  if (status === "authenticated") return "已认证";
  if (status === "loading") return "读取中";
  if (status === "anonymous") return "未登录";
  return "暂不可用";
}

export default function HelpPage() {
  const { state: session } = useSession();
  const { phase: vaultPhase, revision } = useVaultSession();
  const [section, setSection] = useState<HelpSection>("search");
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) return FAQS;
    return FAQS.filter((item) =>
      `${item.question} ${item.answer} ${item.keywords}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedQuery]);
  const vaultLabel =
    vaultPhase === "unlocked"
      ? "已解锁"
      : vaultPhase === "unlocking"
        ? "解锁中"
        : vaultPhase === "clearing"
          ? "清理中"
          : "已锁定";
  const diagnostics = [
    {
      id: "network",
      label: "网络连接",
      value: online ? "在线" : "离线",
      tone: online ? "good" : "warn",
      detail: online
        ? "可以访问需要服务器的恢复动作。"
        : "本地工作仍可继续；服务器操作会在连接恢复后重试。",
    },
    {
      id: "session",
      label: "Session",
      value: statusLabel(session.status),
      tone:
        session.status === "authenticated"
          ? "good"
          : session.status === "error"
            ? "warn"
            : "default",
      detail:
        session.status === "error"
          ? `请求编号：${session.error.requestId}`
          : "账户身份由当前认证上下文提供。",
    },
    {
      id: "vault",
      label: "本机资料",
      value: vaultLabel,
      tone:
        vaultPhase === "unlocked"
          ? "good"
          : vaultPhase === "clearing"
            ? "warn"
            : "default",
      detail:
        vaultPhase === "locked"
          ? "需要在需要本地资料的工作台输入本机口令。"
          : `本地修订号 ${revision}。`,
    },
  ] as const;

  return (
    <main
      className={styles.page}
      data-testid="help-workbench"
      id="main-content"
    >
      <WorkbenchFrame
        context={
          <WorkbenchContextBar
            context={{
              permission: {
                label:
                  session.status === "authenticated" ? "本人账户" : "需认证",
                tone: session.status === "authenticated" ? "good" : "warn",
              },
              sync: {
                label: online ? "在线" : "离线",
                tone: online ? "good" : "warn",
              },
            }}
          />
        }
        header={
          <WorkbenchHeader
            actions={
              <ProductTag tone={online ? "good" : "warn"}>
                {online ? "在线自助" : "离线模式"}
              </ProductTag>
            }
            description="从当前页面排查 Session、网络和本机资料，并沿真实恢复路径继续操作。"
            eyebrow="HELP & RECOVERY"
            title="帮助"
          />
        }
        inspectorLabel="帮助检查器"
        label="帮助与恢复工作台"
        mainLabel="帮助内容"
        masterLabel="帮助目录"
        master={
          <aside className={styles.masterPane} data-testid="help-master">
            <div className={styles.paneHeading}>
              <span className={styles.eyebrow}>HELP INDEX</span>
              <strong>帮助目录</strong>
            </div>
            <nav aria-label="帮助分区" className={styles.masterNav}>
              <button
                aria-current={section === "search" ? "page" : undefined}
                aria-label="搜索帮助"
                className={section === "search" ? styles.activeRow : undefined}
                onClick={() => setSection("search")}
                type="button"
              >
                <AppIcon name="search" size={15} />
                <span>
                  <strong>搜索帮助</strong>
                  <small>查找恢复说明</small>
                </span>
              </button>
              <button
                aria-current={section === "diagnostics" ? "page" : undefined}
                aria-label="环境诊断"
                className={
                  section === "diagnostics" ? styles.activeRow : undefined
                }
                onClick={() => setSection("diagnostics")}
                type="button"
              >
                <AppIcon name="shield" size={15} />
                <span>
                  <strong>诊断状态</strong>
                  <small>{online ? "网络在线" : "当前离线"}</small>
                </span>
              </button>
              <button
                aria-current={section === "recovery" ? "page" : undefined}
                aria-label="恢复路径"
                className={
                  section === "recovery" ? styles.activeRow : undefined
                }
                onClick={() => setSection("recovery")}
                type="button"
              >
                <AppIcon name="refresh" size={15} />
                <span>
                  <strong>恢复入口</strong>
                  <small>安全、同步和数据</small>
                </span>
              </button>
              <button
                aria-current={section === "faq" ? "page" : undefined}
                aria-label="常见问题"
                className={section === "faq" ? styles.activeRow : undefined}
                onClick={() => setSection("faq")}
                type="button"
              >
                <AppIcon name="files" size={15} />
                <span>
                  <strong>问题目录</strong>
                  <small>{results.length} 条可匹配</small>
                </span>
              </button>
            </nav>
            <p className={styles.masterHint}>
              帮助页只提供解释和真实深链，不会替你修改权限、清除本机资料或覆盖同步冲突。
            </p>
          </aside>
        }
        main={
          <div className={styles.mainPane}>
            <section className={styles.searchSection} data-testid="help-search">
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>HELP SEARCH</span>
                  <h2>从问题开始</h2>
                  <p>
                    搜索本机资料、同步、权限或 Session，结果会在当前工作区过滤。
                  </p>
                </div>
                <ProductTag tone={results.length ? "info" : "warn"}>
                  {results.length} 条结果
                </ProductTag>
              </header>
              <label
                className={styles.searchField}
                data-workbench-primary="true"
                htmlFor="help-query"
              >
                <AppIcon name="search" size={17} />
                <input
                  aria-label="搜索帮助"
                  autoComplete="off"
                  id="help-query"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索帮助，例如 Vault 或同步"
                  type="search"
                  value={query}
                />
                <kbd>⌘ K</kbd>
              </label>
              <div className={styles.resultList} aria-live="polite">
                {results.length ? (
                  results.map((item) => (
                    <article className={styles.resultRow} key={item.id}>
                      <div>
                        <h3>{item.question}</h3>
                        <p>{item.answer}</p>
                      </div>
                      <AppIcon name="chevron-down" size={15} />
                    </article>
                  ))
                ) : (
                  <div className={styles.emptyResult}>
                    <AppIcon name="search" size={18} />
                    <strong>没有匹配的帮助</strong>
                    <span>尝试搜索“Vault”“同步”或“权限”。</span>
                  </div>
                )}
              </div>
            </section>
            <section
              className={styles.contentSection}
              data-testid="help-diagnostics"
            >
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>
                    ENVIRONMENT DIAGNOSTICS
                  </span>
                  <h2>环境诊断</h2>
                  <p>状态来自当前浏览器与认证上下文，刷新页面即可重新读取。</p>
                </div>
              </header>
              <div className={styles.diagnosticList}>
                {diagnostics.map((item) => (
                  <div className={styles.diagnosticRow} key={item.id}>
                    <span className={styles.diagnosticIcon}>
                      <AppIcon
                        name={
                          item.id === "network"
                            ? "refresh"
                            : item.id === "session"
                              ? "users"
                              : "lock"
                        }
                        size={15}
                      />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <ProductTag tone={item.tone}>{item.value}</ProductTag>
                  </div>
                ))}
              </div>
            </section>
            <section
              className={styles.contentSection}
              data-testid="help-recovery"
            >
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>RECOVERY PATHS</span>
                  <h2>恢复路径</h2>
                  <p>每个入口都保持原有权限与确认流程。</p>
                </div>
              </header>
              <div className={styles.recoveryList}>
                <Link className={styles.recoveryRow} href="/app/security">
                  <span className={styles.diagnosticIcon}>
                    <AppIcon name="shield" size={15} />
                  </span>
                  <span>
                    <strong>账户安全</strong>
                    <small>Session、Passkey、TOTP 和设备会话。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
                <Link className={styles.recoveryRow} href="/app/sync">
                  <span className={styles.diagnosticIcon}>
                    <AppIcon name="refresh" size={15} />
                  </span>
                  <span>
                    <strong>同步工作台</strong>
                    <small>查看 Outbox、冲突、附件队列和设备状态。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
                <Link className={styles.recoveryRow} href="/app/data">
                  <span className={styles.diagnosticIcon}>
                    <AppIcon name="archive" size={15} />
                  </span>
                  <span>
                    <strong>数据主权</strong>
                    <small>导入、导出和账户删除恢复路径。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
                <Link className={styles.recoveryRow} href="/auth/login">
                  <span className={styles.diagnosticIcon}>
                    <AppIcon name="users" size={15} />
                  </span>
                  <span>
                    <strong>重新登录</strong>
                    <small>Session 不可用时回到认证流程。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
              </div>
            </section>
            <section className={styles.contentSection} data-testid="help-faq">
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>FAQ</span>
                  <h2>常见问题</h2>
                  <p>FAQ 与上方搜索共享筛选结果。</p>
                </div>
              </header>
              <div className={styles.faqList}>
                {normalizedQuery
                  ? null
                  : results.map((item) => (
                      <details key={`faq-${item.id}`}>
                        <summary>
                          {item.question}
                          <AppIcon name="chevron-down" size={15} />
                        </summary>
                        <p>{item.answer}</p>
                      </details>
                    ))}
              </div>
            </section>
          </div>
        }
        inspector={
          <aside className={styles.inspectorPane}>
            <InspectorSection title="当前环境">
              <dl className={styles.kvList}>
                <div>
                  <dt>网络</dt>
                  <dd>{online ? "在线" : "离线"}</dd>
                </div>
                <div>
                  <dt>Session</dt>
                  <dd>{statusLabel(session.status)}</dd>
                </div>
                <div>
                  <dt>本机资料</dt>
                  <dd>{vaultLabel}</dd>
                </div>
              </dl>
            </InspectorSection>
            <InspectorSection title="恢复边界">
              <p>
                帮助页不会绕过权限或自动清理数据。危险操作仍在安全、同步和数据工作台中二次确认。
              </p>
              <Link className={styles.inspectorLink} href="/app/security">
                <AppIcon name="shield" size={15} />
                查看安全中心
              </Link>
            </InspectorSection>
            <InspectorSection title="搜索状态">
              <p className={styles.inspectorStatus} aria-live="polite">
                {normalizedQuery ? "正在筛选当前关键词" : "等待输入帮助关键词"}
              </p>
            </InspectorSection>
          </aside>
        }
        toolbar={
          <WorkbenchToolbar label="帮助工具">
            <span className={styles.toolbarStatus}>
              诊断随浏览器网络事件更新
            </span>
          </WorkbenchToolbar>
        }
      />
    </main>
  );
}
