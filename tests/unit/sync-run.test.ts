import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runQuotationsSync, type SyncDb } from "@/lib/sync/run";
import {
  HttpQuotationSource,
  NullQuotationSource,
  quotationSourceFromEnv,
  type QuotationSource,
} from "@/lib/sync/source";

const FIXTURE = path.resolve(
  __dirname,
  "../../fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
);

function fakeDb(overrides: Partial<SyncDb> = {}) {
  const calls: string[] = [];
  const db: SyncDb = {
    ping: vi.fn(async () => {
      calls.push("ping");
    }),
    isSyncEnabled: vi.fn(async () => true),
    loadCurrentPlayers: vi.fn(async () => []),
    createImport: vi.fn(async () => {
      calls.push("create");
      return "import-1";
    }),
    applyImport: vi.fn(async () => {
      calls.push("apply");
      return { rows: 532, new: 532 };
    }),
    failImport: vi.fn(async () => {
      calls.push("fail");
    }),
    ...overrides,
  };
  return { db, calls };
}

describe("runQuotationsSync", () => {
  it("always pings the database (keep-alive), even when disabled", async () => {
    const { db, calls } = fakeDb({ isSyncEnabled: async () => false });
    const out = await runQuotationsSync(new NullQuotationSource(), db);
    expect(out).toEqual({ status: "skipped", reason: "disabled" });
    expect(calls).toEqual(["ping"]);
  });

  it("skips quietly when no source is configured", async () => {
    const { db, calls } = fakeDb();
    const out = await runQuotationsSync(new NullQuotationSource(), db);
    expect(out).toEqual({ status: "skipped", reason: "no_source" });
    expect(calls).toEqual(["ping"]);
  });

  it("parses the real file, saves preview + payload and applies it", async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE));
    const source: QuotationSource = {
      name: "fake",
      fetchLatest: async () => ({ bytes, fileName: "Quotazioni.xlsx" }),
    };
    const { db, calls } = fakeDb();
    const out = await runQuotationsSync(source, db);
    expect(out.status).toBe("applied");
    expect(calls).toEqual(["ping", "create", "apply"]);
    const arg = (db.createImport as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      fileName: string;
      payload: { rows: unknown[]; out_of_list_ids: number[] };
      stats: { source: string; preview: { total: number } };
    };
    expect(arg.fileName).toBe("Quotazioni.xlsx");
    expect(arg.payload.rows.length).toBe(532);
    expect(arg.payload.out_of_list_ids.length).toBe(62);
    expect(arg.stats.source).toBe("fake");
    expect(arg.stats.preview.total).toBe(532);
  });

  it("records a failed import when the download fails", async () => {
    const source: QuotationSource = {
      name: "http",
      fetchLatest: async () => {
        throw new Error("HTTP 403");
      },
    };
    const { db, calls } = fakeDb();
    const out = await runQuotationsSync(source, db);
    expect(out).toEqual({ status: "failed", importId: "import-1", error: "HTTP 403" });
    expect(calls).toEqual(["ping", "create", "fail"]);
  });

  it("records a failed import when the file is not a quotations workbook", async () => {
    const source: QuotationSource = {
      name: "fake",
      fetchLatest: async () => ({ bytes: new Uint8Array([0x50, 0x4b, 3, 4]), fileName: "x.xlsx" }),
    };
    const { db, calls } = fakeDb();
    const out = await runQuotationsSync(source, db).catch((e) => ({ status: "threw", e }));
    expect(["failed", "threw"]).toContain(out.status);
    expect(calls[0]).toBe("ping");
  });

  it("marks the import failed when apply is rejected by the database", async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE));
    const source: QuotationSource = {
      name: "fake",
      fetchLatest: async () => ({ bytes, fileName: "q.xlsx" }),
    };
    const { db, calls } = fakeDb({
      applyImport: async () => {
        throw new Error("IMPORT_TOO_SMALL");
      },
    });
    const out = await runQuotationsSync(source, db);
    expect(out).toMatchObject({
      status: "failed",
      importId: "import-1",
      error: "IMPORT_TOO_SMALL",
    });
    expect(calls).toEqual(["ping", "create", "fail"]);
  });
});

describe("quotation sources", () => {
  it("falls back to the null source without QUOTATIONS_SOURCE_URL", () => {
    expect(quotationSourceFromEnv({}).name).toBe("none");
    expect(
      quotationSourceFromEnv({ QUOTATIONS_SOURCE_URL: "https://example.com/q.xlsx" }).name,
    ).toBe("http");
  });

  it("http source: identifies itself, rejects non-xlsx bodies, reads the filename", async () => {
    const seen: RequestInit[] = [];
    const xlsx = new Uint8Array(2000);
    xlsx[0] = 0x50;
    xlsx[1] = 0x4b;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(xlsx, {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="Quotazioni_2026.xlsx"' },
      });
    }) as typeof fetch;
    const ok = await new HttpQuotationSource(
      "https://example.com/q",
      undefined,
      fetchImpl,
    ).fetchLatest();
    expect(ok?.fileName).toBe("Quotazioni_2026.xlsx");
    expect(ok?.bytes.byteLength).toBe(2000);
    expect((seen[0]?.headers as Record<string, string>)["user-agent"]).toContain("SuperLega");

    const html = (async () => new Response("<html>login</html>", { status: 200 })) as typeof fetch;
    await expect(
      new HttpQuotationSource("https://example.com/q", undefined, html).fetchLatest(),
    ).rejects.toThrow(/not an xlsx/);

    const forbidden = (async () => new Response("", { status: 403 })) as typeof fetch;
    await expect(
      new HttpQuotationSource("https://example.com/q", undefined, forbidden).fetchLatest(),
    ).rejects.toThrow(/403/);
  });
});
