// Ca [POS4-SC-01] · [POS4-SC-01b] · [POS4-MIG-01] — GĐ4 POS: bốn bảng mang dữ liệu theo cơ sở của
// máy đồng bộ (PosAgent · PosAgentEvent · PosCheckJob · PosTxnSource) + bảng nonce phải KHAI ĐỦ mọi chỗ.
// Thuần, không DB.
//
// Thiết kế: docs/pos-gd4-thiet-ke.md §2. Hành vi THẬT của khoá (RLS, CHECK, khoá ngoại, cách ly scopedDb)
// đo trên Postgres ở `tests/finance/pos-gd4-schema.test.ts` — lưới ở đây chỉ bảo đảm khai báo không biến
// mất. Vì sao cần cả hai tầng (F5 GĐ1): `prisma migrate diff` KHÔNG in CHECK ⇒ "drift 0 dòng" không chứng
// minh chúng tồn tại.
//
// Phần soi migration là LƯỚI GHIM MÃ NGUỒN (luật 11): bóc chú thích SQL `--` trước khi soi, neo chuỗi
// hẹp, khẳng định SỐ LẦN khớp.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, SCOPE_EXEMPT, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

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

/** Bốn bảng mang dữ liệu theo cơ sở — khai ĐỦ ba chỗ (luật cứng #3 bản 27/08). */
const BANG_CO_SO = [
  ["PosAgent", "BAT_BUOC"],
  ["PosAgentEvent", "BAT_BUOC"],
  ["PosCheckJob", "BAT_BUOC"],
  ["PosTxnSource", "NULL_CHUA_KHOP"],
] as const;

describe("[POS4-SC-01] bốn bảng GĐ4 khai đủ BA chỗ của luật cách ly cơ sở", () => {
  it.each(BANG_CO_SO)("%s ∈ SCOPED_MODELS, prefix ['payments:'], BACKFILL_SPECS %s, không SCOPE_EXEMPT", (ten, nghia) => {
    expect(SCOPED_MODELS.has(ten)).toBe(true);
    expect(SCOPE_EXEMPT.has(ten)).toBe(false);
    // Trống thì rơi về `isHoLevel ? ALL : visibleCenterIds`: ai có MỘT vai neo tại Hội sở (kể cả vai chẳng
    // liên quan tiền) đọc được máy đồng bộ + giao dịch thẻ mọi cơ sở.
    expect(getModelPrefixes(ten)).toEqual(["payments:"]);
    const spec = BACKFILL_SPECS.filter((s) => s.model === ten);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe(nghia);
    expect(spec[0]!.scoped).toBe(true);
    expect(DUAL_WRITE_MODELS.has(ten), "ghi kép orgUnitId tự chạy").toBe(true);
  });

  it("KHÔNG bảng nào vào NULL_IS_GLOBAL_MODELS — PosTxnSource NULL = chưa biết cơ sở, KHÔNG phải dùng chung (T25)", () => {
    for (const [ten] of BANG_CO_SO) expect(NULL_IS_GLOBAL_MODELS.has(ten), ten).toBe(false);
  });

  it("PosAgentNonce: KHÔNG cột đơn vị ⇒ không SCOPED, không BACKFILL (ngoại lệ có chủ đích — T21)", () => {
    expect(SCOPED_MODELS.has("PosAgentNonce")).toBe(false);
    expect(BACKFILL_SPECS.some((s) => s.model === "PosAgentNonce")).toBe(false);
    const ten = model("PosAgentNonce").fields.map((f) => f.name);
    expect(ten).not.toContain("centerId");
    expect(ten).not.toContain("orgUnitId");
  });
});

describe("[POS4-SC-01b] hình dạng cột — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it("PosAgent/PosAgentEvent/PosCheckJob: centerId BẮT BUỘC + orgUnitId tuỳ chọn; PosTxnSource: centerId tuỳ chọn", () => {
    for (const ten of ["PosAgent", "PosAgentEvent", "PosCheckJob"]) {
      const f = model(ten).fields;
      expect(f.find((x) => x.name === "centerId")?.isRequired, `${ten}.centerId`).toBe(true);
      expect(f.find((x) => x.name === "orgUnitId")?.isRequired, `${ten}.orgUnitId`).toBe(false);
    }
    const s = model("PosTxnSource").fields;
    expect(s.find((x) => x.name === "centerId")?.isRequired).toBe(false);
    expect(s.find((x) => x.name === "orgUnitId")?.isRequired).toBe(false);
  });

  it("PosAgent KHÔNG giữ bí mật (T2): không cột secret/hash; có secretVersion Int bắt buộc; merchantCode @unique", () => {
    const f = model("PosAgent").fields;
    const ten = f.map((x) => x.name);
    for (const cam of ["secret", "secretHash", "agentSecret", "biMat", "khoa", "matKhau", "token"]) {
      expect(ten, cam).not.toContain(cam);
    }
    const v = f.find((x) => x.name === "secretVersion");
    expect(v?.type).toBe("Int");
    expect(v?.isRequired).toBe(true);
    expect(f.find((x) => x.name === "merchantCode")?.isUnique).toBe(true);
  });

  it("PosTxnSource KHÔNG lưu ghi chú / số thẻ — chỉ băm; khoá (maGiaoDich, nguon)", () => {
    const ten = model("PosTxnSource").fields.map((x) => x.name);
    for (const cam of ["dienGiai", "soTheMasked", "cardMasked", "tenChuThe", "raw"]) expect(ten, cam).not.toContain(cam);
    expect(ten).toContain("bamDienGiai");
    const u = model("PosTxnSource").uniqueFields;
    expect(u).toContainEqual(["maGiaoDich", "nguon"]);
  });

  it("PosCardTransaction: importBatchId TUỲ CHỌN (T1); maKetToan + maLyDoThatBai mới, tuỳ chọn (T14)", () => {
    const f = model("PosCardTransaction").fields;
    expect(f.find((x) => x.name === "importBatchId")?.isRequired).toBe(false);
    for (const cot of ["maKetToan", "maLyDoThatBai"]) {
      const c = f.find((x) => x.name === cot);
      expect(c?.type, cot).toBe("String");
      expect(c?.isRequired, cot).toBe(false);
    }
  });

  it("enum: phiên · loại sự kiện · trạng thái job · nguồn dữ liệu", () => {
    expect(enumVals("PosAgentSessionState")).toEqual(["READY", "EXPIRED", "UNKNOWN"]);
    expect(enumVals("PosAgentEventType")).toEqual(["HEARTBEAT", "SESSION_READY", "SESSION_EXPIRED", "SYNC", "ERROR"]);
    expect(enumVals("PosCheckJobStatus")).toEqual(["PENDING", "DONE", "EXPIRED"]);
    expect(enumVals("PosDataSource")).toEqual(["FILE", "AGENT"]);
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────
const THU_MUC = resolve(process.cwd(), "prisma/migrations");
const TEN = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_gd4_pos_agent$/.test(d));

function sqlKhongChuThich(): string {
  if (TEN.length !== 1) return "";
  return readFileSync(resolve(THU_MUC, TEN[0]!, "migration.sql"), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*--/.test(d))
    .map((d) => d.replace(/\s--.*$/, ""))
    .join("\n");
}

const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

const BANG_MOI = ["PosAgent", "PosAgentEvent", "PosCheckJob", "PosAgentNonce", "PosTxnSource"] as const;

describe("[POS4-MIG-01] migration GĐ4 — có, chạy lại được, đủ khoá", () => {
  const sql = sqlKhongChuThich();

  it("đúng MỘT thư mục `<ts>_pos_gd4_pos_agent`, tên SAU migration GĐ2 (20261006160000) và sau mốc [MIG-01]", () => {
    // Đo 07/10 bằng git ls-tree 198 nhánh origin/* + nhánh cục bộ + worktree pos-gd3/pos-gd5: lớn nhất
    // 20261006160000_pos_gd2_nhat_ky_kiem. `migrate deploy` áp theo thứ tự TÊN.
    expect(TEN).toHaveLength(1);
    expect(TEN[0]!.slice(0, 14) > "20261006160000").toBe(true);
    expect(TEN[0]!.slice(0, 14) >= "20260928000000").toBe(true);
  });

  it("bốn CREATE TYPE, mỗi cái bọc pg_type, giá trị = enum trong schema.prisma", () => {
    for (const ten of ["PosAgentSessionState", "PosAgentEventType", "PosCheckJobStatus", "PosDataSource"]) {
      const m = sql.match(new RegExp(`CREATE TYPE "${ten}" AS ENUM\\s*\\(([^)]*)\\)`));
      const trongSql = m ? [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!) : [];
      expect(trongSql, ten).toEqual(enumVals(ten));
      expect(dem(sql, new RegExp(`typname = '${ten}'`)), ten).toBe(1);
    }
    expect(dem(sql, /CREATE TYPE/)).toBe(4);
  });

  it("năm bảng + mọi chỉ mục có IF NOT EXISTS; ADD COLUMN có IF NOT EXISTS", () => {
    for (const ten of BANG_MOI) expect(dem(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${ten}"`)), ten).toBe(1);
    expect(dem(sql, /CREATE TABLE (?!IF NOT EXISTS)/)).toBe(0);
    expect(dem(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/)).toBe(0);
    expect(dem(sql, /ADD COLUMN (?!IF NOT EXISTS)/)).toBe(0);
    for (const cot of ["maKetToan", "maLyDoThatBai"]) {
      expect(dem(sql, new RegExp(`ALTER TABLE "PosCardTransaction" ADD COLUMN IF NOT EXISTS "${cot}" TEXT;`)), cot).toBe(1);
    }
  });

  it("chỉ mục duy nhất đúng tên quy ước Prisma", () => {
    expect(dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PosAgent_merchantCode_key" ON "PosAgent"\("merchantCode"\);/)).toBe(1);
    expect(dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PosAgentEvent_khoaGop_key" ON "PosAgentEvent"\("khoaGop"\);/)).toBe(1);
    expect(
      dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PosTxnSource_maGiaoDich_nguon_key" ON "PosTxnSource"\("maGiaoDich", "nguon"\);/),
    ).toBe(1);
    expect(dem(sql, /CREATE UNIQUE INDEX/)).toBe(3);
  });

  it("BẢY CHECK — Prisma không biểu diễn, chỉ có ở đây ([POS4-MIG-02] đo hành vi trên DB)", () => {
    for (const ten of [
      "PosAgent_secretVersion_check",
      "PosAgent_merchantCode_check",
      "PosAgentEvent_ma_check",
      "PosCheckJob_doneAt_check",
      "PosTxnSource_nguon_check",
      "PosTxnSource_tuChoi_check",
      "PosTxnSource_bam_check",
    ]) {
      expect(dem(sql, new RegExp(`CONSTRAINT "${ten}" CHECK`)), ten).toBe(1);
    }
    expect(dem(sql, /CONSTRAINT "\w+" CHECK/)).toBe(7);
    expect(dem(sql, /CHECK \(\("status" = 'DONE'\) = \("doneAt" IS NOT NULL\)\)/)).toBe(1);
    expect(dem(sql, /CHECK \(\("nguon" = 'AGENT'\) = \("posAgentId" IS NOT NULL\)\)/)).toBe(1);
  });

  it("BẢY khoá ngoại bọc pg_constraint: RESTRICT, trừ người tạo (SET NULL) và nonce (CASCADE)", () => {
    expect(dem(sql, /ADD CONSTRAINT "\w+_fkey"/)).toBe(7);
    expect(dem(sql, /conname = '\w+_fkey'/)).toBe(7);
    expect(dem(sql, /ON DELETE RESTRICT/)).toBe(5);
    expect(dem(sql, /"PosAgent_createdById_fkey"\s+FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/)).toBe(1);
    expect(dem(sql, /"PosAgentNonce_agentId_fkey"\s+FOREIGN KEY \("agentId"\) REFERENCES "PosAgent"\("id"\) ON DELETE CASCADE/)).toBe(1);
    expect(dem(sql, /ON DELETE CASCADE/)).toBe(1);
  });

  it("RLS: ENABLE cho cả năm bảng, KHÔNG FORCE, KHÔNG policy", () => {
    for (const ten of BANG_MOI) {
      expect(dem(sql, new RegExp(`ALTER TABLE "${ten}" ENABLE ROW LEVEL SECURITY;`)), ten).toBe(1);
    }
    expect(dem(sql, /FORCE ROW LEVEL SECURITY/)).toBe(0);
    expect(dem(sql, /CREATE POLICY/)).toBe(0);
  });

  it("ADDITIVE + nới ĐÚNG MỘT ràng buộc: chỉ `importBatchId DROP NOT NULL`; không DROP bảng/cột/kiểu, không RENAME", () => {
    expect(dem(sql, /ALTER COLUMN/)).toBe(1);
    expect(dem(sql, /ALTER TABLE "PosCardTransaction" ALTER COLUMN "importBatchId" DROP NOT NULL;/)).toBe(1);
    expect(dem(sql, /DROP (TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|DEFAULT)/)).toBe(0);
    expect(dem(sql, /\bRENAME\b/)).toBe(0);
    expect(dem(sql, /SET DATA TYPE|\bTYPE\s+"?\w+"?\s+USING\b/)).toBe(0);
  });
});

// [Rà đối kháng GĐ4 — RV-04] bảng tạm `PosAgentLoCho` (lô final:false xếp chờ). Migration RIÊNG (GĐ4 gốc có thể đã
// áp ở DB test — sửa tệp đã áp là lệch checksum).
describe("[POS4-RV-04m] migration lô xếp chờ — có, chạy lại được, RLS, CASCADE theo agent, không cột đơn vị", () => {
  const ten = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_gd4_lo_cho_agent$/.test(d));
  const sql =
    ten.length === 1
      ? readFileSync(resolve(THU_MUC, ten[0]!, "migration.sql"), "utf8")
          .split(/\r?\n/)
          .filter((d) => !/^\s*--/.test(d))
          .join("\n")
      : "";

  it("đúng MỘT thư mục, tên SAU migration GĐ4 gốc", () => {
    expect(ten).toHaveLength(1);
    expect(TEN.length === 1 && ten[0]!.slice(0, 14) > TEN[0]!.slice(0, 14)).toBe(true);
  });
  it("IF NOT EXISTS · CHECK + FK bọc pg_constraint · FK CASCADE · RLS ENABLE (không FORCE/policy) · additive", () => {
    expect(dem(sql, /CREATE TABLE IF NOT EXISTS "PosAgentLoCho"/)).toBe(1);
    expect(dem(sql, /CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/)).toBe(0);
    expect(dem(sql, /conname = 'PosAgentLoCho_batchIndex_check'/)).toBe(1);
    expect(dem(sql, /conname = 'PosAgentLoCho_agentId_fkey'/)).toBe(1);
    expect(dem(sql, /REFERENCES "PosAgent"\("id"\) ON DELETE CASCADE/)).toBe(1);
    expect(dem(sql, /ALTER TABLE "PosAgentLoCho" ENABLE ROW LEVEL SECURITY;/)).toBe(1);
    expect(dem(sql, /FORCE ROW LEVEL SECURITY|CREATE POLICY|\bDROP\b|\bRENAME\b|"centerId"|"orgUnitId"/)).toBe(0);
  });
});

// [Chốt hợp đồng GĐ4 ↔ GĐ5 — RV5.4 #4] cột `PosAgent.duLieuDenLuc` ("dữ liệu đã đọc tới" = windowTo của lô final).
// Migration RIÊNG (hai migration GĐ4 trước có thể đã áp ở DB test — sửa tệp đã áp là lệch checksum).
describe("[POS4-CHOT-m] cột 'dữ liệu đã đọc tới' — migration riêng, additive, chạy lại được; schema khớp", () => {
  const ten = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_gd4_du_lieu_den_luc$/.test(d));
  const sql =
    ten.length === 1
      ? readFileSync(resolve(THU_MUC, ten[0]!, "migration.sql"), "utf8")
          .split(/\r?\n/)
          .filter((d) => !/^\s*--/.test(d))
          .join("\n")
      : "";

  it("đúng MỘT thư mục, tên SAU migration lô xếp chờ (20261007130000)", () => {
    expect(ten).toHaveLength(1);
    expect(ten[0]!.slice(0, 14) > "20261007130000").toBe(true);
  });
  it("ĐÚNG một ADD COLUMN IF NOT EXISTS TIMESTAMPTZ(6) nullable; không DROP / RENAME / đổi kiểu / NOT NULL / DEFAULT", () => {
    expect(dem(sql, /ALTER TABLE "PosAgent" ADD COLUMN IF NOT EXISTS "duLieuDenLuc" TIMESTAMPTZ\(6\);/)).toBe(1);
    expect(dem(sql, /ADD COLUMN/)).toBe(1);
    expect(dem(sql, /\bDROP\b|\bRENAME\b|SET DATA TYPE|NOT NULL|DEFAULT|CREATE TABLE|UPDATE "/)).toBe(0);
  });
  it("Prisma: PosAgent.duLieuDenLuc DateTime tuỳ chọn (đo dmmf)", () => {
    const c = model("PosAgent").fields.find((x) => x.name === "duLieuDenLuc");
    expect(c?.type).toBe("DateTime");
    expect(c?.isRequired).toBe(false);
  });
});

// [R9 — 07/10/2026] cột `PosAgentLoCho.huyTuChoi` (tín hiệu hủy/hoàn bị từ chối của lô xếp chờ). Migration RIÊNG (hai
// migration lô chờ / dữ liệu-đến-lúc có thể đã áp ở DB test — sửa tệp đã áp là lệch checksum).
describe("[POS4-R9m] cột tín hiệu hủy bị từ chối của lô chờ — migration riêng, additive, chạy lại được; schema khớp", () => {
  const ten = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_gd4_lo_cho_huy_tu_choi$/.test(d));
  const sql =
    ten.length === 1
      ? readFileSync(resolve(THU_MUC, ten[0]!, "migration.sql"), "utf8")
          .split(/\r?\n/)
          .filter((d) => !/^\s*--/.test(d))
          .join("\n")
      : "";

  it("đúng MỘT thư mục, tên SAU migration 'dữ liệu đến lúc' (20261007140000)", () => {
    expect(ten).toHaveLength(1);
    expect(ten[0]!.slice(0, 14) > "20261007140000").toBe(true);
  });
  it("ĐÚNG một ADD COLUMN IF NOT EXISTS JSONB nullable; không DROP / RENAME / đổi kiểu / NOT NULL / DEFAULT / UPDATE", () => {
    expect(dem(sql, /ALTER TABLE "PosAgentLoCho" ADD COLUMN IF NOT EXISTS "huyTuChoi" JSONB;/)).toBe(1);
    expect(dem(sql, /ADD COLUMN/)).toBe(1);
    expect(dem(sql, /\bDROP\b|\bRENAME\b|SET DATA TYPE|NOT NULL|DEFAULT|CREATE TABLE|UPDATE "|"centerId"|"orgUnitId"/)).toBe(0);
  });
  it("Prisma: PosAgentLoCho.huyTuChoi Json tuỳ chọn (đo dmmf)", () => {
    const c = model("PosAgentLoCho").fields.find((x) => x.name === "huyTuChoi");
    expect(c?.type).toBe("Json");
    expect(c?.isRequired).toBe(false);
  });
});
