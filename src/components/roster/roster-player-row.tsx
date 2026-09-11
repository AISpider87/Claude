import { useId } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { formatDate, formatDelta, formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { PlayerAvailability } from "@/lib/supabase/database.types";
import { ROLE_LABEL, ROLE_LABEL_SINGULAR } from "@/lib/roles";
import type { RosterRow } from "@/lib/teams/queries";
import { cn } from "@/lib/utils";

/**
 * One player of the manager's roster, where the market operations happen:
 * avatar, name + role, club · price paid · delta vs Qt.A, the Qt.A itself and
 * an availability chip with its source. Server-friendly: no client state, the
 * `actions` slot receives whatever buttons the page needs.
 */

export interface RosterPlayer {
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  qtA: number;
  pricePaid: number;
  outOfList: boolean;
}

/** The row shape the pages get from `getTeamRoster`, as the row component expects it. */
export function toRosterPlayer(row: RosterRow): RosterPlayer {
  return {
    id: row.player.id,
    name: row.player.name,
    team: row.player.team,
    role: row.player.role_classic,
    qtA: row.player.qt_a,
    pricePaid: row.pricePaid,
    outOfList: row.player.status === "out_of_list",
  };
}

export type PlayerStatusKind = "ok" | "injured" | "doubtful" | "suspended" | "unavailable";

export interface PlayerStatus {
  kind: PlayerStatusKind;
  /** Short Italian label shown in the chip ("Infortunato", "In dubbio"…). */
  label: string;
  source?: { name: string; url: string };
  /** ISO timestamp (UTC) of the last update; rendered in Europe/Rome. */
  updatedAt?: string;
}

/** Chip labels; the DB kinds mirror `STATUS_LABEL` in `@/lib/players/status`. */
export const PLAYER_STATUS_LABEL: Record<PlayerStatusKind, string> = {
  ok: "Disponibile",
  injured: "Infortunato",
  doubtful: "In dubbio",
  suspended: "Squalificato",
  unavailable: "Indisponibile",
};

/** A `player_status` row (Admin → Indisponibili) as the chip expects it. */
export function availabilityToStatus(row: PlayerAvailability): PlayerStatus {
  const status: PlayerStatus = {
    kind: row.kind,
    label: PLAYER_STATUS_LABEL[row.kind],
    updatedAt: row.updated_at,
  };
  if (row.source_name && row.source_url) {
    status.source = { name: row.source_name, url: row.source_url };
  }
  return status;
}

export const AVAILABLE_STATUS: PlayerStatus = { kind: "ok", label: PLAYER_STATUS_LABEL.ok };

/**
 * Chip of a roster player from the `player_status` table (missing row =
 * available). Out-of-list players get none: the "fuori lista" badge says it all.
 */
export function toPlayerStatus(
  row: PlayerAvailability | undefined,
  outOfList: boolean,
): PlayerStatus | undefined {
  if (outOfList) return undefined;
  return row ? availabilityToStatus(row) : AVAILABLE_STATUS;
}

export interface RosterPlayerRowProps {
  player: RosterPlayer;
  status?: PlayerStatus;
  /** Buttons for the operations (Svincola / Acquista…), rendered bottom-right. */
  actions?: React.ReactNode;
  className?: string;
}

/* Dot colours reuse the role tokens so the palette stays within docs/DESIGN.md. */
const STATUS_DOT: Record<PlayerStatusKind, string> = {
  ok: "bg-role-d",
  injured: "bg-danger",
  doubtful: "bg-role-p",
  suspended: "bg-muted",
  unavailable: "bg-muted",
};

const STATUS_TEXT: Record<PlayerStatusKind, string> = {
  ok: "text-foreground",
  injured: "text-danger",
  doubtful: "text-foreground",
  suspended: "text-muted",
  unavailable: "text-muted",
};

export function PlayerStatusChip({
  status,
  className,
}: {
  status: PlayerStatus;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-medium whitespace-nowrap",
          STATUS_TEXT[status.kind],
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status.kind])} aria-hidden />
        {status.label}
      </span>
      {status.source && (
        <a
          href={status.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-0.5 whitespace-nowrap underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          aria-label={`Fonte: ${status.source.name} (si apre in una nuova scheda)`}
        >
          fonte: {status.source.name}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
      {status.updatedAt && (
        <span className="text-muted">aggiornato il {formatDate(status.updatedAt)}</span>
      )}
    </span>
  );
}

function Delta({ value }: { value: number }) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const tone = value > 0 ? "text-role-d" : value < 0 ? "text-danger" : "text-muted";
  return (
    <span
      className={cn("tabular inline-flex items-center gap-0.5 font-medium", tone)}
      aria-label={`Quotazione ${formatDelta(value)} rispetto al prezzo pagato`}
    >
      <Icon className="size-3.5" aria-hidden />
      {formatDelta(value)}
    </span>
  );
}

export function RosterPlayerRow({ player, status, actions, className }: RosterPlayerRowProps) {
  const delta = player.qtA - player.pricePaid;
  return (
    <div
      className={cn(
        "avatar-host border-line bg-surface/60 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-[var(--radius-control)] border p-3",
        className,
      )}
    >
      <PlayerAvatar
        id={player.id}
        name={player.name}
        team={player.team}
        role={player.role}
        outOfList={player.outOfList}
        size="md"
        showRole={false}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-sm leading-tight">
          <span className="truncate font-semibold">{player.name}</span>
          <RoleBadge role={player.role} className="size-5 text-[10px]" />
          {player.outOfList && <Badge variant="danger">fuori lista</Badge>}
        </p>
        <p className="text-muted flex flex-wrap items-center gap-x-1.5 text-xs">
          <span className="truncate">{player.team}</span>
          <span aria-hidden>·</span>
          <span className="tabular whitespace-nowrap">pagato {formatInt(player.pricePaid)}</span>
          <span aria-hidden>·</span>
          <Delta value={delta} />
        </p>
      </div>
      <p className="flex shrink-0 flex-col items-end leading-none">
        <span className="text-muted text-[10px] font-semibold tracking-wide uppercase">Qt.A</span>
        <span className="font-display tabular text-2xl font-semibold">{formatInt(player.qtA)}</span>
      </p>
      {(status || actions) && (
        // Bottom line, indented under the name: status on the left, operations on the right.
        <div className="flex basis-full items-center justify-between gap-3 pl-15">
          {status && <PlayerStatusChip status={status} className="min-w-0 flex-1" />}
          {actions && <div className="ml-auto flex shrink-0 gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}

export interface RosterGroup {
  role: RoleClassic;
  /** Slots the rules require for this role (e.g. 7 for D). */
  target: number;
  items: Omit<RosterPlayerRowProps, "className">[];
}

/** "Difensori 6/7 · 1 posto da riempire": the header of a role section. */
export function RosterGroupHeading({
  id,
  role,
  count,
  target,
  missing = target - count,
}: {
  id: string;
  role: RoleClassic;
  count: number;
  target: number;
  /** Holes as the server computes them; defaults to `target - count`. */
  missing?: number;
}) {
  return (
    <h4
      id={id}
      className="text-muted mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase"
    >
      <RoleBadge role={role} className="size-5 text-[10px]" />
      {ROLE_LABEL[role]}
      <span className="tabular">
        {formatInt(count)}/{formatInt(target)}
      </span>
      {missing > 0 && (
        <span className="text-danger normal-case">
          · {missing === 1 ? "1 posto da riempire" : `${formatInt(missing)} posti da riempire`}
        </span>
      )}
      {missing < 0 && (
        <span className="text-danger normal-case">· {formatInt(-missing)} in più della regola</span>
      )}
    </h4>
  );
}

export function EmptyRoleNote({ role }: { role: RoleClassic }) {
  return (
    <p className="text-muted text-sm">{`Nessun ${ROLE_LABEL_SINGULAR[role].toLowerCase()} in rosa.`}</p>
  );
}

/** Roster sections per role with the "Difensori 6/7 · 1 posto da riempire" header. */
export function RosterPlayerList({
  groups,
  className,
}: {
  groups: RosterGroup[];
  className?: string;
}) {
  const uid = useId();
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {groups.map(({ role, target, items }) => {
        const headingId = `${uid}-${role}`;
        return (
          <section key={role} aria-labelledby={headingId}>
            <RosterGroupHeading id={headingId} role={role} count={items.length} target={target} />
            {items.length === 0 ? (
              <EmptyRoleNote role={role} />
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {items.map((item) => (
                  <li key={item.player.id}>
                    <RosterPlayerRow {...item} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
