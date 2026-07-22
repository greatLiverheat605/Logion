"use client";

import type { components } from "@logion/contracts";
import { useEffect, useState } from "react";

import { browserApiClient } from "@/lib/api/client";

type PublicShare = components["schemas"]["PublicShareResponse"];

export function PublicShareView({ token }: { token: string }) {
  const [share, setShare] = useState<PublicShare | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      void browserApiClient
        .request<PublicShare>(`/api/v1/shares/${token}`)
        .then(setShare)
        .catch(() => setFailed(true));
    });
  }, [token]);

  if (failed) return <p role="alert">此分享不存在、已过期或已被撤销。</p>;
  if (!share) return <p role="status">正在读取只读快照……</p>;
  return (
    <article>
      <h1>{share.title}</h1>
      <p>只读快照 · 到期 {new Date(share.expires_at).toLocaleString()}</p>
      <pre>{JSON.stringify(share.snapshot, null, 2)}</pre>
    </article>
  );
}
