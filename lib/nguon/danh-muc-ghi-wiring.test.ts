// @vitest-environment node
/**
 * [DMG-W*] — LƯỚI GHIM MÃ NGUỒN của đường GHI danh mục nguồn (`lib/nguon/danh-muc-ghi.ts`). Hành vi đã có ca DB (`tests/hoa-hong/nguon-dong-ghi.spec.ts`);
 * lưới này canh thứ ca DB không thấy: một ĐƯỜNG GHI THỨ HAI qua mặt cổng, và thứ tự «khoá → so → cổng → ghi → audit».
 *
 *   [DMG-W1] `leadSourceGroup.create/update/updateMany/upsert/delete/deleteMany/createMany` chỉ ở danh-muc-ghi.ts (create ×1, update ×2, KHÔNG có xoá/upsert/hàng loạt);
 *            SQL thô không UPDATE/DELETE/INSERT bảng nguồn ngoài migration
 *   [DMG-W2] mỗi `writeAudit` của đường ghi truyền `tx` (audit CÙNG giao dịch) và mang `reason`
 *   [DMG-W3] sửa / đổi trạng thái: khoá hàng `FOR UPDATE` → so `updatedAt` bằng getTime() → cổng (kiemSuaNguon / kiemDoiTrangThai) → `.update(` → audit, theo THỨ TỰ TRONG VĂN BẢN
 *   [DMG-W4] `updatedAtDaThay` không có mặc định ở cả hai hàm (luật 7)
 *   [DMG-W5] Server Action: ba action gọi đúng hàm ghi và KHÔNG chạm `leadSourceGroup` trực tiếp
 *
 * Quy tắc viết lưới (luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`, có phép tự-kiểm «đã quét đủ tệp».
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

const GHI = "lib/nguon/danh-muc-ghi.ts";
const doc = (t: string) => boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"));

function maChayToanCay(): { ten: string; code: string }[] {
  const ds = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "scripts", "components", "prisma"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d) && !/\.(test|spec)\.(ts|tsx)$/.test(d) && !d.endsWith(".d.ts") && !d.startsWith("prisma/migrations/"))
    .filter((d) => existsSync(resolve(process.cwd(), d)));
  return ds.map((ten) => ({ ten, code: boChuThich(readFileSync(resolve(process.cwd(), ten), "utf8")) }));
}

const GHI_NGUON = /\bleadSourceGroup\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

describe("[DMG-W] đường ghi danh mục nguồn", () => {
  const TEP = maChayToanCay();
  const ghi = doc(GHI);

  it("[DMG-W1] tự-kiểm: đã quét đủ cây mã", () => {
    expect(TEP.length).toBeGreaterThan(500);
    expect(TEP.some((t) => t.ten === GHI)).toBe(true);
  });

  it("[DMG-W1] phép ghi lên `leadSourceGroup` chỉ ở danh-muc-ghi.ts: create ×1, update ×2; KHÔNG xoá cứng, KHÔNG upsert, KHÔNG ghi hàng loạt", () => {
    const co = TEP.filter((t) => GHI_NGUON.test(t.code)).map((t) => t.ten);
    expect(co).toEqual([GHI]);
    expect(dem(ghi, /\bleadSourceGroup\.create\s*\(/)).toBe(1);
    expect(dem(ghi, /\bleadSourceGroup\.update\s*\(/)).toBe(2);
    expect(dem(ghi, /\bleadSourceGroup\.(?:createMany|updateMany|upsert|delete|deleteMany)\s*\(/)).toBe(0);
  });

  it("[DMG-W1] SQL thô trong mã chạy không INSERT/UPDATE/DELETE bảng LeadSourceGroup (cổng ghi không có cửa sau)", () => {
    const hu = TEP.filter((t) => /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"LeadSourceGroup"/i.test(t.code)).map((t) => t.ten);
    expect(hu).toEqual([]);
  });

  it("[DMG-W2] cả 3 lời gọi `writeAudit` mang `tx,` và `reason:`; entity là LeadSourceGroup", () => {
    const khoi = [...ghi.matchAll(/await writeAudit\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]!);
    expect(khoi).toHaveLength(3);
    for (const k of khoi) {
      expect(dem(k, /\btx,/)).toBe(1);
      expect(dem(k, /\breason:/)).toBe(1);
      expect(dem(k, /entityType:\s*ENTITY_AUDIT/)).toBe(1);
    }
    expect(dem(ghi, /\bwriteAudit\(/)).toBe(3);
    expect(dem(ghi, /const ENTITY_AUDIT = "LeadSourceGroup"/)).toBe(1);
  });

  const thanHam = (ten: string): string => {
    const a = ghi.indexOf(`export async function ${ten}(`);
    expect(a, ten).toBeGreaterThanOrEqual(0);
    const b = ghi.indexOf("\nexport ", a + 10);
    return ghi.slice(a, b < 0 ? undefined : b);
  };

  it.each([
    ["suaNguon", "kiemSuaNguon("],
    ["doiTrangThaiNguon", "kiemDoiTrangThai("],
  ])("[DMG-W3] %s: khoá hàng → so updatedAt → cổng → ghi → audit (thứ tự trong văn bản)", (ten, cong) => {
    const h = thanHam(ten);
    const vt = {
      khoa: h.indexOf("await khoaHangNguon(tx"),
      doc: h.indexOf("tx.leadSourceGroup.findUnique("),
      so: h.indexOf("updatedAt.getTime() !== p.updatedAtDaThay.getTime()"),
      cong: h.indexOf(cong),
      ghi: h.indexOf("tx.leadSourceGroup.update("),
      audit: h.indexOf("await writeAudit("),
    };
    for (const [k, v] of Object.entries(vt)) expect(v, `${ten}: thiếu ${k}`).toBeGreaterThanOrEqual(0);
    expect(vt.khoa).toBeLessThan(vt.doc);
    expect(vt.doc).toBeLessThan(vt.so);
    expect(vt.so).toBeLessThan(vt.cong);
    expect(vt.cong).toBeLessThan(vt.ghi);
    expect(vt.ghi).toBeLessThan(vt.audit);
    expect(dem(h, /updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/)).toBe(1);
  });

  it("[DMG-W3] từ chối TRONG giao dịch là `throw`: có đúng 3 `$transaction` và thân callback không có `return { ok: false` (return không rollback — luật rollback CLAUDE.md)", () => {
    const thanCallback: string[] = [];
    for (const m of ghi.matchAll(/\$transaction\(async \(tx\) => \{/g)) {
      let sau = 1;
      let i = m.index! + m[0].length;
      for (; i < ghi.length && sau > 0; i++) {
        if (ghi[i] === "{") sau++;
        else if (ghi[i] === "}") sau--;
      }
      thanCallback.push(ghi.slice(m.index!, i));
    }
    expect(thanCallback).toHaveLength(3);
    for (const t of thanCallback) expect(dem(t, /return\s*\{\s*ok:\s*false/)).toBe(0);
  });

  it("[DMG-W3] khoá hàng đúng một chỗ định nghĩa, dùng `FOR UPDATE`, gọi ở cả hai hàm sửa/đổi trạng thái", () => {
    expect(dem(ghi, /FOR UPDATE/)).toBe(1);
    expect(dem(ghi, /await khoaHangNguon\(tx,/)).toBe(2);
  });

  it("[DMG-W4] `updatedAtDaThay` là trường BẮT BUỘC (không `?`, không `= `) ở suaNguon và doiTrangThaiNguon", () => {
    for (const ten of ["suaNguon", "doiTrangThaiNguon"]) {
      const h = thanHam(ten);
      expect(dem(h, /updatedAtDaThay:\s*Date;/)).toBe(1);
      expect(dem(h, /updatedAtDaThay\?:/)).toBe(0);
    }
  });

  it("[DMG-W5] ba Server Action gọi đúng hàm ghi và không chạm `leadSourceGroup` trực tiếp", () => {
    const a = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts");
    for (const goi of ["await taoNguon(", "await suaNguon(", "await doiTrangThaiNguon("]) expect(dem(a, goi), goi).toBe(1);
    expect(dem(a, /\bleadSourceGroup\b/)).toBe(0);
    expect(dem(a, /\bdb\./)).toBe(0);
  });

  it("[DMG-W6] hiệu lực của nguồn (effectiveFrom/To) có ĐƯỜNG GỌI ở cả 4 nơi chọn nguồn — cột nhận được mà không nơi nào đọc là cờ treo", () => {
    const chon = doc("lib/nguon/chon-nguon.ts");
    expect(dem(chon, /\.filter\(\(r\) => nguonChonDuoc\(r, now\)\)/)).toBe(1);
    expect(dem(chon, /export function locNhomChon\(rows: readonly NhomChonTho\[\], now: Date\)/)).toBe(1);

    const thu = doc("lib/nguon/thu-thap-tin-hieu.ts");
    expect(dem(thu, /trongKhoangHieuLuc\(g, mocLo\)/)).toBe(2); // cấu hình quy nguồn của lô + bảng tra của người nhập chọn
    expect(dem(thu, /selectable: true, referrerRequirement: true, effectiveFrom: true, effectiveTo: true/)).toBe(1);

    const doi = doc("lib/nguon/doi-nguon-lead.ts");
    expect(dem(doi, /trongKhoangHieuLuc\(nhomMoi, p\.bayGio\)/)).toBe(1);
    expect(dem(doi, /effectiveFrom: true, effectiveTo: true/)).toBe(1);

    const page = doc("lib/nguon/bang-nguon-theo-page.ts");
    expect(dem(page, /nguonChonDuoc\(/)).toBe(2); // danh sách nhóm gán được + cổng ghi
    expect(dem(page, /nguonChonDuoc\(nhomMoi, p\.now\)/)).toBe(1); // nhóm ĐÍCH được đọc LẠI trong transaction, SAU khoá (W2, R3-M5)

    // cả hai nơi hiển thị danh sách chọn truyền `now` xuống và SELECT hai cột hiệu lực
    expect(dem(doc("lib/nguon/doc-gan-nguon.ts"), /locNhomChon\(nhomRows, p\.now\)/)).toBe(1);
    // HAI lần: danh mục chọn (`nhomRows`) + nhóm của CHÍNH lead (nút «Bổ sung Sale phụ trách»: `quyetDinhNutBoSungSale` hỏi `nguonChonDuoc` trên nhóm hiện tại — thiếu hai cột này nút vẽ cho nguồn đã hết hạn)
    expect(dem(doc("lib/nguon/doc-gan-nguon.ts"), /effectiveFrom: true,\s*effectiveTo: true/)).toBe(2);
    expect(dem(doc("lib/nguon/nguon-cho-form-nhap.ts"), /locNhomChon\(nhom, now\)/)).toBe(1);
    expect(dem(doc("lib/nguon/nguon-cho-form-nhap.ts"), /effectiveFrom: true, effectiveTo: true/)).toBe(1);
  });

  it("[DMG-W6] `hieu-luc-nguon.ts` THUẦN: không import nào (trình duyệt cũng đọc; không Zod, không DB)", () => {
    expect(dem(doc("lib/nguon/hieu-luc-nguon.ts"), /^\s*import\s/m)).toBe(0);
  });
});
