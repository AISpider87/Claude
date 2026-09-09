"use client";

import { useEffect, useState } from "react";

function format(ms: number) {
  if (ms <= 0) return "chiusa";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}g ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Time left until `until` (ISO UTC), refreshed every second; renders "—" until hydrated. */
export function Countdown({ until, className }: { until: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 1000);
    // First paint after hydration; the interval owns later updates.
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, []);
  const target = new Date(until).getTime();
  return (
    <span className={className} aria-live="polite">
      {now === null ? "—" : format(target - now)}
    </span>
  );
}
