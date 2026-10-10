/**
 * lib/nguon/chon-nguon.ts — LUẬT THUẦN của ô chọn nguồn: danh sách radio (SourcePicker), người giới thiệu
 * (ReferrerPicker) và kiểm biểu mẫu. Dùng chung cho Sheet "Gán nguồn" (tab Nguồn, chi tiết lead) và form nhập lead
 * (06 §5.1, §5.6). THUẦN: không DB, không DOM, không đồng hồ.
 *
 * ── Một bộ luật cho cả hai chỗ (luật 12b) và cùng luật với máy chủ ──────────────────────────────────────────
 * Trình duyệt chỉ GỢI Ý lỗi sớm; máy chủ (`quyetDinhDoiNguon`, `chuanBiQuyNguon`) mới là cổng. Cả hai gọi cùng
 * `kiemThamChieu` / `kiemGiaiTrinh` (kiem-nguon.ts) và cùng `LY_DO_TOI_THIEU` (doi-nguon.ts) — nên một câu lỗi ở ô
 * không thể khác câu lỗi do máy chủ trả về.
 *
 * ── Hành vi đi theo THUỘC TÍNH của nhóm, không so mã (03 T3) ────────────────────────────────────────────────
 * Danh mục MỞ: admin thêm nhóm mới không sửa mã. "Có người / không có người" suy từ `referrerRequirement`; "cần giải
 * trình" từ `requiresNote`; "không chọn được" từ `selectable`/`status`. KHÔNG có chỗ nào ở đây nhắc mã nhóm.
 *
 * ── Nhóm GHI = nhóm người nhập CHỌN (nguồn động, SPEC §2 V1) ─────────────────────────────────────────────────
 * Chọn một nhóm nhân sự rồi chọn người ⇒ nhóm GHI VÀO vẫn là nhóm đã chọn — kể cả nhóm do admin tạo. Vai của nhân sự chỉ là ẢNH CHỤP
 * (`referrerRoleCode`) ghi kèm, KHÔNG đổi nhóm. (Bản cũ ghi đè về nhóm theo vai nên chính sách riêng của nguồn mới không bao giờ áp dụng.)
 */
import type { SourceReferrerRequirement } from "@prisma/client";
import type { MaVaiNguon } from "./danh-muc-goc";
import { LY_DO_TOI_THIEU } from "./doi-nguon";
import { nguonChonDuoc } from "./hieu-luc-nguon";
import { kiemGiaiTrinh, kiemThamChieu, type ThamChieuNguon } from "./kiem-nguon";

/** Dòng danh mục như đọc từ DB (kiểu thô, còn cả nhóm ngừng/hệ thống). */
export type NhomChonTho = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  referrerRequirement: SourceReferrerRequirement;
  requiresNote: boolean;
  selectable: boolean;
  status: string;
  sortOrder: number;
  /** Khoảng hiệu lực (`LeadSourceGroup.effectiveFrom/To`): ngoài khoảng ⇒ không chọn được cho lead MỚI. BẮT BUỘC khai (luật 7). */
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/** Nhóm CHỌN ĐƯỢC ở ô nhập (đã lọc `selectable ∧ ACTIVE`). */
export type NhomChon = Pick<
  NhomChonTho,
  "id" | "code" | "name" | "description" | "referrerRequirement" | "requiresNote" | "sortOrder"
>;

export type LoaiNguoi = "NHAN_SU" | "PHU_HUYNH" | "DOI_TAC";

/** Độ dài ô tìm người — ở ĐÂY (không phải `tim-nguoi-gioi-thieu.ts`) vì trình duyệt cũng đọc, mà tệp kia kéo `db` theo. */
export const DO_DAI_TIM_TOI_THIEU = 2;
export const DO_DAI_TIM_TOI_DA = 60;

/** Người đã chọn trong ReferrerPicker. Chỉ id + chữ để hiển thị — KHÔNG SĐT/email. */
export type NguoiDaChon =
  | { loai: "NHAN_SU"; employeeId: string; ten: string; ma: string | null; vai: MaVaiNguon }
  | { loai: "PHU_HUYNH"; studentId: string; parentUserId: string | null; ten: string; ma: string | null; moTa: string }
  | { loai: "DOI_TAC"; affiliateId: string; ten: string; ma: string | null };

/** Vai ngữ nghĩa → chữ người đọc. Không có chữ số: văn bản 06/10 đánh số 5–8 nhưng số chỉ là dữ liệu (H18). */
export const NHAN_VAI: Readonly<Record<MaVaiNguon, string>> = {
  SALE: "Sale/Tư vấn",
  MANAGER: "Quản lý/BLĐ",
  TEACHER: "Giáo viên",
  OTHER_EMPLOYEE: "Nhân sự khác",
};

export const NHAN_LOAI_NGUOI: Readonly<Record<LoaiNguoi, string>> = {
  NHAN_SU: "Nhân sự giới thiệu",
  PHU_HUYNH: "Phụ huynh giới thiệu",
  DOI_TAC: "Đối tác giới thiệu",
};

/** Loại người mà nhóm này bắt chọn; `null` ⇒ không có ô người (NONE, EVENT). */
export function loaiNguoiCuaNhom(req: SourceReferrerRequirement): LoaiNguoi | null {
  switch (req) {
    case "EMPLOYEE":
      return "NHAN_SU";
    case "PARENT":
      return "PHU_HUYNH";
    case "AFFILIATE_ORG":
      return "DOI_TAC";
    case "NONE":
    case "EVENT":
      return null;
    default:
      return null;
  }
}

/**
 * Chỉ ACTIVE ∧ selectable ∧ trong khoảng hiệu lực lúc `now` (`nguonChonDuoc` — MỘT định nghĩa), theo `sortOrder` rồi tên.
 * UNKNOWN (selectable=false), nhóm ngừng và nhóm ngoài hiệu lực KHÔNG có mặt. `now` BẮT BUỘC (luật 19).
 */
export function locNhomChon(rows: readonly NhomChonTho[], now: Date): NhomChon[] {
  return rows
    .filter((r) => nguonChonDuoc(r, now))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"))
    .map(({ id, code, name, description, referrerRequirement, requiresNote, sortOrder }) => ({
      id,
      code,
      name,
      description,
      referrerRequirement,
      requiresNote,
      sortOrder,
    }));
}

/** Gom theo "có người / không có người" — theo THUỘC TÍNH. Giữ nguyên thứ tự đầu vào trong từng cụm. */
export function gomTheoNguoi<T extends Pick<NhomChon, "referrerRequirement">>(
  nhom: readonly T[],
): { coNguoi: T[]; khongNguoi: T[] } {
  const coNguoi: T[] = [];
  const khongNguoi: T[] = [];
  for (const n of nhom) (loaiNguoiCuaNhom(n.referrerRequirement) ? coNguoi : khongNguoi).push(n);
  return { coNguoi, khongNguoi };
}

/**
 * `groupId` sẽ GỬI LÊN máy chủ = nhóm người nhập đã chọn. KHÔNG phụ thuộc người được chọn: vai của nhân sự chỉ là ảnh chụp, không chọn nhóm.
 * (Hàm giữ làm MỘT chỗ để ô chọn, Sheet và form nhập lead không tự nghĩ ra cách lấy id.)
 */
export function groupIdSeGui(chon: NhomChon | null): string | null {
  return chon ? chon.id : null;
}

/** Người đã chọn ⇒ bốn cột id mà `kiemThamChieu`/`doiNguonLead` nhận. `null` ⇒ không người. */
export function thamChieuTuNguoi(nguoi: NguoiDaChon | null): ThamChieuNguon | null {
  if (!nguoi) return null;
  switch (nguoi.loai) {
    case "NHAN_SU":
      return { employeeId: nguoi.employeeId, parentUserId: null, studentId: null, affiliateId: null };
    case "PHU_HUYNH":
      return { employeeId: null, parentUserId: nguoi.parentUserId, studentId: nguoi.studentId, affiliateId: null };
    case "DOI_TAC":
      return { employeeId: null, parentUserId: null, studentId: null, affiliateId: nguoi.affiliateId };
  }
}

export type TruongLoiForm = "nguon" | "thamChieu" | "giaiTrinh" | "lyDo";

/**
 * Kiểm biểu mẫu chọn nguồn — lỗi THEO Ô. Rỗng ⇒ hợp lệ. Kiểm theo NHÓM SẼ GHI (`groupIdSeGui`) = nhóm đang chọn: luật người/giải trình
 * đo trên đúng nhóm đó (cùng thứ máy chủ sẽ đo).
 */
export function kiemFormChonNguon(
  f: {
    nhom: NhomChon | null;
    nguoi: NguoiDaChon | null;
    giaiTrinh: string;
    lyDo: string;
    /** Lead ĐÃ có quy nguồn ⇒ lý do bắt buộc (03 §3). Tạo mới ⇒ false. BẮT BUỘC khai (luật 7). */
    canLyDo: boolean;
  },
  nhom: readonly NhomChon[],
): Partial<Record<TruongLoiForm, string>> {
  const loi: Partial<Record<TruongLoiForm, string>> = {};
  if (!f.nhom) {
    loi.nguon = "Chọn một nguồn.";
    return loi;
  }
  const idGhi = groupIdSeGui(f.nhom);
  const nhomGhi = nhom.find((n) => n.id === idGhi) ?? f.nhom;
  const loiNguoi = kiemThamChieu(nhomGhi, thamChieuTuNguoi(f.nguoi));
  if (loiNguoi) loi.thamChieu = loiNguoi;
  const loiGiaiTrinh = kiemGiaiTrinh(nhomGhi, f.giaiTrinh);
  if (loiGiaiTrinh) loi.giaiTrinh = loiGiaiTrinh;
  if (f.canLyDo && f.lyDo.trim().length < LY_DO_TOI_THIEU) {
    loi.lyDo = `Lý do đổi nguồn phải từ ${LY_DO_TOI_THIEU} ký tự (hiện ${f.lyDo.trim().length}).`;
  }
  return loi;
}
