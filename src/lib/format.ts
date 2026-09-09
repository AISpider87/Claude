const TIME_ZONE = "Europe/Rome";

const dateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const intFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

/** UTC timestamp (ISO string or Date) → "gg/mm/aaaa, hh:mm" in Europe/Rome. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return intFormatter.format(value);
}

/** Signed delta for quotation changes: "+3", "−2", "0". */
export function formatDelta(value: number): string {
  if (value > 0) return `+${formatInt(value)}`;
  if (value < 0) return `−${formatInt(Math.abs(value))}`;
  return "0";
}
