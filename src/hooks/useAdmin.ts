import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/**
 * Hook to check if the current user has admin privileges.
 * Uses RLS-protected query to ensure security.
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

      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      if (error) {
        console.log("[useAdmin] Error checking admin status:", error.message);
        setIsAdmin(false);
      } else {
        setIsAdmin(data?.is_admin ?? false);
      }

      setLoading(false);
    }

    checkAdminStatus();
  }, [user]);

  return { isAdmin, loading };
}
