"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

/** Fade + slide-in for freshly shown sections (confirmation steps, success banners). */
export function Reveal({ children, ...props }: HTMLMotionProps<"div">) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
