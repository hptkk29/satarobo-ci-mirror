/**
 * Ca [NHH-SRC-MIG-01..05] — HÌNH DẠNG của migration `*_nguon_lead_attribution` (THUẦN, đọc tệp SQL).
 *
 * Vì sao có tệp này (lượt cấy lại 07/10/2026, luật 14): ba điều migration hứa mà KHÔNG ca nào canh ở bộ thuần —
 *  · RLS bật cho cả ba bảng (sự cố 09/08: bảng mới ra đời với RLS TẮT) — gỡ dòng `ENABLE ROW LEVEL SECURITY` ⇒ xanh;
 *  · luật xoá của khoá ngoại (lead xoá cứng ⇒ quy nguồn đi theo; người giới thiệu RESTRICT — D13) — đổi
 *    CASCADE → RESTRICT ⇒ xanh;
 *  · additive-only: không đụng bảng có sẵn, không trigger, không chỉ mục từng phần.
 * Cộng thêm: CHECK người giới thiệu phải NULL-SAFE (xem [NHH-SRC-MIG-04] — lỗ có thật, bắt được ở `[NHH-SRC-23c]`).
 *
 * Ca DB tương ứng (Postgres thật): `[NHH-SRC-01r]` (RLS), `[NHH-SRC-23c]` (CHECK) ở `tests/lead-intake/nguon-ghi.spec.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CUA_SO_NGAY_TOI_DA } from "./danh-muc-ghi-dau-vao";

function docSql(): string {
  const goc = resolve(process.cwd(), "prisma/migrations");
  const thuMuc = readdirSync(goc).filter((d) => d.endsWith("_nguon_lead_attribution"));
  expect(thuMuc, "phải có đúng MỘT thư mục *_nguon_lead_attribution").toHaveLength(1);
  // Bóc chú thích `--` TRƯỚC khi soi (chú thích kể lại chính các luật này).
  return readFileSync(resolve(goc, thuMuc[0]!, "migration.sql"), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/--.*$/, ""))
    .join("\n");
}

const sql = docSql();
const BA_BANG = ["LeadSourceGroup", "LeadAttribution", "LeadTouchpoint"];

describe("[NHH-SRC-MIG-01] RLS cho mọi bảng mới", () => {
  it("mỗi `CREATE TABLE` đều có `ENABLE ROW LEVEL SECURITY` của đúng bảng đó (và chỉ ba bảng)", () => {
    const taoBang = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]!);
    expect(taoBang.sort()).toEqual([...BA_BANG].sort());
    for (const b of taoBang) {
      expect(sql, b).toContain(`ALTER TABLE "${b}" ENABLE ROW LEVEL SECURITY;`);
    }
    // Chỉ ENABLE: không FORCE, không policy (luật prisma-db.md).
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY|CREATE POLICY/);
  });

  it("[tự kiểm] bộ so khớp THẤY thiếu RLS", () => {
    const gia = 'CREATE TABLE IF NOT EXISTS "X" ();';
    expect([...gia.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)]).toHaveLength(1);
    expect(gia).not.toContain('ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;');
  });
});

describe("[NHH-SRC-MIG-02] luật xoá của khoá ngoại", () => {
  const fk = [
    ...sql.matchAll(
      /ADD CONSTRAINT "([^"]+)"\s+FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)"\("([^"]+)"\)\s+ON DELETE (CASCADE|RESTRICT|SET NULL|NO ACTION|SET DEFAULT)/g,
    ),
  ].map((m) => ({ ten: m[1]!, cot: m[2]!, den: m[3]!, luat: m[5]! }));
  const theoTen = new Map(fk.map((f) => [f.ten, f]));

  it("đủ 12 khoá ngoại (không mất cái nào): 10 cũ + `referrerSaleUserId` + `ownerEmployeeId` của nguồn động", () => {
    expect(fk).toHaveLength(12);
    expect(theoTen.size).toBe(12);
  });

  it("lead xoá cứng ⇒ quy nguồn + touchpoint ĐI THEO (CASCADE); lead gốc kế thừa ⇒ SET NULL", () => {
    expect(theoTen.get("LeadAttribution_leadId_fkey")).toMatchObject({ den: "Lead", luat: "CASCADE" });
    expect(theoTen.get("LeadTouchpoint_leadId_fkey")).toMatchObject({ den: "Lead", luat: "CASCADE" });
    expect(theoTen.get("LeadAttribution_inheritedFromLeadId_fkey")).toMatchObject({ den: "Lead", luat: "SET NULL" });
  });

  it("người giới thiệu và nhóm nguồn là RESTRICT (D13: không xoá cứng người đang là nguồn của một lead)", () => {
    for (const ten of [
      "LeadAttribution_groupId_fkey",
      "LeadAttribution_originalGroupId_fkey",
      "LeadTouchpoint_claimedGroupId_fkey",
      "LeadAttribution_referrerEmployeeId_fkey",
      "LeadAttribution_referrerParentUserId_fkey",
      "LeadAttribution_referrerStudentId_fkey",
      "LeadAttribution_referrerAffiliateId_fkey",
      // Nguồn động: Sale phụ trách PH (snapshot) và người phụ trách nguồn — xoá cứng người đang là mốc hưởng bị CHẶN.
      "LeadAttribution_referrerSaleUserId_fkey",
      "LeadSourceGroup_ownerEmployeeId_fkey",
    ]) {
      expect(theoTen.get(ten)?.luat, ten).toBe("RESTRICT");
    }
    expect(theoTen.get("LeadAttribution_referrerSaleUserId_fkey")).toMatchObject({ cot: "referrerSaleUserId", den: "User" });
    expect(theoTen.get("LeadSourceGroup_ownerEmployeeId_fkey")).toMatchObject({ cot: "ownerEmployeeId", den: "Employee" });
  });
});

describe("[NHH-SRC-MIG-03] additive-only", () => {
  it("chỉ ALTER chính ba bảng mới; không trigger; không chỉ mục từng phần; không DROP/UPDATE/DELETE", () => {
    const alter = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]!);
    expect(alter.length).toBeGreaterThan(5);
    for (const b of alter) expect(BA_BANG, `ALTER TABLE "${b}"`).toContain(b);
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER|CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(sql).not.toMatch(/CREATE (?:UNIQUE )?INDEX[^;]*\bWHERE\b/i);
    expect(sql).not.toMatch(/\bDROP\b|\bUPDATE\b\s+"|\bDELETE\b\s+FROM|\bTRUNCATE\b/i);
  });
});

describe("[NHH-SRC-MIG-04] CHECK người giới thiệu NULL-SAFE", () => {
  it("mỗi nhánh có kiểu mở bằng `\"referrerKind\" IS NOT NULL AND` (NULL qua CHECK ⇒ nếu không, kind NULL + cột người lọt)", () => {
    const co = [...sql.matchAll(/"referrerKind" = '(EMPLOYEE|PARENT|AFFILIATE)'/g)];
    expect(co.map((m) => m[1])).toEqual(["EMPLOYEE", "PARENT", "AFFILIATE"]);
    const antoan = [...sql.matchAll(/"referrerKind" IS NOT NULL AND "referrerKind" = '(EMPLOYEE|PARENT|AFFILIATE)'/g)];
    expect(antoan.map((m) => m[1])).toEqual(["EMPLOYEE", "PARENT", "AFFILIATE"]);
  });

  it("[tự kiểm] bộ so khớp THẤY nhánh thiếu IS NOT NULL", () => {
    const yeu = `OR ("referrerKind" = 'PARENT' AND x)`;
    expect([...yeu.matchAll(/"referrerKind" = '(EMPLOYEE|PARENT|AFFILIATE)'/g)]).toHaveLength(1);
    expect([...yeu.matchAll(/"referrerKind" IS NOT NULL AND "referrerKind" = '(EMPLOYEE|PARENT|AFFILIATE)'/g)]).toHaveLength(0);
  });
});

describe("[NHH-SRC-MIG-05] CHECK giải trình", () => {
  it("giải trình không rỗng · lý do đổi nguồn ≥ 10 ký tự SAU btrim, coalesce chống NULL", () => {
    expect(sql).toContain(`("otherSourceNote" IS NULL OR btrim("otherSourceNote") <> '')`);
    expect(sql).toContain(`char_length(btrim(coalesce("changeReason", ''))) >= 10`);
  });
});

describe("[NHH-SRC-MIG-06] nguồn ĐỘNG: cột/enum/CHECK mới của LeadSourceGroup + LeadAttribution", () => {
  const khoiBang = (ten: string): string => {
    const a = sql.indexOf(`CREATE TABLE IF NOT EXISTS "${ten}"`);
    expect(a, ten).toBeGreaterThan(-1);
    return sql.slice(a, sql.indexOf(");", a));
  };

  it("enum `LeadSourceType` đủ tám giá trị, tạo MỘT lần (kiểm pg_type để chạy lại được)", () => {
    expect(sql).toContain(`CREATE TYPE "LeadSourceType" AS ENUM ('REFERRAL', 'MARKETING', 'ORGANIC', 'OFFLINE', 'EVENT', 'PARTNER', 'OTHER', 'SYSTEM')`);
    expect([...sql.matchAll(/typname = 'LeadSourceType'/g)]).toHaveLength(1);
  });

  it("LeadSourceGroup có đủ cột nguồn động, đúng kiểu/mặc định", () => {
    const k = khoiBang("LeadSourceGroup");
    for (const c of [
      `"sourceType"          "LeadSourceType" NOT NULL DEFAULT 'OTHER'`,
      `"attributionWindowDays" INTEGER,`,
      `"commissionEnabled"   BOOLEAN NOT NULL DEFAULT false`,
      `"ownerOrgUnitId"      TEXT,`,
      `"ownerEmployeeId"     TEXT,`,
      `"effectiveFrom"       TIMESTAMPTZ(6),`,
      `"effectiveTo"         TIMESTAMPTZ(6),`,
      `"updatedById"         TEXT,`,
    ]) {
      expect(k, c).toContain(c);
    }
    // `commissionEnabled` mặc định FALSE: nguồn mới do admin tạo KHÔNG tự tham gia hoa hồng (bật phải là quyết định có chủ đích).
    expect(k).not.toMatch(/"commissionEnabled"[^,]*DEFAULT true/);
  });

  it("LeadAttribution có `referrerRoleCode` (TEXT, snapshot vai) và `referrerSaleUserId` (TEXT, snapshot Sale phụ trách PH)", () => {
    const k = khoiBang("LeadAttribution");
    expect(k).toContain(`"referrerRoleCode"     TEXT,`);
    expect(k).toContain(`"referrerSaleUserId"   TEXT,`);
  });

  it("CHECK cửa sổ ghi công trong (0, 3650] và hiệu lực to > from, mỗi cái đúng MỘT lần ADD + kiểm pg_constraint", () => {
    expect([...sql.matchAll(/ADD CONSTRAINT "LeadSourceGroup_cua_so_chk"/g)]).toHaveLength(1);
    expect([...sql.matchAll(/conname = 'LeadSourceGroup_cua_so_chk'/g)]).toHaveLength(1);
    expect(sql).toMatch(/"attributionWindowDays" IS NULL OR \("attributionWindowDays" > 0 AND "attributionWindowDays" <= \d+\)/);
    expect([...sql.matchAll(/ADD CONSTRAINT "LeadSourceGroup_hieu_luc_chk"/g)]).toHaveLength(1);
    expect([...sql.matchAll(/conname = 'LeadSourceGroup_hieu_luc_chk'/g)]).toHaveLength(1);
    expect(sql).toMatch(/"effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom"/);
  });

  it("cận trên của CHECK cửa sổ = CUA_SO_NGAY_TOI_DA của validator (hai nơi, MỘT con số — lệch là form cho nhập mà DB từ chối, hoặc ngược lại)", () => {
    const m = /"attributionWindowDays" <= (\d+)\)/.exec(sql);
    expect(m, "thiếu cận trên trong CHECK").not.toBeNull();
    expect(Number(m![1])).toBe(CUA_SO_NGAY_TOI_DA);
  });

  it("chỉ mục: `sourceType` · `ownerEmployeeId` · `referrerSaleUserId` — tên đúng quy ước Prisma", () => {
    for (const ten of [
      "LeadSourceGroup_sourceType_idx",
      "LeadSourceGroup_ownerEmployeeId_idx",
      "LeadAttribution_referrerSaleUserId_idx",
    ]) {
      expect(sql, ten).toContain(`CREATE INDEX IF NOT EXISTS "${ten}"`);
    }
  });

  it("ngoại lệ Nền #3 giữ nguyên: LeadAttribution/LeadTouchpoint KHÔNG có centerId/orgUnitId (ownerOrgUnitId chỉ ở LeadSourceGroup)", () => {
    for (const b of ["LeadAttribution", "LeadTouchpoint"]) {
      expect(khoiBang(b), b).not.toMatch(/"centerId"|"orgUnitId"|"ownerOrgUnitId"/);
    }
  });

  it("schema.prisma khai `LeadSourceType` + các cột mới (MỘT lần mỗi cái) — Prisma Client sinh từ đây", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema.match(/^enum LeadSourceType \{/gm)).toHaveLength(1);
    const m = /^model LeadSourceGroup \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    for (const c of ["sourceType", "attributionWindowDays", "commissionEnabled", "ownerOrgUnitId", "ownerEmployeeId", "effectiveFrom", "effectiveTo", "updatedById"]) {
      expect(m.match(new RegExp(`^\\s+${c}\\s`, "gm")), c).toHaveLength(1);
    }
    const a = /^model LeadAttribution \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    for (const c of ["referrerRoleCode", "referrerSaleUserId"]) {
      expect(a.match(new RegExp(`^\\s+${c}\\s`, "gm")), c).toHaveLength(1);
    }
  });
});
