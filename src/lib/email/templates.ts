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
<p style="margin:0 0 20px;font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:#38bdf8">SuperLega</p>
<h1 style="margin:0 0 16px;font-size:22px">${title}</h1>
${body}
<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#0ea5e9;color:#05080f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${cta.label}</a></p>
<p style="margin:0;font-size:12px;color:#8ca0bf">Ricevi questa email perché fai parte della SuperLega.</p>
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
    subject: `SuperLega · mercato aperto: ${input.sessionName}`,
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
    subject: `SuperLega · mercato chiuso: ${input.sessionName}`,
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
