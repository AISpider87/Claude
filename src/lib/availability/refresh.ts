import "server-only";
import { after } from "next/server";
import { availabilityProviderWithEndpoints, supabaseAvailabilityDb } from "@/lib/availability/db";
import { PROVIDER_KEY_VAR, selectedProviderName } from "@/lib/availability/provider";
import { runAvailabilitySync } from "@/lib/availability/run";
import { createServiceClient } from "@/lib/supabase/service";

/** Fifteen minutes: the pg_cron job's cadence, and the fallback's too. */
const STALE_SECONDS = 15 * 60;

/**
 * Fallback for the scheduled job: if nobody has refreshed the feed in the last
 * quarter of an hour, the next authenticated page load does it in the
 * background. Costs the request nothing (everything happens in `after()`), and
 * the claim is a single atomic upsert in the database, so two page loads
 * arriving together can never both start a run.
 */
export function refreshAvailabilityIfStale() {
  const provider = selectedProviderName();
  const keyVar = provider ? PROVIDER_KEY_VAR[provider] : null;
  if (!keyVar || !process.env[keyVar]?.trim()) return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  after(async () => {
    try {
      const service = createServiceClient();
      const { data, error } = await service.rpc("claim_availability_refresh", {
        p_max_age_seconds: STALE_SECONDS,
      });
      if (error || data !== true) return; // somebody else has it
      await runAvailabilitySync(
        await availabilityProviderWithEndpoints(service),
        supabaseAvailabilityDb(service),
      );
    } catch {
      // ignore: the next page load (or the cron) retries
    }
  });
}
