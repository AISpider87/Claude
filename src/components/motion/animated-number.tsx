"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatInt } from "@/lib/format";

/**
 * Counts from the previous value to the new one (e.g. credits after a swap).
 * Renders the final value immediately on the server and under reduced motion.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) {
      setShown(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduced]);

  return (
    <span className={className} aria-label={formatInt(value)}>
      {formatInt(shown)}
    </span>
  );
}
