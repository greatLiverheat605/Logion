"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { Button } from "./components";
import { errorMessage, workbenchRequest } from "./api";
import { READING_STATUSES } from "./library";

type Resource = components["schemas"]["LibraryResource"];

export function ReadingProgress({
  item,
  path,
}: {
  item: Resource;
  path: string;
}) {
  const client = useQueryClient();
  const key = ["workbench", "library", item.workspace_id, item.space_id];
  const update = useMutation({
    mutationFn: (status: "reading" | "close_read") =>
      workbenchRequest<Resource>(`${path}/reading-status`, {
        method: "PATCH",
        body: JSON.stringify({ status, expected_version: item.version }),
      }),
    onSuccess: async (saved) => {
      client.setQueryData([...key, "detail", item.id], saved);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  return (
    <div className="wb-reading-progress" aria-label="阅读进度">
      <span role="status">
        阅读状态：{READING_STATUSES[item.reading_status]}
      </span>
      {item.reading_status !== "archived" && (
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              item.reading_status === "reading" ? "close_read" : "reading",
            )
          }
        >
          {item.reading_status === "reading"
            ? "标记精读完成"
            : item.reading_status === "close_read"
              ? "重新阅读"
              : "开始阅读"}
        </Button>
      )}
      {update.error && (
        <div role="alert">
          {errorMessage(update.error)}{" "}
          <Button
            onClick={() =>
              void client.invalidateQueries({
                queryKey: [...key, "detail", item.id],
              })
            }
          >
            刷新状态
          </Button>
        </div>
      )}
    </div>
  );
}
