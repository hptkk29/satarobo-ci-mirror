// @vitest-environment node
/**
 * [NHH-SEED-DB-*] — seed chính sách v1 (SR.QD.208) trên Postgres THẬT: dry-run không ghi, apply idempotent, kích hoạt
 * chỉ khi đủ điều kiện (tệp văn bản + người phụ trách), không đụng cái đã có.
 *
 * ⚠️ Seed dùng mã CỐ ĐỊNH (`SR.QD.208`, `SR.QD.208/*`) nên ca này TỰ DỌN đúng các mã đó ở đầu/cuối — chỉ chạy trên DB test
 * (`assertTestDb`). Ngày TUYỆT ĐỐI (luật 19); mỗi ca tự dựng (luật 18).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { gieoChinhSachV1 } from "../../lib/hoa-hong/seed-chinh-sach-v1";
import { kichHoat, taoChinhSach, taoVanBan } from "../../lib/hoa-hong/chinh-sach-service";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";

if (!RUN_DB_TESTS) console.warn(`[NHH-SEED-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-10-08T03:00:00.000Z");
const ACTOR = { userId: null, ten: "seed fixture" };
const TEP = { fileKey: "documents/sr-qd-208.pdf", fileName: "sr-qd-208.pdf", fileUrl: "https://example.test/sr-qd-208.pdf" };
const KHONG_TEP = { fileKey: null, fileName: null, fileUrl: null };
const P = "fx-seed-";

async function don() {
  const cs = await db.commissionPolicy.findMany({ where: { OR: [{ policyCode: { startsWith: "SR.QD.208/" } }, { policyCode: { startsWith: P } }] }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.commissionRule.deleteMany({ where: { version: { policyId: { in: ids } } } });
  await db.commissionPolicyVersion.deleteMany({ where: { policyId: { in: ids } } });
  await db.commissionPolicy.deleteMany({ where: { id: { in: ids } } });
  await db.regulationDocument.deleteMany({ where: { OR: [{ documentCode: "SR.QD.208" }, { documentCode: { startsWith: P } }] } });
  await db.centerCommissionAssignee.deleteMany({ where: { note: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorName: ACTOR.ten, entityType: { in: ["CommissionPolicyVersion", "CommissionPolicy", "RegulationDocument"] } } });
  const u = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  if (u.length) await db.user.deleteMany({ where: { id: { in: u.map((x) => x.id) } } });
}

async function khaiNguoiPhuTrach() {
  const centers = (await db.orgUnit.findMany({ where: { code: { in: ["CS1", "CS2"] } }, select: { centerId: true } })).map((o) => o.centerId!);
  const u = await seedUser({ email: `${P}nguoi@ci.test`, role: "SALES_CSM", name: `${P}nguoi` });
  for (const centerId of centers) {
    for (const role of ["QC", "QL_TT"] as const) {
      await db.centerCommissionAssignee.create({ data: { centerId, role, userId: u.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: `${P}khai` } });
    }
  }
}

const chay = (p: Partial<Parameters<typeof gieoChinhSachV1>[0]> = {}) =>
  gieoChinhSachV1({ apply: true, kichHoat: false, tep: TEP, approvedByName: "Hồ Đắc Phúc", hieuLuc: null, xacNhanCanhBao: null, actor: ACTOR, now: NOW, ...p });

describe.skipIf(!RUN_DB_TESTS)("[NHH-SEED-DB] seed chính sách v1", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await damBaoDanhMucGoc(db); // chính sách THEO NGUỒN tra nguồn theo mã — ca không được mượn danh mục do bộ trước để lại (luật 18)
  }, 120_000);
  beforeEach(don, 60_000);
  afterAll(don, 60_000);

  it("[NHH-SEED-DB-01] DRY-RUN không ghi gì: số dòng mọi bảng chính sách trước = sau; kết quả nói 'SE_TAO'", async () => {
    const dem = async () => [
      await db.regulationDocument.count(),
      await db.commissionPolicy.count(),
      await db.commissionPolicyVersion.count(),
      await db.commissionRule.count(),
      await db.auditLog.count(),
    ];
    const truoc = await dem();
    const kq = await chay({ apply: false, kichHoat: true });
    expect(await dem()).toEqual(truoc);
    expect(kq.vanBan.trangThai).toBe("SE_TAO");
    expect(kq.chinhSach.map((c) => c.trangThai)).toEqual(Array(12).fill("SE_TAO")); // 4 chính sách chung + 8 theo nguồn (nháp)
    expect(kq.chinhSach.find((c) => c.policyCode === "SR.QD.208/HV_MOI")!.kichHoat).toBe("SE_KICH_HOAT");
    expect(kq.khongChuyen.map((k) => k.maCu).sort()).toEqual(["BAN_THIET_BI", "CHUYEN_TRUNG_TAM"]);
  });

  it("[NHH-SEED-DB-02] APPLY không `--kich-hoat`: văn bản + 12 chính sách (4 chung + 8 theo nguồn) đều DRAFT; HV_MOI có 5 rule; hai bảng bậc có tierTable", async () => {
    const kq = await chay();
    expect(kq.vanBan.trangThai).toBe("TAO_MOI");
    expect(kq.chinhSach.every((c) => c.trangThai === "TAO_MOI" && c.kichHoat === "DRAFT")).toBe(true);
    const hv = await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: "SR.QD.208/HV_MOI" } }, include: { rules: true } });
    expect(hv.status).toBe("DRAFT");
    expect(hv.rules).toHaveLength(5);
    expect(hv.rules.reduce((s, r) => s + Number(r.rate), 0)).toBeCloseTo(0.09, 9);
    const tier = await db.commissionRule.findMany({ where: { calcKind: "TIER_PERIOD_BONUS", version: { policy: { policyCode: { startsWith: "SR.QD.208/" } } } } });
    expect(tier).toHaveLength(2);
    expect(tier.every((t) => Array.isArray(t.tierTable) && (t.tierTable as unknown[]).length === 5)).toBe(true);
    // văn bản mang đủ trường + tệp
    const vb = await db.regulationDocument.findUniqueOrThrow({ where: { documentCode: "SR.QD.208" } });
    expect([vb.fileKey, vb.approvedByName, vb.centerId, vb.orgUnitId]).toEqual(["documents/sr-qd-208.pdf", "Hồ Đắc Phúc", null, null]);
  });

  it("[NHH-SEED-DB-03] IDEMPOTENT: chạy lần hai ⇒ không tạo thêm, không đổi cái đã có; trạng thái 'DA_CO'", async () => {
    await chay();
    const anh = async () =>
      JSON.stringify([
        await db.commissionPolicy.findMany({ orderBy: { policyCode: "asc" }, select: { id: true, policyCode: true, updatedAt: true }, where: { policyCode: { startsWith: "SR.QD.208/" } } }),
        await db.commissionRule.count({ where: { version: { policy: { policyCode: { startsWith: "SR.QD.208/" } } } } }),
        await db.regulationDocument.findMany({ where: { documentCode: "SR.QD.208" }, select: { id: true, updatedAt: true } }),
      ]);
    const truoc = await anh();
    const kq2 = await chay({ kichHoat: true });
    expect(await anh()).toBe(truoc);
    expect(kq2.vanBan.trangThai).toBe("DA_CO");
    expect(kq2.chinhSach.every((c) => c.trangThai === "DA_CO")).toBe(true);
  });

  it("[NHH-SEED-DB-04] `--kich-hoat` + tệp + người phụ trách ⇒ HV_MOI ACTIVE; các bản DRAFT vẫn DRAFT (không ai bật RENEWAL / bậc)", async () => {
    await khaiNguoiPhuTrach();
    const kq = await chay({ kichHoat: true });
    expect(kq.chinhSach.find((c) => c.policyCode === "SR.QD.208/HV_MOI")!.kichHoat).toBe("DA_KICH_HOAT");
    const tt = async (ma: string) => (await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: ma } } })).status;
    expect(await tt("SR.QD.208/HV_MOI")).toBe("ACTIVE");
    expect(await tt("SR.QD.208/TAI_TUC")).toBe("DRAFT");
    expect(await tt("SR.QD.208/THUONG_DANH_HIEU_TVV")).toBe("DRAFT");
    expect(await tt("SR.QD.208/THUONG_DANH_HIEU_QUAN_LY")).toBe("DRAFT");
    // theo nguồn: CẢ TÁM là DRAFT — seed không thử bật cái nào (quyết định «Marketing chỉ cho nguồn quảng cáo» đổi người nhận tiền ngay khi kích hoạt: để người có thẩm quyền bật)
    for (const ma of ["PAID_ADS", "PARENT_REFERRAL", "EMPLOYEE_REFERRAL", "CENTER_ORGANIC", "WALK_IN", "EVENT", "PARTNER", "OTHER"]) {
      expect(await tt("SR.QD.208/NGUON_" + ma), ma).toBe("DRAFT");
    }
    // hiệu lực mặc định = đúng ngày thứ 15 làm việc sau ban hành (20/03/2026 giờ VN)
    const hv = await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: "SR.QD.208/HV_MOI" } } });
    expect(hv.effectiveFrom.toISOString()).toBe("2026-03-19T17:00:00.000Z");
  });

  it("[DYN-SEED-DB-08] TÁM chính sách THEO NGUỒN: phạm vi SOURCE_GROUP trỏ đúng nhóm; mỗi cái đúng bộ dòng (thu hút + EXCLUDE MARKETING); KHÔNG gắn văn bản, hiệu lực = 01 tháng sau; ép bật khi HV_MOI đã ACTIVE ⇒ guardrail chặn đúng các mã mong đợi (không mã nào che)", async () => {
    await khaiNguoiPhuTrach();
    await chay({ kichHoat: true });
    const THU_HUT: Record<string, string[]> = {
      PAID_ADS: ["SOURCE_OWNER:PERCENT:0.01"],
      PARENT_REFERRAL: ["REFERRER_PARENT_SALE:PERCENT:0.02"],
      EMPLOYEE_REFERRAL: ["REFERRER_EMPLOYEE:PERCENT:0.02"],
      CENTER_ORGANIC: [],
      WALK_IN: [],
      EVENT: [],
      PARTNER: [],
      OTHER: [],
    };
    // Chặn mong đợi: văn bản thiếu (nháp cố ý không gắn văn bản) + lỗi riêng của từng nháp
    const CHAN: Record<string, string[]> = {
      PAID_ADS: ["NGUON_CHUA_CO_NGUOI_PHU_TRACH", "VAN_BAN_THIEU"],
      PARENT_REFERRAL: ["VAN_BAN_THIEU", "VUOT_TRAN"],
      EMPLOYEE_REFERRAL: ["VAN_BAN_THIEU", "VUOT_TRAN"],
      CENTER_ORGANIC: ["VAN_BAN_THIEU"],
      WALK_IN: ["VAN_BAN_THIEU"],
      EVENT: ["VAN_BAN_THIEU"],
      PARTNER: ["VAN_BAN_THIEU"],
      OTHER: ["VAN_BAN_THIEU"],
    };
    for (const [ma, thuHut] of Object.entries(THU_HUT)) {
      const v = await db.commissionPolicyVersion.findFirstOrThrow({
        where: { policy: { policyCode: "SR.QD.208/NGUON_" + ma } },
        include: { rules: { include: { beneficiaryRole: true } }, scopeSourceGroup: { select: { code: true } } },
      });
      expect([v.status, v.scopeType, v.scopeSourceGroup?.code, v.documentId], ma).toEqual(["DRAFT", "SOURCE_GROUP", ma, null]);
      expect(v.effectiveFrom.toISOString(), ma).toBe("2026-11-01T00:00:00.000Z"); // NOW = 08/10/2026 ⇒ 01 THÁNG SAU, không phải 20/03/2026
      const dong = v.rules.map((r) => [r.beneficiaryRole.code, r.calcKind, r.rate === null ? "" : String(Number(r.rate))].join(":")).sort();
      expect(dong, ma).toEqual([...thuHut, "MARKETING:EXCLUDE:"].sort());
      const loi = await kichHoat({ versionId: v.id, actor: ACTOR, now: NOW, xacNhanCanhBao: null }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(loi, ma).toMatchObject({ ma: "KICH_HOAT_BI_CHAN" });
      expect((loi as { chiTiet: { ma: string }[] }).chiTiet.map((x) => x.ma).sort(), ma).toEqual(CHAN[ma]);
      expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: v.id } })).status, ma).toBe("DRAFT");
    }
    // KHÔNG có chính sách nào cho UNKNOWN
    expect(await db.commissionPolicyVersion.count({ where: { policy: { policyCode: { startsWith: "SR.QD.208/NGUON_" } }, scopeSourceGroup: { code: "UNKNOWN" } } })).toBe(0);
  });

  it("[DYN-SEED-DB-10] `--hieu-luc` do người chạy khai ĐƯỢC áp cho cả tám nháp theo nguồn (không khai thì 01 tháng sau); HV_MOI vẫn theo mốc SR.QD.208", async () => {
    await chay({ hieuLuc: new Date("2026-12-14T17:00:00.000Z") });
    const hl = async (ma: string) => (await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: ma } } })).effectiveFrom.toISOString();
    expect(await hl("SR.QD.208/NGUON_WALK_IN")).toBe("2026-12-14T17:00:00.000Z");
    expect(await hl("SR.QD.208/NGUON_PAID_ADS")).toBe("2026-12-14T17:00:00.000Z");
    expect(await hl("SR.QD.208/HV_MOI")).toBe("2026-12-14T17:00:00.000Z");
  });

  it("[DYN-SEED-DB-09] nguồn mà chính sách trỏ tới CHƯA có trong danh mục ⇒ báo THIEU_NGUON, KHÔNG tạo (không đoán, không rơi về GLOBAL); đối chứng: danh mục đủ ⇒ tạo", async () => {
    const tam = "PAID_ADS_TAM_DYN";
    await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { code: tam } });
    try {
      const kq = await chay({ apply: false });
      const ads = kq.chinhSach.find((c) => c.policyCode === "SR.QD.208/NGUON_PAID_ADS")!;
      expect(ads.trangThai).toBe("THIEU_NGUON");
      const ap = await chay();
      expect(ap.chinhSach.find((c) => c.policyCode === "SR.QD.208/NGUON_PAID_ADS")!.trangThai).toBe("THIEU_NGUON");
      expect(await db.commissionPolicy.count({ where: { policyCode: "SR.QD.208/NGUON_PAID_ADS" } })).toBe(0);
    } finally {
      await db.leadSourceGroup.update({ where: { code: tam }, data: { code: "PAID_ADS" } });
    }
    await chay();
    expect(await db.commissionPolicy.count({ where: { policyCode: "SR.QD.208/NGUON_PAID_ADS" } })).toBe(1);
  });

  it("[DYN-SEED-DB-11] thiếu MỘT nguồn trong danh mục ⇒ chỉ chính sách của nguồn đó là THIEU_NGUON, bảy cái còn lại vẫn tạo (không dừng cả lô, không đoán)", async () => {
    const tam = "WALK_IN_TAM_DYN";
    await db.leadSourceGroup.update({ where: { code: "WALK_IN" }, data: { code: tam } });
    try {
      const kq = await chay();
      const theoNguon = kq.chinhSach.filter((c) => c.policyCode.startsWith("SR.QD.208/NGUON_"));
      expect(theoNguon).toHaveLength(8);
      expect(theoNguon.filter((c) => c.trangThai === "THIEU_NGUON").map((c) => c.policyCode)).toEqual(["SR.QD.208/NGUON_WALK_IN"]);
      expect(theoNguon.filter((c) => c.trangThai === "TAO_MOI")).toHaveLength(7);
    } finally {
      await db.leadSourceGroup.update({ where: { code: tam }, data: { code: "WALK_IN" } });
    }
  });

  it("[NHH-SEED-DB-05] thiếu tệp văn bản ⇒ KHÔNG kích hoạt được, HV_MOI nằm DRAFT kèm lý do VAN_BAN_THIEU (guardrail không bị nới); thiếu người phụ trách ⇒ THIEU_NGUOI_PHU_TRACH", async () => {
    await khaiNguoiPhuTrach();
    const khongTep = await chay({ kichHoat: true, tep: KHONG_TEP });
    const hv = khongTep.chinhSach.find((c) => c.policyCode === "SR.QD.208/HV_MOI")!;
    expect(hv.kichHoat).toBe("KHONG_DUOC_KICH_HOAT");
    expect(hv.ghiChu).toContain("VAN_BAN_THIEU");
    expect((await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: "SR.QD.208/HV_MOI" } } })).status).toBe("DRAFT");

    await don();
    const thieuNguoi = await chay({ kichHoat: true });
    expect(thieuNguoi.chinhSach.find((c) => c.policyCode === "SR.QD.208/HV_MOI")!.ghiChu).toContain("THIEU_NGUOI_PHU_TRACH");
  });

  it("[NHH-SEED-DB-06] thiếu người duyệt khi cần tạo văn bản ⇒ ném TRƯỚC khi ghi (không để lại văn bản/policy mồ côi)", async () => {
    await expect(chay({ approvedByName: "  " })).rejects.toMatchObject({ ma: "DU_LIEU_KHONG_HOP_LE" });
    expect(await db.regulationDocument.count({ where: { documentCode: "SR.QD.208" } })).toBe(0);
    expect(await db.commissionPolicy.count({ where: { policyCode: { startsWith: "SR.QD.208/" } } })).toBe(0);
  });

  it("[NHH-SEED-DB-07] seed KHÔNG tự xác nhận cảnh báo UNKNOWN_TANG: không có `xacNhanCanhBao` ⇒ HV_MOI nằm DRAFT, ghi chú nêu cảnh báo; có lý do do NGƯỜI CHẠY gõ ⇒ kích hoạt và lý do đó vào audit", async () => {
    // Cấy 08/10 (review): script cũ truyền sẵn lý do 'khởi tạo mức chính sách' ⇒ mọi cảnh báo được 'xác nhận' mà không ai đọc.
    // Nền: một chính sách khác ĐÃ ACTIVE phủ MỘT nhóm nguồn cho SALE·NEW ⇒ UNKNOWN đang 0; HV_MOI GLOBAL phủ mọi nhóm ⇒ UNKNOWN 0 → 4%.
    await khaiNguoiPhuTrach();
    const g = await db.leadSourceGroup.findFirstOrThrow({ where: { status: "ACTIVE", code: { not: "UNKNOWN" } }, orderBy: { sortOrder: "asc" } });
    const nen = await taoVanBan({
      documentCode: `${P}vb`, title: "Nền", kind: "COMMISSION_POLICY", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23",
      approvedByName: "Hồ Đắc Phúc", approvedById: null, ...TEP, ownerOrgUnitId: null, actor: ACTOR, now: NOW,
    });
    const p0 = await taoChinhSach({
      policyCode: `${P}p0`, name: "Nền một nhóm", description: null, ownerOrgUnitId: null, phamVi: { loai: "SOURCE_GROUP", sourceGroupId: g.id },
      effectiveFrom: new Date("2026-03-22T17:00:00.000Z"), effectiveTo: null, reason: "nền", documentId: nen.id,
      rules: [{ transactionTypeCode: "NEW", roleCode: "SALE", revenueComponent: "TUITION", calcKind: "PERCENT", rate: 0.04, fixedAmount: null, tierTable: null, note: null }],
      actor: ACTOR, now: NOW,
    });
    await kichHoat({ versionId: p0.versionId, actor: ACTOR, now: NOW, xacNhanCanhBao: null });

    const chuaXacNhan = await chay({ kichHoat: true });
    const hv = chuaXacNhan.chinhSach.find((c) => c.policyCode === "SR.QD.208/HV_MOI")!;
    expect(hv.kichHoat).toBe("KHONG_DUOC_KICH_HOAT");
    expect(hv.ghiChu).toContain("CAN_XAC_NHAN_CANH_BAO");
    expect(hv.ghiChu).toContain("0 → 400.000"); // nội dung cảnh báo UNKNOWN tăng được in ra cho người đọc
    expect((await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: "SR.QD.208/HV_MOI" } } })).status).toBe("DRAFT");

    // Làm lại từ đầu với lý do do người chạy gõ
    await db.commissionRule.deleteMany({ where: { version: { policy: { policyCode: { startsWith: "SR.QD.208/" } } } } });
    await db.commissionPolicyVersion.deleteMany({ where: { policy: { policyCode: { startsWith: "SR.QD.208/" } } } });
    await db.commissionPolicy.deleteMany({ where: { policyCode: { startsWith: "SR.QD.208/" } } });
    const daXacNhan = await chay({ kichHoat: true, xacNhanCanhBao: "Hội đồng chốt: bổ sung mức chung cho mọi nhóm nguồn" });
    expect(daXacNhan.chinhSach.find((c) => c.policyCode === "SR.QD.208/HV_MOI")!.kichHoat).toBe("DA_KICH_HOAT");
    const v = await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: "SR.QD.208/HV_MOI" } } });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionPolicyVersion", entityId: v.id, action: "ACTIVATE" } });
    expect(log.reason).toContain("Hội đồng chốt");
  });
});
