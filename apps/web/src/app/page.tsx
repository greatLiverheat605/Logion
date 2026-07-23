import Link from "next/link";

const checks = [
  "目标、计划与证据闭环",
  "离线编辑与多设备同步",
  "研究、备考与自主学习空间",
  "可审查的 AI 草稿与数据主权",
];

export default function HomePage() {
  return (
    <main id="main-content" className="shell">
      <section className="hero" aria-labelledby="phase-title">
        <p className="eyebrow">LOGION · 可验证的长期学习系统</p>
        <h1 id="phase-title">让学习过程留下可以复查的证据</h1>
        <p className="lede">
          在一个由你定义内容的工作区中组织目标、资料、笔记、实验与复习。断网时继续编辑，联网后安全同步；AI
          只生成待你确认的草稿。
        </p>
        <ul className="check-grid" aria-label="Logion 核心能力">
          {checks.map((check) => (
            <li key={check}>
              <span aria-hidden="true">✓</span>
              {check}
            </li>
          ))}
        </ul>
        <nav className="hero-actions" aria-label="开始使用 Logion">
          <Link className="primary-link" href="/auth/register">
            创建账户
          </Link>
          <Link className="text-link" href="/auth/login">
            登录
          </Link>
        </nav>
      </section>
    </main>
  );
}
