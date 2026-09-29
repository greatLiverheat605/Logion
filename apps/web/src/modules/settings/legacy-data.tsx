"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/features/auth/session-provider";
import { createAuthApi } from "@/features/auth/session";
import { browserApiClient } from "@/lib/api/client";
import { Button, Sheet } from "@/platform/workbench/components";
import { checkedDestination } from "@/platform/workbench/legacy-routes";
import { countLegacyOutbox, clearLegacyData } from "./legacy-storage";
import "./settings.css";

const auth = createAuthApi(browserApiClient);
const failureText = (error: unknown) =>
  error instanceof Error &&
  !(error instanceof DOMException) &&
  !(error instanceof ReferenceError)
    ? error.message
    : "无法访问本机旧数据，请检查浏览器存储权限。";

export function LegacyData({ check = false }: { check?: boolean }) {
  const { state } = useSession();
  const params = useSearchParams();
  if (state.status !== "authenticated") return null;
  return (
    <AccountLegacyData
      key={state.user.id}
      userId={state.user.id}
      check={check}
      destination={checkedDestination(params.get("next"))}
    />
  );
}

function AccountLegacyData({
  userId,
  check,
  destination,
}: {
  userId: string;
  check: boolean;
  destination: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在检查本机旧队列…");
  const [confirmation, setConfirmation] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const deleting = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    void countLegacyOutbox(userId)
      .then((value) => {
        if (!active) return;
        setCount(value);
        setStatus(`本机旧队列：${value} 条。`);
        if (check && value === 0) window.location.replace(destination);
      })
      .catch((failure: unknown) => {
        if (active) {
          setStatus("");
          setError(failureText(failure));
        }
      });
    return () => {
      active = false;
    };
  }, [userId, attempt, check, destination]);
  useEffect(() => {
    if (!pending) return;
    const prevent = (event: Event) => event.preventDefault();
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("workbench:before-navigate", prevent);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("workbench:before-navigate", prevent);
      window.removeEventListener("beforeunload", unload);
    };
  }, [pending]);
  async function clear() {
    if (!confirmation || !accepted || deleting.current) return;
    deleting.current = true;
    setPending(true);
    setError("");
    setStatus("正在清除本机旧数据…");
    try {
      const current = await auth.current();
      if (
        current.user.id !== userId ||
        current.user.status === "pending_deletion"
      )
        throw new Error("登录账户已变化，请重新打开本页确认。未清除旧数据。");
      await clearLegacyData(userId, () =>
        setStatus(
          "清除尚未完成。请关闭其他使用旧数据的标签页；关闭后会继续完成已确认的清除。",
        ),
      );
      setCount(0);
      setStatus(
        "本账户在当前浏览器的旧数据已清除。服务器数据、其他账户和登录状态保持不变。",
      );
      setConfirmation(false);
    } catch (failure) {
      setStatus("");
      setError(failureText(failure));
    } finally {
      deleting.current = false;
      setPending(false);
    }
  }
  return (
    <div className="wb-page wb-config-page wb-legacy-data">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>{check ? "旧数据检查" : "本机旧数据"}</h1>
          <p>只统计当前账户在这个浏览器的旧离线队列，不读取或解密正文。</p>
        </div>
      </div>
      <section className="wb-config-section" aria-label="旧队列检查">
        <h2>迁移前检查</h2>
        {status && !pending && <p role="status">{status}</p>}
        {error && !confirmation && <p role="alert">{error}</p>}
        {count !== null && count > 0 && (
          <p>
            仍有 {count}{" "}
            条旧队列记录，请先进入旧版同步，解锁并处理同步或冲突，然后回来重新检查。
          </p>
        )}
        <p>
          队列为空不代表所有附件或本机草稿已经备份。清除前，请在旧版核对并保留需要的内容。
        </p>
        <div className="wb-config-actions">
          <a className="wb-button" href="/app/sync?legacy=sync">
            进入旧版同步
          </a>
          <Button
            disabled={pending}
            onClick={() => {
              setCount(null);
              setError("");
              setStatus("正在检查本机旧队列…");
              setAttempt((value) => value + 1);
            }}
          >
            重新检查
          </Button>
        </div>
      </section>
      {!check && (
        <section className="wb-config-section" aria-label="清理本机旧数据">
          <h2>清除本机旧数据</h2>
          <p>
            仅清除本账户在当前浏览器保存的旧离线副本、队列、附件和草稿。尚未同步的内容会永久丢失，无法撤销；服务器数据不变。
          </p>
          <Button
            ref={trigger}
            disabled={pending}
            onClick={() => {
              setAccepted(false);
              setError("");
              setConfirmation(true);
            }}
          >
            清除本机旧数据
          </Button>
        </section>
      )}
      <Sheet
        title="确认清除本机旧数据"
        description="此操作无法撤销。请先同步或另行保留需要的内容。"
        open={confirmation}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(false);
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <div className="wb-config-form">
          <p>
            {count === null
              ? "当前无法确认旧队列数量。"
              : `最近检查到旧队列 ${count} 条；其他标签页可能继续产生修改。`}
          </p>
          <label className="wb-config-check">
            <input
              type="checkbox"
              checked={accepted}
              disabled={pending}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            我已保留需要的内容，并接受未同步内容永久丢失
          </label>
          {pending && <p role="status">{status}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="wb-config-actions">
            <Button
              ref={cancel}
              disabled={pending}
              onClick={() => setConfirmation(false)}
            >
              取消
            </Button>
            <Button
              disabled={!accepted || pending}
              onClick={() => void clear()}
            >
              {pending ? "正在处理…" : "确认清除"}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
