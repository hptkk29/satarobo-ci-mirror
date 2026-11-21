// lib/cham-cong/ghi-o-luat.ts — LUẬT quyết định số phận MỘT ô lưới ca (T04, 07/10/2026). THUẦN, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY: trước T04 có BA nơi tự quyết "ô này có được ghi đè không", với ba bộ luật khác nhau
// (đo 07/10/2026, `lib/cham-cong/cells.ts` · `generate.ts` · `import-core.ts`):
//
//   nguồn mới →        PATTERN (Sinh)   IMPORT (nhập file)   MANUAL / SWAP / LEAVE (tay, đơn)
//   đè PATTERN cũ         có                có                    có
//   đè IMPORT cũ          KHÔNG             có                    có
//   đè MANUAL cũ          KHÔNG             KHÔNG                 có
//   đè SWAP/LEAVE cũ      KHÔNG             KHÔNG                 có   ← duyệt đơn nghỉ còn đè cả ô nhập tay
//
// …và chỉ MỘT trong ba có cổng kỳ chốt (Sinh), chỉ MỘT có cổng quá khứ (Sinh), cả ba nạp mã ca CHUNG
// (không thấy mã riêng của cơ sở). Gom luật về một chỗ để ba nơi KHÔNG THỂ nói ba điều khác nhau.
//
// QUYẾT ĐỊNH 07/10/2026 (mục 2): ô nhập từ Sheet (IMPORT) và ô nhập tay (MANUAL) là "ghi đè thủ công" —
// KHÔNG bị đẩy khung đè mặc định; người có quyền được chọn thêm "Ghi đè cả ô nhập thủ công". SWAP/LEAVE là kết quả
// của đơn đã duyệt: không có công tắc nào cho đẩy khung đè chúng. Ngày đã qua và kỳ đã chốt thì KHÔNG BAO GIỜ đổi.
// ─────────────────────────────────────────────────────────────────────────────

export type NguonO = "PATTERN" | "IMPORT" | "MANUAL" | "SWAP" | "LEAVE" | "HOLIDAY";

/** Lý do một ô bị BỎ QUA — hiện nguyên văn cho người xếp lịch, không gộp thành "bỏ qua". */
export type LyDoBoQua =
  /** Ngày ≤ hôm nay: đẩy khung không chạm quá khứ và hôm nay. */
  | "QUA_KHU"
  /** Nguồn của ô đang có không bị nguồn này ghi đè (SWAP/LEAVE, hoặc IMPORT/MANUAL khi chưa bật ghi đè). */
  | "O_DUOC_BAO_VE"
  | "KHONG_QUYEN_CO_SO_CU"
  | "KHONG_QUYEN_CO_SO_MOI"
  /** Ô cũ hoặc ô mới nằm trong kỳ công đã CHỐT. */
  | "KY_DA_CHOT"
  | "MA_KHONG_CO"
  /** Khối của khung không ánh xạ được sang cơ sở — trước T04 bị gán thầm cho Hội sở. */
  | "CO_SO_LA";

export type KetQuaQuyetDinh =
  | { ket: "BO_QUA"; lyDo: LyDoBoQua }
  /** Không có gì để ghi: ô đã đúng như mong muốn, hoặc cả ô cũ lẫn ô mới đều trống. */
  | { ket: "GIU" }
  /** Huỷ ô cũ, không tạo ô mới. */
  | { ket: "XOA" }
  | { ket: "TAO" }
  | { ket: "THAY" };

type OCu = { source: NguonO; centerId: string; templateCode: string };
type OMoi = { templateCode: string; centerId: string };

/** Nguồn `moi` có được ghi đè ô nguồn `cu` không. Xem bảng ở đầu file. */
export function duocGhiDe(moi: NguonO, cu: NguonO, ghiDeNhapTay: boolean): boolean {
  if (moi === "MANUAL" || moi === "SWAP" || moi === "LEAVE" || moi === "HOLIDAY") return true;
  if (cu === "PATTERN" || cu === "HOLIDAY") return true;
  if (cu === "SWAP" || cu === "LEAVE") return false;
  if (cu === "IMPORT") return moi === "IMPORT" || ghiDeNhapTay; // nhập lại file đè chính nó (đó là việc của importer)
  return ghiDeNhapTay; // cu === "MANUAL"
}

/**
 * Số phận của MỘT ô. Thứ tự cổng có chủ đích, và MỌI cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback):
 *   1. quá khứ (chỉ nguồn PATTERN)   — đặt TRƯỚC mọi nhánh khác, kể cả bảo vệ: cổng chặn trước khi có quyết định nào ra
 *   2. ô cũ được bảo vệ              — IMPORT/PATTERN không đè SWAP/LEAVE/MANUAL…
 *   3. không có gì đổi               — cùng mã, cùng cơ sở ⇒ GIU (kể cả khi người dùng không có quyền ở cơ sở ấy)
 *   4. quyền ở cơ sở của ô CŨ
 *   5. kỳ đã chốt (ô cũ HOẶC ô mới)
 *   6. quyền ở cơ sở của ô MỚI
 */
export function quyetDinhO(p: {
  nguon: NguonO;
  cu: OCu | null;
  /** null = xoá ô (khung trống / ô Sheet trống / người dùng xoá). */
  moi: OMoi | null;
  ghiDeNhapTay: boolean;
  /** Chỉ có nghĩa với nguồn PATTERN: ngày ≤ hôm nay. */
  quaKhu: boolean;
  coQuyen: (centerId: string) => boolean;
  kyDaChot: (centerId: string) => boolean;
}): KetQuaQuyetDinh {
  if (p.nguon === "PATTERN" && p.quaKhu) return { ket: "BO_QUA", lyDo: "QUA_KHU" };
  if (p.cu && !duocGhiDe(p.nguon, p.cu.source, p.ghiDeNhapTay)) return { ket: "BO_QUA", lyDo: "O_DUOC_BAO_VE" };

  if (!p.moi) {
    if (!p.cu) return { ket: "GIU" };
  } else if (p.cu && p.cu.templateCode === p.moi.templateCode && p.cu.centerId === p.moi.centerId) {
    // Cùng mã + cùng cơ sở. Nguồn đẩy khung / nhập file không cần đổi nhãn nguồn (khỏi xoay vòng ô). Nguồn MANUAL /
    // SWAP / LEAVE thì CẦN ghi lại nguồn mới — chính nhãn nguồn là thứ bảo vệ ô khỏi lượt Sinh sau.
    if (p.nguon === "PATTERN" || p.nguon === "IMPORT" || p.cu.source === p.nguon) return { ket: "GIU" };
  }

  if (p.cu && !p.coQuyen(p.cu.centerId)) return { ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_CU" };
  if ((p.cu && p.kyDaChot(p.cu.centerId)) || (p.moi && p.kyDaChot(p.moi.centerId))) return { ket: "BO_QUA", lyDo: "KY_DA_CHOT" };
  if (!p.moi) return { ket: "XOA" };
  if (!p.coQuyen(p.moi.centerId)) return { ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_MOI" };
  return { ket: p.cu ? "THAY" : "TAO" };
}

/** Câu chữ cho người dùng — MỘT nơi, để màn hình và thông báo không tự bịa lý do. */
export const CAU_LY_DO_BO_QUA: Record<LyDoBoQua, string> = {
  QUA_KHU: "ngày đã qua hoặc hôm nay — đẩy khung ca chỉ áp từ ngày mai",
  O_DUOC_BAO_VE: "ô do đơn đã duyệt hoặc nhập thủ công — được bảo vệ",
  KHONG_QUYEN_CO_SO_CU: "không có quyền ở cơ sở của ca đang có",
  KHONG_QUYEN_CO_SO_MOI: "không có quyền ở cơ sở của ca mới",
  KY_DA_CHOT: "kỳ công đã chốt sổ — không sửa trực tiếp",
  MA_KHONG_CO: "mã ca không có trong danh mục",
  CO_SO_LA: "khối của khung không ánh xạ được sang cơ sở",
};
