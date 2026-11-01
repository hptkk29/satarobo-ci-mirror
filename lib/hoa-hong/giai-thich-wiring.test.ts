// @vitest-environment node
/**
 * [GTK-W*] — LƯỚI GHIM MÃ NGUỒN cho «vì sao 0đ» (Hướng G): những luật có dạng «lời gọi này phải có mặt / chỗ này không được xuất hiện» mà test hành vi KHÔNG chứng minh được.
 *
 * Vì sao cần: `ghiGiaiThich` được gọi từ `quet-khoan.ts` (chạm DB) — gỡ lời gọi đi thì không test thuần nào đỏ, và test DB chỉ đỏ khi có Postgres. Lưới neo vào LỜI GỌI `ghiGiaiThich(` (không
 * neo vào dòng `import`: gỡ lời gọi mà quên gỡ import là đúng ca luật 14 đã bắt ở S-1), đếm SỐ LẦN khớp, và đọc mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BACKFILL_SPECS } from "@/lib/org/center-bridge";
import { SCOPED_MODELS, getModelPrefixes } from "@/lib/db-scope";

const doc = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Bỏ chú thích dòng và chú thích khối, nhưng KHÔNG đụng chuỗi (đủ cho các tệp này: không có dấu chú thích trong chuỗi ký tự cần đo). */
function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/ .*$/, "")))
    .join("\n");
}
const dem = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

/** Cắt thân hàm theo tên (từ `function <ten>(` đến chỗ bắt đầu hàm top-level kế tiếp) trên mã đã bỏ chú thích. */
function thanHam(src: string, ten: string): string {
  const a = src.search(new RegExp(`(?:async )?function ${ten}\\(`));
  expect(a, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const sau = src.slice(a + 10).search(/\n(?:export )?(?:async )?function |\nexport (?:type|const) /);
  return sau < 0 ? src.slice(a) : src.slice(a, a + 10 + sau);
}

const QUET = boChuThich(doc("lib/hoa-hong/quet-khoan.ts"));

describe("[GTK-W1] `ghiGiaiThich(` được gọi ĐÚNG HAI LẦN trong quet-khoan.ts — mỗi lần trong đúng một hàm ghi ô", () => {
  it("tổng 2 lời gọi (không tính dòng import); một ở ghiMoiThu, một ở soVoiOThu", () => {
    expect(dem(QUET, /\bghiGiaiThich\(/g)).toBe(2);
    expect(dem(thanHam(QUET, "ghiMoiThu"), /\bghiGiaiThich\(/g)).toBe(1);
    expect(dem(thanHam(QUET, "soVoiOThu"), /\bghiGiaiThich\(/g)).toBe(1);
  });
  it("lời gọi ở ghiMoiThu đứng SAU `h.taoO(` (cần id ô) và TRƯỚC lúc giao dịch trả kết quả; ở soVoiOThu đứng SAU `danhDauOKhop(` (cần biết hash đã được chấp nhận)", () => {
    const moi = thanHam(QUET, "ghiMoiThu");
    expect(moi.indexOf("h.taoO(")).toBeGreaterThan(-1);
    expect(moi.indexOf("ghiGiaiThich(")).toBeGreaterThan(moi.indexOf("h.taoO("));
    expect(moi.indexOf("ghiGiaiThich(")).toBeLessThan(moi.indexOf("return { loai: \"DA_GHI\""));
    const so = thanHam(QUET, "soVoiOThu");
    expect(so.indexOf("ghiGiaiThich(")).toBeGreaterThan(so.indexOf("await danhDauOKhop("));
  });
  it("hai lời gọi truyền ĐỦ cổng bắt buộc: `hashDuocChapNhan` · `coDrift` · `rong` (luật 7 — quên một cổng là lỗi biên dịch, nên lưới chỉ ghim GIÁ TRỊ truyền)", () => {
    const moi = thanHam(QUET, "ghiMoiThu");
    expect(moi).toMatch(/ghiGiaiThich\(tx, \{[^}]*hashDuocChapNhan: true[^}]*coDrift: false[^}]*rong: new Map\(\)/);
    const so = thanHam(QUET, "soVoiOThu");
    expect(so).toMatch(/hashDuocChapNhan: o\.hashDaChapNhan\.has\(hashMoi\) \|\| capNhatHash === hashMoi/);
    expect(so).toMatch(/coDrift: holds\.some\(\(x\) => x\.code === "INPUT_DRIFT"\)/);
    expect(so).toMatch(/rong: o\.rong/);
    expect(so).toMatch(/netBase: o\.netBase/);
  });
});

describe("[GTK-W2] bảng mới khai đủ BA chỗ (luật Nền #3): SCOPED_MODELS · getModelPrefixes · BACKFILL_SPECS", () => {
  it("SCOPED_MODELS có mặt; tiền tố giống sổ (`commission:`); BACKFILL_SPECS có và nói rõ centerId BẮT BUỘC", () => {
    expect(SCOPED_MODELS.has("CommissionExplainLine")).toBe(true);
    expect(getModelPrefixes("CommissionExplainLine")).toEqual(getModelPrefixes("CommissionTransaction"));
    expect(getModelPrefixes("CommissionExplainLine")).toContain("commission:");
    const spec = BACKFILL_SPECS.find((s) => s.model === "CommissionExplainLine");
    expect(spec, "thiếu BACKFILL_SPECS").toBeDefined();
    expect(spec).toMatchObject({ nullMeaning: "BAT_BUOC", scoped: true });
  });
  it("schema.prisma và migration cùng khai bảng với CẢ HAI cột đơn vị và khoá UNIQUE đặt tên tay", () => {
    const schema = doc("prisma/schema.prisma");
    const khoi = schema.slice(schema.indexOf("model CommissionExplainLine {"));
    const than = khoi.slice(0, khoi.indexOf("\n}\n"));
    expect(than).toMatch(/\n\s+centerId\s+String\n/);
    expect(than).toMatch(/\n\s+orgUnitId\s+String\n/);
    expect(than).toContain('map: "CommissionExplainLine_khoa_key"');
    expect(than).not.toMatch(/\bleadId\b/); // không có leadId ⇒ không phải khai ở COT_DA_BIET của gop-lead
  });
});

describe("[GTK-W3] giải thích KHÔNG BAO GIỜ chạm sổ: không dòng sổ nào, không dòng 0đ, chỉ INSERT … ON CONFLICT DO NOTHING", () => {
  const GHI = boChuThich(doc("lib/hoa-hong/giai-thich-db.ts"));
  const THUAN = boChuThich(doc("lib/hoa-hong/giai-thich-khong-tien.ts"));
  it("hai tệp ghi/dựng giải thích không nhắc tới bảng sổ (`commissionTransaction`) lần nào", () => {
    expect(dem(GHI, /commissionTransaction/g)).toBe(0);
    expect(dem(THUAN, /commissionTransaction/g)).toBe(0);
  });
  it("ghi bằng `createMany({ skipDuplicates: true })` đúng MỘT chỗ; không `.create(` / `.update(` / `.upsert(` / `.delete` trên bảng giải thích (bảng chỉ-thêm)", () => {
    expect(dem(GHI, /commissionExplainLine\.createMany\(/g)).toBe(1);
    expect(dem(GHI, /skipDuplicates: true/g)).toBe(1);
    expect(GHI).not.toMatch(/commissionExplainLine\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
  });
  it("toàn lib/hoa-hong không có `commissionTransaction.create…` với `amount: 0`", () => {
    for (const p of ["lib/hoa-hong/quet-khoan.ts", "lib/hoa-hong/ghi-so.ts", "lib/hoa-hong/dieu-chinh.ts"]) {
      expect(boChuThich(doc(p)), p).not.toMatch(/commissionTransaction\.(create|createMany)\([^)]*amount:\s*0\b/);
    }
  });
  it("migration chỉ-thêm: đúng một bảng được TẠO, chỉ tác động bảng của mình, không DROP, RLS bật (không FORCE), trigger chặn UPDATE/DELETE", () => {
    const sql = doc("prisma/migrations/20261016130000_hoa_hong_giai_thich_khong_tien/migration.sql").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(dem(sql, /CREATE TABLE IF NOT EXISTS "/g)).toBe(1);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "CommissionExplainLine"');
    expect([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(expect.arrayContaining(["CommissionExplainLine"]));
    expect([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].every((m) => m[1] === "CommissionExplainLine")).toBe(true);
    expect(sql).not.toMatch(/\bDROP (TABLE|COLUMN|CONSTRAINT)\b|\bTRUNCATE\b|\bDELETE FROM\b|\bUPDATE "/);
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "CommissionExplainLine"/);
    expect(sql).toContain('CHECK ("wouldBeAmount" >= 0)');
  });
});

describe("[GTK-W4] giải thích KHÔNG phải đầu vào của hash (tránh INPUT_DRIFT giả ở mọi ô cũ)", () => {
  it("thân `hashCuaKetQua` không nhắc `cuaSo` (ba số của cửa sổ), `giaiThich`, `nguoiDuKien`, `kq.treo` (trường `treo:` = `lyDoTreo` là đầu vào có sẵn của hash)", () => {
    const than = thanHam(QUET, "hashCuaKetQua");
    expect(than).toContain("ngoaiCuaSo: kh.ngoaiCuaSo"); // đối chứng dương: tìm đúng hàm, đúng chỗ
    expect(than).not.toMatch(/\bcuaSo\b|giaiThich|nguoiDuKien|\bkq\.treo\b/);
  });
});

describe("[GTK-W5] mọi hàm ĐỌC bảng giải thích đều đi qua cổng phạm vi người xem", () => {
  const DOC = boChuThich(doc("lib/hoa-hong/giai-thich-doc.ts"));
  it("cổng dựng từ `phamViNguoiXem(actor)` — MỘT nguồn với sổ — và không tự gõ khoá quyền", () => {
    expect(dem(DOC, /\bphamViNguoiXem\(actor\)/g)).toBe(1);
    expect(DOC).not.toMatch(/"commission:view/); // khoá quyền chỉ nằm ở doc-so.ts (KEY_XEM_RIENG / KEY_XEM_CO_SO)
  });
  it("mỗi hàm export có `commissionExplainLine.` trong thân thì cũng có `dieuKienGiaiThich(`", () => {
    const hamExport = DOC.split(/\nexport (?=async function )/).slice(1);
    const coDoc = hamExport.filter((h) => /commissionExplainLine\./.test(h));
    expect(coDoc.length).toBeGreaterThanOrEqual(6); // docGiaiThichKhongTien · TheoId · CuaO · dem · tomTat · docLuaChon
    for (const h of coDoc) expect(h.slice(0, 80), h.slice(0, 60)).toMatch(/\w+/);
    for (const h of coDoc) expect(h, h.slice(0, 60)).toMatch(/dieuKienGiaiThich\(actor\)/);
  });
});

describe("[GTK-W6] cửa vào giao diện: Server Action gác ĐÚNG hai khoá của tab, TRƯỚC khi đọc; trang truyền công tắc ở MỌI chỗ vẽ", () => {
  const ACTIONS = boChuThich(doc("app/(admin)/admin/nguon-hoa-hong/so/_actions.ts"));
  const PAGE = boChuThich(doc("app/(admin)/admin/nguon-hoa-hong/so/page.tsx"));
  it("moGiaiThichAction: auth() → zod → checkAnyPermission([view-self, view-center]) → cờ engine → mới đọc", () => {
    const than = thanHam(ACTIONS, "moGiaiThichAction");
    const viTri = (s: string) => than.indexOf(s);
    expect(viTri("await auth()")).toBeGreaterThan(-1);
    expect(viTri("checkAnyPermission([\"commission:view-self\", \"commission:view-center\"])")).toBeGreaterThan(viTri("await auth()"));
    expect(viTri("laEngineHoaHongBat()")).toBeGreaterThan(viTri("checkAnyPermission("));
    expect(viTri("docGiaiThichMo(")).toBeGreaterThan(viTri("laEngineHoaHongBat()"));
  });
  it("mỗi `<QueueToggle` trong page.tsx của tab Sổ đều có `khongDuDieuKien=` (quên một chỗ ⇒ công tắc mất mục ở góc nhìn đó, không lỗi nào báo — luật 11)", () => {
    const soToggle = dem(PAGE, /<QueueToggle\b/g);
    expect(soToggle).toBe(3);
    expect(dem(PAGE, /<QueueToggle\b[^>]*\bkhongDuDieuKien=\{/g)).toBe(soToggle);
  });
  it("người chỉ có view-self không có «Cần xử lý»: mọi QueueToggle ở nhánh «Tất cả» và «Không đủ điều kiện» truyền `anCanXuLy={!coHangCho}`", () => {
    expect(dem(PAGE, /anCanXuLy=\{!coHangCho\}/g)).toBe(2);
  });
});
