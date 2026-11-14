// lib/affiliate/xu-ly-referral.ts — XỬ LÝ TAY MỘT REFERRAL (AFF-L3b): máy trạng thái, luật nhập liệu, nhãn. THUẦN: không DB, không đồng hồ, client-safe.
//
// Năm hành động của người có quyền `affiliate_referrals:manage` trên một lượt đang chờ người:
//
//   | hành động            | từ                          | sang          | ghi attribution? |
//   | DUYET                | MANUAL_REVIEW · DISPUTED    | VALID         | CÓ (đúng đường first-claim — `lib/nguon/ghi-nguon-affiliate-duyet.ts`)
//   | TU_CHOI              | MANUAL_REVIEW · DISPUTED    | REJECTED      | không
//   | DANH_DAU_TRANH_CHAP  | MANUAL_REVIEW               | DISPUTED      | không
//   | XIN_BANG_CHUNG       | MANUAL_REVIEW · DISPUTED    | (giữ nguyên)  | không — chỉ để lại một dòng nhật ký «đang chờ bằng chứng»
//   | BO_SUNG_BANG_CHUNG   | MANUAL_REVIEW · DISPUTED    | (giữ nguyên)  | không — đóng yêu cầu bằng chứng
//
// VALID · REJECTED · REJECTED_DUPLICATE là TRẠNG THÁI CUỐI [quyết định AFF-L3b]. Mở lại một lượt đã chốt nghĩa là đảo một quyết định mà hoa hồng có thể đã đọc
// (VALID) hoặc đảo một lần từ chối mà đối tác đã được báo (REJECTED); muốn đổi người ghi nhận của một lead thì đã có quy trình Đổi nguồn (có quyền riêng, có đề xuất điều chỉnh
// khi đã thu tiền). Một lượt bị từ chối nhầm thì khai tay lượt MỚI (có nhật ký riêng) — lượt cũ giữ nguyên làm dấu vết.
//
// MỘT hàm này cho CẢ nút vẽ ở giao diện lẫn cổng ở máy chủ (luật 12): vẽ nút bằng bảng A rồi để action hỏi bảng B là lời hứa suông.
import { canonicalPhone } from "@/lib/phone";
import type { TrangThaiReferral } from "./ghi-referral-dau-vao";

export const HANH_DONG_XU_LY = ["DUYET", "TU_CHOI", "DANH_DAU_TRANH_CHAP", "XIN_BANG_CHUNG", "BO_SUNG_BANG_CHUNG"] as const;
export type HanhDongXuLy = (typeof HANH_DONG_XU_LY)[number];

export const laHanhDongXuLy = (v: unknown): v is HanhDongXuLy => typeof v === "string" && (HANH_DONG_XU_LY as readonly string[]).includes(v);

/** Loại sự kiện trong nhật ký = năm hành động + «khai tay» (sự kiện đầu đời của lượt khai tay). Khớp enum `AffiliateReferralEventKind`. */
export const LOAI_SU_KIEN = ["KHAI_TAY", ...HANH_DONG_XU_LY] as const;
export type LoaiSuKien = (typeof LOAI_SU_KIEN)[number];

export const NHAN_HANH_DONG: Readonly<Record<HanhDongXuLy, string>> = {
  DUYET: "Duyệt",
  TU_CHOI: "Từ chối",
  DANH_DAU_TRANH_CHAP: "Đánh dấu tranh chấp",
  XIN_BANG_CHUNG: "Xin bằng chứng",
  BO_SUNG_BANG_CHUNG: "Bổ sung bằng chứng",
};

export const NHAN_LOAI_SU_KIEN: Readonly<Record<LoaiSuKien, string>> = {
  KHAI_TAY: "Khai tay",
  ...NHAN_HANH_DONG,
};

/** Một câu cho người vận hành: bấm nút này thì chuyện gì xảy ra. */
export const MO_TA_HANH_DONG: Readonly<Record<HanhDongXuLy, string>> = {
  DUYET: "Ghi người giới thiệu này vào hồ sơ khách (nếu khách chưa có người ghi nhận trước) — hoa hồng sẽ đọc từ đó. Không hoàn tác được.",
  TU_CHOI: "Chốt lượt này là không hợp lệ. Khách vẫn giữ nguyên hồ sơ, không gắn người giới thiệu. Không hoàn tác được.",
  DANH_DAU_TRANH_CHAP: "Giữ lượt này ở trạng thái tranh chấp trong lúc làm rõ. Chưa ghi gì vào hồ sơ khách.",
  XIN_BANG_CHUNG: "Ghi lại yêu cầu bổ sung bằng chứng. Trạng thái lượt không đổi.",
  BO_SUNG_BANG_CHUNG: "Ghi thêm bằng chứng cho lượt này. Trạng thái lượt không đổi.",
};

/** Trạng thái còn nhận xử lý tay. Còn lại (VALID · REJECTED · REJECTED_DUPLICATE) là cuối. */
export const TRANG_THAI_CON_XU_LY: readonly TrangThaiReferral[] = ["MANUAL_REVIEW", "DISPUTED"];

const BANG: Readonly<Record<HanhDongXuLy, { tu: readonly TrangThaiReferral[]; den: TrangThaiReferral | "GIU_NGUYEN" }>> = {
  DUYET: { tu: ["MANUAL_REVIEW", "DISPUTED"], den: "VALID" },
  TU_CHOI: { tu: ["MANUAL_REVIEW", "DISPUTED"], den: "REJECTED" },
  DANH_DAU_TRANH_CHAP: { tu: ["MANUAL_REVIEW"], den: "DISPUTED" },
  XIN_BANG_CHUNG: { tu: ["MANUAL_REVIEW", "DISPUTED"], den: "GIU_NGUYEN" },
  BO_SUNG_BANG_CHUNG: { tu: ["MANUAL_REVIEW", "DISPUTED"], den: "GIU_NGUYEN" },
};

export type KetQuaChuyenTrangThai = { ok: true; den: TrangThaiReferral } | { ok: false; loi: string };

export function chuyenTrangThai(tu: TrangThaiReferral, hanhDong: HanhDongXuLy): KetQuaChuyenTrangThai {
  const r = BANG[hanhDong];
  if (!r.tu.includes(tu)) {
    return TRANG_THAI_CON_XU_LY.includes(tu)
      ? { ok: false, loi: `Không thể «${NHAN_HANH_DONG[hanhDong].toLowerCase()}» lượt đang ở trạng thái này.` }
      : { ok: false, loi: "Lượt này đã được chốt — không xử lý tiếp được. Cần đổi người ghi nhận của khách thì dùng «Đổi nguồn» trên phiếu khách." };
  }
  return { ok: true, den: r.den === "GIU_NGUYEN" ? tu : r.den };
}

/** Các nút được vẽ cho một trạng thái — cùng bảng với cổng máy chủ. */
export function cacHanhDongChoPhep(tu: TrangThaiReferral): HanhDongXuLy[] {
  return HANH_DONG_XU_LY.filter((h) => chuyenTrangThai(tu, h).ok);
}

// ── Nhập liệu ────────────────────────────────────────────────────────────────────────────────────

export const LY_DO_TOI_THIEU = 10;
export const LY_DO_TOI_DA = 500;
export const GHI_CHU_TOI_DA = 2000;

/**
 * Văn bản tự do KHÔNG được mang SĐT / email của khách (lý do và ghi chú hiện lại ở trang chi tiết, mà trang đó không che PII).
 * Bắt: email; số điện thoại VN dạng `0xxxxxxxxx` / `84xxxxxxxxx` / `+84…` (cho phép cách, chấm, gạch giữa các chữ số). Số hợp đồng / mã biên nhận (không bắt đầu bằng 0 hoặc 84) đi qua.
 */
export function chuaPiiKhach(s: string): boolean {
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) return true;
  if (/(?<![\d])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\d])/.test(s)) return true;
  // Chuẩn hoá thêm: nếu có chuỗi 9–11 chữ số liền mà `canonicalPhone` nhận ra là SĐT.
  for (const m of s.match(/\d{9,11}/g) ?? []) if (canonicalPhone(m) !== null) return true;
  // Ký tự trình bày LẠ xen giữa chữ số (gạch dưới · gạch chéo · ngoặc · dấu cách kép): «0907_111_222», «(0907)111/222». Bỏ ký tự trình bày rồi hỏi `canonicalPhone`;
  // mã biên nhận / ngày / số hợp đồng không phải đầu số di động VN nên vẫn qua (đối chứng dương ở test).
  for (const m of s.match(/\+?[\d(][\d\s.\-_/()]{7,}\d/g) ?? []) {
    const so = m.replace(/\D/g, "");
    if (so.length >= 9 && so.length <= 12 && canonicalPhone(so) !== null) return true;
  }
  // Email viết né chống bot: «ten [at] gmail [dot] com», «ten(at)gmail.com».
  if (/[\w.+-]+\s*[[({]\s*at\s*[\])}]\s*[\w-]+/i.test(s)) return true;
  return false;
}

export type KetQuaChuoi = { ok: true; gia: string } | { ok: false; loi: string };

export function kiemLyDo(raw: unknown): KetQuaChuoi {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (t.length < LY_DO_TOI_THIEU) return { ok: false, loi: `Lý do phải từ ${LY_DO_TOI_THIEU} ký tự.` };
  if (t.length > LY_DO_TOI_DA) return { ok: false, loi: `Lý do tối đa ${LY_DO_TOI_DA} ký tự.` };
  if (chuaPiiKhach(t)) return { ok: false, loi: "Lý do không được chứa số điện thoại hoặc email của khách." };
  return { ok: true, gia: t };
}

export function kiemGhiChuBangChung(raw: unknown): KetQuaChuoi {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (t.length < LY_DO_TOI_THIEU) return { ok: false, loi: `Ghi chú bằng chứng phải từ ${LY_DO_TOI_THIEU} ký tự.` };
  if (t.length > GHI_CHU_TOI_DA) return { ok: false, loi: `Ghi chú bằng chứng tối đa ${GHI_CHU_TOI_DA} ký tự.` };
  if (chuaPiiKhach(t)) return { ok: false, loi: "Ghi chú bằng chứng không được chứa số điện thoại hoặc email của khách — ghi mã phiếu / số biên nhận thay vào." };
  return { ok: true, gia: t };
}

/**
 * Hành động nào PHẢI kèm ghi chú bằng chứng — HIỆN TẤT CẢ NĂM (brief: «bằng chứng bắt buộc ở MỌI hành động»). Với «Xin bằng chứng», ghi chú là CĂN CỨ của lời xin (đã đối chiếu gì, còn thiếu gì),
 * còn lý do là điều đang xin. Bảng giữ dạng bảng (không bỏ) để một hành động sau này nới ra là một dòng đổi + một ca đỏ, không phải đi tìm điều kiện rải rác.
 */
export const HANH_DONG_CAN_GHI_CHU: Readonly<Record<HanhDongXuLy, boolean>> = {
  DUYET: true,
  TU_CHOI: true,
  DANH_DAU_TRANH_CHAP: true,
  XIN_BANG_CHUNG: true,
  BO_SUNG_BANG_CHUNG: true,
};

// ── Nhật ký ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Lượt đang CHỜ BẰNG CHỨNG ⇔ sự kiện «xin» (XIN_BANG_CHUNG) mới nhất đứng SAU mọi sự kiện «bổ sung» (BO_SUNG_BANG_CHUNG) — nhật ký sắp CŨ → MỚI.
 * Chỉ có nghĩa khi lượt còn ở trạng thái chờ; lượt đã chốt không «chờ» gì nữa (nơi gọi tự kiểm).
 */
export function dangChoBangChung(suKien: readonly { loai: LoaiSuKien }[]): boolean {
  for (let i = suKien.length - 1; i >= 0; i -= 1) {
    const l = suKien[i]!.loai;
    if (l === "BO_SUNG_BANG_CHUNG") return false;
    if (l === "XIN_BANG_CHUNG") return true;
  }
  return false;
}
