"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "@/platform/workbench/provider";
import { workbenchRequest, errorMessage } from "@/platform/workbench/api";
import { Button, Segmented, Sheet } from "@/platform/workbench/components";
import "./settings.css";

type Space =
  | components["schemas"]["ManagedSpace"]
  | components["schemas"]["DeletedSpace"];
type Page = { spaces: Space[]; next_cursor: string | null };
type Filter = "all" | "active" | "archived" | "deleted";
type Action = "archive" | "activate" | "delete" | "restore";
const actionLabels: Record<Action, string> = {
  archive: "归档",
  activate: "恢复",
  delete: "删除",
  restore: "恢复为已归档",
};
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
          <p>管理使用中、已归档和已删除的空间。</p>
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
  const [confirmation, setConfirmation] = useState<{
    space: Space;
    action: Action;
  } | null>(null);
  const [deleteText, setDeleteText] = useState("");
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
      if (filter !== "all" && filter !== "deleted") query.status = filter;
      if (pageParam) query.cursor = pageParam;
      return workbenchRequest<Page>(
        filter === "deleted" ? `${url}/deleted` : url,
        { signal, query },
      );
    },
    getNextPageParam: (page) => page.next_cursor,
  });
  const rows = spaces.data?.pages.flatMap((page) => page.spaces) ?? [];
  function confirm(space: Space, action: Action, control: HTMLElement) {
    trigger.current = control;
    setDeleteText("");
    setFailure("");
    setStatus("");
    setConfirmation({ space, action });
  }
  async function change() {
    if (
      !confirmation ||
      writing.current ||
      (confirmation.action === "delete" && deleteText !== "删除")
    )
      return;
    writing.current = true;
    setPending(true);
    setFailure("");
    setStatus("");
    try {
      const { space, action } = confirmation;
      const deleting = action === "delete" || action === "restore";
      await workbenchRequest(
        `${url}/${space.id}/${deleting ? "deletion" : "archive"}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            deleting
              ? {
                  expected_version: space.version,
                  action,
                  confirmation:
                    action === "delete" ? "DELETE SPACE" : "RESTORE SPACE",
                }
              : {
                  expected_version: space.version,
                  status: action === "archive" ? "archived" : "active",
                },
          ),
        },
      );
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
        {
          archive: "空间已归档，内容保留，可随时恢复。",
          activate: "空间已恢复，可以继续阅读与编辑。",
          delete: "空间已删除，内容保留，可在已删除列表中持续恢复。",
          restore: "空间已恢复为已归档；可切换到已归档列表，再恢复使用。",
        }[action],
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
          旧设备下次同步需要重新获取快照；未同步修改仍保留，请先同步其他设备，遇到冲突时由你处理。删除不会清除已下载的副本。
        </p>
        <p>
          软删除可持续恢复，没有自动清理期限。删除前请先导出；已删除空间不在数据导出中，恢复后先保持已归档。
        </p>
        <Segmented
          label="空间状态"
          value={filter}
          options={[
            { id: "all", label: "未删除" },
            { id: "active", label: "使用中" },
            { id: "archived", label: "已归档" },
            { id: "deleted", label: "已删除" },
          ]}
          onChange={(value) => {
            if (!pending) setFilter(value as Filter);
          }}
        />
        {status && <p role="status">{status}</p>}
        {spaces.isPending && <p role="status">正在读取空间…</p>}
        {spaces.error && <p role="alert">{errorMessage(spaces.error)}</p>}
        {!spaces.isPending && !spaces.error && rows.length === 0 && (
          <p>这里没有空间。可以切换状态查看已归档或已删除的空间并恢复。</p>
        )}
        <ul className="wb-config-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{spaceName(row)}</strong>
                <p>
                  {row.visibility === "private" ? "私人" : "共享"} ·{" "}
                  {row.status === "active"
                    ? "使用中"
                    : row.status === "archived"
                      ? "已归档"
                      : "已删除 · 持续可恢复"}
                </p>
              </div>
              {row.can_manage ? (
                <div className="wb-space-actions">
                  <Button
                    disabled={pending || spaces.isFetching}
                    aria-label={`${row.status === "active" ? "归档" : row.status === "deleted" ? "恢复已删除" : "恢复"}空间：${spaceName(row)}`}
                    onClick={(event) =>
                      confirm(
                        row,
                        row.status === "active"
                          ? "archive"
                          : row.status === "deleted"
                            ? "restore"
                            : "activate",
                        event.currentTarget,
                      )
                    }
                  >
                    {row.status === "active"
                      ? "归档"
                      : row.status === "deleted"
                        ? "恢复为已归档"
                        : "恢复"}
                  </Button>
                  {row.status !== "deleted" && (
                    <details className="wb-space-more">
                      <summary aria-label={`更多空间操作：${spaceName(row)}`}>
                        更多
                      </summary>
                      <Button
                        disabled={pending}
                        onClick={(event) => {
                          const menu = event.currentTarget.closest("details")!;
                          confirm(
                            row,
                            "delete",
                            menu.querySelector("summary")!,
                          );
                          menu.open = false;
                        }}
                        aria-label={`删除空间：${spaceName(row)}`}
                      >
                        删除空间
                      </Button>
                    </details>
                  )}
                </div>
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
          confirmation
            ? `确认${actionLabels[confirmation.action]}空间`
            : "确认空间操作"
        }
        description={confirmation ? spaceName(confirmation.space) : ""}
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
            {confirmation?.action === "delete"
              ? "删除会隐藏整个空间，所有成员暂时无法读取、编辑或导出其中内容。原内容保留，可持续恢复，没有自动清理期限；恢复后先进入已归档。"
              : confirmation?.action === "restore"
                ? "恢复后先进入已归档列表，内容重新纳入授权的数据导出；需要阅读和编辑时，请再选择恢复使用。不会复活此前单独删除的内容。"
                : confirmation?.action === "archive"
                  ? "归档会暂时隐藏整个空间，已有内容保留。共享空间的其他成员也将无法访问，恢复后继续使用。"
                  : "恢复后，原来有权限的成员可以重新访问空间及其已有内容。"}
          </p>
          {confirmation?.action === "delete" && (
            <>
              <p>
                请先导出需要保留的资料，再确认删除。
                <Link href="/settings/data">前往数据导出</Link>
              </p>
              <label>
                输入“删除”以确认
                <input
                  value={deleteText}
                  onChange={(event) => setDeleteText(event.target.value)}
                  disabled={pending}
                  autoComplete="off"
                />
              </label>
            </>
          )}
          {failure && <p role="alert">{failure}</p>}
          <div className="wb-config-actions">
            <Button
              ref={cancel}
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              取消
            </Button>
            <Button
              disabled={
                pending ||
                (confirmation?.action === "delete" && deleteText !== "删除")
              }
              onClick={() => void change()}
            >
              {pending
                ? "正在处理…"
                : confirmation
                  ? `确认${actionLabels[confirmation.action]}`
                  : "确认"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
