import Link from "next/link";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";
import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";

const capabilities: readonly Readonly<{
  description: string;
  icon: AppIconName;
  title: string;
}>[] = [
  {
    description: "把今日行动、长期目标与复习节奏放在同一条进度线上。",
    icon: "target",
    title: "学习闭环",
  },
  {
    description: "集中整理资料、笔记、研究记录与可回溯的证据链。",
    icon: "book-open",
    title: "知识工作台",
  },
  {
    description: "离线继续编辑，联网后再进行受控同步与设备管理。",
    icon: "refresh",
    title: "本地优先",
  },
];

export default function HomePage() {
  return (
    <main id="main-content" className="access-page">
      <div className="access-shell">
        <AccessShellHeader />
        <section className="access-home" aria-labelledby="access-title">
          <div className="access-home-primary">
            <p className="access-eyebrow">PRIVATE LEARNING WORKSPACE</p>
            <h1 id="access-title">组织学习过程，保留可复查的进展与证据。</h1>
            <p className="access-home-description">
              Logion
              是面向个人及小规模协作的学习与研究工作台。计划、资料、笔记、复习和研究记录在同一工作区持续衔接。
            </p>
            <nav className="access-actions" aria-label="进入 Logion">
              <Link className="access-primary-link" href="/auth/login">
                登录工作区
              </Link>
              <Link className="access-secondary-link" href="/auth/register">
                使用邀请注册
              </Link>
            </nav>
            <p className="access-policy">
              <AppIcon aria-hidden="true" name="lock" size={15} />
              仅限本人及受邀成员访问
            </p>
          </div>
          <aside className="access-workspace-card" aria-label="工作区状态">
            <div className="access-workspace-head">
              <div>
                <span>WORKSPACE</span>
                <strong>个人学习空间</strong>
              </div>
              <span className="access-status">READY</span>
            </div>
            <div className="access-workspace-focus">
              <span aria-hidden="true">
                <AppIcon name="calendar" size={20} />
              </span>
              <div>
                <small>从这里继续</small>
                <strong>今日计划与学习进度</strong>
                <p>登录后读取你的真实任务、复习队列和同步状态。</p>
              </div>
            </div>
            <ul className="access-workspace-list">
              <li>
                <span>数据边界</span>
                <strong>私有优先</strong>
              </li>
              <li>
                <span>离线工作</span>
                <strong>可继续</strong>
              </li>
              <li>
                <span>AI 输出</span>
                <strong>确认后采用</strong>
              </li>
            </ul>
          </aside>
        </section>
        <section className="access-capabilities" aria-label="工作区能力">
          {capabilities.map((capability) => (
            <article key={capability.title}>
              <span aria-hidden="true" className="access-capability-icon">
                <AppIcon name={capability.icon} />
              </span>
              <div>
                <h2>{capability.title}</h2>
                <p>{capability.description}</p>
              </div>
            </article>
          ))}
        </section>
        <p className="access-footer">私有工作区 · 本地优先 · 可验证同步</p>
      </div>
    </main>
  );
}
