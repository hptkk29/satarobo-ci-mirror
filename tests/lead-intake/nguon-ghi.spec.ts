import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { DANH_MUC_GOC } from "../../lib/nguon/danh-muc-goc";
import { NguonError, doiNguon, taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { damBaoDanhMucGoc, docKhoiSeedSql, duLieuNguon, type IdNhom } from "./_nguon-fixture";

// =============================================================================
// TẦNG GHI NGUỒN LEAD — Postgres LOCAL thật (07 §3.2)
//
//   [NHH-SRC-01]  seed 9 nhóm trong migration: chạy HAI lần ⇒ đúng 9 dòng, mọi cột = DANH_MUC_GOC (kể cả sourceType, commissionEnabled)
//   [NHH-SRC-01d] damBaoDanhMucGoc sửa lại dòng isSystem=false
//   [NHH-SRC-23a] đua tạo nguồn ban đầu: KHÔNG lượt nào ném, lượt thua thành touchpoint (E2)
//   [NHH-SRC-23b] doiNguon: khoá lạc quan + AuditLog cùng transaction
//   [NHH-SRC-23c] CHECK của Postgres (Prisma 5 không đọc CHECK ⇒ lưới duy nhất là ca này)
//
// Cách ly: tiền tố `NGH_`, dọn theo tiền tố — KHÔNG resetDb (nếp `tests/finance`, `gop-lead.spec.ts`).
// =============================================================================

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "NGH_";
const MOC_LUI = "__NGH_LUI__";

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadStatusHistory.deleteMany({ where: { leadId: { in: ids } } });
    // Quy nguồn + touchpoint đi theo lead (FK Cascade) — xoá lead là đủ, và là phép kiểm FK.
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: "NGH." } } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NGH-" } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ngh-" } } });
}

async function taoLead(ten: string, sdt = "0990310001") {
  return db.lead.create({ data: { parentName: `${P}${ten}`, phone: sdt, status: "MOI" } });
}

/** Chạy `f` trong transaction rồi LÙI bằng cách ném mốc; trả kết quả của `f`. */
async function chayRoiLui<T>(f: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
  let kq: { v: T } | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        kq = { v: await f(tx) };
        throw new Error(MOC_LUI);
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (!(e instanceof Error && e.message === MOC_LUI)) throw e;
  }
  if (!kq) throw new Error("chayRoiLui: không có kết quả");
  return (kq as { v: T }).v;
}

describe.skipIf(!RUN)("Nguồn lead — tầng ghi thật", () => {
  let nhom: IdNhom;
  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
  }, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-01] khối seed của migration chạy HAI lần ⇒ đúng 9 dòng, mọi cột bằng DANH_MUC_GOC", async () => {
    const sql = docKhoiSeedSql();
    const ma = DANH_MUC_GOC.map((d) => d.code);
    const rows = await chayRoiLui(async (tx) => {
      // Không phụ thuộc thứ tự tệp: dòng do `damBaoDanhMucGoc` của tệp khác tạo trước đã bị xoá TRONG tx.
      await tx.leadTouchpoint.deleteMany({ where: { claimedGroup: { code: { in: ma } } } });
      await tx.leadAttribution.deleteMany({
        where: { OR: [{ group: { code: { in: ma } } }, { originalGroup: { code: { in: ma } } }] },
      });
      await tx.leadSourceGroup.deleteMany({ where: { code: { in: ma } } });
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe(sql); // lần hai: ON CONFLICT DO NOTHING — bỏ nó ⇒ 23505
      return tx.leadSourceGroup.findMany({ where: { code: { in: ma } }, orderBy: { sortOrder: "asc" } });
    });
    expect(rows).toHaveLength(9);
    for (const g of DANH_MUC_GOC) {
      const r = rows.find((x) => x.code === g.code);
      expect(r, g.code).toBeDefined();
      expect({
        code: r!.code,
        documentNo: r!.documentNo,
        name: r!.name,
        description: r!.description,
        referrerRequirement: r!.referrerRequirement,
        requiresNote: r!.requiresNote,
        selectable: r!.selectable,
        isSystem: r!.isSystem,
        sortOrder: r!.sortOrder,
        status: r!.status,
        sourceType: r!.sourceType,
        commissionEnabled: r!.commissionEnabled,
        // Cột nguồn động KHÔNG có trong seed phải ra đúng mặc định: NULL / chưa có chủ / chưa có hiệu lực.
        attributionWindowDays: r!.attributionWindowDays,
        ownerEmployeeId: r!.ownerEmployeeId,
        ownerOrgUnitId: r!.ownerOrgUnitId,
        effectiveFrom: r!.effectiveFrom,
        effectiveTo: r!.effectiveTo,
      }).toEqual({
        code: g.code,
        documentNo: g.documentNo,
        name: g.name,
        description: g.description,
        referrerRequirement: g.referrerRequirement,
        requiresNote: g.requiresNote,
        selectable: g.selectable,
        isSystem: g.isSystem,
        sortOrder: g.sortOrder,
        status: g.status,
        sourceType: g.sourceType,
        commissionEnabled: g.commissionEnabled,
        attributionWindowDays: null,
        ownerEmployeeId: null,
        ownerOrgUnitId: null,
        effectiveFrom: null,
        effectiveTo: null,
      });
    }
  }, 60_000);

  it("[NHH-SRC-01d] damBaoDanhMucGoc sửa lại dòng đã bị đổi isSystem=false / INACTIVE (PB-2)", async () => {
    const r = await chayRoiLui(async (tx) => {
      await tx.leadSourceGroup.update({
        where: { code: "WALK_IN" },
        data: { isSystem: false, status: "INACTIVE", selectable: false },
      });
      await damBaoDanhMucGoc(tx);
      return tx.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" } });
    });
    expect([r.isSystem, r.status, r.selectable]).toEqual([true, "ACTIVE", true]);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-23a] đua tạo nguồn ban đầu: KHÔNG lượt nào ném; lượt thua ⇒ touchpoint TAO_LEAD (E2)", async () => {
    const lead = await taoLead("Dua");
    // Đồng bộ bằng RÀO, không bằng đồng hồ (PB-21): tx2 chỉ bắt đầu GHI sau khi tx1 đã `createMany`.
    let moRao!: () => void;
    const daGhi = new Promise<void>((r) => {
      moRao = r;
    });

    const tx1 = db.$transaction(
      async (tx) => {
        const r = await taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.PAID_ADS, { matchedRule: "LUOT_1" }), null);
        moRao();
        // Giữ khoá chỉ mục 0,5 giây rồi mới commit — INSERT … ON CONFLICT của tx2 phải CHỜ ở đây.
        await tx.$queryRaw`SELECT pg_sleep(0.5)::text`;
        return r;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    const tx2 = db.$transaction(
      async (tx) => {
        await daGhi;
        return taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.WALK_IN, { matchedRule: "LUOT_2", originalGroupId: nhom.PARENT_REFERRAL }), "nguoi-thua");
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    const [r1, r2] = await Promise.all([tx1, tx2]);

    expect(r1).toEqual({ taoMoi: true });
    expect(r2.taoMoi).toBe(false);
    const dong = await db.leadAttribution.findMany({ where: { leadId: lead.id } });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.groupId).toBe(nhom.PAID_ADS);
    expect(dong[0]!.matchedRule).toBe("LUOT_1");
    const tp = await db.leadTouchpoint.findMany({ where: { leadId: lead.id } });
    expect(tp).toHaveLength(1);
    expect(tp[0]!.kind).toBe("TAO_LEAD");
    expect(tp[0]!.claimedGroupId).toBe(nhom.WALK_IN);
    expect(tp[0]!.actorId).toBe("nguoi-thua");
    // Tín hiệu của lượt thua KHÔNG mất: cờ `thua`, luật nó sẽ ra, loại người giới thiệu.
    expect(tp[0]!.signals).toMatchObject({ thua: true, matchedRule: "LUOT_2", referrerKind: null });
    expect(r2.taoMoi === false && r2.touchpointId).toBe(tp[0]!.id);
  }, 60_000);

  it("[NHH-SRC-23a'] đối chứng dương: lượt tạo đầu tiên KHÔNG đẻ touchpoint nào", async () => {
    const lead = await taoLead("DauTien");
    const r = await db.$transaction((tx) =>
      taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.OTHER, { otherSourceNote: "giải trình đủ dài" }), null),
    );
    expect(r).toEqual({ taoMoi: true });
    expect(await db.leadTouchpoint.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: lead.id } })).toBe(0);
  }, 60_000);

  it("[NHH-SRC-23a''] người giới thiệu sai cặp cột ⇒ NguonError TRƯỚC khi chạm DB; giải trình ngắn ⇒ NguonError", async () => {
    const lead = await taoLead("Cong");
    await expect(
      db.$transaction((tx) =>
        taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.EMPLOYEE_REFERRAL, { referrerKind: "EMPLOYEE" }), null),
      ),
    ).rejects.toMatchObject({ ma: "NGUOI_GT_SAI" });
    await expect(
      db.$transaction((tx) =>
        taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.OTHER, { otherSourceNote: "ngắn" }), null),
      ),
    ).rejects.toBeInstanceOf(NguonError);
    expect(await db.leadAttribution.count({ where: { leadId: lead.id } })).toBe(0);
  }, 60_000);

  it("[NHH-SRC-23a'''] giải trình nguồn: ĐÚNG 10 ký tự được; 10 ký tự THÔ nhưng trim còn 4 thì bị chặn", async () => {
    const a = await taoLead("GT10", "0990310002");
    const b = await taoLead("GTTrim", "0990310003");
    const ok = await db.$transaction((tx) =>
      taoNguonBanDau(tx, a.id, duLieuNguon(nhom.OTHER, { otherSourceNote: "1234567890" }), null),
    );
    expect(ok).toEqual({ taoMoi: true });
    await expect(
      db.$transaction((tx) => taoNguonBanDau(tx, b.id, duLieuNguon(nhom.OTHER, { otherSourceNote: "   abcd   " }), null)),
    ).rejects.toMatchObject({ ma: "GIAI_TRINH_NGAN" });
    expect(await db.leadAttribution.count({ where: { leadId: b.id } })).toBe(0);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-23b] doiNguon: lượt cũ ⇒ NGUON_VUA_DOI; lượt đúng ⇒ 1 AuditLog; lùi ⇒ lùi CẢ audit", async () => {
    const lead = await taoLead("Doi");
    await db.lead.update({ where: { id: lead.id }, data: { orgUnitId: "ngh-org-1" } });
    await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.PAID_ADS), null));
    // Ghim updatedAt về mốc TUYỆT ĐỐI để hai lượt đọc chắc chắn khác nhau (không dựa vào đồng hồ).
    await db.$executeRaw`UPDATE "LeadAttribution" SET "updatedAt" = '2026-10-01T00:00:00Z' WHERE "leadId" = ${lead.id}`;
    const cu = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });

    const ly = "Khách nói rõ do phụ huynh giới thiệu";
    const dung = await db.$transaction((tx) =>
      doiNguon(tx, {
        leadId: lead.id,
        daDocUpdatedAt: cu.updatedAt,
        moi: duLieuNguon(nhom.WALK_IN, { matchedRule: "DOI_TAY" }),
        action: "DOI_NGUON",
        lyDo: ly,
        actor: { id: "ngh-nguoi-doi", name: "Người kiểm thử" },
      }),
    );
    expect(dung).toEqual({ ok: true });
    const sau = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(sau.groupId).toBe(nhom.WALK_IN);
    expect(sau.changeReason).toBe(ly);
    const audit = await db.auditLog.findMany({ where: { entityType: "Lead", entityId: lead.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("DOI_NGUON");
    expect(audit[0]!.reason).toBe(ly);
    expect(audit[0]!.orgUnitId).toBe("ngh-org-1"); // audit theo lead — quản lý cơ sở mới thấy được dòng này
    // Người đổi được ghi ở CẢ HAI nơi (cột quy nguồn + audit); và audit chụp nhóm trước/sau bằng MÃ nhóm.
    expect(sau.changedById).toBe("ngh-nguoi-doi");
    expect(audit[0]!.actorId).toBe("ngh-nguoi-doi");
    expect(audit[0]!.actorName).toBe("Người kiểm thử");
    expect(audit[0]!.oldValues).toMatchObject({ nhom: "PAID_ADS" });
    expect(audit[0]!.newValues).toMatchObject({ nhom: "WALK_IN", matchedRule: "DOI_TAY" });

    // Lượt dùng updatedAt CŨ ⇒ bị chặn, không đổi gì, không audit mới.
    const stale = await db.$transaction((tx) =>
      doiNguon(tx, {
        leadId: lead.id,
        daDocUpdatedAt: cu.updatedAt,
        moi: duLieuNguon(nhom.EVENT, { matchedRule: "GHI_DE" }),
        action: "DOI_NGUON",
        lyDo: "Một lý do đủ dài khác",
        actor: { id: null, name: "Người kiểm thử" },
      }),
    );
    expect(stale).toEqual({ ok: false, loi: "NGUON_VUA_DOI" });
    const sau2 = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(sau2.groupId).toBe(nhom.WALK_IN);
    expect(sau2.matchedRule).toBe("DOI_TAY");
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: lead.id } })).toBe(1);

    // Ném SAU khi doiNguon xong ⇒ cả dòng quy nguồn lẫn audit cùng lùi.
    await chayRoiLui((tx) =>
      doiNguon(tx, {
        leadId: lead.id,
        daDocUpdatedAt: sau2.updatedAt,
        moi: duLieuNguon(nhom.EVENT, { matchedRule: "SE_LUI" }),
        action: "DOI_NGUON",
        lyDo: "Đổi rồi lùi ngay trong tx",
        actor: { id: null, name: "Người kiểm thử" },
      }),
    );
    const sau3 = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(sau3.matchedRule).toBe("DOI_TAY");
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: lead.id } })).toBe(1);
  }, 60_000);

  it("[NHH-SRC-23b''] lý do: ĐÚNG 10 ký tự được; khoảng trắng bao quanh KHÔNG tính và KHÔNG được lưu", async () => {
    const lead = await taoLead("LyDoBien");
    await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.PAID_ADS), null));
    const doi = async (lyDo: string, nhomMoi: string) => {
      const cu = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
      return db.$transaction((tx) =>
        doiNguon(tx, {
          leadId: lead.id,
          daDocUpdatedAt: cu.updatedAt,
          moi: duLieuNguon(nhomMoi),
          action: "DOI_NGUON",
          lyDo,
          actor: { id: null, name: "t" },
        }),
      );
    };
    // 12 ký tự THÔ, trim còn 6 ⇒ chặn.
    await expect(doi("   123456   ", nhom.WALK_IN)).rejects.toMatchObject({ ma: "LY_DO_NGAN" });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } })).groupId).toBe(nhom.PAID_ADS);
    // ĐÚNG 10 ký tự ⇒ được.
    expect(await doi("1234567890", nhom.WALK_IN)).toEqual({ ok: true });
    // Bao quanh bằng khoảng trắng ⇒ được, và cột lưu là bản ĐÃ trim.
    expect(await doi("  abcdefghij  ", nhom.EVENT)).toEqual({ ok: true });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } })).changeReason).toBe("abcdefghij");
  }, 60_000);

  it("[NHH-SRC-23d] tạo ghi đủ 19 cột; đổi nguồn đổi 16 cột HIỆN HÀNH (kể cả 2 cột ẢNH CHỤP) và KHÔNG đổi nguồn gốc (originalGroupId · inheritedFromLeadId · attributedAt)", async () => {
    const lead = await taoLead("Cot", "0990310010");
    const goc = await taoLead("Goc", "0990310011");
    const nv = await db.employee.create({
      data: { employeeCode: "NGH.NV.002", fullName: "NV hai", jobTitle: "Sale", department: "KINH_DOANH" },
    });
    const nv2 = await db.employee.create({
      data: { employeeCode: "NGH.NV.003", fullName: "NV ba", jobTitle: "Sale", department: "KINH_DOANH" },
    });
    // Cột ẢNH CHỤP được ghi/đọc độc lập với `referrerKind` (ràng buộc kind↔Sale do tầng quy nguồn giữ) — ca này chỉ thử vòng đi-về của cột.
    const sale = await db.user.create({ data: { name: "NGH sale", email: "ngh-sale-23d@example.test", role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true }, select: { id: true } });
    const dau = duLieuNguon(nhom.EMPLOYEE_REFERRAL, {
      otherSourceNote: "ghi chú đủ mười ký tự",
      referrerKind: "EMPLOYEE",
      referrerEmployeeId: nv.id,
      referrerMissing: true,
      referrerRoleCode: "SALE",
      referrerSaleUserId: null,
      identificationMethod: "REFERRAL_CODE",
      matchedRule: "RULE_DAU",
      reasonText: "lý do đầu",
      canhBao: ["CB1", "CB2"],
      originalGroupId: nhom.PARENT_REFERRAL,
      inheritedFromLeadId: goc.id,
      conversionEntry: "ENTRY_DAU",
      signals: { k: [1, 2], z: { a: "b" } },
      attributedAt: new Date("2026-09-05T01:02:03.000Z"),
    });
    // Đọc lại đúng 17 trường của DuLieuNguon từ dòng DB.
    const doc = async (): Promise<ReturnType<typeof duLieuNguon>> => {
      const r = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
      return {
        groupId: r.groupId,
        otherSourceNote: r.otherSourceNote,
        referrerKind: r.referrerKind,
        referrerEmployeeId: r.referrerEmployeeId,
        referrerParentUserId: r.referrerParentUserId,
        referrerStudentId: r.referrerStudentId,
        referrerAffiliateId: r.referrerAffiliateId,
        referrerMissing: r.referrerMissing,
        referrerRoleCode: r.referrerRoleCode,
        referrerSaleUserId: r.referrerSaleUserId,
        identificationMethod: r.identificationMethod,
        matchedRule: r.matchedRule,
        reasonText: r.reasonText,
        canhBao: r.canhBao,
        originalGroupId: r.originalGroupId,
        inheritedFromLeadId: r.inheritedFromLeadId,
        conversionEntry: r.conversionEntry,
        signals: r.signals as ReturnType<typeof duLieuNguon>["signals"],
        attributedAt: r.attributedAt,
      };
    };
    // TẠO ban đầu ghi ĐỦ 19 cột (đây là nơi DUY NHẤT đặt nguồn gốc ngoài gộp lead / di trú).
    await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, dau, null));
    expect(await doc()).toEqual(dau);

    // Đổi: mọi trường KHÁC giá trị cũ (kể cả về null / false / mảng khác) — và CỐ TÌNH truyền cả ba cột
    // nguồn gốc với giá trị khác (biến, không phải literal ⇒ tsc cho qua; tầng ghi phải BỎ QUA chúng).
    const sau = duLieuNguon(nhom.EVENT, {
      otherSourceNote: null,
      referrerKind: "EMPLOYEE",
      referrerEmployeeId: nv2.id,
      referrerMissing: false,
      referrerRoleCode: "TEACHER",
      referrerSaleUserId: sale.id,
      identificationMethod: "MANUAL",
      matchedRule: "RULE_SAU",
      reasonText: "lý do sau",
      canhBao: ["CB3"],
      originalGroupId: nhom.PAID_ADS,
      inheritedFromLeadId: null,
      conversionEntry: "ENTRY_SAU",
      signals: { k: 3 },
      attributedAt: new Date("2026-09-06T04:05:06.000Z"),
    });
    const cu = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    const kq = await db.$transaction((tx) =>
      doiNguon(tx, {
        leadId: lead.id,
        daDocUpdatedAt: cu.updatedAt,
        moi: sau,
        action: "DOI_NGUON",
        lyDo: "Đổi mọi cột hiện hành để thử vòng đi-về",
        actor: { id: null, name: "t" },
      }),
    );
    expect(kq).toEqual({ ok: true });
    // 16 cột HIỆN HÀNH đổi theo `sau` (gồm ảnh chụp vai · Sale); BA cột nguồn gốc giữ NGUYÊN giá trị lúc tạo.
    expect(await doc()).toEqual({
      ...sau,
      originalGroupId: dau.originalGroupId,
      inheritedFromLeadId: dau.inheritedFromLeadId,
      attributedAt: dau.attributedAt,
    });
    // Đối chứng dương: groupId (nguồn HIỆN HÀNH) ĐỔI được — luật không biến "đổi nguồn" thành no-op.
    const ra = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(ra.groupId).toBe(nhom.EVENT);
    expect(ra.groupId).not.toBe(ra.originalGroupId);
    // Spec 07 §2.6.5: đúng MỘT AuditLog (entityType Lead), KHÔNG đẻ touchpoint (doiNguon không ghi touchpoint).
    const audit = await db.auditLog.findMany({ where: { entityType: "Lead", entityId: lead.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("DOI_NGUON");
    expect(audit[0]!.newValues).toMatchObject({ nhom: "EVENT", matchedRule: "RULE_SAU" });
    expect(await db.leadTouchpoint.count({ where: { leadId: lead.id } })).toBe(0);

    // Kiểu tham số KHÔNG cho ba cột nguồn gốc vào (literal có chúng ⇒ tsc đỏ; bỏ Omit ⇒ directive thừa ⇒ tsc đỏ).
    const cu2 = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    await db.$transaction((tx) =>
      doiNguon(tx, {
        leadId: lead.id,
        daDocUpdatedAt: cu2.updatedAt,
        moi: {
          groupId: nhom.WALK_IN,
          otherSourceNote: null,
          referrerKind: null,
          referrerEmployeeId: null,
          referrerParentUserId: null,
          referrerStudentId: null,
          referrerAffiliateId: null,
          referrerMissing: false,
          identificationMethod: "MANUAL",
          matchedRule: "RULE_LITERAL",
          reasonText: "literal",
          canhBao: [],
          conversionEntry: null,
          signals: null,
          // @ts-expect-error — nguồn gốc bất biến: kiểu tham số của doiNguon KHÔNG có cột này
          originalGroupId: nhom.OTHER,
        },
        action: "DOI_NGUON",
        lyDo: "Đổi lần hai bằng literal",
        actor: { id: null, name: "t" },
      }),
    );
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } })).originalGroupId).toBe(dau.originalGroupId);
  }, 60_000);

  it("[NHH-SRC-23b'] lý do 9 ký tự ⇒ NguonError LY_DO_NGAN, KHÔNG ghi gì", async () => {
    const lead = await taoLead("LyDo");
    await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, duLieuNguon(nhom.PAID_ADS), null));
    const cu = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    await expect(
      db.$transaction((tx) =>
        doiNguon(tx, {
          leadId: lead.id,
          daDocUpdatedAt: cu.updatedAt,
          moi: duLieuNguon(nhom.WALK_IN),
          action: "DOI_NGUON",
          lyDo: "123456789",
          actor: { id: null, name: "t" },
        }),
      ),
    ).rejects.toMatchObject({ ma: "LY_DO_NGAN" });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } })).groupId).toBe(nhom.PAID_ADS);
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: lead.id } })).toBe(0);
  }, 60_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-23c] CHECK của Postgres: MỌI nhánh người giới thiệu — cặp sai bị chặn, cặp đúng chèn được", async () => {
    const lead = await taoLead("Check");
    const nv = await db.employee.create({
      data: { employeeCode: "NGH.NV.001", fullName: "Nhân viên kiểm thử", jobTitle: "Sale", department: "KINH_DOANH" },
    });
    // Người giới thiệu THẬT cho từng loại — để lỗi duy nhất có thể có là CHECK (khoá ngoại có sẵn, không che CHECK).
    const par = await db.user.create({ data: { name: `${P}PH`, email: "ngh-ph@example.test" } });
    const stu = await db.student.create({ data: { name: `${P}HS` } });
    const aff = await db.affiliate.create({ data: { code: "NGH-AFF-1", name: `${P}DT` } });

    type Cot = {
      kind: "EMPLOYEE" | "PARENT" | "AFFILIATE" | null;
      emp?: string;
      par?: string;
      stu?: string;
      aff?: string;
      note?: string;
      chgBy?: string;
      chgReason?: string;
    };
    const them = (c: Cot) =>
      db.$executeRaw`
        INSERT INTO "LeadAttribution"
          ("id", "leadId", "groupId", "originalGroupId", "identificationMethod", "matchedRule", "reasonText",
           "referrerKind", "referrerEmployeeId", "referrerParentUserId", "referrerStudentId", "referrerAffiliateId",
           "otherSourceNote", "changedById", "changeReason", "updatedAt")
        VALUES
          (${`ngh-${Math.random().toString(36).slice(2)}`}, ${lead.id}, ${nhom.PAID_ADS}, ${nhom.PAID_ADS},
           'MANUAL'::"SourceIdentificationMethod", 'TEST', 'ca test',
           ${c.kind}::"ReferrerKind", ${c.emp ?? null}, ${c.par ?? null}, ${c.stu ?? null}, ${c.aff ?? null},
           ${c.note ?? null}, ${c.chgBy ?? null}, ${c.chgReason ?? null}, CURRENT_TIMESTAMP)`;

    const SAI: [string, Cot][] = [
      ["EMPLOYEE + phụ huynh", { kind: "EMPLOYEE", emp: nv.id, par: par.id }],
      ["EMPLOYEE + học viên", { kind: "EMPLOYEE", emp: nv.id, stu: stu.id }],
      ["EMPLOYEE + đối tác", { kind: "EMPLOYEE", emp: nv.id, aff: aff.id }],
      ["EMPLOYEE thiếu nhân viên", { kind: "EMPLOYEE" }],
      ["PARENT + nhân viên", { kind: "PARENT", par: par.id, emp: nv.id }],
      ["PARENT + đối tác", { kind: "PARENT", par: par.id, aff: aff.id }],
      ["PARENT thiếu cả phụ huynh lẫn học viên", { kind: "PARENT" }],
      ["AFFILIATE + nhân viên", { kind: "AFFILIATE", aff: aff.id, emp: nv.id }],
      ["AFFILIATE + phụ huynh", { kind: "AFFILIATE", aff: aff.id, par: par.id }],
      ["AFFILIATE + học viên", { kind: "AFFILIATE", aff: aff.id, stu: stu.id }],
      ["AFFILIATE thiếu đối tác", { kind: "AFFILIATE" }],
      ["kind NULL mà có nhân viên", { kind: null, emp: nv.id }],
      ["kind NULL mà có đối tác", { kind: null, aff: aff.id }],
      ["đã có người đổi (changedById) mà lý do 9 ký tự", { kind: null, chgBy: "u1", chgReason: "123456789" }],
      ["ghi chú nguồn toàn khoảng trắng", { kind: null, note: "   " }],
    ];
    // Gom TOÀN BỘ dòng bị lọt (không dừng ở dòng đầu): ca đỏ phải nói được nhánh CHECK nào hở.
    const lot: string[] = [];
    for (const [nhan, c] of SAI) {
      const kq = await them(c).then(
        () => "CHẤP NHẬN",
        (e: unknown) => (/23514|check constraint/i.test(String(e)) ? "chặn" : `lỗi khác: ${String(e).slice(0, 140)}`),
      );
      if (kq !== "chặn") lot.push(`${nhan} ⇒ ${kq}`);
      await db.$executeRaw`DELETE FROM "LeadAttribution" WHERE "leadId" = ${lead.id}`;
    }
    expect(lot).toEqual([]);

    // Đối chứng dương: mọi dạng ĐÚNG luật đều chèn được (xoá dòng giữa các lượt vì leadId @unique).
    const DUNG: [string, Cot][] = [
      ["không người", { kind: null }],
      ["EMPLOYEE", { kind: "EMPLOYEE", emp: nv.id }],
      ["PARENT bằng tài khoản", { kind: "PARENT", par: par.id }],
      ["PARENT bằng học viên", { kind: "PARENT", stu: stu.id }],
      ["PARENT cả hai", { kind: "PARENT", par: par.id, stu: stu.id }],
      ["AFFILIATE", { kind: "AFFILIATE", aff: aff.id }],
      ["lý do đúng 10 ký tự", { kind: null, chgBy: "u1", chgReason: "1234567890" }],
      ["ghi chú có chữ", { kind: null, note: "đã giải trình rõ ràng" }],
    ];
    for (const [nhan, c] of DUNG) {
      await expect(them(c), nhan).resolves.toBeDefined();
      expect(await db.leadAttribution.count({ where: { leadId: lead.id } }), nhan).toBe(1);
      await db.$executeRaw`DELETE FROM "LeadAttribution" WHERE "leadId" = ${lead.id}`;
    }
  }, 60_000);

  it("[NHH-SRC-01r] RLS BẬT trên cả ba bảng nguồn (bảng mới ra đời với RLS TẮT — sự cố 09/08)", async () => {
    const rows = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relkind = 'r' AND relname IN ('LeadSourceGroup', 'LeadAttribution', 'LeadTouchpoint')
      ORDER BY relname`;
    expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([
      ["LeadAttribution", true],
      ["LeadSourceGroup", true],
      ["LeadTouchpoint", true],
    ]);
  }, 60_000);
});
