// @vitest-environment node
/**
 * [GOP-TT] Mã `main` phải CHỊU ĐƯỢC schema có bảng AI Lead TRƯỚC khi mã AI Lead lên (expand → contract).
 *
 * Sự cố đã đo (30/10/2026): `gopTrongGiaoDich` hỏi `information_schema` mọi cột `leadId` / `primaryLeadId` / `leadChildId` / `inheritedFromLeadId` rồi NÉM
 * "Có cột trỏ vào lead mà hàm gộp chưa biết: AiLeadDraft.leadId" nếu cột lạ không nằm trong `COT_DA_BIET`. Migration AI Lead thêm đúng cột đó
 * (`AiLeadDraft.leadId`, cột trần, không FK) ⇒ từ lúc áp migration tới lúc mã mới chạy — và SAU KHI lùi mã mà schema đã áp — mã cũ từ chối MỌI lượt gộp lead
 * (kể cả chạy thử, gộp theo "đổi nguồn sau thu", script ghi công, gộp referral Affiliate). Từ chối xảy ra TRƯỚC mọi phép ghi (chỉ có phép đọc đứng trước
 * dòng ném) nên không mất dữ liệu — nhưng nghiệp vụ gộp lead đứng.
 *
 * Cách vá ĐÚNG là KHAI cột (như `Student.leadId`), KHÔNG phải gỡ lưới "cột lạ": lưới ấy là thứ chặn một cột trỏ lead mới bị bỏ sót và để mồ côi.
 *
 * Test đọc mã nguồn (DB CI của `main` chưa có bảng AI Lead nên ca DB không bắt được; ca DB nằm ở tests/lead-intake/gop-lead.spec.ts [GOP-AIL] trên `test`).
 * Cấy lỗi: gỡ `"AiLeadDraft.leadId"` khỏi `COT_DA_BIET` ⇒ đỏ [GOP-TT-01]; gỡ nhánh dời ⇒ đỏ [GOP-TT-02]; gỡ lưới cột lạ ⇒ đỏ [GOP-TT-03].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const src = boChuThich(readFileSync(resolve(process.cwd(), "lib/lead/gop-lead.ts"), "utf8").split("\r\n").join("\n"));
const demKhop = (re: RegExp) => (src.match(re) ?? []).length;

describe("[GOP-TT] gộp lead chịu được cột AiLeadDraft.leadId (mã cũ trên schema mới)", () => {
  it("[GOP-TT-01] COT_DA_BIET khai đúng MỘT lần \"AiLeadDraft.leadId\"", () => {
    const a = src.indexOf("const COT_DA_BIET = new Set([");
    const b = src.indexOf("]);", a);
    expect(a, "không tìm thấy COT_DA_BIET").toBeGreaterThan(-1);
    const khoi = src.slice(a, b);
    expect((khoi.match(/"AiLeadDraft\.leadId"/g) ?? []).length).toBe(1);
  });

  it("[GOP-TT-02] cột có mặt ⇒ hồ sơ AI trỏ lead PHỤ được dời sang lead CHÍNH (một phép UPDATE, gác bằng `cot.has`)", () => {
    expect(demKhop(/cot\.has\("AiLeadDraft\.leadId"\)/g)).toBe(1);
    expect(demKhop(/UPDATE "AiLeadDraft" SET "leadId" = \$\{chinhId\} WHERE "leadId" = \$\{phuId\}/g)).toBe(1);
    expect(src.indexOf('cot.has("AiLeadDraft.leadId")')).toBeLessThan(src.indexOf('UPDATE "AiLeadDraft"'));
  });

  it("[GOP-TT-03] lưới \"cột lạ\" VẪN CÒN (vá bằng khai cột, không bằng gỡ lưới)", () => {
    expect(demKhop(/!COT_DA_BIET\.has\(c\)/g)).toBe(1);
    expect(demKhop(/throw new Error\(`Có cột trỏ vào lead mà hàm gộp chưa biết/g)).toBe(1);
  });

  it("[GOP-TT-04] lưới \"cột lạ\" đứng TRƯỚC mọi phép ghi trong thân `gopTrongGiaoDich` (từ chối không để lại gì)", () => {
    // Chỉ xét THÂN hàm: các hàm phụ phía trên (`doiThamChieuBe`…) có phép ghi nhưng chỉ chạy SAU khi lưới đã qua.
    const than = src.slice(src.indexOf("async function gopTrongGiaoDich("));
    expect(than.length).toBeGreaterThan(100);
    const luoi = than.indexOf("const cot = await cotTroVaoLead(tx);");
    const ghi = [...than.matchAll(/tx\.(?:leadChild|order|lead|enrollment)\.(?:update|updateMany|delete|create)\(|tx\.\$executeRaw/g)].map((m) => m.index!);
    expect(luoi).toBeGreaterThan(-1);
    expect(ghi.length, "phải thấy các phép ghi của thân hàm (chống rỗng)").toBeGreaterThan(3);
    expect(luoi, "lưới cột lạ phải đứng trước phép ghi đầu tiên").toBeLessThan(Math.min(...ghi));
  });
});
