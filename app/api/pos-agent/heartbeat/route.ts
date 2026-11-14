// POST /api/pos-agent/heartbeat — máy đồng bộ báo còn sống + trạng thái phiên portal + mốc hết hạn + phiên bản.
// Hợp đồng: docs/pos-agent-api.md §4.1. Thiết kế: docs/pos-gd4-thiet-ke.md §4, §8.1.
//
// `xacThucYeuCauAgent(` là lời gọi lib ĐẦU TIÊN (lưới [POS4-W3]) — chữ ký HMAC, lệch giờ, nonce, active, trần
// thân. Không phiên đăng nhập: `/api/*` đi thẳng tới handler ở mọi host (`isInfraPath` — [POS4-RT-01]).
import type { NextRequest } from "next/server";
import { docThanJson, loiMayChu, phanHoiOk, xacThucYeuCauAgent } from "@/lib/payments/pos/agent/xac-thuc";
import { heartbeatSchema } from "@/lib/payments/pos/agent/schema";
import { nhanHeartbeat } from "@/lib/payments/pos/agent/phien";
import { TRAN_THAN_NHO } from "@/lib/payments/pos/agent/hop-dong";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const now = new Date();
  const xt = await xacThucYeuCauAgent(req, { method: "POST", tranThan: TRAN_THAN_NHO, now });
  if (!xt.ok) return xt.res;
  const than = docThanJson(xt.than, heartbeatSchema, now);
  if (!than.ok) return than.res;
  try {
    return phanHoiOk(await nhanHeartbeat({ agent: xt.agent, than: than.data, now }), now);
  } catch (err) {
    return loiMayChu(err, now, "heartbeat");
  }
}
