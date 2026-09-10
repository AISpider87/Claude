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

/** /mercato renders both panels at once: their heading ids must not collide. */
describe("market panels", () => {
  it("roster and buy panels on one page do not produce duplicate element ids", () => {
    const html = renderToStaticMarkup(
      <>
        <MarketRoster
          teamId="t1"
          credits={100}
          roster={roster}
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
  });
});
