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

  it("[BC-GOP-01] `CommissionAdjustmentRequest.leadId` (đề xuất điều chỉnh, hướng B+C) khai ĐÚNG MỘT lần là ẢNH CHỤP — KHAI nhưng KHÔNG đổi, y như `CommissionTransaction.leadId`", () => {
    // Cột này KHÔNG có khoá ngoại (đọc để hiển thị + tính lại cảnh báo gian lận); lead phụ bị gộp chỉ bị xoá MỀM nên đọc vẫn được. Quên khai ⇒ `gop-lead` ném «Có cột trỏ vào lead mà hàm gộp chưa biết» (10 ca DB đỏ, đo 16/10/2026).
    const a = ma.indexOf("const COT_DA_BIET");
    const b = ma.indexOf("]);", a);
    expect(DEM(ma.slice(a, b), /"CommissionAdjustmentRequest\.leadId"/g)).toBe(1);
    // không có `updateMany` nào của bảng đề xuất trong hàm gộp: ảnh chụp không bị ghi đè
    expect(ma).not.toMatch(/commissionAdjustmentRequest\.(update|updateMany)\(/);
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

describe("[GHH-W] gộp lead báo cổng duyệt đổi nguồn sau thu (08 §17.v6.nguon)", () => {
  // Hành vi đã có ca DB (`tests/hoa-hong/gop-lead-doi-nguon-sau-thu.spec.ts`, [GHH-01..06]) — bộ THUẦN này giữ phần DÂY NỐI mà ca DB chỉ phủ khi có Postgres.
  const nguon = docMa("lib/nguon/ghi-nguon.ts");
  const gop = docMa("lib/lead/gop-lead.ts");
  const dau = nguon.indexOf("export async function gopNguonLead(");
  const cuoi = nguon.indexOf("async function gopQuyNguon(");

  it("[GHH-W1] ghi-nguon.ts phát `nguon.da-doi-sau-thanh-toan` ĐÚNG MỘT lần, bằng hằng chuỗi nguyên văn, CÙNG transaction (`tx`) và có `dedupeKey`", () => {
    expect(DEM(nguon, /publishEvent\(\s*"nguon\.da-doi-sau-thanh-toan"/g)).toBe(1);
    const khoi = nguon.slice(nguon.indexOf("async function baoDoiNguonKhiGop("), nguon.indexOf("export async function gopNguonLead("));
    expect(khoi.length).toBeGreaterThan(0);
    expect(khoi).toMatch(/\{\s*tx,\s*dedupeKey:/);
  });

  it("[GHH-W2] gopNguonLead GỌI baoDoiNguonKhiGop đúng một lần, SAU gopQuyNguon, mang đủ actorId + phuCoTienThuc", () => {
    expect(dau).toBeGreaterThan(0);
    expect(cuoi).toBeGreaterThan(dau);
    const than = nguon.slice(dau, cuoi);
    expect(DEM(than, /\bbaoDoiNguonKhiGop\(/g)).toBe(1);
    expect(than.indexOf("gopQuyNguon(")).toBeLessThan(than.indexOf("baoDoiNguonKhiGop("));
    expect(than).toMatch(/baoDoiNguonKhiGop\(tx,\s*\{[^}]*\bactorId\b[^}]*\bphuCoTienThuc\b[^}]*\}\)/);
  });

  it("[GHH-W3] gop-lead.ts đo tiền của lead PHỤ TRƯỚC khi đơn dời (`Order.updateMany`) và truyền actorId xuống gopNguonLead", () => {
    const iDo = gop.indexOf("const phuCoTienThuc =");
    const iDoi = gop.indexOf("Order: (await tx.order.updateMany(w)).count");
    expect(iDo).toBeGreaterThan(0);
    expect(iDoi).toBeGreaterThan(iDo);
    expect(gop).toMatch(/payment\.count\(\{[^}]*order:\s*\{\s*leadId:\s*phuId\b/);
    expect(gop).toMatch(/gopNguonLead\(tx,\s*\{[^}]*\bactorId:\s*actorUserId\b[^}]*\bphuCoTienThuc\b[^}]*\}\)/);
  });
});
