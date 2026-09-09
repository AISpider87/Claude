import "server-only";
import { publicEnv } from "@/lib/env";
import { isEmailConfigured, sendEmails } from "@/lib/email/resend";
import { sessionClosedEmail, sessionOpenedEmail, type EmailContent } from "@/lib/email/templates";
import { createClient } from "@/lib/supabase/server";
import type { NotificationStatus } from "@/lib/supabase/database.types";

type Client = Awaited<ReturnType<typeof createClient>>;

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
 * Sends one email per active member and records the outcome. Never throws: a
 * notification problem must not undo a session that was already opened/closed.
 */
async function deliver(kind: string, content: EmailContent) {
  const supabase = await createClient();
  try {
    const { data: enabled } = await supabase
      .from("league_settings")
      .select("value")
      .eq("key", "notifications_enabled")
      .maybeSingle();
    if (enabled?.value === false) {
      await log(supabase, kind, content.subject, 0, "skipped", "Notifiche disattivate");
      return;
    }
    if (!isEmailConfigured()) {
      await log(supabase, kind, content.subject, 0, "skipped", "Provider email non configurato");
      return;
    }
    const { error: limitError } = await supabase.rpc("consume_rate_limit", { p_bucket: "email" });
    if (limitError) {
      await log(supabase, kind, content.subject, 0, "skipped", "Limite invii raggiunto");
      return;
    }
    const { data: recipients } = await supabase.rpc("admin_notification_recipients");
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
      result.failed === 0 ? "sent" : result.sent === 0 ? "failed" : "sent",
      result.error ? `${result.failed} non inviate: ${result.error}` : null,
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : "errore imprevisto";
    await log(supabase, kind, content.subject, 0, "failed", detail).catch(() => {});
  }
}

export async function notifySessionOpened(sessionId: string) {
  const supabase = await createClient();
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
  );
}

export async function notifySessionClosed(sessionId: string) {
  const supabase = await createClient();
  const [{ data: session }, { count }] = await Promise.all([
    supabase.from("market_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .in("kind", ["swap", "free_swap"]),
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
  );
}
