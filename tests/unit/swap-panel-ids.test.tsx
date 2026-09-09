import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SwapPanel } from "@/app/(app)/mercato/swap-panel";

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
];

/**
 * /mercato renders two SwapPanels at once (regular swap + free swap for
 * out-of-list players). Their heading ids must not collide.
 */
describe("SwapPanel ids", () => {
  it("two panels on one page do not produce duplicate element ids", () => {
    const html = renderToStaticMarkup(
      <>
        <SwapPanel
          teamId="t1"
          credits={100}
          roster={roster}
          candidates={[]}
          refundRule="current_quotation"
          action={noop}
          title="Fai un cambio"
          description=""
          submitLabel="Conferma"
        />
        <SwapPanel
          teamId="t1"
          credits={100}
          roster={roster}
          candidates={[]}
          refundRule="price_paid"
          action={noop}
          title="Cambio gratuito"
          description=""
          submitLabel="Conferma"
        />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});
