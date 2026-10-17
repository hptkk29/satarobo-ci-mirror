// lib/affiliate/ghi-referral-dau-vao.ts — CHỮ và HÌNH DẠNG của màn Referral (AFF-P1, docs/source-commission/12 §2.4–§2.6). THUẦN: không DB, không đồng hồ, client-safe.
//
// Màn Referral CHỈ ĐỌC: người vận hành thấy mỗi lượt khách đến qua link/QR/mã đã được xử lý ra sao. Tệp này giữ ba thứ để test không cần DB:
//   1. bảng trạng thái (thứ tự chip · nhãn · tông pill) — MỘT nguồn cho chip, pill, cột trạng thái và đếm hàng chờ;
//   2. `dichLyDoReferral` — dịch `resolutionReason` (mã máy `MA:chi tiết` hoặc câu tiếng Việt) ra câu người vận hành đọc được;
//   3. `docSnapshotReferral` — đọc `sourceSnapshot` (Json) bằng NARROW, chỉ lấy đúng các khoá đã biết. Không bao giờ chuyển nguyên Json xuống trình duyệt:
//      snapshot được thiết kế không PII, nhưng "được thiết kế" không phải là một cổng.
//
// ⚠️ PII — cứng: không có kiểu nào ở đây mang tên/SĐT/email của khách. Phiếu khách chỉ là một mã rút gọn (`maRutGonPhieu`) và, khi người xem MỞ ĐƯỢC phiếu, một id để dựng liên kết.
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { NHAN_TU_DAU, type TuDauGiaiNguon } from "./giai-nguon";
import { NHAN_CHUOI_LINK_KHONG_HOP_LE } from "./ghi-link-dau-vao";
import { NHAN_TU_CHOI_REFERRAL, type MaTuChoiReferral } from "./quyet-dinh-referral";
import type { CanCuTuGioiThieu } from "./tu-gioi-thieu";

// ── Trạng thái ───────────────────────────────────────────────────────────────────────────────────

/** Thứ tự = thứ tự chip lọc. Khớp enum `AffiliateReferralStatus`; `Record<…>` bên dưới khiến thêm giá trị enum mà quên nhãn là lỗi biên dịch. */
export const TRANG_THAI_REFERRAL = ["VALID", "MANUAL_REVIEW", "REJECTED", "REJECTED_DUPLICATE", "DISPUTED"] as const;
export type TrangThaiReferral = (typeof TRANG_THAI_REFERRAL)[number];

export const NHAN_TRANG_THAI_REFERRAL: Readonly<Record<TrangThaiReferral, string>> = {
  VALID: "Hợp lệ",
  MANUAL_REVIEW: "Cần xem tay",
  REJECTED: "Từ chối",
  REJECTED_DUPLICATE: "Trùng — đã có người ghi nhận trước",
  DISPUTED: "Tranh chấp",
};

/** Một câu cho người vận hành: trạng thái này nghĩa là gì với khách và với hoa hồng. */
export const MO_TA_TRANG_THAI_REFERRAL: Readonly<Record<TrangThaiReferral, string>> = {
  VALID: "Đã thành người giới thiệu của khách (nguồn đã ghi vào hồ sơ khách).",
  MANUAL_REVIEW: "Hệ thống không tự quyết được — chưa ghi người giới thiệu, chờ người xem.",
  REJECTED: "Bị chặn — khách vẫn được ghi nhận bình thường nhưng không gắn người giới thiệu này.",
  REJECTED_DUPLICATE: "Khách đã có nguồn gốc từ trước — giữ người ghi nhận đầu tiên, lượt này không thay đổi gì.",
  DISPUTED: "Đang có tranh chấp về người được ghi nhận.",
};

export type ToneReferral = "success" | "warning" | "danger" | "info" | "brand" | "muted";

/** Chỉ TÔNG ở đây (cùng thang với `StatusPill`); chữ ở `NHAN_TRANG_THAI_REFERRAL`. */
export const TONE_TRANG_THAI_REFERRAL: Readonly<Record<TrangThaiReferral, ToneReferral>> = {
  VALID: "success",
  MANUAL_REVIEW: "warning",
  REJECTED: "danger",
  REJECTED_DUPLICATE: "muted",
  DISPUTED: "warning",
};

export function laTrangThaiReferral(v: unknown): v is TrangThaiReferral {
  return typeof v === "string" && (TRANG_THAI_REFERRAL as readonly string[]).includes(v);
}

/** Số lượng theo trạng thái, đủ MỌI khoá (0 khi không có). */
export type DemTheoTrangThaiReferral = Record<TrangThaiReferral, number>;

export function demRong(): DemTheoTrangThaiReferral {
  return { VALID: 0, MANUAL_REVIEW: 0, REJECTED: 0, REJECTED_DUPLICATE: 0, DISPUTED: 0 };
}

export function tongCacTrangThai(d: DemTheoTrangThaiReferral): number {
  return TRANG_THAI_REFERRAL.reduce((n, t) => n + d[t], 0);
}

// ── Cách đến ─────────────────────────────────────────────────────────────────────────────────────

export const CACH_DEN_REFERRAL = ["LINK", "QR", "CODE", "MANUAL", "OFFLINE", "API"] as const;
export type CachDenReferral = (typeof CACH_DEN_REFERRAL)[number];

/** Đủ SÁU giá trị của `AffiliateReferralMethod` (`NHAN_LOAI_LINK` của tab Link chỉ có ba — không dùng lại ở đây). */
export const NHAN_CACH_DEN_REFERRAL: Readonly<Record<CachDenReferral, string>> = {
  LINK: "Link",
  QR: "QR",
  CODE: "Mã",
  MANUAL: "Khai tay",
  OFFLINE: "Ngoại tuyến",
  API: "API",
};

// ── Tín hiệu Origin · căn cứ tự giới thiệu ───────────────────────────────────────────────────────

export type TinHieuOrigin = "KHOP" | "LECH" | "VANG";

export const NHAN_ORIGIN_REFERRAL: Readonly<Record<TinHieuOrigin, string>> = {
  KHOP: "Khớp — biểu mẫu gửi từ đúng website của link.",
  LECH: "Lệch — biểu mẫu gửi từ tên miền ngoài danh sách website của link.",
  VANG: "Vắng — lượt gửi không mang thông tin Origin (gửi trực tiếp hoặc trình duyệt không báo). Chỉ là tín hiệu phụ, không phải lý do từ chối.",
};

export const NHAN_CAN_CU_TU_GIOI_THIEU: Readonly<Record<CanCuTuGioiThieu, string>> = {
  TAI_KHOAN: "cùng một tài khoản",
  NHAN_VIEN: "cùng một nhân viên",
  SDT: "trùng số điện thoại",
  EMAIL: "trùng email",
};

const CAN_CU_BIET: readonly CanCuTuGioiThieu[] = ["TAI_KHOAN", "NHAN_VIEN", "SDT", "EMAIL"];
const laCanCu = (v: string): v is CanCuTuGioiThieu => (CAN_CU_BIET as readonly string[]).includes(v);

// ── Lý do ────────────────────────────────────────────────────────────────────────────────────────

/** Tên ngắn của mã từ chối — cột «Lý do» trong bảng (câu đầy đủ ở `NHAN_TU_CHOI_REFERRAL`). */
const NGAN_MA_TU_CHOI: Readonly<Record<MaTuChoiReferral, string>> = {
  LINK_KHONG_HOP_LE: "Link không còn hợp lệ",
  NGOAI_CUA_SO_COOKIE: "Quá cửa sổ ghi nhận",
  TU_GIOI_THIEU: "Tự giới thiệu",
};

const MA_TU_CHOI: readonly MaTuChoiReferral[] = ["LINK_KHONG_HOP_LE", "NGOAI_CUA_SO_COOKIE", "TU_GIOI_THIEU"];
const laMaTuChoi = (v: string): v is MaTuChoiReferral => (MA_TU_CHOI as readonly string[]).includes(v);

export type LyDoReferral = {
  /** Một dòng cho ô bảng (CSS cắt bớt, đầy đủ ở `title`/trang chi tiết). */
  ngan: string;
  /** Câu đầy đủ cho trang chi tiết. */
  day: string;
  /** `MA` khi đọc ra được mã máy; `CAU` khi là câu tiếng Việt viết sẵn; `TRONG` khi không có lý do. */
  dang: "MA" | "CAU" | "TRONG";
};

/**
 * `resolutionReason` → câu tiếng Việt. Hai dạng thật (xem `trangThaiSauQuyNguon`):
 *   · `MA:chi tiết` — CHỈ khi phần trước dấu `:` ĐẦU TIÊN là một mã từ chối đã biết. Câu xem tay có chứa dấu `:` ("… (luật thắng: X).") nên KHÔNG được tách mù theo `:`;
 *   · câu tiếng Việt viết sẵn — trả nguyên văn.
 * `null`/rỗng ⇒ "—" (không bịa lý do).
 */
export function dichLyDoReferral(lyDo: string | null | undefined): LyDoReferral {
  const s = (lyDo ?? "").trim();
  if (s === "") return { ngan: "—", day: "—", dang: "TRONG" };

  const i = s.indexOf(":");
  const ma = i > 0 ? s.slice(0, i) : "";
  if (ma !== "" && laMaTuChoi(ma)) {
    const chiTiet = s.slice(i + 1).trim();
    const goc = NHAN_TU_CHOI_REFERRAL[ma];
    if (ma === "LINK_KHONG_HOP_LE") {
      const cau = (NHAN_CHUOI_LINK_KHONG_HOP_LE as Readonly<Record<string, string>>)[chiTiet];
      return { ngan: cau ? `${NGAN_MA_TU_CHOI[ma]}: ${cau}` : NGAN_MA_TU_CHOI[ma], day: cau ? `${goc} Lý do: ${cau}` : goc, dang: "MA" };
    }
    if (ma === "TU_GIOI_THIEU") {
      const nhan = chiTiet
        .split(",")
        .map((x) => x.trim())
        .filter(laCanCu)
        .map((c) => NHAN_CAN_CU_TU_GIOI_THIEU[c]);
      return { ngan: nhan.length ? `${NGAN_MA_TU_CHOI[ma]} (${nhan.join(", ")})` : NGAN_MA_TU_CHOI[ma], day: nhan.length ? `${goc} Căn cứ: ${nhan.join(", ")}.` : goc, dang: "MA" };
    }
    // NGOAI_CUA_SO_COOKIE — chi tiết đã là câu tiếng Việt ("Cửa sổ 30 ngày").
    return { ngan: chiTiet ? `${NGAN_MA_TU_CHOI[ma]} (${chiTiet})` : NGAN_MA_TU_CHOI[ma], day: chiTiet ? `${goc} (${chiTiet}).` : goc, dang: "MA" };
  }
  return { ngan: s, day: s, dang: "CAU" };
}

// ── Snapshot ─────────────────────────────────────────────────────────────────────────────────────

export type SnapshotReferral = {
  maDoiTac: string | null;
  maCampaign: string | null;
  maLoai: string | null;
  maNhan: string[];
  /** Bậc quyết định nguồn — CHỈ có khi lượt gửi được quyết là HỢP LỆ lúc ghi (xem `nhan-referral.ts`). null ⇒ KHÔNG có nguồn đã giải. */
  tu: TuDauGiaiNguon | null;
  tuNhan: string | null;
  canCuTuGioiThieu: CanCuTuGioiThieu[];
  origin: TinHieuOrigin | null;
};

const BAC_NGUON: readonly TuDauGiaiNguon[] = ["RULE_LOAI_VA_NHAN", "RULE_LOAI", "RULE_NHAN", "MAC_DINH_CAMPAIGN", "MAC_DINH_LOAI"];
const laBacNguon = (v: unknown): v is TuDauGiaiNguon => typeof v === "string" && (BAC_NGUON as readonly string[]).includes(v);
const chuoiHoacNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 120) : null);

/** `sourceSnapshot` (Json) → các trường đã biết, hoặc mặc định an toàn. Không ném, không `any`. */
export function docSnapshotReferral(raw: unknown): SnapshotReferral {
  const o: Record<string, unknown> = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tu = laBacNguon(o.tu) ? o.tu : null;
  const origin = o.origin === "KHOP" || o.origin === "LECH" || o.origin === "VANG" ? o.origin : null;
  return {
    maDoiTac: chuoiHoacNull(o.affiliateCode),
    maCampaign: chuoiHoacNull(o.campaignCode),
    maLoai: chuoiHoacNull(o.typeCode),
    maNhan: Array.isArray(o.tagCodes) ? o.tagCodes.map(chuoiHoacNull).filter((x): x is string => x !== null) : [],
    tu,
    // Chỉ có ý nghĩa khi `tu` có mặt. Ưu tiên câu đã chụp lúc ghi; thiếu thì dịch từ bậc.
    tuNhan: tu === null ? null : chuoiHoacNull(o.tuNhan) ?? NHAN_TU_DAU[tu],
    canCuTuGioiThieu: Array.isArray(o.canCuTuGioiThieu) ? o.canCuTuGioiThieu.filter((x): x is CanCuTuGioiThieu => typeof x === "string" && laCanCu(x)) : [],
    origin,
  };
}

// ── Thời điểm ────────────────────────────────────────────────────────────────────────────────────

/** ISO → `13/10/2026 09:30` giờ Việt Nam. null / sai dạng ⇒ "—". */
export function thoiDiemHienThi(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const v = gioVN(d); // YYYY-MM-DDTHH:mm:ss+07:00
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)} ${v.slice(11, 16)}`;
}

// ── Phiếu khách ──────────────────────────────────────────────────────────────────────────────────

/** Mã rút gọn của một phiếu khách: 6 ký tự cuối của id, chữ hoa. Không phải PII, và KHÔNG đủ để dựng lại địa chỉ phiếu. */
export function maRutGonPhieu(leadId: string): string {
  return leadId.slice(-6).toUpperCase();
}

// ── Hình dạng dữ liệu đưa xuống giao diện ────────────────────────────────────────────────────────

export type PhieuKhachReferral = {
  /** Có phiếu khách gắn với lượt này không. */
  coPhieu: boolean;
  maRutGon: string | null;
  /** id để dựng liên kết — CHỈ có khi người xem mở được phiếu (quyền ∧ phiếu trong tầm nhìn cơ sở). Còn lại null ⇒ chỉ in mã rút gọn. */
  leadId: string | null;
};

export type DongReferral = {
  id: string;
  /** ISO. */
  luc: string;
  doiTac: { id: string; ten: string; ma: string };
  campaign: { id: string; ten: string; ma: string };
  cachDen: CachDenReferral;
  trangThai: TrangThaiReferral;
  /** Tên nhóm nguồn ĐÃ GIẢI; null ⇒ chưa quy được nguồn (không có bậc quyết định — đừng in nhóm «Không xác định» như thể đó là nguồn đã giải). */
  nguon: string | null;
  lyDo: LyDoReferral;
  phieu: PhieuKhachReferral;
};

export type ChiTietReferral = DongReferral & {
  snapshot: SnapshotReferral;
  tenLoai: string | null;
  tenNhan: { ma: string; ten: string }[];
  baoVeDen: string | null;
  datDieuKienLuc: string | null;
  tuChoiLuc: string | null;
  capNhatLuc: string;
};

export type PhamViReferral = "TAT_CA" | "GIOI_HAN";
