/**
 * Ca [QN-W6] — LƯỚI GHIM DÂY NỐI: gộp lead phải biết hai bảng nguồn (07 §2.5, §3.2).
 *
 * Vì sao là lưới mã nguồn: `gopTrongGiaoDich` quét `information_schema` mọi cột tên `leadId` và NÉM
 * khi gặp cột chưa khai ở `COT_DA_BIET` — thiếu hai dòng là `gop-lead-prod.yml` chết ngay ngày
 * migration lên prod. Còn lời gọi `gopNguonLead(` mà bị gỡ thì không ca hành vi nào ở bộ thuần đỏ
 * (gộp chạm DB). Neo vào LỜI GỌI + CHỖ ĐỨNG, không neo vào chữ trong chú thích (luật 11, luật 14).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Bóc chú thích — lưới phải soi MÃ, không soi lời kể về mã. */
function docMa(p: string): string {
  // Chú thích dòng TRƯỚC, khối SAU: chú thích dòng hay nhắc `lib/nguon/*` — chuỗi `/*` đó mà đến trước
  // sẽ mở một "khối" và nuốt mã thật phía sau.
  return doc(p)
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const DEM = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[QN-W6] gop-lead.ts nối dây nguồn lead", () => {
  const ma = docMa("lib/lead/gop-lead.ts");

  it("COT_DA_BIET khai ĐÚNG MỘT LẦN mỗi cột trỏ vào lead của hai bảng mới", () => {
    const a = ma.indexOf("const COT_DA_BIET");
    const b = ma.indexOf("]);", a);
    expect(a).toBeGreaterThan(0);
    const khoi = ma.slice(a, b);
    expect(DEM(khoi, /"LeadAttribution\.leadId"/g)).toBe(1);
    expect(DEM(khoi, /"LeadTouchpoint\.leadId"/g)).toBe(1);
  });

  it("gọi `gopNguonLead(` đúng MỘT lần, và nằm TRONG thân gopTrongGiaoDich", () => {
    expect(DEM(ma, /\bgopNguonLead\(/g)).toBe(1);
    const dau = ma.indexOf("async function gopTrongGiaoDich(");
    const cuoi = ma.indexOf("export async function gopLead(");
    const goi = ma.indexOf("gopNguonLead(");
    expect(dau).toBeGreaterThan(0);
    expect(cuoi).toBeGreaterThan(dau);
    expect(goi).toBeGreaterThan(dau);
    expect(goi).toBeLessThan(cuoi);
    expect(ma).toMatch(/import \{ gopNguonLead \} from "@\/lib\/nguon\/ghi-nguon"/);
  });

  it("ghi dấu hai bảng vào bangDoi (để bản in 'Dời:' của lead chính thấy chúng)", () => {
    expect(ma).toMatch(/bangDoi\.LeadTouchpoint\s*=/);
    expect(ma).toMatch(/bangDoi\.LeadAttribution\s*=/);
  });

  it("[F1] cột 'inheritedFromLeadId' nằm CẢ trong mẫu quét information_schema LẪN trong COT_DA_BIET (mỗi nơi đúng 1 lần)", () => {
    const a = ma.indexOf("const COT_DA_BIET");
    const b = ma.indexOf("]);", a);
    expect(DEM(ma.slice(a, b), /"LeadAttribution\.inheritedFromLeadId"/g)).toBe(1);
    // Mẫu quét: một câu `column_name IN (...)` duy nhất, có đủ bốn tên.
    const quet = [...ma.matchAll(/column_name IN \(([^)]*)\)/g)].map((m) => m[1]!);
    expect(quet).toHaveLength(1);
    for (const ten of ["leadId", "primaryLeadId", "leadChildId", "inheritedFromLeadId"]) {
      expect(quet[0], ten).toContain(`'${ten}'`);
    }
    // Không khai nhầm cột KHÔNG trỏ Lead: `leadDuplicateId` trỏ LeadDuplicate.id (không FK).
    expect(ma).not.toMatch(/leadDuplicateId/);
  });

  it("[F1] bangDoi.LeadAttributionKeThua lấy từ kết quả gopNguonLead (không tự tính lại ở chỗ gọi)", () => {
    expect(ma).toMatch(/bangDoi\.LeadAttributionKeThua\s*=\s*nguon\.keThuaDoi\b/);
  });
});

describe("[F1] ghi-nguon.ts: gopNguonLead đổi tham chiếu kế thừa SAU khi quy nguồn đã dời xong", () => {
  const ma = docMa("lib/nguon/ghi-nguon.ts");
  const i0 = ma.indexOf("async function doiThamChieuKeThua(");
  const i1 = ma.indexOf("export async function gopNguonLead(");
  const i2 = ma.indexOf("async function gopQuyNguon(");

  it("tìm được các hàm (chống lưới quét rỗng)", () => {
    expect(i0).toBeGreaterThan(0);
    expect(i1).toBeGreaterThan(i0);
    expect(i2).toBeGreaterThan(i1);
  });

  it("doiThamChieuKeThua: đúng 2 updateMany trên inheritedFromLeadId — NULL cho dòng của chính, rồi trỏ sang chính cho lead KHÁC", () => {
    const than = ma.slice(i0, i1);
    expect(DEM(than, /\.leadAttribution\.updateMany\(/g)).toBe(2);
    expect(than).toMatch(/where:\s*\{\s*leadId:\s*chinhId,\s*inheritedFromLeadId:\s*\{\s*in:\s*\[phuId,\s*chinhId\]\s*\}\s*\}/);
    expect(than).toMatch(/data:\s*\{\s*inheritedFromLeadId:\s*null\s*\}/);
    expect(than).toMatch(/where:\s*\{\s*inheritedFromLeadId:\s*phuId,\s*leadId:\s*\{\s*not:\s*chinhId\s*\}\s*\}/);
    expect(than).toMatch(/data:\s*\{\s*inheritedFromLeadId:\s*chinhId\s*\}/);
  });

  it("gopNguonLead gọi gopQuyNguon TRƯỚC rồi doiThamChieuKeThua (đúng một lần mỗi hàm)", () => {
    const than = ma.slice(i1, i2);
    expect(DEM(than, /\bgopQuyNguon\(/g)).toBe(1);
    expect(DEM(than, /\bdoiThamChieuKeThua\(/g)).toBe(1);
    expect(than.indexOf("gopQuyNguon(")).toBeLessThan(than.indexOf("doiThamChieuKeThua("));
    expect(than).toMatch(/keThuaDoi/);
  });
});
