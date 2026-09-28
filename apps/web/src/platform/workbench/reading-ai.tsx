"use client";

import { useQuery } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { errorMessage, workbenchRequest } from "./api";

type Run = components["schemas"]["AIRunResponse"];
type Draft = components["schemas"]["AIOutputDraftResponse"];
export const readingAiError = (code: string | null) => {
  if (code === "AI_DRAFT_SCHEMA_INVALID")
    return "AI 输出格式无效，请重新请求。";
  if (code === "RESOURCE_VERSION_CONFLICT")
    return "内容已更新，请载入最新作答后重试。";
  if (code?.includes("BUDGET")) return "AI 预算不足，请在设置中调整额度。";
  if (code?.includes("BLOCKED") || code?.includes("DENIED"))
    return "请求被隐私或出站安全规则拦截。请检查所选上下文与服务商设置。";
  if (code?.includes("ROUTE") || code?.includes("MODEL"))
    return "尚未配置可用的任务档位，请先在设置中配置模型路由。";
  return "AI 服务商暂时不可用，请稍后重试。";
};

export function ReadingAiResult({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const query = useQuery({
    queryKey: ["workbench", "research-ai", workspaceId, runId],
    queryFn: () =>
      workbenchRequest<{ run: Run; draft: Draft | null }>(
        `/api/v1/workspaces/${workspaceId}/research/ai/runs/${runId}`,
      ),
    refetchInterval: (current) =>
      current.state.error
        ? false
        : ["queued", "running"].includes(
              current.state.data?.run.status ?? "queued",
            )
          ? 1000
          : false,
  });
  if (query.error) return <p role="alert">{errorMessage(query.error)}</p>;
  if (!query.data || ["queued", "running"].includes(query.data.run.status))
    return <p role="status">AI 正在处理…</p>;
  if (query.data.run.status !== "succeeded")
    return <p role="alert">{readingAiError(query.data.run.error_code)}</p>;
  return (
    <section aria-label="AI 阅读草稿">
      <p className="wb-muted">AI 草稿 · 请结合原文核实</p>
      {Object.entries(query.data.draft?.structured_output ?? {}).map(
        ([field, value]) => (
          <p className="wb-reading-output" key={field}>
            {value}
          </p>
        ),
      )}
    </section>
  );
}
