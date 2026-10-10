import "server-only";
// lib/payments/pos/huy-phieu-the-db.ts — "HUỶ PHIẾU THẺ": phần GHI (Việc 4 · 09/10/2026, máy chủ).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6 (hợp đồng) + §6.11 (kết quả). Luật "huỷ được không" là hàm THUẦN
// `choPhepHuyPhieuThe` (`huy-phieu-the.ts`) — màn vẽ nút bằng chính nó. Tệp này là phần DUY NHẤT ĐỌC LẠI sự thật dưới khoá rồi
// hỏi nó, và là nơi DUY NHẤT (cùng `phieu-pos.ts`) ghi `PosPaymentIntent.status = HUY`.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ NÚT NÀY
//
// Việc 1 chặn "Huỷ phiếu" (gộp) khi thẻ còn mở — để một khoản quẹt theo mã cũ không rơi vào hàng chờ gắn tay rồi sale phát mã
// mới và đòi khách trả lần hai. Cái giá: bấm nhầm "Thẻ POS" là khoá cả đơn (đợt khác cũng không phát được mã) tới 24 giờ. Nút
// này là lối thoát: phiếu thẻ đóng lại, MÃ và PHIẾU GỘP còn nguyên.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA ĐIỀU PHẢI GIỮ
//
// 1. THỨ TỰ KHOÁ đơn → dòng phiếu thẻ — CÙNG mọi đường tiền / đường phiếu (`xuLyKetQuaPos` pha phiếu, `hetHanPhieuPos`,
//    `taoPhieuPosTrongKhoa`). Đảo thứ tự là mở đường cho vòng chờ. Lưới `[HN4-S-W1]` ghim.
// 2. ĐỌC LẠI MỌI ĐẦU VÀO DƯỚI KHOÁ. Hàm không nhận bất kỳ trạng thái nào từ màn: màn nói "huỷ được" lúc 10:00, lúc 10:02 tiền
//    vào (phiếu gộp PAID, phiếu thẻ chưa ai Kiểm tra nên vẫn CHO_QUET) — chỉ lượt đọc DƯỚI khoá mới thấy. `[HN4-DB-04b/c]` ép đúng
//    thứ tự đó bằng một phiên giữ khoá.
// 3. MỌI CỔNG TRƯỚC PHÉP GHI ĐẦU TIÊN. Từ chối = `return` (chưa ghi gì nên commit rỗng vô hại); sau phép ghi chỉ có `throw`.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHÉP GHI DUY NHẤT
//
//   `posPaymentIntent.updateMany({ where: { id, status ∈ {CHO_QUET, THAT_BAI}, bankTransactionId: null }, data: { status: "HUY" } })`
//
// `updateMany` CÓ ĐIỀU KIỆN (mẫu chống-đua FIX-H9) chứ không `update` trần: dưới khoá, điều kiện là LỚP THỨ HAI sau "đọc lại" —
// bỏ một lớp thì ca hành vi vẫn xanh (lớp kia đủ chặn), nên lưới văn bản `[HN4-S-W3]` ghim. Đổi 0 dòng dưới khoá là BẤT KHẢ ⇒
// `throw` để rollback (không `return`: sau phép ghi `return { ok: false }` là "từ chối mà đã ghi" — đúng lỗi `goGanTheoCon` 17/09).
//
// KHÔNG đụng: PaymentBill · Order · Payment · BankTransaction · PaymentAllocation · PaymentRequest · PosCardTransaction · nhật ký kiểm.
// Phiếu gộp VẪN mở với cùng mã ⇒ "Thẻ POS" mở lại phiếu thẻ mới DÙNG LẠI mã; nút QR dùng được; "Huỷ phiếu" qua cổng của Việc 1.
//
// [VIỆC 6 · a3 · mục 3] Phép ghi nay nằm ở `ghiHuyPhieuTheTrongTx` (cuối khối khai báo, trước `huyPhieuThe`) và có HAI người gọi: nút tay (`huyPhieuThe`, `nguon: "HUY_TAY"`) và
// DỪNG HỌC huỷ kèm phiếu thẻ mở cùng phiếu gộp (`huy-the-cung-phieu-gop.ts`, `nguon: "DUNG_HOC"`). MỘT đường ghi: điều kiện `updateMany`, câu "bất khả ⇒ NÉM" và vết `POS_PHIEU_HUY`
// không có bản thứ hai để lệch nhau. Mỗi người gọi giữ cổng RIÊNG của mình (nút tay hỏi `choPhepHuyPhieuThe`; dừng học là quyết toán của hệ thống nên KHÔNG bị cổng tiền của nút tay chặn).
// `scopedDb` KHÔNG che write: phạm vi đã gác ở action (`congXemPhieuPos` + cổng IDOR); ở đây dùng `tx` trần sau cổng.
//
// ─────────────────────────────────────────────────────────────────────────────
// CẠM BẪY `mocChoTay` (đo từ `docTheDangMoCuaPhieuGop`, đã ăn đòn ở `taoPhieuPosTrongKhoa` 06/10)
//
// "Có giao dịch thẻ mang MÃ nằm hàng chờ tay" phải tính với mốc của MỌI phiếu thẻ của phiếu gộp, không chỉ phiếu đang huỷ: lần
// quẹt dưới phiếu CŨ (đã bị thay) mà file về SAU khi phiếu mới mở nằm trước `createdAt − 5′` của phiếu mới. Dùng `createdAt` của
// riêng phiếu này là bỏ sót nó ⇒ cho huỷ khi tiền khách đã bị trừ. `[HN4-DB-03]` (ca "CẠM BẪY mốc") + `[HN4-S-W4]` ghim.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI LƯỢT ĐỌC CỦA VIỆC 3 (`yeu-cau-sai-ma-dang-giu.ts`) — ĐỌC BẢNG `PosSaiMaYeuCau` THẬT, bằng `tx` TRẦN dưới khoá đơn + khoá dòng phiếu
//
// Đường thật của Việc 3 chuyển phiếu sang CAN_XU_LY ngay lúc gửi yêu cầu nên cổng ① (trạng thái) thường nói trước; `coYeuCauSaiMaDangGiu` là lớp
// phòng thủ cho dữ liệu vi phạm bất biến đó. VIỆC 6 · a2 (chủ dự án chốt 10/10/2026): cổng riêng "yêu cầu mới nhất bị từ chối" (V4.2, mã `SAI_MA_BI_TU_CHOI`) ĐÃ GỠ — kế toán từ chối thì sale HUỶ ĐƯỢC
// theo cổng thường. Ca lách "bác X ⇒ huỷ ⇒ mở phiếu mới ⇒ gửi LẠI X" do bộ nhớ khoá theo ĐƠN của Việc 5 chặn (`docGiaoDichDaBiBac`; `[HN4-DB-13e]` chạy đúng ca ấy bằng đường huỷ THẬT: X không tự ghi nhận, 0 Payment).
// Lượt đọc thứ hai nay là `yeuCauSaiMaMoiNhat` (trạng thái + lý do): để NHẬN RA câu lưu sau từ chối (`laCauLuuTuChoiSaiMa`) — không nhận ra thì nấc ③ nói `CHUA_NGA_NGU` ngay sau từ chối rồi tự đổi sang "cho huỷ" khi poller
// ghi đè câu, tức nút nhấp nháy (`[HN4-DB-13c]`) — và để ghi `sauTuChoiSaiMa` vào vết huỷ. Hai lượt đọc đứng SAU khoá đơn nên không thấy trạng thái nửa vời (mọi writer đổi "sống ⇄ bị từ chối" — gửi · từ chối — cũng lấy
// khoá đơn trước). Tra bằng `tx` trần, không `scopedDb`: câu tra `coYeuCauSaiMaDangGiu` để CHẶN mà bị lọc phạm vi thì trả `false` đúng lúc cần chặn (`[HN4-DB-13f]`).
import type { PosIntentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { choPhepHuyPhieuThe, laCauLuuTuChoiSaiMa, type KetQuaHuyPhieuThe } from "./huy-phieu-the";
import type { PosCheckResult } from "./provider/kieu";
import {
  CAU_THIEU_XAC_NHAN_MANH,
  ghepCauTuChoiHuy,
  NHAN_LY_DO_HUY_PHIEU_THE,
  type MaLyDoHuyPhieuThe,
} from "./huy-phieu-the-cau";
import { phieuPosHetHan, TRANG_THAI_MO } from "./phieu-pos-luat";
import { maCoDongTheChuaKetLuan } from "./dong-the-chua-ket-luan";
import { maCoGiaoDichChoTay, mocChoTay } from "./the-dang-mo";
import { khoaPhieuPosTrongTx } from "./xu-ly-ket-qua";
import { coYeuCauSaiMaDangGiu, yeuCauSaiMaMoiNhat } from "./yeu-cau-sai-ma-dang-giu";

/**
 * Từ chối SAU phép ghi — phải NÉM (return không rollback). Chỉ có MỘT chỗ ném: `updateMany` đổi 0 dòng dưới khoá (bất khả theo
 * thiết kế; nếu xảy ra là có đường ghi trạng thái phiếu thẻ không đi qua khoá — đáng để nổi lên, và người dùng nhận một câu thật).
 */
class LoiHuyPhieuThe extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiHuyPhieuThe";
  }
}

const CAU_KHONG_THAY_PHIEU = "Không tìm thấy phiếu POS";
const CAU_VUA_DOI = "Phiếu thẻ vừa đổi trạng thái — tải lại trang rồi thử lại";

/**
 * Ai đứng sau một lượt HUY phiếu thẻ — vào `newValues.nguon` của vết. `HUY_TAY` = nút "Huỷ phiếu thẻ" (Việc 4); `DUNG_HOC` = dừng học huỷ kèm (Việc 6); `TU_CHOI_SAI_MA` = kế toán TỪ CHỐI
 * yêu cầu "nhập sai mã" khi phiếu gộp của phiếu thẻ ĐÃ ĐÓNG (dừng học · đổi khoá… để nguyên phiếu thẻ đang giữ giao dịch chờ kế toán quyết): việc nhả phiếu thẻ về mở sẽ dựng lại đúng
 * một phiếu thẻ MỞ trên mã đã chết, nên nhả xong phải KẾT THÚC nó luôn (`sai-ma-ghi.ts` · `tuChoiSaiMa`).
 */
export type NguonHuyPhieuThe = "HUY_TAY" | "DUNG_HOC" | "TU_CHOI_SAI_MA";

/**
 * PHÉP GHI DUY NHẤT của "HUY phiếu thẻ" [VIỆC 6 · a3] — chạy TRONG transaction + khoá đơn + khoá dòng phiếu của người gọi (hàm KHÔNG tự lấy khoá, KHÔNG tự đọc lại).
 *
 * `updateMany` CÓ ĐIỀU KIỆN (mẫu chống-đua FIX-H9): `status ∈ TRANG_THAI_MO` và `bankTransactionId: null` — phiếu đã nhận giao dịch KHÔNG BAO GIỜ bị HUY bằng đường này, dù người gọi
 * quên kiểm. Dưới khoá điều kiện là LỚP THỨ HAI sau "đọc lại"; đổi 0 dòng là BẤT KHẢ ⇒ `throw` (không `return`: sau phép ghi `return { ok:false }` là "từ chối mà đã ghi" — lỗi `goGanTheoCon` 17/09).
 * Vết `POS_PHIEU_HUY` đi CÙNG `tx`. Chỉ đổi cột `status`: mã, kết quả lượt kiểm, giao dịch đã nhận, hạn giữ nguyên.
 *
 * `them` = phần `newValues` RIÊNG của từng người gọi (lý do chọn + ghi chú + tick của nút tay; bé + phiếu gộp của dừng học); các khoá chung (`intentId`, `billId`, `status`, `ma`, `nguon`,
 * `ketQuaTruoc`) đặt SAU `them` trong đối tượng kết quả để người gọi không ghi đè được chúng.
 */
export async function ghiHuyPhieuTheTrongTx(
  tx: Prisma.TransactionClient,
  x: {
    orderId: string;
    intentId: string;
    billId: string;
    code5: string;
    /** Trạng thái phiếu thẻ LÚC ĐỌC dưới khoá — vào `oldValues`. */
    trangThaiTruoc: PosIntentStatus;
    /** Kết quả lượt kiểm gần nhất — vết ghi lại để người đọc sổ biết phiếu bị huỷ khi nó đang ở dấu hiệu nào. */
    ketQuaTruoc: PosCheckResult["kind"] | null;
    actor: AuditActor;
    nguon: NguonHuyPhieuThe;
    /** Cột `AuditLog.reason` (cắt ở 500 ký tự — cột dùng chung với mọi vết khác). */
    reason: string;
    them: Record<string, unknown>;
  },
): Promise<void> {
  const u = await tx.posPaymentIntent.updateMany({
    where: { id: x.intentId, status: { in: [...TRANG_THAI_MO] }, bankTransactionId: null },
    data: { status: "HUY" },
  });
  if (u.count === 0) throw new LoiHuyPhieuThe(CAU_VUA_DOI);
  await writeAudit({
    tx,
    actor: x.actor,
    module: "finance",
    entityType: "Order",
    entityId: x.orderId,
    action: "POS_PHIEU_HUY",
    oldValues: { intentId: x.intentId, status: x.trangThaiTruoc },
    newValues: { ...x.them, intentId: x.intentId, billId: x.billId, status: "HUY", ma: x.code5, nguon: x.nguon, ketQuaTruoc: x.ketQuaTruoc },
    reason: x.reason.slice(0, 500),
  });
}

export async function huyPhieuThe(input: {
  /** Đơn ĐÃ qua cổng quyền + phạm vi ở action. Hàm vẫn kiểm phiếu thuộc ĐÚNG đơn này DƯỚI khoá (chiều sâu của cổng IDOR). */
  orderId: string;
  intentId: string;
  lyDo: MaLyDoHuyPhieuThe;
  /** Ghi chú tự do (đã qua zod: ≤ 200 ký tự; "Khác" thì ≥ 3 ký tự). */
  ghiChu?: string | undefined;
  /** "Tôi chắc khách chưa quẹt" — BẮT BUỘC, không mặc định. Máy chủ quyết CÓ CẦN tick không (luật thuần), không tin cờ này để bỏ cổng. */
  xacNhanKhachChuaQuet: boolean;
  /** Người bấm (từ PHIÊN). `id: null` khi phiên không có id. */
  actor: AuditActor;
  /** BẮT BUỘC (luật 19): hết hạn của phiếu thẻ đo theo giờ này. Action truyền `new Date()`; test truyền mốc tuyệt đối. */
  now: Date;
}): Promise<KetQuaHuyPhieuThe> {
  try {
    return await db.$transaction(async (tx): Promise<KetQuaHuyPhieuThe> => {
      await khoaDonTrongTx(tx, input.orderId);
      await khoaPhieuPosTrongTx(tx, input.intentId);

      // ── ĐỌC LẠI dưới khoá — mọi thứ cổng cần, không gì từ màn. ──
      const p = await tx.posPaymentIntent.findUnique({
        where: { id: input.intentId },
        select: {
          id: true,
          status: true,
          code5: true,
          expiresAt: true,
          lastResultKind: true,
          lastResultMessage: true,
          bankTransactionId: true,
          paymentBillId: true,
          paymentBill: { select: { status: true, orderId: true, createdAt: true } },
        },
      });
      if (!p || p.paymentBill.orderId !== input.orderId) return { ok: false, error: CAU_KHONG_THAY_PHIEU };

      // Giao dịch thẻ mang MÃ đang nằm hàng chờ tay — mốc từ MỌI phiếu thẻ của phiếu gộp (xem "CẠM BẪY" ở đầu tệp).
      const cacPhieuThe = await tx.posPaymentIntent.findMany({
        where: { paymentBillId: p.paymentBillId },
        select: { createdAt: true },
      });
      const mocTim = [{ code5: p.code5, tu: mocChoTay(p.paymentBill.createdAt, cacPhieuThe.map((x) => x.createdAt)) }];
      const choTay = await maCoGiaoDichChoTay(tx, mocTim);
      // Lớp MÙ của `choTay` (chỉ đếm giao dịch UNMATCHED) và của câu lưu (chỉ đúng lúc kiểm): dòng thẻ mang mã ĐÃ VỀ mà chưa thành
      // giao dịch ("Đang xử lý"/chữ lạ · số ≤ 0 · hoàn một phần). CÙNG mốc `tu` với `choTay`.
      const dongChuaKetLuan = await maCoDongTheChuaKetLuan(tx, mocTim);
      const dangGiuSaiMa = await coYeuCauSaiMaDangGiu(tx, p.id);
      // VIỆC 6 · a2: yêu cầu MỚI NHẤT (trạng thái + lý do) để NHẬN RA câu lưu sau từ chối — CÙNG hàm nhận ra mà view gọi, đọc DƯỚI khoá bằng `tx` trần. Kết quả còn vào vết huỷ (`sauTuChoiSaiMa`).
      const moiNhatSaiMa = await yeuCauSaiMaMoiNhat(tx, p.id);
      const cauLuuLaCauTuChoi = laCauLuuTuChoiSaiMa({ lastResultMessage: p.lastResultMessage, yeuCauMoiNhat: moiNhatSaiMa });

      // ── CỔNG — mọi từ chối là `return`, đứng TRƯỚC phép ghi đầu tiên (chưa ghi gì ⇒ commit rỗng). ──
      const quyet = choPhepHuyPhieuThe({
        status: p.status,
        lastResultKind: p.lastResultKind,
        lastResultMessage: p.lastResultMessage,
        code5: p.code5,
        daNhanGiaoDich: p.bankTransactionId !== null,
        coGiaoDichChoTay: choTay.has(p.code5),
        coDongTheChuaKetLuan: dongChuaKetLuan.has(p.code5),
        coYeuCauSaiMaDangGiu: dangGiuSaiMa,
        cauLuuLaCauTuChoiSaiMa: cauLuuLaCauTuChoi,
        phieuGopConMo: p.paymentBill.status === "OPEN",
        // CÙNG mốc hết hạn mà view, poller và "Thẻ POS" dùng (`phieuPosHetHan`) — không chép lại phép so.
        daHetHan: phieuPosHetHan(p.expiresAt, input.now),
      });
      if (!quyet.huyDuoc) return { ok: false, error: ghepCauTuChoiHuy(quyet) };
      // Có cần tick không là do LUẬT (đọc lại dưới khoá) quyết, không do cờ màn đã nạp: màn nói "thường" lúc 10:00, lúc 10:02
      // người khác bấm Kiểm tra đổi kết quả ⇒ máy chủ đòi tick, màn nhận câu này và làm mới.
      if (quyet.canXacNhanManh && !input.xacNhanKhachChuaQuet) return { ok: false, error: CAU_THIEU_XAC_NHAN_MANH };

      // ── PHÉP GHI DUY NHẤT (dùng chung với dừng học — xem `ghiHuyPhieuTheTrongTx`). Từ đây chỉ `throw`. ──
      const nhanLyDo = NHAN_LY_DO_HUY_PHIEU_THE[input.lyDo];
      const ghiChu = input.ghiChu?.trim() || null;
      await ghiHuyPhieuTheTrongTx(tx, {
        orderId: input.orderId,
        intentId: p.id,
        billId: p.paymentBillId,
        code5: p.code5,
        trangThaiTruoc: p.status,
        ketQuaTruoc: p.lastResultKind,
        actor: input.actor,
        nguon: "HUY_TAY",
        reason: `Huỷ phiếu thu thẻ mã ${p.code5} — ${nhanLyDo}${ghiChu ? `: ${ghiChu}` : ""}`,
        them: {
          lyDo: input.lyDo,
          lyDoNhan: nhanLyDo,
          ghiChu,
          // Vết duy nhất của "sale đã khẳng định khách chưa quẹt". ⚠️ KHÔNG vai nào ngoài Quản trị tối cao đọc được `AuditLog` này
          // (`audit-logs:view` không cấp cho vai nào khác — CLAUDE.md) và trang đơn chưa đọc `POS_PHIEU_*`: kế toán xử lý khoản về
          // muộn KHÔNG tự thấy dòng này (docs §6.14, "Chưa bao quát" — hiện vết trên trang đơn dưới cổng `orders:view` là việc riêng).
          xacNhanKhachChuaQuet: input.xacNhanKhachChuaQuet,
          // VIỆC 6 · a2: huỷ SAU khi kế toán đã từ chối yêu cầu "nhập sai mã" của chính phiếu này. Cổng riêng "vì từng bị từ chối" đã bỏ nên dấu vết là thứ còn lại để điều tra một khoản về muộn:
          // người đọc sổ thấy ngay phiếu bị huỷ khi sale đã từng khẳng định khách trả mà kế toán không tìm ra giao dịch (khách có thể đã bị trừ tiền).
          sauTuChoiSaiMa: moiNhatSaiMa?.trangThai === "TU_CHOI",
        },
      });
      return { ok: true, intentId: p.id, code5: p.code5 };
    });
  } catch (err) {
    if (err instanceof LoiHuyPhieuThe) {
      // Bất khả theo thiết kế (đã giữ khoá + điều kiện đã kiểm) ⇒ nếu tới đây là CÓ đường ghi trạng thái phiếu thẻ không đi qua
      // khoá. Người dùng nhận câu thật; nhật ký máy chủ nhận dấu vết để người vận hành đi tìm đường đó.
      console.error(`[pos] huỷ phiếu thẻ ${input.intentId} (đơn ${input.orderId}): ${err.message} — updateMany đổi 0 dòng dưới khoá`);
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
