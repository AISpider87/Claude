import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseSyncDb } from "@/lib/sync/db";
import { runQuotationsSync } from "@/lib/sync/run";
import { quotationSourceFromEnv } from "@/lib/sync/source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (Vercel Cron, see vercel.json): downloads and applies the quotations
 * when a source is configured, and in any case touches the database so the free
 * Supabase project never pauses for inactivity.
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
    const outcome = await runQuotationsSync(
      quotationSourceFromEnv(),
      supabaseSyncDb(supabase),
      (m) => logs.push(m),
    );
    return NextResponse.json({ ok: outcome.status !== "failed", outcome, logs });
  } catch (e) {
    const error = e instanceof Error ? e.message : "sync crashed";
    return NextResponse.json({ ok: false, error, logs }, { status: 500 });
  }
}
