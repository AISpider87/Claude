export const SESSION_STATUS_LABEL: Record<
  string,
  { label: string; variant: "primary" | "muted" | "neutral" }
> = {
  open: { label: "Aperta", variant: "primary" },
  scheduled: { label: "Programmata", variant: "neutral" },
  closed: { label: "Chiusa", variant: "muted" },
};
