// POST /api/ai-lead-agent/v1/incidents — Agent báo sự cố bằng mã. Route MỎNG (xac-thuc.ts → dich-vu/incident.ts).
import type { NextRequest } from "next/server";
import { chayEndpointAgent } from "@/lib/ai-lead/xac-thuc";
import { xuLyIncident } from "@/lib/ai-lead/dich-vu/incident";
import { lenLichSauPhanHoi } from "@/lib/ai-lead/dich-vu/nen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return chayEndpointAgent(req, "incidents", (ctx) => xuLyIncident(ctx, { lenLichNen: lenLichSauPhanHoi }));
}
