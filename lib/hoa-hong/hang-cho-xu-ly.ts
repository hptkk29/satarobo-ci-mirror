// lib/hoa-hong/hang-cho-xu-ly.ts — LUẬT THUẦN của «Hàng chờ cần xử lý» (R9 · T1): tiền bị ảnh hưởng · ai làm được gì · một hay hai người · lý do kiểm toán. KHÔNG DB, KHÔNG đồng hồ (`now` là tham số — luật 19).
//
// Nguồn: docs/source-commission/12 §11.6 (thiết kế T1), 04 §10.4–§10.5 (giải `PAYMENT_WITHDRAWN` / `INPUT_DRIFT`), 08 §17 (đề xuất điều chỉnh, ngưỡng hai cấp).
//
// Phạm vi: đúng HAI mã mà `giaiHangCho` giải được — `INPUT_DRIFT` và `PAYMENT_WITHDRAWN` (`MA_GIAI_DUOC`). Mã khác KHÔNG có nút ở đây (chúng tự giải ở lượt quét sau, sửa dữ liệu rồi Tính lại, hoặc "Dời sang kỳ sau").
//
// Ba nguyên tắc (đừng nới):
//   1. KHÔNG ép qua: «Giải phóng» = `giaiHangCho(AP_DUNG)` — dòng điều chỉnh MỚI, không sửa sổ cũ; mọi cổng của service (đề xuất đang mở · đổi nguồn chưa duyệt · khoá hàng · hash đầu vào) vẫn đứng nguyên.
//   2. TIỀN LỚN ⇒ HAI NGƯỜI. Số tiền bị ảnh hưởng ≥ ngưỡng `hoaHong.nguongDuyetHaiCap` — hoặc không đo được, hoặc ngưỡng hỏng — thì người đề nghị ≠ người duyệt (fail-closed, cùng tinh thần `quyetQuanTri`).
//   3. KHÔNG ĐỌC TIỀN TỪ CLIENT: con số người dùng "đã xem" chỉ là TRẦN; server tính lại SAU khoá và từ chối nếu lớn hơn (`TIEN_DA_DOI`).
import type { CommissionHoldCode } from "@prisma/client";

import { kiemGiaiHangCho, proposalIdCuaHangCho, type QuyetDinhGiai } from "./dieu-chinh";
import { HANH_DONG_MO_LAI } from "./hang-cho-ten-hanh-dong";
import { LY_DO_TOI_THIEU } from "./kieu";

/** Tên hành động ghi vào `AuditLog` (entityType `CommissionHold`) — hai dấu vết KHÔNG đổi trạng thái hàng chờ. Bảng kiểm toán chỉ-thêm là nơi lưu duy nhất (không cột mới, không migration). */
export const HANH_DONG_DE_NGHI = "RELEASE_REQUEST" as const;
export const HANH_DONG_XEM_TAY = "ESCALATE_MANUAL" as const;
export const HANH_DONG_KIEM_TOAN_XU_LY = [HANH_DONG_DE_NGHI, HANH_DONG_XEM_TAY] as const;
/**
 * Dòng kiểm toán `REOPEN` (hàng chờ được MỞ LẠI, RESOLVED → OPEN, cùng `holdKey`) do `ghiHangCho` ghi cùng giao dịch với việc mở — tên khai ở `hang-cho-ten-hanh-dong.ts` (lá thuần: `hang-cho.ts` kéo audit/DB nên tầng thuần không import nó, mà `hang-cho.ts` import ngược lên đây sẽ thành vòng), re-export ở đây.
 * Đây là mốc "ngữ cảnh mới": mọi đề nghị lập TRƯỚC nó hết nghĩa.
 * Hai hành động đóng hàng chờ (`APPLY` / `DISMISS`, do `giaiHangCho` ghi) mang `batKy.deNghi.auditId` = đề nghị ĐÃ DÙNG để đóng.
 */
export { HANH_DONG_MO_LAI };
export const HANH_DONG_DONG_HANG_CHO = ["APPLY", "DISMISS"] as const;
/** Mọi hành động mà bộ đọc dấu vết xử lý cần (một câu truy vấn). */
export const HANH_DONG_DOC_DAU_VET = [HANH_DONG_DE_NGHI, HANH_DONG_XEM_TAY, HANH_DONG_MO_LAI, ...HANH_DONG_DONG_HANG_CHO] as const;

/** Đề nghị hết hạn sau bấy nhiêu ngày — quá hạn thì lập lại (đầu vào/ý kiến có thể đã khác). */
export const HAN_DE_NGHI_NGAY = 7;
export const HAN_DE_NGHI_MS = HAN_DE_NGHI_NGAY * 24 * 60 * 60 * 1000;

/** Quyền CHỨC NĂNG của cả bốn Server Action và của nút «Xử lý» (một key — luật 12). Cũng là key để suy PHẠM VI GHI (`coQuyenXuLyTai`). */
export const KEY_XU_LY_HANG_CHO = "commission_periods:manage" as const;

export const BANG_CHUNG_TOI_THIEU = 10;
export const BANG_CHUNG_TOI_DA = 500;
export const LY_DO_TOI_DA = 1000;

const laBanGhi = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const laSo = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * TIỀN BỊ ẢNH HƯỞNG của một hàng chờ (đồng, ≥ 0) đọc từ `detail` do engine ghi lúc lập hàng chờ; `null` = không đo được (⇒ coi như tiền lớn).
 *   · INPUT_DRIFT       — Σ|chênh| theo từng người (`detail.chenh[].chenh`); biến thể lỗi cấu hình không có `chenh` ⇒ null.
 *   · PAYMENT_WITHDRAWN — khoản THU: Σ|ròng| (`detail.rongTheoNguoi`); khoản HOÀN: Σ|tiền| các dòng đảo (`detail.dongDao[].tien`).
 * Đây là con số HIỂN THỊ và là đầu vào của cổng hai cấp lúc ĐỀ NGHỊ; con số quyết định thật khi ghi là Σ|chênh| tính lại sau khoá (`tranTien` của `giaiHangCho`).
 */
export function tienTiepXuc(h: { code: CommissionHoldCode; detail: unknown }): number | null {
  const d = laBanGhi(h.detail) ? h.detail : null;
  if (!d) return null;
  if (h.code === "INPUT_DRIFT") {
    if (!Array.isArray(d.chenh)) return null;
    let t = 0;
    for (const c of d.chenh) {
      if (!laBanGhi(c) || !laSo(c.chenh)) return null;
      t += Math.abs(c.chenh);
    }
    return t;
  }
  if (h.code === "PAYMENT_WITHDRAWN") {
    if (d.loaiKhoan === "HOAN") {
      if (!Array.isArray(d.dongDao)) return null;
      let t = 0;
      for (const x of d.dongDao) {
        if (!laBanGhi(x) || !laSo(x.tien)) return null;
        t += Math.abs(x.tien);
      }
      return t;
    }
    if (!laBanGhi(d.rongTheoNguoi)) return null;
    let t = 0;
    for (const v of Object.values(d.rongTheoNguoi)) {
      if (!laSo(v)) return null;
      t += Math.abs(v);
    }
    return t;
  }
  return null;
}

// ── Một hay hai người ──────────────────────────────────────────────────────────────────────────────

export type CapDuyet = "MOT_CAP" | "HAI_CAP";
export type LyDoCapDuyet = "DUOI_NGUONG" | "TU_NGUONG" | "KHONG_DO_DUOC_TIEN" | "NGUONG_KHONG_DOC_DUOC";

/**
 * CƠ SỞ TÍNH NGƯỠNG hai cấp của hàng chờ (chủ dự án chốt 18–19/10/2026): Σ|chênh| của TOÀN BỘ sự kiện giải quyết LOGIC = mọi điều chỉnh tài chính mà MỘT thao tác resolve HIỆN TẠI sẽ ghi cho cùng
 * hàng chờ / khoản thu — cộng HẾT các dòng đó (mọi ô, mọi dòng, mọi người hưởng) TRƯỚC khi quyết một hay hai người, nên không ai chia nhỏ để né duyệt kép.
 * KHÔNG cộng: `INPUT_CORRECTION` lịch sử đã ghi từ trước · hàng chờ khác chưa được resolve trong thao tác này · ledger lịch sử mà quyết định hiện tại không đổi. Đếm quá lịch sử cũ biến mọi
 * khoản thu có tiền sử thành "hai người" mãi mãi và làm mất tác dụng phân loại của ngưỡng.
 * Con số đó là `tien` của `quyetCapDuyet`: bản XEM TRƯỚC của `giaiHangCho` (`tongTuyetDoi` = Σ|chênh| đúng tập sẽ ghi), nâng lên số trong `detail` nếu `detail` lớn hơn (thận trọng; trong luồng thật hai số bằng nhau).
 * Lưu ý: bản đầu (#776) cộng thêm hàng chờ mở khác và dòng điều chỉnh lịch sử — đã gỡ vì RỘNG hơn định nghĩa này.
 */
export const CO_SO_NGUONG_HANG_CHO = "SUM_ABS_LOGICAL_EVENT" as const;

/**
 * Hàng chờ này cần MỘT hay HAI người. Fail-closed theo đúng khuôn `quyetQuanTri`: không đo được tiền, hoặc ngưỡng hỏng ⇒ hai người.
 * `tien` ĐÃ là số của người quyết (trần), không phải số client tự khai: chỗ gọi lấy nó từ `detail` (đề nghị) hoặc từ bản xem trước phía server.
 */
export function quyetCapDuyet(i: { tien: number | null; nguong: number | null }): { cap: CapDuyet; lyDo: LyDoCapDuyet } {
  if (i.nguong === null || !Number.isFinite(i.nguong) || i.nguong < 0) return { cap: "HAI_CAP", lyDo: "NGUONG_KHONG_DOC_DUOC" };
  if (i.tien === null || !Number.isFinite(i.tien) || i.tien < 0) return { cap: "HAI_CAP", lyDo: "KHONG_DO_DUOC_TIEN" };
  return i.tien >= i.nguong ? { cap: "HAI_CAP", lyDo: "TU_NGUONG" } : { cap: "MOT_CAP", lyDo: "DUOI_NGUONG" };
}

export function chuCapDuyet(l: LyDoCapDuyet, dinhDang: (n: number) => string, nguong: number | null): string {
  switch (l) {
    case "DUOI_NGUONG":
      return "Dưới ngưỡng duyệt hai cấp — một người có quyền quyết được.";
    case "TU_NGUONG":
      return `Số tiền đạt hoặc vượt ngưỡng ${nguong === null ? "" : dinhDang(nguong)} — cần hai người: một người đề nghị, một người KHÁC duyệt.`;
    case "KHONG_DO_DUOC_TIEN":
      return "Hệ thống không đo được số tiền bị ảnh hưởng nên cần hai người: một người đề nghị, một người KHÁC duyệt.";
    case "NGUONG_KHONG_DOC_DUOC":
      return "Ngưỡng duyệt hai cấp đang thiếu hoặc nhập sai nên cần hai người: một người đề nghị, một người KHÁC duyệt.";
  }
}

// ── Ai làm được gì ─────────────────────────────────────────────────────────────────────────────────

export type MotHanhDong = { duoc: true } | { duoc: false; lyDo: string };
export type HuongXuLy = {
  giaiPhong: MotHanhDong;
  tuChoi: MotHanhDong;
  chuyenXemTay: MotHanhDong;
  /** Hàng chờ thuộc một ĐỀ XUẤT điều chỉnh đang mở ⇒ id để dẫn tới nơi duyệt; null nếu không. */
  deXuatId: string | null;
};

const KHONG = (lyDo: string): MotHanhDong => ({ duoc: false, lyDo });

/**
 * Hàng chờ này CÓ THỂ được xử lý bằng hành động nào — một nguồn cho cả nút lẫn action (luật 12: không vẽ nút chắc chắn bị từ chối).
 * Chỉ là cổng TĨNH (mã · trạng thái · đề xuất). Cổng ĐỘNG (đổi nguồn chưa duyệt · đầu vào đã trôi tiếp · khoản đã quay lại thực thu) cần DB: bản XEM TRƯỚC của service chạy chính các cổng đó.
 */
export function huongXuLy(h: { code: CommissionHoldCode; status: string; detail: unknown }): HuongXuLy {
  const loiChung = kiemGiaiHangCho({ code: h.code, trangThai: h.status, quyetDinh: "AP_DUNG" });
  if (loiChung) return { giaiPhong: KHONG(loiChung), tuChoi: KHONG(loiChung), chuyenXemTay: KHONG(loiChung), deXuatId: null };
  const dx = proposalIdCuaHangCho(h.detail);
  if (dx) {
    const l = "Hàng chờ này thuộc một đề xuất điều chỉnh đang mở — duyệt hoặc từ chối ở đề xuất (một hoặc hai cấp), không xử lý trực tiếp ở đây.";
    return { giaiPhong: KHONG(l), tuChoi: KHONG(l), chuyenXemTay: KHONG(l), deXuatId: dx };
  }
  return { giaiPhong: { duoc: true }, tuChoi: { duoc: true }, chuyenXemTay: { duoc: true }, deXuatId: null };
}

// ── Lý do · bằng chứng ─────────────────────────────────────────────────────────────────────────────

export function kiemLyDoVaBangChung(i: { lyDo: string; bangChung: string }): { ok: true; lyDo: string; bangChung: string } | { ok: false; loi: string } {
  const lyDo = i.lyDo.trim();
  const bangChung = i.bangChung.trim();
  if (lyDo.length < LY_DO_TOI_THIEU) return { ok: false, loi: `Lý do bắt buộc (≥ ${LY_DO_TOI_THIEU} ký tự).` };
  if (lyDo.length > LY_DO_TOI_DA) return { ok: false, loi: `Lý do quá dài (tối đa ${LY_DO_TOI_DA} ký tự).` };
  if (bangChung.length < BANG_CHUNG_TOI_THIEU) return { ok: false, loi: `Bằng chứng bắt buộc (≥ ${BANG_CHUNG_TOI_THIEU} ký tự): mã phiếu thu, tin nhắn, biên bản… để người sau kiểm lại được.` };
  if (bangChung.length > BANG_CHUNG_TOI_DA) return { ok: false, loi: `Bằng chứng quá dài (tối đa ${BANG_CHUNG_TOI_DA} ký tự).` };
  return { ok: true, lyDo, bangChung };
}

/** Lý do GHI VÀO KIỂM TOÁN và `resolutionNote`: ghép lý do + bằng chứng (+ đề nghị của cấp một nếu có). Một hàm — mọi đường quyết cùng dạng. */
export function ghepLyDoKiemToan(i: { lyDo: string; bangChung: string; deNghi?: { ten: string; lyDo: string; bangChung: string } | null }): string {
  const goc = `${i.lyDo} · Bằng chứng: ${i.bangChung}`;
  return i.deNghi ? `${goc} · Cấp 1 (${i.deNghi.ten}): ${i.deNghi.lyDo} · Bằng chứng cấp 1: ${i.deNghi.bangChung}` : goc;
}

// ── Đề nghị (cấp 1) ────────────────────────────────────────────────────────────────────────────────

/** Một đề nghị đã đọc lại từ kiểm toán. `id` là id dòng AuditLog (dấu vết, không phải khoá nghiệp vụ). */
export type DeNghiDaGhi = {
  id: string;
  nguoiId: string | null;
  tenNguoi: string;
  luc: Date;
  quyetDinh: QuyetDinhGiai;
  /** Σ|chênh| tại lúc đề nghị — TRẦN của lượt duyệt. */
  tien: number;
  /** `holdKey` lúc đề nghị: đầu vào đổi ⇒ khoá hàng chờ mới (INPUT_DRIFT mang hash) ⇒ đề nghị cũ hết nghĩa. */
  holdKey: string;
  lyDo: string;
  bangChung: string;
  /** Id dòng `REOPEN` MỚI NHẤT của hàng chờ lúc lập đề nghị (`null` = chưa từng mở lại). Đề nghị chỉ dùng được khi mốc này VẪN là dòng REOPEN mới nhất. Đề nghị cũ (trước bản vá) không ghi ⇒ `null`. */
  mocMoLai: string | null;
  /** Do bộ đọc dấu vết gắn (`ganDauVoHieu`), không phải dữ liệu lưu: `DA_DUNG` = đã dùng để đóng hàng chờ · `SAU_MO_LAI` = hàng chờ đã được mở lại sau đề nghị. `null` = chưa bị vô hiệu. */
  vo: LyDoVoHieu | null;
};

export type LyDoVoHieu = "DA_DUNG" | "SAU_MO_LAI";

export function docDeNghi(raw: { id: string; actorId: string | null; actorName: string; createdAt: Date; newValues: unknown; reason: string | null }): DeNghiDaGhi | null {
  const v = laBanGhi(raw.newValues) ? raw.newValues : null;
  if (!v) return null;
  const qd = v.quyetDinh;
  if ((qd !== "AP_DUNG" && qd !== "GIU_NGUYEN") || !laSo(v.tien) || v.tien < 0 || typeof v.holdKey !== "string" || typeof v.lyDo !== "string" || typeof v.bangChung !== "string") return null;
  const moc = typeof v.mocMoLai === "string" ? v.mocMoLai : null;
  return { id: raw.id, nguoiId: raw.actorId, tenNguoi: raw.actorName, luc: raw.createdAt, quyetDinh: qd, tien: v.tien, holdKey: v.holdKey, lyDo: v.lyDo, bangChung: v.bangChung, mocMoLai: moc, vo: null };
}

/** `batKy.deNghi.auditId` của một dòng APPLY / DISMISS = id đề nghị đã được dùng để đóng hàng chờ; `null` nếu đóng không qua đề nghị (một người, dưới ngưỡng). */
export function deNghiDaDungCuaDongDong(newValues: unknown): string | null {
  const v = laBanGhi(newValues) ? newValues : null;
  const bk = v && laBanGhi(v.batKy) ? v.batKy : null;
  const dn = bk && laBanGhi(bk.deNghi) ? bk.deNghi : null;
  return dn && typeof dn.auditId === "string" ? dn.auditId : null;
}

/**
 * Gắn dấu vô hiệu cho một đề nghị từ SỰ THẬT trong dấu vết (không từ hạn thời gian): (1) đã được dùng để đóng hàng chờ — một đề nghị chỉ dùng MỘT lần, kể cả khi hàng chờ sau đó mở lại;
 * (2) hàng chờ đã được MỞ LẠI sau khi đề nghị lập — người đề nghị chưa từng thấy tình huống mới. `moLaiCuoiId` = id dòng REOPEN mới nhất của hàng chờ (null = chưa từng mở lại).
 */
export function ganDauVoHieu(d: DeNghiDaGhi, i: { daDung: ReadonlySet<string>; moLaiCuoiId: string | null }): DeNghiDaGhi {
  if (i.daDung.has(d.id)) return { ...d, vo: "DA_DUNG" };
  if (d.mocMoLai !== i.moLaiCuoiId) return { ...d, vo: "SAU_MO_LAI" };
  return { ...d, vo: null };
}

/**
 * Đề nghị còn dùng được: chưa bị vô hiệu bởi ảnh chụp (`vo`), đúng khoá hàng chờ hiện tại và chưa quá hạn. Hạn 7 ngày chỉ là LƯỚI PHỤ — hiệu lực thật nằm ở ảnh chụp.
 * KHÔNG có cận dưới: `luc` là đồng hồ DB (`AuditLog.createdAt`), `now` ở Server Action là đồng hồ máy ứng dụng — máy ứng dụng chậm
 * vài giây sẽ làm đề nghị vừa lập "ở tương lai" và người duyệt gặp `CAN_DE_NGHI_CAP_1` oan (reviewer 14/10/2026). Không có đường nào để client đặt `luc` nên bỏ cận dưới không mở thêm gì.
 */
export function deNghiConHieuLuc(d: DeNghiDaGhi, i: { holdKey: string; now: Date }): boolean {
  return d.vo === null && d.holdKey === i.holdKey && i.now.getTime() - d.luc.getTime() <= HAN_DE_NGHI_MS;
}

/** Tiền dùng cho cổng hai cấp = max(số trong `detail`, số bản xem trước) — thận trọng hơn là một trong hai. MỘT hàm cho lúc đề nghị, lúc duyệt và lúc kiểm lại TRONG khoá. */
export function tienChoCapTu(tuDetail: number | null, tuXem: number | null): number | null {
  if (tuDetail === null) return tuXem;
  if (tuXem === null) return tuDetail;
  return Math.max(tuDetail, tuXem);
}

/**
 * Tiền ảnh hưởng HIỆN TẠI phải BẰNG tiền đề nghị đã chụp — cả hai chiều. Trần "không được lớn hơn" (`tranTien`) chỉ chặn một chiều; người duyệt trên con số KHÁC với con số người đề nghị
 * đã nhìn là duyệt một quyết định chưa ai đưa ra. `null` (không đo được) được ghi là 0 lúc lập nên so cùng quy ước.
 */
export function tienKhopDeNghi(d: Pick<DeNghiDaGhi, "tien">, tienNay: number | null): boolean {
  return (tienNay ?? 0) === d.tien;
}

export function chuVoHieu(vo: LyDoVoHieu | null): string {
  switch (vo) {
    case "DA_DUNG":
      return "đề nghị cũ đã được dùng để đóng hàng chờ này";
    case "SAU_MO_LAI":
      return "hàng chờ đã được mở lại sau khi đề nghị được lập";
    case null:
      return "hết hạn hoặc đầu vào đã đổi";
  }
}

/** Cổng TÁCH NHIỆM: người duyệt cấp hai phải KHÁC người đề nghị (và phải biết là ai: đề nghị không rõ người ⇒ không ai duyệt được — fail-closed). */
export function loiNguoiDuyet(d: DeNghiDaGhi, nguoiDuyetId: string | null): string | null {
  if (!nguoiDuyetId) return "Không xác định được người duyệt.";
  if (d.nguoiId === null) return "Đề nghị không ghi rõ người lập — không thể kiểm tách nhiệm, lập lại đề nghị.";
  if (d.nguoiId === nguoiDuyetId) return "Người đề nghị không được tự duyệt — cần một người KHÁC duyệt (tách nhiệm).";
  return null;
}

// ── Trạng thái hiển thị ────────────────────────────────────────────────────────────────────────────

export type XemTayDaGhi = { id: string; nguoiId: string | null; tenNguoi: string; luc: Date; lyDo: string; holdKey: string };

export function docXemTay(raw: { id: string; actorId: string | null; actorName: string; createdAt: Date; newValues: unknown; reason: string | null }): XemTayDaGhi | null {
  const v = laBanGhi(raw.newValues) ? raw.newValues : null;
  if (!v || typeof v.holdKey !== "string") return null;
  return { id: raw.id, nguoiId: raw.actorId, tenNguoi: raw.actorName, luc: raw.createdAt, lyDo: raw.reason ?? "", holdKey: v.holdKey };
}

export type TrangThaiXuLy = "CHUA_XU_LY" | "CHO_DUYET_CAP_HAI" | "DA_CHUYEN_XEM_TAY";

export const NHAN_TRANG_THAI_XU_LY: Readonly<Record<TrangThaiXuLy, string>> = {
  CHUA_XU_LY: "Chưa xử lý",
  CHO_DUYET_CAP_HAI: "Chờ người khác duyệt",
  DA_CHUYEN_XEM_TAY: "Đã chuyển xem tay",
};

/** Trạng thái xử lý của hàng chờ MỞ, từ dấu vết kiểm toán còn hiệu lực. Đề nghị (đang chờ duyệt) thắng «xem tay» vì nó là bước tiến xa hơn. */
export function trangThaiXuLy(i: { deNghi: DeNghiDaGhi | null; xemTay: XemTayDaGhi | null; holdKey: string; now: Date }): TrangThaiXuLy {
  if (i.deNghi && deNghiConHieuLuc(i.deNghi, { holdKey: i.holdKey, now: i.now })) return "CHO_DUYET_CAP_HAI";
  if (i.xemTay && i.xemTay.holdKey === i.holdKey) return "DA_CHUYEN_XEM_TAY";
  return "CHUA_XU_LY";
}
