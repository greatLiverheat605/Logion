import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main id="main-content" className="session-state">
      <h1>页面不存在</h1>
      <p>这个地址没有对应的 Logion 页面，或者该入口尚未开放。</p>
      <Link className="text-link" href="/">
        返回首页
      </Link>
    </main>
  );
}
