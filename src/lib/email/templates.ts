import { formatDateTime, formatInt } from "@/lib/format";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Plain, high-contrast layout that survives every email client. */
function layout(title: string, paragraphs: string[], cta: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("");
  return `<!doctype html><html lang="it"><body style="margin:0;background:#05080f;color:#e6edf7;font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<p style="margin:0 0 20px;font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:#38bdf8">The SuperLeague</p>
<h1 style="margin:0 0 16px;font-size:22px">${title}</h1>
${body}
<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#0ea5e9;color:#05080f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${cta.label}</a></p>
<p style="margin:0;font-size:12px;color:#8ca0bf">Ricevi questa email perché fai parte di The SuperLeague.</p>
</div></body></html>`;
}

export function sessionOpenedEmail(input: {
  sessionName: string;
  closesAt: string;
  extraBudget: number;
  freeAgents: number;
  siteUrl: string;
}): EmailContent {
  const name = escapeHtml(input.sessionName);
  const closes = formatDateTime(input.closesAt);
  const url = `${input.siteUrl.replace(/\/$/, "")}/mercato`;
  const lines = [
    `È aperta la sessione di mercato <strong>${name}</strong>.`,
    `Puoi fare i tuoi cambi fino a <strong>${closes}</strong> (ora italiana).`,
    input.extraBudget > 0
      ? `Alla tua squadra sono stati accreditati <strong>${formatInt(input.extraBudget)} crediti</strong> extra.`
      : "",
    `Svincolati disponibili in questa sessione: <strong>${formatInt(input.freeAgents)}</strong>.`,
  ].filter(Boolean);
  return {
    subject: `The SuperLeague · mercato aperto: ${input.sessionName}`,
    html: layout(`Mercato aperto: ${name}`, lines, { label: "Vai al mercato", url }),
    text: [
      `È aperta la sessione di mercato "${input.sessionName}".`,
      `Puoi fare i tuoi cambi fino a ${closes} (ora italiana).`,
      input.extraBudget > 0
        ? `Alla tua squadra sono stati accreditati ${input.extraBudget} crediti extra.`
        : "",
      `Svincolati disponibili: ${input.freeAgents}.`,
      "",
      `Vai al mercato: ${url}`,
    ]
      .filter((l, i) => l !== "" || i === 4)
      .join("\n"),
  };
}

export type FreeSwapKind = "free_release" | "free_buy";

/**
 * Admin-only alert for an out-of-list free operation: who did what, for how
 * much, what is left, and whether it ate one of the 20 season swaps (it never
 * does today — the line is there so a future rule change shows up in the mail).
 */
export function freeSwapEmail(input: {
  kind: FreeSwapKind;
  teamName: string;
  managerName: string;
  playerName: string;
  roleLabel: string;
  amount: number;
  credits: number;
  countsTowardLimit: boolean;
  /** Inside an open session the operation is still undoable by the manager. */
  pending?: boolean;
  at: string;
  siteUrl: string;
}): EmailContent {
  const team = escapeHtml(input.teamName);
  const manager = escapeHtml(input.managerName);
  const player = escapeHtml(input.playerName);
  const role = escapeHtml(input.roleLabel);
  const when = formatDateTime(input.at);
  const url = `${input.siteUrl.replace(/\/$/, "")}/admin/operazioni`;
  const counts = input.countsTowardLimit ? "sì" : "no";
  const state = input.pending
    ? "in attesa di conferma (il manager può ancora annullarla fino alla chiusura della sessione)"
    : "definitiva";
  const movement =
    input.kind === "free_release"
      ? {
          html: `<strong>Esce:</strong> ${player} (${role}) — rimborso <strong>${formatInt(input.amount)} crediti</strong>`,
          text: `Esce: ${input.playerName} (${input.roleLabel}) — rimborso ${input.amount} crediti`,
        }
      : {
          html: `<strong>Entra:</strong> ${player} (${role}) — costo <strong>${formatInt(input.amount)} crediti</strong>`,
          text: `Entra: ${input.playerName} (${input.roleLabel}) — costo ${input.amount} crediti`,
        };
  const title =
    input.kind === "free_release"
      ? "Svincolo gratuito (fuori lista)"
      : "Acquisto gratuito (posto libero)";
  return {
    subject: `The SuperLeague · Cambio gratuito: ${input.teamName}`,
    html: layout(
      title,
      [
        `<strong>Squadra:</strong> ${team} — manager: ${manager}`,
        movement.html,
        `<strong>Crediti residui:</strong> ${formatInt(input.credits)}`,
        `<strong>Conta nei cambi stagionali:</strong> ${counts}`,
        `<strong>Stato:</strong> ${state}`,
        `<strong>Quando:</strong> ${when} (ora italiana)`,
      ],
      { label: "Apri il registro operazioni", url },
    ),
    text: [
      `${title} in The SuperLeague.`,
      "",
      `Squadra: ${input.teamName} — manager: ${input.managerName}`,
      movement.text,
      `Crediti residui: ${input.credits}`,
      `Conta nei cambi stagionali: ${counts}`,
      `Stato: ${state}`,
      `Quando: ${when} (ora italiana)`,
      "",
      `Registro operazioni: ${url}`,
    ].join("\n"),
  };
}

export function sessionClosedEmail(input: {
  sessionName: string;
  swaps: number;
  invalidTeams: string[];
  siteUrl: string;
}): EmailContent {
  const name = escapeHtml(input.sessionName);
  const url = `${input.siteUrl.replace(/\/$/, "")}/rosa`;
  const invalid = input.invalidTeams.length;
  const lines = [
    `La sessione di mercato <strong>${name}</strong> è chiusa.`,
    `Cambi registrati in questa sessione: <strong>${formatInt(input.swaps)}</strong>.`,
    invalid > 0
      ? `Rose da sistemare (l'admin vi contatterà): <strong>${input.invalidTeams.map(escapeHtml).join(", ")}</strong>.`
      : "Tutte le rose sono in regola.",
    "Le rose restano in sola lettura fino alla prossima sessione (esclusi i cambi gratuiti per chi ha lasciato la Serie A).",
  ];
  return {
    subject: `The SuperLeague · mercato chiuso: ${input.sessionName}`,
    html: layout(`Mercato chiuso: ${name}`, lines, { label: "Vedi la tua rosa", url }),
    text: [
      `La sessione di mercato "${input.sessionName}" è chiusa.`,
      `Cambi registrati: ${input.swaps}.`,
      invalid > 0
        ? `Rose da sistemare: ${input.invalidTeams.join(", ")}.`
        : "Tutte le rose sono in regola.",
      "",
      `Vedi la tua rosa: ${url}`,
    ].join("\n"),
  };
}
