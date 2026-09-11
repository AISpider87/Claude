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
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];
  try {
    const supabase = createServiceClient();
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
