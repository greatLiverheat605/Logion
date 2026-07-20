"use client";

import { useEffect, useState } from "react";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export function consumeFragmentToken(
  hash: string,
  clear: () => void,
): string | null {
  const candidate = new URLSearchParams(hash.slice(1)).get("token");
  clear();
  return candidate !== null && TOKEN_PATTERN.test(candidate) ? candidate : null;
}

export function useFragmentToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const candidate = consumeFragmentToken(window.location.hash, () =>
      window.history.replaceState(null, "", window.location.pathname),
    );
    queueMicrotask(() => setToken(candidate));
  }, []);

  return token;
}
