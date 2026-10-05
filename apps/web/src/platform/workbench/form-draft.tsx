"use client";

import type { components } from "@logion/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LogionApiError } from "@/lib/api/client";
import { errorMessage, workbenchRequest } from "./api";
import { Button } from "./components";

type Draft = components["schemas"]["DraftView"];
type Fields = Record<string, string>;
type State = {
  status:
    | "loading"
    | "idle"
    | "pending"
    | "saving"
    | "saved"
    | "offered"
    | "error";
  remote: Draft | null;
  error: string;
  busy: boolean;
};
const NEW_TARGET = "00000000-0000-0000-0000-000000000000";

// Only the fields explicitly supplied by a form enter this memory-only controller.
export class FormDraftController {
  private listeners = new Set<() => void>();
  private state: State = {
    status: "loading",
    remote: null,
    error: "",
    busy: false,
  };
  private fields: Fields = {};
  private saved = "";
  private initialized = false;
  private loaded = false;
  private active = false;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private loading: Promise<void> | undefined;
  private submitting = false;
  private submitted = false;
  private conflicted = false;
  constructor(private path: string | null) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(value: Partial<State>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private cancel() {
    clearTimeout(this.timer);
  }
  start() {
    this.active = true;
    this.loading = this.load();
  }
  stop() {
    this.active = false;
    this.epoch++;
    this.cancel();
  }
  private failure(error: unknown) {
    this.conflicted =
      error instanceof LogionApiError && error.code === "FORM_DRAFT_CONFLICT";
    this.set({
      status: "error",
      error:
        error instanceof Error && !(error instanceof LogionApiError)
          ? error.message
          : errorMessage(error),
    });
  }
  private async load() {
    if (!this.path) {
      this.loaded = true;
      this.set({ status: "idle" });
      return;
    }
    const epoch = ++this.epoch;
    try {
      const { draft } = await workbenchRequest<{ draft: Draft | null }>(
        this.path,
      );
      if (!this.active || epoch !== this.epoch) return;
      this.loaded = true;
      this.set({
        remote: draft,
        status: draft ? "offered" : "idle",
        error: "",
      });
      this.schedule();
    } catch (error) {
      if (this.active && epoch === this.epoch) this.failure(error);
    }
  }
  change(fields: Fields) {
    const text = JSON.stringify(fields);
    if (!this.initialized || this.submitted) {
      this.saved = text;
      this.initialized = true;
      this.submitted = false;
    }
    const changed = text !== JSON.stringify(this.fields);
    this.fields = { ...fields };
    if (changed) this.schedule();
  }
  private schedule() {
    this.cancel();
    if (
      !this.path ||
      !this.active ||
      !this.loaded ||
      this.submitting ||
      this.pending ||
      this.state.status === "offered" ||
      this.state.status === "error" ||
      JSON.stringify(this.fields) === this.saved
    )
      return;
    this.set({ status: "pending" });
    this.timer = setTimeout(() => {
      void this.save().catch(() => {});
    }, 2000);
  }
  private async save() {
    if (!this.path || !this.active) return;
    if (this.pending) await this.pending;
    if (JSON.stringify(this.fields) === this.saved) return;
    const fields = { ...this.fields };
    const remote = this.state.remote;
    this.set({ status: "saving", error: "" });
    const work = (async () => {
      try {
        const { draft } = await workbenchRequest<{ draft: Draft }>(this.path!, {
          method: "PUT",
          body: JSON.stringify({
            fields,
            expected_version: remote?.version ?? 0,
            expected_id: remote?.id ?? null,
          }),
        });
        this.saved = JSON.stringify(fields);
        this.set({ remote: draft, status: "saved" });
      } catch (error) {
        this.failure(error);
        throw error;
      }
    })();
    this.pending = work;
    try {
      await work;
    } finally {
      this.pending = undefined;
      this.schedule();
    }
  }
  retry = async () => {
    this.cancel();
    if (this.pending || this.submitting) return;
    // Re-read before another write: an uncertain network outcome may have committed.
    this.set({ status: "loading", error: "" });
    this.loading = this.load();
    await this.loading;
  };
  restore(apply: (fields: Fields) => void) {
    const remote = this.state.remote;
    if (!remote || this.state.status !== "offered") return;
    try {
      apply(remote.fields);
      this.fields = { ...remote.fields };
      this.saved = JSON.stringify(remote.fields);
      this.conflicted = false;
      this.set({ status: "saved", error: "" });
    } catch {
      this.set({
        error: "这份草稿与当前表单不匹配，请保留本页内容或丢弃草稿。",
      });
    }
  }
  keepLocal = () => {
    this.conflicted = false;
    this.saved = JSON.stringify(this.state.remote?.fields ?? {});
    this.set({ status: "idle", error: "" });
    this.schedule();
  };
  discard = async () => {
    this.cancel();
    if (this.submitting) return;
    this.submitting = true;
    this.set({ busy: true });
    try {
      await this.loading;
      await this.pending;
      const remote = this.state.remote;
      if (remote && this.path)
        await workbenchRequest(this.path, {
          method: "DELETE",
          query: {
            expected_version: String(remote.version),
            expected_id: remote.id,
          },
        });
      this.saved = JSON.stringify(this.fields);
      this.set({ remote: null, status: "idle", error: "" });
    } catch (error) {
      this.failure(error);
    } finally {
      this.submitting = false;
      this.set({ busy: false });
    }
  };
  async flush() {
    this.cancel();
    await this.loading;
    await this.pending;
    if (
      !this.active ||
      !this.loaded ||
      this.state.status === "error" ||
      this.state.status === "offered"
    )
      throw new Error("请先处理草稿提示，再继续；当前输入仍在页面中。");
    await this.save();
  }
  async submit<T>(
    action: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    if (this.submitting) throw new Error("正在处理，请稍候。");
    this.cancel();
    this.submitting = true;
    this.set({ busy: true });
    try {
      await this.loading;
      await this.pending;
      if (this.state.status === "error" && !this.conflicted) {
        const known = this.state.remote;
        await this.load();
        const latest = this.state.remote;
        // Explicit submission retries a failed connection, never a newer remote edit.
        if (
          this.snapshot().status === "offered" &&
          latest &&
          ((known &&
            latest.id === known.id &&
            latest.version === known.version) ||
            JSON.stringify(latest.fields) === JSON.stringify(this.fields))
        ) {
          this.saved = JSON.stringify(latest.fields);
          this.set({ status: "idle" });
        }
      }
      if (
        !this.active ||
        !this.loaded ||
        this.state.status === "error" ||
        this.state.status === "offered"
      )
        throw new Error("请先处理草稿提示，再提交表单；当前输入仍在页面中。");
      await this.save();
      const remote = this.state.remote;
      const result = await action(
        remote
          ? { "X-Logion-Form-Draft": `${remote.id}:${remote.version}` }
          : {},
      );
      this.saved = JSON.stringify(this.fields);
      this.submitted = true;
      this.set({ remote: null, status: "idle", error: "" });
      return result;
    } catch (error) {
      if (
        error instanceof LogionApiError &&
        error.code === "FORM_DRAFT_CONFLICT"
      )
        this.failure(error);
      throw error;
    } finally {
      this.submitting = false;
      this.set({ busy: false });
    }
  }
}

export function draftScope(path: string) {
  const scope = path.match(/^\/api\/v1\/workspaces\/[^/]+\/spaces\/[^/]+/);
  if (!scope) throw new Error("Invalid draft scope");
  return scope[0];
}

export function useFormDraft({
  scope,
  kind,
  target,
  fields,
  restore,
  enabled = true,
}: {
  scope: string;
  kind: Draft["form_kind"];
  target?: string;
  fields: Fields;
  restore: (fields: Fields) => void;
  enabled?: boolean;
}) {
  const path = enabled
    ? `${draftScope(scope)}/research/form-drafts/${kind}/${encodeURIComponent(target ?? NEW_TARGET)}`
    : null;
  const controller = useMemo(() => new FormDraftController(path), [path]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const text = JSON.stringify(fields);
  useEffect(() => {
    controller.change(JSON.parse(text) as Fields);
  }, [controller, text]);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    if (!["pending", "saving", "error"].includes(state.status)) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.status]);
  return {
    state,
    controller,
    restore: () => controller.restore(restore),
    submit: <T,>(action: (headers: Record<string, string>) => Promise<T>) => {
      controller.change(fields);
      return controller.submit(action);
    },
  };
}

export function DraftNotice({
  draft,
}: {
  draft: ReturnType<typeof useFormDraft>;
}) {
  const { state, controller } = draft;
  return (
    <aside className="wb-form-draft" aria-label="私人表单草稿">
      <p role="status">
        {
          {
            loading: "正在检查私人草稿…",
            idle: "长文本草稿仅自己可见，保留 7 天；退出登录时清除。",
            pending: "正文已修改，尚未保存草稿。",
            saving: "正在保存私人草稿…",
            saved: "私人草稿已保存。",
            offered: "发现此表单的私人草稿。恢复会替换本页长文本。",
            error: "草稿未保存，当前输入仍在页面中。",
          }[state.status]
        }
      </p>
      {state.remote && (
        <p>
          恢复仅覆盖长文本；请在提交前重新确认标题、日期、目标选择和处理动作等其他字段。
        </p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      <div className="wb-research-actions">
        {state.status === "offered" && (
          <>
            <Button disabled={state.busy} onClick={draft.restore}>
              恢复草稿
            </Button>
            <Button disabled={state.busy} onClick={controller.keepLocal}>
              保留本页长文本
            </Button>
          </>
        )}
        {state.status === "error" && (
          <Button disabled={state.busy} onClick={() => void controller.retry()}>
            重新检查草稿
          </Button>
        )}
        {state.remote && (
          <Button
            disabled={state.busy || state.status === "saving"}
            onClick={() => void controller.discard()}
          >
            丢弃服务器草稿
          </Button>
        )}
      </div>
    </aside>
  );
}
