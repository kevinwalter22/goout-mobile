import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

export type ModerationFlag = {
  id: string;
  created_at: string;
  flagged_by: string | null;
  target_type: string;
  target_id: string;
  source: string;
  category: string;
  severity: number;
  action: string;
  reason: string | null;
  metadata: Record<string, any> | null;
  status: string;
};

export function useModerationInbox() {
  const [flags, setFlags] = useState<ModerationFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInbox = useCallback(
    async (limit = 20, offset = 0, targetType?: string, source?: string) => {
      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc("get_moderation_inbox", {
        p_limit: limit,
        p_offset: offset,
        p_target_type: targetType ?? null,
        p_source: source ?? null,
      });

      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }

      setFlags((data as ModerationFlag[]) || []);
      setLoading(false);
    },
    [],
  );

  const approveFlag = useCallback(
    async (flagId: string, targetType: string, targetId: string) => {
      setFlags((prev) => prev.filter((f) => f.id !== flagId));

      const { error: resolveError } = await supabase.rpc("resolve_flag", {
        p_flag_id: flagId,
        p_resolution: "approved",
        p_note: "Approved by admin",
      });

      if (resolveError) {
        setError(resolveError.message);
        await fetchInbox();
        return;
      }

      await supabase.rpc("moderate_content", {
        p_target_type: targetType,
        p_target_id: targetId,
        p_action: "approved",
        p_reason: "Approved by admin",
      });
    },
    [fetchInbox],
  );

  const removeFlag = useCallback(
    async (flagId: string, targetType: string, targetId: string) => {
      setFlags((prev) => prev.filter((f) => f.id !== flagId));

      const { error: resolveError } = await supabase.rpc("resolve_flag", {
        p_flag_id: flagId,
        p_resolution: "blocked",
        p_note: "Removed by admin",
      });

      if (resolveError) {
        setError(resolveError.message);
        await fetchInbox();
        return;
      }

      await supabase.rpc("moderate_content", {
        p_target_type: targetType,
        p_target_id: targetId,
        p_action: "blocked",
        p_reason: "Removed by admin",
      });
    },
    [fetchInbox],
  );

  const suspendUser = useCallback(async (userId: string, durationHours?: number) => {
    const suspendedUntil = durationHours
      ? new Date(Date.now() + durationHours * 3600000).toISOString()
      : null;

    const { error: rpcError } = await supabase.rpc("set_user_enforcement", {
      p_user_id: userId,
      p_is_suspended: true,
      p_suspended_until: suspendedUntil,
      p_is_shadowbanned: false,
      p_note: durationHours
        ? `Suspended for ${durationHours} hours by admin`
        : "Suspended indefinitely by admin",
    });

    if (rpcError) {
      setError(rpcError.message);
    }
  }, []);

  const shadowbanUser = useCallback(async (userId: string) => {
    const { error: rpcError } = await supabase.rpc("set_user_enforcement", {
      p_user_id: userId,
      p_is_suspended: false,
      p_suspended_until: null,
      p_is_shadowbanned: true,
      p_note: "Shadowbanned by admin",
    });

    if (rpcError) {
      setError(rpcError.message);
    }
  }, []);

  return {
    flags,
    loading,
    error,
    fetchInbox,
    approveFlag,
    removeFlag,
    suspendUser,
    shadowbanUser,
  };
}
