/** Shared shape of an outgoing message, whichever provider sends it. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: number;
  failed: number;
  /** Last provider error, verbatim and never containing the API key. */
  error?: string;
}

/** `EMAIL_FROM` is `Nome <indirizzo>` (the name is optional). */
export function parseSender(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  if (match) return { name: match[1] || "The SuperLeague", email: match[2]! };
  return { name: "The SuperLeague", email: value.trim() };
}
