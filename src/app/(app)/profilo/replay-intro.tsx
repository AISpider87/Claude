"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { replayIntro } from "@/components/motion/login-intro";

/**
 * Replays the sign-in cinematic without signing out: the admin asked to be able
 * to see it again, and it is the quickest way to check it after a deploy.
 */
export function ReplayIntroButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => replayIntro()}>
      <Sparkles className="size-4" aria-hidden /> Rivedi l&apos;animazione
    </Button>
  );
}
