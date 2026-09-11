import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuyPanel } from "@/app/(app)/mercato/buy-panel";
import { MarketRoster } from "@/app/(app)/mercato/market-roster";

const noop = async () => undefined;
const roster = [
  {
    id: 1,
    name: "Por1",
    team: "Roma",
    role: "P" as const,
    qtA: 10,
    pricePaid: 10,
    outOfList: false,
  },
  {
    id: -3,
    name: "Partito",
    team: "Fuori Serie A",
    role: "A" as const,
    qtA: 0,
    pricePaid: 7,
    outOfList: true,
  },
];
const composition = { P: 3, D: 7, C: 7, A: 6 };
const slots = { P: 2, D: 7, C: 7, A: 5 };
const statuses = {
  1: {
    kind: "injured" as const,
    label: "Infortunato",
    source: { name: "Fantacalcio.it", url: "https://example.com/i" },
    updatedAt: "2026-09-10T10:00:00Z",
  },
};

/** /mercato renders both panels at once: their heading ids must not collide. */
describe("market panels", () => {
  it("roster and buy panels on one page do not produce duplicate element ids", () => {
    const html = renderToStaticMarkup(
      <>
        <MarketRoster
          teamId="t1"
          credits={100}
          roster={roster}
          statuses={statuses}
          composition={composition}
          slots={slots}
          sessionOpen
          refundRule="current_quotation"
          sellAction={noop}
          releaseAction={noop}
        />
        <BuyPanel
          teamId="t1"
          credits={100}
          candidates={[{ id: 5, name: "Att", team: "Como", role: "A", qtA: 12, free: true }]}
          openRoles={["P", "A"]}
          action={noop}
        />
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain("Svincola gratis");
    expect(html).toContain("2 posti da riempire");
    expect(html).toContain("non conta nei cambi");
    for (const m of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids, m[1]).toContain(m[1]);
  });

  it("roster rows show the avatar, the status chip and the release button", () => {
    const html = renderToStaticMarkup(
      <MarketRoster
        teamId="t1"
        credits={100}
        roster={roster}
        statuses={statuses}
        composition={composition}
        slots={slots}
        sessionOpen
        refundRule="current_quotation"
        sellAction={noop}
        releaseAction={noop}
      />,
    );
    // Avatar (40 px, compact row) and Qt.A of the row
    expect(html).toContain('<svg viewBox="0 0 100 100" width="40"');
    expect(html).toMatch(/Qt\.A.*10/);
    // Status chip with its source, only for the active player
    expect(html).toContain("Infortunato");
    expect(html).toContain("fonte: Fantacalcio.it");
    expect((html.match(/Disponibile|Infortunato/g) ?? []).length).toBe(1);
    // Release buttons: same labels and aria contract as before
    expect(html).toContain('aria-pressed="false" aria-label="Svincola Por1"');
    expect(html).toContain('aria-pressed="false" aria-label="Svincola gratis Partito"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("Portieri");
    expect(html).toContain("1/3");
  });

  it("buy tiles show a small avatar next to the name", () => {
    const html = renderToStaticMarkup(
      <BuyPanel
        teamId="t1"
        credits={100}
        candidates={[{ id: 5, name: "Att", team: "Como", role: "A", qtA: 12, free: true }]}
        openRoles={["A"]}
        action={noop}
      />,
    );
    expect(html).toContain('<svg viewBox="0 0 100 100" width="32"');
    expect(html).toContain('aria-label="Ruolo A"');
  });
});
