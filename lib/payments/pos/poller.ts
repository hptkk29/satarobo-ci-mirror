import "server-only";
// lib/payments/pos/poller.ts — POLLER phiếu thu thẻ (GĐ2 POS · 06/10/2026). Cron `/api/cron/pos-poller`
// mỗi phút. Thiết kế: docs/pos-gd2-thiet-ke.md §3.
//
// MỘT lượt:
//   ① tập QUÁ HẠN (phiếu mở, `expiresAt ≤ now`, ≤ 30 phiếu, hạn cũ trước): kiểm LẦN CUỐI qua
//      `kiemTraPhieuPos` (sự thật về tiền thắng — tiền đã có ⇒ DA_THU trước khi kịp hết hạn) rồi
//      `hetHanPhieuPos` (U11). Lượt kiểm cuối NÉM, ra CACHE, hoặc CHƯA KẾT LUẬN được (lỗi kết nối / pha
//      tiền ném — `choPhepHetHan`) ⇒ KHÔNG ghi HET_HAN lượt này (không kết luận khi chưa biết sự thật);
//      thử lại theo nhịp 10 phút tới trần (`dieuKienPollerHetHan`).
//      Phiếu đã HET_HAN vẫn được ĐỒNG BỘ sau import / quét sạch nếu CHƯA bị thay (`dong-bo-sau-nhap.ts`).
//   ② tập CÒN HẠN đến nhịp (`dieuKienPollerConHan`, ≤ 30 phiếu, chưa kiểm / kiểm cũ nhất trước): kiểm.
// Ngân sách 40 giây cho cả lượt (`NGAN_SACH_POLLER_MS`) — hết thì dừng, đếm phần bỏ lại.
//
// ⚠️ KHÔNG đường tiền riêng (lưới `[POS2-W1]`): tiền chỉ qua `kiemTraPhieuPos` → `xuLyKetQuaPos` →
// `khopGiaoDichThe` (thân dòng của `nhapLoPos`). KHÔNG hỏi cờ `billing.flexV1Enabled` (T8 — cờ tắt
// giữa chừng thì tiền đã quẹt vẫn phải đối soát, `[POS2-PL-10]`). KHÔNG lọc cơ sở. KHÔNG ghi QUYỀN
// (luật cứng #8) — chỉ trạng thái tay cầm của sale.
//
// `now` lấy MỚI cho từng phiếu (`dongHo()`), không một mốc cho cả lô: lô dài 40 giây với một mốc cũ sẽ
// ghi `lastCheckAt` lùi so với lượt sale vừa bấm, và cửa sổ chống bấm dồn 5 giây so sai.
import { db } from "@/lib/db";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { writeAudit } from "@/lib/audit/audit-log";
import { chonPosProvider } from "./provider/chon";
import type { PosProvider } from "./provider/kieu";
import { choPhepHetHan, laPhieuMo, phieuPosHetHan, TRANG_THAI_MO } from "./phieu-pos-luat";
import {
  dieuKienPollerConHan,
  dieuKienPollerHetHan,
  NGAN_SACH_POLLER_MS,
  TRAN_POLLER_CON_HAN,
  TRAN_POLLER_HET_HAN,
} from "./lich-kiem";
import { khoaPhieuPosTrongTx, kiemTraPhieuPos } from "./xu-ly-ket-qua";

export type KetQuaPoller = {
  /** Lượt GỌI provider (không tính CACHE). */
  daKiem: number;
  /** Lượt bị cửa sổ chống bấm dồn chặn (sale vừa bấm). */
  cache: number;
  /** Phiếu ném lỗi — đã ghi console.error, lượt vẫn đi tiếp. */
  loi: number;
  /** Phiếu vừa được ghi HET_HAN. */
  hetHan: number;
  /** Phiếu bị bỏ lại vì hết ngân sách thời gian. */
  boQuaHetGio: number;
};

/**
 * Ghi HET_HAN cho MỘT phiếu đã quá 24 giờ (U11) — dưới khoá ĐƠN rồi khoá DÒNG (CÙNG thứ tự khoá với pha
 * phiếu và `taoPhieuPosTrongKhoa` ⇒ đua với "Thẻ POS" của sale là tuần tự, `[POS2-PL-08]`). Cổng đứng
 * TRƯỚC phép ghi; phép ghi là `updateMany` CÓ ĐIỀU KIỆN "còn mở và đã quá hạn" (ngoại lệ hợp lệ FIX-H9:
 * đổi 0 dòng ⇒ commit vô hại). KHÔNG đụng `lastResult*` (câu của lượt kiểm cuối giữ nguyên) và
 * `bankTransactionId` — phiếu HET_HAN vẫn lên DA_THU nếu sau này tiền vào đúng phiếu gộp.
 */
export async function hetHanPhieuPos(x: { intentId: string; now: Date }): Promise<{ doi: boolean }> {
  const goc = await db.posPaymentIntent.findUnique({
    where: { id: x.intentId },
    select: { paymentBill: { select: { orderId: true } } },
  });
  if (!goc) return { doi: false };
  const orderId = goc.paymentBill.orderId;
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, orderId);
    await khoaPhieuPosTrongTx(tx, x.intentId);
    const p = await tx.posPaymentIntent.findUnique({
      where: { id: x.intentId },
      select: { id: true, status: true, expiresAt: true, code5: true, lastResultKind: true },
    });
    // CỔNG trước phép ghi: đã đóng (DA_THU vừa về / bị thay) hoặc chưa tới hạn ⇒ không làm gì.
    if (!p || !laPhieuMo(p.status) || !phieuPosHetHan(p.expiresAt, x.now)) return { doi: false };
    // CỔNG (rà đối kháng 06/10/2026): lượt gần nhất CHƯA KẾT LUẬN được — lỗi kết nối, hoặc PAID* trên phiếu
    // MỞ (= pha tiền ném, "tiền có thể đã trừ thẻ") ⇒ KHÔNG kết luận HET_HAN; poller thử lại theo nhịp.
    // Đọc DƯỚI khoá dòng: không lượt nào đổi được kết quả giữa lúc đọc và lúc ghi.
    if (!choPhepHetHan(p.lastResultKind)) return { doi: false };
    const u = await tx.posPaymentIntent.updateMany({
      where: { id: p.id, status: { in: [...TRANG_THAI_MO] }, expiresAt: { lte: x.now } },
      data: { status: "HET_HAN" },
    });
    if (u.count === 0) return { doi: false };
    await writeAudit({
      tx,
      actor: { id: null, name: "Phiếu thu thẻ (tự kiểm định kỳ)" },
      module: "finance",
      entityType: "Order",
      entityId: orderId,
      action: "POS_PHIEU_HET_HAN",
      oldValues: { intentId: p.id, status: p.status },
      newValues: { intentId: p.id, status: "HET_HAN" },
      reason: `Phiếu thu thẻ mã ${p.code5} quá hạn 24 giờ`,
    });
    return { doi: true };
  });
}

/** MỘT lượt poller (§3.2). Route truyền `dongHo: () => new Date()`; test truyền đồng hồ đóng băng / bước. */
export async function chayPollerPos(input: {
  /** BẮT BUỘC (luật 19). Gọi MỚI cho từng phiếu. */
  dongHo: () => Date;
  /** Test tiêm Fake; mặc định `chonPosProvider()`. */
  provider?: PosProvider;
}): Promise<KetQuaPoller> {
  // GĐ4 (T5 + rà đối kháng RV-03): lượt máy KHÔNG chờ job; agent không sẵn sàng ⇒ chỉ tin PAID, giữ D9 ([POS4-W4]).
  const provider = input.provider ?? chonPosProvider({ cheDo: "MAY" });
  const batDau = input.dongHo();
  const hetGio = (t: Date) => t.getTime() - batDau.getTime() > NGAN_SACH_POLLER_MS;
  const kq: KetQuaPoller = { daKiem: 0, cache: 0, loi: 0, hetHan: 0, boQuaHetGio: 0 };

  // ① QUÁ HẠN — kiểm lần cuối rồi ghi HET_HAN.
  const quaHan = await db.posPaymentIntent.findMany({
    where: dieuKienPollerHetHan(batDau),
    orderBy: { expiresAt: "asc" },
    take: TRAN_POLLER_HET_HAN,
    select: { id: true },
  });
  for (let i = 0; i < quaHan.length; i += 1) {
    const t = input.dongHo();
    if (hetGio(t)) {
      kq.boQuaHetGio += quaHan.length - i;
      return kq; // hết ngân sách ⇒ tập còn hạn chờ lượt sau
    }
    const intentId = quaHan[i]!.id;
    try {
      const r = await kiemTraPhieuPos({ intentId, provider, triggeredBy: "POLLER", now: t, nguoiKiemId: null });
      if (r.tuCache) {
        // Lượt cuối KHÔNG hỏi provider (lượt khác đang bay — thường là sale vừa bấm) ⇒ chưa biết sự thật,
        // KHÔNG ghi HET_HAN; lượt sau hỏi lại (rà đối kháng 06/10/2026). Ghi HET_HAN ở đây thì lượt đang bay
        // về sau thấy phiếu "đã bị thay" và giữ HET_HAN thay vì kết luận của chính nó (vd LECH_TIEN).
        kq.cache += 1;
        continue;
      }
      kq.daKiem += 1;
      // `hetHanPhieuPos` tự từ chối khi kết quả vừa lưu CHƯA KẾT LUẬN được (lỗi kết nối / pha tiền ném).
      if ((await hetHanPhieuPos({ intentId, now: input.dongHo() })).doi) kq.hetHan += 1;
    } catch (err) {
      kq.loi += 1;
      console.error(`[pos:poller] phiếu ${intentId} (quá hạn) lỗi:`, err);
    }
  }

  // ② CÒN HẠN, đến nhịp.
  const conHan = await db.posPaymentIntent.findMany({
    where: dieuKienPollerConHan(batDau),
    orderBy: [{ lastCheckAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: TRAN_POLLER_CON_HAN,
    select: { id: true },
  });
  for (let i = 0; i < conHan.length; i += 1) {
    const t = input.dongHo();
    if (hetGio(t)) {
      kq.boQuaHetGio += conHan.length - i;
      break;
    }
    const intentId = conHan[i]!.id;
    try {
      const r = await kiemTraPhieuPos({ intentId, provider, triggeredBy: "POLLER", now: t, nguoiKiemId: null });
      if (r.tuCache) kq.cache += 1;
      else kq.daKiem += 1;
    } catch (err) {
      kq.loi += 1;
      console.error(`[pos:poller] phiếu ${intentId} lỗi:`, err);
    }
  }
  return kq;
}
