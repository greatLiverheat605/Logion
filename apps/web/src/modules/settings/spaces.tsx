"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "@/platform/workbench/provider";
import { workbenchRequest, errorMessage } from "@/platform/workbench/api";
import { Button, Segmented, Sheet } from "@/platform/workbench/components";
import "./settings.css";

type Space = components["schemas"]["ManagedSpace"];
type Page = components["schemas"]["ManagedSpacePage"];
type Filter = "all" | "active" | "archived";
const spaceName = (row: Space) =>
  row.name === "Private" && row.visibility === "private"
    ? "私人空间"
    : row.name;

export function SpaceSettings() {
  const { workspaces, context, preferences } = useWorkbench();
  const [selected, setSelected] = useState("");
  const workspace =
    workspaces.find((row) => row.id === selected) ??
    workspaces.find(
      (row) =>
        row.id ===
        (context?.workspace_id ??
          preferences["workbench.context"]?.workspace_id),
    ) ??
    workspaces[0];
  return (
    <div className="wb-page wb-config-page wb-space-settings">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>空间管理</h1>
          <p>归档暂时不用的空间，需要时可以恢复。</p>
        </div>
      </div>
      <label className="wb-space-workspace">
        管理工作区
        <select
          value={workspace?.id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {workspaces.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name === "Personal workspace" ? "个人工作区" : row.name}
            </option>
          ))}
        </select>
      </label>
      {workspace ? (
        <Spaces key={workspace.id} workspaceId={workspace.id} />
      ) : (
        <p>当前没有可访问的工作区。</p>
      )}
    </div>
  );
}

function Spaces({ workspaceId }: { workspaceId: string }) {
  const queries = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmation, setConfirmation] = useState<Space | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const refresh = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const writing = useRef(false);
  const url = `/api/v1/workspaces/${workspaceId}/research/spaces`;
  const spaces = useInfiniteQuery({
    queryKey: ["workbench", "managed-spaces", workspaceId, filter],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const query: Record<string, string> = { limit: "50" };
      if (filter !== "all") query.status = filter;
      if (pageParam) query.cursor = pageParam;
      return workbenchRequest<Page>(url, { signal, query });
    },
    getNextPageParam: (page) => page.next_cursor,
  });
  const rows = spaces.data?.pages.flatMap((page) => page.spaces) ?? [];
  async function change() {
    if (!confirmation || writing.current) return;
    writing.current = true;
    setPending(true);
    setFailure("");
    setStatus("");
    try {
      const next = confirmation.status === "active" ? "archived" : "active";
      await workbenchRequest(`${url}/${confirmation.id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: confirmation.version,
          status: next,
        }),
      });
      await Promise.all([
        queries.invalidateQueries({
          queryKey: ["workbench", "managed-spaces", workspaceId],
        }),
        queries.invalidateQueries({
          queryKey: ["workbench", "spaces", workspaceId],
        }),
      ]);
      setConfirmation(null);
      setStatus(
        next === "archived"
          ? "空间已归档，内容保留，可随时恢复。"
          : "空间已恢复，可以继续阅读与编辑。",
      );
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      writing.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <section className="wb-config-section" aria-label="空间列表">
        <header>
          <h2>空间</h2>
          <Button
            ref={refresh}
            disabled={pending || spaces.isFetching}
            onClick={() => void spaces.refetch()}
          >
            刷新空间
          </Button>
        </header>
        <p>
          归档后，空间会从日常列表中隐藏，内容仍保留在数据导出中。已经发出的请求可能仍会完成。
        </p>
        <p>
          旧设备下次同步需要重新获取快照；未同步修改仍保留，请先同步其他设备，遇到冲突时由你处理。
        </p>
        <Segmented
          label="空间状态"
          value={filter}
          options={[
            { id: "all", label: "全部" },
            { id: "active", label: "使用中" },
            { id: "archived", label: "已归档" },
          ]}
          onChange={(value) => {
            if (!pending) setFilter(value as Filter);
          }}
        />
        {status && <p role="status">{status}</p>}
        {spaces.isPending && <p role="status">正在读取空间…</p>}
        {spaces.error && <p role="alert">{errorMessage(spaces.error)}</p>}
        {!spaces.isPending && !spaces.error && rows.length === 0 && (
          <p>这里没有空间。可以切换状态查看已归档空间并恢复。</p>
        )}
        <ul className="wb-config-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{spaceName(row)}</strong>
                <p>
                  {row.visibility === "private" ? "私人" : "共享"} ·{" "}
                  {row.status === "active" ? "使用中" : "已归档"}
                </p>
              </div>
              {row.can_manage ? (
                <Button
                  disabled={pending}
                  aria-label={`${row.status === "active" ? "归档" : "恢复"}空间：${spaceName(row)}`}
                  onClick={() => {
                    trigger.current =
                      document.activeElement instanceof HTMLElement
                        ? document.activeElement
                        : null;
                    setFailure("");
                    setStatus("");
                    setConfirmation(row);
                  }}
                >
                  {row.status === "active" ? "归档" : "恢复"}
                </Button>
              ) : (
                <span>仅所有者或管理员可管理</span>
              )}
            </li>
          ))}
        </ul>
        {spaces.hasNextPage && (
          <Button
            disabled={spaces.isFetching || pending}
            onClick={() => void spaces.fetchNextPage()}
          >
            加载更多空间
          </Button>
        )}
        <Link href="/settings/data">前往数据导出</Link>
      </section>
      <Sheet
        title={
          confirmation?.status === "active" ? "确认归档空间" : "确认恢复空间"
        }
        description={confirmation ? spaceName(confirmation) : ""}
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null);
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (trigger.current?.isConnected
            ? trigger.current
            : refresh.current
          )?.focus();
        }}
      >
        <div className="wb-config-form">
          <p>
            {confirmation?.status === "active"
              ? "归档会暂时隐藏整个空间，已有内容保留。共享空间的其他成员也将无法访问，恢复后继续使用。"
              : "恢复后，原来有权限的成员可以重新访问空间及其已有内容。"}
          </p>
          {failure && <p role="alert">{failure}</p>}
          <div className="wb-config-actions">
            <Button
              ref={cancel}
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              取消
            </Button>
            <Button disabled={pending} onClick={() => void change()}>
              {pending
                ? "正在处理…"
                : confirmation?.status === "active"
                  ? "确认归档"
                  : "确认恢复"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
