"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LogionApiError } from "@/lib/api/client";
import { errorMessage, workbenchRequest } from "./api";
import { PdfImport } from "./pdf-import";
import { Button, Inspector, List, Sheet } from "./components";
import { useWorkbench } from "./provider";
import type { WorkbenchContext } from "./preferences";

type Resource = components["schemas"]["LibraryResource"];
type Fields = components["schemas"]["LibraryCreate"];
type Page = components["schemas"]["LibraryPage"];
export const READING_STATUSES = {
  unread: "未读",
  skimmed: "略读",
  reading: "在读",
  close_read: "精读完成",
  archived: "已归档",
} as const;
const TYPES = {
  paper: "论文",
  book: "书籍",
  preprint: "预印本",
  web: "网页",
  link: "链接",
  pdf_index: "PDF 索引",
};
const pathFor = (context: WorkbenchContext) =>
  `/api/v1/workspaces/${encodeURIComponent(context.workspace_id)}/spaces/${encodeURIComponent(context.space_id)}/library/resources`;
const keyFor = (context: WorkbenchContext) => [
  "workbench",
  "library",
  context.workspace_id,
  context.space_id,
];
const detailQuery = (context: WorkbenchContext, id: string) => ({
  queryKey: [...keyFor(context), "detail", id],
  queryFn: () =>
    workbenchRequest<Resource>(`${pathFor(context)}/${encodeURIComponent(id)}`),
});

export function Library() {
  const { context } = useWorkbench();
  if (!context)
    return <div className="wb-empty">请先选择一个可访问的空间。</div>;
  return (
    <LibraryScope
      key={`${context.workspace_id}/${context.space_id}`}
      context={context}
    />
  );
}

function LibraryScope({ context }: { context: WorkbenchContext }) {
  const client = useQueryClient();
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Resource | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listing = useInfiniteQuery({
    queryKey: [...keyFor(context), "list", status, tag],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<Page>(pathFor(context), {
        query: {
          ...(status ? { status } : {}),
          ...(tag ? { tag } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const detail = useQuery({
    ...detailQuery(context, selected ?? ""),
    enabled: Boolean(selected),
  });
  const deletion = useMutation({
    mutationFn: (item: Resource) =>
      workbenchRequest<void>(
        `${pathFor(context)}/${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expected_version: item.version }),
        },
      ),
    onSuccess: async (_, item) => {
      setConfirmDelete(false);
      setSelected(null);
      client.removeQueries({
        queryKey: detailQuery(context, item.id).queryKey,
      });
      await client.invalidateQueries({
        queryKey: [...keyFor(context), "list"],
      });
    },
  });
  return (
    <div className="wb-page wb-library-page">
      <div className="wb-page-heading">
        <div>
          <h1>文献库</h1>
          <p>收集、整理，回到值得细读的内容。仅自己可见。</p>
        </div>
        <Button onClick={() => setEditor("new")}>＋ 新建文献</Button>
      </div>
      <PdfImport
        path={pathFor(context)}
        onImported={() =>
          client.invalidateQueries({ queryKey: [...keyFor(context), "list"] })
        }
      />
      <div className="wb-library-filters">
        <label>
          阅读状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(READING_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          筛选标签
          <input
            value={tag}
            maxLength={80}
            placeholder="输入完整标签"
            onChange={(e) => setTag(e.target.value)}
          />
        </label>
      </div>
      <div className="wb-library-columns">
        <section aria-label="文献列表" className="wb-library-list">
          {listing.isPending && <p role="status">正在载入文献…</p>}
          {listing.error && (
            <p role="alert">
              {errorMessage(listing.error)}{" "}
              <Button onClick={() => void listing.refetch()}>重试</Button>
            </p>
          )}
          {listing.data && listing.data.pages[0]?.resources.length === 0 && (
            <div className="wb-empty">
              <h2>这里还没有文献</h2>
              <p>新建一篇文献，或调整筛选条件。</p>
            </div>
          )}
          <List label="个人文献">
            {listing.data?.pages
              .flatMap((p) => p.resources)
              .map((item) => (
                <li key={item.id}>
                  <button
                    className="wb-library-row"
                    aria-pressed={selected === item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setConfirmDelete(false);
                      deletion.reset();
                    }}
                  >
                    <span className="wb-library-kind">
                      {TYPES[item.resource_type]}
                    </span>
                    <strong>{item.title}</strong>
                    <span>
                      {item.csl?.author
                        ?.map(
                          (a) =>
                            a.literal ??
                            [a.given, a.family].filter(Boolean).join(" "),
                        )
                        .join(" · ") || "未填写作者"}
                    </span>
                    <span>
                      {READING_STATUSES[item.reading_status]}
                      {item.tags?.length ? ` · ${item.tags.join(" / ")}` : ""}
                    </span>
                  </button>
                </li>
              ))}
          </List>
          {listing.hasNextPage && (
            <Button
              disabled={listing.isFetchingNextPage}
              onClick={() => void listing.fetchNextPage()}
            >
              载入更多
            </Button>
          )}
        </section>
        <Inspector title="文献信息">
          {!selected && <p>从列表选择一篇文献。</p>}
          {selected && detail.isPending && <p role="status">正在载入详情…</p>}
          {detail.error && <p role="alert">{errorMessage(detail.error)}</p>}
          {selected && detail.data && (
            <>
              <ResourceDetails item={detail.data} />
              <div className="wb-library-actions">
                <Link
                  className="wb-button"
                  href={`/read/${encodeURIComponent(detail.data.id)}`}
                >
                  进入阅读
                </Link>
                <Button onClick={() => setEditor(detail.data!)}>
                  编辑文献
                </Button>
                <Button onClick={() => setConfirmDelete(true)}>删除文献</Button>
              </div>
              {confirmDelete && (
                <div className="wb-library-confirm">
                  <p>确认从个人文献库删除这篇文献？</p>
                  <Button
                    disabled={deletion.isPending}
                    onClick={() => deletion.mutate(detail.data!)}
                  >
                    确认删除
                  </Button>{" "}
                  <Button
                    disabled={deletion.isPending}
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </Button>
                </div>
              )}
              {deletion.error && (
                <p role="alert">
                  {errorMessage(deletion.error)}{" "}
                  <Button
                    onClick={() => {
                      deletion.reset();
                      void detail.refetch();
                    }}
                  >
                    载入最新版本
                  </Button>
                </p>
              )}
            </>
          )}
        </Inspector>
      </div>
      <Sheet
        title={editor === "new" ? "新建文献" : "编辑文献"}
        description="文献保存在当前空间的个人文献库。"
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor && (
          <ResourceForm
            key={editor === "new" ? "new" : `${editor.id}/${editor.version}`}
            context={context}
            item={editor === "new" ? undefined : editor}
            onSaved={(item) => {
              client.setQueryData(detailQuery(context, item.id).queryKey, item);
              void client.invalidateQueries({
                queryKey: [...keyFor(context), "list"],
              });
              setSelected(item.id);
              setEditor(null);
            }}
            onExisting={(id) => {
              setSelected(id);
              setEditor(null);
            }}
            onReload={async () => {
              if (editor !== "new" && editor)
                setEditor(
                  await client.fetchQuery({
                    ...detailQuery(context, editor.id),
                    staleTime: 0,
                  }),
                );
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

export function ResourceDetails({ item }: { item: Resource }) {
  const date = item.csl?.["issued"]?.["date-parts"]?.[0]?.join("-");
  return (
    <div className="wb-resource-details">
      <h3>{item.title}</h3>
      <dl>
        {Object.entries({
          类型: TYPES[item.resource_type],
          阅读: READING_STATUSES[item.reading_status],
          作者: item.csl?.author
            ?.map(
              (a) => a.literal ?? [a.given, a.family].filter(Boolean).join(" "),
            )
            .join(" · "),
          发表: [date, item.csl?.["container-title"]]
            .filter(Boolean)
            .join(" · "),
          DOI: item.doi,
          arXiv: item.arxiv_id,
          PMID: item.pmid,
          引用键: item.citation_key,
          标签: item.tags?.join(" · "),
        })
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {item.source_url && (
        <a
          className="wb-source-link"
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
        >
          打开来源 ↗
        </a>
      )}
      {item.csl?.abstract && (
        <>
          <h4>摘要</h4>
          <p className="wb-abstract">{item.csl.abstract}</p>
        </>
      )}
    </div>
  );
}

function ResourceForm({
  context,
  item,
  onSaved,
  onExisting,
  onReload,
}: {
  context: WorkbenchContext;
  item?: Resource;
  onSaved: (item: Resource) => void;
  onExisting: (id: string) => void;
  onReload: () => Promise<void>;
}) {
  const [failure, setFailure] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const authors =
    item?.csl?.author
      ?.map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(" "))
      .join("\n") ?? "";
  const year = item?.csl?.issued?.["date-parts"]?.[0]?.[0]?.toString() ?? "";
  const mutation = useMutation({
    mutationFn: (body: Fields) =>
      workbenchRequest<Resource>(
        `${pathFor(context)}${item ? `/${encodeURIComponent(item.id)}` : ""}`,
        {
          method: item ? "PUT" : "POST",
          body: JSON.stringify({
            ...body,
            ...(item ? { expected_version: item.version } : {}),
          }),
        },
      ),
    onSuccess: onSaved,
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    setFailure(null);
    setDuplicate(null);
    try {
      await mutation.mutateAsync({
        resource_type: text("resource_type") as Fields["resource_type"],
        title: text("title"),
        source_url: text("source_url") || null,
        reading_status: text("reading_status") as Fields["reading_status"],
        doi: text("doi") || null,
        arxiv_id: text("arxiv_id") || null,
        pmid: text("pmid") || null,
        citation_key: text("citation_key") || null,
        tags: [
          ...(item?.tags?.filter((tag) => tag.startsWith("collection:")) ?? []),
          ...text("tags")
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ],
        csl: {
          ...item?.csl,
          author:
            text("authors") === authors
              ? item?.csl?.author
              : text("authors")
                  .split("\n")
                  .map((a) => a.trim())
                  .filter(Boolean)
                  .map((literal) => ({ literal })),
          issued:
            text("year") === year
              ? item?.csl?.issued
              : text("year")
                ? { "date-parts": [[Number(text("year"))]] }
                : null,
          "container-title": text("venue") || null,
          abstract: text("abstract") || null,
        },
        zotero_library_id: item?.zotero_library_id,
        zotero_item_key: item?.zotero_item_key,
        zotero_version: item?.zotero_version,
        file_locator: item?.file_locator,
        read_at: item?.read_at,
      });
    } catch (error) {
      setFailure(error);
      if (
        error instanceof LogionApiError &&
        error.code === "LIBRARY_DUPLICATE" &&
        error.details &&
        typeof error.details === "object" &&
        "existing_id" in error.details &&
        typeof error.details.existing_id === "string"
      )
        setDuplicate(error.details.existing_id);
    }
  }
  return (
    <form className="wb-library-form" onSubmit={submit}>
      <label>
        标题
        <input
          name="title"
          required
          maxLength={300}
          defaultValue={item?.title}
        />
      </label>
      <label>
        作者（每行一位）
        <textarea
          name="authors"
          rows={2}
          maxLength={200000}
          defaultValue={authors}
        />
      </label>
      <label>
        发表年份
        <input
          name="year"
          type="number"
          min={1}
          max={9999}
          defaultValue={year}
        />
      </label>
      <label>
        期刊或会议
        <input
          name="venue"
          maxLength={2000}
          defaultValue={item?.csl?.["container-title"] ?? ""}
        />
      </label>
      <label>
        类型
        <select
          name="resource_type"
          defaultValue={item?.resource_type ?? "paper"}
        >
          {Object.entries(TYPES).map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <label>
        阅读状态
        <select
          name="reading_status"
          defaultValue={item?.reading_status ?? "unread"}
        >
          {Object.entries(READING_STATUSES).map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["doi", "DOI", 255],
          ["arxiv_id", "arXiv", 80],
          ["pmid", "PMID", 20],
          ["citation_key", "引用键", 160],
          ["source_url", "来源网址", 4096],
        ] as const
      ).map(([name, label, max]) => (
        <label key={name}>
          {label}
          <input
            name={name}
            type={name === "source_url" ? "url" : "text"}
            maxLength={max}
            defaultValue={item?.[name] ?? ""}
          />
        </label>
      ))}
      <label>
        标签（逗号分隔）
        <input
          name="tags"
          maxLength={4000}
          defaultValue={item?.tags
            ?.filter((tag) => !tag.startsWith("collection:"))
            .join(", ")}
        />
      </label>
      <label>
        摘要
        <textarea
          name="abstract"
          rows={5}
          maxLength={30000}
          defaultValue={item?.csl?.abstract ?? ""}
        />
      </label>
      {failure !== null && (
        <div role="alert">
          <p>{errorMessage(failure)}</p>
          {duplicate && (
            <Button onClick={() => onExisting(duplicate)}>查看已有文献</Button>
          )}
          {failure instanceof LogionApiError &&
            failure.code === "RESOURCE_VERSION_CONFLICT" && (
              <Button onClick={() => void onReload().catch(setFailure)}>
                放弃当前输入并载入最新版本
              </Button>
            )}
        </div>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "正在保存…" : "保存文献"}
      </Button>
    </form>
  );
}

export function ReaderInformation({ id }: { id: string }) {
  const { context } = useWorkbench();
  return context ? (
    <ScopedReaderInformation
      key={`${context.workspace_id}/${context.space_id}/${id}`}
      context={context}
      id={id}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}
function ScopedReaderInformation({
  context,
  id,
}: {
  context: WorkbenchContext;
  id: string;
}) {
  const detail = useQuery(detailQuery(context, id));
  return (
    <div className="wb-reader-info">
      {detail.isPending && <p role="status">正在载入文献信息…</p>}
      {detail.error && <p role="alert">{errorMessage(detail.error)}</p>}
      {detail.data && <ResourceDetails item={detail.data} />}
      <Link className="wb-button" href="/library">
        返回文献库
      </Link>
    </div>
  );
}
