"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

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

/** Under one hour the countdown is "urgent": a light sweeps across the digits. */
const URGENT_MS = 60 * 60_000;

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
  const left = now === null ? null : target - now;
  const urgent = left !== null && left > 0 && left <= URGENT_MS;
  return (
    <span
      className={cn(className, urgent && "countdown-urgent")}
      aria-live="polite"
      data-urgent={urgent ? "true" : undefined}
    >
      {left === null ? "—" : format(left)}
    </span>
  );
}
