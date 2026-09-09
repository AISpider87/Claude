"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type Theme = "dark" | "light";
const KEY = "superlega-theme";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", theme === "light" ? "#f4f7fb" : "#05080f"));
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode or storage disabled: the choice lasts for this page only.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current theme, or "dark" during server rendering and hydration. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
  return [theme, applyTheme];
}

export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = theme === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted hover:text-foreground hover:bg-surface-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-2 text-sm transition-colors",
        className,
      )}
    >
      {theme === "dark" ? (
        <Sun className="size-5" aria-hidden />
      ) : (
        <Moon className="size-5" aria-hidden />
      )}
      {showLabel && <span>{theme === "dark" ? "Tema chiaro" : "Tema scuro"}</span>}
    </button>
  );
}
