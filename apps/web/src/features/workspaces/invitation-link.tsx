"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./workspace-workbench.module.css";

export const INVITATION_PATH = "/invitations/accept";
export function invitationLoginHref(token: string) {
  return `/auth/login?next=${encodeURIComponent(INVITATION_PATH)}#token=${encodeURIComponent(token)}`;
}

export function InvitationLink({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    const link = new URL(INVITATION_PATH, window.location.origin);
    link.hash = `token=${encodeURIComponent(token)}`;
    queueMicrotask(() => setUrl(link.href));
  }, [token]);
  async function copy() {
    if (!url || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await navigator.clipboard.writeText(url);
      setStatus("邀请链接已复制，请仅发送给受邀者。");
    } catch {
      setStatus("复制失败，请手动选择并复制完整邀请链接。");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className={`${styles.invitationLink} ${styles.sheetForm}`}>
      <label>
        完整邀请链接
        <input
          aria-label="完整邀请链接"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        type="button"
        className="app-secondary-link"
        disabled={!url || pending}
        onClick={() => void copy()}
      >
        {pending ? "正在复制…" : "复制邀请链接"}
      </button>
      <p>
        链接仅在本次创建后显示，请及时复制；只能使用一次，到期或撤销后失效。
      </p>
      <p role="status">{status}</p>
    </div>
  );
}
