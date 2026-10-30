// POST /api/ai-lead-agent/v1/heartbeats — nhịp sống có ký + lệnh thăm dò. Route MỎNG (xac-thuc.ts → dich-vu/heartbeat.ts).
import type { NextRequest } from "next/server";
import { chayEndpointAgent } from "@/lib/ai-lead/xac-thuc";
import { xuLyHeartbeat } from "@/lib/ai-lead/dich-vu/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return chayEndpointAgent(req, "heartbeats", xuLyHeartbeat);
}
