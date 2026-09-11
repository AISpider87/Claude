import { useId } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { formatDate, formatDelta, formatInt, formatTime } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { PlayerAvailability, PlayerLineup } from "@/lib/supabase/database.types";
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

export interface PlayerLineupState {
  state: "starting" | "bench";
  /** ISO timestamp (UTC) of the kick-off; rendered in Europe/Rome. */
  kickoff: string;
  /** Who published the lineup ("API-Football"). */
  sourceName: string;
}

export interface PlayerStatus {
  kind: PlayerStatusKind;
  /** Short Italian label shown in the chip ("Infortunato", "In dubbio"…). */
  label: string;
  source?: { name: string; url: string };
  /** ISO timestamp (UTC) of the last update; rendered in Europe/Rome. */
  updatedAt?: string;
  /** Official lineup of the imminent fixture, when one has been published. */
  lineup?: PlayerLineupState;
}

export const LINEUP_LABEL: Record<PlayerLineupState["state"], string> = {
  starting: "Titolare",
  bench: "In panchina",
};

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

/** A `player_lineup_status` row as the chip expects it (null = nothing to show). */
export function toLineupState(
  row: PlayerLineup | undefined,
  sourceName = "API-Football",
): PlayerLineupState | undefined {
  if (!row?.kickoff) return undefined;
  return { state: row.state, kickoff: row.kickoff, sourceName };
}

/**
 * Chip of a roster player from the `player_status` table (missing row =
 * available). Out-of-list players get none: the "fuori lista" badge says it all.
 * The optional lineup row adds "Titolare"/"In panchina" for the next fixture.
 */
export function toPlayerStatus(
  row: PlayerAvailability | undefined,
  outOfList: boolean,
  lineup?: PlayerLineup,
): PlayerStatus | undefined {
  if (outOfList) return undefined;
  const status = row ? availabilityToStatus(row) : { ...AVAILABLE_STATUS };
  const state = toLineupState(lineup);
  return state ? { ...status, lineup: state } : status;
}

export interface RosterPlayerRowProps {
  player: RosterPlayer;
  status?: PlayerStatus;
  /** Buttons for the operations (Svincola / Acquista…), rendered on the right. */
  actions?: React.ReactNode;
  className?: string;
  /** Inline style, used by the lists to carry the `--enter-delay` of the stagger. */
  style?: React.CSSProperties;
}

/* Dot colours reuse the role tokens so the palette stays within docs/DESIGN.md. */
const STATUS_DOT: Record<PlayerStatusKind, string> = {
  ok: "bg-role-d",
  injured: "bg-danger",
  doubtful: "bg-role-p",
  suspended: "bg-muted",
  unavailable: "bg-muted",
};

/* Thin lit rail on the left edge of a row: the role colour, next to the letter. */
const ROLE_RAIL: Record<RoleClassic, string> = {
  P: "bg-role-p",
  D: "bg-role-d",
  C: "bg-role-c",
  A: "bg-role-a",
};

const STATUS_TEXT: Record<PlayerStatusKind, string> = {
  ok: "text-foreground",
  injured: "text-danger",
  doubtful: "text-foreground",
  suspended: "text-muted",
  unavailable: "text-muted",
};

/** Source name and last update: behind the chip's tooltip, never a third line. */
function statusTooltip(status: PlayerStatus): string | undefined {
  const parts = [
    status.source ? `fonte: ${status.source.name}` : null,
    status.updatedAt ? `aggiornato il ${formatDate(status.updatedAt)}` : null,
    status.lineup ? `${status.lineup.sourceName} · ore ${formatTime(status.lineup.kickoff)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** A status worth a chip: everything except "available with nothing to add". */
export function isNotableStatus(status: PlayerStatus): boolean {
  return status.kind !== "ok" || Boolean(status.lineup);
}

export function PlayerStatusChip({
  status,
  className,
}: {
  status: PlayerStatus;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px]", className)}
      title={statusTooltip(status)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium whitespace-nowrap",
          STATUS_TEXT[status.kind],
        )}
      >
        <span
          className={cn("lit-dot size-1.5 shrink-0 rounded-full", STATUS_DOT[status.kind])}
          aria-hidden
        />
        {status.label}
      </span>
      {status.lineup && (
        <Badge
          variant={status.lineup.state === "starting" ? "primary" : "muted"}
          className="px-1.5 py-0 text-[10px]"
        >
          {LINEUP_LABEL[status.lineup.state]}
        </Badge>
      )}
      {status.source && (
        <a
          href={status.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary tap-expand focus-visible:ring-primary inline-flex shrink-0 items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Fonte: ${status.source.name} (si apre in una nuova scheda)`}
        >
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </span>
  );
}

/** "Disponibile" with nothing else to say: a lit dot, label for screen readers. */
function AvailableDot({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center" title={label}>
      <span className="lit-dot bg-role-d size-1.5 rounded-full" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Delta({ value }: { value: number }) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const tone = value > 0 ? "text-role-d" : value < 0 ? "text-danger" : "text-muted";
  return (
    <span
      className={cn("tabular inline-flex shrink-0 items-center gap-0.5 font-medium", tone)}
      aria-label={`Quotazione ${formatDelta(value)} rispetto al prezzo pagato`}
    >
      <Icon className="size-3" aria-hidden />
      {formatDelta(value)}
    </span>
  );
}

/**
 * Compact row: avatar 40, two lines of text, the Qt.A in a stat capsule on the
 * right and the operations next to it. A real status (injury, doubt, published
 * line-up) adds a discreet chip on the second line; "available" is just a dot.
 */
export function RosterPlayerRow({
  player,
  status,
  actions,
  className,
  style,
}: RosterPlayerRowProps) {
  const delta = player.qtA - player.pricePaid;
  const notable = status ? isNotableStatus(status) : false;
  return (
    <div
      style={style}
      className={cn(
        "avatar-host row-lit pressable border-line bg-surface/60 flex items-center gap-2 overflow-hidden rounded-[var(--radius-control)] border py-2 pr-1.5 pl-2.5",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", ROLE_RAIL[player.role])}
      />
      <PlayerAvatar
        id={player.id}
        name={player.name}
        team={player.team}
        role={player.role}
        outOfList={player.outOfList}
        size="sm"
        showRole={false}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex min-w-0 items-center gap-1.5 text-sm leading-tight">
          <span className="truncate font-semibold">{player.name}</span>
          <RoleBadge role={player.role} className="size-4.5 shrink-0 text-[10px]" />
          {player.outOfList && (
            <Badge variant="danger" className="shrink-0 px-1.5 py-0 text-[10px]">
              fuori lista
            </Badge>
          )}
          {status && !notable && <AvailableDot label={status.label} />}
        </p>
        {/* One line, always: club · price paid · delta. The club truncates. */}
        <p className="text-muted mt-0.5 flex min-w-0 items-center gap-x-1.5 text-[11px] leading-tight">
          <span className="truncate" title={player.team}>
            {player.team}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular shrink-0 whitespace-nowrap">
            pagato {formatInt(player.pricePaid)}
          </span>
          <Delta value={delta} />
        </p>
        {/* A real status (injury, doubt, published line-up) earns a third line. */}
        {status && notable && (
          <PlayerStatusChip status={status} className="mt-0.5 min-w-0 self-start" />
        )}
      </div>
      <p className="stat-capsule shrink-0">
        <span className="text-muted text-[9px] font-semibold tracking-wide uppercase">Qt.A</span>
        <span className="font-display tabular text-lg font-semibold">{formatInt(player.qtA)}</span>
      </p>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
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
      className="sticky-group text-muted border-line/70 mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border-b px-1 py-1.5 text-[11px] font-semibold uppercase"
    >
      <RoleBadge role={role} className="lit-badge size-4.5 text-[10px]" />
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

/**
 * Entrance delay of a row: 24 ms apart, capped so a full 23-player roster is
 * completely on screen in under a third of a second. Read by `.enter-row`.
 */
export function enterDelay(index: number): React.CSSProperties {
  return { "--enter-delay": `${Math.min(index * 24, 280)}ms` } as React.CSSProperties;
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
  let index = 0;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {groups.map(({ role, target, items }) => {
        const headingId = `${uid}-${role}`;
        return (
          <section key={role} aria-labelledby={headingId}>
            <RosterGroupHeading id={headingId} role={role} count={items.length} target={target} />
            {items.length === 0 ? (
              <EmptyRoleNote role={role} />
            ) : (
              <ul className="grid gap-1.5 lg:grid-cols-2 2xl:grid-cols-3">
                {items.map((item) => (
                  <li
                    key={item.player.id}
                    className="enter-row min-w-0"
                    style={enterDelay(index++)}
                  >
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
