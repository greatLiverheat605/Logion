"use client";

import type { components } from "@logion/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { browserApiClient } from "@/lib/api/client";
import {
  PublicFlowHeader,
  PublicFlowShell,
  PublicFlowState,
} from "@/features/public-flows/public-flow-shell";

import styles from "@/features/public-flows/public-flow-workbench.module.css";

type PublicShare = components["schemas"]["PublicShareResponse"];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未知"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function SnapshotValue({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value)) {
    return value.length ? (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <SnapshotValue value={item} />
          </li>
        ))}
      </ul>
    ) : (
      "（空）"
    );
  }
  if (value !== null && typeof value === "object") {
    return (
      <div className={styles.snapshot}>
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div className={styles.snapshotRow} key={key}>
            <span className={styles.snapshotKey}>{key}</span>
            <div className={styles.snapshotValue}>
              <SnapshotValue value={item} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined || value === "")
    return "（未填写）";
  return String(value);
}

export function PublicShareView({ token }: { token: string }) {
  const [share, setShare] = useState<PublicShare | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApiClient
      .request<PublicShare>(`/api/v1/shares/${token}`)
      .then((value) => {
        if (!cancelled) {
          setShare(value);
          setFailed(false);
          setLoadedToken(token);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoadedToken(token);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pending = loadedToken !== token;

  if (failed && !pending) {
    return (
      <PublicFlowShell>
        <PublicFlowState
          icon="404"
          title="此分享不存在、已过期或已被撤销"
          tone="warning"
        >
          <p>公开读取统一返回 404，不泄露私有对象是否曾经存在。</p>
          <div className={styles.actions}>
            <Link className={styles.primaryLink} href="/">
              返回首页
            </Link>
          </div>
        </PublicFlowState>
      </PublicFlowShell>
    );
  }

  if (pending || !share) {
    return (
      <PublicFlowShell wide>
        <PublicFlowState icon="…" title="正在读取只读快照">
          <p>正在验证短期链接并加载不可变投影。页面不会写入任何对象。</p>
        </PublicFlowState>
      </PublicFlowShell>
    );
  }

  const snapshot = share.snapshot as unknown as Record<string, unknown>;
  return (
    <PublicFlowShell wide>
      <PublicFlowHeader
        eyebrow="READ-ONLY SHARE"
        title={share.title}
        description="短期、不可变的公开投影；页面不包含活动对象、ACL 或可写入口。"
      />
      <div className={styles.stack}>
        <section className={styles.region} data-testid="share-metadata">
          <div className={styles.actions}>
            <span className={styles.badge}>只读快照</span>
            <span className={styles.muted}>不可变投影</span>
          </div>
          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt>对象类型</dt>
              <dd>{share.object_type}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>到期时间</dt>
              <dd>{formatDate(share.expires_at)}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.region} data-testid="share-snapshot">
          <h2>快照内容</h2>
          <div className={styles.snapshot}>
            {Object.entries(snapshot).map(([key, value]) => (
              <div className={styles.snapshotRow} key={key}>
                <span className={styles.snapshotKey}>{key}</span>
                <div className={styles.snapshotValue}>
                  <SnapshotValue value={value} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.region} data-testid="share-state">
          <p className={styles.notice}>
            快照创建后不可变更；链接到期或被撤销后统一不可访问。高熵 Token
            只在创建时返回一次。
          </p>
          <p className={styles.subtleCode}>
            metadata: no-referrer · noindex, nofollow
          </p>
          <nav aria-label="分享恢复" className={styles.linkRow}>
            <Link href="/">返回首页</Link>
            <Link href="/auth/login">登录 Logion</Link>
          </nav>
        </section>
      </div>
    </PublicFlowShell>
  );
}
