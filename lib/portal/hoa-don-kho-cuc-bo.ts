import "server-only";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// KHO TỆP HOÁ ĐƠN CỤC BỘ — CHỈ để xem thử cổng phụ huynh trên máy dev (04/11/2026). Máy dev không có R2 nên nút «Xem / Tải» của mục «Hoá đơn» luôn
// rơi về «Tệp đang được chuẩn bị»; khi đặt `PORTAL_HOA_DON_KHO_CUC_BO=<thư mục>` route tải đọc thẳng tệp từ thư mục đó.
//
// ⚠️ AN TOÀN — đừng nới:
//   · TẮT CỨNG khi `NODE_ENV === "production"` (build production = VPS test + prod): biến có đặt nhầm cũng bị bỏ qua.
//   · Mọi cổng của route (cờ · đăng nhập PARENT · chế độ học sinh · chính sách · sở hữu · audit) vẫn chạy TRƯỚC — hàm này chỉ thay NGUỒN byte
//     (thư mục thay R2), không thay quyền. Đừng đưa lệnh đọc tệp lên trước các cổng đó.
//   · Khoá tệp chỉ lấy từ DB (không từ URL) nhưng vẫn chặn đi ra ngoài thư mục (`..`, đường tuyệt đối) — fail-closed.
//   · Thư mục đặt NGOÀI repo: hoá đơn thật có tên/CCCD người mua, repo có bản gương công khai.

/** Thư mục kho cục bộ; `null` = không dùng (mặc định, và luôn `null` ở production). */
export function thuMucKhoCucBo(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const d = (process.env.PORTAL_HOA_DON_KHO_CUC_BO ?? "").trim();
  return d ? resolve(d) : null;
}

/** Đường tuyệt đối của `khoa` TRONG `thuMuc`; `null` nếu thoát ra ngoài thư mục. */
export function duongDanTrongKho(thuMuc: string, khoa: string): string | null {
  if (!khoa || khoa.includes("\0")) return null;
  const goc = resolve(thuMuc);
  const dich = resolve(goc, khoa);
  return dich === goc || !dich.startsWith(goc + sep) ? null : dich;
}

/** Byte của tệp; `null` khi khoá ra ngoài thư mục hoặc tệp không có. */
export async function docTepKhoCucBo(thuMuc: string, khoa: string): Promise<Buffer | null> {
  const p = duongDanTrongKho(thuMuc, khoa);
  if (!p) return null;
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}
