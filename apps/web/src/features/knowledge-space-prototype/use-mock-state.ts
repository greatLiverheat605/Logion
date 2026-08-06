/* ============================================================
   knowledge-space-prototype / use-mock-state.ts
   Local mock state hook for both prototype variants.
   Manages evidence items, projection switching, and interactions.
   ============================================================ */

"use client";

import { useCallback, useMemo, useState } from "react";
import type { EvidenceItem, ProjectionSlot } from "./mock-data";
import { getProjectionData } from "./mock-data";

export type ViewMode = "a" | "b";

export function useMockState() {
  const [viewMode, setViewMode] = useState<ViewMode>("a");
  const [projection, setProjection] = useState<ProjectionSlot>("today");
  const [items, setItems] = useState<EvidenceItem[]>(
    () => getProjectionData("today").evidence,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const data = useMemo(() => getProjectionData(projection), [projection]);

  const switchProjection = useCallback((slot: ProjectionSlot) => {
    setProjection(slot);
    setItems(getProjectionData(slot).evidence);
    setSelectedItemId(null);
    setError(null);
  }, []);

  const simulateLoading = useCallback(() => {
    setLoading(true);
    setError(null);
    setTimeout(() => {
      setLoading(false);
    }, 2000);
  }, []);

  const simulateError = useCallback(() => {
    setLoading(false);
    setError("Failed to load evidence. Please try again.");
  }, []);

  const acceptItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "accepted" as const,
              acceptedAt: new Date().toISOString(),
              rejectedAt: null,
              rejectReason: null,
            }
          : item,
      ),
    );
  }, []);

  const rejectItem = useCallback((id: string, reason?: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "rejected" as const,
              acceptedAt: null,
              rejectedAt: new Date().toISOString(),
              rejectReason: reason ?? null,
            }
          : item,
      ),
    );
  }, []);

  const editItem = useCallback((id: string, updates: Partial<EvidenceItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  return {
    viewMode,
    setViewMode,
    projection,
    switchProjection,
    items,
    data,
    loading,
    error,
    online,
    setOnline,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    acceptItem,
    rejectItem,
    editItem,
    simulateLoading,
    simulateError,
  };
}

export type MockState = ReturnType<typeof useMockState>;
