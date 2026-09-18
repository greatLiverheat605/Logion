"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { WorkbenchSheet } from "@/components/product/headless-ui";
import type { RecordsControllerResult } from "./use-records-controller";
import styles from "./records-workbench.module.css";

export function NoteSelectionSheet({
  controller,
  excerpt,
  noteId,
  onClose,
}: {
  controller: RecordsControllerResult;
  excerpt: string;
  noteId: string;
  onClose: () => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<"topic" | "quiz_item">("topic");
  const [title, setTitle] = useState(
    (excerpt.split("\n")[0] ?? "").slice(0, 160),
  );
  const [answer, setAnswer] = useState("");
  const [topicId, setTopicId] = useState("");
  const [topics, setTopics] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const loadTopics = useRef(controller.commands.selectionTopics);
  useEffect(() => {
    let active = true;
    void loadTopics
      .current()
      .then((rows) => {
        if (active) setTopics(rows);
      })
      .catch(() => {
        if (active)
          setError("知识点未读取成功。可以先创建知识点，或关闭后重试。");
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (
        await controller.commands.createFromSelection(noteId, {
          kind,
          excerpt,
          title,
          topicId,
          answer,
        })
      ) {
        onClose();
      } else {
        setError("尚未保存，请稍后重试。");
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "保存失败，内容已保留，请重试。",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <WorkbenchSheet
      open
      title="将笔记选段用于复习"
      description="确认后保存到当前空间。原笔记保持原样；离线时先加密保存在本机。"
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
      footer={
        <>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={
              pending ||
              !title.trim() ||
              (kind === "quiz_item" && (!topicId || !answer.trim()))
            }
            form={id}
            type="submit"
          >
            {pending
              ? "正在保存"
              : kind === "topic"
                ? "创建知识点"
                : "创建题目"}
          </button>
        </>
      }
    >
      <form id={id} className={styles.sheetForm} onSubmit={submit}>
        <label htmlFor={`${id}-kind`}>创建类型</label>
        <select
          id={`${id}-kind`}
          value={kind}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value as "topic" | "quiz_item";
            setKind(value);
            setTitle(
              value === "topic"
                ? (excerpt.split("\n")[0] ?? "").slice(0, 160)
                : excerpt,
            );
          }}
        >
          <option value="topic">知识点</option>
          <option value="quiz_item">自评题目</option>
        </select>
        <label htmlFor={`${id}-source`}>所选原文</label>
        <textarea id={`${id}-source`} readOnly value={excerpt} rows={4} />
        <label htmlFor={`${id}-title`}>
          {kind === "topic" ? "知识点标题" : "题干"}
        </label>
        <textarea
          id={`${id}-title`}
          required
          maxLength={kind === "topic" ? 160 : 10000}
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
          rows={3}
        />
        {kind === "quiz_item" ? (
          <>
            <label htmlFor={`${id}-topic`}>所属知识点</label>
            <select
              id={`${id}-topic`}
              required
              value={topicId}
              disabled={pending}
              onChange={(event) => setTopicId(event.target.value)}
            >
              <option value="">请选择当前空间的知识点</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </select>
            {!topics.length ? (
              <p>当前没有可用知识点，可先将选段创建为知识点。</p>
            ) : null}
            <label htmlFor={`${id}-answer`}>参考答案</label>
            <textarea
              id={`${id}-answer`}
              required
              maxLength={10000}
              value={answer}
              disabled={pending}
              onChange={(event) => setAnswer(event.target.value)}
              rows={4}
            />
            <p>答题后由你对照参考答案确认，不自动判断掌握程度。</p>
          </>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </WorkbenchSheet>
  );
}
