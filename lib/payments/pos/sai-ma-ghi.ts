import "server-only";
// lib/payments/pos/sai-ma-ghi.ts — VIỆC 3: GỬI / DUYỆT / TỪ CHỐI yêu cầu "tôi nhập sai mã trên máy". CHẠM TIỀN (qua đường chung).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.5–5.3.7. Sự thật nền: ghi chú của giao dịch thẻ KHÔNG sửa được ⇒ "sửa" = GẮN giao
// dịch đã quẹt vào đúng phiếu. Tiền (cả tự ghi nhận lẫn duyệt) đi MỘT đường: `xuLyKetQuaPos` → `khopGiaoDichThe` → thân dòng chung
// → `thuTheoPhieuGop`, thêm đúng MỘT tham số `maXacNhan` (= `code5` của chính phiếu, đọc DƯỚI khoá). Tệp này KHÔNG có phép ghi tiền
// nào (lưới `[HN3-W1]`): không `thuTheoPhieuGop(`, không `Payment`/phân bổ/`BankTransaction`, KHÔNG `ganTienTheoCon` — đường gắn tay
// không phát `phieu-gop.da-chia` nên một khoản được DUYỆT sẽ không chuyển đổi lead / không báo sale / không biên nhận và mã QR của
// chính phiếu đó còn sống để khách trả lần hai (TỰ QUYẾT V55).
//
// ── KHOÁ, MỘT THỨ TỰ: ĐƠN → dòng GIAO DỊCH → dòng PHIẾU POS ──────────────────────────────────────────────────────────────
// (`thuTheoPhieuGop`, pha phiếu của `xuLyKetQuaPos`, `hetHanPhieuPos`, `taoPhieuPosTrongKhoa` đều lấy ĐƠN trước; không nơi nào lấy
// phiếu POS trước giao dịch ⇒ không vòng chờ.) Lưới `[HN3-W3]`.
//
// ── CỔNG ĐỨNG TRƯỚC PHÉP GHI ĐẦU TIÊN; TỪ CHỐI TRONG TRANSACTION = `return`, VÀ CHỈ TRƯỚC PHÉP GHI ──────────────────────────
// Riêng `updateMany` CÓ ĐIỀU KIỆN trạng thái đổi 0 dòng là phép ghi vô hại (FIX-H9): bên kia đã quyết ⇒ `return` ngay. Đó là cách
// duyệt ‖ từ chối loại trừ nhau: `thuTheoPhieuGop` tự mở transaction riêng và KHÔNG biết gì về yêu cầu, nên "cổng trước phép ghi"
// không áp xuyên hai transaction — loại trừ bằng SỐ DÒNG ĐỔI ĐƯỢC của phép chuyển có điều kiện, TRƯỚC khi gọi đường tiền (V56).
//
// ⚠️ Mọi `$transaction` ở đây viết INLINE (không tách thân thành hàm): lưới `cong-truoc-phep-ghi` cắt thân callback ngay sau
// `$transaction(` — thân ở hàm khác là thân nó không thấy.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { khoaDonTrongTx, khoaGiaoDichTrongTx, markerGanTay, TIEN_TO_GO_GAN } from "@/lib/finance/ghi-tien-don";
import { docPhieuDeThuTrongTx } from "@/lib/finance/phieu-gop";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { notifyStaff } from "@/lib/notifications/notify";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import { PROVIDER_THE_POS, type NguonDuLieuPos } from "./kieu";
import { nguoiNhanBaoPos } from "./nguoi-nhan-bao-pos";
import { ghiHuyPhieuTheTrongTx } from "./huy-phieu-the-db";
import { phieuPosHetHan } from "./phieu-pos-luat";
import { docUngVienSaiMa } from "./sai-ma-doc";
import {
  CAU_CHO_KE_TOAN,
  CAU_DANG_GHI,
  CAU_DA_XU_LY_NGOAI,
  cauKhongUngVien,
  DANG_GHI_KET_SAU_MS,
  cauLyDo,
  cauTuChoi,
  chanTuDuyet,
  chuyenHopLe,
  ghepLyDo,
  tachLyDo,
  type KieuSaiMa,
  type LyDoChoKeToan,
  type TrangThaiSaiMa,
} from "./sai-ma";
import { khoaPhieuPosTrongTx, xuLyKetQuaPos } from "./xu-ly-ket-qua";

type Nguoi = { id: string; name: string };

/** Nhãn nguồn ghi vào AuditLog — KHÔNG phải `rawPayload.nguon` (nguồn DỮ LIỆU) và không thêm giá trị `PosCheckTrigger` (V57). */
const NGUON_SAI_MA = "SALE_XAC_NHAN_SAI_MA";

const LOI_DA_XU_LY = "Yêu cầu đã được xử lý";
const LOI_DANG_GHI = "Yêu cầu đang ghi nhận — thử lại sau ít phút";
const LOI_GIU_CHO_PHIEU_KHAC = "Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách";
const LOI_DA_BI_BAC = "Kế toán đã từ chối giao dịch này cho phiếu — không gửi lại được";
const LOI_DON_KHONG_NHAN_TIEN = "Đơn không nhận tiền được (nháp / đã huỷ / đã hoàn / đã xoá)";
const LOI_BT_XU_LY_NGOAI = "Giao dịch đã được xử lý ở nơi khác (gắn tay / bỏ qua / gỡ gắn) — không còn gì để duyệt";
const LOI_CHUA_XONG =
  "Hệ thống chưa ghi nhận xong giao dịch này — đã báo kế toán thử lại. ĐỪNG cho khách quẹt lại.";

export type KetQuaGui =
  | { ok: false; error: string }
  | {
      ok: true;
      /** `true` ⇒ bấm lặp: trả đúng yêu cầu cũ, KHÔNG ghi gì. */
      daCo: boolean;
      yeuCauId: string;
      kieu: KieuSaiMa;
      trangThai: TrangThaiSaiMa;
      lyDo: LyDoChoKeToan[];
      thongDiep: string;
    };

export type KetQuaQuyet = { ok: false; error: string } | { ok: true; trangThai: TrangThaiSaiMa; thongDiep: string };

/** `rawPayload.nguon` của giao dịch — nhãn nguồn DỮ LIỆU; giữ nguyên khi đường tiền ghi lại giao dịch UNMATCHED. */
function docNguon(raw: unknown): NguonDuLieuPos {
  const n = typeof raw === "object" && raw !== null ? (raw as { nguon?: unknown }).nguon : undefined;
  return n === "TCB_PORTAL" || n === "TCB_API" || n === "FAKE" || n === "SMARTPOS" ? n : "SMARTPOS";
}

const so = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const cat = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ─────────────────────────────────────────────────────────────────────────────
// THÔNG BÁO (sau commit — `notifyStaff` không nhận tx). Không bao giờ làm hỏng việc đã commit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Báo người nhận báo POS (Kế toán HO ∪ Quản trị). Nội dung = người gửi · mã đơn · mã phiếu · máy · lý do đầu; KHÔNG ghi chú gốc (chữ
 * người gõ trên máy dùng chung, có thể mang SĐT/tên khách khác), KHÔNG số thẻ, KHÔNG tên phụ huynh, KHÔNG số tiền (như
 * `phieu-gop.da-chia:` — PRD T5; kế toán mở trang để xem số) (V67).
 */
async function baoKeToan(x: {
  yeuCauId: string;
  orderId: string;
  maDon: string;
  maDung: string;
  tenMay: string;
  nguoiGui: string;
  lyDo: readonly LyDoChoKeToan[];
  now: Date;
}): Promise<void> {
  try {
    const nguoi = await nguoiNhanBaoPos(x.now);
    if (nguoi.length === 0) {
      console.warn(`[pos] yêu cầu sai mã ${x.yeuCauId}: không có Kế toán HO / Quản trị nào để báo`);
      return;
    }
    await notifyStaff({
      userIds: nguoi,
      dedupeKey: `pos.sai-ma:${x.yeuCauId}`,
      title: "Sale xin xác nhận giao dịch thẻ nhập sai mã",
      body:
        `${x.nguoiGui} · đơn ${x.maDon} · phiếu thẻ ${x.maDung} · máy ${x.tenMay}. ` +
        (x.lyDo.length > 0 ? cauLyDo(x.lyDo[0]!) : "Cần kế toán xác nhận."),
      href: "/bien-dong-so-du#the-pos-sai-ma",
      entityId: x.orderId,
    });
  } catch (err) {
    console.error(`[pos] báo kế toán yêu cầu sai mã ${x.yeuCauId} lỗi:`, err);
  }
}

/** Báo người GỬI kết quả (kế toán duyệt / từ chối). */
async function baoNguoiGui(x: {
  yeuCauId: string;
  orderId: string;
  nguoiGuiId: string;
  maDon: string;
  maDung: string;
  ketQua: "DUYET" | "TU_CHOI";
  lyDo?: string;
}): Promise<void> {
  try {
    await notifyStaff({
      userIds: [x.nguoiGuiId],
      dedupeKey: `pos.sai-ma-kq:${x.yeuCauId}`,
      title: x.ketQua === "DUYET" ? "Kế toán đã duyệt giao dịch thẻ nhập sai mã" : "Kế toán không xác nhận giao dịch thẻ nhập sai mã",
      body:
        x.ketQua === "DUYET"
          ? `Đơn ${x.maDon} · phiếu thẻ ${x.maDung}: giao dịch đã được ghi nhận vào đơn.`
          : `Đơn ${x.maDon} · phiếu thẻ ${x.maDung}: ${cat(x.lyDo ?? "", 200)}. ĐỪNG cho khách quẹt lại — báo kế toán.`,
      href: `/orders/${x.orderId}`,
      entityId: x.orderId,
    });
  } catch (err) {
    console.error(`[pos] báo người gửi yêu cầu sai mã ${x.yeuCauId} lỗi:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GHI TIỀN + CHỐT — dùng chung cho TỰ GHI NHẬN và DUYỆT
// ─────────────────────────────────────────────────────────────────────────────

type ThongTinGhi = {
  yeuCauId: string;
  intentId: string;
  orderId: string;
  maDon: string;
  /** = `code5` đọc DƯỚI khoá — KHÔNG BAO GIỜ chuỗi từ client (lưới `[HN3-W2]`). */
  maDung: string;
  /** Giao dịch tiền của yêu cầu — để hỏi "tiền này do ĐƯỜNG NÀO ghi" (xem `chotSauGhiTien`). BẮT BUỘC (luật 7). */
  bankTransactionId: string;
  tenMay: string;
  bt: { maGiaoDich: string; soTien: number; thoiGian: Date; nguon: NguonDuLieuPos };
  lyDoHienCo: readonly LyDoChoKeToan[];
  nguoiGuiId: string;
  nguoiGui: string;
  actor: Nguoi;
  now: Date;
};

type KetQuaGhiTien =
  /** `daGhiTruoc`: lượt NÀY không tự ghi tiền — giao dịch đã MATCHED vào đúng phiếu từ trước (thử lại sau sập, hoặc người khác ghi). BẮT BUỘC (luật 7). */
  | { loai: "DA_THU"; daGhiTruoc: boolean }
  | { loai: "KHONG_DUOC"; thongDiep: string }
  | { loai: "NEM" };

/**
 * NGOÀI mọi transaction (đúng khuôn pha tiền): đường chung tự khoá đơn → giao dịch → phiếu POS. Thân dòng IDEMPOTENT — giao dịch
 * còn UNMATCHED ⇒ ghi; đã MATCHED vào đúng phiếu ⇒ `DA_KHOA` ⇒ DA_THU — nên "thử lại" yêu cầu kẹt chỉ chốt trạng thái, không ghi đôi.
 */
async function ghiTienChoYeuCau(x: ThongTinGhi): Promise<KetQuaGhiTien> {
  try {
    const kq = await xuLyKetQuaPos({
      intentId: x.intentId,
      ketQua: { kind: "PAID", providerTxnId: x.bt.maGiaoDich, amount: x.bt.soTien, paidAt: gioVN(x.bt.thoiGian) },
      // `PosCheckTrigger` không có giá trị "kế toán" và thêm một giá trị là `ADD VALUE` + lan sang hai `Record` đủ khoá (V74). Người
      // thật nằm ở `nguoiBam` và AuditLog.
      triggeredBy: "SALE",
      now: x.now,
      nguonDuLieu: x.bt.nguon,
      nguoiBam: { id: x.actor.id, name: x.actor.name },
      maXacNhan: x.maDung,
    });
    if (kq.status !== "DA_THU") return { loai: "KHONG_DUOC", thongDiep: kq.thongDiep };
    // Không có kết luận (phiếu đóng nhận kết quả yếu) ⇒ coi như "có thể do đường khác ghi" — hướng AN TOÀN là đi hỏi marker.
    return { loai: "DA_THU", daGhiTruoc: kq.ketLuan === null || kq.ketLuan.loai !== "DA_THU" || kq.ketLuan.daGhiTruoc };
  } catch (err) {
    // Không biết tiền đã đi tới đâu ⇒ GIỮ DANG_GHI (kẹt sau 2′ ⇒ kế toán thử lại; thân dòng idempotent).
    console.error(`[pos] ghi tiền yêu cầu sai mã ${x.yeuCauId} ném:`, err);
    return { loai: "NEM" };
  }
}

/** Sau khi đường tiền trả lời: chốt DA_GHI_NHAN, hoặc trả về CHO_DUYET kèm lý do, hoặc để kẹt. Trả câu cho người bấm. */
async function chotSauGhiTien(
  x: ThongTinGhi & { kq: KetQuaGhiTien; kieuAudit: "GUI" | "DUYET" },
): Promise<{ ok: true; trangThai: TrangThaiSaiMa; thongDiep: string } | { ok: false; error: string }> {
  if (x.kq.loai === "DA_THU") {
    // Rà đối kháng [HN3-RV-03]: đường tiền trả DA_THU cũng khi giao dịch ĐÃ được ghi bởi người khác (kế toán gắn tay chen vào giữa lúc giữ và
    // lúc ghi tiền ⇒ thân dòng thấy "đã MATCHED vào đúng phiếu" ⇒ DA_THU). Yêu cầu KHÔNG được nhận công khoản ấy: audit "sale tự ghi nhận" sẽ
    // nói sai người ghi, sale nghe "Đã ghi nhận" cho việc không phải của mình, và bước chuyển đổi của đường tự động (phieu-gop.da-chia) chưa
    // chạy mà không dấu nào cho biết (đúng điều V55 lấy làm lý do không dùng đường gắn tay). Bút toán của đường gắn tay mang marker
    // `[gan-tay:<id giao dịch>]`; của đường tự động mang `[auto:card_pos:…]` — nên "thử lại sau sập" (tiền do CHÍNH đường này ghi) vẫn chốt như cũ.
    // Chỉ hỏi khi lượt này KHÔNG tự ghi (`daGhiTruoc`): một lần ghi đầu tiên của chính lời gọi này không thể là tiền của người khác.
    // `deletedAt: null`: bút toán gắn tay đã bị xoá mềm (gỡ gắn) không còn là tiền của ai.
    const ganTay = x.kq.daGhiTruoc
      ? await db.payment.count({ where: { orderId: x.orderId, deletedAt: null, note: { contains: markerGanTay(x.bankTransactionId) } } })
      : 0;
    if (ganTay > 0) {
      await db.posSaiMaYeuCau.updateMany({
        where: { id: x.yeuCauId, trangThai: "DANG_GHI" },
        data: { trangThai: "CHO_DUYET", nguoiQuyetId: null, quyetLuc: null, dangGhiLuc: null },
      });
      await writeAudit({
        actor: { id: x.actor.id, name: x.actor.name },
        module: "finance",
        entityType: "Order",
        entityId: x.orderId,
        action: "POS_SAI_MA_XU_LY_NGOAI",
        newValues: { yeuCauId: x.yeuCauId, intentId: x.intentId, bankTransactionId: x.bankTransactionId, maDung: x.maDung, maGiaoDich: x.bt.maGiaoDich, nguon: NGUON_SAI_MA },
        reason: "Giao dịch đã được gắn tay vào đơn trong lúc yêu cầu đang ghi — yêu cầu không nhận công ghi tiền",
      }).catch((err) => console.error("[pos] ghi audit POS_SAI_MA_XU_LY_NGOAI lỗi:", err));
      return x.kieuAudit === "GUI"
        ? { ok: true, trangThai: "CHO_DUYET", thongDiep: CAU_DA_XU_LY_NGOAI }
        : { ok: false, error: LOI_BT_XU_LY_NGOAI };
    }
    const up = await db.posSaiMaYeuCau.updateMany({
      where: { id: x.yeuCauId, trangThai: "DANG_GHI" },
      data: { trangThai: "DA_GHI_NHAN" },
    });
    if (up.count === 1) {
      await writeAudit({
        actor: { id: x.actor.id, name: x.actor.name },
        module: "finance",
        entityType: "Order",
        entityId: x.orderId,
        action: "POS_SAI_MA_GHI_NHAN",
        newValues: { yeuCauId: x.yeuCauId, intentId: x.intentId, maDung: x.maDung, maGiaoDich: x.bt.maGiaoDich, nguon: NGUON_SAI_MA, soTien: x.bt.soTien },
        reason: x.kieuAudit === "GUI" ? "Sale xác nhận giao dịch nhập sai mã — tự ghi nhận" : "Kế toán duyệt giao dịch nhập sai mã",
      }).catch((err) => console.error("[pos] ghi audit POS_SAI_MA_GHI_NHAN lỗi:", err));
    }
    if (x.kieuAudit === "DUYET") {
      await baoNguoiGui({ yeuCauId: x.yeuCauId, orderId: x.orderId, nguoiGuiId: x.nguoiGuiId, maDon: x.maDon, maDung: x.maDung, ketQua: "DUYET" });
    }
    return {
      ok: true,
      trangThai: "DA_GHI_NHAN",
      thongDiep: `Đã ghi nhận giao dịch ${so(x.bt.soTien)}đ vào đơn ${x.maDon}.`,
    };
  }

  if (x.kq.loai === "KHONG_DUOC") {
    // Đường tiền chạy mà KHÔNG ra DA_THU (số phải thu / phiếu / đơn đổi giữa chừng): trả yêu cầu về CHO_DUYET kèm lý do, bỏ người
    // duyệt cũ, để kế toán xử lý bằng tay. Phiếu thẻ vẫn GIỮ giao dịch.
    const lyDo = ghepLyDo([...x.lyDoHienCo, "GHI_TU_DONG_KHONG_DUOC"]);
    await db.posSaiMaYeuCau.updateMany({
      where: { id: x.yeuCauId, trangThai: "DANG_GHI" },
      data: { trangThai: "CHO_DUYET", lyDo, nguoiQuyetId: null, quyetLuc: null, dangGhiLuc: null },
    });
    await baoKeToan({
      yeuCauId: x.yeuCauId,
      orderId: x.orderId,
      maDon: x.maDon,
      maDung: x.maDung,
      tenMay: x.tenMay,
      nguoiGui: x.nguoiGui,
      lyDo: tachLyDo(lyDo),
      now: x.now,
    });
    return x.kieuAudit === "GUI"
      ? { ok: true, trangThai: "CHO_DUYET", thongDiep: "Chưa ghi nhận tự động được — đã chuyển kế toán xác nhận. ĐỪNG cho khách quẹt lại." }
      : { ok: false, error: `Chưa ghi nhận được: ${x.kq.thongDiep}` };
  }

  // NEM — kẹt ở DANG_GHI; báo kế toán để họ thấy "Kẹt — thử lại" khi tới 2′.
  await baoKeToan({
    yeuCauId: x.yeuCauId,
    orderId: x.orderId,
    maDon: x.maDon,
    maDung: x.maDung,
    tenMay: x.tenMay,
    nguoiGui: x.nguoiGui,
    lyDo: x.lyDoHienCo,
    now: x.now,
  });
  return { ok: false, error: x.kieuAudit === "GUI" ? LOI_CHUA_XONG : "Chưa ghi nhận xong — yêu cầu còn ở trạng thái đang ghi, thử lại sau 2 phút" };
}

// ─────────────────────────────────────────────────────────────────────────────
// GỬI — sale bấm "Đúng giao dịch này"
// ─────────────────────────────────────────────────────────────────────────────

type KetQuaGiu =
  | { ok: false; error: string }
  | {
      ok: true;
      loai: "DA_CO";
      yeuCau: { id: string; kieu: KieuSaiMa; trangThai: TrangThaiSaiMa; lyDo: string };
    }
  | {
      ok: true;
      loai: "MOI";
      yeuCauId: string;
      kieu: KieuSaiMa;
      lyDo: LyDoChoKeToan[];
      maDung: string;
      maDon: string;
      tenMay: string;
      bt: { maGiaoDich: string; soTien: number; thoiGian: Date; nguon: NguonDuLieuPos };
    };

/**
 * GIỮ (TX1): khoá đơn → giao dịch → phiếu POS; mọi cổng CHỈ ĐỌC; rồi INSERT yêu cầu + phiếu thẻ CHO_QUET → CAN_XU_LY gắn giao dịch
 * + audit. Tự ghi nhận ⇒ yêu cầu vào thẳng DANG_GHI rồi đi `ghiTienChoYeuCau` NGOÀI transaction; chờ kế toán ⇒ CHO_DUYET + báo.
 */
export async function guiSaiMa(i: {
  orderId: string;
  intentId: string;
  bankTransactionId: string;
  actor: Nguoi;
  /** BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaGui> {
  // Đọc sơ bộ NGOÀI khoá chỉ để chặn IDOR sớm; mọi cổng thật đọc LẠI dưới khoá.
  const goc = await db.posPaymentIntent.findUnique({
    where: { id: i.intentId },
    select: { paymentBill: { select: { orderId: true } } },
  });
  if (!goc || goc.paymentBill.orderId !== i.orderId) return { ok: false, error: "Không tìm thấy phiếu POS" };

  let giu: KetQuaGiu;
  try {
    giu = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, i.orderId);
      await khoaGiaoDichTrongTx(tx, i.bankTransactionId);
      await khoaPhieuPosTrongTx(tx, i.intentId);

      // ── CỔNG (chỉ đọc) ──
      const intent = await tx.posPaymentIntent.findUnique({
        where: { id: i.intentId },
        select: {
          id: true,
          code5: true,
          createdAt: true,
          expiresAt: true,
          centerId: true,
          posTerminalId: true,
          paymentBillId: true,
          status: true,
          bankTransactionId: true,
          lastResultKind: true,
          posTerminal: { select: { maQuay: true, ten: true, maThietBi: true } },
          paymentBill: { select: { orderId: true } },
        },
      });
      if (!intent || intent.paymentBill.orderId !== i.orderId) return { ok: false as const, error: "Không tìm thấy phiếu POS" };

      // (0) Bấm lặp: đã có yêu cầu cho ĐÚNG cặp này ⇒ trả trạng thái hiện có, 0 ghi. Hỏi TRƯỚC mọi cổng sau (lúc đó phiếu đã CAN_XU_LY).
      const daCo = await tx.posSaiMaYeuCau.findUnique({
        where: { intentId_bankTransactionId: { intentId: i.intentId, bankTransactionId: i.bankTransactionId } },
        select: { id: true, kieu: true, trangThai: true, lyDo: true, nguoiGuiId: true },
      });
      if (daCo) {
        if (daCo.trangThai === "TU_CHOI") return { ok: false as const, error: LOI_DA_BI_BAC };
        if (daCo.nguoiGuiId !== i.actor.id) return { ok: false as const, error: LOI_GIU_CHO_PHIEU_KHAC };
        return { ok: true as const, loai: "DA_CO" as const, yeuCau: daCo };
      }

      if (intent.status !== "CHO_QUET") return { ok: false as const, error: "Phiếu thu thẻ không còn chờ quẹt" };
      if (phieuPosHetHan(intent.expiresAt, i.now)) {
        return { ok: false as const, error: "Phiếu thu thẻ đã hết hạn — tạo phiếu mới nếu cần thu" };
      }
      if (intent.bankTransactionId !== null) return { ok: false as const, error: "Phiếu thẻ này đã nhận một giao dịch" };
      if (intent.lastResultKind !== "NOT_FOUND") {
        return { ok: false as const, error: "Bấm Kiểm tra thanh toán trước — chỉ dùng khi hệ thống báo 'Chưa thấy giao dịch'" };
      }
      const dangSong = await tx.posSaiMaYeuCau.findFirst({
        where: { intentId: intent.id, trangThai: { not: "TU_CHOI" } },
        select: { id: true },
      });
      if (dangSong) return { ok: false as const, error: "Phiếu này đã có một yêu cầu xác nhận đang xử lý" };

      const bt = await tx.bankTransaction.findUnique({
        where: { id: i.bankTransactionId },
        select: {
          rawPayload: true,
          posPaymentIntent: { select: { id: true } },
          posSaiMaYeuCau: { where: { trangThai: { not: "TU_CHOI" } }, select: { id: true }, take: 1 },
        },
      });
      if (!bt) return { ok: false as const, error: "Không tìm thấy giao dịch" };
      if (bt.posPaymentIntent !== null || bt.posSaiMaYeuCau.length > 0) {
        return { ok: false as const, error: LOI_GIU_CHO_PHIEU_KHAC };
      }

      const phieu = await docPhieuDeThuTrongTx(tx, intent.paymentBillId);
      if (!phieu || phieu.orderId !== i.orderId || phieu.status !== "OPEN" || phieu.matchKey !== intent.code5) {
        return { ok: false as const, error: "Phiếu gộp không còn mở — tải lại trang" };
      }
      if (phieu.conPhaiThu <= 0) return { ok: false as const, error: "Phiếu gộp không còn khoản phải thu" };
      const don = await tx.order.findFirst({
        where: { id: i.orderId, ...locDonNhanTien() },
        select: { id: true, code: true, centerId: true },
      });
      if (!don || don.centerId !== intent.centerId) return { ok: false as const, error: LOI_DON_KHONG_NHAN_TIEN };

      // CÙNG câu hỏi với bước tìm — tính LẠI dưới khoá; giao dịch được chọn phải NẰM TRONG kết quả.
      // Việc 5: `orderId` đọc DƯỚI KHOÁ từ chính phiếu gộp của phiếu thẻ (đã so với `i.orderId` ở trên) — vết bác khoá theo ĐƠN, nên đây là cửa
      // server TÍNH LẠI nó; client giả id X đã bị bác cho đơn này cũng không còn nằm trong `doc.ungVien` ⇒ `chon` rỗng ⇒ từ chối bên dưới.
      const doc = await docUngVienSaiMa({ doc: tx, chan: tx, intent: { ...intent, orderId: intent.paymentBill.orderId }, conPhaiThu: phieu.conPhaiThu, now: i.now });
      if (doc.loai === "TU_CHOI_TIM") return { ok: false as const, error: doc.cau };
      const chon = doc.ungVien.find((u) => u.bankTransactionId === i.bankTransactionId);
      if (!chon) {
        return {
          ok: false as const,
          error: doc.ungVien.length === 0 ? cauKhongUngVien(doc.soBiLoaiVeBac) : "Giao dịch này không còn là ứng viên hợp lệ — tải lại danh sách rồi chọn lại",
        };
      }
      const kieu: KieuSaiMa = chon.xemTruoc.quyet === "TU_GHI_NHAN" ? "TU_GHI_NHAN" : "CHO_KE_TOAN";
      const lyDo = chon.xemTruoc.quyet === "CHO_KE_TOAN" ? [...chon.xemTruoc.lyDo] : [];
      const tenMay = intent.posTerminal ? (intent.posTerminal.maQuay ?? intent.posTerminal.ten ?? intent.posTerminal.maThietBi) : doc.mayNhan;

      // ── HẾT CỔNG. Từ đây là phép ghi. ──
      const yc = await tx.posSaiMaYeuCau.create({
        data: {
          intentId: intent.id,
          bankTransactionId: i.bankTransactionId,
          centerId: intent.centerId,
          kieu,
          trangThai: kieu === "TU_GHI_NHAN" ? "DANG_GHI" : "CHO_DUYET",
          lyDo: ghepLyDo(lyDo),
          nguoiGuiId: i.actor.id,
          createdAt: i.now,
          dangGhiLuc: kieu === "TU_GHI_NHAN" ? i.now : null,
        },
        select: { id: true },
      });
      await tx.posPaymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "CAN_XU_LY",
          bankTransactionId: i.bankTransactionId,
          lastResultMessage: kieu === "TU_GHI_NHAN" ? CAU_DANG_GHI : CAU_CHO_KE_TOAN,
        },
      });
      await writeAudit({
        tx,
        actor: { id: i.actor.id, name: i.actor.name },
        module: "finance",
        entityType: "Order",
        entityId: i.orderId,
        action: "POS_SAI_MA_GUI",
        newValues: {
          yeuCauId: yc.id,
          intentId: intent.id,
          bankTransactionId: i.bankTransactionId,
          maGiaoDich: chon.maGiaoDich,
          maDung: intent.code5,
          ghiChuGoc: cat(chon.dienGiai, 200),
          kieu,
          lyDo: ghepLyDo(lyDo),
          nguon: NGUON_SAI_MA,
          conPhaiThu: phieu.conPhaiThu,
        },
        reason:
          kieu === "TU_GHI_NHAN"
            ? "Sale xác nhận giao dịch nhập sai mã — tự ghi nhận"
            : "Sale gửi kế toán xác nhận giao dịch nhập sai mã",
      });
      return {
        ok: true as const,
        loai: "MOI" as const,
        yeuCauId: yc.id,
        kieu,
        lyDo,
        maDung: intent.code5,
        maDon: don.code,
        tenMay,
        bt: { maGiaoDich: chon.maGiaoDich, soTien: chon.soTien, thoiGian: chon.thoiGianGiaoDich, nguon: docNguon(bt.rawPayload) },
      };
    });
  } catch (err) {
    // UNIQUE từng phần / cặp là lưới CUỐI: lệnh `create` ném P2002 thì Postgres ĐÃ đánh dấu cả transaction là hỏng ⇒ bắt NGOÀI
    // `$transaction` (như `moPhieuPos`), không `catch` rồi `return` trong callback.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: LOI_GIU_CHO_PHIEU_KHAC };
    }
    throw err;
  }

  if (!giu.ok) return giu;
  if (giu.loai === "DA_CO") {
    const lyDo = tachLyDo(giu.yeuCau.lyDo);
    return {
      ok: true,
      daCo: true,
      yeuCauId: giu.yeuCau.id,
      kieu: giu.yeuCau.kieu,
      trangThai: giu.yeuCau.trangThai,
      lyDo,
      thongDiep:
        giu.yeuCau.trangThai === "DA_GHI_NHAN"
          ? "Giao dịch đã được ghi nhận."
          : giu.yeuCau.trangThai === "DANG_GHI"
            ? CAU_DANG_GHI
            : CAU_CHO_KE_TOAN,
    };
  }

  const lay = await db.user.findUnique({ where: { id: i.actor.id }, select: { name: true, email: true } });
  const nguoiGui = lay?.name ?? lay?.email ?? i.actor.name;

  if (giu.kieu === "CHO_KE_TOAN") {
    await baoKeToan({
      yeuCauId: giu.yeuCauId,
      orderId: i.orderId,
      maDon: giu.maDon,
      maDung: giu.maDung,
      tenMay: giu.tenMay,
      nguoiGui,
      lyDo: giu.lyDo,
      now: i.now,
    });
    return {
      ok: true,
      daCo: false,
      yeuCauId: giu.yeuCauId,
      kieu: "CHO_KE_TOAN",
      trangThai: "CHO_DUYET",
      lyDo: giu.lyDo,
      thongDiep: "Đã gửi kế toán xác nhận. ĐỪNG cho khách quẹt lại.",
    };
  }

  // TỰ GHI NHẬN: tiền đi đường CHUNG, NGOÀI transaction.
  const thongTin: ThongTinGhi = {
    yeuCauId: giu.yeuCauId,
    intentId: i.intentId,
    orderId: i.orderId,
    maDon: giu.maDon,
    maDung: giu.maDung,
    bankTransactionId: i.bankTransactionId,
    tenMay: giu.tenMay,
    bt: giu.bt,
    lyDoHienCo: [],
    nguoiGuiId: i.actor.id,
    nguoiGui,
    actor: i.actor,
    now: i.now,
  };
  const kq = await ghiTienChoYeuCau(thongTin);
  const chot = await chotSauGhiTien({ ...thongTin, kq, kieuAudit: "GUI" });
  if (!chot.ok) return chot;
  return {
    ok: true,
    daCo: false,
    yeuCauId: giu.yeuCauId,
    kieu: "TU_GHI_NHAN",
    trangThai: chot.trangThai,
    lyDo: [],
    thongDiep: chot.thongDiep,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DUYỆT — kế toán, một bấm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cổng quyền/phạm vi nằm ở ACTION (`payments:manage` + `passesScope("Order")`). Ở đây: người quyết ≠ người gửi (DB còn CHECK), rồi
 * phép chuyển CÓ ĐIỀU KIỆN `CHO_DUYET → DANG_GHI` (hoặc thử lại `DANG_GHI` kẹt ≥ 2′) LÀ phép ghi đầu tiên và đổi 0 dòng ⇒ bên kia
 * (từ chối / duyệt khác) đã quyết ⇒ dừng TRƯỚC khi gọi đường tiền.
 */
export async function duyetSaiMa(i: {
  orderId: string;
  yeuCauId: string;
  actor: Nguoi;
  /** BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaQuyet> {
  const goc = await db.posSaiMaYeuCau.findUnique({
    where: { id: i.yeuCauId },
    select: { bankTransactionId: true, intentId: true, intent: { select: { paymentBill: { select: { orderId: true } } } } },
  });
  if (!goc || goc.intent.paymentBill.orderId !== i.orderId) return { ok: false, error: "Không tìm thấy yêu cầu" };

  type Duyet =
    | { ok: false; error: string }
    | {
        ok: true;
        ghi: ThongTinGhi;
      };
  let duyet: Duyet;
  try {
    duyet = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, i.orderId);
      await khoaGiaoDichTrongTx(tx, goc.bankTransactionId);
      await khoaPhieuPosTrongTx(tx, goc.intentId);

      // ── CỔNG (chỉ đọc) ──
      const yc = await tx.posSaiMaYeuCau.findUnique({
        where: { id: i.yeuCauId },
        select: {
          id: true,
          trangThai: true,
          lyDo: true,
          nguoiGuiId: true,
          nguoiGui: { select: { name: true, email: true } },
          dangGhiLuc: true,
          bankTransactionId: true,
          bankTransaction: {
            select: {
              status: true,
              provider: true,
              unmatchedNote: true,
              rawPayload: true,
              posCardTransaction: { select: { maGiaoDich: true, soTien: true, thoiGianGiaoDich: true } },
            },
          },
          intent: {
            select: {
              id: true,
              code5: true,
              status: true,
              bankTransactionId: true,
              paymentBillId: true,
              posTerminal: { select: { maQuay: true, ten: true, maThietBi: true } },
              paymentBill: { select: { orderId: true, order: { select: { code: true } } } },
            },
          },
        },
      });
      if (!yc || yc.intent.paymentBill.orderId !== i.orderId) return { ok: false as const, error: "Không tìm thấy yêu cầu" };
      const ketLuc = yc.trangThai === "DANG_GHI" && yc.dangGhiLuc !== null && i.now.getTime() - yc.dangGhiLuc.getTime() >= DANG_GHI_KET_SAU_MS;
      if (yc.trangThai === "DANG_GHI" && !ketLuc) return { ok: false as const, error: LOI_DANG_GHI };
      if (yc.trangThai !== "CHO_DUYET" && !ketLuc) return { ok: false as const, error: LOI_DA_XU_LY };
      const chan = chanTuDuyet(yc.nguoiGuiId, i.actor.id);
      if (chan) return { ok: false as const, error: chan };
      const pos = yc.bankTransaction.posCardTransaction;
      if (!pos) return { ok: false as const, error: "Không tìm thấy dòng giao dịch thẻ" };

      // Yêu cầu KẸT ở DANG_GHI: tiền có thể đã vào (sập sau tiền) hoặc chưa (sập trước tiền) — thân dòng chung idempotent nên KHÔNG
      // đòi giao dịch còn UNMATCHED ở đây; đường tiền tự phân xử rồi `chotSauGhiTien` ghi nhận hoặc trả về CHO_DUYET.
      if (yc.trangThai === "CHO_DUYET") {
        if (yc.bankTransaction.provider !== PROVIDER_THE_POS || yc.bankTransaction.status !== "UNMATCHED") {
          return { ok: false as const, error: LOI_BT_XU_LY_NGOAI };
        }
        if ((yc.bankTransaction.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN)) {
          return { ok: false as const, error: LOI_BT_XU_LY_NGOAI };
        }
        if (yc.intent.bankTransactionId !== yc.bankTransactionId || (yc.intent.status !== "CAN_XU_LY" && yc.intent.status !== "LECH_TIEN")) {
          return { ok: false as const, error: "Phiếu thẻ không còn giữ giao dịch này — tải lại trang" };
        }
        const phieu = await docPhieuDeThuTrongTx(tx, yc.intent.paymentBillId);
        if (!phieu || phieu.orderId !== i.orderId || phieu.status !== "OPEN" || phieu.matchKey !== yc.intent.code5) {
          return { ok: false as const, error: "Phiếu gộp không còn mở — không ghi tiền tự động được; từ chối yêu cầu hoặc xử lý tay" };
        }
        if (phieu.conPhaiThu !== pos.soTien) {
          return {
            ok: false as const,
            error: `Số phải thu của phiếu đã đổi (còn ${so(phieu.conPhaiThu)}đ, giao dịch ${so(pos.soTien)}đ) — không ghi tự động được; từ chối hoặc gắn tay`,
          };
        }
        const don = await tx.order.findFirst({ where: { id: i.orderId, ...locDonNhanTien() }, select: { id: true } });
        if (!don) return { ok: false as const, error: LOI_DON_KHONG_NHAN_TIEN };
      }

      // ── PHÉP GHI ĐẦU TIÊN: chuyển trạng thái CÓ ĐIỀU KIỆN. Đổi 0 dòng ⇒ bên kia đã quyết ⇒ dừng, CHƯA gọi đường tiền. ──
      const upd = await tx.posSaiMaYeuCau.updateMany({
        where: { id: yc.id, trangThai: ketLuc ? "DANG_GHI" : "CHO_DUYET", ...(ketLuc ? { dangGhiLuc: yc.dangGhiLuc } : {}) },
        data: { trangThai: "DANG_GHI", nguoiQuyetId: i.actor.id, quyetLuc: i.now, dangGhiLuc: i.now },
      });
      if (upd.count === 0) return { ok: false as const, error: LOI_DA_XU_LY };
      await writeAudit({
        tx,
        actor: { id: i.actor.id, name: i.actor.name },
        module: "finance",
        entityType: "Order",
        entityId: i.orderId,
        action: "POS_SAI_MA_DUYET",
        newValues: {
          yeuCauId: yc.id,
          intentId: yc.intent.id,
          bankTransactionId: yc.bankTransactionId,
          maGiaoDich: pos.maGiaoDich,
          maDung: yc.intent.code5,
          nguoiGuiId: yc.nguoiGuiId,
          thuLai: ketLuc,
          nguon: NGUON_SAI_MA,
        },
        reason: ketLuc ? "Kế toán thử lại yêu cầu xác nhận giao dịch nhập sai mã bị kẹt" : "Kế toán duyệt giao dịch nhập sai mã",
      });
      return {
        ok: true as const,
        ghi: {
          yeuCauId: yc.id,
          intentId: yc.intent.id,
          orderId: i.orderId,
          maDon: yc.intent.paymentBill.order.code,
          bankTransactionId: yc.bankTransactionId,
          maDung: yc.intent.code5,
          tenMay: yc.intent.posTerminal ? (yc.intent.posTerminal.maQuay ?? yc.intent.posTerminal.ten ?? yc.intent.posTerminal.maThietBi) : "—",
          bt: { maGiaoDich: pos.maGiaoDich, soTien: pos.soTien, thoiGian: pos.thoiGianGiaoDich, nguon: docNguon(yc.bankTransaction.rawPayload) },
          lyDoHienCo: tachLyDo(yc.lyDo),
          nguoiGuiId: yc.nguoiGuiId,
          nguoiGui: yc.nguoiGui.name ?? yc.nguoiGui.email ?? "—",
          actor: i.actor,
          now: i.now,
        } satisfies ThongTinGhi,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: LOI_DA_XU_LY };
    }
    throw err;
  }
  if (!duyet.ok) return duyet;

  const kq = await ghiTienChoYeuCau(duyet.ghi);
  return chotSauGhiTien({ ...duyet.ghi, kq, kieuAudit: "DUYET" });
}

// ─────────────────────────────────────────────────────────────────────────────
// TỪ CHỐI — kế toán, bắt buộc lý do
// ─────────────────────────────────────────────────────────────────────────────

/** Lý do tối thiểu — cùng ngưỡng với CHECK `PosSaiMaYeuCau_tu_choi_check` (≥ 5 ký tự sau khi bỏ khoảng trắng hai đầu). */
export const LY_DO_TU_CHOI_TOI_THIEU = 5;

/**
 * TỪ CHỐI = NHẢ giao dịch (V54): phiếu thẻ về `CHO_QUET` + `bankTransactionId := NULL` để giao dịch quay lại tầm với của chủ thật;
 * giao dịch bị bác được NHỚ bằng chính dòng `TU_CHOI` chứ không bằng cột gắn đã xoá — theo ĐƠN (Việc 5: `docGiaoDichDaBiBac` + `locUngVien`; bản Việc 3 chỉ nhớ theo
 * phiếu thẻ nên phiếu thẻ mới lách được). UNIQUE (phiếu thẻ, giao dịch) của DB chỉ còn là lưới cuối cho đúng cặp; phạm vi đơn do ứng dụng giữ, DƯỚI khoá đơn. Giao dịch
 * GIỮ UNMATCHED, phiếu gộp vẫn OPEN. Chỉ từ `CHO_DUYET` — không từ chối được yêu cầu đang ghi tiền.
 */
export async function tuChoiSaiMa(i: {
  orderId: string;
  yeuCauId: string;
  lyDo: string;
  actor: Nguoi;
  /** BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaQuyet> {
  const lyDo = i.lyDo.trim();
  if (lyDo.length < LY_DO_TU_CHOI_TOI_THIEU) {
    return { ok: false, error: `Cần ghi lý do từ chối (ít nhất ${LY_DO_TU_CHOI_TOI_THIEU} ký tự)` };
  }
  const goc = await db.posSaiMaYeuCau.findUnique({
    where: { id: i.yeuCauId },
    select: { bankTransactionId: true, intentId: true, intent: { select: { paymentBill: { select: { orderId: true } } } } },
  });
  if (!goc || goc.intent.paymentBill.orderId !== i.orderId) return { ok: false, error: "Không tìm thấy yêu cầu" };

  type TuChoi =
    | { ok: false; error: string }
    | { ok: true; nguoiGuiId: string; maDon: string; maDung: string };
  let tc: TuChoi;
  try {
    tc = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, i.orderId);
      await khoaGiaoDichTrongTx(tx, goc.bankTransactionId);
      await khoaPhieuPosTrongTx(tx, goc.intentId);

      // ── CỔNG (chỉ đọc) ──
      const yc = await tx.posSaiMaYeuCau.findUnique({
        where: { id: i.yeuCauId },
        select: {
          id: true,
          trangThai: true,
          nguoiGuiId: true,
          bankTransactionId: true,
          bankTransaction: { select: { status: true, unmatchedNote: true } },
          intent: {
            select: {
              id: true,
              code5: true,
              status: true,
              lastResultKind: true,
              bankTransactionId: true,
              // `id` + `status` [VIỆC 6 · a3]: phiếu gộp còn MỞ không — quyết định phiếu thẻ nhả ra MỞ LẠI hay KẾT THÚC (xem bên dưới).
              paymentBill: { select: { id: true, status: true, orderId: true, order: { select: { code: true } } } },
            },
          },
        },
      });
      if (!yc || yc.intent.paymentBill.orderId !== i.orderId) return { ok: false as const, error: "Không tìm thấy yêu cầu" };
      if (yc.trangThai === "DANG_GHI") return { ok: false as const, error: LOI_DANG_GHI };
      if (!chuyenHopLe(yc.trangThai, "TU_CHOI")) return { ok: false as const, error: LOI_DA_XU_LY };
      const chan = chanTuDuyet(yc.nguoiGuiId, i.actor.id);
      if (chan) return { ok: false as const, error: chan };
      // Giao dịch đã được xử lý ở nơi khác: KHÔNG nhả phiếu thẻ (BT đã MATCHED/IGNORED/gỡ gắn — nhả sẽ nói dối rằng khách chưa trả).
      if (yc.bankTransaction.status !== "UNMATCHED" || (yc.bankTransaction.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN)) {
        return { ok: false as const, error: LOI_BT_XU_LY_NGOAI };
      }
      if (yc.intent.bankTransactionId !== yc.bankTransactionId || (yc.intent.status !== "CAN_XU_LY" && yc.intent.status !== "LECH_TIEN")) {
        return { ok: false as const, error: "Phiếu thẻ không còn giữ giao dịch này — tải lại trang" };
      }

      // ── PHÉP GHI ĐẦU TIÊN: chuyển trạng thái CÓ ĐIỀU KIỆN; đổi 0 dòng ⇒ bên kia (duyệt) đã quyết. ──
      const upd = await tx.posSaiMaYeuCau.updateMany({
        where: { id: yc.id, trangThai: "CHO_DUYET" },
        data: { trangThai: "TU_CHOI", nguoiQuyetId: i.actor.id, quyetLuc: i.now, lyDoTuChoi: lyDo },
      });
      if (upd.count === 0) return { ok: false as const, error: LOI_DA_XU_LY };
      // Nhả: nếu chỉ mục `PosPaymentIntent_paymentBillId_mo_key` từ chối (đã có phiếu mở khác — T21 lẽ ra không cho) thì NÉM ⇒
      // rollback cả hai phép ghi; bắt ngoài `$transaction`.
      await tx.posPaymentIntent.update({
        where: { id: yc.intent.id },
        data: { status: "CHO_QUET", bankTransactionId: null, lastResultMessage: cauTuChoi(lyDo) },
      });
      // [VIỆC 6 · a3] Phiếu gộp ĐÃ ĐÓNG (VOID / CLOSED / PAID — dừng học, đổi khoá, miễn giảm… làm lúc yêu cầu còn chờ; những đường ấy để nguyên phiếu thẻ đang giữ giao dịch chờ kế toán quyết)
      // thì nhả phiếu thẻ về CHO_QUET là DỰNG LẠI một phiếu thẻ MỞ trên mã đã chết: poller hỏi nó tới hết hạn, màn in "phiếu gộp đã đóng" cho một phiếu quẹt được, nút huỷ tay cũng từ chối
      // (cổng ④ "phiếu gộp đã đóng") và lượt Kiểm tra sau đó lại giữ giao dịch về CAN_XU_LY. Giao dịch đã được nhả (bước trên); phiếu thẻ KẾT THÚC bằng ĐÚNG đường ghi HUY chung với nút tay và dừng học
      // (`ghiHuyPhieuTheTrongTx` — không đường ghi thứ hai), cùng `tx`. Phiếu gộp còn OPEN (đường thường) KHÔNG đổi một chữ: phiếu thẻ vẫn mở lại để khách quẹt/kiểm lại như Việc 3 đã chốt.
      if (yc.intent.paymentBill.status !== "OPEN") {
        await ghiHuyPhieuTheTrongTx(tx, {
          orderId: i.orderId,
          intentId: yc.intent.id,
          billId: yc.intent.paymentBill.id,
          code5: yc.intent.code5,
          trangThaiTruoc: yc.intent.status, // trạng thái THẬT trước lượt từ chối (CAN_XU_LY | LECH_TIEN), không phải CHO_QUET trung gian của bước nhả
          ketQuaTruoc: yc.intent.lastResultKind,
          actor: { id: i.actor.id, name: i.actor.name },
          nguon: "TU_CHOI_SAI_MA",
          reason: `Kế toán từ chối yêu cầu nhập sai mã khi phiếu gộp không còn mở (${yc.intent.paymentBill.status}) — huỷ phiếu thu thẻ mã ${yc.intent.code5}, không mở lại trên mã đã chết: ${lyDo}`,
          them: { yeuCauId: yc.id, bankTransactionId: yc.bankTransactionId, phieuGopTrangThai: yc.intent.paymentBill.status },
        });
      }
      await writeAudit({
        tx,
        actor: { id: i.actor.id, name: i.actor.name },
        module: "finance",
        entityType: "Order",
        entityId: i.orderId,
        action: "POS_SAI_MA_TU_CHOI",
        newValues: { yeuCauId: yc.id, intentId: yc.intent.id, bankTransactionId: yc.bankTransactionId, maDung: yc.intent.code5, nguon: NGUON_SAI_MA },
        reason: lyDo,
      });
      return { ok: true as const, nguoiGuiId: yc.nguoiGuiId, maDon: yc.intent.paymentBill.order.code, maDung: yc.intent.code5 };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Phiếu gộp đã có phiếu thẻ khác đang mở — chưa từ chối được; báo quản trị" };
    }
    throw err;
  }
  if (!tc.ok) return tc;

  await baoNguoiGui({
    yeuCauId: i.yeuCauId,
    orderId: i.orderId,
    nguoiGuiId: tc.nguoiGuiId,
    maDon: tc.maDon,
    maDung: tc.maDung,
    ketQua: "TU_CHOI",
    lyDo,
  });
  return { ok: true, trangThai: "TU_CHOI", thongDiep: "Đã từ chối. Giao dịch vẫn nằm trong hàng chờ để gắn tay." };
}

