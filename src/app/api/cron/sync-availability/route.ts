import { NextResponse, type NextRequest } from "next/server";
import { supabaseAvailabilityDb } from "@/lib/availability/db";
import { availabilityProviderFromEnv } from "@/lib/availability/provider";
import { runAvailabilitySync } from "@/lib/availability/run";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Availability/lineup job, every 15 minutes. Vercel Hobby only allows one cron
 * a day, so the schedule lives in Supabase (pg_cron + pg_net, see
 * supabase/deploy/updates/2026-09-11-availability-cron.sql); the app's own
 * page loads are the fallback (src/lib/availability/refresh.ts).
 *
 * At most 3 API requests per run: injuries, next fixtures, and the lineups of
 * the fixture about to kick off (skipped when none is).
 */
/**
 * Two ways in: the Vercel CRON_SECRET, or the token the database generates for
 * the pg_cron schedule (Admin → Indisponibili shows it). The second exists
 * because a protected Vercel value cannot be read back to paste it into SQL.
 */
async function authorised(request: NextRequest, supabase: ReturnType<typeof createServiceClient>) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && token === secret) return true;
  const { data, error } = await supabase.rpc("verify_cron_token", { p_token: token });
  return !error && data === true;
}

export async function GET(request: NextRequest) {
  const logs: string[] = [];
  try {
    const supabase = createServiceClient();
    if (!(await authorised(request, supabase))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const outcome = await runAvailabilitySync(
      availabilityProviderFromEnv(),
      supabaseAvailabilityDb(supabase),
      (m) => logs.push(m),
    );
    return NextResponse.json({ ok: outcome.status !== "failed", outcome, logs });
  } catch (e) {
    const error = e instanceof Error ? e.message : "sync crashed";
    return NextResponse.json({ ok: false, error, logs }, { status: 500 });
  }
}
