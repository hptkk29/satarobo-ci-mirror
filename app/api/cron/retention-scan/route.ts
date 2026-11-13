import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runRetentionScan } from "@/lib/compliance/retention";

export const dynamic = "force-dynamic";

// C6/NĐ13 — Cron (hàng tuần): đếm HV quá hạn lưu trữ cần rà soát xoá.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRetentionScan();
  return NextResponse.json({ ok: true, data: result });
}
