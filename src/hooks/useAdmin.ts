import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/**
 * Hook to check if the current user has admin privileges.
 * Calls the same SECURITY DEFINER function used by all RLS policies,
 * ensuring the client and DB always agree on admin status.
 */
export function useAdmin() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    async function checkAdminStatus() {
      setLoading(true);

      const { data, error } = await supabase.rpc("is_current_user_admin");

      if (error) {
        console.log("[useAdmin] Error checking admin status:", error.message);
        setIsAdmin(false);
      } else {
        setIsAdmin(data === true);
      }

      setLoading(false);
    }

    checkAdminStatus();
  }, [user]);

  return { isAdmin, loading };
}
