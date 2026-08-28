"use client";

import { useCallback } from "react";

import { browserApiClient, type ApiRequestOptions } from "@/lib/api/client";

export function useExamController() {
  const request = useCallback(
    <T>(path: string, options?: ApiRequestOptions) =>
      browserApiClient.request<T>(path, options),
    [],
  );

  return { request };
}
