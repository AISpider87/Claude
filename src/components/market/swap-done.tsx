"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

/** Success banner after a swap, with a drawn check mark. */
export function SwapDone({ message }: { message: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      role="status"
      initial={reduced ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="border-primary/40 bg-primary/10 flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3"
    >
      <motion.span
        initial={reduced ? false : { scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.1 }}
        className="bg-primary text-on-primary inline-flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        <Check className="size-5" aria-hidden />
      </motion.span>
      <span className="text-primary text-sm font-semibold">{message}</span>
    </motion.div>
  );
}
