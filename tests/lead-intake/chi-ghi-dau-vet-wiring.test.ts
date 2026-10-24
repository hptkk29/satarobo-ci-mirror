/**
 * LƯỚI DÂY NỐI [CGD-W1] — mọi chỗ gọi `ingestIntakeLead(` ở mã chạy thật phải KHAI TƯỜNG MINH `chiGhiDauVetKhiTrung`.
 *
 * Vì sao: trường này tuỳ chọn ở kiểu (60 ca test gọi trực tiếp), mà mặc định của nó (`undefined` ⇒ gộp vào hồ sơ có sẵn) là mặc định NGUY HIỂM cho một đường
 * ẨN DANH — biết SĐT phụ huynh là đủ để nhét con lạ / ghi chú tuỳ ý vào hồ sơ của họ và spam thông báo Sale (reviewer Bảo mật 14/10/2026, HIGH). Luật 7 đòi bỏ
 * mặc định; vì tsc không canh được khi trường tuỳ chọn, lưới này thay vai đó: thêm một chỗ gọi mới mà quên khai là ĐỎ.
 *
 * Đọc mã, không chạm DB — chạy trong `pnpm test:unit` (vitest.config.ts đã include thư mục tests/lead-intake).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(process.cwd());
const THU_MUC = ["app", "lib"];

function duyet(dir: string, ra: string[]): void {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (ten === "node_modules" || ten === ".next") continue;
      duyet(p, ra);
    } else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.(ts|tsx)$/.test(ten)) ra.push(p);
  }
}

function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("[CGD-W1] ingestIntakeLead — mọi chỗ gọi khai tường minh chiGhiDauVetKhiTrung", () => {
  const tep: string[] = [];
  for (const d of THU_MUC) duyet(join(GOC, d), tep);

  const chuaGoi = tep
    .map((p) => ({ p, ma: boChuThich(readFileSync(p, "utf8")) }))
    // chỗ GỌI = `ingestIntakeLead(` không phải khai báo hàm và không phải import
    .filter(({ ma }) => /(?<!function\s)(?<!async function\s)\bingestIntakeLead\s*\(/.test(ma) && !/export\s+async\s+function\s+ingestIntakeLead\s*\(/.test(ma));

  it("tìm thấy đủ 6 chỗ gọi đã biết (nếu số đổi: thêm/bớt nơi gọi ⇒ rà lại cờ ẩn danh)", () => {
    const ten = chuaGoi.map(({ p }) => relative(GOC, p).split(sep).join("/")).sort();
    expect(ten).toEqual(
      [
        "app/api/public/lead-intake/sale-form/route.ts",
        "app/api/public/webhook/quatang/route.ts",
        "lib/affiliate/intake-cong-khai.ts",
        "lib/crm/webhook-replay.ts",
        "lib/lead/ingest.ts",
        "lib/lead/intake/quick-form-action.ts",
      ].sort(),
    );
  });

  it("mỗi chỗ gọi mang đúng MỘT khai `chiGhiDauVetKhiTrung: true|false`", () => {
    for (const { p, ma } of chuaGoi) {
      const khai = ma.match(/chiGhiDauVetKhiTrung\s*:\s*(true|false)\b/g) ?? [];
      expect(khai.length, relative(GOC, p)).toBe(1);
    }
  });

  it("đường ẨN DANH duy nhất đặt `true` là intake Affiliate; mọi nguồn có chữ ký / đăng nhập đặt `false`", () => {
    const theoTep = new Map(chuaGoi.map(({ p, ma }) => [relative(GOC, p).split(sep).join("/"), /chiGhiDauVetKhiTrung\s*:\s*true\b/.test(ma)] as const));
    expect(theoTep.get("lib/affiliate/intake-cong-khai.ts")).toBe(true);
    for (const [ten, coTrue] of theoTep) if (ten !== "lib/affiliate/intake-cong-khai.ts") expect(coTrue, ten).toBe(false);
  });
});
