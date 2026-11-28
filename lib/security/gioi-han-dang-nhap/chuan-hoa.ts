import { canonicalPhone } from "@/lib/phone";

/**
 * Định danh CHUẨN HOÁ dùng làm khoá giới hạn đăng nhập — đúng phép mà web (`lib/auth.ts`) và mobile (`dich-vu.ts`) đang dùng:
 * SĐT quy về dạng canonical `84XXXXXXXXX`, còn lại là email viết thường. Phương án đề xuất (chưa nối vào đăng nhập thật).
 * Hai kênh PHẢI gọi cùng hàm này — chuẩn hoá khác nhau là hai bộ đếm khác nhau và kẻ dò chia lượt giữa chúng.
 */
export function dinhDanhChuanHoa(thoNhap: string): string {
  const t = thoNhap.trim();
  return canonicalPhone(t) ?? t.toLowerCase();
}
