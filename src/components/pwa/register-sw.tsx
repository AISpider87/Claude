"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker (production only). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // A failed registration only means no offline shell; the app keeps working.
    });
  }, []);
  return null;
}
