// lib/hoc-bu/lich-su-luot-thuan.ts — MÀN "LỊCH SỬ CẤP LƯỢT HỌC BÙ / DUYỆT HỌC VƯỢT" (17/11/2026): luật THUẦN, không DB.
//
// Sổ lượt (`MakeupCreditEntry`) là sổ CHỈ GHI THÊM: không sửa, không xoá một bút toán đã ghi. "Sửa" ở màn này là ghi một bút toán BÙ TRỪ có dây nối về bút toán gốc
// (người đọc thấy cả hai, và tổng lượt luôn đúng), không phải đổi con số cũ. Hai loại bút toán sửa được:
//   · QLCS tự cấp thêm / giảm (`ADJUSTMENT:qlcs:<mã>`) — sửa = bút toán `qlcs:sua:<id gốc>:<mã>` với chênh lệch;
//   · QLCS duyệt học vượt (`ADJUSTMENT:hocvuot:<id yêu cầu>`) — sửa số buổi bù đã duyệt: bút toán `hocvuot:<id>:sua-<ms>` VÀ cập nhật `EnrollmentCatchUpRequest.makeupSessions`
//     cùng giao dịch (đường "đổi buổi bắt đầu" đọc con số này để rút / cộng lại — để lệch là lần đổi sau tính sai).
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { kiemCapThemLuot } from "@/lib/hoc-bu/cap-them-luot";

export type NhomButToan =
  | "QLCS_CAP" //     QLCS cấp thêm lượt (delta > 0)
  | "QLCS_GIAM" //    QLCS giảm lượt (delta < 0)
  | "QLCS_SUA" //     bút toán BÙ TRỪ do sửa một bút toán QLCS
  | "HOC_VUOT_DUYET" // QLCS / Quản trị duyệt học vượt bù ⇒ cộng b lượt
  | "HOC_VUOT_SUA" //  sửa số buổi bù đã duyệt
  | "HOC_VUOT_DOI" //  hệ thống điều chỉnh khi đổi buổi bắt đầu
  | "THEO_DON" //     lượt đi theo đơn khoá học (đổi / huỷ / hoàn)
  | "TU_DONG" //      lượt cấp tự động theo gói (khởi tạo sổ)
  | "KHAC";

export const NHAN_NHOM: Record<NhomButToan, string> = {
  QLCS_CAP: "QLCS cấp thêm",
  QLCS_GIAM: "QLCS giảm",
  QLCS_SUA: "Sửa bút toán QLCS",
  HOC_VUOT_DUYET: "Duyệt học vượt",
  HOC_VUOT_SUA: "Sửa số buổi duyệt học vượt",
  HOC_VUOT_DOI: "Đổi buổi bắt đầu (học vượt)",
  THEO_DON: "Theo đơn khoá học",
  TU_DONG: "Cấp tự động theo gói",
  KHAC: "Điều chỉnh khác",
};

export type PhanLoai = {
  nhom: NhomButToan;
  nhan: string;
  /** Yêu cầu học vượt liên quan (nhóm HOC_VUOT_*). */
  requestId: string | null;
  /** Bút toán gốc bị sửa (nhóm QLCS_SUA). */
  gocId: string | null;
};

/**
 * Phân loại một bút toán theo `type` + `idemKey` + dấu của `grantedDelta`. Khoá lạ ⇒ KHAC, không đoán.
 * `idemKey` có dạng `ADJUSTMENT:<nguồn>` (xem `butToanDieuChinh`); GRANT / HOLD… là bút toán khởi tạo / sử dụng.
 */
export function phanLoaiButToan(b: { type: string; idemKey: string | null; grantedDelta: number }): PhanLoai {
  const xong = (nhom: NhomButToan, requestId: string | null = null, gocId: string | null = null): PhanLoai => ({ nhom, nhan: NHAN_NHOM[nhom], requestId, gocId });
  if (b.type === "GRANT") return xong("TU_DONG");
  const k = b.idemKey ?? "";
  if (!k.startsWith("ADJUSTMENT:")) return xong("KHAC");
  const phan = k.slice("ADJUSTMENT:".length).split(":");
  if (phan[0] === "qlcs") {
    if (phan[1] === "sua" && phan[2]) return xong("QLCS_SUA", null, phan[2]);
    return xong(b.grantedDelta < 0 ? "QLCS_GIAM" : "QLCS_CAP");
  }
  if (phan[0] === "hocvuot" && phan[1]) {
    const duoi = phan[2] ?? "";
    if (duoi.startsWith("doi-")) return xong("HOC_VUOT_DOI", phan[1]);
    if (duoi.startsWith("sua-")) return xong("HOC_VUOT_SUA", phan[1]);
    return xong("HOC_VUOT_DUYET", phan[1]);
  }
  if (phan[0] === "don") return xong("THEO_DON");
  return xong("KHAC");
}

/** Nguồn (phần sau `ADJUSTMENT:`) của bút toán sửa một bút toán QLCS. KHÔNG bắt đầu bằng `don:` (xem `nguonCapThem`). */
export function nguonSuaQlcs(gocId: string, maLan: string): string {
  return `qlcs:sua:${gocId}:${maLan}`;
}

/** Nguồn của bút toán sửa số buổi duyệt học vượt. Khớp tiền tố `hocvuot:<id>` để `phanLoaiButToan` / đường đổi buổi bắt đầu nhận ra. */
export function nguonSuaHocVuot(requestId: string, maLan: string): string {
  return `hocvuot:${requestId}:sua-${maLan}`;
}

/** Bút toán gốc nào sửa được từ màn này. Bút toán BÙ TRỪ không sửa trực tiếp — sửa lại bút toán gốc (số hiệu lực đã tính cả các lần sửa). */
export function suaDuoc(nhom: NhomButToan): boolean {
  return nhom === "QLCS_CAP" || nhom === "QLCS_GIAM" || nhom === "HOC_VUOT_DUYET";
}

/** Số lượt HIỆU LỰC của một bút toán gốc QLCS = số đã ghi + mọi bút toán bù trừ trỏ về nó. */
export function hieuLucQlcs(goc: { grantedDelta: number }, suaVe: readonly { grantedDelta: number }[]): number {
  return goc.grantedDelta + suaVe.reduce((t, s) => t + s.grantedDelta, 0);
}

const MA_LAN = /^[A-Za-z0-9_-]{8,64}$/;

/** Sửa một bút toán QLCS: `hieuLuc` = số hiện có (có dấu), `soMoi` = số đúng (có dấu). Trả câu từ chối hoặc `null`. Chênh lệch chịu cùng luật với một lần cấp / giảm. */
export function kiemSuaQlcs(p: { hieuLuc: number; soMoi: number; lyDo: string; maLan: string }): string | null {
  if (!Number.isInteger(p.soMoi)) return "Số lượt đúng phải là số nguyên";
  if (p.soMoi === p.hieuLuc) return "Số lượt mới trùng số hiện tại — không có gì để sửa";
  return kiemCapThemLuot({ delta: p.soMoi - p.hieuLuc, lyDo: p.lyDo, maLanCap: p.maLan });
}

/** Sửa số buổi bù đã duyệt của một yêu cầu học vượt: 1 ≤ b ≤ số buổi phải bù (cùng khoảng Sale được xin), khác số hiện tại, có lý do. */
export function kiemSuaHocVuot(p: { bHienTai: number; bMoi: number; phaiBu: number; lyDo: string; maLan: string }): string | null {
  if (!Number.isInteger(p.bMoi)) return "Số buổi bù phải là số nguyên";
  if (p.bMoi < 1 || p.bMoi > p.phaiBu) return `Số buổi bù phải từ 1 đến ${p.phaiBu} (số buổi bé phải học vượt)`;
  if (p.bMoi === p.bHienTai) return "Số buổi bù mới trùng số đã duyệt — không có gì để sửa";
  if (p.lyDo.trim().length < LY_DO_TOI_THIEU) return `Ghi lý do sửa ít nhất ${LY_DO_TOI_THIEU} ký tự`;
  if (!MA_LAN.test(p.maLan)) return "Phiên sửa không hợp lệ — đóng hộp và mở lại";
  return null;
}

/** Câu lý do ghi vào sổ cho một lần sửa. */
export function lyDoSua(truoc: number, sau: number, lyDo: string, nhan: string): string {
  return `${nhan}: ${truoc} → ${sau} lượt. ${lyDo.trim()}`;
}
