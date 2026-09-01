"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PublicFlowHeader,
  PublicFlowShell,
  PublicFlowState,
} from "@/features/public-flows/public-flow-shell";

import styles from "@/features/public-flows/public-flow-workbench.module.css";

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
        eyebrow="OFFLINE RECOVERY"
        title="当前处于离线状态"
        description="这是 Service Worker 的公共离线兜底；页面不会把本地状态伪装成已同步。"
      />
      <div className={styles.stack}>
        <section data-testid="offline-state">
          <PublicFlowState icon="!" title={online ? "网络已恢复，等待重新连接" : "网络连接不可用"} tone={online ? "success" : "warning"}>
            <p aria-live="polite">{online ? "可以重试打开目标页面；服务器状态仍需重新读取。" : "当前请求无法访问服务器，已打开的本地页面仍可按其能力继续工作。"}</p>
          </PublicFlowState>
        </section>

        <section className={styles.region} data-testid="offline-local">
          <h2>本地继续工作</h2>
          <p className={styles.muted}>已打开并解锁 Vault 的页面可以把受保护修改写入本机 IndexedDB 与 Outbox；认证恢复、成员权限更新和云端 AI 需要重新联网。</p>
          <p className={`${styles.notice} ${styles.noticeSuccess}`}>本地写入不代表云端成功。网络恢复后请在同步工作台确认 Outbox、附件和冲突。</p>
        </section>

        <section className={styles.region} data-testid="offline-recovery">
          <h2>恢复连接</h2>
          <div className={styles.actions}>
            <button className={styles.primaryLink} data-workbench-primary="true" type="button" onClick={() => window.location.reload()}>
              重试连接
            </button>
            <Link className={styles.secondaryLink} href="/app/sync?tab=conflict">打开同步与冲突</Link>
            <Link className={styles.secondaryLink} href="/">返回已缓存首页</Link>
          </div>
          <p className={styles.muted}>不要在未同步时清理站点数据或卸载 PWA。</p>
        </section>
      </div>
    </PublicFlowShell>
  );
}
