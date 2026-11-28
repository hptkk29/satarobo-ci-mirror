/**
 * lib/affiliate/tai-khoan-truy-cap-dau-vao.ts — LUẬT «TÀI KHOẢN TRUY CẬP CỔNG» CỦA ĐỐI TÁC, PHẦN THUẦN (AFF-L3a). Không `db`, không đồng hồ, không `"use server"`.
 *
 * Quyết ĐƯỢC / KHÔNG ĐƯỢC; `tai-khoan-truy-cap-ghi.ts` đọc DB rồi ghi, `tai-khoan-truy-cap.ts` đọc.
 *
 * ── User ≠ AffiliateParty ──────────────────────────────────────────────────────────────────────────────────────
 * `User` = danh tính đăng nhập; `AffiliateParty` = danh tính kinh doanh. Một tổ chức có NHIỀU User; một User có thể đại diện NHIỀU đối tác (cổng dùng `IN`, không `=`). Bảng nối `AffiliatePartyUser`.
 *
 * ── LUẬT CHỌN: ai liên kết được ────────────────────────────────────────────────────────────────────────────────
 * Cổng đối tác nằm TRONG cổng phụ huynh (`/portal/gioi-thieu`), mà layout portal chỉ cho tài khoản PARENT thuần (`hasStaffRole` ⇒ đẩy về /dashboard). Nên chỉ liên kết được User
 *   · còn hoạt động (chưa xoá, `isActive`, `accountStatus` ≠ DISABLED),
 *   · KHÔNG mang vai nhân viên nào — liên kết nhân viên là một lời hứa suông (họ không bao giờ vào được trang).
 * Một User ĐƯỢC liên kết với nhiều đối tác (tổ chức nhiều thành viên · một người đại diện nhiều đơn vị) — KHÔNG cấm «User đã ở đối tác khác». Chỉ cấm trùng CHÍNH đối tác đó.
 * Vì sao không tạo tài khoản ở màn này: đối tác ngoài hệ thống (trường học, KOL) chưa có đường đăng nhập — đó là quyết định kinh doanh còn mở (notes). Màn chỉ nối User ĐÃ CÓ.
 *
 * ── MỘT trạng thái truy cập ────────────────────────────────────────────────────────────────────────────────────
 * ACTIVE vào được · SUSPENDED tạm ngừng cổng (dữ liệu giữ nguyên, mở lại được) · REVOKED đã gỡ (dòng giữ làm vết; liên kết lại = MỞ LẠI chính dòng đó). Tạm ngừng / gỡ cần lý do ≥ 10 ký tự.
 * Mỗi đối tác tối đa MỘT người đại diện chưa gỡ. Người đại diện phải đang ACTIVE (người đại diện bị tạm ngừng thì đối tác không có người nói chuyện được).
 */
import { z } from "zod";
import { hasStaffRole } from "@/lib/auth/permissions";

export const VAI_TRUY_CAP = ["REPRESENTATIVE", "MEMBER"] as const;
export type VaiTruyCap = (typeof VAI_TRUY_CAP)[number];
export const NHAN_VAI_TRUY_CAP: Readonly<Record<VaiTruyCap, string>> = { REPRESENTATIVE: "Người đại diện", MEMBER: "Thành viên" };

export const TRANG_THAI_TRUY_CAP = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type TrangThaiTruyCap = (typeof TRANG_THAI_TRUY_CAP)[number];
export const NHAN_TRANG_THAI_TRUY_CAP: Readonly<Record<TrangThaiTruyCap, string>> = { ACTIVE: "Đang truy cập được", SUSPENDED: "Tạm ngừng cổng", REVOKED: "Đã gỡ liên kết" };

export const LY_DO_TOI_THIEU_TRUY_CAP = 10;
/** Ô tìm tài khoản: tối thiểu bấy nhiêu ký tự mới tra (chống dùng ô tìm làm danh bạ). */
export const DO_DAI_TIM_USER_TOI_THIEU = 3;
export const DO_DAI_TIM_USER_TOI_DA = 60;
/** Trần số tài khoản trả về cho một lần tìm. */
export const SO_KET_QUA_TIM_USER = 8;

// ── Kiểu thuần (client import được, không kéo db) ──────────────────────────────────────────────────────────────

/** Phần của User mà luật cần. `vai` = `role` + `roles` (cùng hình dạng `hasStaffRole` nhận). */
export type UserDeKiem = {
  isActive: boolean;
  deletedAt: Date | null;
  accountStatus: "PENDING_ACTIVATION" | "ACTIVE" | "DISABLED";
  role: string;
  roles: readonly string[];
};

export type LoiTruong = { ok: false; loi: string; truong: string };

/** Tài khoản này có liên kết được không (một nguồn cho cổng ghi lẫn ô tìm). */
export function kiemUserLienKetDuoc(u: UserDeKiem | null): { ok: true } | LoiTruong {
  if (!u) return { ok: false, loi: "Không tìm thấy tài khoản này.", truong: "userId" };
  if (u.deletedAt !== null || !u.isActive) return { ok: false, loi: "Tài khoản này đã bị vô hiệu hoá hoặc đã xoá — chọn tài khoản khác.", truong: "userId" };
  if (u.accountStatus === "DISABLED") return { ok: false, loi: "Tài khoản này đang bị khoá — chọn tài khoản khác.", truong: "userId" };
  // `hasStaffRole` nhận {role, roles} (kiểu Role của Prisma) — chuỗi từ DB đã là Role hợp lệ.
  if (hasStaffRole({ role: u.role as never, roles: u.roles as never })) {
    return { ok: false, loi: "Đây là tài khoản nhân viên — cổng đối tác chỉ dành cho tài khoản phụ huynh. Chọn tài khoản phụ huynh.", truong: "userId" };
  }
  return { ok: true };
}

export type DongTruyCapDeKiem = { userId: string; role: VaiTruyCap; status: TrangThaiTruyCap };

// ── Liên kết ────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaKiemLienKet = { ok: true; viec: "TAO" | "MO_LAI" } | LoiTruong;

export function kiemLienKet(p: {
  doiTac: { status: "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED" } | null;
  user: UserDeKiem | null;
  /** Dòng truy cập sẵn có của CHÍNH cặp (đối tác, tài khoản). */
  hienCo: { role: VaiTruyCap; status: TrangThaiTruyCap } | null;
  vai: VaiTruyCap;
  /** Người đại diện chưa gỡ của đối tác hiện tại (nếu có). */
  daiDienHienTai: { userId: string } | null;
}): KetQuaKiemLienKet {
  if (!p.doiTac) return { ok: false, loi: "Không tìm thấy đối tác này.", truong: "partyId" };
  if (p.doiTac.status === "ENDED") return { ok: false, loi: "Đối tác đã kết thúc — không liên kết thêm tài khoản.", truong: "partyId" };
  const u = kiemUserLienKetDuoc(p.user);
  if (!u.ok) return u;
  if (p.hienCo && p.hienCo.status !== "REVOKED") {
    return { ok: false, loi: `Tài khoản này đã được liên kết với đối tác này (${NHAN_TRANG_THAI_TRUY_CAP[p.hienCo.status].toLowerCase()}).`, truong: "userId" };
  }
  if (p.vai === "REPRESENTATIVE" && p.daiDienHienTai) {
    return { ok: false, loi: "Đối tác đã có người đại diện — liên kết tài khoản này làm thành viên, rồi dùng «Đổi người đại diện».", truong: "vai" };
  }
  return { ok: true, viec: p.hienCo ? "MO_LAI" : "TAO" };
}

// ── Gỡ / tạm ngừng / mở lại / đổi đại diện ───────────────────────────────────────────────────────────────────────

function thieuLyDo(lyDo: string | null, viec: string): LoiTruong | null {
  if ((lyDo ?? "").trim().length < LY_DO_TOI_THIEU_TRUY_CAP) return { ok: false, loi: `Ghi lý do ${viec} (tối thiểu ${LY_DO_TOI_THIEU_TRUY_CAP} ký tự).`, truong: "lyDo" };
  return null;
}

export function kiemGoLienKet(p: { status: TrangThaiTruyCap; lyDo: string | null }): { ok: true } | LoiTruong {
  if (p.status === "REVOKED") return { ok: false, loi: "Liên kết này đã được gỡ rồi.", truong: "trangThai" };
  return thieuLyDo(p.lyDo, "gỡ liên kết") ?? { ok: true };
}

export function kiemTamNgung(p: { status: TrangThaiTruyCap; lyDo: string | null }): { ok: true } | LoiTruong {
  if (p.status === "REVOKED") return { ok: false, loi: "Liên kết đã gỡ — liên kết lại tài khoản trước.", truong: "trangThai" };
  if (p.status === "SUSPENDED") return { ok: false, loi: "Cổng của tài khoản này đã được tạm ngừng rồi.", truong: "trangThai" };
  return thieuLyDo(p.lyDo, "tạm ngừng cổng") ?? { ok: true };
}

export function kiemMoLaiCong(p: { status: TrangThaiTruyCap; user: UserDeKiem | null }): { ok: true } | LoiTruong {
  if (p.status === "REVOKED") return { ok: false, loi: "Liên kết đã gỡ — liên kết lại tài khoản thay vì mở lại.", truong: "trangThai" };
  if (p.status === "ACTIVE") return { ok: false, loi: "Cổng của tài khoản này đang mở.", truong: "trangThai" };
  // Mở lại một tài khoản đã thành nhân viên / bị khoá là lời hứa suông: cổng vẫn 404 với họ.
  return kiemUserLienKetDuoc(p.user);
}

export function kiemDoiDaiDien(p: {
  moi: DongTruyCapDeKiem | null;
  hienTai: DongTruyCapDeKiem | null;
}): { ok: true } | LoiTruong {
  if (!p.moi) return { ok: false, loi: "Tài khoản này chưa được liên kết với đối tác — liên kết trước rồi mới đặt làm người đại diện.", truong: "userId" };
  if (p.moi.status === "REVOKED") return { ok: false, loi: "Liên kết của tài khoản này đã gỡ — liên kết lại trước.", truong: "userId" };
  if (p.moi.status === "SUSPENDED") return { ok: false, loi: "Cổng của tài khoản này đang tạm ngừng — mở lại cổng trước khi đặt làm người đại diện.", truong: "userId" };
  if (p.hienTai && p.hienTai.userId === p.moi.userId) return { ok: false, loi: "Tài khoản này đã là người đại diện.", truong: "userId" };
  return { ok: true };
}

/** Giá trị CỘT LEGACY `Affiliate.userId` phải bằng sau mọi thay đổi: người đại diện CHƯA GỠ, không có ⇒ null. MỘT định nghĩa cho mọi hàm ghi. */
export function userIdLegacy(dong: readonly DongTruyCapDeKiem[]): string | null {
  return dong.find((d) => d.role === "REPRESENTATIVE" && d.status !== "REVOKED")?.userId ?? null;
}

// ── Nút trên một dòng: vẽ từ đây, thao tác bị chặn hiện CÂU LÝ DO thay vì nút (luật 12) ─────────────────────────

export type ThaoTacTruyCap = "TAM_NGUNG" | "MO_LAI" | "GO" | "DAT_DAI_DIEN";

export function thaoTacKhaDung(d: { role: VaiTruyCap; status: TrangThaiTruyCap; doiTacKetThuc: boolean }): { thaoTac: ThaoTacTruyCap; lyDoChan: string | null }[] {
  if (d.status === "REVOKED") return [];
  const ra: { thaoTac: ThaoTacTruyCap; lyDoChan: string | null }[] = [];
  if (d.status === "ACTIVE") ra.push({ thaoTac: "TAM_NGUNG", lyDoChan: d.doiTacKetThuc ? "Đối tác đã kết thúc." : null });
  if (d.status === "SUSPENDED") ra.push({ thaoTac: "MO_LAI", lyDoChan: d.doiTacKetThuc ? "Đối tác đã kết thúc." : null });
  if (d.role === "MEMBER") ra.push({ thaoTac: "DAT_DAI_DIEN", lyDoChan: d.status === "SUSPENDED" ? "Mở lại cổng trước khi đặt làm người đại diện." : null });
  ra.push({ thaoTac: "GO", lyDoChan: null });
  return ra;
}

// ── Đầu vào Server Action (zod; vai BẮT BUỘC — luật 7) ───────────────────────────────────────────────────────────

const idChuoi = (nhan: string) => z.string().trim().min(1, `Chọn ${nhan}.`).max(64);
const moc = z
  .string()
  .min(1)
  .max(40)
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Mốc thời gian không hợp lệ");
const lyDo = z
  .string()
  .max(500)
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

export const lienKetSchema = z.object({ partyId: idChuoi("đối tác"), userId: idChuoi("tài khoản"), vai: z.enum(VAI_TRUY_CAP, { message: "Chọn vai: người đại diện hoặc thành viên." }) }).strict();
export const goSchema = z.object({ id: idChuoi("liên kết"), updatedAtDaThay: moc, lyDo }).strict();
export const tamNgungSchema = goSchema;
export const moLaiSchema = z.object({ id: idChuoi("liên kết"), updatedAtDaThay: moc, lyDo }).strict();
export const doiDaiDienSchema = z.object({ partyId: idChuoi("đối tác"), id: idChuoi("liên kết mới"), updatedAtDaThay: moc }).strict();
export const timUserSchema = z.object({ partyId: idChuoi("đối tác"), q: z.string().max(DO_DAI_TIM_USER_TOI_DA * 2) }).strict();

// ── Kết quả (kiểu thuần — tệp "use server" chỉ được export hàm async) ───────────────────────────────────────────

export type KetQuaTruyCap<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; loi: string; truong?: string };
