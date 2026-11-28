import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── LƯỚI GHIM DÂY NỐI — khối "Hoá đơn điện tử" trên trang chi tiết đơn (GĐ 7) ──────────────────────
//
// Loader + component đều có ca hành vi riêng, nhưng TRANG là chỗ quyết định loader được gọi với tham
// số nào, và trang chạm DB nên không có ca hành vi nào đứng trên nó. Ba phép cấy không làm ca nào đỏ
// nếu thiếu lưới này:
//   · thay lời gọi bằng `null`             ⇒ khối biến mất với mọi người (lỗi CÂM, luật 11);
//   · `xemPii: true`                       ⇒ email khách LỘ NGUYÊN cho vai không có `orders:view-pii`;
//   · `keToan: true`                       ⇒ nút tải hiện cho người mà route trả 404 (luật 12).
// Prop `khoiHoaDon` BẮT BUỘC ở client ⇒ quên truyền là `tsc` đỏ; lưới này không lặp việc đó.
//
// Neo vào BIỂU THỨC tham số, không neo vào chỗ đặt `await` (bài học `[NDC-07]` · `[NTC-06]`): dời lời
// gọi sang lô khác vẫn xanh, miễn luật không đổi.
describe("[KHD-W1] trang đơn nối loader khối hoá đơn đúng tham số", () => {
  const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/[id]/page.tsx"), "utf8");
  // Bỏ chú thích TRƯỚC khi khớp — chú thích giải thích bản vá thường chứa đúng chuỗi đang tìm.
  const ma = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");

  const loiGoi = [...ma.matchAll(/napKhoiHoaDonDon\(([^)]*)\)/g)];

  it("gọi loader ĐÚNG MỘT lần, gác bằng cờ `hoaDonBat`", () => {
    expect(loiGoi).toHaveLength(1);
    expect(ma).toMatch(/hoaDonBat\s*\?\s*napKhoiHoaDonDon\(/);
  });

  it("che theo `orders:view-pii` THẬT và nhánh kế toán theo `payments:confirm` THẬT", () => {
    const thamSo = loiGoi[0]?.[1] ?? "";
    expect(thamSo).toMatch(/\bxemPii:\s*canViewPii\b/);
    expect(thamSo).toMatch(/\bkeToan:\s*laKeToan\b/);
    // Hai biến trên phải là kết quả của đúng hai lời hỏi quyền đó, cùng vị trí trong lô quyền.
    const lo = ma.match(/const \[([^\]]*\bcanViewPii\b[^\]]*)\] = await Promise\.all\(\[([\s\S]*?)\]\);/);
    expect(lo, "không tìm thấy lô quyền").not.toBeNull();
    const ten = lo![1]!.split(",").map((s) => s.trim());
    const hoi = [...lo![2]!.matchAll(/checkPermission\("([^"]+)"\)|laHoaDonBat\(\)/g)].map((m) => m[1] ?? "laHoaDonBat");
    expect(hoi[ten.indexOf("canViewPii")]).toBe("orders:view-pii");
    expect(hoi[ten.indexOf("laKeToan")]).toBe("payments:confirm");
    expect(hoi[ten.indexOf("hoaDonBat")]).toBe("laHoaDonBat");
  });

  it("kết quả loader đi xuống client", () => {
    expect(ma).toMatch(/khoiHoaDon=\{khoiHoaDon\}/);
  });
});
