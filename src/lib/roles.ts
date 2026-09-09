import type { RoleClassic } from "@/lib/import/quotations-parser";

/** Classic roles in display order, shared by server and client components. */
export const ROLE_ORDER: RoleClassic[] = ["P", "D", "C", "A"];
export const ROLE_LABEL: Record<RoleClassic, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};
export const ROLE_LABEL_SINGULAR: Record<RoleClassic, string> = {
  P: "Portiere",
  D: "Difensore",
  C: "Centrocampista",
  A: "Attaccante",
};
