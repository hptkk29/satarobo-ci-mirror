// @vitest-environment node
/**
 * LƯỚI GHIM MÃ NGUỒN của lõi hoa hồng PR4 + kiểm tĩnh `migration.sql`.
 *
 *   [NHH-W3]   trần đọc từ setting và TRUYỀN vào; không số 0.08/0.09 gõ cứng trong mã chạy
 *   [NHH-W4]   không chép bộ lọc thực thu (`accountantStatus: { in`) trong lib/hoa-hong
 *   [NHH-W10]  `$transaction` của lib/hoa-hong: từ chối = `throw`; phép ghi ĐẦU TIÊN của mỗi callback là cập nhật có điều kiện
 *   [NHH-W12]  không đọc đồng hồ thật; service không kiểm quyền / không là Server Action (ghi chú ở đầu tệp)
 *   [NHH-POL-H18] lõi mới KHÔNG dùng magic number 5/6/7/8 của văn bản 06/10 — mã vai ngữ nghĩa
 *   [NHH-POL-MIG-03..05] migration: bảng mới có RLS, CHECK đủ tên, seed khớp hằng TS, không đụng bảng có sẵn
 *
 * Quy tắc viết lưới (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN"): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số
 * lần khớp, không cờ `/s`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MASTER_LOAI_GIAO_DICH } from "./loai-giao-dich";
import { MASTER_VAI_HUONG } from "./vai-huong";

const GOC = resolve(process.cwd(), "lib/hoa-hong");

function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Mọi tệp mã của lib/hoa-hong, KHÔNG gồm test. */
function maChay(): { ten: string; code: string }[] {
  return readdirSync(GOC)
    .filter((f) => f.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f))
    .map((ten) => ({ ten, code: boChuThich(readFileSync(resolve(GOC, ten), "utf8")) }));
}

/** Bỏ chú thích SQL `-- …`. */
const boSql = (s: string) => s.replace(/--[^\n]*/g, "");

const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

describe("[NHH-W3] trần hoa hồng", () => {
  it("[NHH-W3] đọc `getSetting(\"crm.commissionMaxTotalRate\")` ở tầng DB (≥1 chỗ) và KHÔNG ở hàm thuần", () => {
    const tep = maChay();
    const goi = tep.filter((t) => dem(t.code, /getSetting\(\s*"crm\.commissionMaxTotalRate"\s*\)/) > 0);
    expect(goi.map((t) => t.ten).sort()).toEqual(["chinh-sach-service.ts"]);
    // docHoaHongContext + dauVaoKichHoat + docTranHoaHong (hàm đọc trần dùng chung của tầng ĐỌC của tab Chính sách — PR8: tầng đọc
    // không được tự gọi getSetting, nếu không có hai nơi đọc trần là hai nơi có thể lệch khoá)
    expect(dem(goi[0]!.code, /getSetting\(\s*"crm\.commissionMaxTotalRate"\s*\)/)).toBe(3);
  });

  it("[NHH-W3] không có hằng trần gõ cứng (0.08 / 0.09 / MAX_TOTAL_RATE) trong mã chạy; `tranTongTiLe` không có mặc định", () => {
    for (const t of maChay()) {
      expect(dem(t.code, /\b0\.0[89]\b/), `${t.ten}: số 0.08/0.09`).toBe(0);
      expect(dem(t.code, "MAX_TOTAL_RATE"), `${t.ten}: MAX_TOTAL_RATE`).toBe(0);
      expect(dem(t.code, /tranTongTiLe\s*(?:\?|=)(?!=)/), `${t.ten}: tranTongTiLe tuỳ chọn/mặc định`).toBe(0);
    }
  });
});

describe("[NHH-W4] thực thu", () => {
  it("[NHH-W4] lib/hoa-hong không tự viết bộ lọc thực thu (`accountantStatus: { in`)", () => {
    for (const t of maChay()) {
      expect(dem(t.code, /accountantStatus\s*:\s*\{\s*in/), t.ten).toBe(0);
    }
  });
});

describe("[NHH-W10] giao dịch an toàn", () => {
  it("[NHH-W10] không callback `$transaction` nào trong lib/hoa-hong dùng hình dạng TỪ CHỐI bằng `return` (chỉ `throw`)", () => {
    // Chỉ các tệp CÓ `$transaction`: hình `return { ok: false, … }` / `return { loi: … }` là cách trả kết quả bình thường của hàm thuần
    // và của lớp điều phối Server Action (PR8) — chúng không mở transaction, nên không có gì để "đã commit mà báo từ chối".
    for (const t of maChay().filter((x) => x.code.includes("$transaction"))) {
      expect(dem(t.code, /\breturn\s*(?:\{\s*(?:ok:\s*false|loi:)|fail\()/), t.ten).toBe(0);
    }
  });

  it("[NHH-W10] mọi `updateMany` đổi trạng thái version có điều kiện `status:` hoặc `firstUsedAt: null` (chống đua)", () => {
    const sv = maChay().find((t) => t.ten === "chinh-sach-service.ts")!.code;
    const cacLan = sv.match(/commissionPolicyVersion\.updateMany\(\{[^}]*\}/g) ?? [];
    expect(cacLan.length).toBeGreaterThanOrEqual(6);
    for (const l of cacLan) expect(/status\s*:|firstUsedAt\s*:\s*null/.test(l), l).toBe(true);
  });

  it("[NHH-W10] `danhDauDaDung` nhận `tx` BẮT BUỘC (không mặc định) và chỉ ghi khi `firstUsedAt: null`", () => {
    const sv = maChay().find((t) => t.ten === "chinh-sach-service.ts")!.code;
    expect(dem(sv, /export async function danhDauDaDung\(tx: Tx, versionId: string, at: Date\)/)).toBe(1);
    expect(dem(sv, /updateMany\(\{\s*where:\s*\{\s*id:\s*versionId,\s*firstUsedAt:\s*null\s*\}/)).toBe(1);
  });
});

describe("[NHH-W13] đổi tập version ACTIVE đi qua khoá advisory", () => {
  const sv = () => maChay().find((t) => t.ten === "chinh-sach-service.ts")!.code;
  /** Thân từ `export async function <ten>(` tới `export ` kế tiếp. */
  const than = (code: string, ten: string): string => {
    const a = code.indexOf(`export async function ${ten}(`);
    expect(a, ten).toBeGreaterThan(-1);
    const b = code.indexOf("\nexport ", a + 10);
    return code.slice(a, b === -1 ? undefined : b);
  };

  it("[NHH-W13] `kichHoat` và `choHetHieuLuc` đều lấy khoá advisory TRONG transaction, MỘT lần mỗi hàm", () => {
    expect(dem(than(sv(), "kichHoat"), "await khoaChinhSach(tx)")).toBe(1);
    expect(dem(than(sv(), "choHetHieuLuc"), "await khoaChinhSach(tx)")).toBe(1);
    // và không hàm nào khác đổi tập ACTIVE mà thiếu khoá: chỉ HAI nơi gọi
    expect(dem(sv(), "khoaChinhSach(tx)")).toBe(2);
  });

  it("[NHH-W13] khoá lấy bằng `$executeRaw` (pg_advisory_xact_lock trả void — `$queryRaw` ném), băm cùng MỘT hằng", () => {
    const code = sv();
    expect(dem(code, /\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{KHOA_ADVISORY_CHINH_SACH\}\)::bigint\)`/)).toBe(1);
    expect(dem(code, /\$queryRaw`SELECT pg_advisory/)).toBe(0);
  });

  it("[NHH-W13] cổng kích hoạt so lại dấu vân tay tập ACTIVE + updatedAt của nháp + khoá hàng version, đều TRƯỚC `updateMany` đầu tiên", () => {
    const k = than(sv(), "kichHoat");
    const iUpd = k.indexOf("commissionPolicyVersion.updateMany(");
    expect(iUpd).toBeGreaterThan(-1);
    for (const cong of ["FOR UPDATE", "hienTai.updatedAt.getTime() !== v.updatedAt.getTime()", "vanTayTapActive(dangActive) !== vanTay", '"TAP_HIEU_LUC_DA_DOI"']) {
      expect(dem(k, cong), cong).toBe(1);
      expect(k.indexOf(cong), `${cong} phải đứng trước phép ghi đầu tiên`).toBeLessThan(iUpd);
    }
    // `VERSION_DA_DOI` có HAI cổng, cả hai trước phép ghi đầu tiên: (1) mốc người duyệt đã thấy (`input.updatedAtDaThay`, đứng trước cả lần đọc
    // guardrail) và (2) `updatedAt` đọc lại TRONG transaction (nháp đổi giữa lúc guardrail đọc và lúc ghi).
    expect(dem(k, '"VERSION_DA_DOI"'), "VERSION_DA_DOI").toBe(2);
    expect(k.lastIndexOf('"VERSION_DA_DOI"'), "cả hai cổng VERSION_DA_DOI trước phép ghi đầu tiên").toBeLessThan(iUpd);
    expect(dem(k, "input.updatedAtDaThay && v.updatedAt.getTime() !== input.updatedAtDaThay.getTime()"), "mốc người duyệt đã thấy").toBe(1);
  });
});

describe("[NHH-W12] đồng hồ và quyền", () => {
  it("[NHH-W12] không `Date.now` / `new Date()` trong mã chạy (luật 19: `now` là tham số)", () => {
    for (const t of maChay()) {
      expect(dem(t.code, "Date.now"), t.ten).toBe(0);
      expect(dem(t.code, "new Date()"), t.ten).toBe(0);
    }
  });

  it("[NHH-W12] service không phải Server Action và không gọi `auth(` / `assertCan` (quyền gác ở PR8)", () => {
    const sv = readFileSync(resolve(GOC, "chinh-sach-service.ts"), "utf8");
    expect(dem(boChuThich(sv), /["']use server["']/)).toBe(0);
    expect(dem(boChuThich(sv), /\bassertCan\(|\bauth\(/)).toBe(0);
    // và lời cảnh báo đó có mặt ở đầu tệp để người đọc sau không tưởng đây là cổng quyền
    expect(sv.slice(0, 1500)).toContain("KHÔNG KIỂM QUYỀN");
  });
});

describe("[NHH-POL-H18] không magic number 5/6/7/8", () => {
  it("[NHH-POL-H18] lõi hoa hồng không dùng số thứ tự nhóm nguồn của văn bản 06/10", () => {
    for (const t of maChay()) {
      expect(dem(t.code, /\[\s*5\s*,\s*6\s*,\s*7\s*,\s*8\s*\]/), `${t.ten}: [5,6,7,8]`).toBe(0);
      expect(dem(t.code, /\bdocumentNo\b/), `${t.ten}: documentNo`).toBe(0);
      expect(dem(t.code, /nhóm\s*[5-8]\b/i), `${t.ten}: "nhóm 5..8"`).toBe(0);
    }
  });
});

describe("[NHH-POL-MIG] migration 20261014100000_hoa_hong_chinh_sach (đọc tệp)", () => {
  const thuMuc = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((d) => d.endsWith("_hoa_hong_chinh_sach"));
  const sql = () => readFileSync(resolve(process.cwd(), "prisma/migrations", thuMuc[0]!, "migration.sql"), "utf8");
  const BANG = ["BeneficiaryRole", "CommissionTransactionType", "RegulationDocument", "CommissionPolicy", "CommissionPolicyVersion", "CommissionRule"];

  it("[NHH-POL-MIG-03] đúng MỘT thư mục; timestamp lớn hơn migration nguồn lead (20261014090000)", () => {
    expect(thuMuc).toHaveLength(1);
    expect(thuMuc[0]!.slice(0, 14) > "20261014090000").toBe(true);
  });

  it("[NHH-POL-MIG-04] mỗi bảng MỚI: CREATE TABLE IF NOT EXISTS + ENABLE ROW LEVEL SECURITY; không FORCE; không DROP/ALTER bảng có sẵn", () => {
    const s = boSql(sql());
    for (const b of BANG) {
      expect(dem(s, `CREATE TABLE IF NOT EXISTS "${b}"`), `${b}: create`).toBe(1);
      expect(dem(s, `ALTER TABLE "${b}" ENABLE ROW LEVEL SECURITY;`), `${b}: RLS`).toBe(1);
    }
    expect(dem(s, /FORCE ROW LEVEL SECURITY/i)).toBe(0);
    expect(dem(s, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i)).toBe(0);
    // ALTER TABLE chỉ trên bảng mới của chính migration này
    const alterTren = [...s.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]!);
    expect(alterTren.every((t) => BANG.includes(t))).toBe(true);
    expect(dem(s, /\bUPDATE\s+"/i)).toBe(0); // không backfill
  });

  it("[NHH-POL-MIG-05] đủ CHECK có tên + chỗ ghi `scopeSourceId` CHƯA có (PR8)", () => {
    const s = boSql(sql());
    for (const c of [
      "CommissionTransactionType_bat_chk",
      "CommissionPolicyVersion_van_ban_chk",
      "CommissionPolicyVersion_hieu_luc_chk",
      "CommissionPolicyVersion_pham_vi_chk",
      "CommissionRule_cach_tinh_chk",
    ]) {
      expect(dem(s, `'${c}'`), c).toBe(1); // kiểm pg_constraint để chạy lại được
      expect(dem(s, `ADD CONSTRAINT "${c}"`), c).toBe(1);
    }
    expect(dem(s, "scopeSourceId")).toBe(0);
    // SOURCE/CAMPAIGN/EVENT không có nhánh WHEN riêng ⇒ rơi vào ELSE false
    expect(dem(s, /WHEN 'SOURCE'|WHEN 'CAMPAIGN'|WHEN 'EVENT'/)).toBe(0);
    expect(dem(s, /ELSE false/)).toBeGreaterThanOrEqual(2);
  });

  it("[NHH-POL-MIG-06] seed trong migration khớp hằng TS (mã vai · khoá resolver · loại GD · cờ)", () => {
    const s = sql();
    const khoi = (ten: string) => s.slice(s.indexOf(`-- >>> SEED ${ten}`), s.indexOf(`-- <<< SEED ${ten}`));
    const vai = khoi("BeneficiaryRole");
    // Cấy 08/10 — bản cũ hỏi `toContain('<khoá>')` trên CẢ KHỐI nên: (a) hoán đổi khoá giữa hai vai vẫn xanh, (b) các cột
    // isAcquisition / isSystem / isActive / sortOrder / name không ai đọc (isAcquisition = true cho SALE kéo cửa sổ 90 ngày
    // sang sai vai mà 0 ca đỏ). Nay phân tích TỪNG DÒNG và so từng cột.
    const dongVai = [...vai.matchAll(/\(gen_random_uuid\(\)::text,\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'::"BeneficiaryResolverType",\s*'([^']*)',\s*(true|false),\s*('([^']*)'|NULL),\s*(true|false),\s*(true|false),\s*(\d+),/g)].map((m) => ({
      code: m[1]!,
      name: m[2]!,
      resolverType: m[3]!,
      resolverKey: m[4]!,
      isAcquisition: m[5] === "true",
      legacyTier: m[7] ?? null,
      isSystem: m[8] === "true",
      isActive: m[9] === "true",
      sortOrder: Number(m[10]),
    }));
    expect(dongVai.map((d) => d.code)).toEqual(MASTER_VAI_HUONG.map((v) => v.code));
    for (const v of MASTER_VAI_HUONG) {
      expect(dongVai.find((d) => d.code === v.code), v.code).toEqual({
        code: v.code,
        name: v.name,
        resolverType: v.resolverType,
        resolverKey: v.resolverKey,
        isAcquisition: v.isAcquisition,
        legacyTier: v.legacyTier,
        isSystem: true,
        isActive: true,
        sortOrder: v.sortOrder,
      });
    }
    expect(dem(vai, "gen_random_uuid()")).toBe(MASTER_VAI_HUONG.length);
    expect(dem(vai, 'ON CONFLICT ("code") DO NOTHING')).toBe(1);
    const loai = khoi("CommissionTransactionType");
    const dongLoai = [...loai.matchAll(/^\s*\('([A-Z_]+)',\s*'([^']*)',\s*(true|false),\s*(true|false),\s*(\d+),/gm)].map((m) => ({
      code: m[1]!,
      name: m[2]!,
      hasClassifier: m[3] === "true",
      isActive: m[4] === "true",
      sortOrder: Number(m[5]),
    }));
    expect(dongLoai).toEqual(MASTER_LOAI_GIAO_DICH.map((l) => ({ code: l.code, name: l.name, hasClassifier: l.hasClassifier, isActive: l.isActive, sortOrder: l.sortOrder })));
    expect(dem(loai, 'ON CONFLICT ("code") DO NOTHING')).toBe(1);
  });

  it("[NHH-POL-MIG-07] schema.prisma khai đủ sáu model + sáu enum của migration", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    for (const m of BANG) expect(dem(schema, new RegExp(`^model ${m} \\{`, "m")), m).toBe(1);
    for (const e of ["BeneficiaryResolverType", "RevenueComponent", "RegulationDocumentKind", "PolicyVersionStatus", "PolicyScopeType", "CommissionCalcKind"]) {
      expect(dem(schema, new RegExp(`^enum ${e} \\{`, "m")), e).toBe(1);
    }
    expect(dem(boChuThich(schema), "scopeSourceId")).toBe(0);
  });
});
