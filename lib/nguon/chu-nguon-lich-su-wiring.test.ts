// @vitest-environment node
/**
 * [OWN-W*] — LƯỚI GHIM DÂY NỐI của LỊCH SỬ CHỦ NGUỒN (`LeadSourceOwnerPeriod`). Đọc MÃ NGUỒN; hành vi đã có ca Postgres ở `tests/hoa-hong/chu-nguon-khong-hoi-to.spec.ts`.
 *
 * Vì sao cần (vá sau gộp, 08 §17.x mục 4): CHECK DB `LeadSourceOwnerPeriod_khong_lui_chk` (`effectiveFrom >= createdAt`) chỉ là kiểm tra NHẤT QUÁN nội tại — `createdAt` do ỨNG DỤNG đặt (cố ý: đồng hồ
 * của ứng dụng được tiêm vào mọi ca test, luật 19), nên DB không thể tự chống lùi ngày. Chống lùi ngày thật là `kiemMocHieuLuc` với `now` do máy chủ cấp. Cho phép đó đứng vững, lưới này đòi:
 *   [OWN-W1] mọi phép GHI bảng này (Prisma) chỉ nằm ở `chu-nguon-lich-su-db.ts`; không có SQL thô ghi vào nó ngoài migration
 *   [OWN-W2] hai hàm ghi (`ghiKhoiTaoChuNguon` · `ghiDoiChuNguon`) chỉ được gọi từ `danh-muc-ghi.ts` — đường ghi `ownerEmployeeId` duy nhất
 *   [OWN-W3] `ghiDoiChuNguon` gọi `kiemMocHieuLuc(` TRƯỚC phép ghi đầu tiên (đóng khoảng cũ) và ném nếu có lỗi
 *
 * Neo hẹp, bỏ chú thích TRƯỚC khi đếm, không cờ `s`. Đã cấy từng luật: xem commit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(GOC, p), "utf8").replace(/\r\n/g, "\n"));

const BO_QUA = new Set(["node_modules", ".next", ".git", "migrations", "coverage"]);
function duyet(thuMuc: string, ra: string[] = []): string[] {
  let ds: string[];
  try {
    ds = readdirSync(resolve(GOC, thuMuc));
  } catch {
    return ra; // thư mục không có trên gương CI
  }
  for (const ten of ds) {
    if (BO_QUA.has(ten)) continue;
    const dd = join(thuMuc, ten);
    if (statSync(resolve(GOC, dd)).isDirectory()) duyet(dd, ra);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten) && !dd.replace(/\\/g, "/").startsWith("tests/")) ra.push(dd.replace(/\\/g, "/"));
  }
  return ra;
}
const MA_NGUON = ["lib", "app", "components", "scripts", "prisma"].flatMap((t) => duyet(t));

const PHEP_GHI = /leadSourceOwnerPeriod\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
const SQL_GHI = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"?LeadSourceOwnerPeriod"?/gi;
const FILE_DB = "lib/nguon/chu-nguon-lich-su-db.ts";

describe("[OWN-W1] mọi phép ghi LeadSourceOwnerPeriod chỉ ở một tệp", () => {
  it("Prisma: chỉ `chu-nguon-lich-su-db.ts`, đúng ba phép (hai create + một update đóng khoảng); SQL thô: không tệp nào ngoài migration", () => {
    expect(MA_NGUON.length).toBeGreaterThan(50); // lưới thật sự quét được cây mã, không rỗng vì sai thư mục
    const gap: string[] = [];
    for (const f of MA_NGUON) {
      const ma = doc(f);
      const n = (ma.match(PHEP_GHI) ?? []).length;
      if (n > 0 && f !== FILE_DB) gap.push(`${f}: ${n} phép ghi Prisma`);
      if ((ma.match(SQL_GHI) ?? []).length > 0) gap.push(`${f}: SQL thô ghi vào bảng`);
    }
    expect(gap).toEqual([]);
    const ghi = doc(FILE_DB).match(PHEP_GHI) ?? [];
    expect(ghi.sort()).toEqual(["leadSourceOwnerPeriod.create(", "leadSourceOwnerPeriod.create(", "leadSourceOwnerPeriod.update("]);
  });
});

describe("[OWN-W2] hai hàm ghi chỉ được gọi từ đường ghi `ownerEmployeeId`", () => {
  it("`ghiKhoiTaoChuNguon(` và `ghiDoiChuNguon(` chỉ ở `danh-muc-ghi.ts`, mỗi hàm đúng một lời gọi", () => {
    const goi = (ten: string) => MA_NGUON.filter((f) => f !== FILE_DB).flatMap((f) => Array.from({ length: (doc(f).match(new RegExp(`\\b${ten}\\(`, "g")) ?? []).length }, () => f));
    expect(goi("ghiKhoiTaoChuNguon")).toEqual(["lib/nguon/danh-muc-ghi.ts"]);
    expect(goi("ghiDoiChuNguon")).toEqual(["lib/nguon/danh-muc-ghi.ts"]);
  });
});

describe("[OWN-W3] mốc hiệu lực được kiểm TRƯỚC phép ghi", () => {
  it("`ghiDoiChuNguon`: `kiemMocHieuLuc(` đứng trước `.update(` (đóng khoảng) và `.create(` (mở khoảng), và kết quả lỗi bị ném", () => {
    const ma = doc(FILE_DB);
    const hamDoi = ma.slice(ma.indexOf("export async function ghiDoiChuNguon"));
    const kiem = hamDoi.indexOf("kiemMocHieuLuc(");
    expect(kiem).toBeGreaterThan(-1);
    expect(kiem).toBeLessThan(hamDoi.indexOf("leadSourceOwnerPeriod.update("));
    expect(kiem).toBeLessThan(hamDoi.indexOf("leadSourceOwnerPeriod.create("));
    expect(hamDoi).toMatch(/if \(loi\) throw new LoiMocChuNguon\(loi\);/);
    // mốc là THAM SỐ của hàm (do máy chủ cấp qua `danh-muc-ghi`), không tự đọc đồng hồ
    expect(hamDoi).not.toMatch(/new Date\(\)|Date\.now\(\)/);
    expect(relative(GOC, resolve(GOC, FILE_DB))).toBeTruthy();
  });
});
