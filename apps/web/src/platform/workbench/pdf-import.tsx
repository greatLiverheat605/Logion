"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button } from "./components";
import { errorMessage, workbenchRequest } from "./api";

type Usage = {
  downloaded_bytes: number;
  allowance_bytes: number;
  near_limit: boolean;
  pdf_max_bytes: number;
};
export function PdfUsage() {
  const usage = useQuery({
    queryKey: ["workbench", "pdf-usage"],
    queryFn: () => workbenchRequest<Usage>("/api/v1/research/pdf-usage"),
  });
  return (
    <div className="wb-pdf-usage">
      {usage.data && (
        <p>
          本月坚果云下载：
          {(usage.data.downloaded_bytes / 1_000_000_000).toFixed(2)} / 3 GB。
        </p>
      )}
      {usage.data?.near_limit && (
        <p role="alert">本月下载已接近 3 GB，请留意坚果云流量额度。</p>
      )}
      {usage.error && <p role="alert">{errorMessage(usage.error)}</p>}
    </div>
  );
}

async function droppedFiles(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];
  async function walk(entry: FileSystemEntry) {
    if (files.length >= 1000)
      throw new Error("每批最多导入 1000 个文件，请分批选择。");
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        ),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  const entries = Array.from(items).map((item) => ({
    entry: item.webkitGetAsEntry?.(),
    file: item.getAsFile(),
  }));
  for (const item of entries) {
    if (item.entry) await walk(item.entry);
    else if (item.file) files.push(item.file);
  }
  return files;
}

export function PdfImport({
  path,
  onImported,
}: {
  path: string;
  onImported: () => Promise<void>;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  useEffect(() => () => abort.current?.abort(), []);

  async function upload(files: File[]) {
    if (busy.current) return;
    if (files.length > 1000) {
      setResults(["每批最多导入 1000 个文件，请分批选择。"]);
      return;
    }
    busy.current = true;
    setRunning(true);
    setResults([]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const usage = await client.fetchQuery({
        queryKey: ["workbench", "pdf-usage"],
        queryFn: () => workbenchRequest<Usage>("/api/v1/research/pdf-usage"),
      });
      for (const file of files.slice(0, 1000)) {
        if (controller.signal.aborted) break;
        let result: string;
        if (!file.name.toLowerCase().endsWith(".pdf"))
          result = "已跳过：仅接受 PDF";
        else if (file.size > usage.pdf_max_bytes)
          result = `超过 ${(usage.pdf_max_bytes / 1024 / 1024).toFixed(0)} MB 限制`;
        else {
          try {
            await workbenchRequest(`${path}/pdf-import`, {
              method: "POST",
              headers: {
                "Content-Type": "application/pdf",
                "X-PDF-Title": encodeURIComponent(
                  file.name.replace(/\.pdf$/i, "").slice(0, 300) ||
                    "导入的论文",
                ),
              },
              body: file,
              signal: controller.signal,
            });
            result = "已导入（重复文件沿用已有文献）";
          } catch (error) {
            result = errorMessage(error);
          }
        }
        if (!controller.signal.aborted)
          setResults((previous) => [...previous, `${file.name}：${result}`]);
      }
      if (!controller.signal.aborted) await onImported();
    } catch (error) {
      if (!controller.signal.aborted) setResults([errorMessage(error)]);
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  async function drop(event: DragEvent) {
    event.preventDefault();
    if (busy.current) return;
    try {
      await upload(await droppedFiles(event.dataTransfer.items));
    } catch (error) {
      setResults([
        error instanceof Error
          ? error.message
          : "无法读取拖入的文件，请改用选择按钮。",
      ]);
    }
  }
  return (
    <section
      aria-label="导入 PDF"
      className="wb-pdf-import"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void drop(event)}
    >
      <p>拖入多个 PDF 或整个文件夹，保存到已连接的坚果云。相同文件自动去重。</p>
      <div className="wb-library-actions">
        <Button disabled={running} onClick={() => fileInput.current?.click()}>
          选择 PDF
        </Button>
        <Button disabled={running} onClick={() => folderInput.current?.click()}>
          选择文件夹
        </Button>
      </div>
      <input
        hidden
        aria-label="选择 PDF 文件"
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={(event) => {
          void upload(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <input
        hidden
        aria-label="选择 PDF 文件夹"
        ref={(element) => {
          folderInput.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        onChange={(event) => {
          void upload(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {running && <p role="status">正在逐个导入，请保持页面打开…</p>}
      {results.length > 0 && (
        <ul aria-label="导入结果" aria-live="polite">
          {results.map((result, index) => (
            <li key={index}>{result}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
