import { QueryClient } from "@tanstack/react-query";
import {
  browserApiClient,
  LogionApiError,
  type ApiRequestOptions,
} from "@/lib/api/client";

export function createWorkbenchQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, networkMode: "always" },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}
export function errorMessage(error: unknown): string {
  if (error instanceof LogionApiError) {
    if (error.code === "AI_ROUTE_TOKEN_LIMIT")
      return "所选内容或输出超过任务路由的额度，请减少来源或在设置中调整额度。";
    if (error.code.startsWith("AI_") && error.code.includes("BUDGET"))
      return "AI 预算不足，请在设置中调整额度。";
    if (error.code.startsWith("AI_") && /BLOCKED|DENIED/.test(error.code))
      return "AI 请求被隐私或出站安全规则拦截。";
    if (
      error.code.startsWith("AI_") &&
      /ROUTE|MODEL|PROVIDER|UNAVAILABLE/.test(error.code)
    )
      return "AI 服务商或任务路由不可用，请检查设置后重试。";
    const pdfErrors: Record<string, string> = {
      PLANNING_PHASE_REFERENCED: "阶段已有任务引用，可以归档，不能移除。",
      PLANNING_PHASE_MISSING: "请保留所有现有阶段，或明确选择归档、移除。",
      FEATURE_DISABLED: "当前服务器尚未开启这项功能。",
      WEEKLY_SNAPSHOT_STALE:
        "本周计划已变化，请刷新统计与任务快照，再逐项确认。",
      WEEKLY_TRIAGE_REQUIRED: "请为每个未完成项选择顺延、降级或放弃。",
      WEEKLY_REVIEW_CLOSED: "这周已确认，不能再修改；请查看下一周。",
      WEEKLY_TASK_LIMIT: "每周最多安排 200 项阅读任务。",
      WEEKLY_DOWNGRADE_INVALID: "只有精读任务可以降级为略读。",
      READING_CLOSE_READ_REQUIRED: "请先在文献中标记精读完成，再确认这项任务。",
      READING_TASK_COMPLETED: "请先将已完成任务重新安排，再编辑。",
      KNOWLEDGE_EDGE_EXISTS: "这条关系已存在或已被拒绝，不会重复建立。",
      KNOWLEDGE_EDGE_TERMINAL: "这条连线已处理，请刷新知识网。",
      READING_TRANSITION_INVALID:
        "请先开始阅读，再标记精读完成。已归档文献不会恢复同步。",
      NOTE_DOCUMENT_UPDATE_INVALID:
        "笔记更新无效或超过大小上限，当前输入仍在页面中。",
      NOTE_DOCUMENT_TOO_LARGE: "笔记超过允许的大小，请缩短内容。",
      AI_DRAFT_TERMINAL: "这份草稿已处理，请刷新草稿列表。",
      AI_DRAFT_SCHEMA_INVALID: "AI 输出格式不符合要求，请重新请求草稿或批改。",
      SOURCE_FILE_CHANGED: "附件已更新，请重新打开原文。",
      SOURCE_TEXT_NOT_FOUND: "全文尚未就绪，请打开原文后再试。",
      SOURCE_SELECTION_INVALID: "请选择有效的原文片段，最多 20,000 字符。",
      PDF_TOO_LARGE: "PDF 超过允许的大小，请选择更小的文件。",
      PDF_INVALID: "文件不是有效的 PDF。",
      PDF_ZIP_INVALID: "附件压缩包不符合安全要求，请检查 Zotero 附件。",
      PDF_HASH_MISMATCH: "远端文件与记录不一致，请重新导入。",
      PDF_REMOTE_UNAVAILABLE: "暂时无法取得原文，请检查坚果云连接和文件。",
      PDF_UPLOAD_FAILED: "原文未能保存到坚果云，请检查连接后重试。",
      PDF_LOCATOR_INVALID: "这篇文献没有可读取的 PDF，请先导入原文。",
      PDF_BUSY: "另一个 PDF 正在处理，请稍后重试。",
      PDF_NOT_PREPARED: "原文已更新或缓存已清理，请重新打开文献。",
      QUESTION_TREE_INVALID:
        "上级问题不能是自己或自己的子问题，问题层级最多 32 层。",
      QUESTION_MERGE_OVERLAP:
        "上级问题和它的子问题不能同时合并，请选择相互独立的问题。",
      WEBDAV_CONNECTION_REQUIRED: "请先在设置中连接坚果云并测试连接。",
      WEBDAV_RATE_LIMITED: "已达到坚果云请求频率上限，请稍后重试。",
      WEBDAV_RATE_UNAVAILABLE: "暂时无法确认请求额度，请稍后重试。",
    };
    const pdfMessage = pdfErrors[error.code];
    if (pdfMessage) return pdfMessage;
    if (error.code === "AUTH_RECENT_LOGIN_REQUIRED")
      return "请重新登录以确认身份，再继续操作。";
    if (error.code === "INTEGRATION_KEY_UNAVAILABLE")
      return "服务器尚未配置集成加密密钥，请联系维护者。";
    if (error.code === "ZOTERO_CONNECTION_TEST_REQUIRED")
      return "请先配置 Zotero 并测试连接，再同步文献。";
    if (error.code === "ZOTERO_RATE_LIMITED")
      return "Zotero 要求暂缓请求，请等待允许的继续时间。";
    if (error.code === "ZOTERO_COLLECTION_READ_ONLY")
      return "集合标签由 Zotero 管理，请在 Zotero 中修改。";
    if (error.code === "USER_SETTING_VERSION_CONFLICT")
      return "设置已在其他页面更新，请重新载入后再操作。";
    if (error.code === "RESOURCE_VERSION_CONFLICT")
      return "内容已在其他页面更新。当前输入已保留，请载入最新版本后再编辑。";
    if (error.code === "LIBRARY_DUPLICATE")
      return "这篇文献已在当前空间的个人文献库中，可以查看已有条目。";
    if (error.status === 422)
      return "请检查标识符、网址和日期的格式，再试一次。";
    if (error.status === 401) return "登录已过期，请重新登录。";
    if (error.status === 403)
      return "当前操作未获授权，请检查登录状态和访问权限。";
    if (error.status === 404) return "内容不存在或当前不可访问。";
    if (error.status === 429) return "操作过于频繁，请稍后重试。";
    if (error.code === "WEB_API_PATH_INVALID")
      return "请求路径无效，请重新加载页面。";
    if (error.status === 0)
      return "需要联网。请检查连接后重试，尚未保存的内容仍在当前页面。";
  }
  return "操作未完成，请重试。";
}
export async function workbenchRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new LogionApiError({
      code: "WEB_NETWORK_UNAVAILABLE",
      message: "需要联网",
      status: 0,
    });
  }
  try {
    return await browserApiClient.request<T>(path, {
      ...options,
      csrf: !["GET", "HEAD"].includes(options.method ?? "GET"),
    });
  } catch (error) {
    if (
      error instanceof LogionApiError &&
      error.status === 401 &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event("workbench:authentication-required"));
    }
    throw error;
  }
}
