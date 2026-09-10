import "server-only";
import { requireAdmin } from "@/lib/auth/dal";
import type { ListonePlayer } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { ParsedRosters } from "@/lib/import/rosters-parser";
import {
  buildRostersPreview,
  type ManualResolutions,
  type OutOfListMarks,
} from "@/lib/import/rosters-preview";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export async function loadListone(): Promise<ListonePlayer[]> {
  const supabase = await createClient();
  return fetchAll(() =>
    supabase.from("players").select("id, name, team, role_classic, qt_a, status").order("id"),
  );
}

export async function loadSettings() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_settings")
    .select("key, value")
    .in("key", ["initial_budget", "roster_composition"]);
  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  const budget = Number(map.get("initial_budget") ?? 250);
  const comp = (map.get("roster_composition") ?? { P: 3, D: 7, C: 7, A: 6 }) as Record<
    RoleClassic,
    number
  >;
  return { initialBudget: Number.isFinite(budget) ? budget : 250, composition: comp };
}

/** Rebuilds the preview for an import from its stored parsed file. Admin only. */
export async function loadRostersPreview(
  importId: string,
  choices: {
    resolutions?: ManualResolutions;
    outOfList?: OutOfListMarks;
    outOfListAll?: boolean;
  } = {},
) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: imp } = await supabase
    .from("imports")
    .select("id, kind, file_name, status, payload, stats, error, created_at, applied_at")
    .eq("id", importId)
    .maybeSingle();
  if (!imp || imp.kind !== "rosters") return null;

  const payload = (imp.payload ?? {}) as { parsed?: ParsedRosters };
  if (imp.status !== "previewed" || !payload.parsed) return { imp, preview: null };

  const [listone, { data: teams }, settings] = await Promise.all([
    loadListone(),
    supabase.from("teams").select("name"),
    loadSettings(),
  ]);
  const preview = buildRostersPreview(
    payload.parsed,
    listone,
    (teams ?? []).map((t) => t.name),
    { ...settings, ...choices },
  );
  return { imp, preview };
}
