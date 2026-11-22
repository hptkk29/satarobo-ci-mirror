// Ca [HN3-DECL-01..06] — VIỆC 3: bảng YÊU CẦU XÁC NHẬN GIAO DỊCH NHẬP SAI MÃ (`PosSaiMaYeuCau`) phải được KHAI ĐỦ mọi chỗ.
// Thuần, không DB.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.4. Hành vi THẬT của các khoá (RLS, hai UNIQUE từng phần, năm CHECK, khoá ngoại,
// cách ly scopedDb) đo trên Postgres ở `tests/finance/pos-sai-ma-schema.test.ts` — lưới ở đây chỉ bảo đảm khai báo không biến
// mất. Vì sao cần cả hai tầng (F5 GĐ1): `prisma migrate diff` KHÔNG in CHECK lẫn UNIQUE từng phần ⇒ "drift 0 dòng" không chứng
// minh chúng tồn tại.
//
// Phần soi migration là LƯỚI GHIM MÃ NGUỒN (luật 11): bóc chú thích SQL `--` trước khi soi, neo chuỗi hẹp, khẳng định SỐ LẦN khớp.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, SCOPE_EXEMPT, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../../prisma/seed-roles";
import { chuyenHopLe, type KieuSaiMa, type TrangThaiSaiMa } from "./sai-ma";

const MODEL = "PosSaiMaYeuCau";

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
describe("[HN3-DECL-01..03] PosSaiMaYeuCau khai đủ BA chỗ của luật cách ly cơ sở", () => {
  it("[HN3-DECL-01] ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS, KHÔNG ∈ SCOPE_EXEMPT", () => {
    // `centerId` NOT NULL (= cơ sở của ĐƠN) ⇒ NULL không mang nghĩa "dùng chung".
    expect(SCOPED_MODELS.has(MODEL)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(MODEL)).toBe(false);
    expect(SCOPE_EXEMPT.has(MODEL)).toBe(false);
  });

  it("[HN3-DECL-02] getModelPrefixes = ['payments:'] — cùng họ với PosPaymentIntent", () => {
    // Trống thì rơi về `isHoLevel ? ALL : visibleCenterIds`: ai có MỘT vai neo tại Hội sở, kể cả vai chẳng liên quan tiền, đọc
    // được yêu cầu xác nhận thu thẻ (mã phiếu, ghi chú gõ trên máy) của mọi cơ sở.
    expect(getModelPrefixes(MODEL)).toEqual(["payments:"]);
    expect(getModelPrefixes(MODEL)).toEqual(getModelPrefixes("PosPaymentIntent"));
  });

  it("[HN3-DECL-03] BACKFILL_SPECS: đúng MỘT mục, BAT_BUOC, scoped = true ⇒ ghi kép orgUnitId tự chạy", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === MODEL);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.nullMeaning).toBe("BAT_BUOC");
    expect(spec[0]!.scoped).toBe(true);
    expect(DUAL_WRITE_MODELS.has(MODEL)).toBe(true);
  });
});

// ─── Hình dạng model ─────────────────────────────────────────────────────────
describe("[HN3-DECL-06] hình dạng cột — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it("CẢ centerId (BẮT BUỘC) lẫn orgUnitId (tuỳ chọn) — luật cứng #3 giữ cả hai cột", () => {
    const f = model(MODEL).fields;
    expect(f.find((x) => x.name === "centerId")?.isRequired, "centerId phải NOT NULL").toBe(true);
    expect(f.find((x) => x.name === "orgUnitId")?.isRequired).toBe(false);
  });

  it("createdAt BẮT BUỘC và KHÔNG default (app đặt = now — luật 19); dangGhiLuc/quyetLuc tuỳ chọn", () => {
    const f = model(MODEL).fields;
    const tao = f.find((x) => x.name === "createdAt");
    expect(tao?.isRequired).toBe(true);
    expect(tao?.hasDefaultValue, "createdAt không được có default: đồng hồ do ứng dụng truyền").toBe(false);
    expect(f.find((x) => x.name === "dangGhiLuc")?.isRequired).toBe(false);
    expect(f.find((x) => x.name === "quyetLuc")?.isRequired).toBe(false);
    expect(f.find((x) => x.name === "nguoiQuyetId")?.isRequired).toBe(false);
    expect(f.find((x) => x.name === "lyDoTuChoi")?.isRequired).toBe(false);
  });

  it("một cặp (phiếu, giao dịch) chỉ MỘT dòng: @@unique([intentId, bankTransactionId])", () => {
    expect(model(MODEL).uniqueFields.map((u) => [...u])).toContainEqual(["intentId", "bankTransactionId"]);
  });

  it("bốn quan hệ ĐỀU Restrict (xoá phiếu / giao dịch / người mà còn yêu cầu trỏ vào là mất dấu một khoản tiền thật)", () => {
    const quanHe = model(MODEL).fields.filter((x) => x.kind === "object");
    expect(quanHe.map((x) => x.name).sort()).toEqual(["bankTransaction", "intent", "nguoiGui", "nguoiQuyet"]);
    for (const q of quanHe) expect(q.relationOnDelete, q.name).toBe("Restrict");
  });

  it("enum trong Prisma = enum dùng ở tầng thuần (`sai-ma.ts`); ma trận chuyển trạng thái phủ MỌI giá trị", () => {
    expect(enumVals("PosSaiMaKieu")).toEqual(["TU_GHI_NHAN", "CHO_KE_TOAN"] satisfies KieuSaiMa[]);
    expect(enumVals("PosSaiMaTrangThai")).toEqual(["CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN", "TU_CHOI"] satisfies TrangThaiSaiMa[]);
    for (const tu of enumVals("PosSaiMaTrangThai") as TrangThaiSaiMa[]) {
      for (const den of enumVals("PosSaiMaTrangThai") as TrangThaiSaiMa[]) {
        expect(typeof chuyenHopLe(tu, den), `${tu}→${den}`).toBe("boolean");
      }
    }
  });

  it("hai trường ngược trên PosPaymentIntent / BankTransaction / User — KHÔNG thêm cột nào vào các bảng PROD đó", () => {
    expect(model("PosPaymentIntent").fields.find((x) => x.name === "saiMaYeuCau")?.relationName).toBeDefined();
    expect(model("BankTransaction").fields.find((x) => x.name === "posSaiMaYeuCau")?.relationName).toBeDefined();
    expect(model("User").fields.find((x) => x.name === "posSaiMaGui")?.relationName).toBe("PosSaiMaNguoiGui");
    expect(model("User").fields.find((x) => x.name === "posSaiMaQuyet")?.relationName).toBe("PosSaiMaNguoiQuyet");
    // Trường ngược của quan hệ KHÔNG có cột vật lý: cột scalar của ba bảng không đổi (khoá `intentId`… chỉ ở bảng mới).
    for (const ten of ["PosPaymentIntent", "BankTransaction", "User"]) {
      expect(model(ten).fields.filter((x) => x.kind === "scalar").map((x) => x.name), ten).not.toContain("saiMaYeuCauId");
    }
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────
const THU_MUC = resolve(process.cwd(), "prisma/migrations");
const TEN = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_sai_ma_yeu_cau$/.test(d));

function sqlKhongChuThich(): string {
  if (TEN.length !== 1) return "";
  return readFileSync(resolve(THU_MUC, TEN[0]!, "migration.sql"), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*--/.test(d))
    .map((d) => d.replace(/\s--.*$/, ""))
    .join("\n");
}

const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[HN3-DECL-04] migration yêu cầu xác nhận sai mã — có, chạy lại được, đủ khoá", () => {
  const sql = sqlKhongChuThich();

  it("[HN3-DECL-05] đúng MỘT thư mục `<ts>_pos_sai_ma_yeu_cau`; tên LỚN HƠN migration GĐ1 (khoá ngoại) và hơn mốc origin/test lúc đo; không trùng mốc với migration khác", () => {
    // 10/10 (chủ dự án chốt): đổi 20261015090000 → 20261010090000. Điều bắt buộc KHÔNG phải "lớn nhất mọi nhánh" (các nhánh Nguồn
    // có 20261009…20261014 và độc lập về dữ liệu) mà là: (1) sau pos_payment_intent — `migrate deploy` áp theo thứ tự TÊN, nhỏ
    // hơn là khoá ngoại sang bảng chưa có; (2) lớn hơn migration cuối của origin/test lúc đo (20261008190000_buoi_hoc_nguon_don_tu)
    // — quy ước prisma-db.md "dấu thời gian phải LỚN HƠN migration cuối cùng đang có" (ĐO 10/10 trên Prisma 5: `migrate deploy` VẪN áp
    // một migration tên nhỏ hơn bản đã áp, `migrate status` chỉ báo "chưa áp" chứ không báo drift — nên đây là quy ước, không phải
    // cổng an toàn); (3) không trùng mốc 14 chữ số với bản nào khác.
    expect(TEN).toHaveLength(1);
    const ts = TEN[0]!.slice(0, 14);
    expect(ts > "20261008190000", "phải lớn hơn migration cuối của origin/test lúc đo").toBe(true);
    const gd1 = readdirSync(THU_MUC).filter((d) => /^\d{14}_pos_payment_intent$/.test(d));
    expect(gd1, "thiếu migration GĐ1 `pos_payment_intent` trong cây").toHaveLength(1);
    expect(ts > gd1[0]!.slice(0, 14), "phải sau migration GĐ1 (khoá ngoại sang PosPaymentIntent)").toBe(true);
    const khac = readdirSync(THU_MUC).filter((d) => /^\d{14}_/.test(d) && d !== TEN[0]);
    expect(khac.filter((d) => d.slice(0, 14) === ts), "trùng mốc với migration khác").toEqual([]);
  });

  it("enum: hai CREATE TYPE bọc DO + pg_type, giá trị khớp schema.prisma", () => {
    expect(dem(sql, /CREATE TYPE "PosSaiMaKieu" AS ENUM/)).toBe(1);
    expect(dem(sql, /CREATE TYPE "PosSaiMaTrangThai" AS ENUM/)).toBe(1);
    expect(dem(sql, /typname = 'PosSaiMaKieu'/)).toBe(1);
    expect(dem(sql, /typname = 'PosSaiMaTrangThai'/)).toBe(1);
    for (const ten of ["PosSaiMaKieu", "PosSaiMaTrangThai"]) {
      const m = sql.match(new RegExp(`CREATE TYPE "${ten}" AS ENUM\\s*\\(([^)]*)\\)`));
      const trongSql = m ? [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!) : [];
      expect(trongSql, ten).toEqual(enumVals(ten));
    }
  });

  it("bảng + ba chỉ mục thường + chỉ mục cặp có IF NOT EXISTS, đúng tên quy ước Prisma; createdAt KHÔNG default", () => {
    expect(dem(sql, /CREATE TABLE IF NOT EXISTS "PosSaiMaYeuCau"/)).toBe(1);
    expect(dem(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/)).toBe(0);
    expect(dem(sql, /"createdAt"\s+TIMESTAMPTZ\(6\) NOT NULL,/)).toBe(1);
    expect(dem(sql, /"createdAt"\s+TIMESTAMPTZ\(6\) NOT NULL DEFAULT/)).toBe(0);
    expect(dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PosSaiMaYeuCau_intentId_bankTransactionId_key"\s+ON "PosSaiMaYeuCau"\("intentId", "bankTransactionId"\);/)).toBe(1);
    for (const [ten, cot] of [
      ["PosSaiMaYeuCau_centerId_trangThai_createdAt_idx", '"centerId", "trangThai", "createdAt"'],
      ["PosSaiMaYeuCau_bankTransactionId_idx", '"bankTransactionId"'],
      ["PosSaiMaYeuCau_orgUnitId_idx", '"orgUnitId"'],
    ] as const) {
      expect(dem(sql, new RegExp(`CREATE INDEX IF NOT EXISTS "${ten}" ON "PosSaiMaYeuCau"\\(${cot}\\);`)), ten).toBe(1);
    }
  });

  it("HAI UNIQUE TỪNG PHẦN: một giao dịch / một phiếu chỉ một yêu cầu không-TU_CHOI", () => {
    expect(
      dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PosSaiMaYeuCau_giao_dich_giu_key"\s+ON "PosSaiMaYeuCau"\("bankTransactionId"\) WHERE "trangThai" <> 'TU_CHOI';/),
    ).toBe(1);
    expect(
      dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PosSaiMaYeuCau_phieu_giu_key"\s+ON "PosSaiMaYeuCau"\("intentId"\) WHERE "trangThai" <> 'TU_CHOI';/),
    ).toBe(1);
    expect(dem(sql, /WHERE "trangThai" <> 'TU_CHOI'/)).toBe(2);
  });

  it("NĂM CHECK: từ chối cần người+lúc+lý do · người quyết ≠ người gửi · chờ kế toán cần lý do · đang ghi cần mốc · đã duyệt cần người duyệt", () => {
    expect(dem(sql, /CONSTRAINT "PosSaiMaYeuCau_tu_choi_check" CHECK \(/)).toBe(1);
    expect(dem(sql, /char_length\(btrim\(COALESCE\("lyDoTuChoi", ''\)\)\) >= 5/)).toBe(1);
    expect(dem(sql, /CONSTRAINT "PosSaiMaYeuCau_khac_nguoi_check" CHECK \("nguoiQuyetId" IS NULL OR "nguoiQuyetId" <> "nguoiGuiId"\)/)).toBe(1);
    expect(dem(sql, /CONSTRAINT "PosSaiMaYeuCau_ly_do_check" CHECK \("kieu" <> 'CHO_KE_TOAN' OR char_length\("lyDo"\) > 0\)/)).toBe(1);
    expect(dem(sql, /CONSTRAINT "PosSaiMaYeuCau_dang_ghi_check" CHECK \("trangThai" <> 'DANG_GHI' OR "dangGhiLuc" IS NOT NULL\)/)).toBe(1);
    expect(dem(sql, /CONSTRAINT "PosSaiMaYeuCau_nguoi_duyet_check" CHECK \(/)).toBe(1);
    expect(dem(sql, /\bCHECK \(/)).toBe(5);
  });

  it("BỐN khoá ngoại bọc pg_constraint, ĐỀU RESTRICT — không CASCADE, không SET NULL", () => {
    expect(dem(sql, /ADD CONSTRAINT "PosSaiMaYeuCau_\w+_fkey"/)).toBe(4);
    expect(dem(sql, /conname = 'PosSaiMaYeuCau_\w+_fkey'/)).toBe(4);
    expect(dem(sql, /ON DELETE RESTRICT ON UPDATE CASCADE/)).toBe(4);
    expect(dem(sql, /ON DELETE CASCADE/)).toBe(0);
    expect(dem(sql, /ON DELETE SET NULL/)).toBe(0);
    for (const [cot, bang] of [
      ["intentId", "PosPaymentIntent"],
      ["bankTransactionId", "BankTransaction"],
      ["nguoiGuiId", "User"],
      ["nguoiQuyetId", "User"],
    ] as const) {
      expect(dem(sql, new RegExp(`"PosSaiMaYeuCau_${cot}_fkey"\\s+FOREIGN KEY \\("${cot}"\\) REFERENCES "${bang}"\\("id"\\)`)), cot).toBe(1);
    }
  });

  it("RLS: ENABLE đúng một lần, KHÔNG FORCE, KHÔNG policy", () => {
    expect(dem(sql, /ALTER TABLE "PosSaiMaYeuCau" ENABLE ROW LEVEL SECURITY;/)).toBe(1);
    expect(dem(sql, /FORCE ROW LEVEL SECURITY/)).toBe(0);
    expect(dem(sql, /CREATE POLICY/)).toBe(0);
  });

  it("ADDITIVE: chỉ ALTER chính bảng mới; không DROP, không đổi kiểu, không đổi tên — KHÔNG đụng PosPaymentIntent/BankTransaction/User", () => {
    const alter = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(alter)).toEqual(new Set(["PosSaiMaYeuCau"]));
    expect(dem(sql, /\bDROP\b/)).toBe(0);
    expect(dem(sql, /ALTER COLUMN/)).toBe(0);
    expect(dem(sql, /\bRENAME\b/)).toBe(0);
    expect(dem(sql, /ADD COLUMN/)).toBe(0);
    // Không chạm DỮ LIỆU có sẵn (không backfill): câu lệnh DML đứng đầu dòng. `ON DELETE …`/`ON UPDATE …` của khoá ngoại không tính.
    expect(sql.split("\n").filter((d) => /^\s*(?:UPDATE|INSERT|DELETE)\b/.test(d))).toEqual([]);
  });
});

// ─── Quyền: KHÔNG đẻ quyền mới; ai gửi, ai duyệt ─────────────────────────────
// Đo từ `ROLE_SEED` (nguồn của RBAC v2 trên prod — `seed-prod-roles.yml`), không đọc chú thích. Việc 3 dùng lại hai khoá có sẵn:
//   · sale GỬI      = `payments:pos-check` (đúng quyền của nút "Thẻ POS" / "Kiểm tra thanh toán");
//   · kế toán DUYỆT = `payments:manage` (V58) — KHÔNG `payments:record`: vai sale cũng giữ `record`, dùng nó là để đồng nghiệp sale
//     duyệt yêu cầu của sale.
// Hệ quả đo được 09/10/2026 (ghi vào đây để ai đổi seed thấy ngay lời hứa nào đổi theo):
//   · CENTER_MANAGER có `pos-check` mà KHÔNG có `manage` ⇒ gửi được, KHÔNG duyệt được;
//   · CENTER_ACCOUNTANT có `manage` mà KHÔNG có `pos-check` ⇒ duyệt được, KHÔNG gửi được;
//   · HO_ACCOUNTANT có CẢ HAI ⇒ vừa gửi vừa duyệt được — chỉ có "người duyệt ≠ người gửi" (lib + CHECK của DB) chặn tự duyệt.
describe("[HN3-PERM] quyền của Việc 3 — dùng khoá có sẵn, đối chứng dương/âm theo vai", () => {
  const vaiCo = (khoa: string) => ROLE_SEED.filter((r) => r.perms.some((p) => p.action === khoa)).map((r) => r.code).sort();
  const co = (vai: string, khoa: string) => ROLE_SEED.find((r) => r.code === vai)?.perms.some((p) => p.action === khoa) ?? false;

  it("[HN3-PERM-01] KHÔNG khoá quyền nào mới: không `ROLE_SEED` nào mang action chứa 'sai-ma'; ngoài ra v1 `PERMISSIONS` cũng không", () => {
    const moi = ROLE_SEED.flatMap((r) => r.perms.filter((p) => /sai-ma/i.test(p.action)).map((p) => `${r.code}:${p.action}`));
    expect(moi).toEqual([]);
    expect(Object.keys(PERMISSIONS).filter((k) => /sai-ma/i.test(k))).toEqual([]);
  });

  it("[HN3-PERM-02] `payments:manage` — đúng HAI vai kế toán; sale/GV/quản lý lớp KHÔNG có", () => {
    expect(vaiCo("payments:manage")).toEqual(["CENTER_ACCOUNTANT", "HO_ACCOUNTANT"]);
    for (const vai of ["CENTER_SALES_CSM", "HO_SALE", "TEACHER", "ASSISTANT_TEACHER", "CENTER_CLASS_MANAGER", "CENTER_MANAGER"]) {
      expect(co(vai, "payments:manage"), `${vai} không được duyệt`).toBe(false);
    }
  });

  it("[HN3-PERM-03] `payments:pos-check` — sale cơ sở · quản lý cơ sở · kế toán HO; kế toán CƠ SỞ không có", () => {
    expect(vaiCo("payments:pos-check")).toEqual(["CENTER_MANAGER", "CENTER_SALES_CSM", "HO_ACCOUNTANT"]);
    expect(co("CENTER_ACCOUNTANT", "payments:pos-check")).toBe(false);
  });

  it("[HN3-PERM-04] ĐỐI CHỨNG: dùng `payments:record` để duyệt sẽ cho SALE duyệt — đó là lý do chọn `payments:manage`", () => {
    expect(co("CENTER_SALES_CSM", "payments:record"), "sale GIỮ record").toBe(true);
    expect(co("CENTER_SALES_CSM", "payments:manage")).toBe(false);
    // Vai vừa gửi vừa duyệt được: chỉ HO_ACCOUNTANT (và SUPER_ADMIN bypass) ⇒ luật 'người duyệt ≠ người gửi' là phần BẮT BUỘC.
    const vuaGuiVuaDuyet = vaiCo("payments:manage").filter((v) => co(v, "payments:pos-check"));
    expect(vuaGuiVuaDuyet).toEqual(["HO_ACCOUNTANT"]);
  });
});
