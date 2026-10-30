// GET /api/ai-lead-agent/v1/catalog — danh mục cơ sở đã xuất bản (chỉ Page được cấp cho agent). Route MỎNG: mọi thứ ở lib/ai-lead (xac-thuc.ts → dich-vu/catalog.ts).
import type { NextRequest } from "next/server";
import { chayEndpointAgent } from "@/lib/ai-lead/xac-thuc";
import { xuLyCatalog } from "@/lib/ai-lead/dich-vu/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  return chayEndpointAgent(req, "catalog", xuLyCatalog);
}
