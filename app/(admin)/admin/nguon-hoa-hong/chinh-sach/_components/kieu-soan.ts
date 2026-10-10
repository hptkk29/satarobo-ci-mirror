// Kiểu dùng chung của builder chính sách (client). Chỉ kiểu — không logic.
import type { FormChinhSach } from "@/lib/hoa-hong/chinh-sach-form";
import type { DuLieuSoan } from "@/lib/hoa-hong/chinh-sach-doc";

/** Dữ liệu chọn cho builder, đã serialize được (không Date, không Map). */
export type DuLieuSoanClient = DuLieuSoan;

export type PropsBuoc = {
  form: FormChinhSach;
  dat: (patch: Partial<FormChinhSach>) => void;
  /** Lỗi hiển thị cạnh ô (đã gộp lỗi bước + lỗi máy chủ còn hiệu lực), `null` nếu không lỗi. */
  loi: (truong: string) => string | null;
  dl: DuLieuSoanClient;
  /** Chính sách đã tồn tại ⇒ mã/tên/mô tả/chủ sở hữu BẤT BIẾN (version mới không đổi chúng). */
  khoaDinhDanh: boolean;
  /**
   * Người xem MỞ ĐƯỢC cấu hình nguồn không: có quyền QUẢN LÝ nguồn (`sources:manage`) ∧ cờ nguồn đang bật (`scope.co.nguon`; cờ tắt thì `/nguon-hoa-hong/nguon/<mã>` là 404 — hai cờ nguồn và engine độc lập). Quyết câu «Bật ở cấu hình nguồn» có kèm liên kết hay không. Liên kết «bật ở đây» cho người không mở được là lời hứa suông (luật 12).
   * BẮT BUỘC, không mặc định (luật 7).
   */
  coQuyenQuanLyNguon: boolean;
};

/** Văn bản đã có (từ máy chủ) hoặc vừa tạo trong phiên này nhưng chưa có trong `dl.vanBan`. */
export type VanBanLuaChon = DuLieuSoan["vanBan"][number];
