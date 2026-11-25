// POST /api/pos-agent/status — máy đồng bộ báo SỰ KIỆN: phiên sống lại / hết phiên / lỗi (mã, không chữ tự do).
// Hợp đồng: docs/pos-agent-api.md §4.2. Thiết kế: docs/pos-gd4-thiet-ke.md §8.1 (T20).
//
// `xacThucYeuCauAgent(` là lời gọi lib ĐẦU TIÊN (lưới [POS4-W3]).
import type { NextRequest } from "next/server";
import { docThanJson, loiMayChu, phanHoiOk, xacThucYeuCauAgent } from "@/lib/payments/pos/agent/xac-thuc";
import { statusSchema } from "@/lib/payments/pos/agent/schema";
import { nhanStatus } from "@/lib/payments/pos/agent/phien";
import { TRAN_THAN_NHO } from "@/lib/payments/pos/agent/hop-dong";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const now = new Date();
  const xt = await xacThucYeuCauAgent(req, { method: "POST", tranThan: TRAN_THAN_NHO, now });
  if (!xt.ok) return xt.res;
  const than = docThanJson(xt.than, statusSchema, now);
  if (!than.ok) return than.res;
  try {
    return phanHoiOk(await nhanStatus({ agent: xt.agent, than: than.data, now }), now);
  } catch (err) {
    return loiMayChu(err, now, "status");
  }
}
