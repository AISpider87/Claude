import "server-only";
import type { PlayerAvailability, PlayerStatusKind } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export const STATUS_LABEL: Record<PlayerStatusKind, string> = {
  injured: "Infortunato",
  doubtful: "In dubbio",
  suspended: "Squalificato",
  unavailable: "Indisponibile",
};

/** Availability of the given players, keyed by player id (missing = available). */
export async function getPlayerStatuses(
  playerIds: number[],
): Promise<Map<number, PlayerAvailability>> {
  const map = new Map<number, PlayerAvailability>();
  if (playerIds.length === 0) return map;
  const supabase = await createClient();
  for (let i = 0; i < playerIds.length; i += 500) {
    const { data } = await supabase
      .from("player_status")
      .select("*")
      .in("player_id", playerIds.slice(i, i + 500));
    for (const row of data ?? []) map.set(row.player_id, row);
  }
  return map;
}

export interface PlayerStatusListItem extends PlayerAvailability {
  name: string;
  team: string;
  role: "P" | "D" | "C" | "A";
}

/** Every current status with the player's name, newest first (admin page). */
export async function listPlayerStatuses(): Promise<PlayerStatusListItem[]> {
  const supabase = await createClient();
  const rows = await fetchAll(() =>
    supabase.from("player_status").select("*").order("updated_at", { ascending: false }),
  );
  if (rows.length === 0) return [];
  const { data: players } = await supabase
    .from("players")
    .select("id, name, team, role_classic")
    .in(
      "id",
      rows.map((r) => r.player_id),
    );
  const byId = new Map((players ?? []).map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const p = byId.get(r.player_id);
    return p ? [{ ...r, name: p.name, team: p.team, role: p.role_classic }] : [];
  });
}
