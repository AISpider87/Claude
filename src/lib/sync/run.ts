import { parseQuotationsWorkbook } from "@/lib/import/quotations-parser";
import { buildQuotationsPreview, type CurrentPlayer } from "@/lib/import/quotations-preview";
import type { QuotationSource } from "@/lib/sync/source";

/** The few database operations the sync needs, so the orchestrator is testable. */
export interface SyncDb {
  isSyncEnabled(): Promise<boolean>;
  loadCurrentPlayers(): Promise<CurrentPlayer[]>;
  createImport(input: { fileName: string; payload: unknown; stats: unknown }): Promise<string>;
  applyImport(importId: string): Promise<Record<string, unknown>>;
  failImport(importId: string, error: string): Promise<void>;
  /** Cheap query that also keeps a free-tier database awake. */
  ping(): Promise<void>;
}

export type SyncOutcome =
  | { status: "skipped"; reason: "disabled" | "no_source" }
  | { status: "applied"; importId: string; stats: Record<string, unknown> }
  | { status: "failed"; importId: string | null; error: string };

export async function runQuotationsSync(
  source: QuotationSource,
  db: SyncDb,
  log: (msg: string) => void = () => {},
): Promise<SyncOutcome> {
  await db.ping();

  if (!(await db.isSyncEnabled())) {
    log("sync disabled by league settings");
    return { status: "skipped", reason: "disabled" };
  }

  let file: Awaited<ReturnType<QuotationSource["fetchLatest"]>>;
  try {
    file = await source.fetchLatest();
  } catch (e) {
    const error = e instanceof Error ? e.message : "download failed";
    log(`source ${source.name} failed: ${error}`);
    const importId = await db.createImport({
      fileName: `auto:${source.name}`,
      payload: { rows: [], out_of_list_ids: [] },
      stats: { source: source.name, error },
    });
    await db.failImport(importId, `Download non riuscito (${source.name}): ${error}`);
    return { status: "failed", importId, error };
  }
  if (!file) {
    log(`source ${source.name} has nothing to fetch`);
    return { status: "skipped", reason: "no_source" };
  }

  const parsed = await parseQuotationsWorkbook(file.bytes);
  if (parsed.rows.length === 0) {
    const error = parsed.anomalies[0]
      ? `${parsed.anomalies[0].code}: ${parsed.anomalies[0].detail}`
      : "nessuna riga";
    const importId = await db.createImport({
      fileName: file.fileName,
      payload: { rows: [], out_of_list_ids: [] },
      stats: { source: source.name, anomalies: parsed.anomalies },
    });
    await db.failImport(importId, `File non valido: ${error}`);
    return { status: "failed", importId, error };
  }

  const current = await db.loadCurrentPlayers();
  const preview = buildQuotationsPreview(parsed, current);
  const importId = await db.createImport({
    fileName: file.fileName,
    payload: { rows: parsed.rows, out_of_list_ids: parsed.outOfListIds },
    stats: {
      source: source.name,
      preview,
      anomalies: parsed.anomalies,
      anomaly_count: parsed.anomalies.length,
      sheets: parsed.sheets,
      title: parsed.title,
    },
  });

  try {
    const stats = await db.applyImport(importId);
    log(`applied import ${importId}: ${JSON.stringify(stats)}`);
    return { status: "applied", importId, stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : "apply failed";
    await db.failImport(importId, error);
    log(`apply failed: ${error}`);
    return { status: "failed", importId, error };
  }
}
