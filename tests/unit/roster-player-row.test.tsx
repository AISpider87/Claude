import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PlayerStatusChip,
  RosterPlayerList,
  RosterPlayerRow,
  type RosterPlayer,
} from "@/components/roster/roster-player-row";

const base: RosterPlayer = {
  id: 1870,
  name: "Barella",
  team: "Inter",
  role: "C",
  qtA: 17,
  pricePaid: 12,
  outOfList: false,
};

describe("RosterPlayerRow", () => {
  it("renders name, club, price paid, Qt.A and the role letter", () => {
    const html = renderToStaticMarkup(<RosterPlayerRow player={base} />);
    expect(html).toContain("Barella");
    expect(html).toContain("Inter");
    expect(html).toContain("pagato 12");
    expect(html).toMatch(/Qt\.A.*17/);
    expect(html).toContain('aria-label="Ruolo C"');
    expect(html).toContain('<svg viewBox="0 0 100 100" width="48"');
  });

  it("shows the delta sign against the price paid", () => {
    const up = renderToStaticMarkup(<RosterPlayerRow player={base} />);
    expect(up).toContain("+5");
    expect(up).toContain("text-role-d");
    expect(up).toContain('aria-label="Quotazione +5 rispetto al prezzo pagato"');

    const down = renderToStaticMarkup(<RosterPlayerRow player={{ ...base, pricePaid: 20 }} />);
    expect(down).toContain("−3");
    expect(down).toContain("text-danger");

    const flat = renderToStaticMarkup(<RosterPlayerRow player={{ ...base, pricePaid: 17 }} />);
    expect(flat).toContain('aria-label="Quotazione 0 rispetto al prezzo pagato"');
  });

  it("status chip links to the source safely and dates in Europe/Rome", () => {
    const html = renderToStaticMarkup(
      <RosterPlayerRow
        player={base}
        status={{
          kind: "injured",
          label: "Infortunato",
          source: { name: "Fantacalcio.it", url: "https://example.com/x" },
          updatedAt: "2026-09-10T22:30:00Z",
        }}
      />,
    );
    expect(html).toContain("Infortunato");
    expect(html).toMatch(
      /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer"/,
    );
    expect(html).toContain("fonte: Fantacalcio.it");
    expect(html).toContain("aggiornato il 11/09/2026");
    expect(html).toContain("bg-danger");

    const ok = renderToStaticMarkup(
      <PlayerStatusChip status={{ kind: "ok", label: "Disponibile" }} />,
    );
    expect(ok).toContain("Disponibile");
    expect(ok).toContain("bg-role-d");
    expect(ok).not.toContain("<a ");
  });

  it("marks out-of-list players and renders the actions slot", () => {
    const html = renderToStaticMarkup(
      <RosterPlayerRow
        player={{ ...base, outOfList: true, team: "Fuori Serie A" }}
        actions={<button type="button">Svincola gratis</button>}
      />,
    );
    expect(html).toContain("fuori lista");
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("Svincola gratis");
  });

  it("10 rows in a list have no duplicate ids and the group header counts the holes", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      player: { ...base, id: i + 1, name: `Giocatore ${i}` },
      status: { kind: "ok" as const, label: "Disponibile" },
    }));
    const html = renderToStaticMarkup(
      <RosterPlayerList
        groups={[
          { role: "D", target: 7, items: items.slice(0, 6) },
          { role: "C", target: 7, items: items.slice(6, 10) },
          { role: "A", target: 6, items: [] },
        ]}
      />,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(53);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids, m[1]).toContain(m[1]);
    expect(html).toContain("Difensori");
    expect(html).toContain("6/7");
    expect(html).toContain("1 posto da riempire");
    expect(html).toContain("3 posti da riempire");
    expect(html).toContain("Nessun attaccante in rosa.");
  });
});

describe("availabilityToStatus", () => {
  it("maps a player_status row to the chip, source only when complete", async () => {
    const { availabilityToStatus } = await import("@/components/roster/roster-player-row");
    const row = {
      player_id: 1,
      kind: "doubtful" as const,
      note: null,
      source_name: "Fantacalcio.it",
      source_url: "https://example.com/s",
      updated_by: null,
      updated_at: "2026-09-10T10:00:00Z",
    };
    expect(availabilityToStatus(row)).toEqual({
      kind: "doubtful",
      label: "In dubbio",
      updatedAt: "2026-09-10T10:00:00Z",
      source: { name: "Fantacalcio.it", url: "https://example.com/s" },
    });
    expect(availabilityToStatus({ ...row, kind: "unavailable", source_url: null })).toEqual({
      kind: "unavailable",
      label: "Indisponibile",
      updatedAt: "2026-09-10T10:00:00Z",
    });
  });
});
