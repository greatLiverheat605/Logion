"use client";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="session-state">
      <h1>页面暂时不可用</h1>
      <p>Logion 没有显示内部错误信息。你可以安全地重试当前页面。</p>
      <button type="button" onClick={reset}>
        重试
      </button>
    </main>
  );
}
