// lib/hoa-hong/khieu-nai-trang-thai.ts — ĐỒ THỊ TRẠNG THÁI + NHÃN của khiếu nại hoa hồng. THUẦN.
//
// Nguồn: docs/source-commission/04 §15, 05 AC-DSP-01.
//
//   OPEN ──nhận──▶ UNDER_REVIEW ──┬─duyệt──▶ APPROVED ──┐
//                                 └─từ chối─▶ REJECTED ─┴──▶ CLOSED
//
// Không nhảy cóc, không lùi, không đứng yên (giữ nguyên cũng KHÔNG phải một lần "chuyển"). Cùng đồ thị này được DB gác lại ở trigger
// `commission_dispute_bat_bien` — hai nơi viết cùng một luật là cố ý (lớp dưới), và ca `[NHH-DSP-SC-*]` so chúng với nhau trên Postgres thật.
//
// Vì sao KHÔNG có hàm "ai được làm bước nào" ở đây: quyền là chuyện của `can()` (luật Nền #1), còn "người duyệt ≠ người khiếu nại" là
// phép so danh tính cần dữ liệu — cả hai nằm ở `khieu-nai.ts` cạnh chỗ có dữ liệu, không chép điều kiện vào hàm thuần.
import { HoaHongError } from "./kieu";

export const TRANG_THAI_KHIEU_NAI = ["OPEN", "UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"] as const;
export type TrangThaiKhieuNai = (typeof TRANG_THAI_KHIEU_NAI)[number];

export type CachGiaiKhieuNai = "SOURCE_CORRECTION" | "MONEY_ADJUSTMENT";

/** Cặp ĐƯỢC PHÉP (mọi cặp khác đều bị từ chối, kể cả giữ nguyên). */
export const CHUYEN_HOP_LE: Readonly<Record<TrangThaiKhieuNai, readonly TrangThaiKhieuNai[]>> = {
  OPEN: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CLOSED: [],
};

/** Nhãn người dùng đọc — KHÔNG in mã enum trần ra màn hình / câu lỗi. */
export const NHAN_TRANG_THAI: Readonly<Record<TrangThaiKhieuNai, string>> = {
  OPEN: "Mới tiếp nhận",
  UNDER_REVIEW: "Đang xem xét",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  CLOSED: "Đã đóng",
};

/** Lý do từ chối (tiếng Việt) hoặc `null` nếu cặp được phép. */
export function kiemChuyenTrangThai(tu: TrangThaiKhieuNai, den: TrangThaiKhieuNai): string | null {
  if (CHUYEN_HOP_LE[tu].includes(den)) return null;
  return `Khiếu nại không thể chuyển từ "${NHAN_TRANG_THAI[tu]}" sang "${NHAN_TRANG_THAI[den]}".`;
}

export function batChuyenTrangThai(tu: TrangThaiKhieuNai, den: TrangThaiKhieuNai): void {
  const loi = kiemChuyenTrangThai(tu, den);
  if (loi) throw new HoaHongError("CHUYEN_TRANG_THAI_SAI", loi);
}

/** Còn đang chờ người xử lý (OPEN · UNDER_REVIEW) — chung cho pill tab, bộ lọc "Đang mở" và chặn khiếu nại trùng. */
export function laDangMo(s: TrangThaiKhieuNai): boolean {
  return s === "OPEN" || s === "UNDER_REVIEW";
}

export type KetQuaKhieuNai = "CHO_XU_LY" | "DANG_XEM_XET" | "DUOC_DUYET_DOI_NGUON" | "DUOC_DUYET_DIEU_CHINH_TIEN" | "TU_CHOI";

/**
 * Kết quả mà NGƯỜI KHIẾU NẠI thấy, suy từ các cột (không chỉ từ enum): khiếu nại bị từ chối được hệ thống đóng ngay trong cùng giao dịch
 * nên trạng thái cuối là CLOSED — chỉ `resolution = null` mới phân biệt "từ chối" với "đã duyệt" (CHECK DB `trang_thai_chk` đảm bảo: REJECTED
 * không bao giờ có `resolution`, APPROVED luôn có).
 */
export function ketQuaKhieuNai(d: {
  status: TrangThaiKhieuNai;
  resolution: CachGiaiKhieuNai | null;
  decidedAt: Date | null;
}): KetQuaKhieuNai {
  if (d.status === "OPEN") return "CHO_XU_LY";
  if (d.status === "UNDER_REVIEW") return "DANG_XEM_XET";
  if (d.decidedAt === null) return "DANG_XEM_XET";
  if (d.resolution === "SOURCE_CORRECTION") return "DUOC_DUYET_DOI_NGUON";
  if (d.resolution === "MONEY_ADJUSTMENT") return "DUOC_DUYET_DIEU_CHINH_TIEN";
  return "TU_CHOI";
}

export const NHAN_KET_QUA: Readonly<Record<KetQuaKhieuNai, string>> = {
  CHO_XU_LY: "Chờ tiếp nhận",
  DANG_XEM_XET: "Đang xem xét",
  DUOC_DUYET_DOI_NGUON: "Được duyệt — sửa nguồn",
  DUOC_DUYET_DIEU_CHINH_TIEN: "Được duyệt — điều chỉnh tiền",
  TU_CHOI: "Bị từ chối",
};
