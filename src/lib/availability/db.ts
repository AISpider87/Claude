import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BSD_PROVIDER,
  availabilityProviderFromEnv,
  selectedProviderName,
  type AvailabilityProvider,
} from "@/lib/availability/provider";
import { capSamples } from "@/lib/availability/shared";
import type { AvailabilityDb, AvailabilityPayload } from "@/lib/availability/run";
import type { Database, Json } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";

/**
 * AvailabilityDb backed by a Supabase client. The write goes through
 * `sync_availability`, which only the service role may call — so this must be
 * built with the service client (cron, or the admin's "Aggiorna adesso").
 */
export function supabaseAvailabilityDb(supabase: SupabaseClient<Database>): AvailabilityDb {
  return {
    async loadPlayers() {
      // Out-of-list players are loaded too: they make homonyms visible, and
      // the matcher prefers the active one of a pair.
      return fetchAll(() =>
        supabase.from("players").select("id, name, team, role_classic, qt_a, status").order("id"),
      );
    },
    async loadMappings(provider) {
      const { data, error } = await supabase
        .from("external_player_map")
        .select("external_id, player_id, confidence")
        .eq("provider", provider);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async applyFeed(payload: AvailabilityPayload) {
      const { data, error } = await supabase.rpc("sync_availability", {
        p_payload: payload as unknown as Json,
      });
      if (error) throw new Error(error.message);
      return (data ?? {}) as Record<string, unknown>;
    },
    async saveDiagnostics({ provider, endpoints, samples }) {
      const { error } = await supabase.rpc("save_availability_diagnostics", {
        p_provider: provider,
        p_endpoints: (endpoints ?? null) as unknown as Json,
        p_samples: capSamples(samples) as unknown as Json,
      });
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * The configured provider, with the endpoint paths a previous run discovered
 * (BSD only — API-Football's paths are fixed). One settings read per run.
 */
export async function availabilityProviderWithEndpoints(
  supabase: SupabaseClient<Database>,
): Promise<AvailabilityProvider | null> {
  let endpoints: unknown = null;
  if (selectedProviderName() === BSD_PROVIDER) {
    const { data } = await supabase.rpc("availability_endpoints");
    endpoints = data ?? null;
  }
  return availabilityProviderFromEnv(process.env, { endpoints });
}
