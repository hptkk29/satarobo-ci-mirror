// lib/export/quyen-xuat-thuan.ts — phần THUẦN của cổng xuất dữ liệu.
//
// Không import gì chạm session/DB, để test chạy được mà không cần next-auth hay Postgres —
// và quan trọng hơn: để CẤY LẠI LỖI vào đúng phép quyết định được (luật 8). Phần chạm hạ
// tầng ở `lib/export/quyen-xuat.ts`.
//
// Đọc `lib/export/danh-muc-xuat.ts` trước: ở đó là danh mục màn xuất, tệp nào chứa gì, và
// vai mặc định của từng màn.
import { MAN_XUAT, type ManXuat } from "./danh-muc-xuat";

export const KHOA_VAI_XUAT = "export.vaiTheoMan";

/** Giá trị lưu trong `SystemSetting`: mã màn → danh sách mã vai. */
export type BangVaiXuat = Record<string, string[]>;

/**
 * Vai được xuất một màn, sau khi hợp nhất cấu hình với mặc định.
 *
 * Màn KHÔNG có khoá trong cấu hình ⇒ lấy `vaiMacDinh` (hành vi hôm nay, không đổi gì).
 * Màn CÓ khoá ⇒ lấy đúng cấu hình, KỂ CẢ khi nó là mảng rỗng — mảng rỗng là admin đã nói
 * "chỉ mình tôi", và ghi đè lên mặc định là điều duy nhất khiến ô tích có ý nghĩa.
 *
 * Phân biệt "vắng mặt" với "rỗng" là cả thiết kế của cổng này. Coi rỗng như vắng mặt thì
 * admin bỏ hết tick mà quyền lại quay về mặc định — cấu hình nói một đằng, hệ thống làm
 * một nẻo, và không có lỗi nào được ném ra.
 */
export function vaiDuocXuat(man: ManXuat, bang: BangVaiXuat | null | undefined): string[] {
  const khai = bang?.[man.ma];
  return Array.isArray(khai) ? khai : man.vaiMacDinh;
}

/**
 * Cổng THUẦN: vai của người dùng có nằm trong danh sách không.
 *
 * `laSuperAdmin` luôn thắng — quản trị tối cao vốn bypass toàn bộ quyền trong `can()` v2
 * (`lib/auth/can.ts:46-47`), và đây cũng chính là câu "chưa phân quyền thì chỉ admin xuất
 * được": danh sách rỗng ⇒ mọi vai khác bị từ chối, còn admin thì không đi qua danh sách.
 */
export function vaiKhopDanhSach(
  vaiNguoiDung: readonly string[],
  duocPhep: readonly string[],
  laSuperAdmin: boolean,
): boolean {
  if (laSuperAdmin) return true;
  if (duocPhep.length === 0) return false;
  const cho = new Set(duocPhep);
  return vaiNguoiDung.some((v) => cho.has(v));
}

/** Vai của một phiên, dạng `duocXuat` cần. Hợp nhất `role` + `roles[]` như mọi nơi khác. */
export function vaiCuaPhien(user: {
  role?: string | null;
  roles?: readonly string[] | null;
}): { roles: string[]; laSuperAdmin: boolean } {
  const roles = [...new Set([user.role, ...(user.roles ?? [])].filter((x): x is string => !!x))];
  return { roles, laSuperAdmin: roles.includes("SUPER_ADMIN") };
}

/** Mọi mã màn — dùng cho test bao phủ. */
export const MOI_MA_XUAT = MAN_XUAT.map((x) => x.ma);
