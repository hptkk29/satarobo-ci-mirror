// @vitest-environment node
/**
 * [BCN-W*] LƯỚI DÂY NỐI — hai dashboard có biểu đồ «Nguồn lead» phải đọc nhóm nguồn nghiệp vụ khi cờ Nguồn BẬT (audit X · GAP 5A).
 *
 * Hành vi của `docLeadTheoNguon` được chứng minh bằng Postgres thật ở `tests/lead-intake/bao-cao-nguon.spec.ts`. Thứ chỉ lưới này canh: lời gọi CÓ NỐI vào hai trang, và cờ TẮT vẫn giữ đường cũ
 * (`Lead.source`). Gỡ lời gọi thì không test hành vi nào đỏ — biểu đồ lặng lẽ quay về nhãn kênh kỹ thuật.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1");

const TRANG = ["app/(admin)/admin/crm/page.tsx", "app/(admin)/admin/dashboard/_components/marketing-hr-dashboards.tsx"] as const;

describe("[BCN-W] dashboard «Nguồn lead» đi qua docLeadTheoNguon khi cờ Nguồn bật", () => {
  it("[BCN-W1] mỗi trang gọi docLeadTheoNguon đúng MỘT lần, sau cổng laQuanLyNguonBat()", () => {
    for (const f of TRANG) {
      const ma = doc(f);
      expect((ma.match(/docLeadTheoNguon\(/g) ?? []).length, f).toBe(1);
      expect((ma.match(/laQuanLyNguonBat\(\)/g) ?? []).length, f).toBe(1);
      // Thứ tự «cờ trước, đọc sau» chỉ đúng ở CRM (một biểu thức); ở widget cờ được đọc ở MarketingDashboard rồi truyền xuống — [BCN-W3] canh dây đó.
      if (f === TRANG[0]) expect(ma.indexOf("laQuanLyNguonBat()"), f).toBeLessThan(ma.indexOf("docLeadTheoNguon("));
    }
  });

  it("[BCN-W3] ĐÚNG NHÁNH: cờ BẬT ⇒ nhóm nguồn, cờ TẮT ⇒ đường `Lead.source` cũ — và KẾT QUẢ được dùng (review 26/10: đảo cờ / `|| true` / vứt kết quả đều từng qua lưới)", () => {
    // CRM: `(await laQuanLyNguonBat()) ? (await docLeadTheoNguon(sdb, …)).map(…) : bySource…` — cờ KHÔNG đảo, nhánh đúng chiều.
    const crm = doc(TRANG[0]);
    expect((crm.match(/const sourceData = \(await laQuanLyNguonBat\(\)\)\s*\?\s*\(await docLeadTheoNguon\(sdb, \{ toiDa: 8 \}\)\)\.map\(\(d\) => \(\{ source: d\.ten, count: d\.soLead \}\)\)\s*:\s*bySource/g) ?? []).length).toBe(1);
    // Widget: cờ đọc MỘT lần ở MarketingDashboard, vào khoá cache, truyền xuống; `theoNguon` chỉ khi cờ bật và LÀ thứ được trả (`theoNguon ?? bySource…`).
    const w = doc(TRANG[1]);
    expect((w.match(/const nguonBat = await laQuanLyNguonBat\(\);/g) ?? []).length).toBe(1);
    expect((w.match(/getMarketingStats\(actor, nguonBat\)/g) ?? []).length).toBe(1);
    expect((w.match(/nguonBat \? "theo-nguon" : "theo-kenh"/g) ?? []).length).toBe(1);
    expect((w.match(/const theoNguon = nguonBat \? \(await docLeadTheoNguon\(sdb, \{ toiDa: 8 \}\)\)\.map\(/g) ?? []).length).toBe(1);
    expect((w.match(/bySource: theoNguon \?\? bySource\.map\(/g) ?? []).length).toBe(1);
    expect((w.match(/nguonBat \? "Nguồn lead theo nguồn" : "Nguồn lead theo kênh"/g) ?? []).length).toBe(1);
  });

  it("[BCN-W2] cờ TẮT giữ đường cũ: groupBy theo `source` vẫn còn ở cả hai trang (đối chứng — không gỡ nhầm)", () => {
    for (const f of TRANG) expect(doc(f), f).toMatch(/by:\s*\[\s*"source"\s*\]/);
  });
});
