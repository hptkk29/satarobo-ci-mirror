// POST /api/ai-lead-agent/v1/lead-intakes — ghi mù một lần ghi nhận nhu cầu tư vấn. Route MỎNG (xac-thuc.ts → dich-vu/intake.ts). KHÔNG đọc CRM trên đường phản hồi (N1).
import type { NextRequest } from "next/server";
import { chayEndpointAgent } from "@/lib/ai-lead/xac-thuc";
import { xuLyLeadIntake } from "@/lib/ai-lead/dich-vu/intake";
import { lenLichSauPhanHoi } from "@/lib/ai-lead/dich-vu/nen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return chayEndpointAgent(req, "leadIntakes", (ctx) => xuLyLeadIntake(ctx, { lenLichNen: lenLichSauPhanHoi }));
}
