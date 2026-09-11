"use client";

import { motion, useReducedMotion } from "framer-motion";

/** Success banner after a swap: the ring lights up and the check draws itself. */
export function SwapDone({ message }: { message: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      role="status"
      initial={reduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="border-primary/40 bg-primary/10 surface-lit flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3"
    >
      <motion.span
        initial={reduced ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 20, delay: 0.08 }}
        className="bg-primary text-on-primary inline-flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden focusable="false">
          <motion.path
            d="M5 12.5 L10 17.5 L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.38, ease: "easeOut", delay: 0.16 }}
          />
        </svg>
      </motion.span>
      <span className="text-primary text-sm font-semibold">{message}</span>
    </motion.div>
  );
}
