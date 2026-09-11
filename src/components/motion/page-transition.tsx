"use client";

import { usePathname } from "next/navigation";

/**
 * Page-level transition between the main tabs: remounting on the pathname
 * replays the CSS `page-enter` animation, so the new page rises into place
 * once. CSS-only (the animation lives inside `prefers-reduced-motion:
 * no-preference`), so the shared layout bundle stays free of motion code and a
 * reduced-motion viewer simply gets the page.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <div key={usePathname()} className="page-enter">
      {children}
    </div>
  );
}
