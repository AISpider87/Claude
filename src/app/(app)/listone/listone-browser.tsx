"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInt } from "@/lib/format";
import { normalizeName } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { cn } from "@/lib/utils";

export interface ListoneRow {
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  qtA: number;
  qtI: number;
  fvm: number | null;
  status: "active" | "out_of_list";
  owned: boolean;
}

type SortKey = "qtA" | "name" | "fvm";
const ROLES: RoleClassic[] = ["P", "D", "C", "A"];
const PAGE = 100;

export function ListoneBrowser({ rows }: { rows: ListoneRow[] }) {
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<Set<RoleClassic>>(new Set());
  const [team, setTeam] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const [maxQt, setMaxQt] = useState<number | "">("");
  const [sort, setSort] = useState<SortKey>("qtA");
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team))].sort(), [rows]);
  const indexed = useMemo(() => rows.map((r) => ({ r, key: normalizeName(r.name) })), [rows]);

  const filtered = useMemo(() => {
    const q = normalizeName(deferredQuery);
    const out = indexed
      .filter(({ r, key }) => {
        if (!showOut && r.status === "out_of_list") return false;
        if (onlyFree && (r.owned || r.status === "out_of_list")) return false;
        if (roles.size > 0 && !roles.has(r.role)) return false;
        if (team && r.team !== team) return false;
        if (maxQt !== "" && r.qtA > maxQt) return false;
        if (q && !key.includes(q)) return false;
        return true;
      })
      .map(({ r }) => r);
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "fvm") return (b.fvm ?? -1) - (a.fvm ?? -1) || b.qtA - a.qtA;
      return b.qtA - a.qtA || a.name.localeCompare(b.name);
    });
    return out;
  }, [indexed, deferredQuery, roles, team, onlyFree, showOut, maxQt, sort]);

  const visible = filtered.slice(0, limit);

  function toggleRole(role: RoleClassic) {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
    setLimit(PAGE);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-background/95 sticky top-[calc(3rem+env(safe-area-inset-top))] z-10 -mx-4 flex flex-col gap-2 px-4 py-2.5 backdrop-blur lg:static lg:mx-0 lg:px-0">
        <label className="relative block">
          <Search
            className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Cerca un calciatore…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            className="pl-9"
            aria-label="Cerca un calciatore"
            autoComplete="off"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              aria-pressed={roles.has(role)}
              className={cn(
                "border-line pressable inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm transition-colors",
                roles.has(role)
                  ? "border-primary bg-primary/10 text-primary shadow-[var(--glow-primary)]"
                  : "text-muted",
              )}
            >
              <RoleBadge role={role} className="size-5 text-[10px]" /> {role}
            </button>
          ))}
          <label className="border-line inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm">
            <input
              type="checkbox"
              checked={onlyFree}
              onChange={(e) => {
                setOnlyFree(e.target.checked);
                setLimit(PAGE);
              }}
              className="accent-primary size-4"
            />
            Solo svincolati
          </label>
          <select
            value={team}
            onChange={(e) => {
              setTeam(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Filtra per squadra di Serie A"
            className="border-line bg-surface min-h-11 rounded-full border px-3 text-sm"
          >
            <option value="">Tutte le squadre</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={maxQt}
            onChange={(e) => {
              setMaxQt(e.target.value === "" ? "" : Number(e.target.value));
              setLimit(PAGE);
            }}
            aria-label="Quotazione massima"
            className="border-line bg-surface min-h-11 rounded-full border px-3 text-sm"
          >
            <option value="">Qualsiasi quotazione</option>
            {[5, 10, 15, 20, 30].map((n) => (
              <option key={n} value={n}>
                Qt.A ≤ {n}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Ordina"
            className="border-line bg-surface min-h-11 rounded-full border px-3 text-sm"
          >
            <option value="qtA">Quotazione</option>
            <option value="fvm">Valore di mercato</option>
            <option value="name">Nome</option>
          </select>
          <label className="text-muted inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showOut}
              onChange={(e) => setShowOut(e.target.checked)}
              className="accent-primary size-4"
            />
            Mostra fuori lista
          </label>
        </div>
      </div>

      <p className="text-muted text-sm" aria-live="polite">
        {formatInt(filtered.length)} risultati
      </p>

      <Table>
        <THead>
          <TR>
            <TH>R</TH>
            <TH>Calciatore</TH>
            <TH>Squadra</TH>
            <TH className="text-right">Qt.A</TH>
            <TH className="text-right">Qt.I</TH>
            <TH className="text-right">FVM</TH>
            <TH>Stato</TH>
          </TR>
        </THead>
        <TBody>
          {visible.map((r) => (
            <TR key={r.id}>
              <TD>
                <RoleBadge role={r.role} className="size-5 text-[10px]" />
              </TD>
              <TD className="font-medium">
                <Link href={`/listone/${r.id}`} className="hover:text-primary">
                  {r.name}
                </Link>
              </TD>
              <TD className="text-muted">{r.team}</TD>
              <TD className="tabular text-right font-semibold">{formatInt(r.qtA)}</TD>
              <TD className="tabular text-muted text-right">{formatInt(r.qtI)}</TD>
              <TD className="tabular text-muted text-right">{formatInt(r.fvm)}</TD>
              <TD>
                {r.status === "out_of_list" ? (
                  <Badge variant="danger">fuori lista</Badge>
                ) : r.owned ? (
                  <Badge variant="muted">in rosa</Badge>
                ) : (
                  <Badge variant="primary">svincolato</Badge>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="border-line hover:border-primary/60 glow-primary pressable min-h-11 rounded-[var(--radius-control)] border text-sm font-medium"
        >
          Mostra altri {formatInt(Math.min(PAGE, filtered.length - limit))}
        </button>
      )}
    </div>
  );
}
