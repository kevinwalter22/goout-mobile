import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import type { UserBlock } from "../types/database";

type BlockedUser = UserBlock & {
  profile: { username: string; avatar_url: string | null } | null;
};

export function useBlockUser() {
  const { user } = useAuth();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBlocks = useCallback(async () => {
    if (!user) {
      setBlockedIds(new Set());
      setBlockedUsers([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("user_blocks")
      .select("*")
      .eq("blocker_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Block] Failed to load blocks:", error);
      setLoading(false);
      return;
    }

    const blocks = (data || []) as UserBlock[];
    setBlockedIds(new Set(blocks.map((b) => b.blocked_id)));

    // Fetch profiles for blocked users
    if (blocks.length > 0) {
      const ids = blocks.map((b) => b.blocked_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", ids);

      const profileMap = new Map(
        (profiles || []).map((p: any) => [p.id, p])
      );

      setBlockedUsers(
        blocks.map((b) => ({
          ...b,
          profile: profileMap.get(b.blocked_id) || null,
        }))
      );
    } else {
      setBlockedUsers([]);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  const blockUser = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (!user || targetUserId === user.id) return false;

      const { error } = await supabase
        .from("user_blocks")
        .insert({ blocker_id: user.id, blocked_id: targetUserId } as any);

      if (error) {
        // Duplicate block — treat as success
        if (error.code === "23505") return true;
        console.error("[Block] Failed to block user:", error);
        return false;
      }

      setBlockedIds((prev) => new Set([...prev, targetUserId]));
      // Reload to get profile info
      loadBlocks();
      return true;
    },
    [user, loadBlocks]
  );

  const unblockUser = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (!user) return false;

      const { error } = await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", user.id)
        .eq("blocked_id", targetUserId);

      if (error) {
        console.error("[Block] Failed to unblock user:", error);
        return false;
      }

      setBlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(targetUserId);
        return next;
      });
      setBlockedUsers((prev) => prev.filter((b) => b.blocked_id !== targetUserId));
      return true;
    },
    [user]
  );

  const isBlocked = useCallback(
    (userId: string) => blockedIds.has(userId),
    [blockedIds]
  );

  return {
    blockedIds,
    blockedUsers,
    loading,
    blockUser,
    unblockUser,
    isBlocked,
    refresh: loadBlocks,
  };
}
