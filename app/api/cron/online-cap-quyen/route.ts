import { withCron } from "@/lib/cron/handler";
import { db } from "@/lib/db";
import { doiSoatCapQuyenOnline } from "@/lib/online-checkout/cap-quyen-sau-thanh-toan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Trần số đơn một lượt: mỗi đơn vài câu đọc + (hiếm) một giao dịch cấp quyền. Dòng chưa xử lý hết lượt này được lượt sau nhặt. */
const GIOI_HAN_DON = 100;

// WORKSTREAM A · cầu nối đơn Online → quyền học. Mỗi 10 phút (crontab VPS; `vercel.json` giữ song song).
//
// Việc DUY NHẤT: thử lại các dòng `OrderOnlineGrant` đang chờ (PENDING) mà tới hạn — bắt lỗi hạ tầng lúc webhook, sổ Payment ghi chậm, hích bị mất.
// ⚠️ Cấp quyền là IDEMPOTENT theo khoá `onl-order:<orderItemId>`: chạy lại / chạy chồng với webhook không cấp đôi. KHÔNG thu hồi quyền nào (chính sách hoàn tiền chưa chốt).
// Không có đơn online đang chờ ⇒ một câu đọc rồi thoát.
export const GET = withCron("online-cap-quyen", async () => {
  const bao = await doiSoatCapQuyenOnline(db, new Date(), { gioiHan: GIOI_HAN_DON });
  console.info(`[online-cap-quyen] đơn ${bao.soDon} · đã cấp ${bao.daCap} · từ chối luật ${bao.tuChoiLuat} · lỗi hạ tầng ${bao.loiHaTang} · chờ thanh toán ${bao.choThanhToan}`);
  return { ok: true, data: bao };
});
