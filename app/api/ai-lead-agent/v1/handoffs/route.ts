// POST /api/ai-lead-agent/v1/handoffs — Agent xin chuyển hội thoại cho nhân viên. Route MỎNG (xac-thuc.ts → dich-vu/handoff.ts).
import type { NextRequest } from "next/server";
import { chayEndpointAgent } from "@/lib/ai-lead/xac-thuc";
import { xuLyHandoff } from "@/lib/ai-lead/dich-vu/handoff";
import { lenLichSauPhanHoi } from "@/lib/ai-lead/dich-vu/nen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return chayEndpointAgent(req, "handoffs", (ctx) => xuLyHandoff(ctx, { lenLichNen: lenLichSauPhanHoi }));
}
