// Ca [POS2-MIG-01] · [POS2-SC-01] — GĐ2 POS: bảng NHẬT KÝ KIỂM phiếu thu thẻ (`PosCheckLog`), nguồn
// `QUET_SACH`, ba cột mã TCB của `PosTerminal` phải được KHAI ĐỦ mọi chỗ. Thuần, không DB.
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §1. Hành vi THẬT của các khoá (RLS, CHECK, khoá ngoại, cách ly
// scopedDb) đo trên Postgres ở `tests/finance/pos-gd2-schema.test.ts` — lưới ở đây chỉ bảo đảm khai
// báo không biến mất. Vì sao cần cả hai tầng (F5 GĐ1): `prisma migrate diff` KHÔNG in CHECK ⇒ "drift
// 0 dòng" không chứng minh chúng tồn tại.
//
// Phần soi migration là LƯỚI GHIM MÃ NGUỒN (luật 11): bóc chú thích SQL `--` trước khi soi, neo chuỗi
// hẹp, khẳng định SỐ LẦN khớp.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, SCOPE_EXEMPT, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

const MODEL = "PosCheckLog";

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
describe("[POS2-SC-01] PosCheckLog khai đủ BA chỗ của luật cách ly cơ sở", () => {
  it("∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS, KHÔNG ∈ SCOPE_EXEMPT", () => {
    // `centerId` NOT NULL (= cơ sở của phiếu POS) ⇒ NULL không mang nghĩa "dùng chung".
    expect(SCOPED_MODELS.has(MODEL)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(MODEL)).toBe(false);
    expect(SCOPE_EXEMPT.has(MODEL)).toBe(false);
  });

  it("getModelPrefixes = ['payments:'] — cùng họ với PosPaymentIntent", () => {
    // Trống thì rơi về `isHoLevel ? ALL : visibleCenterIds`: ai có MỘT vai neo tại Hội sở, kể cả vai
    // chẳng liên quan tiền, đọc được nhật ký thu thẻ (mã phiếu, mã giao dịch) mọi cơ sở.
    expect(getModelPrefixes(MODEL)).toEqual(["payments:"]);
    expect(getModelPrefixes(MODEL)).toEqual(getModelPrefixes("PosPaymentIntent"));
  });

  it("BACKFILL_SPECS: đúng MỘT mục, BAT_BUOC, scoped = true ⇒ ghi kép orgUnitId tự chạy", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === MODEL);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe("BAT_BUOC");
    expect(spec[0]!.scoped).toBe(true);
    expect(DUAL_WRITE_MODELS.has(MODEL)).toBe(true);
  });
});

describe("[POS2-SC-01b] hình dạng cột — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it("PosCheckLog có CẢ centerId (BẮT BUỘC) lẫn orgUnitId (tuỳ chọn)", () => {
    const f = model(MODEL).fields;
    expect(f.find((x) => x.name === "centerId")?.isRequired, "centerId phải NOT NULL").toBe(true);
    expect(f.find((x) => x.name === "orgUnitId")?.isRequired).toBe(false);
  });

  it("intentId BẮT BUỘC; createdById tuỳ chọn (null = máy); durationMs Int bắt buộc; statusSau tuỳ chọn", () => {
    const f = model(MODEL).fields;
    expect(f.find((x) => x.name === "intentId")?.isRequired).toBe(true);
    expect(f.find((x) => x.name === "createdById")?.isRequired).toBe(false);
    const thoiLuong = f.find((x) => x.name === "durationMs");
    expect(thoiLuong?.type).toBe("Int");
    expect(thoiLuong?.isRequired).toBe(true);
    const sau = f.find((x) => x.name === "statusSau");
    expect(sau?.type).toBe("PosIntentStatus");
    expect(sau?.isRequired).toBe(false);
    expect(f.find((x) => x.name === "triggeredBy")?.type).toBe("PosCheckTrigger");
    expect(f.find((x) => x.name === "kind")?.type).toBe("PosCheckLogKind");
  });

  it("KHÔNG có cột raw/PII — không số thẻ, không ghi chú, không mã chuẩn chi, không updatedAt (bảng chỉ-thêm)", () => {
    const ten = model(MODEL).fields.map((x) => x.name);
    for (const cam of ["raw", "cardMasked", "soTheMasked", "dienGiai", "approvalCode", "tenChuThe", "updatedAt"]) {
      expect(ten, cam).not.toContain(cam);
    }
  });

  it("enum: PosCheckTrigger thêm QUET_SACH ở CUỐI; PosCheckLogKind = 6 kind provider + CACHE (KHÔNG thêm CACHE vào PosCheckKind)", () => {
    expect(enumVals("PosCheckTrigger")).toEqual(["SALE", "POLLER", "AGENT", "IMPORT", "QUET_SACH"]);
    expect(enumVals("PosCheckLogKind")).toEqual([
      "PAID",
      "PAID_AMOUNT_MISMATCH",
      "FAILED",
      "NOT_FOUND",
      "CANCELLED_AFTER_PAID",
      "PROVIDER_ERROR",
      "CACHE",
    ]);
    // U6: `PosCheckKind` là kiểu của `PosPaymentIntent.lastResultKind` — CACHE ở đó là cho DB lưu một
    // "kết quả máy" vô nghĩa.
    expect(enumVals("PosCheckKind")).not.toContain("CACHE");
  });

  it("PosTerminal có ba cột mã TCB, cả ba TUỲ CHỌN, kiểu String; maThietBi vẫn là khoá khớp duy nhất", () => {
    const f = model("PosTerminal").fields;
    for (const ten of ["maCuaHang", "maNhaCungCap", "maTcbQuay"]) {
      const c = f.find((x) => x.name === ten);
      expect(c, ten).toBeDefined();
      expect(c?.type, ten).toBe("String");
      expect(c?.isRequired, `${ten} phải nullable (additive)`).toBe(false);
      expect(c?.isUnique, `${ten} không @unique (một cửa hàng nhiều máy)`).toBe(false);
    }
    expect(f.find((x) => x.name === "maThietBi")?.isUnique).toBe(true);
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────
const THU_MUC = resolve(process.cwd(), "prisma/migrations");
const TEN = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_gd2_nhat_ky_kiem$/.test(d));

function sqlKhongChuThich(): string {
  if (TEN.length !== 1) return "";
  return readFileSync(resolve(THU_MUC, TEN[0]!, "migration.sql"), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*--/.test(d))
    .map((d) => d.replace(/\s--.*$/, ""))
    .join("\n");
}

const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[POS2-MIG-01] migration nhật ký kiểm — có, chạy lại được, đủ khoá", () => {
  const sql = sqlKhongChuThich();

  it("đúng MỘT thư mục `<ts>_pos_gd2_nhat_ky_kiem`, tên SAU migration GĐ1 (20261006140000) và sau mốc [MIG-01]", () => {
    // Đo 06/10 bằng git ls-tree mọi origin/* + nhánh cục bộ: lớn nhất 20261006140000_pos_payment_intent.
    // `migrate deploy` áp theo thứ tự TÊN — tên nhỏ hơn GĐ1 là khoá ngoại sang bảng chưa có.
    expect(TEN).toHaveLength(1);
    expect(TEN[0]!.slice(0, 14) > "20261006140000").toBe(true);
    expect(TEN[0]!.slice(0, 14) >= "20260928000000").toBe(true);
  });

  it("QUET_SACH: ĐÚNG MỘT câu ADD VALUE IF NOT EXISTS, và chuỗi 'QUET_SACH' KHÔNG dùng ở câu nào khác", () => {
    // Giá trị enum vừa ADD chưa dùng được trong cùng giao dịch (Postgres: "unsafe use of new value").
    expect(dem(sql, /ALTER TYPE "PosCheckTrigger" ADD VALUE IF NOT EXISTS 'QUET_SACH';/)).toBe(1);
    expect(dem(sql, /'QUET_SACH'/)).toBe(1);
  });

  it("enum PosCheckLogKind trong SQL = enum trong schema.prisma, bọc pg_type", () => {
    const m = sql.match(/CREATE TYPE "PosCheckLogKind" AS ENUM\s*\(([^)]*)\)/);
    const trongSql = m ? [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!) : [];
    expect(trongSql).toEqual(enumVals("PosCheckLogKind"));
    expect(dem(sql, /typname = 'PosCheckLogKind'/)).toBe(1);
  });

  it("ba cột PosTerminal: ADD COLUMN IF NOT EXISTS, TEXT, KHÔNG NOT NULL / DEFAULT", () => {
    for (const cot of ["maCuaHang", "maNhaCungCap", "maTcbQuay"]) {
      expect(dem(sql, new RegExp(`ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "${cot}" TEXT;`)), cot).toBe(1);
    }
    expect(dem(sql, /ALTER TABLE "PosTerminal" ADD COLUMN/)).toBe(3);
  });

  it("bảng + bốn chỉ mục có IF NOT EXISTS, đúng tên quy ước Prisma", () => {
    expect(dem(sql, /CREATE TABLE IF NOT EXISTS "PosCheckLog"/)).toBe(1);
    expect(dem(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/)).toBe(0);
    for (const [ten, cot] of [
      ["PosCheckLog_intentId_createdAt_idx", '"intentId", "createdAt"'],
      ["PosCheckLog_centerId_createdAt_idx", '"centerId", "createdAt"'],
      ["PosCheckLog_createdAt_idx", '"createdAt"'],
      ["PosCheckLog_orgUnitId_idx", '"orgUnitId"'],
    ] as const) {
      expect(dem(sql, new RegExp(`CREATE INDEX IF NOT EXISTS "${ten}" ON "PosCheckLog"\\(${cot}\\);`)), ten).toBe(1);
    }
  });

  it("ba CHECK: thời lượng ≥ 0, mã lỗi ≤ 64 ký tự, lượt CACHE không gọi provider (0 ms, không mã GD)", () => {
    expect(dem(sql, /CONSTRAINT "PosCheckLog_durationMs_check" CHECK \("durationMs" >= 0\)/)).toBe(1);
    expect(
      dem(sql, /CONSTRAINT "PosCheckLog_errorCode_check" CHECK \("errorCode" IS NULL OR char_length\("errorCode"\) <= 64\)/),
    ).toBe(1);
    expect(
      dem(
        sql,
        /CONSTRAINT "PosCheckLog_cache_check"\s+CHECK \("kind" <> 'CACHE' OR \("durationMs" = 0 AND "providerTxnId" IS NULL\)\)/,
      ),
    ).toBe(1);
  });

  it("hai khoá ngoại bọc pg_constraint: phiếu POS RESTRICT, người bấm SET NULL — không CASCADE", () => {
    expect(dem(sql, /ADD CONSTRAINT "PosCheckLog_\w+_fkey"/)).toBe(2);
    expect(dem(sql, /conname = 'PosCheckLog_\w+_fkey'/)).toBe(2);
    expect(
      dem(
        sql,
        /"PosCheckLog_intentId_fkey"\s+FOREIGN KEY \("intentId"\) REFERENCES "PosPaymentIntent"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
      ),
    ).toBe(1);
    expect(
      dem(
        sql,
        /"PosCheckLog_createdById_fkey"\s+FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/,
      ),
    ).toBe(1);
    expect(dem(sql, /ON DELETE CASCADE/)).toBe(0);
  });

  it("RLS: ENABLE đúng một lần, KHÔNG FORCE, KHÔNG policy", () => {
    expect(dem(sql, /ALTER TABLE "PosCheckLog" ENABLE ROW LEVEL SECURITY;/)).toBe(1);
    expect(dem(sql, /FORCE ROW LEVEL SECURITY/)).toBe(0);
    expect(dem(sql, /CREATE POLICY/)).toBe(0);
  });

  it("ADDITIVE: chỉ ALTER PosTerminal (thêm cột) + PosCheckLog; không DROP, không đổi kiểu", () => {
    const alter = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(alter)).toEqual(new Set(["PosTerminal", "PosCheckLog"]));
    expect(dem(sql, /\bDROP\b/)).toBe(0);
    expect(dem(sql, /ALTER COLUMN/)).toBe(0);
    expect(dem(sql, /\bRENAME\b/)).toBe(0);
  });
});
