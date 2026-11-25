/**
 * Nguồn DUY NHẤT cho nhóm «Góc gia đình» (10/11/2026) — gom ba lối vào «Khám phá DISC» · «Tủ sách» · «Sức khỏe»
 * thành MỘT mục, để thanh trên không tràn (ba mục riêng làm hàng menu bị cắt ở 1181–1360px).
 * Thanh trên (desktop), menu điện thoại (`MobileNavDrawer`) và nút nổi (`FloatingCta`) cùng đọc từ đây —
 * đúng lớp lỗi `[PUBLIC-NAV-T02]` (hai bản của cùng một thanh điều hướng trôi khỏi nhau).
 *
 * Luật:
 * - Mỗi mục chỉ có mặt khi cờ TƯƠNG ỨNG bật (DISC_ENABLED · TU_SACH_ENABLED · SUC_KHOE_ENABLED). Cả ba tắt ⇒ KHÔNG có nhóm.
 * - Đúng MỘT mục bật ⇒ KHÔNG dựng nhóm một con (bấm mở ra một dòng là thừa một cú bấm): mục đó hiện thẳng như liên kết thường.
 * - Thứ tự trong nhóm: DISC → Tủ sách → Sức khỏe. Trên thanh trên, nhóm đứng NGAY TRƯỚC «Liên hệ».
 * - Tên nhóm là MỘT hằng: đổi tên = sửa đúng một dòng ở đây.
 */
import { DISC_NAV } from "@/lib/disc/nav";
import { SUC_KHOE_NAV, TU_SACH_NAV, type CoCongThongTin } from "@/lib/cong-thong-tin/nav";

export const GOC_GIA_DINH_NHAN = "Góc gia đình";

export type MaMucGoc = "disc" | "tu-sach" | "suc-khoe";
export type MucGoc = { ma: MaMucGoc; label: string; href: string };

/** Một mục của thanh điều hướng: liên kết thường, hoặc nhóm (≥ 2 con). */
export type MucLienKet = { label: string; href: string };
export type MucNhom = { label: string; nhom: readonly MucGoc[] };

/** Các mục ĐANG BẬT của nhóm, đúng thứ tự. Rỗng khi cả ba cờ tắt. */
export function mucGocGiaDinh(discEnabled: boolean, co: CoCongThongTin | undefined): MucGoc[] {
  const ra: MucGoc[] = [];
  if (discEnabled) ra.push({ ma: "disc", ...DISC_NAV });
  if (co?.tuSach) ra.push({ ma: "tu-sach", ...TU_SACH_NAV });
  if (co?.sucKhoe) ra.push({ ma: "suc-khoe", ...SUC_KHOE_NAV });
  return ra;
}

/**
 * Chèn nhóm vào danh sách menu NGAY TRƯỚC «Liên hệ» (không có «Liên hệ» thì đặt cuối). 0 mục bật ⇒ trả nguyên;
 * 1 mục bật ⇒ chèn mục đó như liên kết thường; ≥ 2 ⇒ chèn một `MucNhom`. Không đổi mảng đầu vào.
 */
export function chenNhomGoc<T extends MucLienKet>(muc: readonly T[], discEnabled: boolean, co: CoCongThongTin | undefined): Array<T | MucLienKet | MucNhom> {
  const goc = mucGocGiaDinh(discEnabled, co);
  if (goc.length === 0) return [...muc];
  const them: MucLienKet | MucNhom = goc.length === 1 ? { label: goc[0]!.label, href: goc[0]!.href } : { label: GOC_GIA_DINH_NHAN, nhom: goc };
  const i = muc.findIndex((m) => m.href === "/lien-he");
  const viTri = i === -1 ? muc.length : i;
  return [...muc.slice(0, viTri), them, ...muc.slice(viTri)];
}

/** Mục của nhóm có phải trang đang đứng không (dùng cho dấu «đang ở đây»). `/tu-sach/xyz` vẫn tính là Tủ sách. */
export function mucGocDangDung(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}
