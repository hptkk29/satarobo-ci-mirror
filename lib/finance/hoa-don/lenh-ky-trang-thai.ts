// lib/finance/hoa-don/lenh-ky-trang-thai.ts — LUẬT THUẦN của LỆNH KÝ hoá đơn (Invoice Hub S9, Signature Engine). Không DB, không đồng hồ thật.
//
//   CHO_KY ──duyệt/bắt đầu──▶ DANG_KY ──▶ DA_KY | LOI_KY | HET_HAN
//     ├──huỷ──▶ HUY
//     └──quá hạn──▶ HET_HAN
//
// Khớp CHECK `HoaDonLenhKy_trang_thai_check` (6 trạng thái) và chỉ mục từng phần `HoaDonLenhKy_hoaDonId_song_key`
// (UNIQUE(hoaDonId) WHERE trangThai IN ('CHO_KY','DANG_KY') ⇒ "sống" = CHO_KY | DANG_KY).
//
// ⚠️ KHÔNG có DANG_KY → HUY: lúc DANG_KY bộ ký có thể đang chạy; huỷ lúc đó sinh ra chữ ký mà sổ ghi "đã huỷ". Lệnh DANG_KY kẹt thì thoát bằng HET_HAN.
//
// OD-08 (docs 00 §2b — owner đã xác nhận): USB token cần kế toán duyệt/ký; HSM được tự ký nếu đủ quyền; có ký từ xa / thủ công dự phòng;
// ApprovalPolicy TÁCH khỏi phương thức ký. CÒN MỞ: ai có quyền ký HSM ⇒ chính sách là DỮ LIỆU truyền vào, MẶC ĐỊNH FAIL-CLOSED:
//   · mọi phương thức đều CẦN DUYỆT, người ký ≠ người yêu cầu;
//   · chỉ MỘT đường duy nhất bỏ qua bước duyệt: phương thức HSM_NHA_CUNG_CAP ∧ chính sách của CHÍNH cơ sở của hoá đơn khai `hsmTuKy === true`.
//     Dữ liệu KHÔNG nới được USB token / ký từ xa / thủ công. Cơ sở A bật không kéo theo cơ sở B.
//   · "cùng một người vừa yêu cầu vừa ký" chỉ được khi cơ sở đó khai rõ `khacNguoi[phươngThức] === false`.

export const TRANG_THAI_LENH_KY = ["CHO_KY", "DANG_KY", "DA_KY", "LOI_KY", "HET_HAN", "HUY"] as const;
export type TrangThaiLenhKy = (typeof TRANG_THAI_LENH_KY)[number];

export const PHUONG_THUC_KY = ["HSM_NHA_CUNG_CAP", "USB_TOKEN", "KY_TU_XA", "THU_CONG"] as const;
export type PhuongThucKy = (typeof PHUONG_THUC_KY)[number];

export const laTrangThaiLenhKy = (s: string): s is TrangThaiLenhKy => (TRANG_THAI_LENH_KY as readonly string[]).includes(s);
export const laPhuongThucKy = (s: string): s is PhuongThucKy => (PHUONG_THUC_KY as readonly string[]).includes(s);

/** Trạng thái SỐNG — đúng điều kiện của chỉ mục từng phần (một lệnh sống mỗi hoá đơn). */
export const TRANG_THAI_SONG: readonly TrangThaiLenhKy[] = ["CHO_KY", "DANG_KY"];
export const laTrangThaiSong = (s: string): boolean => (TRANG_THAI_SONG as readonly string[]).includes(s);
/** Trạng thái CUỐI: không đi tiếp. Chuỗi lạ ⇒ false (không phải cuối, cũng không phải sống — người gọi tự từ chối). */
export const laTrangThaiCuoi = (s: string): boolean => laTrangThaiLenhKy(s) && !laTrangThaiSong(s);

const CHUYEN_HOP_LE: Readonly<Record<TrangThaiLenhKy, readonly TrangThaiLenhKy[]>> = {
  CHO_KY: ["DANG_KY", "HUY", "HET_HAN"],
  DANG_KY: ["DA_KY", "LOI_KY", "HET_HAN"],
  DA_KY: [],
  LOI_KY: [],
  HET_HAN: [],
  HUY: [],
};

export type KetQuaChuyenLenhKy = { ok: true } | { ok: false; lyDo: string };

export function chuyenLenhKy(tu: string, den: string): KetQuaChuyenLenhKy {
  if (!laTrangThaiLenhKy(tu) || !laTrangThaiLenhKy(den)) return { ok: false, lyDo: "Trạng thái lệnh ký không hợp lệ." };
  if (laTrangThaiCuoi(tu)) return { ok: false, lyDo: "Lệnh ký này đã kết thúc — không còn thao tác nào." };
  if (!CHUYEN_HOP_LE[tu].includes(den)) return { ok: false, lyDo: "Không thể thực hiện thao tác này ở trạng thái hiện tại của lệnh ký." };
  return { ok: true };
}

// ── CHÍNH SÁCH DUYỆT KÝ (dữ liệu truyền vào) ─────────────────────────────

export type QuyTacCoSoKy = {
  /** CHỈ có nghĩa với HSM_NHA_CUNG_CAP. Phải đúng `true`. */
  hsmTuKy?: boolean;
  /** `false` tường minh ⇒ cho cùng một người vừa yêu cầu vừa ký phương thức đó. Thiếu / khác `false` ⇒ phải khác người. */
  khacNguoi?: Partial<Record<PhuongThucKy, boolean>>;
};

export type ChinhSachDuyetKy = { theoCoSo: Readonly<Record<string, QuyTacCoSoKy>> };

export type QuyTacKyDaGiai = {
  hsmTuKy: boolean;
  khacNguoi: Readonly<Record<PhuongThucKy, boolean>>;
};

/** Chính sách nghiêm nhất: không cơ sở nào được ngoại lệ. Dùng khi chưa có dữ liệu — KHÔNG phải mặc định ngầm của hàm nào, người gọi phải TRUYỀN nó. */
export const CHINH_SACH_KY_NGHIEM_NHAT: ChinhSachDuyetKy = Object.freeze({ theoCoSo: Object.freeze({}) });

const NGHIEM_NHAT: QuyTacKyDaGiai = Object.freeze({
  hsmTuKy: false,
  khacNguoi: Object.freeze({ HSM_NHA_CUNG_CAP: true, USB_TOKEN: true, KY_TU_XA: true, THU_CONG: true }),
});

/** Quy tắc đã giải của MỘT cơ sở. Mục thiếu ⇒ nghiêm nhất. Đọc bằng `hasOwn` (id cơ sở "constructor" không được rơi vào prototype). */
export function chinhSachChoCoSo(chinhSach: ChinhSachDuyetKy, centerId: string): QuyTacKyDaGiai {
  const theoCoSo = chinhSach.theoCoSo as Record<string, unknown> | null | undefined;
  if (!theoCoSo || typeof theoCoSo !== "object" || !Object.hasOwn(theoCoSo, centerId)) return NGHIEM_NHAT;
  const q = theoCoSo[centerId];
  if (!q || typeof q !== "object") return NGHIEM_NHAT;
  const m = q as { hsmTuKy?: unknown; khacNguoi?: unknown };
  const kn = m.khacNguoi && typeof m.khacNguoi === "object" ? (m.khacNguoi as Record<string, unknown>) : {};
  const khacNguoi = {} as Record<PhuongThucKy, boolean>;
  for (const pt of PHUONG_THUC_KY) khacNguoi[pt] = !(Object.hasOwn(kn, pt) && kn[pt] === false);
  return { hsmTuKy: m.hsmTuKy === true, khacNguoi };
}

/**
 * Dựng chính sách từ dữ liệu LẠ (JSON cấu hình). Chỉ giữ đúng những gì khai rõ ràng; rác ⇒ nghiêm nhất. Không bao giờ ném.
 */
export function chuanHoaChinhSachKy(raw: unknown): ChinhSachDuyetKy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return CHINH_SACH_KY_NGHIEM_NHAT;
  const theo = (raw as { theoCoSo?: unknown }).theoCoSo;
  if (!theo || typeof theo !== "object" || Array.isArray(theo)) return CHINH_SACH_KY_NGHIEM_NHAT;
  const ra: [string, QuyTacCoSoKy][] = [];
  for (const [centerId, q] of Object.entries(theo as Record<string, unknown>)) {
    if (!q || typeof q !== "object" || Array.isArray(q)) continue;
    const m = q as { hsmTuKy?: unknown; khacNguoi?: unknown };
    const khacNguoi: Partial<Record<PhuongThucKy, boolean>> = {};
    if (m.khacNguoi && typeof m.khacNguoi === "object") {
      const kn = m.khacNguoi as Record<string, unknown>;
      for (const pt of PHUONG_THUC_KY) if (Object.hasOwn(kn, pt) && kn[pt] === false) khacNguoi[pt] = false;
    }
    ra.push([centerId, { ...(m.hsmTuKy === true ? { hsmTuKy: true } : {}), ...(Object.keys(khacNguoi).length > 0 ? { khacNguoi } : {}) }]);
  }
  // `fromEntries` tạo thuộc tính DỮ LIỆU — id cơ sở "__proto__" không đổi được prototype như phép gán `ra[k] = …`.
  return { theoCoSo: Object.fromEntries(ra) };
}

/**
 * Lệnh ký này có CẦN bước duyệt (người có quyền khác bấm "duyệt & bắt đầu ký") không. TRUE là mặc định:
 * chỉ `HSM_NHA_CUNG_CAP` + cơ sở khai `hsmTuKy === true` mới ra false. Phương thức lạ ⇒ true.
 */
export function canDuyet(chinhSach: ChinhSachDuyetKy, centerId: string, phuongThuc: string): boolean {
  if (phuongThuc !== "HSM_NHA_CUNG_CAP") return true;
  return !chinhSachChoCoSo(chinhSach, centerId).hsmTuKy;
}

export type KetQuaTachNhiemVu = { ok: true } | { ok: false; lyDo: string };

/**
 * Người yêu cầu của lệnh do HỆ THỐNG tự tạo (bước quét tạo lệnh ký USB cho hoá đơn do Invoice Engine lập — BGĐ 04/11/2026). Không phải id người dùng nào (id là cuid).
 * ⚠️ KHÔNG có nhánh miễn trừ nào theo giá trị này trong `kiemTachNhiemVu` (lưới `[LK-W7]` canh): luật «người ký ≠ người yêu cầu» tự thoả vì không người dùng nào có id `SYSTEM`,
 *    nên kế toán nào cũng ký được lệnh hệ thống — còn lệnh LẬP TAY (người yêu cầu = chính kế toán) vẫn chịu luật nguyên vẹn. Thêm một nhánh «SYSTEM thì bỏ qua» chỉ thêm đường vòng.
 * ⚠️ Chỉ `taoLenhKyHeThong` ghi được giá trị này (lưới `[LK-W7]`): action / API không có chỗ để truyền `nguoiYeuCauId`, và `taoLenhKy` của người dùng luôn ghi `actor.userId`.
 */
export const NGUOI_YEU_CAU_HE_THONG = "SYSTEM" as const;

/**
 * Tách nhiệm vụ yêu cầu ↔ ký. Thiếu người (rỗng) ⇒ từ chối. Không cần duyệt (HSM tự ký đã khai) ⇒ người yêu cầu chính là người ký, được.
 * Còn lại: người ký phải KHÁC người yêu cầu, trừ khi cơ sở khai `khacNguoi[phươngThức] === false`.
 */
export function kiemTachNhiemVu(i: {
  chinhSach: ChinhSachDuyetKy;
  centerId: string;
  phuongThuc: string;
  nguoiYeuCau: string;
  nguoiKy: string;
}): KetQuaTachNhiemVu {
  if (!i.nguoiYeuCau.trim() || !i.nguoiKy.trim()) return { ok: false, lyDo: "Thiếu người yêu cầu hoặc người ký." };
  if (!canDuyet(i.chinhSach, i.centerId, i.phuongThuc)) return { ok: true };
  if (i.nguoiYeuCau !== i.nguoiKy) return { ok: true };
  if (laPhuongThucKy(i.phuongThuc) && chinhSachChoCoSo(i.chinhSach, i.centerId).khacNguoi[i.phuongThuc] === false) return { ok: true };
  return { ok: false, lyDo: "Người ký phải khác người yêu cầu — cần một kế toán khác duyệt lệnh này." };
}

// ── HẠN LỆNH ─────────────────────────────────────────────────────────────

export const TOI_DA_TTL_PHUT = 24 * 60;

/** Mốc hết hạn = `now` + ttl. KHÔNG đọc đồng hồ; ttl là số nguyên 1…TOI_DA_TTL_PHUT, không có mặc định — sai ⇒ NÉM. */
export function tinhHetHan(now: Date, ttlPhut: number): Date {
  if (!Number.isInteger(ttlPhut) || ttlPhut < 1 || ttlPhut > TOI_DA_TTL_PHUT) {
    throw new RangeError(`Hạn lệnh ký phải là số phút nguyên từ 1 đến ${TOI_DA_TTL_PHUT}.`);
  }
  return new Date(now.getTime() + ttlPhut * 60_000);
}

/** Đã hết hạn chưa: đúng tại mốc là HẾT. Không có hạn (hàng chèn tay) ⇒ coi như HẾT — không lệnh nào sống vô thời hạn. */
export function daHetHan(hetHanLuc: Date | null | undefined, now: Date): boolean {
  if (!hetHanLuc) return true;
  return now.getTime() >= hetHanLuc.getTime();
}
