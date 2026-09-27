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
    if (error.code === "USER_SETTING_VERSION_CONFLICT")
      return "设置已在其他页面更新，请重新载入后再操作。";
    if (error.code === "RESOURCE_VERSION_CONFLICT")
      return "文献已在其他页面更新。当前输入已保留，请载入最新版本后再编辑。";
    if (error.code === "LIBRARY_DUPLICATE")
      return "这篇文献已在当前空间的个人文献库中，可以查看已有条目。";
    if (error.status === 422)
      return "请检查标识符、网址和日期的格式，再试一次。";
    if (error.status === 401) return "登录已过期，请重新登录。";
    if (error.status === 403)
      return "当前操作未获授权，请检查登录状态和访问权限。";
    if (error.status === 404) return "内容不存在或当前不可访问。";
    if (error.status === 429) return "操作过于频繁，请稍后重试。";
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
