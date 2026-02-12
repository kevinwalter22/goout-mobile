/**
 * Cleanup Orphaned Media Files
 *
 * Deletes post media files from storage that have no matching post record.
 * This handles cases where upload succeeded but DB insert failed/crashed.
 *
 * Design:
 * - Only deletes files older than 1 hour (safety margin)
 * - Uses service role for storage access
 * - Can be called by cron job (hourly) or manually
 * - Logs all deletions for audit
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET_NAME = "posts";
const MAX_AGE_HOURS = 1; // Only delete files older than this

interface CleanupResult {
  total_files_checked: number;
  orphaned_files_found: number;
  files_deleted: number;
  errors: string[];
  deleted_paths: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Optional dry_run mode from body
    let dryRun = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        dryRun = body.dry_run === true;
      } catch {
        // Empty body is OK
      }
    }

    // Create Supabase client with service role (needed for storage operations)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const result: CleanupResult = {
      total_files_checked: 0,
      orphaned_files_found: 0,
      files_deleted: 0,
      errors: [],
      deleted_paths: [],
    };

    console.log(`Starting orphaned media cleanup (dry_run=${dryRun})`);

    // List all folders (user IDs) in the bucket
    const { data: folders, error: foldersError } = await supabase.storage
      .from(BUCKET_NAME)
      .list("", { limit: 1000 });

    if (foldersError) {
      throw new Error(`Failed to list folders: ${foldersError.message}`);
    }

    if (!folders || folders.length === 0) {
      console.log("No folders found in bucket");
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cutoffTime = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
    console.log(`Cutoff time: ${cutoffTime.toISOString()}`);

    // Process each user folder
    for (const folder of folders) {
      if (!folder.name) continue;

      // List files in this user's folder
      const { data: files, error: filesError } = await supabase.storage
        .from(BUCKET_NAME)
        .list(folder.name, { limit: 1000 });

      if (filesError) {
        result.errors.push(
          `Failed to list files in ${folder.name}: ${filesError.message}`
        );
        continue;
      }

      if (!files || files.length === 0) continue;

      for (const file of files) {
        if (!file.name || !file.created_at) continue;

        result.total_files_checked++;

        const filePath = `${folder.name}/${file.name}`;
        const fileCreatedAt = new Date(file.created_at);

        // Skip files newer than cutoff (safety margin)
        if (fileCreatedAt > cutoffTime) {
          continue;
        }

        // Check if this file has a matching post record
        // File naming convention: {postId}-back.jpg or {postId}-front.jpg
        const postIdMatch = file.name.match(/^([a-f0-9-]+)-(back|front)\.jpg$/);
        if (!postIdMatch) {
          // Unexpected file format - skip
          continue;
        }

        const postId = postIdMatch[1];

        // Check if post exists with this ID and photo_path
        const { data: post, error: postError } = await supabase
          .from("posts")
          .select("id")
          .eq("id", postId)
          .maybeSingle();

        if (postError) {
          result.errors.push(`Error checking post ${postId}: ${postError.message}`);
          continue;
        }

        // If no matching post found, this file is orphaned
        if (!post) {
          result.orphaned_files_found++;
          console.log(`Orphaned file: ${filePath} (created ${fileCreatedAt.toISOString()})`);

          if (!dryRun) {
            // Delete the orphaned file
            const { error: deleteError } = await supabase.storage
              .from(BUCKET_NAME)
              .remove([filePath]);

            if (deleteError) {
              result.errors.push(`Failed to delete ${filePath}: ${deleteError.message}`);
            } else {
              result.files_deleted++;
              result.deleted_paths.push(filePath);
              console.log(`  Deleted: ${filePath}`);
            }
          } else {
            result.deleted_paths.push(filePath);
            console.log(`  Would delete (dry run): ${filePath}`);
          }
        }
      }
    }

    console.log(
      `Cleanup complete: checked ${result.total_files_checked} files, ` +
        `found ${result.orphaned_files_found} orphaned, ` +
        `deleted ${result.files_deleted}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        result,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
