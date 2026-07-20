const checks = [
  "同源认证契约",
  "HttpOnly Cookie",
  "会话轮换单飞",
  "隐私安全错误边界",
];

export default function HomePage() {
  return (
    <main id="main-content" className="shell">
      <section className="hero" aria-labelledby="phase-title">
        <p className="eyebrow">LOGION · PHASE 1</p>
        <h1 id="phase-title">可信身份体验正在接入</h1>
        <p className="lede">
          当前版本先建立安全的浏览器认证边界。具体登录、注册与工作区界面将在独立工作包中接入，用户内容和学习上下文不会被写死。
        </p>
        <ul className="check-grid" aria-label="Phase 1 Web 认证基础能力">
          {checks.map((check) => (
            <li key={check}>
              <span aria-hidden="true">✓</span>
              {check}
            </li>
          ))}
        </ul>
        <p className="status" role="status">
          Auth shell: ready
        </p>
      </section>
    </main>
  );
}
