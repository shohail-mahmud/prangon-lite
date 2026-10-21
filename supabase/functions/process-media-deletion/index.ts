/**
 * Prangon Lite — retryable storage cleanup worker.
 *
 * WHY THIS EXISTS
 *   `delete_post_permanently()` runs in a database transaction. Storage
 *   deletion is an HTTP call to a different service and CANNOT join that
 *   transaction. If we deleted the row and then failed to delete the object,
 *   the bytes would be orphaned forever with no record that it happened.
 *
 *   So the RPC writes an outbox row, and this worker drains it:
 *     - claim a batch with FOR UPDATE SKIP LOCKED (safe to run concurrently)
 *     - delete each object from storage
 *     - on success  -> status 'done'
 *     - on failure  -> increment attempts, exponential backoff, retry later
 *     - exhausted   -> status 'failed', kept for manual inspection
 *
 *   A failed row is NEVER discarded, so a partial failure cannot silently
 *   leave orphaned media.
 *
 * SCHEDULING (manual step — see final report):
 *   Run this every few minutes via pg_cron + pg_net, an external cron, or call
 *   it by hand. It is idempotent and safe to invoke concurrently.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BATCH_SIZE = 50;
const MAX_BACKOFF_MINUTES = 60;

function backoffMinutes(attempts: number): number {
  // 1, 2, 4, 8, 16, 32, 60, 60 ...
  return Math.min(2 ** Math.min(attempts, 6), MAX_BACKOFF_MINUTES);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Shared-secret gate for schedulers, OR a valid service-role key.
  const expected = Deno.env.get("MEDIA_CLEANUP_TOKEN");
  const provided = req.headers.get("x-media-cleanup-token");
  const authHeader = req.headers.get("Authorization") ?? "";

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isServiceRole = authHeader.replace("Bearer ", "").trim() === serviceKey;
  const isScheduler = !!expected && provided === expected;

  if (!isServiceRole && !isScheduler) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // ---- 1. Claim a batch atomically ---------------------------------------
  const { data: claimed, error: claimErr } = await admin.rpc("lite_claim_media_deletions", {
    p_batch: BATCH_SIZE,
  });

  if (claimErr) {
    return new Response(
      JSON.stringify({ ok: false, error: claimErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const rows = (claimed ?? []) as {
    id: string;
    bucket: string;
    path: string;
    attempts: number;
    max_attempts: number;
  }[];

  let done = 0;
  let retried = 0;
  let failed = 0;
  const errors: { id: string; error: string }[] = [];

  // ---- 2. Process each claimed row ---------------------------------------
  for (const row of rows) {
    const { error: rmErr } = await admin.storage.from(row.bucket).remove([row.path]);

    if (!rmErr) {
      await admin
        .from("media_deletion_outbox")
        .update({ status: "done", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      done++;
      continue;
    }

    // "Not found" means the object is already gone — that is success.
    const msg = rmErr.message ?? String(rmErr);
    if (/not found|does not exist|no such/i.test(msg)) {
      await admin
        .from("media_deletion_outbox")
        .update({
          status: "done",
          processed_at: new Date().toISOString(),
          last_error: "object already absent",
        })
        .eq("id", row.id);
      done++;
      continue;
    }

    const attempts = row.attempts + 1;

    if (attempts >= row.max_attempts) {
      await admin
        .from("media_deletion_outbox")
        .update({
          status: "failed",
          attempts,
          last_error: msg,
          next_attempt_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed++;
      errors.push({ id: row.id, error: msg });
      continue;
    }

    const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000);
    await admin
      .from("media_deletion_outbox")
      .update({
        status: "failed",
        attempts,
        last_error: msg,
        next_attempt_at: next.toISOString(),
      })
      .eq("id", row.id);
    retried++;
    errors.push({ id: row.id, error: `${msg} (retry ${attempts}/${row.max_attempts})` });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      claimed: rows.length,
      done,
      retried,
      failed_permanently: failed,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
