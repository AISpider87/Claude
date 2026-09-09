import { describe, expect, it } from "vitest";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";

describe("zonedLocalToUtc (Europe/Rome)", () => {
  it("converts summer time (UTC+2)", () => {
    expect(zonedLocalToUtc("2026-09-06T20:00")?.toISOString()).toBe("2026-09-06T18:00:00.000Z");
  });

  it("converts winter time (UTC+1)", () => {
    expect(zonedLocalToUtc("2026-11-29T20:00")?.toISOString()).toBe("2026-11-29T19:00:00.000Z");
  });

  it("handles the DST switch day", () => {
    // 2026-10-25: clocks go back at 03:00 CEST → 02:00 CET. 04:00 local is CET (UTC+1).
    expect(zonedLocalToUtc("2026-10-25T04:00")?.toISOString()).toBe("2026-10-25T03:00:00.000Z");
    // 2026-03-29: clocks go forward at 02:00 CET → 03:00 CEST. 04:00 local is CEST (UTC+2).
    expect(zonedLocalToUtc("2026-03-29T04:00")?.toISOString()).toBe("2026-03-29T02:00:00.000Z");
  });

  it("rejects garbage", () => {
    expect(zonedLocalToUtc("domani alle 20")).toBeNull();
    expect(zonedLocalToUtc("")).toBeNull();
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(zonedLocalToUtc("2026-02-30T10:00")).toBeNull();
    expect(zonedLocalToUtc("2026-13-01T10:00")).toBeNull();
    expect(zonedLocalToUtc("2026-04-31T10:00")).toBeNull();
    expect(zonedLocalToUtc("2026-09-06T24:00")).toBeNull();
    expect(zonedLocalToUtc("2026-09-06T20:60")).toBeNull();
    expect(zonedLocalToUtc("0099-09-06T20:00")).toBeNull();
    expect(zonedLocalToUtc("2028-02-29T10:00")).not.toBeNull();
  });

  it("maps the DST gap and overlap deterministically", () => {
    // 02:30 on 2026-03-29 does not exist in Rome: it resolves to a real instant, never null.
    const gap = zonedLocalToUtc("2026-03-29T02:30");
    expect(gap).not.toBeNull();
    expect(["2026-03-29T00:30:00.000Z", "2026-03-29T01:30:00.000Z"]).toContain(gap!.toISOString());
    // 02:30 on 2026-10-25 happens twice: the later (CET) instant is used.
    expect(zonedLocalToUtc("2026-10-25T02:30")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("round-trips with utcToZonedLocal", () => {
    const local = "2027-02-07T20:00";
    expect(utcToZonedLocal(zonedLocalToUtc(local)!)).toBe(local);
    expect(utcToZonedLocal("2026-09-06T18:00:00.000Z")).toBe("2026-09-06T20:00");
  });
});
