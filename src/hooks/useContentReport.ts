import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { captureError } from "../lib/logger";
import { logSecurityEvent, SEC } from "../lib/securityEvents";
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

        logSecurityEvent(SEC.CONTENT_REPORT, "low", { target_type: targetType });

        // Bridge to moderation_flags for admin inbox (fire-and-forget)
        const categoryMap: Record<string, string> = {
          spam: "spam",
          harassment: "harassment",
          hate_speech: "hate_speech",
          sexual_content: "sexual_content",
          other: "other",
        };

        supabase
          .from("moderation_flags")
          .insert({
            flagged_by: user.id,
            target_type: targetType,
            target_id: targetId,
            source: "user_report",
            category: categoryMap[reason] || "other",
            severity: 50,
            action: "quarantine",
            reason: details || `User report: ${reason}`,
            metadata: { report_reason: reason, details },
            status: "open",
          } as any)
          .then(({ error: flagError }) => {
            if (flagError && __DEV__) {
              console.log("[useContentReport] Flag insert error:", flagError.message);
            }
          });

        return { success: true };
      } finally {
        setSubmitting(false);
      }
    },
    [user]
  );

  return { submitReport, submitting };
}
