import Link from "next/link";

export function LockedDataNotice({
  href = "/app/sync",
  detail = "解锁后才会读取本地目标、任务与笔记。",
}: {
  href?: string;
  detail?: string;
}) {
  return (
    <section role="status" aria-label="资料已锁定">
      <strong>资料已锁定，解锁后读取</strong>
      <p>{detail}</p>
      <Link href={href}>解锁本地资料</Link>
    </section>
  );
}
