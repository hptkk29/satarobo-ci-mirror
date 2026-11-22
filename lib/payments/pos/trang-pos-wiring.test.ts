// [POS-NAV-01] · [POS-PII-01] — LƯỚI GHIM MÃ NGUỒN cho màn `/bien-dong-so-du`. THUẦN.
//
// [POS-NAV-01] Kế toán HO (vai DUY NHẤT ngoài Quản trị tối cao có `payments:import-pos`) phải có
//   lối vào chỗ khai máy POS KHÔNG qua sidebar. Lý do gốc (29/09) ghi "mục sidebar 'Cấu hình vận hành' gác `settings:view`" — đã cũ từ 25/09
//   (sidebar suy quyền từ `QUYEN_TAB`); từ 09/10 `import-pos` rời `QUYEN_TAB`, và trên PROD "menu gọn" ẩn nốt mục "Cơ sở" của Kế toán HO,
//   nên link này là đường còn lại (docs/pos-hai-nut-khai-may.md §2.10 mục 2).
//   Mã TRƯỚC bản vá: `grep -n "may-pos" app/(admin)/admin/bien-dong-so-du/` ra 0 dòng. Đối chứng
//   dương: lối vào nằm đúng trong khối vẽ bởi quyền import.
//   09/10/2026 (Việc 2): chỗ khai máy DỜI từ tab "Máy POS" về mục "Máy POS quẹt thẻ" của màn Cơ sở ⇒ lối vào nay là
//   `/centers`. Đích đến đó đòi `centers:view` nên link còn gác thêm quyền ấy — phần này khoá ở `[HN2-MP-W06]`.
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
  it("[POS-NAV-01] có ĐÚNG MỘT lối vào chỗ khai máy POS (màn Cơ sở), nằm trong khối gác canImportPos", () => {
    expect(dem(/href="\/centers"/)).toBe(1);
    expect(dem(/href="\/cau-hinh-van-hanh/), "không còn trỏ về Cấu hình vận hành").toBe(0);
    const khoi = ma.match(/\{canImportPos && \(([\s\S]*?)\n {8}\)\}/)?.[1] ?? "";
    expect(khoi, "lối vào phải nằm trong khối {canImportPos && (…)}").toContain('href="/centers"');
  });

  it("[POS-NAV-01b] đối chứng: khối đó vẫn vẽ bởi ĐÚNG quyền import (`payments:import-pos`, hỏi một lần) — và tab 'Máy POS' không còn trong sổ quyền tab", () => {
    const nhan = readFileSync(resolve(process.cwd(), "lib/settings/nhan-van-hanh.ts"), "utf8");
    expect(nhan).not.toMatch(/"may-pos"\s*:\s*"payments:import-pos"/);
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
