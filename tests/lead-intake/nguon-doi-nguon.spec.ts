// @vitest-environment node
/**
 * PR2 — ĐỔI NGUỒN CÓ KIỂM SOÁT + ĐỌC NGUỒN QUA LEAD ĐÃ SCOPE. Postgres LOCAL thật.
 *
 *   [NHH-SRC-16]   đổi TRƯỚC thực thu: quyền `leads:overwrite` + lý do ⇒ attribution đổi, AuditLog `DOI_NGUON`, NGUỒN GỐC bất biến
 *   [NHH-SRC-16b]  thiếu lý do ⇒ lỗi trên field `lyDo`, 0 dòng đổi, 0 AuditLog
 *   [NHH-SRC-16c]  nguồn đang KHOÁ (page mapping) cần thêm `sources:manage`
 *   [NHH-SRC-17]   đổi SAU thực thu: chỉ `sources:override-after-payment`; phát DomainEvent `nguon.da-doi-sau-thanh-toan` (KHÔNG Adjustment)
 *   [NHH-FRD-03]   TU_CLAIM — chủ lead tự đặt mình làm người giới thiệu khi đã có nguồn khác ⇒ BLOCK (lỗi trên field)
 *   [NHH-SRC-23y]  hai lượt đổi song song ⇒ đúng MỘT thắng (khoá lạc quan theo updatedAt), không lượt nào nuốt lượt nào
 *   [NCL-05..08]   cách ly cơ sở của cả GHI lẫn ĐỌC: actor cơ sở B không đổi/không đọc nguồn của lead cơ sở A; 0 audit; lỗi không lộ nhóm/người
 *   [NHH-SRC-H21-Q] hàng chờ nguồn đọc QUA Lead đã scope, thấy ca MANUAL_REVIEW
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NDOI` / `NDOI_`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { docHangChoNguon, docNguonLead } from "../../lib/nguon/doc-nguon";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NDOI_";
const CASE = 60_000;

function actorCoSo(userId: string, centerIds: string[]): Actor {
  return {
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as Actor;
}

/** Quyền giả lập — chỉ khoá nào được liệt kê mới `true`. Việc `can()` thật quyết định quyền nằm ở `permissions.test`/`[NHH-SEC-*]`. */
const quyen = (...cac: string[]): KiemQuyen => async (action) => cac.includes(action);
const CO_DE = quyen("leads:overwrite");
const CO_SAU = quyen("sources:override-after-payment");

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    for (const id of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${id}:` } } });
    const dons = await db.order.findMany({ where: { leadId: { in: ids } }, select: { id: true } });
    await db.payment.deleteMany({ where: { orderId: { in: dons.map((o) => o.id) } } });
    await db.order.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.student.deleteMany({ where: { id: { startsWith: P } } }); // [NHH-FRD-03d] học viên của phụ huynh giới thiệu — FK sang User
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "NDOI_G_" } } }); // [NHH-FRD-03c] nguồn có chủ — FK Restrict sang Employee
  await db.user.deleteMany({ where: { email: { startsWith: P } } }); // ca [NHH-FRD-03] tạo user — ca đỏ giữa chừng không được để lại rác cho lượt sau
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.center.deleteMany({ where: { code: { startsWith: "NDOI" } } });
}

describe.skipIf(!RUN)("PR2 — đổi nguồn có kiểm soát + đọc nguồn qua Lead đã scope", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";
  let leadA = "";

  async function dungLead(opts: { centerId?: string; groupId?: string; assignedToId?: string | null; signals?: object; ten?: string; referrerMissing?: boolean } = {}) {
    const l = await db.lead.create({
      data: {
        parentName: `${P}${opts.ten ?? "Lead"}`,
        phone: `0908${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
        status: "MOI",
        centerId: opts.centerId ?? cA,
        assignedToId: opts.assignedToId ?? null,
      },
      select: { id: true },
    });
    const g = opts.groupId ?? nhom.PAID_ADS;
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: g,
        originalGroupId: g,
        identificationMethod: "SYSTEM_DEFAULT",
        matchedRule: "DUONG_VAO_MAC_DINH",
        reasonText: "ca test",
        attributedAt: new Date("2026-08-01T00:00:00.000Z"),
        referrerMissing: opts.referrerMissing ?? false,
        signals: (opts.signals ?? { duongVao: "facebook" }) as object,
      },
    });
    return l.id;
  }

  const attr = (id: string) =>
    db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, include: { group: { select: { code: true } } } });
  const demAudit = (id: string) => db.auditLog.count({ where: { entityType: "Lead", entityId: id, module: "nguon-hoa-hong" } });

  async function dungSale(hau: string, status: "ACTIVE" | "RESIGNED" = "ACTIVE") {
    const emp = await db.employee.create({
      data: {
        employeeCode: `${P}NV${hau}`,
        fullName: `${P}Sale ${hau}`,
        jobTitle: "Tư vấn",
        department: "TUYEN_SINH",
        centerId: cA,
        isActive: status === "ACTIVE",
        status,
      },
      select: { id: true },
    });
    return emp.id;
  }

  const doi = (over: Partial<Parameters<typeof doiNguonLead>[0]> & { leadId: string }) =>
    doiNguonLead({
      actor: actorCoSo("u-test", [cA]),
      actorName: "Người đổi",
      kiemQuyen: CO_DE,
      groupId: nhom.WALK_IN,
      thamChieu: null,
      giaiTrinh: null,
      lyDo: "Khách xác nhận tự đến trung tâm",
      bayGio: new Date(),
      ...over,
    });

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    cA = (await db.center.create({ data: { code: "NDOI-A", name: "NDOI A", slug: "ndoi-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "NDOI-B", name: "NDOI B", slug: "ndoi-b", address: "b", city: "" } })).id;
    leadA = await dungLead({ ten: "A" });
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 120_000);

  it("[NHH-SRC-16] đổi trước thực thu: attribution đổi, AuditLog DOI_NGUON cùng giao dịch, NGUỒN GỐC bất biến, cờ xem tay được gỡ", async () => {
    await db.leadAttribution.update({
      where: { leadId: leadA },
      data: { signals: { duongVao: "nhap-tay", coXemTay: true, xemTay: ["NHAN_CHOT_THEO_PHIEU"], nhanGoc: "Nhập tay" } },
    });
    const truoc = await attr(leadA);
    const r = await doi({ leadId: leadA, groupId: nhom.WALK_IN });
    expect(r).toMatchObject({ ok: true, canDieuChinh: false, action: "DOI_NGUON" });
    const sau = await attr(leadA);
    expect(sau.group.code).toBe("WALK_IN");
    expect(sau.changeReason).toBe("Khách xác nhận tự đến trung tâm");
    // NGUỒN GỐC bất biến (M1): ba cột không đổi.
    expect(sau.originalGroupId).toBe(truoc.originalGroupId);
    expect(sau.inheritedFromLeadId).toBe(truoc.inheritedFromLeadId);
    expect(sau.attributedAt).toEqual(truoc.attributedAt);
    // Người đã quyết ⇒ không còn nằm trong hàng chờ.
    const s = sau.signals as { coXemTay?: boolean; xemTay?: string[]; nhanGoc?: string; daXemTay?: boolean };
    expect(s.coXemTay).toBeUndefined();
    expect(s.xemTay).toBeUndefined();
    expect(s.nhanGoc).toBe("Nhập tay"); // vết gốc GIỮ
    expect(s.daXemTay).toBe(true);
    expect(await demAudit(leadA)).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "Lead", entityId: leadA, module: "nguon-hoa-hong" } });
    expect(a.action).toBe("DOI_NGUON");
    expect(a.reason).toBe("Khách xác nhận tự đến trung tâm");
  }, CASE);

  it("[NHH-SRC-16b] thiếu lý do / lý do 9 ký tự ⇒ lỗi trên field lyDo, 0 dòng đổi, 0 AuditLog (đối chứng 10 ký tự ⇒ qua)", async () => {
    for (const lyDo of [null, "", "123456789"]) {
      const r = await doi({ leadId: leadA, lyDo });
      expect(r).toMatchObject({ ok: false, truong: "lyDo" });
    }
    expect((await attr(leadA)).group.code).toBe("PAID_ADS");
    expect(await demAudit(leadA)).toBe(0);
    // Lỗi NHẬP LIỆU (thiếu lý do) không phải dấu hiệu gian lận ⇒ KHÔNG để lại touchpoint chặn.
    expect(await db.leadTouchpoint.count({ where: { leadId: leadA } })).toBe(0);
    expect((await doi({ leadId: leadA, lyDo: "1234567890" })).ok).toBe(true);
  }, CASE);

  it("[NHH-SRC-16c] nguồn đang KHOÁ (page mapping): chỉ có leads:overwrite ⇒ từ chối; có thêm sources:manage ⇒ qua", async () => {
    const khoa = await dungLead({ ten: "Khoa", signals: { duongVao: "facebook", khoaNguon: true, pageId: "PG1" } });
    const tu = await doi({ leadId: khoa });
    expect(tu).toMatchObject({ ok: false, truong: "quyen" });
    expect((await attr(khoa)).group.code).toBe("PAID_ADS");
    expect(await demAudit(khoa)).toBe(0);
    const ok = await doi({ leadId: khoa, kiemQuyen: quyen("leads:overwrite", "sources:manage") });
    expect(ok.ok).toBe(true);
  }, CASE);

  async function dungDonDaThu(leadId: string): Promise<void> {
    const o = await db.order.create({
      data: { code: `ORD-NDOI-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId },
      select: { id: true },
    });
    await db.payment.create({
      data: { orderId: o.id, amount: 1_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: "CONFIRMED" },
    });
  }

  it("[NHH-SRC-17] đổi SAU thực thu: chỉ leads:overwrite ⇒ TỪ CHỐI (0 đổi, 0 audit, 0 event); có sources:override-after-payment ⇒ qua + event", async () => {
    const lead = await dungLead({ ten: "SauThu" });
    await dungDonDaThu(lead);
    const tu = await doi({ leadId: lead, kiemQuyen: CO_DE });
    expect(tu).toMatchObject({ ok: false, truong: "quyen" });
    expect((await attr(lead)).group.code).toBe("PAID_ADS");
    expect(await demAudit(lead)).toBe(0);
    expect(await db.domainEvent.count({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead}:` } } })).toBe(0);
    // Sổ GHI THÊM: lượt đổi sau thực thu thiếu quyền để lại ĐÚNG MỘT touchpoint DOI_NGUON_BI_CHAN (DOI_SAU_TT), attribution không đổi.
    const bi = await db.leadTouchpoint.findMany({ where: { leadId: lead } });
    expect(bi.map((t) => t.kind)).toEqual(["DOI_NGUON_BI_CHAN"]);
    expect((bi[0]!.signals as { maChan: string }).maChan).toBe("DOI_SAU_TT");

    const ok = await doi({ leadId: lead, kiemQuyen: CO_SAU });
    expect(ok).toMatchObject({ ok: true, canDieuChinh: true, action: "DOI_NGUON_SAU_THU" });
    expect((await attr(lead)).group.code).toBe("WALK_IN");
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "Lead", entityId: lead, module: "nguon-hoa-hong" } });
    expect(a.action).toBe("DOI_NGUON_SAU_THU");
  }, CASE);

  it("[NHH-SRC-17b] sự kiện `nguon.da-doi-sau-thanh-toan` cùng giao dịch: có id nhóm cũ/mới + lý do + người đổi, KHÔNG PII; trước thực thu ⇒ KHÔNG phát; KHÔNG ghi Adjustment/dòng sổ nào", async () => {
    const lead = await dungLead({ ten: "SuKien" });
    await dungDonDaThu(lead);
    await doi({ leadId: lead, kiemQuyen: CO_SAU });
    const ev = await db.domainEvent.findMany({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead}:` } } });
    expect(ev).toHaveLength(1);
    const p = ev[0]!.payloadJson as Record<string, unknown>;
    expect(p).toMatchObject({ leadId: lead, tuNhom: "PAID_ADS", denNhom: "WALK_IN", lyDo: "Khách xác nhận tự đến trung tâm", actorId: "u-test" });
    expect(JSON.stringify(p)).not.toMatch(/\b(0|84)\d{9}\b|@/);
    // Đối chứng dương: đổi TRƯỚC thực thu ⇒ không phát.
    const truoc = await dungLead({ ten: "TruocThu" });
    await doi({ leadId: truoc });
    expect(await db.domainEvent.count({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${truoc}:` } } })).toBe(0);
    await db.domainEvent.deleteMany({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead}:` } } });
  }, CASE);

  /** Nhân sự + tài khoản đăng nhập (Employee.id và User.id khác nhau — TU_CLAIM phải so ở CẢ HAI không gian). */
  async function dungNguoi(hau: string) {
    const empId = await dungSale(hau);
    const user = await db.user.create({
      data: { name: `${P}U${hau}`, email: `${P}${hau.toLowerCase()}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cA, employeeId: empId, isActive: true },
      select: { id: true },
    });
    return { empId, userId: user.id };
  }
  const thamNv = (employeeId: string) => ({ employeeId, parentUserId: null, studentId: null, affiliateId: null });
  const chanTuClaim = async (lead: string) => {
    expect((await db.leadTouchpoint.findMany({ where: { leadId: lead } })).map((t) => (t.signals as { maChan?: string } | null)?.maChan)).toEqual(["TU_CLAIM"]);
    expect(await demAudit(lead)).toBe(0);
  };

  it("[NHH-FRD-03] TU_CLAIM: chủ lead tự đặt MÌNH làm người giới thiệu ⇒ BLOCK ở MỌI nguồn cũ (kể cả UNKNOWN — res3-1); người KHÁC làm người giới thiệu ⇒ qua", async () => {
    // Cấy: khôi phục vế `nguonCuLaUnknown === false` ⇒ lead2 (nguồn cũ UNKNOWN) lọt qua (đỏ).
    const t1 = await dungNguoi("T1");
    const khac = await dungNguoi("T2");
    const lead = await dungLead({ ten: "TuClaim", assignedToId: t1.userId });
    const dau = { leadId: lead, actor: actorCoSo(t1.userId, [cA]), groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: thamNv(t1.empId) };
    expect(await doi(dau)).toMatchObject({ ok: false, truong: "thamChieu" });
    expect((await attr(lead)).group.code).toBe("PAID_ADS");
    await chanTuClaim(lead);

    // nguồn cũ UNKNOWN: TRƯỚC 09/10 lọt qua (vế `nguonCuLaUnknown === false`) — nay cũng BLOCK
    const lead2 = await dungLead({ ten: "TuClaim2", assignedToId: t1.userId, groupId: nhom.UNKNOWN });
    expect(await doi({ ...dau, leadId: lead2 })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect((await attr(lead2)).group.code).toBe("UNKNOWN");

    // Đối chứng dương: cùng chủ lead nhưng người giới thiệu là NGƯỜI KHÁC ⇒ được, và KHÔNG để lại touchpoint chặn
    const lead3 = await dungLead({ ten: "TuClaim3", assignedToId: t1.userId });
    expect((await doi({ ...dau, leadId: lead3, thamChieu: thamNv(khac.empId) })).ok).toBe(true);
    expect(await db.leadTouchpoint.count({ where: { leadId: lead3 } })).toBe(0);
  }, CASE);

  it("[NHH-FRD-03b] chủ lead là người CHỐT ĐƠN (convertedById) hoặc SALE ADMIN (adminId) — không phải assignedToId — cũng bị bắt: engine trả tiền Sale theo hai cột đó", async () => {
    // Cấy: bỏ `lead.convertedById` (hoặc `lead.adminId`) khỏi tập chủ lead ⇒ lượt tương ứng lọt qua (đỏ). NGƯỜI BẤM phải là bên thứ ba: nếu người bấm chính là người được chọn thì dù chủ lead
    // tính thế nào nó vẫn bị bắt vì «người bấm» cũng là chủ lead — ca sẽ xanh vì lý do sai (bản đầu của ca này mắc đúng lỗi đó, phép cấy 09/10 lộ ra).
    const chot = await dungNguoi("C1");
    const adm = await dungNguoi("C2");
    const quanLy0 = await dungNguoi("C0");
    const lead = await dungLead({ ten: "Chot" });
    await db.lead.update({ where: { id: lead }, data: { convertedById: chot.userId, adminId: adm.userId, assignedToId: null } });
    const dau = (empId: string, userId: string) => ({ leadId: lead, actor: actorCoSo(userId, [cA]), groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: thamNv(empId) });
    expect(await doi(dau(chot.empId, quanLy0.userId))).toMatchObject({ ok: false, truong: "thamChieu" });
    expect(await doi(dau(adm.empId, quanLy0.userId))).toMatchObject({ ok: false, truong: "thamChieu" });
    expect((await attr(lead)).group.code).toBe("PAID_ADS");
    // Đối chứng dương: người đổi là MỘT QUẢN LÝ không dính lead, người được chọn là một nhân sự cũng không dính lead
    const la = await dungNguoi("C3");
    const quanLy = await dungNguoi("C4");
    const kq = await doi(dau(la.empId, quanLy.userId));
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true });
  }, CASE);

  it("[NHH-FRD-03c] người PHỤ TRÁCH NGUỒN đích là chủ lead ⇒ BLOCK (SOURCE_OWNER); chủ nguồn là người khác ⇒ qua; bản chụp `signals.nguon` được GHI LẠI theo nguồn đích", async () => {
    // Cấy: bỏ `chuNguonEmployeeId` khỏi `danhTinhNguoiNhan` ở `doiNguonLead` ⇒ hai lượt đầu lọt qua (đỏ).
    const chu = await dungNguoi("O1");
    const khac = await dungNguoi("O2");
    const g = await db.leadSourceGroup.create({ data: { code: "NDOI_G_OWN", name: "NDOI own", referrerRequirement: "NONE", sortOrder: 700, attributionWindowDays: 45, ownerEmployeeId: chu.empId } });
    const lead = await dungLead({ ten: "Own", assignedToId: chu.userId });
    expect(await doi({ leadId: lead, actor: actorCoSo(chu.userId, [cA]), groupId: g.id })).toMatchObject({ ok: false, truong: "thamChieu" });
    await chanTuClaim(lead);
    // người bấm KHÔNG phải chủ lead nhưng chủ NGUỒN là chủ lead ⇒ vẫn là hai vai hưởng trên cùng một người
    const lead2 = await dungLead({ ten: "Own2", assignedToId: chu.userId });
    expect(await doi({ leadId: lead2, actor: actorCoSo(khac.userId, [cA]), groupId: g.id })).toMatchObject({ ok: false, truong: "thamChieu" });

    // Đối chứng dương + bản chụp: chủ lead là người khác ⇒ qua; attribution mang bản chụp của NGUỒN ĐÍCH
    const lead3 = await dungLead({ ten: "Own3", assignedToId: khac.userId });
    expect((await doi({ leadId: lead3, actor: actorCoSo(khac.userId, [cA]), groupId: g.id })).ok).toBe(true);
    expect((await attr(lead3)).signals).toMatchObject({ nguon: { cuaSoNgay: 45, chuNhanVienId: chu.empId } });
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: g.id } });
    await db.leadAttribution.deleteMany({ where: { groupId: g.id } });
    await db.leadSourceGroup.delete({ where: { id: g.id } });
  }, CASE);

  it("[NHH-FRD-03d] Sale phụ trách PH (REFERRER_PARENT_SALE) chính là chủ lead ⇒ BLOCK; Sale PH là người khác ⇒ qua và được GHI vào referrerSaleUserId", async () => {
    // Cấy: bỏ `referrerSaleUserId` khỏi `danhTinhNguoiNhan` ⇒ lượt đầu lọt qua (đỏ).
    const sale = await dungNguoi("P1");
    const saleKhac = await dungNguoi("P2");
    const ph = await db.user.create({ data: { name: `${P}PH`, email: `${P}ph@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const leadGoc = await db.lead.create({ data: { parentName: `${P}Goc`, phone: "0908000111", status: "DA_DANG_KY", convertedById: sale.userId, centerId: cA, createdAt: new Date("2026-08-01T03:00:00.000Z") }, select: { id: true } });
    await db.student.create({ data: { id: `${P}hv-ph`, name: `${P}HV`, centerId: cA, parentUserId: ph.id, leadId: leadGoc.id } });
    const tham = { employeeId: null, parentUserId: ph.id, studentId: null, affiliateId: null };
    const lead = await dungLead({ ten: "PhSale" });
    const bayGio = new Date("2026-10-01T03:00:00.000Z");
    expect(await doi({ leadId: lead, actor: actorCoSo(sale.userId, [cA]), groupId: nhom.PARENT_REFERRAL, thamChieu: tham, bayGio })).toMatchObject({ ok: false, truong: "thamChieu" });
    await chanTuClaim(lead);
    // Đối chứng dương: Sale PH là người khác với mọi chủ lead
    await db.lead.update({ where: { id: leadGoc.id }, data: { convertedById: saleKhac.userId } });
    const lead2 = await dungLead({ ten: "PhSale2" });
    expect((await doi({ leadId: lead2, actor: actorCoSo(sale.userId, [cA]), groupId: nhom.PARENT_REFERRAL, thamChieu: tham, bayGio })).ok).toBe(true);
    expect((await attr(lead2)).referrerSaleUserId).toBe(saleKhac.userId);
    await db.student.deleteMany({ where: { id: `${P}hv-ph` } });
    await db.lead.deleteMany({ where: { id: leadGoc.id } });
  }, CASE);

  it("[NHH-FRD-03e] D12 + đổi nguồn: lead do X nhập và X là người giới thiệu (ghi lúc tạo) — X chuyển nó sang nguồn KHÔNG có người hưởng nào (Quảng cáo) ⇒ QUA, không phạt X vì thao tác không liên quan; X tự đặt lại MÌNH làm người giới thiệu của lead khác ⇒ vẫn BLOCK", async () => {
    // Cấy: so `danhTinhNguoiNhan` với người giới thiệu CŨ của attribution (thay vì người của lượt gán MỚI) ⇒ lượt đầu bị chặn oan (đỏ).
    const x = await dungNguoi("X1");
    const lead = await dungLead({ ten: "D12", assignedToId: x.userId, groupId: nhom.EMPLOYEE_REFERRAL });
    await db.leadAttribution.update({ where: { leadId: lead }, data: { referrerKind: "EMPLOYEE", referrerEmployeeId: x.empId, referrerRoleCode: "SALE" } });
    const qua = await doi({ leadId: lead, actor: actorCoSo(x.userId, [cA]), groupId: nhom.PAID_ADS, thamChieu: null });
    expect(qua, JSON.stringify(qua)).toMatchObject({ ok: true });
    expect((await attr(lead)).group.code).toBe("PAID_ADS");
    expect(await db.leadTouchpoint.count({ where: { leadId: lead } })).toBe(0);
    // Đối chứng âm: lead khác của X, nguồn cũ Quảng cáo, X tự chọn mình làm người giới thiệu ⇒ BLOCK
    const lead2 = await dungLead({ ten: "D12b", assignedToId: x.userId });
    expect(await doi({ leadId: lead2, actor: actorCoSo(x.userId, [cA]), groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: thamNv(x.empId) })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect((await attr(lead2)).group.code).toBe("PAID_ADS");
    await chanTuClaim(lead2);
  }, CASE);

  it("[NHH-SRC-16d] nhóm ✅ người: thiếu người ⇒ lỗi thamChieu; người RESIGNED ⇒ từ chối (D13: không claim MỚI); người ACTIVE ⇒ qua và được LƯU", async () => {
    const act = await dungSale("OK");
    const nghi = await dungSale("NGHI", "RESIGNED");
    const tham = (employeeId: string) => ({ employeeId, parentUserId: null, studentId: null, affiliateId: null });
    expect(await doi({ leadId: leadA, groupId: nhom.EMPLOYEE_REFERRAL })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect(await doi({ leadId: leadA, groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: tham(nghi) })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect(await demAudit(leadA)).toBe(0);
    expect((await doi({ leadId: leadA, groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: tham(act) })).ok).toBe(true);
    const a = await attr(leadA);
    expect(a.referrerKind).toBe("EMPLOYEE");
    expect(a.referrerEmployeeId).toBe(act);
    expect(a.referrerMissing).toBe(false);
  }, CASE);

  it("[NHH-SRC-16e] BỔ SUNG NGƯỜI cho attribution THIEU_NGUOI cũng là một lượt đổi: lý do bắt buộc, action BO_SUNG_NGUOI", async () => {
    // PR7 (D5 ở máy chủ): nhân sự này KHÔNG có vai nào ⇒ nhóm GHI suy ra là nhóm nhân sự giới thiệu (EMPLOYEE_REFERRAL), nên lead thiếu người cũng ở nhóm đó —
    // "bổ sung người cho CHÍNH nhóm đó" so với nhóm đã SUY, không phải nhóm client gửi.
    const thieu = await dungLead({ ten: "Thieu", groupId: nhom.EMPLOYEE_REFERRAL, referrerMissing: true });
    const emp = await dungSale("BS");
    const tham = { employeeId: emp, parentUserId: null, studentId: null, affiliateId: null };
    expect(await doi({ leadId: thieu, groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: tham, lyDo: "ngắn" })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await doi({ leadId: thieu, groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: tham })).toMatchObject({ ok: true, action: "BO_SUNG_NGUOI" });
    const a = await attr(thieu);
    expect(a.referrerMissing).toBe(false);
    expect(a.referrerEmployeeId).toBe(emp);
  }, CASE);

  it("[NHH-SRC-23y] hai lượt đổi SONG SONG cùng lead ⇒ KHÔNG lượt nào bị ghi đè lặng lẽ: mỗi lượt thắng có đúng 1 AuditLog, chuỗi audit liền mạch, lượt thua (nếu có) báo 'nguồn vừa đổi'", async () => {
    // ⚠️ Bản cũ khẳng định "đúng MỘT thắng" — SAI về nguyên tắc: `doiNguonLead` đọc attribution BÊN TRONG transaction, nên nếu lượt
    // thứ hai mở transaction SAU khi lượt thứ nhất commit thì nó đọc bản MỚI và thắng hợp lệ (hai lượt tuần tự). Đo được: ca đỏ
    // ngẫu nhiên "expected length 1 but got 2" trong hai lượt cấy-lỗi không liên quan. Nay ca chỉ khẳng định thứ LUÔN đúng; việc
    // ép lượt thứ hai đọc bản cũ (nên phải thua) do [NHH-SRC-23y2] làm bằng khoá dòng thật, không bằng may rủi xen kẽ.
    const kq = await Promise.all([
      doi({ leadId: leadA, groupId: nhom.WALK_IN, lyDo: "Lượt thứ nhất đổi nguồn" }),
      doi({ leadId: leadA, groupId: nhom.CENTER_ORGANIC, lyDo: "Lượt thứ hai đổi nguồn" }),
    ]);
    const thang = kq.filter((r) => r.ok);
    expect(thang.length).toBeGreaterThanOrEqual(1);
    for (const r of kq.filter((x) => !x.ok)) expect(r).toMatchObject({ truong: "nguonVuaDoi" });
    expect(await demAudit(leadA)).toBe(thang.length);
    // Chuỗi audit liền mạch: lượt đầu thấy nhóm gốc; lượt sau (nếu có) thấy ĐÚNG nhóm lượt đầu để lại — không ai ghi đè lặng lẽ.
    const logs = await db.auditLog.findMany({ where: { entityType: "Lead", entityId: leadA, module: "nguon-hoa-hong" } });
    const nhomCua = (v: unknown) => (v as { nhom: string }).nhom;
    const dau = logs.find((a) => nhomCua(a.oldValues) === "PAID_ADS");
    expect(dau).toBeDefined();
    const sau = logs.find((a) => a !== dau);
    if (sau) expect(nhomCua(sau.oldValues)).toBe(nhomCua(dau!.newValues));
    expect((await attr(leadA)).group.code).toBe(nhomCua((sau ?? dau)!.newValues));
  }, CASE);

  it("[NHH-SRC-23y2] lượt đổi bị CHEN NGANG (khoá dòng thật): người khác đã giữ + sửa dòng quy nguồn sau khi ta đọc ⇒ ta THUA có chủ đích: 'nguồn vừa đổi', 0 AuditLog, nhóm không đổi", async () => {
    // Dựng đúng thứ [23y] hy vọng xảy ra nhưng không ép được: một giao dịch KHÁC mở trước, sửa dòng (đổi updatedAt), GIỮ khoá;
    // lượt của ta đọc bản CŨ (chưa commit), rồi `updateMany ... WHERE updatedAt = <bản cũ>` chờ khoá; khi kia commit, điều kiện
    // không còn đúng ⇒ 0 dòng ⇒ NGUON_VUA_DOI. Cấy bỏ khoá lạc quan thì lượt của ta thắng và ghi đè lặng lẽ ⇒ ca này đỏ.
    let nha!: () => void;
    const cong = new Promise<void>((r) => {
      nha = r;
    });
    let giu!: () => void;
    const daGiu = new Promise<void>((r) => {
      giu = r;
    });
    const chen = db.$transaction(
      async (tx) => {
        await tx.leadAttribution.update({ where: { leadId: leadA }, data: { reasonText: "một lượt khác chen ngang" } });
        giu();
        await cong;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    await daGiu;
    const lanCuaTa = doi({ leadId: leadA, groupId: nhom.WALK_IN, lyDo: "Lượt của ta đổi nguồn" });
    // Chờ tới khi lượt của ta THẬT SỰ bị chặn ở khoá (không dùng sleep cố định).
    const t0 = Date.now();
    for (;;) {
      const [{ n }] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (n >= 1) break;
      if (Date.now() - t0 > 20_000) throw new Error("lượt đổi không bị chặn ở khoá dòng — dàn dựng sai");
      await new Promise((r) => setTimeout(r, 25));
    }
    nha();
    await chen;
    expect(await lanCuaTa).toMatchObject({ ok: false, truong: "nguonVuaDoi" });
    expect(await demAudit(leadA)).toBe(0);
    const sau = await attr(leadA);
    expect(sau.group.code).toBe("PAID_ADS");
    expect(sau.reasonText).toBe("một lượt khác chen ngang"); // thay đổi của người đi trước KHÔNG bị nuốt
  }, CASE);

  // ── Cách ly cơ sở: cả GHI lẫn ĐỌC ──────────────────────────────────────────────────────────
  it("[NCL-05] actor cơ sở B đổi nguồn lead của cơ sở A ⇒ TỪ CHỐI như 'không tồn tại': 0 dòng đổi, 0 AuditLog, câu lỗi KHÔNG lộ nhóm/người; actor A đổi được cùng lead", async () => {
    const emp = await dungSale("CL");
    const r = await doi({
      leadId: leadA,
      actor: actorCoSo("u-b", [cB]),
      groupId: nhom.EMPLOYEE_REFERRAL,
      thamChieu: { employeeId: emp, parentUserId: null, studentId: null, affiliateId: null },
    });
    expect(r).toMatchObject({ ok: false, truong: "lead" });
    const loi = (r as { loi: string }).loi;
    expect(loi).not.toMatch(/PAID_ADS|Quảng cáo|EMPLOYEE_REFERRAL|Sale\/TVV|NDOI_|E[0-9a-z]{20}/i);
    expect((await attr(leadA)).group.code).toBe("PAID_ADS");
    expect(await demAudit(leadA)).toBe(0);
    // Đối chứng dương.
    expect((await doi({ leadId: leadA, actor: actorCoSo("u-a", [cA]) })).ok).toBe(true);
  }, CASE);

  it("[NCL-06] đọc nguồn của lead: actor B ⇒ null (kể cả IDOR theo id), actor A ⇒ có; đối chứng cả hai chiều", async () => {
    const leadB = await dungLead({ ten: "B", centerId: cB, groupId: nhom.PARENT_REFERRAL });
    expect(await docNguonLead(actorCoSo("u-b", [cB]), leadA)).toBeNull();
    expect((await docNguonLead(actorCoSo("u-a", [cA]), leadA))?.nhom.code).toBe("PAID_ADS");
    expect(await docNguonLead(actorCoSo("u-a", [cA]), leadB)).toBeNull();
    expect((await docNguonLead(actorCoSo("u-b", [cB]), leadB))?.nhom.code).toBe("PARENT_REFERRAL");
    // Id không tồn tại cũng null (không phân biệt 'không có' và 'không được xem').
    expect(await docNguonLead(actorCoSo("u-a", [cA]), "khong-co-id")).toBeNull();
  }, CASE);

  it("[NCL-07] hàng chờ nguồn (MANUAL_REVIEW): mỗi actor CHỈ thấy hàng của cơ sở mình; đối chứng dương cả hai chiều; lọc theo lý do", async () => {
    const xt = (r: string[]) => ({ duongVao: "nhap-tay", coXemTay: true, xemTay: r });
    const hA = await dungLead({ ten: "HA", signals: xt(["NHAN_CHOT_THEO_PHIEU"]) });
    const hB = await dungLead({ ten: "HB", centerId: cB, signals: xt(["THIEU_NGUOI"]) });
    await dungLead({ ten: "BinhThuong" }); // không xem tay

    const a = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 50, lyDo: null, sauLeadId: null });
    expect(a.hang.map((h) => h.leadId)).toEqual([hA]);
    expect(a.tong).toBe(1);
    const b = await docHangChoNguon(actorCoSo("u-b", [cB]), { gioiHan: 50, lyDo: null, sauLeadId: null });
    expect(b.hang.map((h) => h.leadId)).toEqual([hB]);
    expect(b.hang[0]!.lyDo).toEqual(["THIEU_NGUOI"]);
    // Lọc theo lý do.
    const loc = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 50, lyDo: "THIEU_NGUOI", sauLeadId: null });
    expect(loc.hang).toHaveLength(0);
    expect(loc.tong).toBe(0);
  }, CASE);

  it("[NCL-08] KHÔNG có hàm đọc nào nhận id của bảng con làm khoá: chữ ký doc-nguon.ts chỉ nhận leadId; không export hàm findByAttributionId", async () => {
    const m = await import("../../lib/nguon/doc-nguon");
    expect(Object.keys(m).sort()).toEqual(["docHangChoNguon", "docNguonLead"]);
    expect(m.docNguonLead.length).toBe(2); // (actor, leadId)
  }, CASE);

  it("[NHH-SRC-H21-Q] ca MANUAL_REVIEW của H21 xuất hiện trong hàng chờ; sau khi người quyết (đổi nguồn) thì RỜI hàng chờ", async () => {
    const h = await dungLead({ ten: "H21", groupId: nhom.OTHER, signals: { duongVao: "nhap-tay", nhanGoc: "Nhập tay", coXemTay: true, xemTay: ["NHAN_CHOT_THEO_PHIEU"] } });
    const ds = () => docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 50, lyDo: "NHAN_CHOT_THEO_PHIEU", sauLeadId: null });
    expect((await ds()).hang.map((x) => x.leadId)).toEqual([h]);
    expect((await doi({ leadId: h, groupId: nhom.WALK_IN })).ok).toBe(true);
    expect((await ds()).hang).toHaveLength(0);
  }, CASE);
  it("[NHH-SRC-H21-Q2] cờ nguon.manualReview TẮT ⇒ hàng chờ RỖNG và bat=false (giao diện nói \"chưa bật\", không phải \"không có gì\"); cờ xem tay VẪN được ghi; BẬT lại ⇒ thấy", async () => {
    const h = await dungLead({ ten: "Q2", signals: { duongVao: "nhap-tay", coXemTay: true, xemTay: ["THIEU_NGUOI"] } });
    await datCoNguon({ enabled: true, manualReview: false });
    const tat = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 50, lyDo: null, sauLeadId: null });
    expect(tat).toEqual({ bat: false, tong: 0, hang: [] });
    expect((await attr(h)).signals).toMatchObject({ coXemTay: true }); // dữ liệu KHÔNG mất khi tắt cờ
    await datCoNguon(CO_NGUON_DAY_DU);
    const bat = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 50, lyDo: null, sauLeadId: null });
    expect(bat.bat).toBe(true);
    expect(bat.hang.map((x) => x.leadId)).toEqual([h]);
  }, CASE);

  // ── Lưới siết sau lượt cấy lỗi (luật 14): mỗi ca ghi rõ phép cấy từng cho 0 ca đỏ ─────────────────────────────

  async function dungDonVaPayment(leadId: string, p: { accountantStatus: "PENDING" | "CONFIRMED" | "REJECTED"; deletedAt?: Date | null }) {
    const o = await db.order.create({
      data: { code: `ORD-NDOI-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId },
      select: { id: true },
    });
    await db.payment.create({
      data: { orderId: o.id, amount: 1_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: p.accountantStatus, deletedAt: p.deletedAt ?? null },
    });
  }

  it("[NHH-SRC-17c] CHỈ tiền THẬT (CONFIRMED/REFUNDED, chưa xoá) mới biến lượt đổi thành 'sau thực thu': khoản PENDING · REJECTED · đã xoá mềm ⇒ vẫn là đổi TRƯỚC thực thu", async () => {
    // Cấy `...WHERE_THUC_THU` bỏ khỏi `payment.count`: mọi Payment (kể cả bị kế toán từ chối) đều khoá lead vào luật 'sau thực thu'
    // — người có `leads:overwrite` bị từ chối oan, và event đổi sau thanh toán phát cho khoản tiền không tồn tại.
    const ket = [
      { accountantStatus: "PENDING" as const },
      { accountantStatus: "REJECTED" as const },
      { accountantStatus: "CONFIRMED" as const, deletedAt: new Date("2026-09-02T00:00:00.000Z") },
    ];
    for (const [i, p] of ket.entries()) {
      const lead = await dungLead({ ten: `ChuaThu${i}` });
      await dungDonVaPayment(lead, p);
      const r = await doi({ leadId: lead, kiemQuyen: CO_DE });
      expect(r, JSON.stringify(p)).toMatchObject({ ok: true, canDieuChinh: false, action: "DOI_NGUON" });
      expect(await db.domainEvent.count({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead}:` } } })).toBe(0);
    }
    // Đối chứng dương: cùng khung nhưng khoản CONFIRMED chưa xoá ⇒ phải là 'sau thực thu' (chỉ leads:overwrite thì bị từ chối).
    const that = await dungLead({ ten: "DaThuThat" });
    await dungDonVaPayment(that, { accountantStatus: "CONFIRMED" });
    expect(await doi({ leadId: that, kiemQuyen: CO_DE })).toMatchObject({ ok: false, truong: "quyen" });
  }, CASE);

  it("[NHH-SRC-17d] đổi sau thực thu HAI lần ⇒ HAI sự kiện riêng (dedupeKey theo PHIÊN BẢN attribution), không nuốt lượt sau", async () => {
    // Cấy bỏ `cu.updatedAt` khỏi dedupeKey: lượt đổi thứ hai của cùng lead bị `dedupeKey` chặn ⇒ engine hoa hồng không bao giờ biết
    // nguồn đã đổi lần nữa, hoa hồng tính theo nguồn cũ.
    const lead = await dungLead({ ten: "HaiLan" });
    await dungDonVaPayment(lead, { accountantStatus: "CONFIRMED" });
    expect((await doi({ leadId: lead, kiemQuyen: CO_SAU, groupId: nhom.WALK_IN, lyDo: "Lần một đổi sau thu" })).ok).toBe(true);
    expect((await doi({ leadId: lead, kiemQuyen: CO_SAU, groupId: nhom.CENTER_ORGANIC, lyDo: "Lần hai đổi sau thu" })).ok).toBe(true);
    const ev = await db.domainEvent.findMany({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead}:` } } });
    expect(ev).toHaveLength(2);
    const denNhom = ev.map((e) => (e.payloadJson as { denNhom: string }).denNhom).sort();
    expect(denNhom).toEqual(["CENTER_ORGANIC", "WALK_IN"]);
    await db.domainEvent.deleteMany({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead}:` } } });
  }, CASE);

  it("[NHH-SRC-17e] người thấy lead nhưng KHÔNG có quyền nguồn nào ⇒ từ chối và KHÔNG ghi touchpoint DOI_NGUON_BI_CHAN (không bơm sổ vô hạn)", async () => {
    // Cấy bỏ vế quyền khỏi cổng ghi touchpoint: ai thấy lead cũng ghi được dòng LeadTouchpoint không giới hạn qua action đổi nguồn.
    const lead = await dungLead({ ten: "KhongQuyen" });
    await dungDonDaThu(lead);
    const kq = await doi({ leadId: lead, kiemQuyen: quyen() });
    expect(kq).toMatchObject({ ok: false, truong: "quyen" });
    expect(await db.leadTouchpoint.count({ where: { leadId: lead } })).toBe(0);
    // Đối chứng dương: có leads:overwrite mà thiếu quyền sau thu ⇒ vẫn để lại ĐÚNG MỘT dấu (xem [NHH-SRC-17]).
    expect((await doi({ leadId: lead, kiemQuyen: CO_DE })).ok).toBe(false);
    expect(await db.leadTouchpoint.count({ where: { leadId: lead, kind: "DOI_NGUON_BI_CHAN" } })).toBe(1);
  }, CASE);

  it("[NHH-SRC-16i] đổi nguồn: cảnh báo SDT_NHAN_VIEN (về KHÁCH) được GIỮ, cảnh báo NGUOI_GT_LA_KHACH (về nguồn cũ) thì BỎ", async () => {
    // Cấy `cu.canhBao.filter(...)` → `[]`: lead trùng SĐT nhân viên mất cảnh báo ngay khi có người đổi nguồn — đúng lúc cần nó nhất.
    await db.leadAttribution.update({ where: { leadId: leadA }, data: { canhBao: ["SDT_NHAN_VIEN", "NGUOI_GT_LA_KHACH"] } });
    expect((await doi({ leadId: leadA })).ok).toBe(true);
    expect((await attr(leadA)).canhBao).toEqual(["SDT_NHAN_VIEN"]);
  }, CASE);

  it("[NHH-SRC-16e2] BO_SUNG_NGUOI chỉ khi bổ sung người cho CHÍNH nhóm đó; đổi sang nhóm KHÁC (dù đang THIEU_NGUOI) vẫn là DOI_NGUON", async () => {
    // Cấy `cu.referrerMissing && cu.groupId === p.groupId` → bỏ vế nhóm: AuditLog ghi nhầm 'bổ sung người' cho một lượt đổi nguồn thật.
    const thieu = await dungLead({ ten: "ThieuDoiNhom", groupId: nhom.EMPLOYEE_REFERRAL, referrerMissing: true });
    const r = await doi({ leadId: thieu, groupId: nhom.WALK_IN });
    expect(r).toMatchObject({ ok: true, action: "DOI_NGUON" });
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "Lead", entityId: thieu, module: "nguon-hoa-hong" } });
    expect(a.action).toBe("DOI_NGUON");
    expect((await attr(thieu)).referrerMissing).toBe(false);
  }, CASE);

  it("[NHH-SRC-16j] giải trình chỉ được LƯU khi nhóm mới yêu cầu (nhóm 11); nhóm không yêu cầu ⇒ otherSourceNote = null dù người gửi có điền", async () => {
    // Cấy `requiresNote ? giaiTrinh : null` → luôn lưu: một ô điền thừa ở form bị ghi vào cột chỉ dành cho nhóm 'Nguồn khác'.
    const gt = "  Khách đến từ một hội chợ giáo dục  ";
    expect((await doi({ leadId: leadA, groupId: nhom.WALK_IN, giaiTrinh: gt })).ok).toBe(true);
    expect((await attr(leadA)).otherSourceNote).toBeNull();
    expect((await doi({ leadId: leadA, groupId: nhom.OTHER, giaiTrinh: gt, lyDo: "Đổi sang nhóm khác có giải trình" })).ok).toBe(true);
    expect((await attr(leadA)).otherSourceNote).toBe("Khách đến từ một hội chợ giáo dục"); // đã trim
  }, CASE);

  it("[NHH-SRC-16k] quyền hỏi THEO ĐỐI TƯỢNG: cả ba khoá nhận {centerId, orgUnitId} của CHÍNH lead; quyền chỉ cấp cho cơ sở A thì lead cơ sở B bị từ chối", async () => {
    // Cấy `target = { centerId: null, orgUnitId: null }`: mọi câu hỏi quyền thành 'toàn cục' — người chỉ có quyền ở cơ sở A hoặc
    // bị từ chối oan (fail-closed) hoặc, với can() đời sau mở nghĩa null = mọi cơ sở, đổi được nguồn của cơ sở khác.
    const goi: { action: string; target: { centerId: string | null; orgUnitId: string | null } }[] = [];
    const ghi: KiemQuyen = async (action, target) => {
      goi.push({ action, target });
      return action === "leads:overwrite";
    };
    expect((await doi({ leadId: leadA, kiemQuyen: ghi })).ok).toBe(true);
    const dong = await db.lead.findUniqueOrThrow({ where: { id: leadA }, select: { centerId: true, orgUnitId: true } });
    expect(dong.centerId).toBe(cA);
    expect(goi.map((g) => g.action).sort()).toEqual(["leads:overwrite", "sources:manage", "sources:override-after-payment"]);
    for (const g of goi) expect(g.target).toEqual({ centerId: dong.centerId, orgUnitId: dong.orgUnitId });

    const chiCoSoA: KiemQuyen = async (action, target) => action === "leads:overwrite" && target.centerId === cA;
    const leadB = await dungLead({ ten: "CoSoB", centerId: cB });
    const actorHaiCoSo = actorCoSo("u-ab", [cA, cB]);
    expect((await doi({ leadId: leadA, kiemQuyen: chiCoSoA, actor: actorHaiCoSo, groupId: nhom.CENTER_ORGANIC })).ok).toBe(true);
    expect(await doi({ leadId: leadB, kiemQuyen: chiCoSoA, actor: actorHaiCoSo })).toMatchObject({ ok: false, truong: "quyen" });
    expect((await attr(leadB)).group.code).toBe("PAID_ADS");
  }, CASE);

  it("[NCL-07b] hàng chờ nguồn: lead đã XOÁ MỀM không còn nằm trong hàng chờ; giới hạn trang bị chặn ở 200 và sàn 1; con trỏ không lặp", async () => {
    // Cấy bỏ `deletedAt: null` / bỏ trần 200: hàng chờ hiện lead đã xoá, và một lời gọi `gioiHan: 1e6` kéo cả bảng.
    const xt = { duongVao: "nhap-tay", coXemTay: true, xemTay: ["THIEU_NGUOI"] };
    const song = await dungLead({ ten: "HC-song", signals: xt });
    const xoa = await dungLead({ ten: "HC-xoa", signals: xt });
    await db.lead.update({ where: { id: xoa }, data: { deletedAt: new Date("2026-09-01T00:00:00.000Z") } });
    const r = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 50, lyDo: null, sauLeadId: null });
    expect(r.hang.map((h) => h.leadId)).toEqual([song]);
    expect(r.tong).toBe(1);

    // Trần: dựng 204 lead xem tay nữa (tổng 205) bằng hai câu createMany.
    const N = 204;
    const idHc = (i: number) => `ndoi-hc-${String(i).padStart(3, "0")}`;
    await db.lead.createMany({
      data: Array.from({ length: N }, (_, i) => ({ id: idHc(i), parentName: `${P}HC-${i}`, phone: `0909${String(100000 + i)}`, status: "MOI" as const, centerId: cA })),
    });
    await db.leadAttribution.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        leadId: idHc(i),
        groupId: nhom.PAID_ADS,
        originalGroupId: nhom.PAID_ADS,
        identificationMethod: "SYSTEM_DEFAULT" as const,
        matchedRule: "DUONG_VAO_MAC_DINH",
        reasonText: "ca test",
        signals: xt,
      })),
    });
    const lon = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 1_000_000, lyDo: null, sauLeadId: null });
    expect(lon.tong).toBe(N + 1);
    expect(lon.hang).toHaveLength(200);
    const nho = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 0, lyDo: null, sauLeadId: null });
    expect(nho.hang).toHaveLength(1);
    // Con trỏ: trang kế tiếp bắt đầu SAU lead cuối của trang trước, không lặp.
    const t1 = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 100, lyDo: null, sauLeadId: null });
    const t2 = await docHangChoNguon(actorCoSo("u-a", [cA]), { gioiHan: 100, lyDo: null, sauLeadId: t1.hang[99]!.leadId });
    expect(t2.hang).toHaveLength(100);
    expect(new Set([...t1.hang, ...t2.hang].map((h) => h.leadId)).size).toBe(200);
  }, CASE);


  it("[NHH-SRC-16l] đổi nguồn sang một nhân sự có SĐT TRÙNG SĐT khách ⇒ vẫn đổi được (cảnh báo, không chặn) và attribution mang cả SDT_NHAN_VIEN lẫn NGUOI_GT_LA_KHACH", async () => {
    // Cấy `sdtNguoiGioiThieu: nguoiMoiEmp?.phone ?? null` → `null` (hoặc bỏ `sdtKhach`): hai cảnh báo gian lận mất ở đường ĐỔI NGUỒN,
    // trong khi đường TẠO lead vẫn có — người đổi nguồn tự đặt người thân/chính mình làm người giới thiệu mà hàng chờ không thấy gì.
    const lead = await dungLead({ ten: "TrungSdt" });
    const phone = (await db.lead.findUniqueOrThrow({ where: { id: lead }, select: { phone: true } })).phone!;
    const nv = await db.employee.create({
      data: { employeeCode: `${P}NVTRUNG`, fullName: `${P}Sale trùng`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: cA, isActive: true, phone },
      select: { id: true },
    });
    const r = await doi({
      leadId: lead,
      groupId: nhom.EMPLOYEE_REFERRAL,
      thamChieu: { employeeId: nv.id, parentUserId: null, studentId: null, affiliateId: null },
    });
    expect(r.ok).toBe(true);
    expect([...(await attr(lead)).canhBao].sort()).toEqual(["NGUOI_GT_LA_KHACH", "SDT_NHAN_VIEN"]);
    // Đối chứng âm: nhân sự KHÁC SĐT, lead KHÁC SĐT ⇒ không cảnh báo nào.
    const sach = await dungLead({ ten: "KhongTrung" });
    const nv2 = await dungSale("KT");
    expect((await doi({ leadId: sach, groupId: nhom.EMPLOYEE_REFERRAL, thamChieu: { employeeId: nv2, parentUserId: null, studentId: null, affiliateId: null } })).ok).toBe(true);
    expect((await attr(sach)).canhBao).toEqual([]);
  }, CASE);

});
