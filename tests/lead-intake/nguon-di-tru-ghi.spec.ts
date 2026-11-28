// @vitest-environment node
/**
 * BACKFILL QUY NGUỒN LEAD CŨ — lệnh GHI trên Postgres LOCAL thật (hướng E, 11/10/2026). Đường ghi THẬT (`thucHienDiTru` → `taoNguonDiTruTheoLo`), kế hoạch dựng bằng tầng đọc THẬT.
 *
 *   [DTG-D1]  chạy hai lần: lần một ghi đủ N; kế hoạch CŨ phát lại ⇒ ghi 0, đã có = N, KHÔNG touchpoint thừa, KHÔNG audit thừa; dựng kế hoạch MỚI ⇒ rỗng
 *   [DTG-D2]  số duyệt lệch (N · M · digest) ⇒ ABORT, 0 dòng quy nguồn, 0 touchpoint, 0 audit
 *   [DTG-D3]  lead ĐÃ có quy nguồn (đường sống ghi giữa lúc duyệt và lúc ghi) giữ nguyên byte-identical; phần còn lại vẫn được ghi
 *   [DTG-D4]  `Lead.source` + `Lead.updatedAt` KHÔNG đổi sau khi ghi (chỉ ghi nguồn)
 *   [DTG-D5]  chia lô: 8 lead / lô 3 ⇒ 3 lô, đủ 8 dòng, audit ĐÚNG MỘT; lead xoá mềm giữa chừng bị bỏ qua (daXoa), không làm hỏng lô
 *   [DTG-D6]  sau khi ghi, lead ở trạng thái xem tay ĐỔI NGUỒN ĐƯỢC (`BO_SUNG_NGUOI`) — trước đây «Lead chưa có quy nguồn»; lead UNKNOWN cũng đổi được
 *   [DTG-D7]  INVALID > 0 ⇒ từ chối, 0 phép ghi (cổng đặt ở chính lệnh ghi)
 *   [DTG-D8]  nội dung dòng ghi: attributedAt = Lead.createdAt · matchedRule DI_TRU · signals.nguon (chủ + cửa sổ RIÊNG của nguồn / chung) · vai theo nhãn · touchpoint TAO_LEAD tại createdAt
 *   [DTG-D9]  `--den`: lead tạo SAU mốc không vào kế hoạch; hàng chờ nguồn thấy dòng xem tay vừa backfill (đối chiếu số đếm)
 *   [DTG-D10] `docTinhTrangBackfill`: bốn số khớp kế hoạch; sau backfill `conThieuQuyNguon` = 0 trên phạm vi
 *   [DTG-D11] nhóm thiếu trong danh mục ⇒ từ chối (THIEU_NHOM), 0 phép ghi
 *   [DTG-D12] đua THẬT: đường sống giữ dòng quy nguồn chưa commit lúc lô backfill ghi ⇒ lô chờ rồi bỏ qua (skipDuplicates), không ném, không touchpoint thừa
 *   [DTG-D14] nguồn CHƯA có chủ: không chấp nhận ⇒ TỪ CHỐI (0 quy nguồn/touchpoint/audit); chấp nhận SAI danh sách ⇒ từ chối; chấp nhận ĐÚNG ⇒ ghi, audit mang danh sách + người bấm (GitHub actor/run id)
 *   [DTG-D15] lô giữa chừng lỗi (FK ở lô 2): lỗi mang số lô ĐÃ commit; lô 1 giữ nguyên, audit đúng 1; chạy lại với kế hoạch MỚI ghi phần còn thiếu
 *   [DTG-D13] đua THẬT giữa HAI lượt backfill cùng kế hoạch (Promise.all, cả hai đã qua bước đọc trước khi ai commit): quy nguồn = touchpoint = N, tổng «ghi» của hai lượt = N, audit = số lượt CÓ ghi;
 *             bản ghi KẾT THÚC của mỗi lượt mang actualCount = «ghi» của CHÍNH lượt đó (Σ = N), mỗi lượt một runAttempt (không mất dấu ai bấm)
 *   [DTG-D16] audit lượt chạy (§20): bản ghi BẮT ĐẦU mang batDauLuc · cheDo APPLY · dryRun false · expectedCount; bản ghi KẾT THÚC (action riêng) mang actualCount; chạy lại «ghi 0» không để cả hai
 *   [DTG-D17] ràng buộc ở DB (§19): LeadAttribution.leadId UNIQUE do chính Postgres giữ (chèn trùng bằng SQL thô ⇒ 23505); BA lượt chạy song song KHÔNG giữ khoá ⇒ quy nguồn = touchpoint = N, audit khớp số lượt có ghi, Σ actualCount = N
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `DTG_`. Mọi lời gọi tầng đọc truyền PHẠM VI = đúng id fixture (không "TAT_CA"). LUẬT 18: mỗi ca tự dựng hiện trường.
 * LUẬT 19: mọi mốc tuyệt đối.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { docDuLieuDiTru, docNhomDiTru } from "../../lib/nguon/di-tru-db";
import { dungKeHoachDiTru, type KeHoachDiTru, type NhomDiTru } from "../../lib/nguon/di-tru-ke-hoach";
import { DiTruDungGiuaChungError, KICH_THUOC_LO_DI_TRU, thucHienDiTru, type NguonChayDiTru } from "../../lib/nguon/di-tru-ghi";
import { docTinhTrangBackfill } from "../../lib/nguon/di-tru-tinh-trang";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { docHangChoNguon, demHangChoNguon } from "../../lib/nguon/doc-hang-cho";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { congChoKeHoach } from "../_helpers/cong-ghi-wave1";
import { CO_NGUON_DAY_DU, capKhoaGhiNguon, damBaoDanhMucGoc, datCoNguon, duLieuNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "DTG_";
const CASE = 90_000;
const TRUOC = new Date("2026-09-15T03:00:00.000Z");
const DEN_SAU = new Date("2026-10-05T00:00:00.000Z");
const CUA_SO = 90;
const ACTOR_NAME = `${P}actor`;
/** Mốc BẮT ĐẦU lượt chạy — tuyệt đối (luật 19): lõi không đọc đồng hồ, nơi gọi truyền vào. */
const BAT_DAU = new Date("2026-10-12T01:02:03.456Z");
const HD_BAT_DAU = "DI_TRU_NGUON";
const HD_KET_THUC = "DI_TRU_NGUON_KET_THUC";

let stt = 0;
const sdt = () => `09915${String(++stt).padStart(5, "0")}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // quy nguồn + touchpoint đi theo (Cascade)
  }
  await db.auditLog.deleteMany({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME } });
  // Trả các nguồn được đụng về nguyên trạng (chủ · cửa sổ riêng) TRƯỚC khi xoá nhân viên (FK Restrict).
  await db.leadSourceGroup.updateMany({ data: { ownerEmployeeId: null, attributionWindowDays: null } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

describe.skipIf(!RUN)("Backfill quy nguồn lead cũ — lệnh ghi (hướng E)", () => {
  let nhom: IdNhom;

  async function taoLead(ten: string, source: string | null, o: { createdAt?: Date; deletedAt?: Date | null } = {}): Promise<string> {
    const l = await db.lead.create({
      data: { parentName: `${P}${ten}`, phone: sdt(), status: "MOI", source, createdAt: o.createdAt ?? TRUOC, deletedAt: o.deletedAt ?? null },
      select: { id: true },
    });
    return l.id;
  }

  /** Dựng kế hoạch trên ĐÚNG phạm vi fixture, trong transaction READ ONLY như lệnh thật. */
  async function lapKeHoach(ids: string[], o: { den?: Date | null; nhomGhiDe?: (g: NhomDiTru[]) => NhomDiTru[] } = {}): Promise<{ kh: KeHoachDiTru; nhomDm: NhomDiTru[] }> {
    return db.$transaction(async (tx: Tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const kq = await docDuLieuDiTru(tx, { coBangQuyNguon: true, phamVi: { leadIds: ids }, den: o.den ?? null });
      const nhomDm = o.nhomGhiDe ? o.nhomGhiDe(await docNhomDiTru(tx)) : await docNhomDiTru(tx);
      const kh = dungKeHoachDiTru({ hang: kq.hang, chiTiet: kq.chiTiet, nhom: nhomDm, nhomCanChu: new Set(nhomDm.map((g) => g.code)), cuaSoMacDinhNgay: CUA_SO });
      return { kh, nhomDm };
    });
  }

  /** Mặc định CHẤP NHẬN ĐÚNG các nguồn thiếu chủ của kế hoạch (fixture `don()` xoá mọi chủ nguồn) để ca KHÔNG nhắm vào cổng đó vẫn ghi được; ca [DTG-D14] ghi đè. */
  const ghi = (
    kh: KeHoachDiTru,
    nhomDm: NhomDiTru[],
    over: { soDuyet?: number; soDuyetReview?: number; sha?: string; kichThuocLo?: number; chap?: string[]; nguonChay?: NguonChayDiTru; batDauLuc?: Date } = {},
  ) =>
    thucHienDiTru({
      db,
      kh,
      nhom: nhomDm,
      cuaSoMacDinhNgay: CUA_SO,
      duyet: {
        soDuyet: over.soDuyet ?? kh.tong.ghi,
        soDuyetReview: over.soDuyetReview ?? kh.tong.review,
        sha: over.sha ?? kh.sha,
        den: DEN_SAU,
        chapNhanNguonChuaCoChu: over.chap ?? kh.nhomPhaiCoChu.map((g) => g.code),
      },
      actor: { id: null, name: ACTOR_NAME },
      kichThuocLo: over.kichThuocLo ?? KICH_THUOC_LO_DI_TRU,
      nguonChay: over.nguonChay ?? { actor: null, triggeringActor: null, runId: null, runAttempt: null },
      batDauLuc: over.batDauLuc ?? BAT_DAU,
      // Cổng Wave 1: MỖI lượt ghi một artifact MỚI (nonce mới) ký đúng các dòng đầu ra của kế hoạch này — khoá ephemeral, môi trường `test`.
      congGhi: congChoKeHoach(kh, over.batDauLuc ?? BAT_DAU),
    });

  const demQuyNguon = (ids: string[]) => db.leadAttribution.count({ where: { leadId: { in: ids } } });
  const demTouchpoint = (ids: string[]) => db.leadTouchpoint.count({ where: { leadId: { in: ids } } });
  /** Số lượt CÓ GHI = số bản ghi BẮT ĐẦU. Bản ghi KẾT THÚC có action riêng nên không lẫn vào đây. */
  const demAuditLuot = () => db.auditLog.count({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: HD_BAT_DAU } });
  const demAuditKetThuc = () => db.auditLog.count({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: HD_KET_THUC } });
  const docAuditKetThuc = () => db.auditLog.findMany({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: HD_KET_THUC }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, CASE);

  /** Bộ lead mẫu: 3 AUTO (Ads ×2, Organic) · 2 REVIEW (Quản Lý, Sale tự kiếm — thiếu người) · 1 UNKNOWN (nhãn rỗng). */
  async function boMau() {
    const ids = [
      await taoLead("ads1", "Ads"),
      await taoLead("ads2", "Ads"),
      await taoLead("org", "Organic"),
      await taoLead("ql", "Quản Lý Trung Tâm"),
      await taoLead("sale", "Sale tự kiếm"),
      await taoLead("trong", null),
    ];
    return ids;
  }

  it("[DTG-D1] hai lần: ghi đủ N rồi 0 — phát lại kế hoạch CŨ ghi 0, không touchpoint/audit thừa; kế hoạch MỚI rỗng", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(kh.tong).toEqual({ auto: 3, review: 2, unknown: 1, invalid: 0, ghi: 6 });

    const r1 = await ghi(kh, nhomDm);
    expect(r1).toMatchObject({ ok: true, ghi: 6, daCo: 0, daXoa: 0 });
    expect(await demQuyNguon(ids)).toBe(6);
    expect(await demTouchpoint(ids)).toBe(6);
    expect(await demAuditLuot()).toBe(1);

    const r2 = await ghi(kh, nhomDm); // kế hoạch cũ phát lại (hai người bấm / retry)
    expect(r2).toMatchObject({ ok: true, ghi: 0, daCo: 6 });
    expect(await demQuyNguon(ids)).toBe(6);
    expect(await demTouchpoint(ids)).toBe(6); // không touchpoint thừa
    expect(await demAuditLuot()).toBe(1); // «ghi 0» không để audit giả

    const moi = await lapKeHoach(ids);
    expect(moi.kh.dong).toHaveLength(0);
    expect(moi.kh.tong.ghi).toBe(0);
    expect(await ghi(moi.kh, moi.nhomDm)).toMatchObject({ ok: true, ghi: 0, soLo: 0 });
    expect(await demAuditLuot()).toBe(1);
  }, CASE);

  it("[DTG-D2] số duyệt lệch (N · M · digest) ⇒ ABORT trước phép ghi đầu: 0 quy nguồn, 0 touchpoint, 0 audit", async () => {
    // Cấy: bỏ `kiemCongGhi` khỏi `thucHienDiTru` ⇒ ba ca dưới đây ghi 6 dòng mà người chạy tưởng bị chặn.
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    for (const [ten, over, ma] of [
      ["N lệch", { soDuyet: kh.tong.ghi - 1 }, "LECH_TONG"],
      ["M lệch", { soDuyetReview: kh.tong.review + 1 }, "LECH_REVIEW"],
      ["digest lệch", { sha: "f".repeat(64) }, "LECH_SHA"],
    ] as const) {
      const r = await ghi(kh, nhomDm, over);
      expect(r.ok, ten).toBe(false);
      if (!r.ok) expect(r.cong.ma, ten).toBe(ma);
      expect(await demQuyNguon(ids), ten).toBe(0);
      expect(await demTouchpoint(ids), ten).toBe(0);
      expect(await demAuditLuot(), ten).toBe(0);
    }
    // đối chứng dương: đúng số ⇒ ghi
    expect(await ghi(kh, nhomDm)).toMatchObject({ ok: true, ghi: 6 });
  }, CASE);

  it("[DTG-D3] lead đã có quy nguồn (đường sống ghi sau khi duyệt) giữ NGUYÊN byte-identical; phần còn lại vẫn ghi", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    // Đường sống ghi nguồn cho lead đầu tiên SAU khi kế hoạch đã dựng.
    await db.$transaction((tx) => taoNguonBanDau(tx, ids[0]!, duLieuNguon(nhom.WALK_IN, { matchedRule: "DUONG_VAO_MAC_DINH", reasonText: "đường sống" }), null));
    const truoc = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: ids[0]! } });
    const tpTruoc = await demTouchpoint([ids[0]!]);

    const r = await ghi(kh, nhomDm);
    expect(r).toMatchObject({ ok: true, ghi: 5, daCo: 1 });
    const sau = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: ids[0]! } });
    expect(sau).toEqual(truoc); // byte-identical, kể cả updatedAt
    expect(await demTouchpoint([ids[0]!])).toBe(tpTruoc);
    expect(await demQuyNguon(ids)).toBe(6);
  }, CASE);

  it("[DTG-D4] Lead.source và Lead.updatedAt KHÔNG đổi — backfill chỉ ghi nguồn", async () => {
    // Cấy: thêm `tx.lead.update({ data: { source } })` vào `taoNguonDiTruTheoLo` ⇒ ca này đỏ.
    const ids = await boMau();
    const lay = () => db.lead.findMany({ where: { id: { in: ids } }, select: { id: true, source: true, updatedAt: true, status: true, assignedToId: true }, orderBy: { id: "asc" } });
    const truoc = await lay();
    const { kh, nhomDm } = await lapKeHoach(ids);
    await ghi(kh, nhomDm);
    expect(await lay()).toEqual(truoc);
  }, CASE);

  it("[DTG-D5] chia lô (8 lead / lô 3 ⇒ 3 lô, audit ĐÚNG MỘT); lead xoá mềm giữa chừng bị bỏ qua, lô vẫn sống", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await taoLead(`lo${i}`, "Ads"));
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(kh.tong.ghi).toBe(8);
    // Một lead bị xoá mềm SAU khi kế hoạch dựng (người dùng xoá giữa lúc duyệt).
    const biXoa = kh.dong[4]!.leadId; // nằm lô 2
    await db.lead.update({ where: { id: biXoa }, data: { deletedAt: new Date("2026-10-11T01:00:00.000Z") } });

    const r = await ghi(kh, nhomDm, { kichThuocLo: 3 });
    expect(r).toMatchObject({ ok: true, ghi: 7, daCo: 0, daXoa: 1, soLo: 3 });
    expect(await demQuyNguon(ids)).toBe(7);
    expect(await demQuyNguon([biXoa])).toBe(0);
    expect(await demAuditLuot()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: HD_BAT_DAU } });
    expect(a.action).toBe("DI_TRU_NGUON");
    expect(a.newValues).toMatchObject({ soDuyet: 8, soDuyetReview: 0, sha: kh.sha, cuaSoMacDinhNgay: CUA_SO });
  }, CASE);

  it("[DTG-D6] sau backfill: lead XEM TAY và lead UNKNOWN đổi nguồn được (BO_SUNG_NGUOI / đổi nhóm) — trước đó «Lead chưa có quy nguồn»", async () => {
    const ids = await boMau();
    const [, , , ql, , trong] = ids as [string, string, string, string, string, string];
    const quyen: KiemQuyen = async (action) => action === "leads:overwrite";
    const actor = capKhoaGhiNguon({ userId: "u-dtg", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as Actor);
    const doi = (leadId: string, groupId: string) =>
      doiNguonLead({ leadId, actor, actorName: ACTOR_NAME, kiemQuyen: quyen, groupId, thamChieu: null, giaiTrinh: null, lyDo: "Đối chiếu sổ cũ: khách tự đến trung tâm", bayGio: new Date("2026-10-11T03:00:00.000Z") });

    // Trước backfill: không có quy nguồn ⇒ bị từ chối (đó là lý do backfill phải GHI cả dòng xem tay/UNKNOWN).
    const truoc = await doi(trong, nhom.WALK_IN);
    expect(truoc.ok).toBe(false);
    if (!truoc.ok) expect(truoc.loi).toMatch(/chưa có quy nguồn/);

    const { kh, nhomDm } = await lapKeHoach(ids);
    await ghi(kh, nhomDm);

    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: ql } });
    expect(a).toMatchObject({ referrerMissing: true, matchedRule: "DI_TRU" });
    const r1 = await doi(trong, nhom.WALK_IN);
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    const r2 = await doi(ql, nhom.WALK_IN);
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: trong }, include: { group: { select: { code: true } } } })).group.code).toBe("WALK_IN");
  }, CASE);

  it("[DTG-D7] INVALID > 0 ⇒ từ chối, 0 phép ghi (kể cả khi số duyệt khớp tuyệt đối)", async () => {
    const ids = [...(await boMau()), await taoLead("la", "Nhãn lạ hoắc chưa từng có")];
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(kh.tong.invalid).toBe(1);
    const r = await ghi(kh, nhomDm);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cong.ma).toBe("INVALID");
    expect(await demQuyNguon(ids)).toBe(0);
    expect(await demTouchpoint(ids)).toBe(0);
    expect(await demAuditLuot()).toBe(0);
  }, CASE);

  it("[DTG-D8] nội dung dòng ghi: attributedAt = createdAt · DI_TRU · signals.nguon (chủ + cửa sổ riêng/chung) · vai theo nhãn · touchpoint tại createdAt", async () => {
    const emp = await db.employee.create({ data: { employeeCode: `${P}MKT.1`, fullName: `${P}Marketing`, jobTitle: "MKT", department: "TUYEN_SINH" }, select: { id: true } });
    await db.leadSourceGroup.update({ where: { id: nhom.PAID_ADS }, data: { ownerEmployeeId: emp.id } });
    await db.leadSourceGroup.update({ where: { id: nhom.EMPLOYEE_REFERRAL }, data: { attributionWindowDays: 45 } });
    const ads = await taoLead("ads", "Ads", { createdAt: new Date("2026-08-20T04:30:00.000Z") });
    const ql = await taoLead("ql", "Quản Lý Trung Tâm", { createdAt: new Date("2026-08-21T04:30:00.000Z") });
    const { kh, nhomDm } = await lapKeHoach([ads, ql]);
    expect(kh.nhomChuNull.map((g) => g.code)).toEqual(["EMPLOYEE_REFERRAL"]); // PAID_ADS có chủ; nhân sự giới thiệu thì chưa
    await ghi(kh, nhomDm);

    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: ads }, include: { group: { select: { code: true } } } });
    expect(a.group.code).toBe("PAID_ADS");
    expect(a.originalGroupId).toBe(a.groupId);
    expect(a.attributedAt).toEqual(new Date("2026-08-20T04:30:00.000Z"));
    expect(a).toMatchObject({ matchedRule: "DI_TRU", identificationMethod: "SYSTEM_IMPORT", referrerKind: null, referrerMissing: false, conversionEntry: "Ads", inheritedFromLeadId: null });
    expect(a.signals).toMatchObject({ nhanGoc: "ads", diTru: true, nguon: { cuaSoNgay: CUA_SO, chuNhanVienId: emp.id } });
    expect((a.signals as { stt?: unknown }).stt).toBe(6);

    const b = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: ql }, include: { group: { select: { code: true } } } });
    expect(b.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(b).toMatchObject({ referrerKind: null, referrerEmployeeId: null, referrerMissing: true, referrerRoleCode: "MANAGER" });
    expect(b.signals).toMatchObject({ coXemTay: true, xemTay: ["THIEU_NGUOI"], nguon: { cuaSoNgay: 45, chuNhanVienId: null } });

    const tp = await db.leadTouchpoint.findMany({ where: { leadId: ads } });
    expect(tp).toHaveLength(1);
    expect(tp[0]).toMatchObject({ kind: "TAO_LEAD", claimedGroupId: nhom.PAID_ADS, conversionEntry: "Ads", actorId: null });
    expect(tp[0]!.occurredAt).toEqual(new Date("2026-08-20T04:30:00.000Z"));
    expect(tp[0]!.signals).toMatchObject({ diTru: true, nhanGoc: "ads" });
  }, CASE);

  it("[DTG-D9] --den: lead tạo SAU mốc không vào kế hoạch; hàng chờ nguồn thấy dòng xem tay vừa backfill (số đếm khớp)", async () => {
    const truoc = await taoLead("truoc", "Quản Lý Trung Tâm", { createdAt: new Date("2026-10-01T03:00:00.000Z") });
    const sau = await taoLead("sau", "Quản Lý Trung Tâm", { createdAt: new Date("2026-10-06T03:00:00.000Z") });
    const { kh, nhomDm } = await lapKeHoach([truoc, sau], { den: DEN_SAU });
    expect(kh.dong.map((d) => d.leadId)).toEqual([truoc]);
    await ghi(kh, nhomDm);
    expect(await demQuyNguon([truoc])).toBe(1);
    expect(await demQuyNguon([sau])).toBe(0);

    // Hàng chờ nguồn (đọc QUA Lead đã scope) thấy lead xem tay vừa backfill.
    const actor = { userId: "u-dtg", isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as Actor;
    const hc = await docHangChoNguon(actor, { coSoId: null, lyDo: "THIEU_NGUOI", trang: 1, now: new Date("2026-10-11T03:00:00.000Z"), canViewPii: true });
    expect(hc.dong.some((d) => d.leadId === truoc)).toBe(true);
    expect(await demHangChoNguon(actor, null)).toBeGreaterThanOrEqual(hc.tong); // chip lọc ≤ tổng (cùng `whereHangCho`)
  }, CASE);

  it("[DTG-D10] docTinhTrangBackfill: bốn số khớp kế hoạch; ghi xong ⇒ phần của fixture không còn thiếu quy nguồn", async () => {
    const ids = await boMau();
    const dau = await db.$transaction((tx: Tx) => docTinhTrangBackfill(tx));
    // Bộ DB dùng chung: có thể còn lead của spec khác ⇒ chỉ khẳng định phần ĐỒNG VỚI fixture của ca này qua kế hoạch có phạm vi.
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(dau.conThieuQuyNguon).toBeGreaterThanOrEqual(kh.tong.ghi + kh.tong.invalid);
    expect(dau.manualReview).toBeGreaterThanOrEqual(kh.tong.review);
    await ghi(kh, nhomDm);
    const sau = await db.$transaction((tx: Tx) => docTinhTrangBackfill(tx));
    expect(sau.conThieuQuyNguon).toBe(dau.conThieuQuyNguon - kh.tong.ghi); // INVALID (nếu có) vẫn còn thiếu — không bị ghi
    expect(sau.daDiTru).toBe(dau.daDiTru + kh.tong.ghi);
    expect(sau.manualReview).toBe(dau.manualReview - kh.tong.review);
    expect(sau.invalid).toBe(dau.invalid);
  }, CASE);

  it("[DTG-D11] nhóm thiếu trong danh mục ⇒ THIEU_NHOM, 0 phép ghi", async () => {
    const ids = [await taoLead("ads", "Ads")];
    const { kh, nhomDm } = await lapKeHoach(ids, { nhomGhiDe: (g) => g.filter((x) => x.code !== "PAID_ADS") });
    expect(kh.thieuNhom).toEqual(["PAID_ADS"]);
    const r = await ghi(kh, nhomDm);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cong.ma).toBe("THIEU_NHOM");
    expect(await demQuyNguon(ids)).toBe(0);
    expect(await demAuditLuot()).toBe(0);
  }, CASE);

  it("[DTG-D12] ĐUA THẬT với đường sống: đường sống đang giữ dòng quy nguồn CHƯA commit khi lô backfill ghi ⇒ lô chờ rồi bỏ qua dòng đó (không ném P2002), không touchpoint thừa", async () => {
    // Cấy: bỏ `skipDuplicates` ở `taoNguonDiTruTheoLo` ⇒ lượt backfill ném `P2002` sau khi đường sống commit ⇒ ca này đỏ (các ca DTG-D1..D11 KHÔNG bắt được: chúng ghi tuần tự nên `findMany` luôn thấy dòng đã có).
    const ids = [await taoLead("dua", "Ads")];
    const { kh, nhomDm } = await lapKeHoach(ids);
    let nha!: () => void;
    const giu = new Promise<void>((res) => (nha = res));
    let daChen!: () => void;
    const chen = new Promise<void>((res) => (daChen = res));
    const duongSong = db.$transaction(
      async (tx: Tx) => {
        await taoNguonBanDau(tx, ids[0]!, duLieuNguon(nhom.WALK_IN, { matchedRule: "DUONG_VAO_MAC_DINH", reasonText: "đường sống" }), null);
        daChen();
        await giu; // giữ transaction MỞ: dòng quy nguồn đã chèn nhưng CHƯA commit ⇒ lô backfill không thấy nó ở `findMany` mà `createMany` sẽ đụng khoá duy nhất
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    duongSong.catch(() => undefined);
    await chen;
    const ghiP = ghi(kh, nhomDm);
    ghiP.catch(() => undefined);
    // Chờ tới khi CÓ phiên đang đứng chờ khoá (xác định, không đồng hồ): lô backfill đã đi tới `createMany` và bị chặn bởi dòng chưa commit.
    let chanDuoc = false;
    for (let i = 0; i < 80 && !chanDuoc; i++) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      chanDuoc = Number(r[0]?.n ?? 0) > 0;
      if (!chanDuoc) await new Promise((res) => setTimeout(res, 100));
    }
    nha();
    await duongSong;
    expect(chanDuoc, "lô backfill phải bị chặn bởi dòng quy nguồn chưa commit của đường sống — nếu không, ca này không đo đua").toBe(true);
    const r = await ghiP;
    expect(r).toMatchObject({ ok: true, ghi: 0, daCo: 1 });
    const dong = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: ids[0]! }, select: { matchedRule: true } });
    expect(dong.matchedRule).toBe("DUONG_VAO_MAC_DINH"); // dòng của đường sống thắng, không bị ghi đè
    expect(await db.leadTouchpoint.count({ where: { leadId: { in: ids }, signals: { path: ["diTru"], equals: true } } })).toBe(0); // backfill không thêm touchpoint nào
    expect(await demAuditLuot()).toBe(0); // ghi 0 ⇒ không audit giả
  }, CASE);

  it("[DTG-D13] ĐUA THẬT giữa HAI lượt backfill cùng kế hoạch: quy nguồn = touchpoint = N, tổng «ghi» = N, audit = số lượt CÓ ghi (không đếm trùng dòng của lượt kia)", async () => {
    // Cấy: suy «dòng tôi vừa ghi» bằng `findMany({ matchedRule: "DI_TRU" })` sau `createMany` (bản trước 11/10) ⇒ lượt thua vẫn đọc thấy dòng của lượt thắng ⇒ touchpoint nhân đôi, «ghi» đếm trùng, audit 2 dòng.
    // Hiện trường ép đua XÁC ĐỊNH (không đồng hồ): một giao dịch ngoài giữ khoá dòng đầu CHƯA commit, nên CẢ HAI lượt đã đi qua bước đọc («chưa có quy nguồn») rồi mới bị chặn ở `createMany`.
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push(await taoLead(`dua2_${i}`, "Ads"));
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(kh.tong.ghi).toBe(40);
    const dauTien = kh.dong[0]!.leadId; // `createMany` chèn theo thứ tự kế hoạch ⇒ dòng đầu là dòng chặn trước tiên
    let nha!: () => void;
    const giu = new Promise<void>((res) => (nha = res));
    let daChen!: () => void;
    const chen = new Promise<void>((res) => (daChen = res));
    const giuKhoa = db.$transaction(
      async (tx: Tx) => {
        await taoNguonBanDau(tx, dauTien, duLieuNguon(nhom.WALK_IN, { matchedRule: "DUONG_VAO_MAC_DINH", reasonText: "đường sống" }), null);
        daChen();
        await giu;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    giuKhoa.catch(() => undefined);
    await chen;
    const chay = (n: number) => ({ actor: "nguoi-dispatch", triggeringActor: `nguoi-bam-${n}`, runId: "7001", runAttempt: String(n) });
    const pA = ghi(kh, nhomDm, { kichThuocLo: 40, nguonChay: chay(1), batDauLuc: new Date("2026-10-12T01:00:01.000Z") });
    const pB = ghi(kh, nhomDm, { kichThuocLo: 40, nguonChay: chay(2), batDauLuc: new Date("2026-10-12T01:00:02.000Z") });
    pA.catch(() => undefined);
    pB.catch(() => undefined);
    // Chờ tới khi CẢ HAI phiên đang đứng chờ khoá (xác định): cả hai đã qua bước đọc, chưa ai commit.
    let chanCa2 = false;
    for (let i = 0; i < 100 && !chanCa2; i++) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      chanCa2 = Number(r[0]?.n ?? 0) >= 2;
      if (!chanCa2) await new Promise((res) => setTimeout(res, 100));
    }
    nha();
    await giuKhoa;
    expect(chanCa2, "cả hai lượt backfill phải bị chặn bởi dòng chưa commit — nếu không, ca này không đo đua").toBe(true);
    const [a, b] = await Promise.all([pA, pB]);
    if (!a.ok || !b.ok) throw new Error("cổng số duyệt không được từ chối ở ca này");
    // dòng đầu thuộc đường sống (WALK_IN), 39 dòng còn lại được ĐÚNG MỘT lượt backfill chèn
    expect(a.ghi + b.ghi).toBe(39);
    for (const r of [a, b]) expect(r.ghi + r.daCo + r.daXoa, "mỗi lượt phải phân loại ĐỦ 40 dòng của nó").toBe(40);
    expect(await demQuyNguon(ids)).toBe(40);
    const tp = await db.leadTouchpoint.groupBy({ by: ["leadId"], where: { leadId: { in: ids } }, _count: { _all: true } });
    expect(tp.filter((x) => x._count._all > 1)).toEqual([]); // không lead nào có hai touchpoint
    expect(await demTouchpoint(ids)).toBe(39); // đúng dòng được backfill chèn; dòng của đường sống không có touchpoint backfill
    expect(await demAuditLuot()).toBe([a, b].filter((r) => r.ghi > 0).length); // mỗi lượt CÓ ghi để đúng một audit; lượt «ghi 0» không audit
    // §19/§20: bản ghi KẾT THÚC — mỗi lượt có ghi để đúng một, mang số THỰC GHI của CHÍNH lượt đó; Σ = N (không đếm trùng dòng của lượt kia); hai lượt phân biệt được bằng runAttempt.
    const kt = await docAuditKetThuc();
    expect(kt).toHaveLength([a, b].filter((r) => r.ghi > 0).length);
    expect(kt.map((x) => (x.newValues as { actualCount: number }).actualCount).reduce((t, n) => t + n, 0)).toBe(39);
    const theoAttempt = new Map(kt.map((x) => [(x.newValues as { nguonChay: { runAttempt: string } }).nguonChay.runAttempt, x.newValues as { actualCount: number; trangThai: string }]));
    if (a.ghi > 0) expect(theoAttempt.get("1")).toMatchObject({ actualCount: a.ghi, trangThai: "HOAN_TAT" });
    if (b.ghi > 0) expect(theoAttempt.get("2")).toMatchObject({ actualCount: b.ghi, trangThai: "HOAN_TAT" });
  }, CASE);

  it("[DTG-D14] nguồn CHƯA có chủ: không chấp nhận ⇒ TỪ CHỐI, 0 quy nguồn/touchpoint/audit; chấp nhận SAI danh sách ⇒ từ chối; chấp nhận ĐÚNG ⇒ ghi, audit mang danh sách + người bấm", async () => {
    // Cấy: bỏ nhánh `NGUON_CHUA_CO_CHU` khỏi `kiemCongGhi` ⇒ ba lần từ chối đầu ghi 6 dòng (cổng chỉ CẢNH BÁO, như bản trước vá).
    const ids = await boMau(); // `don()` đã xoá chủ mọi nguồn ⇒ mọi nguồn được dùng đều thiếu chủ
    const { kh, nhomDm } = await lapKeHoach(ids);
    const can = kh.nhomPhaiCoChu.map((g) => g.code).sort();
    expect(can.length).toBeGreaterThanOrEqual(2);
    for (const [ten, chap] of [
      ["không khai gì", []],
      ["khai THIẾU", can.slice(1)],
      ["khai THỪA (mã không thiếu chủ)", [...can, "KHONG_CO_NGUON_NAY"]],
    ] as const) {
      const r = await ghi(kh, nhomDm, { chap: [...chap] });
      expect(r.ok, ten).toBe(false);
      if (!r.ok) expect(r.cong.ma, ten).toBe("NGUON_CHUA_CO_CHU");
      expect(await demQuyNguon(ids), ten).toBe(0);
      expect(await demTouchpoint(ids), ten).toBe(0);
      expect(await demAuditLuot(), ten).toBe(0);
    }
    // ĐỐI CHỨNG DƯƠNG: khai ĐÚNG tập ⇒ ghi; audit giữ bằng chứng chấp nhận + người bấm.
    // Chạy LẠI: người dispatch lần đầu ≠ người bấm lượt này — audit phải giữ CẢ HAI, không gán lượt chạy lại cho người dispatch.
    const nguonChay = { actor: "nguoi-dispatch", triggeringActor: "nguoi-chay-lai", runId: "123456789", runAttempt: "2" };
    const r = await ghi(kh, nhomDm, { chap: [...can].reverse(), nguonChay });
    expect(r).toMatchObject({ ok: true, ghi: 6 });
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: HD_BAT_DAU } });
    expect(a.newValues).toMatchObject({ chapNhanNguonChuaCoChu: can, nhomChuNull: can, nhomPhaiCoChu: can, nguonChay });
    expect((a.newValues as { nguonChay: unknown }).nguonChay).toEqual(nguonChay); // đủ BỐN trường, không thừa không thiếu
  }, CASE);

  it("[DTG-D15] lô giữa chừng lỗi (khoá ngoại ở lô 2): lỗi mang số lô ĐÃ commit; lô 1 giữ nguyên, audit đúng 1; kế hoạch MỚI ghi nốt phần còn thiếu", async () => {
    // Cấy: nuốt lỗi trong vòng lô (trả `{ ok: true }` thay vì ném) ⇒ ca báo «xong» mà thiếu 5 dòng; bỏ `DiTruDungGiuaChungError` ⇒ lỗi thô không nói đã ghi bao nhiêu.
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await taoLead(`gl${i}`, "Ads"));
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(kh.tong.ghi).toBe(8);
    // Dòng thứ 5 (lô 2 khi lô = 3) trỏ nhóm không tồn tại: digest KHÔNG đổi (nó nằm ngoài các trường được băm) nhưng khoá ngoại nổ ĐÚNG ở lô 2.
    kh.dong[4]!.groupId = "nhom-khong-ton-tai";
    let loi: unknown = null;
    await ghi(kh, nhomDm, { kichThuocLo: 3 }).catch((e: unknown) => (loi = e));
    expect(loi).toBeInstanceOf(DiTruDungGiuaChungError);
    const e = loi as DiTruDungGiuaChungError;
    expect(e.tienDo).toEqual({ soLoKeHoach: 3, soLoDaCommit: 1, ghi: 3, daCo: 0, daXoa: 0 });
    expect(e.message).toMatch(/ĐÃ commit 1 lô/);
    expect(await demQuyNguon(ids)).toBe(3); // lô 1 đã commit, lô 2 lùi nguyên vẹn (không dòng nào của lô 2)
    expect(await demTouchpoint(ids)).toBe(3);
    expect(await demAuditLuot()).toBe(1); // audit nằm trong lô 1 đã commit
    // §20: lượt chết giữa chừng vẫn để bản ghi KẾT THÚC (trạng thái DUNG_GIUA_CHUNG + số đã ghi) — người đọc audit thấy "đã bắt đầu mà không hoàn tất" thay vì một bản ghi bắt đầu mồ côi.
    const kt = await docAuditKetThuc();
    expect(kt).toHaveLength(1);
    expect(kt[0]!.newValues).toMatchObject({ trangThai: "DUNG_GIUA_CHUNG", actualCount: 3, soLo: 1, soLoKeHoach: 3, expectedCount: 8, khop: false });
    expect(String((kt[0]!.newValues as { nguyenNhan: unknown }).nguyenNhan).length).toBeGreaterThan(0);
    // Kế hoạch tính lại chỉ còn 5 dòng chưa có quy nguồn ⇒ ghi nốt, không đụng 3 dòng đã có.
    const moi = await lapKeHoach(ids);
    expect(moi.kh.tong.ghi).toBe(5);
    expect(moi.kh.sha).not.toBe(kh.sha); // digest KHÁC — đúng như tài liệu dặn: duyệt lại
    expect(await ghi(moi.kh, moi.nhomDm)).toMatchObject({ ok: true, ghi: 5 });
    expect(await demQuyNguon(ids)).toBe(8);
    expect(await demTouchpoint(ids)).toBe(8);
  }, CASE);
  it("[DTG-D16] audit lượt chạy (§20): BẮT ĐẦU mang batDauLuc · cheDo APPLY · dryRun false · expectedCount; KẾT THÚC (action riêng) mang actualCount; chạy lại «ghi 0» KHÔNG để thêm bản ghi nào", async () => {
    // Cấy: bỏ bản ghi kết thúc ⇒ ca đỏ ở `toHaveLength(1)`; ghi actualCount = kế hoạch thay vì số thực ghi ⇒ đỏ ở 7 vs 8.
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await taoLead(`k${i}`, "Ads"));
    const { kh, nhomDm } = await lapKeHoach(ids);
    const biXoa = kh.dong[2]!.leadId;
    await db.lead.update({ where: { id: biXoa }, data: { deletedAt: new Date("2026-10-11T01:00:00.000Z") } });
    const nguonChay = { actor: "nguoi-dispatch", triggeringActor: "nguoi-chay-lai", runId: "424242", runAttempt: "2" };
    const r = await ghi(kh, nhomDm, { kichThuocLo: 4, nguonChay });
    expect(r).toMatchObject({ ok: true, ghi: 7, daXoa: 1, soLo: 2 });

    const bd = await db.auditLog.findFirstOrThrow({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: HD_BAT_DAU } });
    expect(bd.newValues).toMatchObject({
      luotChay: { cheDo: "APPLY", dryRun: false, batDauLuc: BAT_DAU.toISOString(), expectedCount: 8, expectedReviewCount: kh.tong.review },
      nguonChay,
      soDuyet: 8,
    });
    const kt = await docAuditKetThuc();
    expect(kt).toHaveLength(1);
    expect(kt[0]!.entityId).toBe(bd.entityId); // cùng khoá kế hoạch ⇒ tra một lượt chạy ra cả hai bản ghi
    expect(kt[0]!.newValues).toMatchObject({
      trangThai: "HOAN_TAT",
      luotChay: { cheDo: "APPLY", dryRun: false, batDauLuc: BAT_DAU.toISOString(), expectedCount: 8 },
      nguonChay,
      actualCount: 7, // số THỰC GHI, không phải 8 của kế hoạch
      daXoa: 1,
      daCo: 0,
      soLo: 2,
      soLoKeHoach: 2,
      khop: true, // 7 ghi + 1 đã xoá = 8 = expectedCount
    });
    // Chạy lại với kế hoạch cũ: «ghi 0» ⇒ không bản ghi nào (cả hai loại) — dấu vết của lượt chạy lại ghi 0 nằm ở log Actions + báo cáo, không ở bảng audit (quyết định cũ giữ nguyên).
    const lai = await ghi(kh, nhomDm, { nguonChay: { ...nguonChay, runAttempt: "3" }, batDauLuc: new Date("2026-10-12T02:00:00.000Z") });
    expect(lai).toMatchObject({ ok: true, ghi: 0 });
    expect(await demAuditLuot()).toBe(1);
    expect(await demAuditKetThuc()).toBe(1);
  }, CASE);

  it("[DTG-D17] ràng buộc ở DB (§19): UNIQUE(leadId) do Postgres giữ; BA lượt chạy song song (không giữ khoá) ⇒ quy nguồn = touchpoint = N, audit = số lượt có ghi, Σ actualCount = N", async () => {
    // Phần 1 — ràng buộc nằm ở DB chứ không phải kiểm-trước-khi-chèn ở tầng ứng dụng: chèn trùng bằng SQL thô PHẢI nổ 23505.
    const chiMuc = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'LeadAttribution'`;
    expect(chiMuc.some((x) => /UNIQUE/i.test(x.indexdef) && /\("leadId"\)/.test(x.indexdef)), "thiếu UNIQUE(leadId) trên LeadAttribution").toBe(true);
    const mot = await taoLead("rang-buoc", "Ads");
    const { kh: kh1, nhomDm: nhom1 } = await lapKeHoach([mot]);
    await ghi(kh1, nhom1);
    let ma: string | null = null;
    try {
      // Bản sao đúng dòng đang có (chỉ đổi id) — không đoán cột bắt buộc nào khác; cùng leadId ⇒ chỉ ràng buộc UNIQUE(leadId) có thể từ chối.
      await db.$executeRaw`INSERT INTO "LeadAttribution" ("id","leadId","groupId","originalGroupId","identificationMethod","matchedRule","reasonText","attributedAt","updatedAt")
        SELECT 'dtg-trung-1', "leadId", "groupId", "originalGroupId", "identificationMethod", "matchedRule", "reasonText", "attributedAt", "updatedAt" FROM "LeadAttribution" WHERE "leadId" = ${mot}`;
    } catch (e) {
      ma = (e as { meta?: { code?: string }; code?: string }).meta?.code ?? (e as { code?: string }).code ?? String(e);
    }
    expect(ma, "chèn trùng LeadAttribution(leadId) phải bị Postgres từ chối").toMatch(/23505|P2010/);
    expect(await demQuyNguon([mot])).toBe(1);

    // Phần 2 — ba lượt cùng kế hoạch, KHÔNG ép thứ tự: bất biến đúng với MỌI thứ tự xen kẽ (nên không đồng hồ, không flaky).
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await taoLead(`ba${i}`, "Ads"));
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(kh.tong.ghi).toBe(30);
    const ketQua = await Promise.all(
      [1, 2, 3].map((n) =>
        ghi(kh, nhomDm, { kichThuocLo: 10, nguonChay: { actor: "nguoi-dispatch", triggeringActor: `nguoi-bam-${n}`, runId: "7002", runAttempt: String(n) }, batDauLuc: new Date(`2026-10-12T01:10:0${n}.000Z`) }),
      ),
    );
    const ok = ketQua.map((r) => (r.ok ? r : null));
    if (ok.some((r) => r === null)) throw new Error("cổng số duyệt không được từ chối ở ca này");
    const cacLuot = ok as Extract<(typeof ketQua)[number], { ok: true }>[];
    expect(cacLuot.reduce((t, r) => t + r.ghi, 0)).toBe(30); // mỗi dòng có ĐÚNG MỘT người ghi
    for (const r of cacLuot) expect(r.ghi + r.daCo + r.daXoa, "mỗi lượt phân loại ĐỦ 30 dòng").toBe(30);
    expect(await demQuyNguon(ids)).toBe(30);
    expect(await demTouchpoint(ids)).toBe(30);
    const nhieu = await db.leadTouchpoint.groupBy({ by: ["leadId"], where: { leadId: { in: ids } }, _count: { _all: true } });
    expect(nhieu.filter((x) => x._count._all !== 1)).toEqual([]);
    const coGhi = cacLuot.filter((r) => r.ghi > 0).length;
    expect(await demAuditLuot()).toBe(coGhi + 1); // +1: lượt ghi `mot` ở phần 1
    expect(await demAuditKetThuc()).toBe(coGhi + 1);
    const kt = await docAuditKetThuc();
    const tong = kt.reduce((t, x) => t + (x.newValues as { actualCount: number }).actualCount, 0);
    expect(tong).toBe(31); // 1 (phần 1) + 30 (phần 2): tổng actualCount của MỌI bản ghi kết thúc = số quy nguồn đã ghi
  }, CASE);

});
