import styles from "./note-external-links.module.css";

function externalUrls(value: string): string[] {
  const urls = new Set<string>();
  for (const match of value.matchAll(/(?:^|\s)(https?:\/\/[^\s<>"'`]+)/giu)) {
    if (!match[1]) continue;
    const candidate = match[1].replace(
      /[.,;:!?\u3002\uff0c\uff1b\uff01\uff1f\u3001]+$/u,
      "",
    );
    if (candidate.includes("\\")) continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      ) {
        urls.add(candidate);
      }
    } catch {
      // Malformed candidates remain plain text in the unchanged preview.
    }
  }
  return [...urls];
}

export function NoteExternalLinks({ value }: Readonly<{ value: string }>) {
  const urls = externalUrls(value);
  if (urls.length === 0) return null;
  return (
    <ul aria-label="笔记外部链接" className={styles.links}>
      {urls.map((url) => (
        <li key={url}>
          <a href={url} rel="noopener noreferrer" target="_blank">
            {url}（外部链接）
          </a>
        </li>
      ))}
    </ul>
  );
}
