// lib/entitlements/khai-bao-nen.test.ts — NỀN DỮ LIỆU quyền học phải được KHAI ĐỦ mọi chỗ. THUẦN, không DB.
//
// Hành vi THẬT của các ràng buộc (CHECK, chỉ mục từng phần, cascade, RLS, scopedDb, ghi kép) đo trên
// Postgres ở `tests/finance/quyen-hoc-nen.test.ts`. Lưới này bảo đảm KHAI BÁO không biến mất và các
// tên trong TypeScript không trôi khỏi enum của schema.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";
import { TRANG_THAI_QUYEN_HOC } from "./trang-thai";
import { NGUON_SO_CAI } from "./tieu-thu";
import { LOAI_MUA_PHAM_VI } from "./pham-vi-hoc";

const enumVals = (ten: string) => {
  const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === ten);
  if (!e) throw new Error(`Không có enum ${ten} (quên prisma generate?)`);
  return e.values.map((v) => v.name);
};
const model = (ten: string) => {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === ten);
  if (!m) throw new Error(`Không có model ${ten} (quên prisma generate?)`);
  return m;
};

describe("[ENT-SC] StudyEntitlement khai đủ ba chỗ của luật cách ly cơ sở (CLAUDE.md luật Nền #3)", () => {
  it("[ENT-SC-01] ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS (centerId NOT NULL — không có nghĩa 'dùng chung')", () => {
    expect(SCOPED_MODELS.has("StudyEntitlement")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("StudyEntitlement")).toBe(false);
  });

  it("[ENT-SC-02] có prefix quyền ở getModelPrefixes — thiếu là tầm nhìn rơi về diện rộng", () => {
    expect(getModelPrefixes("StudyEntitlement")).toEqual(["entitlements:", "enrollments:", "payments:"]);
  });

  it("[ENT-SC-03] ∈ BACKFILL_SPECS (BAT_BUOC, scoped) và nhờ đó ∈ DUAL_WRITE_MODELS", () => {
    expect(BACKFILL_SPECS.find((s) => s.model === "StudyEntitlement")).toMatchObject({ nullMeaning: "BAT_BUOC", scoped: true });
    expect(DUAL_WRITE_MODELS.has("StudyEntitlement")).toBe(true);
  });

  it("[ENT-SC-04] bảng CON StudyEntitlementUsage KHÔNG khai thừa ở đâu cả (cách ly đến từ quyền học cha)", () => {
    expect(SCOPED_MODELS.has("StudyEntitlementUsage")).toBe(false);
    expect(NULL_IS_GLOBAL_MODELS.has("StudyEntitlementUsage")).toBe(false);
    expect(getModelPrefixes("StudyEntitlementUsage")).toEqual([]);
    expect(BACKFILL_SPECS.some((s) => s.model === "StudyEntitlementUsage")).toBe(false);
    expect(model("StudyEntitlementUsage").fields.some((f) => f.name === "centerId" || f.name === "orgUnitId")).toBe(false);
  });

  it("[ENT-SC-05] cột cách ly của quyền học: centerId BẮT BUỘC, orgUnitId rỗng được", () => {
    const f = (n: string) => model("StudyEntitlement").fields.find((x) => x.name === n)!;
    expect(f("centerId")).toMatchObject({ isRequired: true, type: "String" });
    expect(f("orgUnitId")).toMatchObject({ isRequired: false, type: "String" });
  });
});

describe("[XL-SC] StudyEntitlementXuLy (hàng đợi CHỜ CHUYỂN ĐỔI) khai đủ ba chỗ của luật cách ly cơ sở", () => {
  it("[XL-SC-01] ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS (một dòng chờ luôn thuộc đúng một cơ sở)", () => {
    expect(SCOPED_MODELS.has("StudyEntitlementXuLy")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("StudyEntitlementXuLy")).toBe(false);
  });

  it("[XL-SC-02] prefix quyền GIỐNG quyền học — thiếu map là tầm nhìn rơi về diện rộng", () => {
    expect(getModelPrefixes("StudyEntitlementXuLy")).toEqual(getModelPrefixes("StudyEntitlement"));
    expect(getModelPrefixes("StudyEntitlementXuLy")).toEqual(["entitlements:", "enrollments:", "payments:"]);
  });

  it("[XL-SC-03] ∈ BACKFILL_SPECS (BAT_BUOC, scoped) và nhờ đó ∈ DUAL_WRITE_MODELS", () => {
    expect(BACKFILL_SPECS.find((s) => s.model === "StudyEntitlementXuLy")).toMatchObject({ nullMeaning: "BAT_BUOC", scoped: true });
    expect(DUAL_WRITE_MODELS.has("StudyEntitlementXuLy")).toBe(true);
  });

  it("[XL-SC-04] cột cách ly: centerId BẮT BUỘC, orgUnitId rỗng được; khoá duy nhất (orderItemId, loai) ĐẦY ĐỦ (không từng phần)", () => {
    const m = model("StudyEntitlementXuLy");
    const f = (n: string) => m.fields.find((x) => x.name === n)!;
    expect(f("centerId")).toMatchObject({ isRequired: true, type: "String" });
    expect(f("orgUnitId")).toMatchObject({ isRequired: false, type: "String" });
    expect(m.uniqueFields).toContainEqual(["orderItemId", "loai"]);
  });

  it("[XL-SC-05] enum loại / trạng thái chừa sẵn các giá trị của chiều ngược (PR sau KHÔNG phải migration lần hai)", () => {
    expect(enumVals("EntitlementXuLyLoai").sort()).toEqual(["CAN_THU_HOI", "CHO_CHUYEN_DOI", "CHO_DUYET_HOC_VUOT", "CHO_XEP_LOP", "LECH_DU_LIEU", "THIEU_QUYEN_HOC", "TREO_DUYET_TAY"]);
    expect(enumVals("EntitlementXuLyTrangThai").sort()).toEqual(["DA_XU_LY", "HUY", "OPEN"]);
  });
});

describe("[XL-MIG] migration 20261020100000_quyen_hoc_xu_ly chỉ THÊM", () => {
  const TEN = "20261020100000_quyen_hoc_xu_ly";
  const sql = readFileSync(resolve(process.cwd(), `prisma/migrations/${TEN}/migration.sql`), "utf8");
  // Bỏ chú thích TRƯỚC khi quét: phần giải thích đầu tệp nhắc "KHÔNG UPDATE/DELETE".
  const ma = sql.replace(/--[^\n]*/g, "");

  it("[XL-MIG-01] không DROP/ALTER COLUMN/RENAME/UPDATE/DELETE/TRUNCATE/INSERT/ADD VALUE; mọi ALTER TABLE chỉ chạm bảng MỚI", () => {
    expect(ma).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|TYPE|CONSTRAINT)|ALTER\s+COLUMN|RENAME|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO|ADD\s+VALUE)\b/i);
    const bang = [...ma.matchAll(/ALTER\s+TABLE\s+"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(bang.length).toBeGreaterThan(0);
    for (const b of bang) expect(b).toBe("StudyEntitlementXuLy");
  });

  it("[XL-MIG-02] bảng mới tự bật RLS (chỉ ENABLE, không FORCE) và không có chỉ mục từng phần (sẽ lộ ra ở `migrate diff`)", () => {
    expect(ma).toMatch(/ALTER TABLE "StudyEntitlementXuLy" ENABLE ROW LEVEL SECURITY/);
    expect(ma).not.toMatch(/FORCE\s+ROW\s+LEVEL/i);
    expect(ma).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[^;]*\bWHERE\b/i);
  });

  it("[XL-MIG-03] tên chỉ mục theo quy ước Prisma (Bang_cot_key / Bang_cot_idx)", () => {
    expect(ma).toMatch(/"StudyEntitlementXuLy_orderItemId_loai_key"/);
    expect(ma).toMatch(/"StudyEntitlementXuLy_centerId_loai_trangThai_idx"/);
    expect(ma).toMatch(/"StudyEntitlementXuLy_orderId_idx"/);
    expect(ma).toMatch(/"StudyEntitlementXuLy_orgUnitId_idx"/);
  });

  it("[XL-MIG-04] migration có mặt và dấu 14 số KHÔNG trùng migration nào khác", () => {
    const ten = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((t) => /^\d{14}_/.test(t));
    expect(ten).toContain(TEN);
    expect(ten.filter((t) => t.startsWith("20261020100000_"))).toEqual([TEN]);
  });
});

describe("[ENT-ENUM] tên trong TypeScript khớp KHÍT enum của schema", () => {
  it("[ENT-ENUM-01] trạng thái quyền học", () => {
    expect([...TRANG_THAI_QUYEN_HOC].sort()).toEqual(enumVals("StudyEntitlementStatus").sort());
  });
  it("[ENT-ENUM-02] nguồn dòng sổ cái", () => {
    expect([...NGUON_SO_CAI].sort()).toEqual(enumVals("UsageSource").sort());
  });
  it("[ENT-ENUM-03] loại mua", () => {
    expect([...LOAI_MUA_PHAM_VI].sort()).toEqual(enumVals("PurchaseKind").sort());
  });
  it("[ENT-ENUM-04] enum KHÔNG có giá trị thêm vào enum CÓ SẴN — các enum này đều là enum MỚI", () => {
    for (const e of ["PurchaseKind", "CustomerKind", "StudyEntitlementStatus", "EntitlementOrigin", "UsageSource"]) {
      const t = readFileSync(resolve(process.cwd(), "prisma/migrations/20261013100000_quyen_hoc_nen/migration.sql"), "utf8");
      expect(t, e).toMatch(new RegExp(`CREATE TYPE "${e}" AS ENUM`));
    }
    // Bỏ chú thích TRƯỚC khi quét: phần giải thích đầu tệp nhắc "KHÔNG ADD VALUE".
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261013100000_quyen_hoc_nen/migration.sql"), "utf8");
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/ADD VALUE/i);
  });
});

describe("[ENT-MIG] migration chỉ THÊM", () => {
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261013100000_quyen_hoc_nen/migration.sql"), "utf8");
  // Bỏ chú thích TRƯỚC khi quét: phần giải thích đầu tệp nhắc "KHÔNG UPDATE/DELETE".
  const ma = sql.replace(/--[^\n]*/g, "");

  it("[ENT-MIG-01] không DROP/ALTER COLUMN/RENAME/UPDATE/DELETE/TRUNCATE/INSERT", () => {
    expect(ma).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|TYPE|CONSTRAINT)|ALTER\s+COLUMN|RENAME|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i);
  });

  it("[ENT-MIG-02] mọi ALTER TABLE chỉ chạm hai bảng MỚI", () => {
    const bang = [...ma.matchAll(/ALTER\s+TABLE\s+"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(bang.length).toBeGreaterThan(0);
    for (const b of bang) expect(["StudyEntitlement", "StudyEntitlementUsage"], b).toContain(b);
  });

  it("[ENT-MIG-03] mỗi bảng mới tự bật RLS (chỉ ENABLE, không FORCE)", () => {
    for (const b of ["StudyEntitlement", "StudyEntitlementUsage"]) {
      expect(ma).toMatch(new RegExp(`ALTER TABLE "${b}" ENABLE ROW LEVEL SECURITY`));
    }
    expect(ma).not.toMatch(/FORCE\s+ROW\s+LEVEL/i);
  });

  it("[ENT-MIG-04] migration có mặt, và KHÔNG trùng dấu thời gian với migration nào khác", () => {
    // Bản đầu đòi migration này là CUỐI CÙNG trong thư mục — đúng ĐÚNG LÚC VIẾT (luật "dấu thời gian lớn
    // hơn migration cuối đang có"), nhưng đỏ ngay khi bất kỳ ai thêm migration sau nó (11/10/2026: P2.2
    // `20261014090000_xac_nhan_cong`). Luật thời điểm-tạo không còn kiểm được sau khi đã merge; thứ còn
    // kiểm được mãi là: migration có mặt + dấu 14 số KHÔNG trùng (trùng là `migrate deploy` xếp thứ tự mơ hồ).
    const ten = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((t) => /^\d{14}_/.test(t)).sort();
    expect(ten).toContain("20261013100000_quyen_hoc_nen");
    expect(ten.filter((t) => t.startsWith("20261013100000_"))).toEqual(["20261013100000_quyen_hoc_nen"]);
  });
});

describe("[ENT-USAGE-PIN] sổ cái chỉ được đọc/ghi trong lib/entitlements/** (INV-32b)", () => {
  it("[ENT-USAGE-PIN-01] không tệp nào NGOÀI lib/entitlements/**, tests/** gọi studyEntitlementUsage.*", () => {
    let ra: string;
    try {
      ra = execFileSync(
        "git",
        ["grep", "--untracked", "-l", "-E", "studyEntitlementUsage\\.|\\.studyEntitlementUsage\\b", "--", "lib", "app", "components", "scripts"],
        { encoding: "utf8" },
      );
    } catch {
      ra = ""; // git grep thoát 1 khi không có kết quả — hợp lệ khi chưa ai gọi
    }
    const ngoai = ra
      .split("\n")
      .filter(Boolean)
      .map((t) => t.replace(/\\/g, "/"))
      .filter((t) => !t.startsWith("lib/entitlements/"));
    expect(ngoai).toEqual([]);
  });

  it("[ENT-USAGE-PIN-02] đối chứng: lưới bắt được một lời gọi thật (regex khớp mẫu mong đợi)", () => {
    const re = /studyEntitlementUsage\.|\.studyEntitlementUsage\b/;
    expect(re.test("await db.studyEntitlementUsage.findMany({})")).toBe(true);
    expect(re.test("const x = scopedDb(a).studyEntitlementUsage")).toBe(true);
    expect(re.test("studyEntitlement.findMany")).toBe(false);
  });
});
