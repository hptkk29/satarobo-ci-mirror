// @vitest-environment node
/**
 * [NHH-POL-DB-*] / [NHH-POL-MIG-*] — DANH MỤC CHÍNH SÁCH trên Postgres THẬT (02 §8, 04 §6, 05 PR4).
 *
 * Thứ chỉ DB mới chứng minh: CHECK của migration CHẶN thật (Prisma không đọc CHECK nên drift không thấy),
 * seed master chạy lại được và khớp hằng TS, bất biến sau khi version đã dùng, cổng đứng TRƯỚC phép ghi
 * (kích hoạt bị chặn ⇒ version vẫn DRAFT, bản trước không bị đóng), cách ly cơ sở của `scopedDb`.
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dữ liệu mang tiền tố `fx-chs-`/`FXCHS` và được dọn ĐẦU mỗi ca (mỗi ca tự
 * dựng fixture — luật 18; các chính sách GLOBAL của ca trước không được chồng lấn ca sau). Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chonQuyTac } from "../../lib/hoa-hong/chon-quy-tac";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { MASTER_LOAI_GIAO_DICH } from "../../lib/hoa-hong/loai-giao-dich";
import { MASTER_VAI_HUONG } from "../../lib/hoa-hong/vai-huong";
import type { PhamViInput, RuleInput } from "../../lib/hoa-hong/chinh-sach-dau-vao";
import {
  choHetHieuLuc,
  danhDauDaDung,
  docHoaHongContext,
  docQuyTac,
  huyNhap,
  kichHoat,
  KHOA_ADVISORY_CHINH_SACH,
  suaNhap,
  taoChinhSach,
  taoPhienBanMoi,
  taoVanBan,
} from "../../lib/hoa-hong/chinh-sach-service";
import { tinhChinhSachChoPhan } from "../../lib/hoa-hong/tinh-chinh-sach";

if (!RUN_DB_TESTS) console.warn(`[NHH-POL-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-chs-";
const ACTOR = { userId: null, ten: "Kế toán fixture" };
const NOW = new Date("2026-10-08T03:00:00.000Z");
/** 02/03/2026 là thứ Hai ⇒ 15 ngày làm việc sau = 23/03/2026 (giờ VN). */
const CONG_BO = "2026-03-02";
const HIEU_LUC = new Date("2026-03-22T17:00:00.000Z");

const rule = (roleCode: string, rate: number, p: Partial<RuleInput> = {}): RuleInput => ({
  transactionTypeCode: "NEW",
  roleCode,
  revenueComponent: "TUITION",
  calcKind: "PERCENT",
  rate,
  fixedAmount: null,
  tierTable: null,
  note: null,
  ...p,
});

const SEED_V1 = (): RuleInput[] => [
  rule("SALE", 0.04),
  rule("SALE_ADMIN", 0.01),
  rule("CENTER_MANAGER", 0.02),
  rule("MARKETING", 0.01),
  rule("TRIAL_TEACHER", 0.01),
];

let seq = 0;
const ma = () => `${P}${(seq += 1)}`;

async function don() {
  const chinhSach = await db.commissionPolicy.findMany({ where: { policyCode: { startsWith: P } }, select: { id: true } });
  const ids = chinhSach.map((c) => c.id);
  await db.commissionRule.deleteMany({ where: { version: { policyId: { in: ids } } } });
  await db.commissionPolicyVersion.deleteMany({ where: { policyId: { in: ids } } });
  await db.commissionPolicy.deleteMany({ where: { id: { in: ids } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "FXCHS" } } });
  await db.regulationDocument.deleteMany({ where: { documentCode: { startsWith: P } } });
  await db.centerCommissionAssignee.deleteMany({ where: { note: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { entityType: "CommissionPolicyVersion", actorName: ACTOR.ten } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "FXCHS" } } });
  await db.orgUnit.deleteMany({ where: { code: { startsWith: "FXCHS-" } } });
  await db.center.deleteMany({ where: { id: { startsWith: P } } });
  const nguoi = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  if (nguoi.length) await db.user.deleteMany({ where: { id: { in: nguoi.map((u) => u.id) } } });
}

async function vanBan(p: Partial<Parameters<typeof taoVanBan>[0]> = {}) {
  return taoVanBan({
    documentCode: ma(),
    title: "Quy định hoa hồng fixture",
    kind: "COMMISSION_POLICY",
    issuedOn: "2026-02-20",
    publishedOn: CONG_BO,
    effectiveOn: "2026-03-23",
    approvedByName: "Hồ Đắc Phúc",
    approvedById: null,
    fileKey: "documents/fx.pdf",
    fileName: "fx.pdf",
    fileUrl: "https://example.test/fx.pdf",
    ownerOrgUnitId: null,
    actor: ACTOR,
    now: NOW,
    ...p,
  });
}

async function chinhSach(p: Partial<Parameters<typeof taoChinhSach>[0]> = {}) {
  return taoChinhSach({
    policyCode: ma(),
    name: "Chính sách fixture",
    description: null,
    ownerOrgUnitId: null,
    phamVi: { loai: "GLOBAL" },
    effectiveFrom: HIEU_LUC,
    effectiveTo: null,
    reason: "SR.QD.fixture",
    documentId: null,
    rules: SEED_V1(),
    actor: ACTOR,
    now: NOW,
    ...p,
  });
}

const kich = (versionId: string, p: Partial<Parameters<typeof kichHoat>[0]> = {}) =>
  kichHoat({ versionId, actor: ACTOR, now: NOW, xacNhanCanhBao: null, ...p });

async function loiKichHoat(versionId: string, p: Partial<Parameters<typeof kichHoat>[0]> = {}): Promise<string[]> {
  try {
    await kich(versionId, p);
  } catch (e) {
    if (e instanceof HoaHongError && e.ma === "KICH_HOAT_BI_CHAN") return (e.chiTiet as { ma: string }[]).map((x) => x.ma).sort();
    throw e;
  }
  return [];
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-POL-DB] danh mục chính sách — Postgres thật", () => {
  let ho = "";
  let cs1 = "";
  let cs2 = "";
  let cs1Center = "";
  let cs2Center = "";

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    const o = await db.orgUnit.findMany({ where: { code: { in: ["HO", "CS1", "CS2"] } }, select: { id: true, code: true, centerId: true } });
    const byCode = Object.fromEntries(o.map((x) => [x.code, x]));
    ho = byCode.HO!.id;
    cs1 = byCode.CS1!.id;
    cs2 = byCode.CS2!.id;
    cs1Center = byCode.CS1!.centerId!;
    cs2Center = byCode.CS2!.centerId!;
  }, 120_000);
  /**
   * Mỗi ca bắt đầu với CS1 + CS2 ĐÃ khai người phụ trách QC và QL_TT (guardrail "người hưởng phân giải được" chặn
   * mọi policy dùng hai vai ấy nếu thiếu) — ca nào muốn thấy lỗi thiếu thì tự xoá chúng.
   */
  beforeEach(async () => {
    await don();
    const u = await seedUser({ email: `${P}nguoi-phu-trach@ci.test`, role: "SALES_CSM", name: `${P}nguoi-phu-trach` });
    for (const centerId of [cs1Center, cs2Center]) {
      for (const role of ["QC", "QL_TT"] as const) {
        await db.centerCommissionAssignee.create({
          data: { centerId, role, userId: u.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: `${P}khai-san` },
        });
      }
    }
  }, 60_000);
  afterAll(async () => {
    await don();
  }, 60_000);

  // ─── CHECK + seed của migration ─────────────────────────────────────────────

  it("[NHH-POL-MIG-01] master khớp hằng TS: 10 vai + 6 loại giao dịch, từng cột", async () => {
    const vai = await db.beneficiaryRole.findMany({ orderBy: { sortOrder: "asc" } });
    expect(vai.map((v) => v.code)).toEqual(MASTER_VAI_HUONG.map((v) => v.code));
    for (const m of MASTER_VAI_HUONG) {
      const v = vai.find((x) => x.code === m.code)!;
      // Cấy 08/10: đổi `name` / `sortOrder` của SALE trong DB ⇒ 0 ca đỏ (chỉ so 6 cột). `sortOrder` là thứ quyết định thứ tự vai
      // trong `docHoaHongContext` (orderBy sortOrder) nên nó là cột LOGIC, không phải trang trí.
      expect({ t: v.resolverType, k: v.resolverKey, a: v.isAcquisition, l: v.legacyTier, s: v.isSystem, on: v.isActive, n: v.name, o: v.sortOrder }).toEqual({
        t: m.resolverType,
        k: m.resolverKey,
        a: m.isAcquisition,
        l: m.legacyTier,
        s: true,
        on: true,
        n: m.name,
        o: m.sortOrder,
      });
    }
    const loai = await db.commissionTransactionType.findMany({ orderBy: { sortOrder: "asc" } });
    expect(loai.map((l) => [l.code, l.name, l.hasClassifier, l.isActive, l.sortOrder])).toEqual(
      MASTER_LOAI_GIAO_DICH.map((l) => [l.code, l.name, l.hasClassifier, l.isActive, l.sortOrder]),
    );
  });

  it("[NHH-POL-MIG-02] chạy lại khối seed HAI lần ⇒ số dòng và nội dung không đổi (idempotent)", async () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261014100000_hoa_hong_chinh_sach/migration.sql"), "utf8");
    const khoi = (ten: string) => {
      const a = sql.indexOf(`-- >>> SEED ${ten}`);
      const b = sql.indexOf(`-- <<< SEED ${ten}`);
      expect(a).toBeGreaterThan(-1);
      expect(b).toBeGreaterThan(a);
      return sql.slice(a, b);
    };
    const truoc = {
      vai: JSON.stringify(await db.beneficiaryRole.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } })),
      loai: JSON.stringify(await db.commissionTransactionType.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } })),
    };
    for (let i = 0; i < 2; i++) {
      await db.$executeRawUnsafe(khoi("BeneficiaryRole"));
      await db.$executeRawUnsafe(khoi("CommissionTransactionType"));
    }
    expect(JSON.stringify(await db.beneficiaryRole.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }))).toBe(truoc.vai);
    expect(JSON.stringify(await db.commissionTransactionType.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } }))).toBe(truoc.loai);
  });

  const chan = async (p: Promise<unknown>, tenRangBuoc: string) => {
    await expect(p).rejects.toThrow(new RegExp(tenRangBuoc));
  };

  it("[NHH-POL-DB-01] CHECK `CommissionTransactionType_bat_chk`: không bật được mã chưa có bộ phân loại (luật 12)", async () => {
    await chan(db.commissionTransactionType.update({ where: { code: "UPSELL" }, data: { isActive: true } }), "CommissionTransactionType_bat_chk");
    // đối chứng dương: bật NEW (đã có bộ phân loại) là việc hợp lệ
    await db.commissionTransactionType.update({ where: { code: "NEW" }, data: { isActive: true } });
    const up = await db.commissionTransactionType.findUniqueOrThrow({ where: { code: "UPSELL" } });
    expect(up.isActive).toBe(false);
  });

  it("[NHH-POL-DB-02] CHECK `van_ban`/`hieu_luc`: version ACTIVE phải có văn bản; effectiveTo phải > effectiveFrom", async () => {
    const { policyId } = await chinhSach();
    const goc = { policyId, scopeType: "GLOBAL" as const, scopeKey: "GLOBAL", reason: "x", effectiveFrom: HIEU_LUC };
    await chan(db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 90, status: "ACTIVE", documentId: null } }), "CommissionPolicyVersion_van_ban_chk");
    await chan(
      db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 91, status: "DRAFT", effectiveTo: HIEU_LUC } }),
      "CommissionPolicyVersion_hieu_luc_chk",
    );
    await chan(
      db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 92, status: "DRAFT", effectiveTo: new Date(HIEU_LUC.getTime() - 1) } }),
      "CommissionPolicyVersion_hieu_luc_chk",
    );
    // đối chứng dương: DRAFT không văn bản, effectiveTo > effectiveFrom 1ms ⇒ qua
    await db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 93, status: "DRAFT", effectiveTo: new Date(HIEU_LUC.getTime() + 1) } });
  });

  it("[NHH-POL-DB-03] CHECK `pham_vi`: đúng MỘT cột scope* theo scopeType; SOURCE/CAMPAIGN/EVENT bị cấm ở PR4", async () => {
    const { policyId } = await chinhSach();
    const u = await seedUser({ email: `${P}u@ci.test`, role: "SALES_CSM", name: `${P}u` });
    const goc = { policyId, reason: "x", effectiveFrom: HIEU_LUC, status: "DRAFT" as const };
    // GLOBAL mà có scopeUserId
    await chan(db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 80, scopeType: "GLOBAL", scopeKey: "GLOBAL", scopeUserId: u.id } }), "CommissionPolicyVersion_pham_vi_chk");
    // PERSON thiếu scopeUserId
    await chan(db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 81, scopeType: "PERSON", scopeKey: "PERSON:x" } }), "CommissionPolicyVersion_pham_vi_chk");
    // PERSON mà dư scopeOrgUnitId
    await chan(
      db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 82, scopeType: "PERSON", scopeKey: `PERSON:${u.id}`, scopeUserId: u.id, scopeOrgUnitId: ho } }),
      "CommissionPolicyVersion_pham_vi_chk",
    );
    // SOURCE / CAMPAIGN / EVENT: chưa có scopeSourceId ⇒ cấm
    for (const [i, t] of (["SOURCE", "CAMPAIGN", "EVENT"] as const).entries()) {
      await chan(db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 83 + i, scopeType: t, scopeKey: `${t}:s` } }), "CommissionPolicyVersion_pham_vi_chk");
    }
    // đối chứng dương: PERSON đủ cột, ORG_UNIT đủ cột
    await db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 70, scopeType: "PERSON", scopeKey: `PERSON:${u.id}`, scopeUserId: u.id } });
    await db.commissionPolicyVersion.create({ data: { ...goc, versionNo: 71, scopeType: "ORG_UNIT", scopeKey: `ORG_UNIT:${cs1}`, scopeOrgUnitId: cs1 } });
  });

  it("[NHH-POL-DB-04] CHECK `cach_tinh`: PERCENT cần 0<rate≤1; FIXED cần số nguyên dương; EXCLUDE không mang giá trị; TIER cần bảng bậc", async () => {
    const { versionId } = await chinhSach({ rules: [] });
    const goc = { versionId, transactionTypeCode: "NEW", beneficiaryRoleId: (await db.beneficiaryRole.findUniqueOrThrow({ where: { code: "SALE" } })).id };
    let comp = 0;
    const them = (data: Record<string, unknown>) => {
      comp += 1;
      const thanhPhan = (["TUITION", "MATERIAL", "EQUIPMENT", "OTHER"] as const)[comp % 4]!;
      return db.commissionRule.create({ data: { ...goc, revenueComponent: thanhPhan, ...(data as object) } as never });
    };
    const re = "CommissionRule_cach_tinh_chk";
    await chan(them({ calcKind: "PERCENT", rate: 0 }), re); // 0 không hợp lệ
    await chan(them({ calcKind: "PERCENT", rate: 1.0001 }), re);
    await chan(them({ calcKind: "PERCENT" }), re); // thiếu rate
    await chan(them({ calcKind: "PERCENT", rate: 0.04, fixedAmount: 1 }), re); // dư fixed
    await chan(them({ calcKind: "FIXED_PER_PURCHASE", fixedAmount: 0 }), re);
    await chan(them({ calcKind: "FIXED_PER_PURCHASE", fixedAmount: 100, rate: 0.01 }), re);
    await chan(them({ calcKind: "EXCLUDE", rate: 0.01 }), re);
    await chan(them({ calcKind: "TIER_PERIOD_BONUS" }), re);
    // đối chứng dương: mỗi kiểu một dòng hợp lệ (thành phần khác nhau để không đụng khoá duy nhất)
    await db.commissionRule.create({ data: { ...goc, revenueComponent: "TUITION", calcKind: "PERCENT", rate: 1 } });
    await db.commissionRule.create({ data: { ...goc, revenueComponent: "MATERIAL", calcKind: "FIXED_PER_PURCHASE", fixedAmount: 1 } });
    await db.commissionRule.create({ data: { ...goc, revenueComponent: "EQUIPMENT", calcKind: "EXCLUDE" } });
    await db.commissionRule.create({ data: { ...goc, revenueComponent: "OTHER", calcKind: "TIER_PERIOD_BONUS", tierTable: [{ tu: 0, den: 1, tien: 1 }] } });
  });

  it("[NHH-POL-DB-05] khoá duy nhất: một ô (version × loại × vai × thành phần) chỉ một rule; hai version cùng policy không trùng versionNo", async () => {
    const { versionId, policyId } = await chinhSach({ rules: [rule("SALE", 0.04)] });
    const sale = await db.beneficiaryRole.findUniqueOrThrow({ where: { code: "SALE" } });
    await expect(
      db.commissionRule.create({ data: { versionId, transactionTypeCode: "NEW", beneficiaryRoleId: sale.id, revenueComponent: "TUITION", calcKind: "PERCENT", rate: 0.05 } }),
    ).rejects.toThrow();
    await expect(
      db.commissionPolicyVersion.create({ data: { policyId, versionNo: 1, scopeType: "GLOBAL", scopeKey: "GLOBAL", reason: "x", effectiveFrom: HIEU_LUC } }),
    ).rejects.toThrow();
    // Cấy 08/10: bỏ chỉ mục duy nhất của `documentCode` ⇒ 0 ca đỏ. Hai văn bản cùng số = hai nguồn "căn cứ" cho một con số.
    const soVb = ma();
    await vanBan({ documentCode: soVb });
    await expect(vanBan({ documentCode: soVb })).rejects.toThrow();
    expect(await db.regulationDocument.count({ where: { documentCode: soVb } })).toBe(1);
  });

  // ─── Service: soạn ──────────────────────────────────────────────────────────

  it("[NHH-POL-DB-06] tạo chính sách: nháp v1, rule lưu Decimal đúng; phạm vi + đơn vị sở hữu chép xuống version/rule; policyCode duy nhất", async () => {
    const r = await chinhSach({ ownerOrgUnitId: cs1, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 } });
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: r.versionId }, include: { rules: true, policy: true } });
    expect(v.versionNo).toBe(1);
    expect(v.status).toBe("DRAFT");
    expect(v.scopeType).toBe("ORG_UNIT");
    expect(v.scopeKey).toBe(`ORG_UNIT:${cs1}`);
    expect(v.scopeOrgUnitId).toBe(cs1);
    // đơn vị SỞ HỮU chép từ policy xuống version và rule (02 §2.6)
    expect(v.policy.orgUnitId).toBe(cs1);
    expect(v.policy.centerId).toBe(cs1Center);
    expect(v.orgUnitId).toBe(cs1);
    expect(v.centerId).toBe(cs1Center);
    expect(v.rules).toHaveLength(5);
    expect(v.rules.every((x) => x.orgUnitId === cs1 && x.centerId === cs1Center)).toBe(true);
    const sale = v.rules.find((x) => x.calcKind === "PERCENT" && Number(x.rate) === 0.04);
    expect(sale).toBeTruthy();
    // chính sách của HỘI SỞ (owner null) ⇒ centerId/orgUnitId NULL = dùng chung
    const g = await chinhSach();
    const vg = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: g.versionId }, include: { rules: true } });
    expect([vg.centerId, vg.orgUnitId]).toEqual([null, null]);
    expect(vg.rules.every((x) => x.centerId === null && x.orgUnitId === null)).toBe(true);
    // policyCode duy nhất
    const trung = ma();
    await chinhSach({ policyCode: trung });
    await expect(chinhSach({ policyCode: trung })).rejects.toThrow();
  });

  it("[NHH-POL-DB-07] đầu vào sai bị từ chối TRƯỚC khi ghi: rule trùng ô, tỉ lệ 7 chữ số, vai lạ, đơn vị không tồn tại — không để lại policy mồ côi", async () => {
    const code = ma();
    const sai: [string, Partial<Parameters<typeof taoChinhSach>[0]>][] = [
      ["trùng ô", { rules: [rule("SALE", 0.04), rule("SALE", 0.05)] }],
      ["tỉ lệ 7 chữ số", { rules: [rule("SALE", 0.1234567)] }],
      ["vai lạ", { rules: [rule("KHONG_CO_VAI", 0.04)] }],
      ["loại GD lạ", { rules: [rule("SALE", 0.04, { transactionTypeCode: "LA" })] }],
      ["đơn vị không tồn tại", { ownerOrgUnitId: "khong-co" }],
    ];
    for (const [ten, p] of sai) {
      await expect(chinhSach({ policyCode: code, ...p }), ten).rejects.toMatchObject({ ma: expect.stringMatching(/DU_LIEU_KHONG_HOP_LE|DON_VI_KHONG_HOP_LE/) });
    }
    expect(await db.commissionPolicy.count({ where: { policyCode: code } })).toBe(0);
  });

  it("[NHH-POL-DB-07b] đầu vào sai ở tầng SERVICE bị từ chối bằng HoaHongError (không để lọt xuống lỗi thô của DB / không trượt ngày): lý do trống, hiệu lực kết thúc = bắt đầu, ngày lịch không có thật", async () => {
    // Cấy 08/10 (S21/S22/S23): bỏ từng cổng này ở service ⇒ 0 ca đỏ — DB-07 chỉ thử rule/vai/đơn vị, và hai cổng sau còn được CHECK DB
    // 'che' bằng một lỗi Prisma thô (người dùng thấy câu tiếng máy, không phải câu nói đúng trường sai).
    await expect(chinhSach({ reason: "   " })).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    await expect(chinhSach({ effectiveTo: HIEU_LUC })).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    for (const sai of ["2026-02-30", "2026-04-31", "2026-13-01", "26-03-02"]) {
      await expect(vanBan({ publishedOn: sai }), `publishedOn ${sai}`).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    }
    expect(await db.commissionPolicy.count({ where: { policyCode: { startsWith: P } } })).toBe(0);
    expect(await db.regulationDocument.count({ where: { documentCode: { startsWith: P } } })).toBe(0);
    // đối chứng dương: ngày nhuận có thật và hiệu lực kết thúc +1ms đều qua
    const ok = await vanBan({ publishedOn: "2028-02-29" });
    expect((await db.regulationDocument.findUniqueOrThrow({ where: { id: ok.id } })).publishedOn.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    await chinhSach({ effectiveTo: new Date(HIEU_LUC.getTime() + 1) });
  });

  it("[NHH-POL-DB-08] sửa nháp: thay rule + hiệu lực; không sửa được bản đã kích hoạt / đã huỷ", async () => {
    const vb = await vanBan();
    const { versionId } = await chinhSach({ documentId: vb.id });
    await suaNhap({
      versionId,
      phamVi: { loai: "GLOBAL" },
      effectiveFrom: new Date(HIEU_LUC.getTime() + 86_400_000),
      effectiveTo: null,
      reason: "đổi rule",
      documentId: vb.id,
      rules: [rule("SALE", 0.03)],
      actor: ACTOR,
      now: NOW,
    });
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, include: { rules: true } });
    expect(v.rules.map((x) => Number(x.rate))).toEqual([0.03]);
    expect(v.reason).toBe("đổi rule");

    await kich(versionId);
    // sau khi KÍCH HOẠT thì cấm sửa
    await expect(
      suaNhap({ versionId, phamVi: { loai: "GLOBAL" }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: [rule("SALE", 0.05)], actor: ACTOR, now: NOW }),
    ).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP" });
    expect(await db.commissionRule.count({ where: { versionId } })).toBe(1);
    // và sau khi HUỶ cũng vậy
    const nhap2 = await chinhSach({ documentId: vb.id });
    await huyNhap({ versionId: nhap2.versionId, lyDo: "không dùng", actor: ACTOR, now: NOW });
    await expect(
      suaNhap({ versionId: nhap2.versionId, phamVi: { loai: "GLOBAL" }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: [rule("SALE", 0.04)], actor: ACTOR, now: NOW }),
    ).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP" });
  });

  // ─── Service: kích hoạt ─────────────────────────────────────────────────────

  it("[NHH-POL-05] kích hoạt đòi văn bản đủ trường: không văn bản ⇒ chặn, version vẫn DRAFT, không dòng audit", async () => {
    const { versionId } = await chinhSach();
    expect(await loiKichHoat(versionId)).toContain("VAN_BAN_THIEU");
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(v.status).toBe("DRAFT");
    expect(v.activatedAt).toBeNull();
    expect(await db.auditLog.count({ where: { entityType: "CommissionPolicyVersion", entityId: versionId, action: "ACTIVATE" } })).toBe(0);
    // văn bản thiếu tệp
    const khongTep = await vanBan({ fileKey: null, fileName: null, fileUrl: null });
    await suaNhap({ versionId, phamVi: { loai: "GLOBAL" }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: khongTep.id, rules: SEED_V1(), actor: ACTOR, now: NOW });
    expect(await loiKichHoat(versionId)).toContain("VAN_BAN_THIEU");
  });

  it("[NHH-POL-06] hiệu lực ≥ công bố + 15 ngày làm việc: đúng ngày thứ 15 ⇒ kích hoạt được; sớm 1 ngày ⇒ HIEU_LUC_SOM; dòng Holiday đẩy mốc, dòng MAINTENANCE thì không", async () => {
    const vb = await vanBan();
    const som = await chinhSach({ documentId: vb.id, effectiveFrom: new Date("2026-03-19T17:00:00.000Z") });
    expect(await loiKichHoat(som.versionId)).toContain("HIEU_LUC_SOM");

    // MAINTENANCE cùng khoảng ⇒ KHÔNG đẩy mốc
    await db.holiday.create({ data: { name: `${P}bao-tri`, date: new Date("2026-03-10T00:00:00.000Z"), endDate: new Date("2026-03-11T00:00:00.000Z"), type: "MAINTENANCE" } });
    const dung = await chinhSach({ documentId: vb.id });
    expect(await loiKichHoat(dung.versionId)).toEqual([]);
    await db.holiday.deleteMany({ where: { name: `${P}bao-tri` } });
    // HOLIDAY toàn hệ 10–11/03 ⇒ mốc lùi sang 25/03 ⇒ bản 23/03 bị chặn
    await db.holiday.create({ data: { name: `${P}le`, date: new Date("2026-03-10T00:00:00.000Z"), endDate: new Date("2026-03-11T00:00:00.000Z"), type: "HOLIDAY" } });
    try {
      const sau = await chinhSach({ documentId: vb.id, policyCode: ma() });
      expect(await loiKichHoat(sau.versionId)).toContain("HIEU_LUC_SOM");
    } finally {
      await db.holiday.deleteMany({ where: { name: `${P}le` } });
    }
  });

  it("[NHH-POL-DB-09] kích hoạt thành công: ACTIVE + người/giờ kích hoạt + AuditLog (có lý do); chạy lần hai bị từ chối; Center MỒ CÔI (không OrgUnit) không bị đòi người phụ trách", async () => {
    await db.center.create({ data: { id: `${P}mo-coi`, name: "Center mồ côi", slug: `${P}mo-coi`, address: "-" } });
    const vb = await vanBan();
    const { versionId } = await chinhSach({ documentId: vb.id });
    // Cấy 08/10 (rà soát độc lập): `activatedById: input.actor.userId` → `null` XANH — ACTOR cố định có `userId: null`, nên "không ghi người" và
    // "ghi người" cho cùng một giá trị. Fixture phải mang MỘT NGƯỜI THẬT thì cột mới có chỗ để sai.
    const nguoiKich = await seedUser({ email: `${P}kich-hoat@ci.test`, role: "SALES_CSM", name: `${P}kich-hoat` });
    await kich(versionId, { actor: { userId: nguoiKich.id, ten: ACTOR.ten } });
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(v.status).toBe("ACTIVE");
    expect(v.activatedAt?.toISOString()).toBe(NOW.toISOString());
    expect(v.activatedById).toBe(nguoiKich.id);
    const log = await db.auditLog.findMany({ where: { entityType: "CommissionPolicyVersion", entityId: versionId }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["CREATE", "ACTIVATE"]);
    await expect(kich(versionId)).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP" });
  });

  it("[NHH-POL-DB-10] version mới ĐÓNG bản trước tại effectiveFrom (khuôn CommissionRateConfig): v1 SUPERSEDED, v2 ACTIVE; khoản thu trước/sau mốc dùng đúng bản", async () => {
    const vb = await vanBan();
    const c1 = await chinhSach({ documentId: vb.id });
    await kich(c1.versionId);
    const tu2 = new Date("2026-06-30T17:00:00.000Z"); // 01/07 VN
    const v2 = await taoPhienBanMoi({
      policyId: c1.policyId,
      phamVi: null,
      effectiveFrom: tu2,
      effectiveTo: null,
      reason: "giảm GV Trial xuống 0,5%",
      documentId: vb.id,
      rules: [...SEED_V1().filter((r) => r.roleCode !== "TRIAL_TEACHER"), rule("TRIAL_TEACHER", 0.005)],
      actor: ACTOR,
      now: NOW,
    });
    expect(v2.versionNo).toBe(2);
    expect(await loiKichHoat(v2.versionId)).toEqual([]);

    const [a, b] = await Promise.all([
      db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: c1.versionId } }),
      db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: v2.versionId } }),
    ]);
    expect(a.status).toBe("SUPERSEDED");
    expect(a.effectiveTo?.toISOString()).toBe(tu2.toISOString());
    expect(b.status).toBe("ACTIVE");

    const rules = await docQuyTac(db);
    const ctx = (d: Date) => ({
      roleCode: "TRIAL_TEACHER",
      transactionType: "NEW" as const,
      revenueComponent: "TUITION" as const,
      rateDate: d,
      orgUnitPath: "/ho/danang/cs1/",
      nguoiHuongUserId: null,
      affiliateId: null,
      sourceId: null,
      campaignId: null,
      eventId: null,
      sourceGroupId: null,
      nguonCoHoaHong: true,
      roleDefIds: [],
    });
    const thuTu = (await docHoaHongContext(db)).thuTuPhamVi;
    const gia = (d: string) => {
      const r = chonQuyTac({ ctx: ctx(new Date(d)), quyTac: rules.filter((q) => q.policyId === c1.policyId), thuTuPhamVi: thuTu });
      return r.loai === "THANG" ? Number(r.quyTac.giaTri) : r.loai;
    };
    expect(gia("2026-06-30T16:59:59.000Z")).toBe(0.01); // trước mốc: bản 1
    expect(gia("2026-06-30T17:00:00.000Z")).toBe(0.005); // ĐÚNG mốc: bản 2 (biên mở)
    expect(gia("2026-03-01T00:00:00.000Z")).toBe("KHONG_CO"); // trước khi bản 1 có hiệu lực
  });

  it("[NHH-POL-08] chồng lấn hiệu lực là của CÙNG policy: bản v3 hiệu lực lùi về TRƯỚC v2 (cùng policy) bị chặn; policy KHÁC chỉ bị chặn khi hai rule cùng hạng (CHONG_LAN_RULE), không vì hiệu lực giao nhau", async () => {
    const vb = await vanBan();
    // (a) policy khác, ô khác (RENEWAL vs NEW), cùng GLOBAL/Hội sở, hiệu lực giao nhau ⇒ KÍCH HOẠT ĐƯỢC cả hai (ca seed v1: HV_MOI + TAI_TUC)
    const hvMoi = await chinhSach({ documentId: vb.id });
    await kich(hvMoi.versionId);
    const taiTuc = await chinhSach({ documentId: vb.id, rules: [rule("SALE", 0.02, { transactionTypeCode: "RENEWAL" })] });
    expect(await loiKichHoat(taiTuc.versionId)).toEqual([]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: taiTuc.versionId } })).status).toBe("ACTIVE");
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: hvMoi.versionId } })).effectiveTo).toBeNull();
    // (b) policy khác, CÙNG ô (SALE·NEW) cùng hạng ⇒ CHONG_LAN_RULE (không phải CHONG_LAN_HIEU_LUC); bản trước không đổi
    const trung = await chinhSach({ documentId: vb.id, rules: [rule("SALE", 0.04)] });
    const loi = await loiKichHoat(trung.versionId);
    expect(loi).toContain("CHONG_LAN_RULE");
    expect(loi).not.toContain("CHONG_LAN_HIEU_LUC");
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: trung.versionId } })).status).toBe("DRAFT");
    // (c) CÙNG policy: v2 kích hoạt (hiệu lực 01/07), rồi v3 (nháp) lùi hiệu lực về 01/04 — TRƯỚC v2 ⇒ CHONG_LAN_HIEU_LUC
    const v2 = await taoPhienBanMoi({ policyId: hvMoi.policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "v2", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    await kich(v2.versionId);
    const v3 = await taoPhienBanMoi({ policyId: hvMoi.policyId, phamVi: null, effectiveFrom: new Date("2026-03-31T17:00:00.000Z"), effectiveTo: null, reason: "v3 lùi", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    expect(await loiKichHoat(v3.versionId)).toContain("CHONG_LAN_HIEU_LUC");
  });

  it("[NHH-POL-04] trần ĐỌC từ cấu hình: bộ rule Σ 9,5% bị chặn VUOT_TRAN; version/bản trước nguyên vẹn", async () => {
    const vb = await vanBan();
    const r = await chinhSach({ documentId: vb.id, rules: [...SEED_V1().slice(0, 4), rule("TRIAL_TEACHER", 0.015)] });
    expect(await loiKichHoat(r.versionId)).toContain("VUOT_TRAN");
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: r.versionId } })).status).toBe("DRAFT");
  });

  it("[NHH-POL-09] người hưởng phân giải được: MARKETING không có người phụ trách ở cơ sở trong phạm vi ⇒ chặn; khai người rồi thì qua", async () => {
    const vb = await vanBan({ ownerOrgUnitId: cs1 });
    const { versionId } = await chinhSach({ ownerOrgUnitId: cs1, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 }, documentId: vb.id, rules: [rule("MARKETING", 0.01)] });
    await db.centerCommissionAssignee.deleteMany({ where: { note: { startsWith: P } } }); // ca này muốn thấy lỗi THIẾU người
    expect(await loiKichHoat(versionId)).toContain("THIEU_NGUOI_PHU_TRACH");
    const qc = await seedUser({ email: `${P}qc@ci.test`, role: "SALES_CSM", name: `${P}qc` });
    await db.centerCommissionAssignee.create({
      data: { centerId: cs1Center, role: "QC", userId: qc.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: `${P}qc` },
    });
    expect(await loiKichHoat(versionId)).toEqual([]);
  });

  it("[NHH-POL-DB-11] cảnh báo UNKNOWN tăng cần XÁC NHẬN + lý do ≥10 ký tự; có xác nhận thì kích hoạt và ghi lý do vào audit", async () => {
    const vb = await vanBan();
    const g1 = await db.leadSourceGroup.create({ data: { code: "FXCHS1", name: "FX nhóm 1", sortOrder: 901, commissionEnabled: true } }); // chính sách THEO NGUỒN chỉ chạy/kích hoạt được khi nguồn bật commissionEnabled (mặc định nguồn admin tạo = TẮT)
    const g2 = await db.leadSourceGroup.create({ data: { code: "FXCHS2", name: "FX nhóm 2", sortOrder: 902, commissionEnabled: true } });
    const nhom = (id: string, rate: number, code = ma()) => chinhSach({ policyCode: code, documentId: vb.id, phamVi: { loai: "SOURCE_GROUP", sourceGroupId: id }, rules: [rule("SALE", rate)] });
    // nền: g1 4%, g2 5%  (UNKNOWN = min = 4%); mọi nhóm ĐANG hoạt động khác (11 nguồn seed) không có rule ⇒ min = 0 ⇒ không tăng
    // ⇒ để phép so có ý nghĩa, tắt các nhóm seed khỏi G cho ca này bằng cách chỉ xét nhóm fixture:
    await db.leadSourceGroup.updateMany({ where: { code: { not: { startsWith: "FXCHS" } }, status: "ACTIVE" }, data: { status: "INACTIVE" } });
    try {
      const n1 = await nhom(g1.id, 0.04);
      const n2 = await nhom(g2.id, 0.05);
      await kich(n1.versionId); // rule ĐẦU TIÊN của ô SALE·NEW (UNKNOWN 0 → 0): không có gì để xác nhận
      // n2 lấp nhóm còn thiếu rule ⇒ UNKNOWN 0 → 4%: nguồn KHÔNG RÕ từ nay bắt đầu được trả tiền. Ô SALE·NEW đã có rule (n1) nên đây là
      // TĂNG thật (review 08/10: bản trước nuốt ca này vì `truoc > 0 &&`).
      expect(await loiKichHoat(n2.versionId)).toEqual(["CAN_XAC_NHAN_CANH_BAO"]);
      await kich(n2.versionId, { xacNhanCanhBao: { lyDo: "Hoàn tất rule cho mọi nhóm nguồn" } });
      const nang = await taoPhienBanMoi({
        policyId: n1.policyId,
        phamVi: null,
        effectiveFrom: new Date("2026-06-30T17:00:00.000Z"),
        effectiveTo: null,
        reason: "nâng nhóm rẻ nhất",
        documentId: vb.id,
        rules: [rule("SALE", 0.045)],
        actor: ACTOR,
        now: NOW,
      });
      expect(await loiKichHoat(nang.versionId)).toEqual(["CAN_XAC_NHAN_CANH_BAO"]);
      expect(await loiKichHoat(nang.versionId, { xacNhanCanhBao: { lyDo: "ngắn" } })).toEqual(["CAN_XAC_NHAN_CANH_BAO"]);
      // Cấy 08/10 (rà soát độc lập): `xacNhan.length < 10` → `<=` XANH. Biên: 9 ký tự (kể cả khi đệm khoảng trắng — đo SAU cắt) bị chặn, đúng 10 qua.
      expect(await loiKichHoat(nang.versionId, { xacNhanCanhBao: { lyDo: "   123456789   " } })).toEqual(["CAN_XAC_NHAN_CANH_BAO"]);
      await kich(nang.versionId, { xacNhanCanhBao: { lyDo: "BLD chot 1" } });
      const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionPolicyVersion", entityId: nang.versionId, action: "ACTIVATE" } });
      expect(log.reason).toContain("BLD chot 1");
    } finally {
      await db.leadSourceGroup.updateMany({ where: { code: { not: { startsWith: "FXCHS" } }, status: "INACTIVE", isSystem: true }, data: { status: "ACTIVE" } });
    }
  });

  // ─── Bất biến sau khi dùng ──────────────────────────────────────────────────

  it("[NHH-POL-07] version đã sinh dòng sổ (firstUsedAt) ⇒ KHÔNG sửa / huỷ được; chỉ tạo version MỚI; firstUsedAt đánh dấu MỘT lần", async () => {
    const vb = await vanBan();
    const { versionId, policyId } = await chinhSach({ documentId: vb.id });
    const gocSua = { versionId, phamVi: { loai: "GLOBAL" } as const, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: [rule("SALE", 0.04)], actor: ACTOR, now: NOW };
    // nháp mà đã bị đánh dấu dùng (trạng thái lẽ ra không xảy ra) vẫn bị khoá bởi firstUsedAt
    const lan1 = new Date("2026-10-08T05:00:00.000Z");
    await db.$transaction((tx) => danhDauDaDung(tx, versionId, lan1));
    await db.$transaction((tx) => danhDauDaDung(tx, versionId, new Date("2026-10-09T05:00:00.000Z")));
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId } })).firstUsedAt?.toISOString()).toBe(lan1.toISOString());
    await expect(suaNhap(gocSua)).rejects.toMatchObject({ ma: "VERSION_DA_KHOA" });
    await expect(huyNhap({ versionId, lyDo: "x", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "VERSION_DA_KHOA" });
    // Cấy 08/10 (S04): bỏ `canNhap` ở kichHoat ⇒ 0 ca đỏ, vì `updateMany` có điều kiện vẫn ném — nhưng bằng MÃ KHÁC
    // (VERSION_KHONG_PHAI_NHAP) và SAU KHI guardrail đã chạy trên một bản không còn là nháp. Mã lỗi là thứ giao diện đọc.
    await expect(kich(versionId)).rejects.toMatchObject({ ma: "VERSION_DA_KHOA" });
    // rule không đổi sau các lần bị từ chối
    expect(await db.commissionRule.count({ where: { versionId } })).toBe(5);
    // tạo version MỚI thì được
    const v2 = await taoPhienBanMoi({ policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "v2", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    expect(v2.versionNo).toBe(2);
    // chép rule từ bản mới nhất khi `rules = null`
    expect(await db.commissionRule.count({ where: { versionId: v2.versionId } })).toBe(5);
  });

  it("[NHH-POL-DB-16] hai người kích hoạt CÙNG LÚC một nháp ⇒ đúng MỘT bên thắng (cập nhật có điều kiện), bên kia nhận VERSION_KHONG_PHAI_NHAP; audit ACTIVATE đúng 1 dòng", async () => {
    const vb = await vanBan();
    const { versionId } = await chinhSach({ documentId: vb.id });
    const kq = await Promise.allSettled([kich(versionId), kich(versionId)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(thua.reason).toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP" });
    expect(await db.auditLog.count({ where: { entityType: "CommissionPolicyVersion", entityId: versionId, action: "ACTIVATE" } })).toBe(1);
  });

  it("[NHH-POL-DB-12] huỷ nháp: DRAFT → CANCELLED (kèm lý do, audit); bản ACTIVE không huỷ được", async () => {
    const vb = await vanBan();
    const a = await chinhSach({ documentId: vb.id });
    await huyNhap({ versionId: a.versionId, lyDo: "soạn nhầm", actor: ACTOR, now: NOW });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } })).status).toBe("CANCELLED");
    const b = await chinhSach({ documentId: vb.id });
    await kich(b.versionId);
    await expect(huyNhap({ versionId: b.versionId, lyDo: "x", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP" });
    // Cấy 08/10 (S20): huỷ nháp KHÔNG kèm lý do vẫn qua ⇒ 0 ca đỏ. Luật: mọi đổi trạng thái có lý do (audit reason).
    const c = await chinhSach({ documentId: vb.id });
    await expect(huyNhap({ versionId: c.versionId, lyDo: "   ", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: c.versionId } })).status).toBe("DRAFT");
    expect(await db.auditLog.count({ where: { entityType: "CommissionPolicyVersion", entityId: c.versionId, action: "CANCEL" } })).toBe(0);
  });

  it("[NHH-POL-DB-13] cho hết hiệu lực: đặt effectiveTo; effectiveTo ≤ effectiveFrom bị từ chối; effectiveTo đã qua ⇒ EXPIRED", async () => {
    const vb = await vanBan();
    const a = await chinhSach({ documentId: vb.id });
    await kich(a.versionId);
    await expect(choHetHieuLuc({ versionId: a.versionId, effectiveTo: HIEU_LUC, lyDo: "hết", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    await choHetHieuLuc({ versionId: a.versionId, effectiveTo: new Date("2026-09-30T17:00:00.000Z"), lyDo: "hết hiệu lực", actor: ACTOR, now: NOW });
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } });
    expect(v.status).toBe("EXPIRED"); // 30/09 < NOW (08/10)
    expect(v.effectiveTo?.toISOString()).toBe("2026-09-30T17:00:00.000Z");

    // Cấy 08/10 (S13, `<=` -> `<`): 0 ca đỏ — chỉ có mốc cách NOW cả tuần. Biên mở [từ, đến): ĐÚNG mốc kết thúc là đã hết hiệu lực.
    const b = await chinhSach({ documentId: vb.id });
    await kich(b.versionId);
    await choHetHieuLuc({ versionId: b.versionId, effectiveTo: NOW, lyDo: "hết đúng lúc", actor: ACTOR, now: NOW });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: b.versionId } })).status).toBe("EXPIRED");
    // đối chứng dương: hết SAU now 1ms thì còn ACTIVE
    const c = await chinhSach({ documentId: vb.id });
    await kich(c.versionId);
    await choHetHieuLuc({ versionId: c.versionId, effectiveTo: new Date(NOW.getTime() + 1), lyDo: "hết sau", actor: ACTOR, now: NOW });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: c.versionId } })).status).toBe("ACTIVE");

    // Cấy 08/10 (X07, bỏ cổng trạng thái): 0 ca đỏ. Nháp / đã huỷ / đã hết hạn KHÔNG có "hết hiệu lực" để mà đặt — làm được thì
    // một nháp mang effectiveTo hợp lệ, hoặc một bản EXPIRED bị ghi đè mốc kết thúc (lịch sử bị sửa). `updateMany` có điều kiện
    // vẫn ném cùng MÃ lỗi nếu cổng đầu bị bỏ, nên ghim thêm CÂU: người dùng phải đọc đúng lý do ("chỉ bản ACTIVE"), không phải "vừa đổi trạng thái".
    const nhap = await chinhSach({ documentId: vb.id });
    await expect(choHetHieuLuc({ versionId: nhap.versionId, effectiveTo: NOW, lyDo: "x", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP", message: expect.stringContaining("bản ACTIVE") });
    await expect(choHetHieuLuc({ versionId: b.versionId, effectiveTo: new Date(NOW.getTime() - 86_400_000), lyDo: "sửa lịch sử", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP", message: expect.stringContaining("EXPIRED") });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: b.versionId } })).effectiveTo?.toISOString()).toBe(NOW.toISOString());
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: nhap.versionId } })).effectiveTo).toBeNull();
  });

  // ─── Cách ly cơ sở ──────────────────────────────────────────────────────────

  const actorCoSo = (centerIds: string[]): Actor =>
    ({
      userId: "fx-chs-actor",
      isSuperAdmin: false,
      isHoLevel: false,
      orgRoles: [],
      permissions: [],
      visibleCenterIds: centerIds,
      visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(),
      assignedClassIds: new Set<string>(),
    }) as Actor;

  it("[NHH-POL-DB-14] cách ly: actor CS1 thấy chính sách/văn bản/rule của Hội sở (NULL) + của CS1, KHÔNG thấy của CS2; đối chứng: đọc thẳng thấy cả ba", async () => {
    const vbHo = await vanBan({ ownerOrgUnitId: null });
    const vb1 = await vanBan({ ownerOrgUnitId: cs1 });
    const vb2 = await vanBan({ ownerOrgUnitId: cs2 });
    const cHo = await chinhSach({ ownerOrgUnitId: null, documentId: vbHo.id });
    const c1 = await chinhSach({ ownerOrgUnitId: cs1, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 }, documentId: vb1.id });
    const c2 = await chinhSach({ ownerOrgUnitId: cs2, phamVi: { loai: "ORG_UNIT", orgUnitId: cs2 }, documentId: vb2.id });
    const sdb = scopedDb(actorCoSo([cs1Center]));
    const where = { policyCode: { startsWith: P } };
    const pol = await sdb.commissionPolicy.findMany({ where, select: { id: true } });
    expect(pol.map((p) => p.id).sort()).toEqual([cHo.policyId, c1.policyId].sort());
    const ver = await sdb.commissionPolicyVersion.findMany({ where: { policy: where }, select: { id: true } });
    expect(ver.map((p) => p.id).sort()).toEqual([cHo.versionId, c1.versionId].sort());
    const rl = await sdb.commissionRule.findMany({ where: { version: { policy: where } }, select: { versionId: true } });
    expect(new Set(rl.map((r) => r.versionId))).toEqual(new Set([cHo.versionId, c1.versionId]));
    const doc = await sdb.regulationDocument.findMany({ where: { documentCode: { startsWith: P } }, select: { id: true } });
    expect(doc.map((d) => d.id).sort()).toEqual([vbHo.id, vb1.id].sort());
    // đối chứng dương: chiều ngược (CS2) cũng chỉ thấy Hội sở + CS2
    const pol2 = await scopedDb(actorCoSo([cs2Center])).commissionPolicy.findMany({ where, select: { id: true } });
    expect(pol2.map((p) => p.id).sort()).toEqual([cHo.policyId, c2.policyId].sort());
    // đọc thẳng (không scope) thấy cả ba — vì sao scopedDb tồn tại
    expect(await db.commissionPolicy.count({ where })).toBe(3);
  });

  // ─── Đầu-cuối: dựng ngữ cảnh từ DB rồi tính ─────────────────────────────────

  it("[NHH-POL-DB-15] đầu-cuối: policy v1 (SR.QD.208) kích hoạt qua service ⇒ docHoaHongContext ⇒ tinhChinhSachChoPhan ra đủ 5 vai; trần đọc từ setting (mặc định 0.09)", async () => {
    const vb = await vanBan({ documentCode: `${P}208`, title: "SR.QD.208" });
    const c = await chinhSach({ documentId: vb.id });
    await kich(c.versionId);
    const ctx = await docHoaHongContext(db);
    expect(ctx.tranTongTiLe).toBe(0.09);
    expect(ctx.vaiHuong.map((v) => v.code)).toEqual(MASTER_VAI_HUONG.map((v) => v.code));
    expect(ctx.thuTuPhamVi).toHaveLength(9);
    const nguoi = new Map(
      ["SALE", "SALE_ADMIN", "CENTER_MANAGER", "MARKETING", "TRIAL_TEACHER"].map((r) => [
        r,
        { loai: "CO_NGUOI" as const, nguoi: [{ kind: "USER" as const, id: `u-${r}` }], biLoai: [], canCu: "t" },
      ]),
    );
    const kq = tinhChinhSachChoPhan({
      hoaHong: { ...ctx, quyTac: ctx.quyTac.filter((q) => q.policyId === c.policyId) },
      loaiGiaoDich: "NEW",
      coSo: 1_234_550,
      rateDate: new Date("2026-10-20T03:00:00.000Z"),
      orgUnitPath: "/ho/danang/cs1/",
      nguon: { sourceGroupId: null, coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
      nguoiHuong: nguoi,
      roleDefIdsTheoNguoi: new Map(),
    });
    expect(kq.loai).toBe("OK");
    if (kq.loai === "OK") expect(kq.cacVai.filter((v) => v.trangThai === "SINH_DONG")).toHaveLength(5);
  });

  it("[NHH-POL-DB-10b] version MỚI chép rule từ bản MỚI NHẤT (không phải bản đầu): v1 → v2 (đổi rule) → v3 (rules = null) ⇒ v3 mang rule của v2", async () => {
    // Cấy 08/10 (X05: orderBy versionNo desc → asc): 0 ca đỏ — mọi ca chỉ có MỘT bản trước nên 'mới nhất' = 'cũ nhất'.
    // Fixture hai bản trước phải KHÁC rule nhau, nếu không phép đảo hai thứ cho đúng hai con số cũ (cạm bẫy 1–1 của repo).
    const vb = await vanBan();
    const c = await chinhSach({ documentId: vb.id, rules: [rule("SALE", 0.04), rule("SALE_ADMIN", 0.01)] });
    const v2 = await taoPhienBanMoi({ policyId: c.policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "v2", documentId: vb.id, rules: [rule("SALE", 0.03)], actor: ACTOR, now: NOW });
    const v3 = await taoPhienBanMoi({ policyId: c.policyId, phamVi: null, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null, reason: "v3", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    expect(v3.versionNo).toBe(3);
    const rules = await db.commissionRule.findMany({ where: { versionId: v3.versionId }, include: { beneficiaryRole: { select: { code: true } } } });
    expect(rules.map((x) => [x.beneficiaryRole.code, Number(x.rate)])).toEqual([["SALE", 0.03]]);
    expect(await db.commissionRule.count({ where: { versionId: v2.versionId } })).toBe(1);
  });

  it("[NHH-POL-09b] 'cơ sở trong phạm vi' theo phạm vi ORG_UNIT của version, không theo đơn vị SỞ HỮU: chính sách Hội sở áp riêng CS1 chỉ đòi người phụ trách của CS1", async () => {
    // Cấy 08/10 (X15: pathCoSo luôn là path đơn vị sở hữu = '/'): 0 ca đỏ — DB-09/POL-09 luôn đặt chủ sở hữu = phạm vi = CS1.
    const vb = await vanBan();
    const { versionId } = await chinhSach({ ownerOrgUnitId: null, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 }, documentId: vb.id, rules: [rule("MARKETING", 0.01)] });
    // chiều âm trước (version vẫn DRAFT): gỡ người của CS1 (cơ sở TRONG phạm vi) ⇒ chặn, và câu lỗi nói đúng cơ sở
    await db.centerCommissionAssignee.deleteMany({ where: { centerId: cs1Center, note: { startsWith: P } } });
    const r = await kich(versionId).catch((e) => e);
    expect(r).toMatchObject({ ma: "KICH_HOAT_BI_CHAN" });
    const chiTiet = (r as HoaHongError).chiTiet as { ma: string; thongBao: string }[];
    expect(chiTiet.find((x) => x.ma === "THIEU_NGUOI_PHU_TRACH")?.thongBao).toContain(cs1Center);
    expect(chiTiet.map((x) => x.thongBao).join(" ")).not.toContain(cs2Center); // CS2 vẫn có người nhưng cũng KHÔNG bị nhắc tới
    // chiều dương: khai lại CS1, gỡ CS2 (cơ sở NGOÀI phạm vi, chưa khai ai) ⇒ qua
    const u = await seedUser({ email: `${P}qc-cs1@ci.test`, role: "SALES_CSM", name: `${P}qc-cs1` });
    await db.centerCommissionAssignee.create({ data: { centerId: cs1Center, role: "QC", userId: u.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: `${P}khai-lai` } });
    await db.centerCommissionAssignee.deleteMany({ where: { centerId: cs2Center, note: { startsWith: P } } });
    expect(await loiKichHoat(versionId)).toEqual([]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("ACTIVE");
  });

  it("[NHH-POL-DB-15b] docHoaHongContext.nhomNguon: chỉ nhóm ĐANG hoạt động, KHÔNG gồm UNKNOWN, theo thứ tự sortOrder", async () => {
    // Cấy 08/10 (S14, bỏ `code != UNKNOWN`): 0 ca đỏ. Hậu quả nếu lọt: UNKNOWN không có rule ⇒ 'mức thấp nhất' = 0 ⇒ MỌI nguồn
    // không rõ bị trả 0 đ, im lặng. Phép tính UNKNOWN thuần đã đúng (POL-03); chỉ bộ NẠP mới có thể làm hỏng nó.
    expect(await db.leadSourceGroup.findUnique({ where: { code: "UNKNOWN" } }), "tiền đề: master có nhóm UNKNOWN").not.toBeNull();
    await db.leadSourceGroup.create({ data: { code: "FXCHSON", name: "FX bật", sortOrder: 500 } });
    await db.leadSourceGroup.create({ data: { code: "FXCHSOFF", name: "FX tắt", sortOrder: 501, status: "INACTIVE" } });
    const codes = (await docHoaHongContext(db)).nhomNguon.map((g) => g.code);
    expect(codes).toContain("FXCHSON");
    expect(codes).not.toContain("FXCHSOFF");
    // [DYN-CE] cờ commissionEnabled đi cùng từng nhóm vào bối cảnh tính: nguồn admin tạo mặc định TẮT; nguồn gốc PAID_ADS BẬT
    const ctxNhom = (await docHoaHongContext(db)).nhomNguon;
    expect(ctxNhom.find((g) => g.code === "FXCHSON")?.coHoaHong).toBe(false);
    await db.leadSourceGroup.update({ where: { code: "FXCHSON" }, data: { commissionEnabled: true } });
    expect((await docHoaHongContext(db)).nhomNguon.find((g) => g.code === "FXCHSON")?.coHoaHong).toBe(true);
    expect(codes).not.toContain("UNKNOWN");
    const hang = await db.leadSourceGroup.findMany({ where: { code: { in: codes } }, select: { code: true, sortOrder: true } });
    const thuTu = codes.map((c) => hang.find((h) => h.code === c)!.sortOrder);
    expect(thuTu).toEqual([...thuTu].sort((a, b) => a - b));
  });

  it("[NHH-POL-DB-17] qua docQuyTac (ánh xạ đơn vị sở hữu → path + độ sâu từ DB): rule của Hội sở THUA rule của đơn vị cụ thể ở CÙNG phạm vi; rule của CS1 KHÔNG áp giao dịch CS2", async () => {
    // Cấy 08/10 (S17: độ sâu HỘI SỞ −1 → 99; S18: path đơn vị sở hữu → "/"): cả hai 0 ca đỏ — mọi ca DB cũ chỉ có MỘT bên
    // (hoặc toàn Hội sở), còn `chonQuyTac` thuần nhận `QuyTac` dựng tay nên không thấy lớp ánh xạ này.
    const vb = await vanBan();
    const hoP = await chinhSach({ ownerOrgUnitId: null, documentId: vb.id, rules: [rule("SALE", 0.04)] });
    await kich(hoP.versionId);
    const cs1P = await chinhSach({ ownerOrgUnitId: cs1, documentId: vb.id, rules: [rule("SALE", 0.05)] });
    // rule CS1 5% > 4% của Hội sở ⇒ mức UNKNOWN có thể tăng ⇒ guardrail đòi xác nhận (cảnh báo, không phải lỗi)
    await kich(cs1P.versionId, { xacNhanCanhBao: { lyDo: "fixture: CS1 nâng mức Sale" } });
    const duongDan = async (id: string) => (await db.orgUnit.findUniqueOrThrow({ where: { id }, select: { path: true } })).path!;
    const [pHo, p1, p2] = [await duongDan(ho), await duongDan(cs1), await duongDan(cs2)];
    const quyTac = (await docQuyTac(db)).filter((q) => q.policyId === hoP.policyId || q.policyId === cs1P.policyId);
    const thuTu = (await docHoaHongContext(db)).thuTuPhamVi;
    const chon = (orgUnitPath: string) => {
      const r = chonQuyTac({
        ctx: { roleCode: "SALE", transactionType: "NEW", revenueComponent: "TUITION", rateDate: new Date("2026-10-20T03:00:00.000Z"), orgUnitPath, nguoiHuongUserId: null, affiliateId: null, sourceId: null, campaignId: null, eventId: null, sourceGroupId: null, nguonCoHoaHong: true, roleDefIds: [] },
        quyTac,
        thuTuPhamVi: thuTu,
      });
      if (r.loai !== "THANG") throw new Error(`mong THANG, nhận ${r.loai}`);
      return { policyId: r.quyTac.policyId, rate: Number(r.quyTac.giaTri) };
    };
    expect(chon(p1)).toEqual({ policyId: cs1P.policyId, rate: 0.05 }); // đơn vị cụ thể thắng Hội sở
    expect(chon(p2)).toEqual({ policyId: hoP.policyId, rate: 0.04 }); // CS2: rule CS1 không áp, Hội sở áp
    expect(chon(pHo)).toEqual({ policyId: hoP.policyId, rate: 0.04 }); // Hội sở: chỉ rule Hội sở
  });

  it("[NHH-POL-DB-18] version MỚI (phamVi = null) giữ đúng phạm vi của bản trước — từng loại phạm vi, từng cột scope*", async () => {
    // Cấy 08/10 (S26: PERSON kế thừa lấy nhầm cột scopeAffiliateId): 0 ca đỏ — mọi lần gọi taoPhienBanMoi trong bộ cũ là GLOBAL.
    // Phạm vi hỏng thì version mới hoặc nổ lỗi thô (userId null) hoặc — tệ hơn — âm thầm đổi chính sách sang phạm vi khác.
    await seedRoles();
    const vb = await vanBan();
    const u = await seedUser({ email: `${P}u18@ci.test`, role: "SALES_CSM", name: `${P}u18` });
    const aff = await db.affiliate.create({ data: { code: "FXCHSAFF18", name: "FX aff 18" } });
    const nhom = await db.leadSourceGroup.create({ data: { code: "FXCHSG18", name: "FX g18", sortOrder: 918 } });
    const vai = await db.roleDef.findFirstOrThrow({ select: { id: true } });
    const phamVis: PhamViInput[] = [
      { loai: "GLOBAL" },
      { loai: "PERSON", userId: u.id },
      { loai: "AFFILIATE", affiliateId: aff.id },
      { loai: "SOURCE_GROUP", sourceGroupId: nhom.id },
      { loai: "ORG_UNIT", orgUnitId: cs1 },
      { loai: "ROLE", roleDefId: vai.id },
    ];
    const cot = { scopeType: true, scopeKey: true, scopeUserId: true, scopeAffiliateId: true, scopeSourceGroupId: true, scopeOrgUnitId: true, scopeRoleDefId: true } as const;
    for (const pv of phamVis) {
      const c = await chinhSach({ documentId: vb.id, phamVi: pv });
      const v2 = await taoPhienBanMoi({ policyId: c.policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "kế thừa phạm vi", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
      const [a, b] = await Promise.all([
        db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: c.versionId }, select: cot }),
        db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: v2.versionId }, select: cot }),
      ]);
      expect(a.scopeType, `bản 1 ${pv.loai}`).toBe(pv.loai);
      expect(b, `bản 2 ${pv.loai}`).toEqual(a);
    }
  });

  it("[NHH-POL-DB-19] trần ĐỌC từ setting `crm.commissionMaxTotalRate` ở CẢ HAI đường DB (kích hoạt và ngữ cảnh tính): đổi setting ⇒ kết quả đổi theo", async () => {
    // Cấy 08/10 (S27/S28): thay kết quả getSetting bằng hằng không qua grep (`Number(9)/100`) ⇒ chỉ lưới đếm-chuỗi [NHH-W3]
    // đỏ nếu lời gọi bị xoá; nếu lời gọi còn mà kết quả bị bỏ thì 0 ca đỏ. Ca này đo HÀNH VI: lật setting thật trong DB.
    const KEY = "crm.commissionMaxTotalRate";
    const cu = await db.systemSetting.findUnique({ where: { key: KEY } });
    const dat = (v: number | null) =>
      v === null
        ? db.systemSetting.deleteMany({ where: { key: KEY } })
        : db.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, valueJson: v, updatedByName: P }, update: { valueJson: v, updatedByName: P } });
    try {
      const vb = await vanBan();
      const chin9 = await chinhSach({ documentId: vb.id }); // Σ 9% đúng
      const chin95 = await chinhSach({ documentId: vb.id, rules: [...SEED_V1().slice(0, 4), rule("TRIAL_TEACHER", 0.015)] }); // Σ 9,5%
      // trần 8%: bộ 9% cũng vượt; ngữ cảnh báo 0.08
      await dat(0.08);
      expect((await docHoaHongContext(db)).tranTongTiLe).toBe(0.08);
      expect(await loiKichHoat(chin9.versionId)).toContain("VUOT_TRAN");
      // trần mặc định (xoá setting): 9,5% vượt
      await dat(null);
      expect((await docHoaHongContext(db)).tranTongTiLe).toBe(0.09);
      expect(await loiKichHoat(chin95.versionId)).toContain("VUOT_TRAN");
      // trần 10%: 9,5% kích hoạt được; ngữ cảnh báo 0.1
      await dat(0.1);
      expect((await docHoaHongContext(db)).tranTongTiLe).toBe(0.1);
      expect(await loiKichHoat(chin95.versionId)).toEqual([]);
      expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: chin95.versionId } })).status).toBe("ACTIVE");
    } finally {
      if (cu) await dat(Number(cu.valueJson));
      else await dat(null);
    }
  });

  // ─── Review 08/10: owner đơn vị, kéo dài hiệu lực, lùi qua bản đã dùng, đua kích hoạt ─────────────────────

  it("[NHH-POL-DB-20] đơn vị SỞ HỮU chỉ nhận Hội sở (null) hoặc một CƠ SỞ (OrgUnit CENTER): đơn vị khác có `centerId = NULL` mà NULL là \"dùng chung mọi cơ sở\" trong scopedDb ⇒ bị từ chối", async () => {
    // Cấy 08/10 (review): owner = REGION ⇒ hàng ghi `centerId: null` ⇒ actor của MỌI cơ sở thấy văn bản/chính sách của vùng.
    // Cấy 08/10 (rà soát độc lập): bỏ vế `o.type !== "CENTER"` XANH — mọi đơn vị không phải cơ sở của fixture đều có `centerId = NULL`, nên vế
    // `centerId === null` đứng một mình bắt hết. Thêm một đơn vị CAMPUS MANG centerId (Phase A "trỏ Center cũ") để vế `type` tự đứng.
    const centerCuaCampus = await db.center.create({ data: { id: `${P}campus`, name: "Center của campus fixture", slug: `${P}campus`, address: "-" } });
    await db.orgUnit.create({ data: { type: "CAMPUS", code: "FXCHS-CAMPUS", name: "Campus fixture", path: "/fxchs-campus/", depth: 0, centerId: centerCuaCampus.id } });
    const khongPhaiCoSo = await db.orgUnit.findMany({ where: { type: { not: "CENTER" }, deletedAt: null, path: { not: null } }, select: { id: true, type: true } });
    expect(khongPhaiCoSo.length, "fixture phải có ít nhất một đơn vị không phải cơ sở (HO/REGION)").toBeGreaterThan(0);
    for (const o of khongPhaiCoSo) {
      await expect(vanBan({ ownerOrgUnitId: o.id }), `văn bản owner ${o.type}`).rejects.toMatchObject({ ma: "DON_VI_KHONG_HOP_LE" });
      await expect(chinhSach({ ownerOrgUnitId: o.id }), `chính sách owner ${o.type}`).rejects.toMatchObject({ ma: "DON_VI_KHONG_HOP_LE" });
    }
    expect(await db.regulationDocument.count({ where: { documentCode: { startsWith: P } } })).toBe(0);
    expect(await db.commissionPolicy.count({ where: { policyCode: { startsWith: P } } })).toBe(0);
    // đối chứng dương: Hội sở (null) và cơ sở CS1 đều qua
    const c1 = await chinhSach({ ownerOrgUnitId: cs1, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 } });
    expect((await db.commissionPolicy.findUniqueOrThrow({ where: { id: c1.policyId } })).centerId).toBe(cs1Center);
    await chinhSach({ ownerOrgUnitId: null });
  });

  it("[NHH-POL-DB-21] cho hết hiệu lực chỉ RÚT NGẮN (kéo dài qua version kế tiếp là chồng lấn không qua guardrail); bản ĐÃ DÙNG không cho hết hiệu lực về quá khứ", async () => {
    const vb = await vanBan();
    const a = await chinhSach({ documentId: vb.id, effectiveTo: new Date("2027-01-31T17:00:00.000Z") });
    await kich(a.versionId);
    // kéo dài 31/01 → 30/06/2027
    await expect(choHetHieuLuc({ versionId: a.versionId, effectiveTo: new Date("2027-06-30T17:00:00.000Z"), lyDo: "kéo dài", actor: ACTOR, now: NOW })).rejects.toMatchObject({
      ma: "DU_LIEU_KHONG_HOP_LE",
      message: expect.stringContaining("rút ngắn"),
    });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } })).effectiveTo?.toISOString()).toBe("2027-01-31T17:00:00.000Z");
    // đối chứng dương: đặt đúng mốc cũ và rút ngắn đều qua
    await choHetHieuLuc({ versionId: a.versionId, effectiveTo: new Date("2027-01-31T17:00:00.000Z"), lyDo: "giữ nguyên", actor: ACTOR, now: NOW });
    await choHetHieuLuc({ versionId: a.versionId, effectiveTo: new Date("2027-01-01T00:00:00.000Z"), lyDo: "rút ngắn", actor: ACTOR, now: NOW });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } })).effectiveTo?.toISOString()).toBe("2027-01-01T00:00:00.000Z");

    // bản ĐÃ DÙNG: hết hiệu lực lùi về quá khứ đổi rule thắng của giao dịch đã tính ⇒ VERSION_DA_KHOA; hết hiệu lực TƯƠNG LAI thì qua
    const b = await chinhSach({ documentId: vb.id, rules: [rule("SALE", 0.02, { transactionTypeCode: "RENEWAL" })] }); // ô RENEWAL — không đụng bản `a` (NEW)
    await kich(b.versionId);
    await db.$transaction((tx) => danhDauDaDung(tx, b.versionId, new Date("2026-10-08T01:00:00.000Z")));
    await expect(choHetHieuLuc({ versionId: b.versionId, effectiveTo: new Date(NOW.getTime() - 86_400_000), lyDo: "lùi quá khứ", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "VERSION_DA_KHOA" });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: b.versionId } })).effectiveTo).toBeNull();
    await choHetHieuLuc({ versionId: b.versionId, effectiveTo: new Date(NOW.getTime() + 86_400_000), lyDo: "kết thúc ngày mai", actor: ACTOR, now: NOW });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: b.versionId } })).status).toBe("ACTIVE");

    // Cấy 08/10 (rà soát độc lập): `effectiveTo < now` → `<=` XANH — ca trên đặt mốc cách now cả ngày, không ca nào ở BIÊN. Biên MỞ: hết hiệu lực
    // ĐÚNG lúc now thì rule vẫn thắng mọi giao dịch có rateDate < now (không đổi gì đã tính) ⇒ được phép (→ EXPIRED); lùi 1 ms thì khoá.
    const c = await chinhSach({ documentId: vb.id, rules: [rule("SALE_ADMIN", 0.01, { transactionTypeCode: "RENEWAL" })] }); // ô RENEWAL·SALE_ADMIN — không chồng bản `a` (NEW) hay `b` (RENEWAL·SALE)
    await kich(c.versionId);
    await db.$transaction((tx) => danhDauDaDung(tx, c.versionId, new Date("2026-10-08T01:00:00.000Z")));
    await expect(choHetHieuLuc({ versionId: c.versionId, effectiveTo: new Date(NOW.getTime() - 1), lyDo: "lùi 1 ms", actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "VERSION_DA_KHOA" });
    await choHetHieuLuc({ versionId: c.versionId, effectiveTo: new Date(NOW), lyDo: "đúng lúc này", actor: ACTOR, now: NOW });
    const sauC = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: c.versionId } });
    expect(sauC.status).toBe("EXPIRED");
    expect(sauC.effectiveTo?.toISOString()).toBe(NOW.toISOString());
  });

  it("[NHH-POL-DB-22] kích hoạt version MỚI không đóng LÙI bản trước ĐÃ DÙNG: hiệu lực nằm trước `now` ⇒ chặn LUI_HIEU_LUC_BAN_DA_DUNG, bản trước vẫn ACTIVE; sửa hiệu lực sang tương lai thì kích hoạt được", async () => {
    const vb = await vanBan();
    const v1 = await chinhSach({ documentId: vb.id });
    await kich(v1.versionId);
    await db.$transaction((tx) => danhDauDaDung(tx, v1.versionId, new Date("2026-10-08T01:00:00.000Z")));
    const v2 = await taoPhienBanMoi({ policyId: v1.policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "v2 lùi", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    expect(await loiKichHoat(v2.versionId)).toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
    const sau = await db.commissionPolicyVersion.findMany({ where: { id: { in: [v1.versionId, v2.versionId] } }, orderBy: { versionNo: "asc" } });
    expect(sau.map((x) => x.status)).toEqual(["ACTIVE", "DRAFT"]);
    expect(sau[0]!.effectiveTo).toBeNull();
    // đối chứng dương: dời hiệu lực v2 sang tương lai (≥ NOW) ⇒ kích hoạt được, v1 bị đóng tại đó
    const tuongLai = new Date("2026-10-09T17:00:00.000Z");
    await suaNhap({ versionId: v2.versionId, phamVi: { loai: "GLOBAL" }, effectiveFrom: tuongLai, effectiveTo: null, reason: "v2 từ mai", documentId: vb.id, rules: SEED_V1(), actor: ACTOR, now: NOW });
    expect(await loiKichHoat(v2.versionId)).toEqual([]);
    const sau2 = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: v1.versionId } });
    expect([sau2.status, sau2.effectiveTo?.toISOString()]).toEqual(["SUPERSEDED", tuongLai.toISOString()]);
  });

  it("[NHH-POL-DB-23] version mới lấy rule + phạm vi từ bản KHÔNG BỊ HUỶ mới nhất (bản huỷ không làm gốc); chỉ còn bản huỷ ⇒ thiếu gốc thì từ chối, khai đủ thì qua", async () => {
    const vb = await vanBan();
    const c = await chinhSach({ documentId: vb.id });
    const huy = await taoPhienBanMoi({ policyId: c.policyId, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "soạn nhầm", documentId: vb.id, rules: [rule("SALE", 0.03)], actor: ACTOR, now: NOW });
    await huyNhap({ versionId: huy.versionId, lyDo: "soạn nhầm", actor: ACTOR, now: NOW });
    const moi = await taoPhienBanMoi({ policyId: c.policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "v3", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: moi.versionId }, include: { rules: true } });
    expect([v.scopeType, v.rules.length]).toEqual(["GLOBAL", 5]); // của v1, không phải ORG_UNIT/1 rule của bản đã huỷ
    // chỉ còn bản huỷ
    const rieng = await chinhSach({ documentId: vb.id });
    await huyNhap({ versionId: rieng.versionId, lyDo: "không dùng", actor: ACTOR, now: NOW });
    await expect(taoPhienBanMoi({ policyId: rieng.policyId, phamVi: null, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: null, actor: ACTOR, now: NOW })).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    await expect(taoPhienBanMoi({ policyId: rieng.policyId, phamVi: { loai: "GLOBAL" }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: SEED_V1(), actor: ACTOR, now: NOW })).resolves.toMatchObject({ versionNo: 2 });
  });

  // Giữ khoá `KHOA_ADVISORY_CHINH_SACH` trong một transaction MỞ để hai lượt kích hoạt cùng đọc guardrail xong rồi cùng chờ ở cổng ghi —
  // sắp xếp được một cuộc đua mà nếu không thì chỉ lộ ra khi hai người bấm trong cùng vài mili-giây.
  async function giuKhoa() {
    let nha!: () => void;
    const cho = new Promise<void>((r) => (nha = r));
    let daLay!: () => void;
    const laiDuoc = new Promise<void>((r) => (daLay = r));
    const xong = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${KHOA_ADVISORY_CHINH_SACH})::bigint)`;
        daLay();
        await cho;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await laiDuoc;
    return { nha, xong };
  }
  async function choNguoiDoiKhoa(n: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const [r] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (Number(r!.n) >= n) return;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error(`Không thấy ${n} phiên chờ khoá advisory — kích hoạt không đi qua cổng khoá`);
  }
  const ketQuaKich = (versionId: string) =>
    kich(versionId).then(
      () => "ok" as const,
      (e: unknown) => e,
    );

  it("[NHH-POL-DB-24] hai policy KHÁC nhau kích hoạt cùng lúc, mỗi bên một mình đều hợp lệ nhưng chung thì chồng (SALE·NEW cùng hạng): đúng MỘT bên thắng, bên kia nhận TAP_HIEU_LUC_DA_DOI; thử lại thì guardrail nói CHONG_LAN_RULE", async () => {
    // Cấy 08/10 (review): guardrail đọc tập ACTIVE NGOÀI transaction ⇒ hai người cùng đọc "chưa có gì" rồi cùng ghi ⇒ trần/chồng lấn bị vượt.
    const vb = await vanBan();
    const a = await chinhSach({ documentId: vb.id });
    const b = await chinhSach({ documentId: vb.id, rules: [rule("SALE", 0.04)] });
    const giu = await giuKhoa();
    const pa = ketQuaKich(a.versionId);
    const pb = ketQuaKich(b.versionId);
    await choNguoiDoiKhoa(2);
    giu.nha();
    await giu.xong;
    const kq = await Promise.all([pa, pb]);
    expect(kq.filter((k) => k === "ok")).toHaveLength(1);
    const thua = kq.find((k) => k !== "ok");
    expect(thua).toMatchObject({ ma: "TAP_HIEU_LUC_DA_DOI" });
    expect(await db.commissionPolicyVersion.count({ where: { id: { in: [a.versionId, b.versionId] }, status: "ACTIVE" } })).toBe(1);
    const thuaId = kq[0] === "ok" ? b.versionId : a.versionId;
    expect(await loiKichHoat(thuaId)).toContain("CHONG_LAN_RULE");
  });

  it("[NHH-POL-DB-25] nháp bị SỬA giữa lúc guardrail đọc và lúc ghi ⇒ không kích hoạt bản chưa được kiểm (VERSION_DA_DOI); nháp vẫn DRAFT", async () => {
    // Cấy 08/10 (review): `suaNhap` thay rule sau khi guardrail đã đọc ⇒ kích hoạt một bộ rule (11% > trần 9%) chưa từng qua guardrail.
    const vb = await vanBan();
    const a = await chinhSach({ documentId: vb.id });
    const giu = await giuKhoa();
    const pa = ketQuaKich(a.versionId);
    await choNguoiDoiKhoa(1);
    await suaNhap({
      versionId: a.versionId,
      phamVi: { loai: "GLOBAL" },
      effectiveFrom: HIEU_LUC,
      effectiveTo: null,
      reason: "sửa giữa chừng",
      documentId: vb.id,
      rules: [...SEED_V1().slice(0, 4), rule("TRIAL_TEACHER", 0.03)],
      actor: ACTOR,
      now: NOW,
    });
    giu.nha();
    await giu.xong;
    expect(await pa).toMatchObject({ ma: "VERSION_DA_DOI" });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } })).status).toBe("DRAFT");
    // đối chứng dương: không ai sửa ⇒ kích hoạt bình thường
    const b = await chinhSach({ documentId: vb.id, rules: [rule("SALE_ADMIN", 0.01)] });
    await kich(b.versionId);
  });

  it("[NHH-POL-DB-26] bản trước được đánh dấu ĐÃ DÙNG giữa lúc guardrail đọc và lúc ghi ⇒ không đóng lùi nó (TAP_HIEU_LUC_DA_DOI); bản trước vẫn ACTIVE", async () => {
    // Cấy 08/10 (review): vân tay tập ACTIVE không có `firstUsedAt` ⇒ sổ (PR5) đánh dấu dùng v1 sau khi guardrail đã coi v1 là "chưa dùng"
    // vẫn đóng lùi được nó. Guardrail lúc đọc: v1 CHƯA dùng nên v2 hiệu lực quá khứ hợp lệ; lúc ghi v1 đã dùng.
    const vb = await vanBan();
    const v1 = await chinhSach({ documentId: vb.id });
    await kich(v1.versionId);
    const v2 = await taoPhienBanMoi({ policyId: v1.policyId, phamVi: null, effectiveFrom: new Date("2026-06-30T17:00:00.000Z"), effectiveTo: null, reason: "v2 lùi", documentId: vb.id, rules: null, actor: ACTOR, now: NOW });
    const giu = await giuKhoa();
    const p2 = ketQuaKich(v2.versionId);
    await choNguoiDoiKhoa(1);
    await db.$transaction((tx) => danhDauDaDung(tx, v1.versionId, new Date("2026-10-08T01:00:00.000Z")));
    giu.nha();
    await giu.xong;
    expect(await p2).toMatchObject({ ma: "TAP_HIEU_LUC_DA_DOI" });
    const sau = await db.commissionPolicyVersion.findMany({ where: { id: { in: [v1.versionId, v2.versionId] } }, orderBy: { versionNo: "asc" } });
    expect(sau.map((x) => x.status)).toEqual(["ACTIVE", "DRAFT"]);
    expect(sau[0]!.effectiveTo).toBeNull();
  });

  it("[NHH-POL-DB-27] sửa nháp có mốc updatedAt đã thấy: hai người cùng cầm mốc cũ ⇒ người sau nhận VERSION_DA_DOI (không phải VERSION_KHONG_PHAI_NHAP), nháp giữ bản của người trước; bản đã kích hoạt vẫn là VERSION_KHONG_PHAI_NHAP", async () => {
    // Cấy 08/10: bỏ `updatedAt` khỏi điều kiện phép ghi đầu tiên của `suaNhap` ⇒ người sau ghi đè im lặng (kiểm ở lớp điều phối nằm NGOÀI transaction).
    const vb = await vanBan();
    const { versionId } = await chinhSach({ documentId: vb.id });
    const thay = (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { updatedAt: true } })).updatedAt;
    const sua = (rate: number, updatedAtDaThay: Date) =>
      suaNhap({ versionId, phamVi: { loai: "GLOBAL" }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: [rule("SALE", rate)], actor: ACTOR, now: NOW, updatedAtDaThay });
    await sua(0.03, thay);
    await expect(sua(0.06, thay)).rejects.toMatchObject({ ma: "VERSION_DA_DOI" });
    expect((await db.commissionRule.findMany({ where: { versionId } })).map((x) => Number(x.rate))).toEqual([0.03]);
    // đối chứng: cầm mốc MỚI thì sửa được
    const moi = (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { updatedAt: true } })).updatedAt;
    await sua(0.07, moi);
    expect((await db.commissionRule.findMany({ where: { versionId } })).map((x) => Number(x.rate))).toEqual([0.07]);
    // hết là nháp thì lỗi phải nói đúng nguyên nhân
    await kich(versionId);
    const sau = (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { updatedAt: true } })).updatedAt;
    await expect(sua(0.01, sau)).rejects.toMatchObject({ ma: "VERSION_KHONG_PHAI_NHAP" });
  });

  it("[NHH-POL-DB-28] kích hoạt có mốc updatedAt đã thấy: nháp đã bị sửa sau mốc ⇒ VERSION_DA_DOI và version vẫn DRAFT; đúng mốc thì kích hoạt được", async () => {
    // Cấy 08/10: bỏ phép so `updatedAtDaThay` ở `kichHoat` ⇒ kích hoạt nội dung mà người duyệt chưa từng thấy.
    const vb = await vanBan();
    const { versionId } = await chinhSach({ documentId: vb.id });
    const thay = (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { updatedAt: true } })).updatedAt;
    await suaNhap({ versionId, phamVi: { loai: "GLOBAL" }, effectiveFrom: HIEU_LUC, effectiveTo: null, reason: "x", documentId: vb.id, rules: [rule("SALE", 0.08)], actor: ACTOR, now: NOW });
    await expect(kich(versionId, { updatedAtDaThay: thay })).rejects.toMatchObject({ ma: "VERSION_DA_DOI" });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("DRAFT");
    const moi = (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { updatedAt: true } })).updatedAt;
    await kich(versionId, { updatedAtDaThay: moi });
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("ACTIVE");
  });
});
