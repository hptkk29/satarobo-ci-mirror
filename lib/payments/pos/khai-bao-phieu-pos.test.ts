// Ca [POS1-SC-01] · [POS1-MIG-01] · [POS1-Q-06] · [POS1-Q-07] — GĐ1 POS: bảng PHIẾU THU THẺ
// (`PosPaymentIntent`) và quyền `payments:pos-check` phải được KHAI ĐỦ mọi chỗ. Thuần, không DB.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §1 (bảng), §6.5 (quyền). Hành vi THẬT của các khoá
// (RLS, chỉ mục từng phần, CHECK, khoá ngoại RESTRICT, cách ly scopedDb) được đo trên Postgres ở
// `tests/finance/pos-gd1-schema.test.ts` — lưới ở đây chỉ bảo đảm khai báo không biến mất.
//
// Vì sao cần cả hai tầng (F5 của thiết kế): `prisma migrate diff --from-url … --to-schema-datamodel`
// KHÔNG in chỉ mục từng phần lẫn CHECK ⇒ "drift 0 dòng" không chứng minh chúng tồn tại.
//
// Phần soi migration là LƯỚI GHIM MÃ NGUỒN (luật 11): bóc chú thích SQL `--` trước khi soi, neo
// chuỗi hẹp, khẳng định SỐ LẦN khớp.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, SCOPE_EXEMPT, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getActionMeta } from "@/lib/auth/action-labels";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../../prisma/seed-roles";

const MODEL = "PosPaymentIntent";
const KEY = "payments:pos-check";

function model(ten: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === ten);
  if (!m) throw new Error(`Không có model ${ten} trong Prisma Client đã sinh (quên \`prisma generate\`?)`);
  return m;
}

function enumVals(ten: string): string[] {
  const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === ten);
  if (!e) throw new Error(`Không có enum ${ten} trong Prisma Client đã sinh`);
  return e.values.map((v) => v.name);
}

// ─── Cách ly cơ sở ───────────────────────────────────────────────────────────
describe("[POS1-SC-01] PosPaymentIntent khai đủ BA chỗ của luật cách ly cơ sở", () => {
  it("∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS, KHÔNG ∈ SCOPE_EXEMPT", () => {
    // `centerId` NOT NULL (cơ sở của ĐƠN) ⇒ NULL không mang nghĩa "dùng chung". Đưa vào
    // NULL_IS_GLOBAL là mở `centerId IS NULL OR …` cho một bảng không bao giờ có NULL — vô
    // hại hôm nay, nhưng là lời nói dối về ngữ nghĩa cho người đọc sau.
    expect(SCOPED_MODELS.has(MODEL)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(MODEL)).toBe(false);
    expect(SCOPE_EXEMPT.has(MODEL)).toBe(false);
  });

  it("getModelPrefixes = ['payments:'] — cùng họ tiền với PaymentBill", () => {
    // Trống thì rơi về `isHoLevel ? ALL : visibleCenterIds`: ai có MỘT vai neo tại Hội sở,
    // kể cả vai chẳng liên quan tiền, đọc được phiếu thu thẻ mọi cơ sở.
    expect(getModelPrefixes(MODEL)).toEqual(["payments:"]);
    expect(getModelPrefixes(MODEL)).toEqual(getModelPrefixes("PaymentBill"));
  });

  it("BACKFILL_SPECS: đúng MỘT mục, BAT_BUOC, scoped = true ⇒ ghi kép orgUnitId tự chạy", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === MODEL);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe("BAT_BUOC");
    expect(spec[0]!.scoped).toBe(true);
    expect(DUAL_WRITE_MODELS.has(MODEL)).toBe(true);
  });
});

describe("[POS1-SC-01b] hình dạng cột — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it("có CẢ centerId (BẮT BUỘC) lẫn orgUnitId (tuỳ chọn)", () => {
    const f = model(MODEL).fields;
    expect(f.find((x) => x.name === "centerId")?.isRequired, "centerId phải NOT NULL").toBe(true);
    expect(f.find((x) => x.name === "orgUnitId")?.isRequired).toBe(false);
  });

  it("KHÔNG có paymentId / orderId — phiếu POS là tay cầm của sale, KHÔNG phải sổ tiền", () => {
    // Phiếu gộp n dòng ⇒ n Payment: một cột paymentId sẽ nói dối ngay ở phiếu 2 con.
    const ten = model(MODEL).fields.map((x) => x.name);
    expect(ten).not.toContain("paymentId");
    expect(ten).not.toContain("orderId");
  });

  it("amount là Int (đồng); bankTransactionId @unique — một giao dịch thẻ cho tối đa MỘT phiếu", () => {
    const f = model(MODEL).fields;
    expect(f.find((x) => x.name === "amount")?.type).toBe("Int");
    expect(f.find((x) => x.name === "bankTransactionId")?.isUnique).toBe(true);
  });

  it("ba enum mới mang ĐÚNG tập giá trị của thiết kế (T1: có CAN_XU_LY)", () => {
    expect(enumVals("PosIntentStatus")).toEqual([
      "CHO_QUET",
      "THAT_BAI",
      "DA_THU",
      "LECH_TIEN",
      "CAN_XU_LY",
      "HET_HAN",
      "HUY",
    ]);
    expect(enumVals("PosCheckKind")).toEqual([
      "PAID",
      "PAID_AMOUNT_MISMATCH",
      "FAILED",
      "NOT_FOUND",
      "CANCELLED_AFTER_PAID",
      "PROVIDER_ERROR",
    ]);
    // GĐ2 (06/10/2026, docs/pos-gd2-thiet-ke.md §1.2 U7) nối `QUET_SACH` vào CUỐI bằng
    // `ALTER TYPE … ADD VALUE` ở migration 20261006160000 — bốn giá trị GĐ1 giữ nguyên thứ tự.
    expect(enumVals("PosCheckTrigger")).toEqual(["SALE", "POLLER", "AGENT", "IMPORT", "QUET_SACH"]);
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────
const THU_MUC = resolve(process.cwd(), "prisma/migrations");
const TEN = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_payment_intent$/.test(d));

function sqlKhongChuThich(): string {
  if (TEN.length !== 1) return "";
  return readFileSync(resolve(THU_MUC, TEN[0]!, "migration.sql"), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*--/.test(d))
    .join("\n");
}

/** Giá trị enum trong `CREATE TYPE "<ten>" AS ENUM (…)` của migration. */
function enumTrongSql(sql: string, ten: string): string[] {
  const m = sql.match(new RegExp(`CREATE TYPE "${ten}" AS ENUM\\s*\\(([^)]*)\\)`));
  if (!m) return [];
  return [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!);
}

const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[POS1-MIG-01] migration PosPaymentIntent — có, chạy lại được, đủ khoá", () => {
  const sql = sqlKhongChuThich();

  it("đúng MỘT thư mục `<ts>_pos_payment_intent`, tên SAU mốc [MIG-01] và SAU migration trùng ngày của nhánh module-hethong", () => {
    // `20261006120000_q4_nhom_vi_tri` (origin/hptkk29/module-hethong) — đo 06/10 bằng git ls-tree.
    // Trùng dấu thời gian là `migrate deploy` áp theo thứ tự TÊN, không theo ý đồ.
    expect(TEN).toHaveLength(1);
    expect(TEN[0]!.slice(0, 14) > "20261006120000").toBe(true);
    expect(TEN[0]!.slice(0, 14) >= "20260928000000").toBe(true);
  });

  it("enum trong SQL = enum trong schema.prisma (mỗi enum một lần, bọc pg_type)", () => {
    for (const ten of ["PosIntentStatus", "PosCheckKind", "PosCheckTrigger"]) {
      // `PosCheckTrigger`: GĐ2 nối `QUET_SACH` vào cuối bằng migration RIÊNG (ADD VALUE — migration
      // đã áp thì không sửa) ⇒ SQL của GĐ1 phải bằng ĐÚNG phần đầu của enum hiện tại, phần đuôi do
      // `[POS2-MIG-01]` canh.
      const giaTri = ten === "PosCheckTrigger" ? enumVals(ten).filter((v) => v !== "QUET_SACH") : enumVals(ten);
      expect(enumTrongSql(sql, ten), ten).toEqual(giaTri);
      expect(dem(sql, new RegExp(`typname = '${ten}'`, "g")), `${ten} phải kiểm pg_type`).toBe(1);
    }
  });

  it("bảng + mọi chỉ mục có IF NOT EXISTS; khoá ngoại bọc pg_constraint", () => {
    expect(dem(sql, /CREATE TABLE IF NOT EXISTS "PosPaymentIntent"/g)).toBe(1);
    expect(dem(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)).toBe(0);
    expect(dem(sql, /ADD CONSTRAINT "PosPaymentIntent_\w+_fkey"/g)).toBe(4);
    expect(dem(sql, /conname = 'PosPaymentIntent_\w+_fkey'/g)).toBe(4);
  });

  it("chỉ mục TỪNG PHẦN một-phiếu-mở-mỗi-phiếu-gộp có đủ điều kiện WHERE", () => {
    expect(
      dem(
        sql,
        /CREATE UNIQUE INDEX IF NOT EXISTS "PosPaymentIntent_paymentBillId_mo_key"\s+ON "PosPaymentIntent"\("paymentBillId"\)\s+WHERE "status" IN \('CHO_QUET', 'THAT_BAI'\)/g,
      ),
    ).toBe(1);
  });

  it("CHECK số tiền dương, mã đúng 5 ký tự, hạn sau lúc tạo", () => {
    expect(dem(sql, /CONSTRAINT "PosPaymentIntent_amount_check" CHECK \("amount" > 0\)/g)).toBe(1);
    expect(dem(sql, /CONSTRAINT "PosPaymentIntent_code5_check" CHECK \(char_length\("code5"\) = 5\)/g)).toBe(1);
    expect(dem(sql, /CONSTRAINT "PosPaymentIntent_expiresAt_check" CHECK \("expiresAt" > "createdAt"\)/g)).toBe(1);
  });

  it("cả BỐN khoá ngoại ON DELETE RESTRICT — không khoá nào CASCADE / SET NULL", () => {
    expect(dem(sql, /ON DELETE RESTRICT/g)).toBe(4);
    expect(dem(sql, /ON DELETE (CASCADE|SET NULL)/g)).toBe(0);
  });

  it("RLS: ENABLE đúng một lần, KHÔNG FORCE, KHÔNG policy", () => {
    expect(dem(sql, /ALTER TABLE "PosPaymentIntent" ENABLE ROW LEVEL SECURITY;/g)).toBe(1);
    expect(dem(sql, /FORCE ROW LEVEL SECURITY/g)).toBe(0);
    expect(dem(sql, /CREATE POLICY/g)).toBe(0);
  });

  it("ADDITIVE: không ALTER/DROP bảng cũ nào", () => {
    // Bảng cũ chỉ nhận khoá ngoại TRỎ VÀO chúng từ bảng mới (luật cứng #4).
    const alter = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(alter)).toEqual(new Set(["PosPaymentIntent"]));
    expect(dem(sql, /\bDROP\b/g)).toBe(0);
  });
});

// ─── Quyền ───────────────────────────────────────────────────────────────────
const permsOf = (code: string) => {
  const role = ROLE_SEED.find((r) => r.code === code);
  if (!role) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return role.perms;
};
const quyenCua = (code: string) => permsOf(code).filter((p) => p.action === KEY);

describe("[POS1-Q-06] seed RBAC v2 — ai được thu thẻ POS", () => {
  it.each(["HO_ACCOUNTANT", "CENTER_MANAGER", "CENTER_SALES_CSM"])("%s có payments:pos-check GLOBAL đúng một lần", (code) => {
    // GLOBAL theo R1: cổng action gọi `checkPermission` trần — scope CENTER sẽ ra FALSE trên
    // prod. Cách ly cơ sở do scopedDb + passesScope, không do scopeType.
    expect(quyenCua(code)).toEqual([{ action: KEY, scopeType: "GLOBAL" }]);
  });

  it.each(["CENTER_ACCOUNTANT", "TEACHER", "HO_MARKETING", "PARENT"])(
    "đối chứng: %s KHÔNG có (T16 — kế toán cơ sở hỏi lại sau)",
    (code) => {
      expect(quyenCua(code)).toEqual([]);
    },
  );

  it("mọi RoleDef giữ quyền này đều seed GLOBAL", () => {
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms.filter((p) => p.action === KEY && p.scopeType !== "GLOBAL").map((p) => `${r.code}=${p.scopeType}`),
    );
    expect(viPham).toEqual([]);
  });

  it("`payments:import-pos` KHÔNG đổi — vẫn chỉ HO_ACCOUNTANT (đối chứng không lan quyền)", () => {
    const giu = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === "payments:import-pos")).map((r) => r.code);
    expect(giu.filter((c) => c !== "SUPER_ADMIN")).toEqual(["HO_ACCOUNTANT"]);
  });
});

describe("[POS1-Q-07] v1 matrix + registry + nhãn", () => {
  it("v1: đúng bằng `payments:record` (v1 không tách kế toán HO/cơ sở)", () => {
    expect(PERMISSIONS).toHaveProperty(KEY);
    const v1 = PERMISSIONS as Record<string, readonly string[]>;
    expect([...v1[KEY]!].sort()).toEqual(["ACCOUNTANT", "CENTER_MANAGER", "SALES_CSM", "SUPER_ADMIN"]);
    expect([...v1[KEY]!].sort()).toEqual([...v1["payments:record"]!].sort());
    // Đối chứng: không vai nào ngoài bốn vai thu tiền.
    expect(v1[KEY]).not.toContain("TEACHER");
    expect(v1[KEY]).not.toContain("PARENT");
  });

  it("registry: module finance, action pos-check, có mô tả", () => {
    const row = collectDescriptors(ALL_MODULE_DECLS).get(KEY);
    expect(row, `registry thiếu ${KEY}`).toBeDefined();
    expect(row?.module).toBe("finance");
    expect(row?.action).toBe("pos-check");
    expect(row?.description ?? "").not.toBe("");
  });

  it("nhãn tiếng Việt cho verb `pos-check` (không hiện chữ thô ở màn cấp quyền)", () => {
    const { label } = getActionMeta(KEY);
    expect(label).not.toBe("pos-check");
    expect(label).toMatch(/thẻ POS/i);
  });
});
