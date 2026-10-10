// POST /api/pos-agent/transactions — máy đồng bộ gửi giao dịch đọc từ portal (≤ 200 dòng / lô).
// Hợp đồng: docs/pos-agent-api.md §4.4 + §6 + §7.2. Thiết kế: docs/pos-gd4-thiet-ke.md §5.
//
// `xacThucYeuCauAgent(` là lời gọi lib ĐẦU TIÊN (lưới [POS4-W3]). Tiền đi ĐÚNG MỘT đường — `nhanGiaoDichAgent`
// đổ dòng vào CHÍNH `nhapLoPos` của import file (T1): một `PosCardTransaction` / một `BankTransaction{CARD_POS}`
// / một bộ `Payment` cho mỗi `transaction_id`, dù agent hay file thấy trước. Ghi tiền ĐỒNG BỘ trong request
// (hợp đồng dặn timeout ≥ 60″) ⇒ `maxDuration` 60.
import type { NextRequest } from "next/server";
import { docThanJson, loiMayChu, phanHoiOk, xacThucYeuCauAgent } from "@/lib/payments/pos/agent/xac-thuc";
import { loGiaoDichSchema, quaTranDong } from "@/lib/payments/pos/agent/schema";
import { nhanGiaoDichAgent } from "@/lib/payments/pos/agent/nhan-giao-dich";
import { TRAN_THAN_LO } from "@/lib/payments/pos/agent/hop-dong";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const now = new Date();
  const xt = await xacThucYeuCauAgent(req, { method: "POST", tranThan: TRAN_THAN_LO, now });
  if (!xt.ok) return xt.res;
  const than = docThanJson(xt.than, loGiaoDichSchema, now, (v) => (quaTranDong(v) ? "TOO_MANY_ROWS" : null));
  if (!than.ok) return than.res;
  try {
    // Đồng hồ là HÀM cho bước kiểm lại phiếu sau lô (mỗi phiếu một mốc mới — luật 19 ở lib).
    return phanHoiOk(await nhanGiaoDichAgent({ agent: xt.agent, than: than.data, now, dongHo: () => new Date() }), now);
  } catch (err) {
    return loiMayChu(err, now, "transactions");
  }
}
