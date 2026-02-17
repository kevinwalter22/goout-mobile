import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

export type QuarantinedItem = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  location_name: string | null;
  town: string | null;
  starts_at: string | null;
  source_url: string | null;
  normalized_confidence: number | null;
  provenance: Record<string, any> | null;
  created_at: string;
};

export function useReviewQueue() {
  const [items, setItems] = useState<QuarantinedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQueue = useCallback(async (limit = 20, offset = 0) => {
    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("get_quarantine_queue", {
      p_limit: limit,
      p_offset: offset,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    setItems((data as QuarantinedItem[]) || []);
    setLoading(false);
  }, []);

  const approveItem = useCallback(async (itemId: string) => {
    // Optimistic removal
    setItems((prev) => prev.filter((i) => i.id !== itemId));

    const { error: rpcError } = await supabase.rpc("approve_quarantined_item", {
      p_item_id: itemId,
    });

    if (rpcError) {
      // Re-fetch on failure
      setError(rpcError.message);
      await fetchQueue();
    }
  }, [fetchQueue]);

  const rejectItem = useCallback(async (itemId: string, reason?: string) => {
    // Optimistic removal
    setItems((prev) => prev.filter((i) => i.id !== itemId));

    const { error: rpcError } = await supabase.rpc("reject_quarantined_item", {
      p_item_id: itemId,
      p_reason: reason ?? undefined,
    });

    if (rpcError) {
      setError(rpcError.message);
      await fetchQueue();
    }
  }, [fetchQueue]);

  return { items, loading, error, fetchQueue, approveItem, rejectItem };
}
