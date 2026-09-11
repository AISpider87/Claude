import "server-only";
import { publicEnv } from "@/lib/env";
import { isEmailConfigured, sendEmails } from "@/lib/email/provider";
import {
  freeSwapEmail,
  sessionClosedEmail,
  sessionOpenedEmail,
  type EmailContent,
  type FreeSwapKind,
} from "@/lib/email/templates";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL_SINGULAR } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { NotificationStatus, RateLimitBucket } from "@/lib/supabase/database.types";

/** The signed-in user's client (admin actions) or the service client (automatic transitions). */
type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceClient>;

interface DeliverOptions {
  /** Only the admins, instead of every active member. */
  adminsOnly?: boolean;
  /** Rate-limit bucket: league emails share "email", free swaps have "email_ops". */
  bucket?: RateLimitBucket;
  /** Who the rate limit is counted against (the service role is exempt). */
  limiter?: Client;
  /** Every setting that must not be false for this email to go out. */
  settings?: string[];
}

const LIMIT_DETAIL: Partial<Record<RateLimitBucket, string>> = {
  email: "Limite invii raggiunto",
  email_ops: "Limite invii raggiunto (30 notifiche all'ora): cambio gratuito non segnalato",
};

async function log(
  supabase: Client,
  kind: string,
  subject: string,
  recipients: number,
  status: NotificationStatus,
  detail: string | null,
) {
  await supabase.rpc("log_notification", {
    p_kind: kind,
    p_subject: subject,
    p_recipients: recipients,
    p_status: status,
    p_detail: detail,
  });
}

/**
 * Sends one email per recipient and records the outcome. Never throws: a
 * notification problem must not undo an operation that already happened.
 */
async function deliver(
  kind: string,
  content: EmailContent,
  client?: Client,
  options: DeliverOptions = {},
) {
  const supabase = client ?? (await createClient());
  const bucket = options.bucket ?? "email";
  try {
    const keys = options.settings ?? ["notifications_enabled"];
    const { data: flags } = await supabase
      .from("league_settings")
      .select("key, value")
      .in("key", keys);
    if ((flags ?? []).some((f) => f.value === false)) {
      await log(supabase, kind, content.subject, 0, "skipped", "Notifiche disattivate");
      return;
    }
    if (!isEmailConfigured()) {
      await log(supabase, kind, content.subject, 0, "skipped", "Provider email non configurato");
      return;
    }
    const { error: limitError } = await (options.limiter ?? supabase).rpc("consume_rate_limit", {
      p_bucket: bucket,
    });
    if (limitError) {
      const detail = LIMIT_DETAIL[bucket] ?? "Limite invii raggiunto";
      await log(supabase, kind, content.subject, 0, "skipped", detail);
      return;
    }
    const { data: recipients } = await supabase.rpc("admin_notification_recipients", {
      p_admins_only: options.adminsOnly ?? false,
    });
    const list = (recipients ?? []).filter((r) => r.email);
    if (list.length === 0) {
      await log(supabase, kind, content.subject, 0, "skipped", "Nessun destinatario");
      return;
    }
    const result = await sendEmails(list.map((r) => ({ to: r.email, ...content })));
    await log(
      supabase,
      kind,
      content.subject,
      result.sent,
      result.failed === 0 ? "sent" : result.sent === 0 ? "failed" : "partial",
      result.error ? `${result.failed} non inviate: ${result.error}` : null,
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : "errore imprevisto";
    await log(supabase, kind, content.subject, 0, "failed", detail).catch(() => {});
  }
}

export async function notifySessionOpened(sessionId: string, client?: Client) {
  const supabase = client ?? (await createClient());
  const [{ data: session }, { count }] = await Promise.all([
    supabase.from("market_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase
      .from("session_free_agents")
      .select("player_id", { count: "exact", head: true })
      .eq("session_id", sessionId),
  ]);
  if (!session) return;
  await deliver(
    "session_open",
    sessionOpenedEmail({
      sessionName: session.name,
      closesAt: session.closes_at,
      extraBudget: session.extra_budget_applied ? session.extra_budget : 0,
      freeAgents: count ?? 0,
      siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
    }),
    supabase,
  );
}

export async function notifySessionClosed(sessionId: string, client?: Client) {
  const supabase = client ?? (await createClient());
  const [{ data: session }, { count }] = await Promise.all([
    supabase.from("market_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .in("kind", ["swap", "free_swap", "sell", "buy", "free_release"]),
  ]);
  if (!session) return;
  const report = (session.validation_report ?? null) as {
    teams?: { team: string; ok: boolean }[];
  } | null;
  await deliver(
    "session_close",
    sessionClosedEmail({
      sessionName: session.name,
      swaps: count ?? 0,
      invalidTeams: (report?.teams ?? []).filter((t) => !t.ok).map((t) => t.team),
      siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
    }),
    supabase,
  );
}

/**
 * Admin alert for a free operation of the out-of-list flow. Called from
 * `after()` by the manager's action, so it runs with the service client (the
 * recipient list and the notification log are admin-only) while the rate limit
 * is counted against the manager who triggered it. Never throws.
 *
 * A purchase that counted toward the 20 season swaps is not a free swap: it is
 * ignored here, which is the only place that can tell for sure.
 */
export async function notifyFreeSwap(kind: FreeSwapKind, txId: string) {
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    // no service key configured: nothing to send, and no way to log it either
    return;
  }
  try {
    const { data: tx } = await service
      .from("transactions")
      .select("*")
      .eq("id", txId)
      .maybeSingle();
    if (!tx) return;
    if (kind === "free_buy" && tx.counts_toward_limit) return;

    const playerId = kind === "free_release" ? tx.player_out_id : tx.player_in_id;
    const [{ data: team }, { data: player }] = await Promise.all([
      service.from("teams").select("name, credits, owner_id").eq("id", tx.team_id).maybeSingle(),
      playerId == null
        ? Promise.resolve({ data: null })
        : service.from("players").select("name, role_classic").eq("id", playerId).maybeSingle(),
    ]);
    if (!team) return;
    const { data: owner } = team.owner_id
      ? await service
          .from("profiles")
          .select("display_name")
          .eq("user_id", team.owner_id)
          .maybeSingle()
      : { data: null };

    await deliver(
      "free_swap",
      freeSwapEmail({
        kind,
        teamName: team.name,
        managerName: owner?.display_name ?? "manager non collegato",
        playerName: player?.name ?? `#${playerId ?? "?"}`,
        roleLabel:
          (player && ROLE_LABEL_SINGULAR[player.role_classic as RoleClassic]) ?? "ruolo ignoto",
        amount: Math.abs(tx.credits_delta),
        credits: team.credits,
        countsTowardLimit: tx.counts_toward_limit,
        at: tx.created_at,
        siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
      }),
      service,
      {
        adminsOnly: true,
        bucket: "email_ops",
        // counted against the manager who triggered it; the service role, used
        // when the request context is gone, is exempt by design
        limiter: await createClient().catch(() => service),
        settings: ["notifications_enabled", "notifications_free_swap"],
      },
    );
  } catch {
    // the operation is already in the ledger: a mail problem must stay silent
  }
}
