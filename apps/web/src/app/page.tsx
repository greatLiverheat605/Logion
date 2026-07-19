const checks = ["单仓库边界", "FastAPI 契约", "PWA 外壳", "CI/CD 门禁"];

export default function HomePage() {
  return (
    <main id="main-content" className="shell">
      <section className="hero" aria-labelledby="phase-title">
        <p className="eyebrow">LOGION · PHASE 0</p>
        <h1 id="phase-title">可信工程底座正在建立</h1>
        <p className="lede">
          当前版本只验证架构、契约、离线入口和交付流水线。用户内容、导师、课题组、考试与研究方向不会被写死。
        </p>
        <ul className="check-grid" aria-label="Phase 0 能力">
          {checks.map((check) => (
            <li key={check}>
              <span aria-hidden="true">✓</span>
              {check}
            </li>
          ))}
        </ul>
        <p className="status" role="status">
          Web health: ready
        </p>
      </section>
    </main>
  );
}
