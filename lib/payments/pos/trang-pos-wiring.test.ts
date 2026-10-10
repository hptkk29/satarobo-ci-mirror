// [POS-NAV-01] · [POS-PII-01] — LƯỚI GHIM MÃ NGUỒN cho màn `/bien-dong-so-du`. THUẦN.
//
// [POS-NAV-01] Kế toán HO (vai DUY NHẤT ngoài Quản trị tối cao có `payments:import-pos`) phải có
//   lối vào tab "Máy POS": mục sidebar "Cấu hình vận hành" gác `settings:view` (chỉ SUPER_ADMIN).
//   Mã TRƯỚC bản vá: `grep -n "may-pos" app/(admin)/admin/bien-dong-so-du/` ra 0 dòng. Đối chứng
//   dương: cổng của tab đúng là quyền vẽ khối nút import (`QUYEN_TAB["may-pos"]`).
//
// [POS-PII-01] Mọi select lồng `order { … customerName … }` trên trang phải đi qua
//   `passesScope("Order", …)` trước khi tới client. Mã TRƯỚC bản vá dựa vào chú thích "phân bổ
//   luôn thuộc cùng đơn/cơ sở" — sai với giao dịch thẻ (cơ sở của MÁY) và với dòng POS NULL.
//
// Bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang tìm).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEP = "app/(admin)/admin/bien-dong-so-du/page.tsx";

function bocChuThich(v: string): string {
  return v
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}

const ma = bocChuThich(readFileSync(resolve(process.cwd(), TEP), "utf8"));
const dem = (re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;

describe("[POS-TRANG] dây nối màn biến động số dư", () => {
  it("[POS-NAV-01] có ĐÚNG MỘT lối vào tab Máy POS, nằm trong khối gác canImportPos", () => {
    expect(dem(/href="\/cau-hinh-van-hanh\?tab=may-pos"/)).toBe(1);
    const khoi = ma.match(/\{canImportPos && \(([\s\S]*?)\n {8}\)\}/)?.[1] ?? "";
    expect(khoi, "lối vào phải nằm trong khối {canImportPos && (…)}").toContain('href="/cau-hinh-van-hanh?tab=may-pos"');
  });

  it("[POS-NAV-01b] đối chứng: cổng của tab Máy POS đúng là quyền vẽ khối đó", () => {
    const nhan = readFileSync(resolve(process.cwd(), "lib/settings/nhan-van-hanh.ts"), "utf8");
    expect(nhan).toMatch(/"may-pos"\s*:\s*"payments:import-pos"/);
    expect(dem(/checkPermission\("payments:import-pos"\)/)).toBe(1);
  });

  it("[POS-PII-01] mỗi select lồng lấy customerName có một lượt passesScope(\"Order\") tương ứng", () => {
    const soSelectTen = dem(/order:\s*\{\s*select:\s*\{[^}]*customerName:\s*true[^}]*\}/);
    expect(soSelectTen, "số select lồng order{customerName}").toBe(2);
    expect(dem(/passesScope\("Order",/)).toBe(soSelectTen);
    // centerId phải được select — thiếu nó `passesScope` đọc undefined và chặn/cho sai.
    expect(dem(/order:\s*\{\s*select:\s*\{[^}]*customerName:\s*true[^}]*centerId:\s*true/)).toBe(2);
  });
});
