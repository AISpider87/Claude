import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { loadListoneExport, loadRostersExport, loadTransactionsExport } from "@/lib/export/queries";
import {
  buildListoneWorkbook,
  buildRostersWorkbook,
  buildTransactionsWorkbook,
  workbookToBuffer,
} from "@/lib/export/workbooks";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KINDS = new Set(["rose", "listone", "operazioni"]);

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

/** Admin-only Excel exports; the data itself is read under the admin's RLS session. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { kind } = await ctx.params;
  if (!KINDS.has(kind)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const supabase = await createClient();
  const { error: limited } = await supabase.rpc("consume_rate_limit", { p_bucket: "export" });
  if (limited) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  let workbook;
  if (kind === "rose") {
    const { rosters, teams } = await loadRostersExport();
    workbook = buildRostersWorkbook(rosters, teams);
  } else if (kind === "listone") {
    workbook = buildListoneWorkbook(await loadListoneExport());
  } else {
    workbook = buildTransactionsWorkbook(await loadTransactionsExport());
  }
  const bytes = await workbookToBuffer(workbook);
  return new NextResponse(new Blob([bytes], { type: XLSX_MIME }), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="superlega-${kind}-${stamp()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
