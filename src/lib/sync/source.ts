/**
 * Where the daily quotations file comes from. The admin's manual upload is the
 * guaranteed path; automatic sources are pluggable and may legitimately return
 * null ("nothing to fetch today").
 */
export interface QuotationSource {
  readonly name: string;
  /** Returns the .xlsx bytes, or null when the source is not configured/available. */
  fetchLatest(): Promise<{ bytes: Uint8Array; fileName: string } | null>;
}

const USER_AGENT = "SuperLega/1.0 (+lega privata; sync quotazioni 1x/giorno)";
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/**
 * Polite HTTP source: one request per run, identified user-agent, no retries
 * beyond a single second attempt, hard size limit. The URL (and an optional
 * Cookie header, if the site requires a logged-in session) come from env, so
 * the exact download endpoint can be set once it is verified against the
 * site's terms (docs/SYNC.md).
 */
export class HttpQuotationSource implements QuotationSource {
  readonly name = "http";

  constructor(
    private readonly url: string,
    private readonly cookie?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchLatest() {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchImpl(this.url, {
          headers: {
            "user-agent": USER_AGENT,
            accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*",
            ...(this.cookie ? { cookie: this.cookie } : {}),
          },
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const length = Number(res.headers.get("content-length") ?? 0);
        if (length > MAX_BYTES) throw new Error("file too large");
        const bytes = await readCapped(res, MAX_BYTES);
        if (bytes.byteLength < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
          throw new Error("not an xlsx file (login page?)");
        }
        const disposition = res.headers.get("content-disposition") ?? "";
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
        const fileName = match?.[1] ? decodeURIComponent(match[1]) : "quotazioni.xlsx";
        return { bytes, fileName };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("download failed");
  }
}

/** Reads the body up to `max` bytes and aborts past it, so a rogue source cannot exhaust memory. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("file too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** No automatic source configured: the admin uploads the file by hand. */
export class NullQuotationSource implements QuotationSource {
  readonly name = "none";
  async fetchLatest() {
    return null;
  }
}

export function quotationSourceFromEnv(
  env: Record<string, string | undefined> = process.env,
): QuotationSource {
  const url = env.QUOTATIONS_SOURCE_URL?.trim();
  if (!url) return new NullQuotationSource();
  return new HttpQuotationSource(url, env.QUOTATIONS_SOURCE_COOKIE?.trim() || undefined);
}
