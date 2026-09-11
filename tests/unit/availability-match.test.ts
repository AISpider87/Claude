import { describe, expect, it } from "vitest";
import { AvailabilityMatcher, clubKey, sameClub, surnameOf } from "@/lib/availability/match";
import type { ListonePlayer } from "@/lib/import/name-matching";

const LISTONE: ListonePlayer[] = [
  { id: 101, name: "Martinez Jo.", team: "Inter", role_classic: "P", qt_a: 17, status: "active" },
  { id: 102, name: "Martinez Lau.", team: "Inter", role_classic: "A", qt_a: 30, status: "active" },
  { id: 103, name: "Bastoni", team: "Inter", role_classic: "D", qt_a: 18, status: "active" },
  { id: 201, name: "Lukaku", team: "Napoli", role_classic: "A", qt_a: 24, status: "active" },
  { id: 301, name: "Dybala", team: "Roma", role_classic: "A", qt_a: 26, status: "active" },
  {
    id: 401,
    name: "Bastoni Si.",
    team: "Fiorentina",
    role_classic: "D",
    qt_a: 9,
    status: "active",
  },
  { id: 501, name: "Balerdi", team: "Como", role_classic: "D", qt_a: 8, status: "active" },
];

describe("clubKey", () => {
  it("maps the API's club names onto the listone's", () => {
    expect(clubKey("Inter")).toBe("Inter");
    expect(clubKey("Internazionale")).toBe("Inter");
    expect(clubKey("Inter Milan")).toBe("Inter");
    expect(clubKey("AC Milan")).toBe("Milan");
    expect(clubKey("A.C. Milan")).toBe("Milan");
    expect(clubKey("AS Roma")).toBe("Roma");
    expect(clubKey("SSC Napoli")).toBe("Napoli");
    expect(clubKey("  juventus  ")).toBe("Juventus");
    expect(clubKey("Hellas Verona")).toBe("hellas verona"); // unknown club: kept as is
    expect(clubKey(null)).toBe("");
  });

  it("compares clubs tolerantly and never blocks on a missing one", () => {
    expect(sameClub("Internazionale", "Inter")).toBe(true);
    expect(sameClub("AS Roma", "Roma")).toBe(true);
    expect(sameClub("Napoli", "Inter")).toBe(false);
    expect(sameClub("", "Inter")).toBe(true);
  });
});

describe("AvailabilityMatcher", () => {
  const matcher = new AvailabilityMatcher(LISTONE);

  it("matches a full name against the listone's surname + initial, inside the club", () => {
    expect(matcher.match({ externalId: 1, name: "Romelu Lukaku", teamName: "SSC Napoli" })).toEqual(
      {
        status: "matched",
        player: LISTONE[3],
        via: "club",
      },
    );
    expect(
      matcher.match({ externalId: 2, name: "Alessandro Bastoni", teamName: "Internazionale" }),
    ).toMatchObject({ status: "matched", player: { id: 103 } });
    // Same surname, another club: the club decides.
    expect(
      matcher.match({ externalId: 3, name: "Simone Bastoni", teamName: "Fiorentina" }),
    ).toMatchObject({ status: "matched", player: { id: 401 } });
  });

  it("refuses to guess between two players with the same surname in the same club", () => {
    const out = matcher.match({ externalId: 4, name: "Lautaro Martinez", teamName: "Inter" });
    expect(out.status).toBe("ambiguous");
    expect(out.status === "ambiguous" && out.candidates.map((c) => c.id).sort()).toEqual([
      101, 102,
    ]);
  });

  it("reports an unknown player instead of binding them to somebody else", () => {
    expect(
      matcher.match({ externalId: 5, name: "Giovanni Sconosciuto", teamName: "Pisa" }).status,
    ).toBe("not_found");
    // Right name, wrong club: still not a match.
    expect(matcher.match({ externalId: 6, name: "Dybala", teamName: "Juventus" }).status).toBe(
      "not_found",
    );
  });

  it("prefers a stored mapping over any guess", () => {
    const mapped = new AvailabilityMatcher(LISTONE, [
      { external_id: 4, player_id: 102, confidence: "confirmed" },
    ]);
    expect(mapped.match({ externalId: 4, name: "Lautaro Martinez", teamName: "Inter" })).toEqual({
      status: "matched",
      player: LISTONE[1],
      via: "map",
    });
  });

  it("ignores accents, case and punctuation on both sides", () => {
    expect(
      matcher.match({ externalId: 7, name: "PAULO  DYBALA", teamName: "as roma" }).status,
    ).toBe("matched");
    expect(matcher.match({ externalId: 8, name: "Dybala", teamName: "Roma" }).status).toBe(
      "matched",
    );
  });
});

describe('abbreviated names (BSD writes "L. Balerdi")', () => {
  const matcher = new AvailabilityMatcher(LISTONE);

  it("strips the leading initial and keeps the surname", () => {
    expect(surnameOf("L. Balerdi")).toBe("balerdi");
    expect(surnameOf("R. Lukaku")).toBe("lukaku");
    expect(surnameOf("Romelu Lukaku")).toBe("lukaku");
    expect(surnameOf("Balerdi")).toBe("balerdi");
    expect(surnameOf("L.")).toBe("");
    expect(surnameOf("")).toBe("");
  });

  it("matches on the surname alone when the club is unknown, but asks to confirm", () => {
    const out = matcher.match({ externalId: null, name: "L. Balerdi", teamName: "" });
    expect(out).toMatchObject({ status: "matched", player: { id: 501 }, confirm: true });
  });

  it("does not guess between two players with the same surname in different clubs", () => {
    const twins = new AvailabilityMatcher([
      ...LISTONE,
      { id: 502, name: "Balerdi", team: "Lecce", role_classic: "D", qt_a: 7, status: "active" },
    ]);
    // Club unknown: two Balerdi in the league, so nothing is applied.
    const blind = twins.match({ externalId: null, name: "L. Balerdi", teamName: "" });
    expect(blind.status).toBe("ambiguous");
    expect(blind.status === "ambiguous" && blind.candidates.map((c) => c.id).sort()).toEqual([
      501, 502,
    ]);
    // Club known: the surname is unique inside it.
    expect(twins.match({ externalId: null, name: "L. Balerdi", teamName: "Como" })).toMatchObject({
      status: "matched",
      player: { id: 501 },
    });
  });

  it("flags a plain name match made without a club as one to confirm", () => {
    expect(matcher.match({ externalId: null, name: "Dybala", teamName: "" })).toMatchObject({
      status: "matched",
      player: { id: 301 },
      confirm: true,
    });
    // With the club, it is trusted and bound automatically.
    expect(matcher.match({ externalId: null, name: "Dybala", teamName: "Roma" })).toMatchObject({
      status: "matched",
      confirm: false,
    });
  });
});
