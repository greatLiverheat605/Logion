"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { Button } from "./components";
import { presetLayout, type WorkbenchContext } from "./preferences";
import { MASTERY_LABELS } from "./reading-quiz";

type Page = components["schemas"]["ReadingReviewPage"];
export function ReadingReview() {
  const { context } = useWorkbench();
  return context ? (
    <ReviewScope
      key={`${context.workspace_id}/${context.space_id}`}
      context={context}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}
function ReviewScope({ context }: { context: WorkbenchContext }) {
  const { save } = useWorkbench();
  const router = useRouter();
  const [due, setDue] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const query = useInfiniteQuery({
    queryKey: [
      "workbench",
      "reading-review",
      context.workspace_id,
      context.space_id,
      due,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      workbenchRequest<Page>(
        `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/review`,
        {
          query: {
            due_only: String(due),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  return (
    <div className="wb-reading-panel wb-review-page">
      <h1>阅读复习</h1>
      <p className="wb-muted">
        这里是你本人确认后安排的文献测验。重新作答、结合证据确认，会更新下一次复习时间。
      </p>
      <label>
        <input
          type="checkbox"
          checked={due}
          onChange={(e) => setDue(e.target.checked)}
        />
        只看已到期
      </label>
      {(error || query.error) && (
        <p role="alert">{errorMessage(error || query.error)}</p>
      )}
      {query.isPending ? (
        <p role="status">正在加载复习…</p>
      ) : query.data?.pages[0]?.items.length === 0 ? (
        <p>
          暂无{due ? "到期" : "已安排的"}
          阅读复习。在阅读器完成测验并确认掌握程度后，会出现在这里。
        </p>
      ) : (
        <ul className="wb-review-list">
          {query.data?.pages
            .flatMap((p) => p.items)
            .map((item) => (
              <li key={item.id}>
                <h2>{item.concept}</h2>
                <p>{item.resource_title}</p>
                <p className="wb-muted">
                  {MASTERY_LABELS[item.confirmed_level]} · 复习日期{" "}
                  {new Date(item.next_review_at).toLocaleDateString()}
                </p>
                <Button
                  disabled={opening}
                  onClick={() => {
                    setOpening(true);
                    setError(null);
                    void save("workbench.layouts", presetLayout("quiz"))
                      .then(() =>
                        router.push(
                          `/read/${item.resource_id}?quiz=${item.quiz_item_id}`,
                        ),
                      )
                      .catch(setError)
                      .finally(() => setOpening(false));
                  }}
                >
                  回到原文作答
                </Button>
              </li>
            ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多
        </Button>
      )}
    </div>
  );
}
