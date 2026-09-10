import "server-only";
import { after } from "next/server";
import { notifySessionClosed, notifySessionOpened } from "@/lib/email/notify";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

interface SyncResult {
  opened: string[];
  closed: string[];
}

function parse(data: unknown): SyncResult {
  const r = (data ?? {}) as Partial<SyncResult>;
  return { opened: r.opened ?? [], closed: r.closed ?? [] };
}

/** Sends the league emails for automatic transitions with the service client. */
function notifyLater(result: SyncResult) {
  if (result.opened.length === 0 && result.closed.length === 0) return;
  after(async () => {
    let service: ReturnType<typeof createServiceClient>;
    try {
      service = createServiceClient();
    } catch {
      return; // no service key: the transition happened, only the email is skipped
    }
    for (const id of result.closed) await notifySessionClosed(id, service);
    for (const id of result.opened) await notifySessionOpened(id, service);
  });
}

/**
 * Opens the scheduled session whose time has come and closes the open one whose
 * time is over. Called on every authenticated page load: cheap, idempotent, and
 * it never throws (a sync problem must not break the page).
 */
export async function syncMarketSessions() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sync_market_sessions");
    if (error) return;
    notifyLater(parse(data));
  } catch {
    // ignore: the next request retries
  }
}

/** Same, from a server job (cron) that has no user session. */
export async function syncMarketSessionsAsService(
  service: ReturnType<typeof createServiceClient>,
): Promise<SyncResult> {
  const { data, error } = await service.rpc("sync_market_sessions");
  if (error) throw new Error(error.message);
  const result = parse(data);
  for (const id of result.closed) await notifySessionClosed(id, service);
  for (const id of result.opened) await notifySessionOpened(id, service);
  return result;
}
