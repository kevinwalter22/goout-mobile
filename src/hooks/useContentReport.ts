import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { captureError } from "../lib/logger";
import type { ReportReason, ReportTargetType } from "../types/database";

export function useContentReport() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const submitReport = useCallback(
    async (
      targetType: ReportTargetType,
      targetId: string,
      reason: ReportReason,
      details?: string
    ): Promise<{ success: boolean; alreadyReported?: boolean }> => {
      if (!user) return { success: false };

      setSubmitting(true);
      try {
        // Check for duplicate report
        const { data: existing } = await supabase
          .from("content_reports")
          .select("id")
          .eq("reporter_id", user.id)
          .eq("target_type", targetType)
          .eq("target_id", targetId)
          .limit(1);

        if (existing && existing.length > 0) {
          return { success: true, alreadyReported: true };
        }

        const { error } = await supabase.from("content_reports").insert({
          reporter_id: user.id,
          target_type: targetType,
          target_id: targetId,
          reason,
          details: details || null,
        } as any);

        if (error) {
          captureError(error, { action: "submitReport" });
          return { success: false };
        }

        return { success: true };
      } finally {
        setSubmitting(false);
      }
    },
    [user]
  );

  return { submitReport, submitting };
}
