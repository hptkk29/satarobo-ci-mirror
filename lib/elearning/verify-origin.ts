/**
 * EL-16 — GỐC của địa chỉ tra cứu in trên QR chứng nhận (`<gốc>/xac-thuc/<token>`).
 *
 * Mặc định là gốc khu e-learning của PROD. Môi trường TEST có DB khác, nên một QR phát từ TEST mà trỏ về host PROD
 * dẫn người quét tới một nơi không có token ấy ("không tìm thấy") — UAT quét QR sẽ trông như hỏng. Cùng bài học với
 * `AFFILIATE_PUBLIC_ORIGIN` (lib/affiliate/goc-cong-khai.ts): mỗi môi trường khai gốc của MÌNH.
 *
 * `ELEARNING_VERIFY_ORIGIN=https://test.satarobo.vn` (không đường dẫn, không cổng). Giá trị sai/rỗng ⇒ lùi về mặc
 * định (không sửa ngầm, không lấy từ Host/Origin của request — chống open-redirect). Đọc lúc CHẠY bằng khoá động để
 * Next không nướng giá trị vào image.
 */
export const BIEN_GOC_XAC_THUC = "ELEARNING_VERIFY_ORIGIN";

const GOC_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function gocXacThuc(
  macDinh: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = env[BIEN_GOC_XAC_THUC];
  const g = typeof raw === "string" ? raw.trim().replace(/\/+$/, "").toLowerCase() : "";
  return GOC_RE.test(g) ? g : macDinh.replace(/\/$/, "");
}
