"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PublicFlowHeader,
  PublicFlowShell,
  PublicFlowState,
} from "@/features/public-flows/public-flow-shell";

import styles from "@/features/public-flows/public-flow-workbench.module.css";

// ADR-0035: served by the Service Worker from cache when a navigation fails.
// Offline no script loads, so every control must work as plain HTML.
export default function OfflinePage() {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <PublicFlowShell wide>
      <PublicFlowHeader
        eyebrow="OFFLINE"
        title="暂时无法打开这个页面"
        description="当前设备连不上服务器。需要登录的页面要由服务器确认登录状态和权限，所以离线时不能打开。"
      />
      <div className={styles.stack}>
        <section data-testid="offline-state">
          <PublicFlowState
            icon="!"
            title={online ? "网络已恢复" : "网络连接不可用"}
            tone={online ? "success" : "warning"}
          >
            <p aria-live="polite">
              {online
                ? "可以重新打开刚才的页面。"
                : "恢复网络后，重新打开刚才的页面即可继续。"}
            </p>
          </PublicFlowState>
        </section>

        <section className={styles.region} data-testid="offline-local">
          <h2>本机资料仍在</h2>
          <ul className={styles.muted}>
            <li>
              已保存在这台设备上的加密资料（笔记、任务、复习记录）、尚未发送的修改和表单草稿都还在当前浏览器中，关闭本页不会丢失。
            </li>
            <li>本页不会读取或显示这些资料。</li>
            <li>
              如果其他标签页里已经打开并解锁了本地资料，可以在那里继续编辑，修改会先保存在本机，联网后再同步。
            </li>
          </ul>
          <p className={`${styles.notice} ${styles.noticeSuccess}`}>
            同步前不要清除网站数据或卸载应用，否则尚未发送的修改会丢失。
          </p>
        </section>

        <section className={styles.region} data-testid="offline-recovery">
          <h2>联网后继续</h2>
          <ol className={styles.muted}>
            <li>恢复网络后点“重新打开此页”。</li>
            <li>需要时重新登录，并解锁本地资料。</li>
            <li>到同步中心确认待发送的修改和冲突。</li>
          </ol>
          <div className={styles.actions}>
            <form method="get">
              <button
                className={styles.primaryLink}
                data-workbench-primary="true"
                type="submit"
              >
                重新打开此页
              </button>
            </form>
            <Link className={styles.secondaryLink} href="/">
              返回首页
            </Link>
            <Link
              className={styles.secondaryLink}
              href="/app/sync?tab=conflict"
            >
              联网后打开同步中心
            </Link>
          </div>
        </section>
      </div>
    </PublicFlowShell>
  );
}
