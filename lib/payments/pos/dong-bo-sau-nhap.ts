import "server-only";
// lib/payments/pos/dong-bo-sau-nhap.ts — ĐỒNG BỘ phiếu thu thẻ sau một lượt import file (GĐ1 POS, T11).
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §6.4. Với provider đọc file, dữ liệu chỉ đổi khi Kế toán HO
// import ⇒ KHÔNG cron POLLER ở GĐ1 (poller là việc lặp); `ketThucNhapPosAction` gọi hàm này TRƯỚC
// khi làm mới trang. Tiền đã ghi lúc import (`nhapLoPos` tự khớp) — lượt này chỉ đưa TAY CẦM của
// sale (phiếu POS) về đúng trạng thái, qua CHÍNH `kiemTraPhieuPos` với `triggeredBy: "IMPORT"`.
//
// Phiếu MỞ (CHO_QUET / THAT_BAI) tạo trong 7 ngày, tối đa 100, cũ trước. Lỗi từng phiếu ⇒ ghi nhật ký,
// đi tiếp — một phiếu hỏng không được chặn cả lượt (và không được làm hỏng lượt import đã xong).
//
// GĐ2 (rà đối kháng 06/10/2026): THÊM phiếu `HET_HAN` trong cùng cửa sổ mà CHƯA BỊ THAY (không có phiếu POS
// nào mới hơn cho cùng phiếu gộp) — tức HET_HAN do POLLER ghi lúc 24 giờ, không phải do sale mở phiếu mới.
// GĐ1 chỉ có HET_HAN "bị thay" nên D.4 #5 chọn không đồng bộ HET_HAN; GĐ2 biến HET_HAN thành ca THƯỜNG (file
// nhập sau cuối tuần > 24 giờ), và bỏ nó ra là phiếu kẹt HET_HAN dù tiền đã khớp. Phiếu ĐÃ BỊ THAY vẫn
// không đồng bộ (giữ phương án an toàn của D.4 #5). `quyetPhieuPos` xử lý `daBiThay` an toàn: tiền MATCHED
// vào đúng phiếu gộp ⇒ DA_THU; lệch số ⇒ giữ HET_HAN nhưng ghi câu LECH_TIEN ("Đừng quẹt bù phần chênh").
import type { AuditActor } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { chonPosProvider } from "./provider/chon";
import { TRANG_THAI_MO } from "./phieu-pos-luat";
import { kiemTraPhieuPos } from "./xu-ly-ket-qua";

/** Cửa sổ đồng bộ — phiếu tạo trong chừng này trước `now`. */
export const CUA_SO_DONG_BO_MS = 7 * 24 * 60 * 60_000;
const TRAN_PHIEU = 100;

/**
 * Phiếu `HET_HAN` tạo trong `[now − cuaSoMs, now]` mà CHƯA BỊ THAY: là phiếu POS mới nhất của phiếu gộp của
 * nó. Xếp `createdAt` tăng dần, tối đa `take`. Câu tra hệ thống (cron / sau import) — không scope.
 */
export async function idPhieuHetHanChuaBiThay(x: { now: Date; cuaSoMs: number; take: number }): Promise<string[]> {
  const ung = await db.posPaymentIntent.findMany({
    where: { status: "HET_HAN", createdAt: { gte: new Date(x.now.getTime() - x.cuaSoMs), lte: x.now } },
    orderBy: { createdAt: "asc" },
    take: x.take,
    select: { id: true, paymentBillId: true, createdAt: true },
  });
  if (ung.length === 0) return [];
  const moiNhat = await db.posPaymentIntent.groupBy({
    by: ["paymentBillId"],
    where: { paymentBillId: { in: [...new Set(ung.map((p) => p.paymentBillId))] } },
    _max: { createdAt: true },
  });
  const mocMoiNhat = new Map(moiNhat.map((m) => [m.paymentBillId, m._max.createdAt?.getTime() ?? null]));
  return ung.filter((p) => mocMoiNhat.get(p.paymentBillId) === p.createdAt.getTime()).map((p) => p.id);
}

export async function dongBoPhieuPosSauNhap(input: {
  /** BẮT BUỘC (luật 19). */
  now: Date;
  /** BẮT BUỘC (luật 7, GĐ2): người nhập file — ghi vào nhật ký kiểm (`PosCheckLog.createdById`). */
  nguoiKiemId: string | null;
  nguoiBam?: AuditActor;
}): Promise<{ daKiem: number; loi: number }> {
  const mo = await db.posPaymentIntent.findMany({
    where: {
      status: { in: [...TRANG_THAI_MO] },
      createdAt: { gte: new Date(input.now.getTime() - CUA_SO_DONG_BO_MS), lte: input.now },
    },
    orderBy: { createdAt: "asc" },
    take: TRAN_PHIEU,
    select: { id: true },
  });
  // Phiếu MỞ trước (đang có sale chờ), rồi tới phiếu HET_HAN chưa bị thay — chung một trần.
  const hetHan = await idPhieuHetHanChuaBiThay({ now: input.now, cuaSoMs: CUA_SO_DONG_BO_MS, take: TRAN_PHIEU });
  const phieu = [...mo.map((p) => p.id), ...hetHan].slice(0, TRAN_PHIEU);
  // GĐ4 (T5): IMPORT KHÔNG gác sức khoẻ agent — import file là đường dự phòng khi agent chết; dữ liệu vừa về là
  // dữ liệu MỚI nên đọc như thường (khác lượt MAY — rà đối kháng RV-03, lưới [POS4-W4]).
  const provider = chonPosProvider({ cheDo: "IMPORT" });
  let daKiem = 0;
  let loi = 0;
  for (const intentId of phieu) {
    try {
      await kiemTraPhieuPos({
        intentId,
        provider,
        triggeredBy: "IMPORT",
        now: input.now,
        nguoiKiemId: input.nguoiKiemId,
        ...(input.nguoiBam ? { nguoiBam: input.nguoiBam } : {}),
      });
      daKiem += 1;
    } catch (err) {
      loi += 1;
      console.error(`[pos] đồng bộ sau import — phiếu ${intentId} lỗi:`, err);
    }
  }
  return { daKiem, loi };
}
