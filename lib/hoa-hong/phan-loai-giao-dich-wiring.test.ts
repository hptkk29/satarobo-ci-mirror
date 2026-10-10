// @vitest-environment node
/**
 * [NHH-TRX-W*] — LƯỚI GHIM mã nguồn của bộ phân loại giao dịch.
 *
 * Luật cần khoá có dạng "lời gọi này phải có / không được có" — thứ test hành vi không chứng minh:
 * bộ nạp bỏ `WHERE_THUC_THU` thì hàm thuần vẫn xanh trên đầu vào đã dựng sẵn. Quy tắc viết lưới
 * (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN"): neo vào LỜI GỌI chứ không vào dòng import, đếm số
 * lần khớp, bỏ chú thích trước khi so, không dùng cờ `/s`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function doc(duongDan: string): string {
  const src = readFileSync(resolve(process.cwd(), duongDan), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const dem = (s: string, m: string) => s.split(m).length - 1;

describe("[NHH-TRX-W] dây nối bộ phân loại giao dịch", () => {
  const nap = doc("lib/hoa-hong/phan-loai-giao-dich-db.ts");
  const thuan = doc("lib/hoa-hong/phan-loai-giao-dich.ts");

  it("[NHH-TRX-W1] bộ nạp đọc thực thu bằng WHERE_THUC_THU (A1) đúng MỘT chỗ — không bộ lọc thứ hai", () => {
    expect(dem(nap, "...WHERE_THUC_THU")).toBe(1);
    expect(dem(nap, "accountantStatus")).toBe(0);
    expect(dem(nap, "CONFIRMED")).toBe(0);
  });

  it("[NHH-TRX-W2] bộ nạp gọi hàm quyết định đúng MỘT lần và dùng bộ thành phần chung", () => {
    expect(dem(nap, "phanLoaiGiaoDich(")).toBe(1);
    expect(dem(nap, "thanhPhanTheoLoaiDong(")).toBe(1);
    expect(dem(nap, "quyThucThuTheoDong(")).toBe(1);
    expect(dem(nap, "tinhPhuHuynhHienHuu(")).toBe(1);
  });

  it("[NHH-TRX-W3] bộ nạp CHỈ ĐỌC: không có phép ghi nào", () => {
    for (const ghi of [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw", "$queryRaw"]) {
      expect(dem(nap, ghi), ghi).toBe(0);
    }
  });

  it("[NHH-TRX-W4] hàm thuần không chạm DB / Prisma / đồng hồ", () => {
    expect(dem(thuan, "@/lib/db")).toBe(0);
    expect(dem(thuan, "@prisma/client")).toBe(0);
    expect(dem(thuan, "new Date(")).toBe(0);
    expect(dem(thuan, "Date.now(")).toBe(0);
  });

  it("[NHH-TRX-W5] bộ nạp nhận client qua THAM SỐ (luật 7): không import @/lib/db trần", () => {
    expect(dem(nap, "@/lib/db")).toBe(0);
    expect(dem(nap, "client: KhachDoc")).toBeGreaterThanOrEqual(3);
  });

  it("[NHH-TRX-W6] mốc 'lần mua' (`taoLuc`) của mọi dòng lấy từ Order.createdAt — không từ OrderItem.createdAt (đơn nhập tay lịch sử mang giờ NHẬP ở dòng)", () => {
    expect(dem(nap, "taoLuc: d.order.createdAt")).toBe(1); // lần mua trước của học viên
    expect(dem(nap, "taoLuc: dong.order.createdAt")).toBe(2); // dòng đang xét (cho phân loại) + dòng đang xét (cho phụ huynh hiện hữu)
    expect(dem(nap, "taoLuc: d.createdAt")).toBe(0);
    expect(dem(nap, "taoLuc: dong.createdAt")).toBe(0);
  });
});
