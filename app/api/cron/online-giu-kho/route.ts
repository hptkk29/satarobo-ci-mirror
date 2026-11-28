import { withCron } from "@/lib/cron/handler";
import { db } from "@/lib/db";
import { quetHetHan } from "@/lib/inventory/giu-kho";
import { quetThongBaoCoHang } from "@/lib/online-checkout/danh-muc-hoc-cu";
import { hoanTatHangSauThanhToan } from "@/lib/online-checkout/hang-sau-thanh-toan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Trần số đơn thử lại một lượt (mỗi đơn vài câu đọc + hiếm khi một giao dịch). Dòng chưa xử lý hết được lượt sau nhặt. */
const GIOI_HAN_DON = 100;

// V8.43 · HỌC CỤ ONLINE — mỗi 5 phút (crontab VPS; `vercel.json` giữ song song). Ba việc, cả ba IDEMPOTENT:
//   1. QUÉT HẾT HẠN giữ kho: ACTIVE quá hạn → EXPIRED (tồn khả dụng đã tự hồi theo vị từ `expiresAt > now`; quét chỉ để sổ và báo cáo khớp, và để app thấy `HET_HAN` thật).
//   2. THỬ LẠI HÀNG ĐÃ THU TIỀN: đơn Online có dòng học cụ còn AWAITING_PAYMENT mà đã có khoản thu (hích webhook bị mất / lỗi hạ tầng) ⇒ chạy lại cầu nối.
//      Đơn chưa đủ tiền ⇒ cầu nối tự bỏ qua. KHÔNG thu hồi, KHÔNG huỷ, KHÔNG hoàn gì.
//   3. «BÁO KHI CÓ HÀNG»: sản phẩm bán Online còn người chờ + khả dụng > 0 ⇒ báo MỘT lần/đăng ký (sau bước 1 để phần giữ kho vừa hết hạn được tính).
export const GET = withCron("online-giu-kho", async () => {
  const now = new Date();
  const daQuet = await quetHetHan(db, { now });
  const don = await db.orderItem.findMany({
    where: { type: "PRODUCT", fulfillment: { status: "AWAITING_PAYMENT" }, order: { type: "ONLINE", deletedAt: null, status: { not: "CANCELLED" }, payments: { some: { amount: { gt: 0 } } } } },
    select: { orderId: true },
    distinct: ["orderId"],
    orderBy: { createdAt: "asc" },
    take: GIOI_HAN_DON,
  });
  let daThanhToan = 0;
  let canNhanVien = 0;
  let loi = 0;
  for (const d of don) {
    const kq = await hoanTatHangSauThanhToan(db, d.orderId, now);
    for (const x of kq.dong) {
      if (x.ketQua === "DA_THANH_TOAN") daThanhToan++;
      else if (x.ketQua === "CAN_NHAN_VIEN_XU_LY") canNhanVien++;
      else if (x.ketQua === "LOI_HA_TANG") loi++;
    }
  }
  const coHang = await quetThongBaoCoHang(db, { now });
  console.info(`[online-giu-kho] đã quét hết hạn ${daQuet} · đơn xét ${don.length} · dòng đã thanh toán ${daThanhToan} · cần nhân viên ${canNhanVien} · lỗi hạ tầng ${loi} · có hàng lại ${coHang.daGui} báo/${coHang.sanPham} sp/${coHang.loi} lỗi`);
  return { ok: true, data: { daQuet, soDon: don.length, daThanhToan, canNhanVien, loiHaTang: loi, coHangLai: coHang } };
});
