"use client";

import { useEffect, useState } from "react";

/**
 * Mobile top bar: slim, and it lifts off the page (border + shadow) as soon as
 * the content scrolls under it. Pure class swap — no layout change, no jank.
 */
export function AppHeader({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled ? "true" : "false"}
      className="app-header safe-top border-line bg-background/85 sticky top-0 z-20 flex min-h-12 items-center justify-between border-b px-4 backdrop-blur lg:hidden"
    >
      {children}
    </header>
  );
}
