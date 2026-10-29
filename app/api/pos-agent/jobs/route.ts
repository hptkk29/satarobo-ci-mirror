// GET /api/pos-agent/jobs — yêu cầu "đồng bộ ngay" PENDING của CHÍNH agent (job sale bấm Kiểm tra tạo).
// Hợp đồng: docs/pos-agent-api.md §4.3 + §5 (`nextPollMs`). Đây cũng là request "còn sống" chính (≤ 60″/lần — T4).
//
// `xacThucYeuCauAgent(` là lời gọi lib ĐẦU TIÊN (lưới [POS4-W3]). Thân PHẢI rỗng (trần 0 byte).
import type { NextRequest } from "next/server";
import { loiMayChu, phanHoiOk, xacThucYeuCauAgent } from "@/lib/payments/pos/agent/xac-thuc";
import { docJobChoAgent } from "@/lib/payments/pos/agent/job";
import { docNextPollMs } from "@/lib/payments/pos/agent/nhip-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const now = new Date();
  const xt = await xacThucYeuCauAgent(req, { method: "GET", tranThan: 0, now });
  if (!xt.ok) return xt.res;
  try {
    const [jobs, nextPollMs] = await Promise.all([docJobChoAgent(xt.agent.id, now), docNextPollMs(xt.agent, now)]);
    return phanHoiOk({ jobs, nextPollMs, serverTime: now.getTime() }, now);
  } catch (err) {
    return loiMayChu(err, now, "jobs");
  }
}
