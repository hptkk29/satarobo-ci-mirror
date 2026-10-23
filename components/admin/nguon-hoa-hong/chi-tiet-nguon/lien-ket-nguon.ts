// components/admin/nguon-hoa-hong/chi-tiet-nguon/lien-ket-nguon.ts — các LIÊN KẾT ra khỏi trang chi tiết nguồn và việc nào được VẼ (luật 12). THUẦN.
//
// Quy tắc: chỉ vẽ liên kết khi đích đến mở được với người xem — một đường dẫn dẫn tới «Bạn không có quyền» là lời hứa suông. Khi không vẽ vì thiếu điều kiện mà người đọc CÓ THỂ
// khắc phục, nói điều kiện bằng chữ (kèm tên khoá quyền thật) thay vì để nút biến mất không dấu vết.
//
// Khoá quyền ở đây PHẢI trùng khoá mà trang/đích kiểm: «Sửa» → `sources:manage` (cùng khoá `suaNguonAction` kiểm ở đầu hàm); «Tạo chính sách» → `commission_policies:manage`
// (cùng khoá `chinh-sach/moi/page.tsx` kiểm). Lưới `[CTN-W*]` đọc cả hai phía.
import type { NguonDeSuaView } from "@/lib/nguon/doc-chi-tiet-nguon";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import type { NguonDeDoiTrangThai } from "../doi-trang-thai-nguon";

/**
 * Đích «Sửa nguồn»: trang `nguon/[maNguon]/sua` (biểu mẫu sửa). MỘT hàm cho CẢ bảng danh sách lẫn trang chi tiết: đổi đường dẫn là đổi ở đây.
 * (Bản cũ trỏ `?sua=1` — tham số không ai đọc — nên nút «Sửa nguồn» ở trang chi tiết chỉ tải lại chính trang đó. `[CTN-LK-03]` đọc cây `app/` để đích phải là một trang sửa CÓ THẬT.)
 */
export const hrefSuaNguon = (code: string): string => `/nguon-hoa-hong/nguon/${encodeURIComponent(code)}/sua`;

/** Đích «Tạo chính sách cho nguồn này»: trình soạn mở sẵn phạm vi «Một nhóm nguồn» (`?nguon=`, xem `lib/hoa-hong/nguon-cho-soan.ts`). */
export const hrefTaoChinhSachChoNguon = (code: string): string => `/nguon-hoa-hong/chinh-sach/moi?nguon=${encodeURIComponent(code)}`;

/**
 * Dòng tối thiểu mà nút «Đổi trạng thái» cần, dựng từ mục «thông tin» của trang chi tiết. Mục không đọc được (lỗi / thiếu quyền xem) ⇒ `null` ⇒ KHÔNG vẽ nút: nút này gửi
 * `capNhatLuc` làm mốc khoá lạc quan, dựng nó từ dữ liệu không có là đoán.
 */
export function nguonChoNutTrangThai(nguon: KetQuaMuc<NguonDeSuaView>): NguonDeDoiTrangThai | null {
  if (!nguon.ok) return null;
  const { id, code, name, status, isSystem, capNhatLuc, ownerEmployee, dinhTien } = nguon.du;
  return { id, code, name, status, isSystem, capNhatLuc, ownerEmployeeId: ownerEmployee?.id ?? null, chinhSachRieng: dinhTien.chinhSachRieng, ruleChuChay: dinhTien.ruleChuChay };
}

export const KHOA_SUA_NGUON = "sources:manage" as const;
export const KHOA_SOAN_CHINH_SACH = "commission_policies:manage" as const;

export type LienKetChinhSach =
  | { loai: "LIEN_KET"; href: string }
  | { loai: "LY_DO"; lyDo: string }
  | { loai: "AN" };

/**
 * «Tạo chính sách cho nguồn này» — vẽ liên kết, nói lý do, hay ẩn.
 *  · tab Chính sách không mở được với người xem (cờ engine tắt / thiếu `commission_policies:view`) ⇒ ẨN: đích 404 hoặc «không quyền», và người này không có việc ở đó;
 *  · thiếu `commission_policies:manage` ⇒ LÝ DO (kèm khoá);
 *  · nguồn chưa «Đang dùng» ⇒ LÝ DO: trình soạn chỉ liệt kê nguồn đang hoạt động, liên kết sẽ mở ra một phạm vi trống;
 *  · UNKNOWN ⇒ LÝ DO: engine không bao giờ trả hoa hồng theo nguồn cho UNKNOWN.
 * `laKhongRo` do nơi gọi tính từ MÃ UNKNOWN (ngoại lệ duy nhất được so mã, 03 T3) — hàm này không so mã.
 */
export function quyetDinhTaoChinhSach(p: {
  tabChinhSachMoDuoc: boolean;
  coQuyenSoan: boolean;
  /** Trạng thái nguồn; `null` = không đọc được nguồn ⇒ không vẽ gì (không đoán). */
  trangThai: string | null;
  laKhongRo: boolean;
  code: string;
}): LienKetChinhSach {
  if (!p.tabChinhSachMoDuoc || p.trangThai === null) return { loai: "AN" };
  if (!p.coQuyenSoan) return { loai: "LY_DO", lyDo: `Tạo chính sách cần quyền ${KHOA_SOAN_CHINH_SACH}.` };
  if (p.laKhongRo) return { loai: "LY_DO", lyDo: "Nguồn hệ thống «không rõ nguồn» không có hoa hồng theo nguồn nên không có chính sách riêng." };
  if (p.trangThai !== "ACTIVE") return { loai: "LY_DO", lyDo: "Kích hoạt nguồn (Đang dùng) trước — trình soạn chỉ liệt kê nguồn đang hoạt động." };
  return { loai: "LIEN_KET", href: hrefTaoChinhSachChoNguon(p.code) };
}
