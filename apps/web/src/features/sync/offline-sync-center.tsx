"use client";

import { useEffect, useState } from "react";

type ConnectionState = "offline" | "online";

function currentConnection(): ConnectionState {
  return navigator.onLine ? "online" : "offline";
}

export function OfflineSyncCenter() {
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [vaultLocked, setVaultLocked] = useState(true);

  useEffect(() => {
    const update = () => setConnection(currentConnection());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <section aria-label="同步状态" className="sync-grid">
      <article className="settings-card sync-status-card">
        <div>
          <p className="eyebrow">Connection</p>
          <h2>{connection === "online" ? "已连接" : "离线工作中"}</h2>
        </div>
        <span
          className={`status-orb status-${connection}`}
          aria-hidden="true"
        />
        <p aria-live="polite">
          {connection === "online"
            ? "可以安全推送本地 Outbox 并拉取远端更新。"
            : "编辑会保存在本机，恢复网络后按依赖顺序同步。"}
        </p>
      </article>

      <article className="settings-card">
        <p className="eyebrow">Local vault</p>
        <h2>{vaultLocked ? "本地资料已锁定" : "本地资料已解锁"}</h2>
        <p>密钥只保留在当前页面内存；关闭页面、退出或撤销设备后会再次锁定。</p>
        <button type="button" onClick={() => setVaultLocked((value) => !value)}>
          {vaultLocked ? "演示解锁状态" : "立即锁定"}
        </button>
      </article>

      <article className="settings-card sync-wide-card">
        <div className="sync-card-heading">
          <div>
            <p className="eyebrow">Review queue</p>
            <h2>待处理冲突</h2>
          </div>
          <span className="count-badge">0</span>
        </div>
        <div className="empty-state">
          <p>目前没有需要人工选择的冲突。</p>
          <small>
            发生冲突时，这里会并排保留本地与远端版本及可用解决方式。
          </small>
        </div>
      </article>

      <article className="settings-card sync-wide-card">
        <div className="sync-card-heading">
          <div>
            <p className="eyebrow">Attachments</p>
            <h2>附件上传队列</h2>
          </div>
          <span className="count-badge">0</span>
        </div>
        <div className="empty-state">
          <p>没有等待上传的附件。</p>
          <small>离线添加的截图和实验结果会先校验格式、大小与 SHA-256。</small>
        </div>
      </article>

      <aside className="residual-data-warning sync-wide-card" role="note">
        <strong>共享设备提示：</strong>
        退出账号不会自动承诺清除浏览器中的全部离线副本。
        在公共设备上请使用“清除此设备数据”；设备被撤销后，本地库会保持锁定，直到明确清除。
      </aside>
    </section>
  );
}
