// Lưới ghim dây nối: GHI CHÚ của mã giảm (`Voucher.description`) phải đi từ DB tới form tạo đơn. Loader chạm DB nên test hành vi thuần
// không thấy được chỗ đứt — quên `select description` là ghi chú biến mất IM LẶNG ở mọi cơ sở (không lỗi, không ca nào đỏ).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("[GCM-W] ghi chú mã giảm: DB → loader → form", () => {
  it("[GCM-W1] loader chọn `description` của Voucher và gán vào `ghiChu` (đã trim, rỗng ⇒ null)", () => {
    const s = doc("lib/khuyen-mai/chon-cho-don.ts");
    expect(s).toMatch(/code:\s*true,\s*description:\s*true,/);
    expect(s).toMatch(/ghiChu:\s*v\.description\?\.trim\(\)\s*\|\|\s*null/);
  });
  it("[GCM-W2] form vẽ dòng «Ghi chú:» từ `maDangChon.ghiChu`, đứng TRƯỚC khối ưu đãi/điều kiện", () => {
    const s = doc("app/(admin)/admin/orders/_components/order-create-form.tsx");
    const a = s.indexOf('data-testid="ghi-chu-ma-giam"');
    const b = s.indexOf('data-testid="ghi-chu-chuong-trinh"');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(s).toMatch(/maDangChon\?\.ghiChu\s*&&/);
  });
});
