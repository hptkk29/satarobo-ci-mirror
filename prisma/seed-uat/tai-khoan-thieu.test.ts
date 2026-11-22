// [TKT-*] Lối "chỉ tạo tài khoản UAT còn thiếu" (12/10/2026): phần chọn là hàm THUẦN; phần còn lại là lưới ghim mã nguồn (luật 11: neo lời gọi, đếm số lần, bỏ chú thích).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { chonTaiKhoan } from "./00-tai-khoan";

const ds = [{ local: "uat.admin" }, { local: "uat.sale1" }, { local: "uat.sale3" }, { local: "uat.sale5" }];
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[TKT] chonTaiKhoan", () => {
  it("[TKT-01] TAT_CA: giữ NGUYÊN cả danh sách dù đã có email nào (đường db:seed:uat không đổi hành vi)", () => {
    const r = chonTaiKhoan(ds, new Set(["uat.admin@satarobo.vn"]), "TAT_CA");
    expect(r.map((x) => x.local)).toEqual(["uat.admin", "uat.sale1", "uat.sale3", "uat.sale5"]);
  });

  it("[TKT-02] CHI_TAO_THIEU: chỉ trả tài khoản CHƯA có email; đúng ca DB test (thiếu sale3 + sale5)", () => {
    const co = new Set(["uat.admin@satarobo.vn", "uat.sale1@satarobo.vn"]);
    expect(chonTaiKhoan(ds, co, "CHI_TAO_THIEU").map((x) => x.local)).toEqual(["uat.sale3", "uat.sale5"]);
  });

  it("[TKT-03] CHI_TAO_THIEU: đủ cả ⇒ rỗng (không ghi gì); chưa có gì ⇒ đủ cả danh sách", () => {
    const du = new Set(ds.map((x) => `${x.local}@satarobo.vn`));
    expect(chonTaiKhoan(ds, du, "CHI_TAO_THIEU")).toEqual([]);
    expect(chonTaiKhoan(ds, new Set(), "CHI_TAO_THIEU")).toHaveLength(4);
  });
});

describe("[TKT-W] lưới ghim mã nguồn", () => {
  const tk = boChuThich(doc("prisma/seed-uat/00-tai-khoan.ts"));
  const script = boChuThich(doc("prisma/seed-uat/chay-tai-khoan-thieu.ts"));
  const index = boChuThich(doc("prisma/seed-uat/index.ts"));

  it("[TKT-W1] index.ts (đường đầy đủ) gọi seedTaiKhoan(\"TAT_CA\") đúng một lần; script riêng gọi CHI_TAO_THIEU đúng một lần", () => {
    expect(dem(index, /\bseedTaiKhoan\("TAT_CA"\)/g)).toBe(1);
    expect(dem(index, /\bseedTaiKhoan\(/g)).toBe(1);
    expect(dem(script, /\bseedTaiKhoan\("CHI_TAO_THIEU"\)/g)).toBe(1);
    expect(dem(script, /\bseedTaiKhoan\(/g)).toBe(1);
  });

  it("[TKT-W2] script riêng KHÔNG kéo seedNen / index / tầng seed khác; dry-run mặc định (chỉ ghi khi có --apply, và --apply đứng TRƯỚC lời gọi ghi)", () => {
    expect(script).not.toMatch(/seedNen|\.\/index|seedCrm|seedHocVu|seedTaiChinh|seedNoiLead/);
    expect(dem(script, /process\.argv\.includes\("--apply"\)/g)).toBe(1);
    expect(script.indexOf("if (!apply)")).toBeGreaterThan(-1);
    expect(script.indexOf("if (!apply)")).toBeLessThan(script.indexOf('seedTaiKhoan("CHI_TAO_THIEU")'));
  });

  it("[TKT-W3] chế độ CHI_TAO_THIEU không sửa hồ sơ nhân sự đang có (employee.upsert.update rỗng)", () => {
    expect(tk).toMatch(/update: che === "CHI_TAO_THIEU" \? \{\} :/);
  });
});
