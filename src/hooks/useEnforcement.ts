import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export type EnforcementState = {
  isSuspended: boolean;
  suspendedUntil: string | null;
  isShadowbanned: boolean;
  loading: boolean;
};

/**
 * Hook to check the current user's enforcement state.
 * Returns suspension/shadowban info from the user_enforcement table.
 */
export function useEnforcement(): EnforcementState {
  const { user } = useAuth();
  const [state, setState] = useState<EnforcementState>({
    isSuspended: false,
    suspendedUntil: null,
    isShadowbanned: false,
    loading: true,
  });

  useEffect(() => {
    if (!user) {
      setState({ isSuspended: false, suspendedUntil: null, isShadowbanned: false, loading: false });
      return;
    }

    async function check() {
      const { data, error } = await supabase.rpc("check_enforcement");

      if (error || !data || data.length === 0) {
        setState({ isSuspended: false, suspendedUntil: null, isShadowbanned: false, loading: false });
        return;
      }

      const row = data[0];
      // Check if suspension has expired
      const isSuspended =
        row.is_suspended &&
        (!row.suspended_until || new Date(row.suspended_until) > new Date());

      setState({
        isSuspended,
        suspendedUntil: row.suspended_until,
        isShadowbanned: row.is_shadowbanned,
        loading: false,
      });
    }

    check();
  }, [user]);

  return state;
}
