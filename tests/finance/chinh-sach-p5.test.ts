// tests/finance/chinh-sach-p5.test.ts — PR5: CHÍNH SÁCH HỌC BÙ MIỄN PHÍ · KEEP_LATEST · GHI DANH TREO CHỜ QUYỀN HỌC · DUYỆT HỌC VƯỢT KHI VƯỢT TRẦN, trên POSTGRES THẬT.
// Mã ca: [P5-DB-xx].
//
// Chạy:  DATABASE_URL=…/satarobo_test_p5 DIRECT_URL=$DATABASE_URL TEST_DATABASE_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/chinh-sach-p5.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng đơn + lớp của mình (chạy MỘT MÌNH vẫn xanh — luật 18). Đồng hồ truyền vào (luật 19).
// Số tiền lẻ nghìn, không tròn triệu. Người dùng giả = `Actor` dựng tay (quyền là DỮ LIỆU của actor).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Spy BỌC hàm thật (vẫn chạy thật): ca [P5-DB-33] đo xem bước kích hoạt ghi danh có đồng bộ nhóm chat ĐÚNG LỚP không.
vi.mock("@/lib/chat/sync-membership", async (goc) => {
  const m = await goc<typeof import("@/lib/chat/sync-membership")>();
  return { ...m, syncConversationMembership: vi.fn(m.syncConversationMembership) };
});
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";
import { xetXepLopChoDon } from "@/lib/entitlements/xep-lop-tu-don";
import { ghiNhanBaiTrongTx, huyGhiNhanBaiTrongTx, xepLopTrongTx } from "@/lib/entitlements/dich-vu";
import { CAU_HINH_PHAM_VI_MAC_DINH } from "@/lib/entitlements/pham-vi-hoc";
import { docDeXuat } from "@/lib/entitlements/hoc-vuot-duyet";
import { docDaQuyet } from "@/lib/entitlements/da-quyet";
import * as syncChat from "@/lib/chat/sync-membership";
import { can } from "@/lib/auth/can";
import { resolveActorUncached } from "@/lib/auth/actor";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { demDangMo, docHangDoi } from "@/lib/entitlements/hang-doi/doc-hang-doi";
import { chayDoiSoatQuyenHoc } from "@/lib/entitlements/hang-doi/doi-soat";
import { dongDongHangDoi, duyetHocVuot, type KetQuaHanhDong } from "@/lib/entitlements/hang-doi/hanh-dong";
import { convertLeadV2 } from "@/lib/crm/convert-lead-v2";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { veMetadataConLead } from "@/lib/orders/hoc-vien-dong-don";

if (!RUN_DB_TESTS) console.warn(`[P5-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const T = "fx-p5-";
const KHOA = `${T}khoa`;
const KHOA_2 = `${T}khoa-2`;
const KE_TOAN = `${T}ke-toan`;
const SDT = "0905123456";
const GIA48 = 10_560_000;
/** Giữa trưa VN chủ nhật 11/10/2026 (03:00Z). Mốc "đầu ngày VN" = 10/10 17:00Z. */
const NOW = new Date("2026-10-11T03:00:00Z");
const NGAY = 24 * 60 * 60 * 1000;
const DA_XAC_NHAN = "CONFIRMED" as const;
const NGUOI_TEST = { id: null, name: "Hệ thống — test P5" };

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: NOW,
  coKeHoachDot: false,
};
const GIA_THEO_MOC: Record<number, number> = { 12: 2_640_000, 24: 5_016_000, 48: 8_976_000 };

function metadataScope(soBuoi: 12 | 24 | 48, courseId: string, leadChildId: string | null): { md: Record<string, unknown>; tien: number } {
  const tien = GIA_THEO_MOC[soBuoi]!;
  const dongVao: DongVao = {
    loai: "COURSE_ENROLLMENT",
    tenDong: "Sata 3",
    soLuong: 1,
    donGiaKhach: tien,
    soKhoanGiam: 0,
    laLopNhom: true,
    tongSoBuoiKhoa: 48,
    soBuoiMua: soBuoi,
    gia48: GIA48,
    conKhoa: "con-a",
  };
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId, soBuoi }, courseId);
  if (kq.kieu !== "SCOPE" || !md) throw new Error(`fixture: planner không ra SCOPE cho ${soBuoi} buổi`);
  expect(docPhamViDong(md)?.thanhTien).toBe(tien);
  return { md: veMetadataConLead(md, leadChildId) ?? md, tien };
}

let CS1 = "";
let OU1 = "";
let CS2 = "";
let dem = 0;

interface LopFx {
  id: string;
  courseId?: string;
  daDay: number;
  conLai?: number;
}
const ngayDaDay = (daDay: number, i: number) => new Date(NOW.getTime() - (daDay - i + 1) * NGAY);
const ngaySapToi = (j: number) => new Date(NOW.getTime() + (j + 1) * NGAY);

async function dungLop(l: LopFx): Promise<void> {
  await db.class.create({ data: { id: l.id, name: `${T}${l.id}`, courseId: l.courseId ?? KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
  const tong = l.daDay + (l.conLai ?? 12);
  for (let i = 0; i < tong; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${l.id}-p${i}`, classId: l.id, seq: i + 1, order: i } });
    const quaRoi = i < l.daDay;
    await db.classSession.create({
      data: { id: `${l.id}-s${i}`, classId: l.id, centerId: CS1, planId: plan.id, date: quaRoi ? ngayDaDay(l.daDay, i) : ngaySapToi(i - l.daDay), status: quaRoi ? "COMPLETED" : "SCHEDULED" },
    });
  }
}

interface DongFx {
  id: string;
  soBuoi?: 12 | 24 | 48;
  courseId?: string;
  studentId?: string | null;
  enrollmentId?: string | null;
  leadChildId?: string | null;
}
async function dungDon(id: string, dong: DongFx[], o: { leadId?: string | null } = {}): Promise<number[]> {
  const mds = dong.map((d) => metadataScope(d.soBuoi ?? 48, d.courseId ?? KHOA, d.leadChildId ?? null));
  const tong = mds.reduce((s, m) => s + m.tien, 0);
  await db.order.create({
    data: { id, code: `ORD-2699-P5-${++dem}-${id.slice(-6)}`, type: "COURSE", status: "PENDING_PAYMENT", customerName: `${T}khach`, customerPhone: SDT, totalAmount: tong, subtotal: tong, centerId: CS1, leadId: o.leadId ?? null },
  });
  for (const [i, d] of dong.entries()) {
    await db.orderItem.create({
      data: {
        id: d.id,
        orderId: id,
        type: "COURSE_ENROLLMENT",
        itemName: "Sata 3",
        quantity: 1,
        unitPrice: mds[i]!.tien,
        totalPrice: mds[i]!.tien,
        discountAmount: 0,
        studentId: d.studentId === undefined ? null : d.studentId,
        enrollmentId: d.enrollmentId ?? null,
        status: "ACTIVE",
        metadata: mds[i]!.md as Prisma.InputJsonValue,
      },
    });
  }
  return mds.map((m) => m.tien);
}
const thu = (orderId: string, orderItemId: string, amount: number) =>
  db.payment.create({ data: { orderId, orderItemId, amount, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: DA_XAC_NHAN, centerId: CS1 } });

async function dungHocVien(id: string, ten: string): Promise<string> {
  await db.student.create({ data: { id, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE" } });
  return id;
}
async function ghiDanh(id: string, studentId: string, classId: string, o: { courseId?: string; leadChildId?: string | null; status?: "STUDYING" | "PENDING" } = {}) {
  await db.enrollment.create({ data: { id, studentId, classId, courseId: o.courseId ?? KHOA, centerId: CS1, status: o.status ?? "STUDYING", leadChildId: o.leadChildId ?? null } });
  return id;
}

async function datCo(orgUnitId: string, bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}
async function datTran(orgUnitId: string, tran: number | null) {
  const key = "enrollment.catchUpMaxSessions";
  if (tran === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key } });
  else await db.centerSetting.upsert({ where: { orgUnitId_key: { orgUnitId, key } }, create: { orgUnitId, key, valueJson: tran }, update: { valueJson: tran } });
  clearSettingsCache();
}
async function datChinhSach(v: "DROP_ALL" | "KEEP_LATEST" | null) {
  const key = "enrollment.catchUpOverCapPolicy";
  if (v === null) await db.systemSetting.deleteMany({ where: { key } });
  else await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
  clearSettingsCache();
}

async function donDep() {
  const don = await db.order.findMany({ where: { id: { startsWith: T } }, select: { id: true } });
  const ids = don.map((d) => d.id);
  await db.studyEntitlementXuLy.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { orderId: { startsWith: T } }] } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.auditLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: "Hệ thống — " } }, { actorId: { startsWith: T } }, { entityType: "Order", entityId: { in: ids } }, { entityType: "StudyEntitlementXuLy" }] },
  });
  await db.makeupNeed.deleteMany({ where: { OR: [{ studentId: { startsWith: T } }, { classId: { startsWith: T } }] } });
  await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  const gdIds = (await db.enrollment.findMany({ where: { OR: [{ id: { startsWith: T } }, { classId: { startsWith: T } }] }, select: { id: true } })).map((g) => g.id);
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: gdIds } } });
  await db.enrollment.deleteMany({ where: { id: { in: gdIds } } });
  const hvConvert = await db.student.findMany({ where: { OR: [{ id: { startsWith: T } }, { name: { startsWith: T } }] }, select: { id: true, parentUserId: true } });
  const hvIds = hvConvert.map((h) => h.id);
  await db.studentConsent.deleteMany({ where: { studentId: { in: hvIds } } });
  await db.auditLog.deleteMany({ where: { entityType: "Student", entityId: { in: hvIds } } });
  await db.student.deleteMany({ where: { id: { in: hvIds } } });
  await db.user.deleteMany({ where: { id: { in: hvConvert.map((h) => h.parentUserId).filter((x): x is string => Boolean(x)) }, name: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: { startsWith: T } } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: T } } });
  const rbUsers = (await db.user.findMany({ where: { email: { startsWith: `${T}rb-` } }, select: { id: true } })).map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: rbUsers } } });
  await db.user.deleteMany({ where: { id: { in: rbUsers } } });
  await db.idempotencyKey.deleteMany({ where: { key: { startsWith: T } } });
}

const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const choCua = (orderId: string, loai: "CHO_XEP_LOP" | "CHO_CHUYEN_DOI" | "CHO_DUYET_HOC_VUOT" = "CHO_XEP_LOP") => db.studyEntitlementXuLy.findMany({ where: { orderId, loai }, orderBy: { createdAt: "asc" } });
const nhuCauBu = (studentId: string) => db.makeupNeed.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } });
const demUsage = (entitlementId: string) => db.studyEntitlementUsage.count({ where: { entitlementId } });
const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const demHang = async () => ({
  quyen: await db.studyEntitlement.count(),
  cho: await db.studyEntitlementXuLy.count(),
  nhuCau: await db.makeupNeed.count(),
  usage: await db.studyEntitlementUsage.count(),
  audit: await db.auditLog.count({ where: { module: "entitlements" } }),
  ghiDanh: await db.enrollmentAuditLog.count(),
});
const CO_CS1 = () => ({ centerId: CS1, bat: true });

/** Một dòng đơn: lớp + học viên + ghi danh (gắn thẳng vào dòng đơn) + đơn + tiền đủ. */
async function dungDayDu(tenCa: string, o: { soBuoi?: 12 | 24 | 48; daDay: number; conLai?: number; chuaDuTien?: boolean }) {
  const lop = `${T}lop-${tenCa}`;
  await dungLop({ id: lop, daDay: o.daDay, conLai: o.conLai });
  const hv = await dungHocVien(`${T}hv-${tenCa}`, tenCa);
  const gd = await ghiDanh(`${T}gd-${tenCa}`, hv, lop);
  const don = `${T}don-${tenCa}`;
  const item = `${T}item-${tenCa}`;
  const [tien] = await dungDon(don, [{ id: item, soBuoi: o.soBuoi ?? 48, studentId: hv, enrollmentId: gd }]);
  if (!o.chuaDuTien) await thu(don, item, tien!);
  return { lop, hv, gd, don, item, tien: tien! };
}

// ── Actor dựng tay ─────────────────────────────────────────────────────────────────────────────────────────────────────
function actorLit(o: { id: string; superAdmin?: boolean; perms?: readonly string[]; centerIds?: readonly string[]; orgUnitIds?: readonly string[] }): Actor {
  const centers = [...(o.centerIds ?? [CS1])];
  const ous = [...(o.orgUnitIds ?? [OU1])];
  return {
    userId: o.id,
    isSuperAdmin: o.superAdmin ?? false,
    isHoLevel: false,
    orgRoles: [],
    permissions: (o.perms ?? []).map((action) => ({ action, scopeType: "CENTER" as const, orgUnitId: ous[0] ?? OU1, roleCode: "TEST_ROLE", centerScope: centers, orgUnitScope: ous })),
    visibleCenterIds: centers,
    visibleOrgUnitIds: ous,
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  };
}
const QLCS = () => actorLit({ id: `${T}qlcs`, perms: ["entitlements:view", "entitlements:manage"] });
const GIAM_DOC = () => actorLit({ id: `${T}giam-doc`, perms: ["entitlements:view", "entitlements:manage", "entitlements:approve-exception"] });
const CSKH = () => actorLit({ id: `${T}cskh`, perms: ["entitlements:view"] });
const KHONG_QUYEN = () => actorLit({ id: `${T}khong`, perms: [] });
const vao = (actor: Actor, dongId: string, lyDo = "Lý do xử lý đủ dài để qua cổng") => ({ actor, nguoi: { id: actor.userId, name: `Người ${actor.userId}` }, dongId, lyDo, now: NOW });
const loiMa = (k: KetQuaHanhDong) => (k.ok ? null : k.ma);

describe.skipIf(!RUN_DB_TESTS)("[P5-DB] chính sách học bù miễn phí · KEEP_LATEST · ghi danh treo · duyệt học vượt — Postgres THẬT", () => {
  beforeAll(async () => {
    // `convertLeadV2` tự đọc đồng hồ thật cho lượt hích sau commit — đóng băng CHỈ `Date` ở NOW (luật 19); các lời gọi khác của bộ này truyền NOW tường minh.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    CS2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const [id, ten] of [[KHOA, "Sata 3 (fixture P5)"], [KHOA_2, "Sata 4 (fixture P5)"]] as const) {
      await db.course.upsert({ where: { id }, create: { id, name: ten, slug: id, price: GIA48, totalSessions: 48 }, update: { price: GIA48, totalSessions: 48 } });
    }
  });
  beforeEach(async () => {
    await donDep();
    await datCo(OU1, true);
    await datTran(OU1, null);
    await datChinhSach(null);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await donDep();
    await datCo(OU1, null);
    await datTran(OU1, null);
    await datChinhSach(null);
    await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_2] } } });
  });

  // ═══ A · FREE_MAKEUP KHÔNG TRỪ QUYỀN CHÍNH (quyết định 1) ═══════════════════════════════════════════════════════════
  it("[P5-DB-01] FREE_MAKEUP (gói trọn, lớp đã dạy 3): `freeMakeupSessions` = 3, không có dòng Usage nào, không nhu cầu học vượt, không dòng chờ", async () => {
    const c = await dungDayDu("01", { daDay: 3 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 0, freeMakeupSessions: 3, consumedSessions: 0 });
    expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "FREE_MAKEUP", freeMakeupLessons: [1, 2, 3], requiredCatchupLessons: [] });
    expect(await demUsage(q!.id)).toBe(0);
    expect(await nhuCauBu(c.hv)).toHaveLength(0);
    expect(await choCua(c.don)).toHaveLength(0);
    expect(await choCua(c.don, "CHO_DUYET_HOC_VUOT"), "FREE_MAKEUP không phải vượt trần").toHaveLength(0);
  });

  it("[P5-DB-02] ghi nhận một bài học bù MIỄN PHÍ (bài 2): kết quả HOC_BO_SUNG, sổ cái trước/sau BẰNG NHAU (0 hàng Usage), consumed vẫn 0, trạng thái vẫn ACTIVE, đúng MỘT dòng audit BONUS_LEARN", async () => {
    const c = await dungDayDu("02", { daDay: 3 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    const truoc = { usage: await db.studyEntitlementUsage.count(), tong: await demUsage(q!.id) };
    const kq = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: q!.id, lessonOrder: 2, nguon: "MAKEUP", actor: NGUOI_TEST, now: NOW }, CO_CS1()));
    expect(kq).toEqual({ ghi: false, lyDo: "HOC_BO_SUNG" });
    expect({ usage: await db.studyEntitlementUsage.count(), tong: await demUsage(q!.id) }, "FREE_MAKEUP không sinh Usage của quyền chính").toEqual(truoc);
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: q!.id } })).toMatchObject({ consumedSessions: 0, status: "ACTIVE", freeMakeupSessions: 3 });
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: q!.id, action: "BONUS_LEARN" } })).toBe(1);
    // Cùng bài nhưng nguồn khác (CATCH_UP) cũng không vào sổ; huỷ ghi nhận bài đó không có gì để huỷ.
    expect(await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: q!.id, lessonOrder: 1, nguon: "CATCH_UP", actor: NGUOI_TEST, now: NOW }, CO_CS1()))).toEqual({ ghi: false, lyDo: "HOC_BO_SUNG" });
    expect(await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: q!.id, lessonOrder: 2, lyDo: "điểm danh sửa", actor: NGUOI_TEST, now: NOW }, CO_CS1()))).toMatchObject({ daHuy: false });
    expect(await demUsage(q!.id)).toBe(0);
    // Đối chứng dương: bài 4 (bài lớp) vẫn tiêu thụ bình thường.
    const lop = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: q!.id, lessonOrder: 4, nguon: "CLASS", actor: NGUOI_TEST, now: NOW }, CO_CS1()));
    expect(lop).toMatchObject({ ghi: true, loai: "TIEU_THU", daTieuThu: 1, conLai: 44 });
    expect(await demUsage(q!.id)).toBe(1);
  });

  it("[P5-DB-03] KHÔNG KÉO DÀI 'hết quyền': đã dạy 3, học hết bài 4–48 qua lớp (45 bài) mà KHÔNG bù bài 1–3 ⇒ quyền học EXHAUSTED đúng lúc (còn lại 0), không kẹt ở 3", async () => {
    const c = await dungDayDu("03", { daDay: 3 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    let cuoi: Awaited<ReturnType<typeof ghiNhanBaiTrongTx>> | null = null;
    for (let bai = 4; bai <= 48; bai++) {
      cuoi = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: q!.id, lessonOrder: bai, nguon: "CLASS", actor: NGUOI_TEST, now: NOW }, CO_CS1()));
      if (bai < 48) expect(cuoi, `bài ${bai}`).toMatchObject({ ghi: true, trangThai: "ACTIVE" });
    }
    expect(cuoi).toMatchObject({ ghi: true, trangThai: "EXHAUSTED", daTieuThu: 45, conLai: 0 });
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: q!.id } })).toMatchObject({ status: "EXHAUSTED", consumedSessions: 45 });
    expect(await demUsage(q!.id)).toBe(45);
  });

  it("[P5-DB-04] MUA TIẾP (`truoc`): các bài lỡ cũng là học bù miễn phí — freeMakeupSessions = số bài lỡ, start nối vào bài cuối lần trước", async () => {
    const hv = await dungHocVien(`${T}hv-04`, "04");
    const q = await db.studyEntitlement.create({
      data: {
        studentId: hv,
        courseId: KHOA,
        centerId: CS1,
        orgUnitId: OU1,
        purchaseKind: "MILESTONE",
        purchaseSessions: 12,
        listAmount: 2_640_000,
        netAmount: 2_640_000,
        pricingSnapshot: {},
        status: "AWAITING_PLACEMENT",
        origin: "MANUAL",
      },
    });
    const { quyenHoc, phamVi } = await db.$transaction((tx) =>
      xepLopTrongTx(tx, { entitlementId: q.id, enrollmentId: `${T}gd-04`, classId: `${T}lop-04`, baiKeTiepCuaLop: 16, truoc: { end: 12, graceUsed: 0 }, cauHinh: CAU_HINH_PHAM_VI_MAC_DINH, baiMoiBuoiHocVuot: 3, actor: NGUOI_TEST, now: NOW }, CO_CS1()),
    );
    expect(phamVi.freeMakeupLessons).toEqual([13, 14, 15]);
    expect(quyenHoc).toMatchObject({ startLessonOrder: 13, endLessonOrder: 24, skippedSessions: 0, freeMakeupSessions: 3, status: "ACTIVE" });
    await db.studyEntitlement.delete({ where: { id: q.id } });
  });

  it("[P5-DB-05] CHECK SQL: không cùng > 0 với skippedSessions, không âm, tổng không vượt số buổi mua", async () => {
    const hv = await dungHocVien(`${T}hv-05`, "05");
    const q = await db.studyEntitlement.create({
      data: { studentId: hv, courseId: KHOA, centerId: CS1, orgUnitId: OU1, purchaseKind: "FULL", purchaseSessions: 48, listAmount: 8_976_000, netAmount: 8_976_000, pricingSnapshot: {}, origin: "MANUAL" },
    });
    await expect(db.studyEntitlement.update({ where: { id: q.id }, data: { skippedSessions: 2, freeMakeupSessions: 2 } })).rejects.toThrow(/free_makeup_chk/);
    await expect(db.studyEntitlement.update({ where: { id: q.id }, data: { freeMakeupSessions: -1 } })).rejects.toThrow(/free_makeup_chk/);
    await expect(db.studyEntitlement.update({ where: { id: q.id }, data: { freeMakeupSessions: 49 } })).rejects.toThrow(/free_makeup_chk/);
    await expect(db.studyEntitlement.update({ where: { id: q.id }, data: { freeMakeupSessions: 4 } })).resolves.toMatchObject({ freeMakeupSessions: 4 });
    await db.studyEntitlement.delete({ where: { id: q.id } });
  });

  // ═══ B · KEEP_LATEST — BIÊN ═════════════════════════════════════════════════════════════════════════════════════════
  it("[P5-DB-06] ĐÚNG TRẦN (đã dạy 6): CATCH_UP, 6 nhu cầu, KHÔNG bài bỏ qua, KHÔNG dòng xin duyệt. TRẦN+1 (đã dạy 7): bỏ bài 1, giữ 2–7, đúng MỘT dòng xin duyệt", async () => {
    const c6 = await dungDayDu("06a", { daDay: 6 });
    const c7 = await dungDayDu("06b", { daDay: 7 });
    await hichCapQuyenHocChoDon(c6.don, "KE_TOAN_XAC_NHAN", NOW);
    await hichCapQuyenHocChoDon(c7.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c6.don))[0]).toMatchObject({ skippedSessions: 0, freeMakeupSessions: 0 });
    expect((await quyenCua(c6.don))[0]!.configSnapshot).toMatchObject({ xepLop: { catchupMode: "CATCH_UP", skippedLessons: [] } }); // đúng trần KHÔNG phải vượt trần
    expect(await nhuCauBu(c6.hv)).toHaveLength(6);
    expect(await choCua(c6.don, "CHO_DUYET_HOC_VUOT"), "≤ trần ⇒ KHÔNG sinh issue").toHaveLength(0);

    const [q7] = await quyenCua(c7.don);
    expect(q7).toMatchObject({ skippedSessions: 1, freeMakeupSessions: 0 });
    expect((q7!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "OVER_CAP_SKIPPED", skippedLessons: [1], requiredCatchupLessons: r(2, 7), catchupSessions: [[2, 3, 4], [5, 6, 7]] });
    expect(await nhuCauBu(c7.hv), "vẫn đúng trần, không 7").toHaveLength(6);
    const issue = await choCua(c7.don, "CHO_DUYET_HOC_VUOT");
    expect(issue).toHaveLength(1);
    expect(issue[0]).toMatchObject({ trangThai: "OPEN", orderItemId: c7.item, entitlementId: q7!.id, studentId: c7.hv, centerId: CS1 });
    expect(docDeXuat(issue[0]!.payload)).toMatchObject({ soBaiCan: 7, tran: 6, chinhSach: "KEEP_LATEST", baiDaGiu: r(2, 7), baiBoQua: [1], baiDeXuatThem: [1], capRoRang: true, entitlementId: q7!.id, enrollmentId: c7.gd, classId: c7.lop });
    expect(issue[0]!.lyDo, "câu chữ không mang số tiền").not.toMatch(/\d\s?đ/);
  });

  it("[P5-DB-07] RẤT NHIỀU buổi (đã dạy 36): `catchupSessions` / học vượt là các bài GẦN NHẤT (31–36); 30 bài cũ bị bỏ; issue đề xuất đúng 1–30; chạy lại KHÔNG tạo dòng thứ hai", async () => {
    const c = await dungDayDu("07", { daDay: 36 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ skippedSessions: 30, startLessonOrder: 1, endLessonOrder: 48 });
    expect((q!.configSnapshot as { xepLop: { requiredCatchupLessons: number[]; catchupSessions: number[][]; skippedLessons: number[] } }).xepLop).toMatchObject({
      requiredCatchupLessons: r(31, 36),
      catchupSessions: [[31, 32, 33], [34, 35, 36]],
      skippedLessons: r(1, 30),
    });
    const nc = await nhuCauBu(c.hv);
    expect(nc.map((n) => n.missedSessionId).sort()).toEqual(r(30, 35).map((i) => `${c.lop}-s${i}`).sort()); // bài 31..36 = buổi s30..s35
    const [issue] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(docDeXuat(issue!.payload)).toMatchObject({ baiDeXuatThem: r(1, 30), baiDaGiu: r(31, 36) });
    // IDEMPOTENT: hích 3 lần + gọi thẳng hàm xét 2 lần ⇒ vẫn đúng 1 dòng, không đổi `updatedAt`.
    const truoc = await demHang();
    // `@updatedAt` do Prisma ghi bằng đồng hồ JS: nếu `Date` vẫn đóng băng ở NOW thì một lần GHI LẠI cũng ra đúng giá trị cũ và phép so `updatedAt` không bao giờ đỏ.
    // Nhích đồng hồ +1 giờ TRƯỚC các lượt chạy lại để một lần ghi thừa PHẢI lộ ra, rồi trả về NOW.
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
    try {
      for (let i = 0; i < 3; i++) await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", new Date(NOW.getTime() + (i + 1) * 3_600_000));
      for (let i = 0; i < 2; i++) await xetXepLopChoDon(c.don, "CHUYEN_DOI", new Date(NOW.getTime() + (i + 5) * 3_600_000));
    } finally {
      vi.setSystemTime(NOW);
    }
    expect(await demHang()).toEqual(truoc);
    const lai = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(lai).toHaveLength(1);
    expect(lai[0]!.updatedAt.toISOString()).toBe(issue!.updatedAt.toISOString());
  });

  it("[P5-DB-08] TRẦN THEO CƠ SỞ: trần 3 ⇒ đã dạy 5 giữ 3–5, bỏ 1–2, có issue; trần 10 ⇒ đã dạy 8 vẫn CATCH_UP đủ 8, KHÔNG issue", async () => {
    await datTran(OU1, 3);
    const a = await dungDayDu("08a", { daDay: 5 });
    await hichCapQuyenHocChoDon(a.don, "KE_TOAN_XAC_NHAN", NOW);
    const [qa] = await quyenCua(a.don);
    expect(qa).toMatchObject({ skippedSessions: 2 });
    expect((qa!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ skippedLessons: [1, 2], requiredCatchupLessons: [3, 4, 5], catchUpMaxSessions: 3 });
    expect(docDeXuat((await choCua(a.don, "CHO_DUYET_HOC_VUOT"))[0]!.payload)).toMatchObject({ tran: 3, baiDeXuatThem: [1, 2] });

    await datTran(OU1, 10);
    const b = await dungDayDu("08b", { daDay: 8 });
    await hichCapQuyenHocChoDon(b.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(b.don))[0]).toMatchObject({ skippedSessions: 0 });
    expect(await nhuCauBu(b.hv)).toHaveLength(8);
    expect(await choCua(b.don, "CHO_DUYET_HOC_VUOT")).toHaveLength(0);
  });

  it("[P5-DB-09] DROP_ALL vẫn là tuỳ chọn cấu hình và vẫn hoạt động: đã dạy 8 ⇒ bỏ cả 8, không học vượt, không nhu cầu; issue vẫn mở (đề xuất 1–8)", async () => {
    await datChinhSach("DROP_ALL");
    const c = await dungDayDu("09", { daDay: 8 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ skippedSessions: 8, status: "ACTIVE" });
    expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchUpOverCapPolicy: "DROP_ALL", requiredCatchupLessons: [], skippedLessons: r(1, 8) });
    expect(await nhuCauBu(c.hv)).toHaveLength(0);
    expect(docDeXuat((await choCua(c.don, "CHO_DUYET_HOC_VUOT"))[0]!.payload)).toMatchObject({ chinhSach: "DROP_ALL", baiDaGiu: [], baiDeXuatThem: r(1, 8) });
  });

  it("[P5-DB-10] MẶC ĐỊNH KHÔNG ĐỔI: không cài đặt nào ⇒ chính sách là KEEP_LATEST (không DROP_ALL ngầm)", async () => {
    const c = await dungDayDu("10", { daDay: 8 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]!.configSnapshot).toMatchObject({ xepLop: { catchUpOverCapPolicy: "KEEP_LATEST", requiredCatchupLessons: r(3, 8) } });
  });

  // ═══ E/F · DUYỆT HỌC VƯỢT (quyết định 5) ═══════════════════════════════════════════════════════════════════════════
  async function dungVuotTran(tenCa: string, daDay = 9) {
    const c = await dungDayDu(tenCa, { daDay });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [issue] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(issue, "fixture: phải có dòng xin duyệt").toBeDefined();
    const [q] = await quyenCua(c.don);
    return { ...c, issue: issue!, q: q! };
  }

  it("[P5-DB-11] QLCS (chỉ `manage`) KHÔNG duyệt được phần vượt trần: bị từ chối KHONG_QUYEN, không đổi gì (đếm hàng + quyền học + dòng vẫn mở)", async () => {
    const c = await dungVuotTran("11");
    const truoc = await demHang();
    const kq = await duyetHocVuot(vao(QLCS(), c.issue.id));
    expect(loiMa(kq)).toBe("KHONG_QUYEN");
    expect(await demHang()).toEqual(truoc);
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 3 });
    expect((await choCua(c.don, "CHO_DUYET_HOC_VUOT"))[0]).toMatchObject({ trangThai: "OPEN" });
    // Người chỉ XEM và người không quyền gì cũng bị chặn.
    expect(loiMa(await duyetHocVuot(vao(CSKH(), c.issue.id)))).toBe("KHONG_QUYEN");
    expect(loiMa(await duyetHocVuot(vao(KHONG_QUYEN(), c.issue.id)))).toBe("KHONG_QUYEN");
    expect(await demHang()).toEqual(truoc);
  });

  it("[P5-DB-12] QLCS ĐÓNG / TỪ CHỐI được có lý do (như mọi dòng): dòng DA_XU_LY, có quyết định của người, không đụng quyền học / nhu cầu / ghi danh; ngắn quá 10 ký tự bị chặn", async () => {
    const c = await dungVuotTran("12");
    expect(loiMa(await dongDongHangDoi(vao(QLCS(), c.issue.id, "ngắn")))).toBe("DAU_VAO");
    const truoc = { nhuCau: await db.makeupNeed.count(), q: (await quyenCua(c.don))[0]!.skippedSessions };
    const kq = await dongDongHangDoi(vao(QLCS(), c.issue.id, "Không duyệt học vượt thêm cho bé này"));
    expect(kq.ok && kq.daLam).toBe(true);
    const [sau] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(sau).toMatchObject({ trangThai: "DA_XU_LY" });
    expect(sau!.resolvedNote).toMatch(/Không duyệt học vượt thêm/);
    expect({ nhuCau: await db.makeupNeed.count(), q: (await quyenCua(c.don))[0]!.skippedSessions }).toEqual(truoc);
    // Máy chạy lại: dòng người đã đóng KHÔNG bị mở lại (quyền học đã chốt ⇒ không đánh giá lại).
    await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", NOW);
    expect((await choCua(c.don, "CHO_DUYET_HOC_VUOT"))[0]!.trangThai).toBe("DA_XU_LY");
    // Người không có quyền gì không đóng được.
    const c2 = await dungVuotTran("12b");
    expect(loiMa(await dongDongHangDoi(vao(CSKH(), c2.issue.id)))).toBe("KHONG_QUYEN");
  });

  it("[P5-DB-13] Giám đốc (approve-exception) DUYỆT: bài bị bỏ thành học vượt qua cơ chế có sẵn — skippedSessions co lại, catchupSessions dài thêm, MakeupNeed ORDER_CONVERSION; KHÔNG Usage, KHÔNG đụng OrderItem / ghi danh; audit đủ; bấm lại không nhân đôi", async () => {
    const c = await dungVuotTran("13", 9);
    const itemTruoc = await db.orderItem.findUniqueOrThrow({ where: { id: c.item }, select: { studentId: true, enrollmentId: true } });
    const gdTruoc = await db.enrollment.findUniqueOrThrow({ where: { id: c.gd }, select: { status: true, classId: true, buoiBatDau: true } });
    expect(await nhuCauBu(c.hv)).toHaveLength(6);

    const kq = await duyetHocVuot(vao(GIAM_DOC(), c.issue.id, "Đồng ý cho bé học vượt đủ 3 bài đầu"));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);

    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", skippedSessions: 0, consumedSessions: 0, startLessonOrder: 1, endLessonOrder: 48 });
    expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({
      skippedLessons: [],
      requiredCatchupLessons: r(1, 9),
      catchupSessions: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    });
    const nhat = (q!.configSnapshot as { xepLop: { duyetHocVuot: { baiThem: number[]; lyDo: string; boi: { id: string } }[] } }).xepLop.duyetHocVuot;
    expect(nhat).toHaveLength(1);
    expect(nhat[0]).toMatchObject({ baiThem: [1, 2, 3], lyDo: "Đồng ý cho bé học vượt đủ 3 bài đầu", boi: { id: `${T}giam-doc` } });
    const nc = await nhuCauBu(c.hv);
    expect(nc).toHaveLength(9);
    for (const n of nc) expect(n).toMatchObject({ sourceType: "ORDER_CONVERSION", status: "PENDING", studentId: c.hv, classId: c.lop });
    expect(nc.map((n) => n.missedSessionId).sort()).toEqual(r(0, 8).map((i) => `${c.lop}-s${i}`).sort());

    expect(await demUsage(q!.id), "duyệt KHÔNG ghi sổ cái").toBe(0);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: c.item }, select: { studentId: true, enrollmentId: true } })).toEqual(itemTruoc);
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: c.gd }, select: { status: true, classId: true, buoiBatDau: true } })).toEqual(gdTruoc);
    const [dong] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(dong).toMatchObject({ trangThai: "DA_XU_LY", entitlementId: q!.id });
    expect(dong!.resolvedNote).toMatch(/Đã duyệt học vượt thêm bài 1–3 — 3 phiếu học vượt/);
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlementXuLy", entityId: dong!.id, action: "APPROVE_EXTRA_CATCHUP", actorId: `${T}giam-doc`, reason: "Đồng ý cho bé học vượt đủ 3 bài đầu" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: q!.id, action: "EXTRA_CATCHUP_APPROVED", actorId: `${T}giam-doc` } })).toBe(1);

    // IDEMPOTENT: bấm lại ⇒ "dòng đã đóng", không nhân đôi nhu cầu, không audit thêm.
    const lai = await duyetHocVuot(vao(GIAM_DOC(), c.issue.id));
    expect(lai).toMatchObject({ ok: true, daLam: false });
    expect(await nhuCauBu(c.hv)).toHaveLength(9);
    expect(await db.auditLog.count({ where: { action: "APPROVE_EXTRA_CATCHUP", entityId: dong!.id } })).toBe(1);
  });

  it("[P5-DB-14] Admin (SUPER_ADMIN) cũng duyệt được; duyệt ĐỒNG THỜI 3 lượt ⇒ đúng MỘT lần ghi", async () => {
    const c = await dungVuotTran("14", 8);
    const admin = actorLit({ id: `${T}admin`, superAdmin: true });
    const kq = await Promise.all([1, 2, 3].map(() => duyetHocVuot(vao(admin, c.issue.id))));
    expect(kq.filter((k) => k.ok && k.daLam)).toHaveLength(1);
    expect(await nhuCauBu(c.hv)).toHaveLength(8);
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 0 });
    expect(await db.auditLog.count({ where: { action: "EXTRA_CATCHUP_APPROVED", entityId: c.q.id } })).toBe(1);
  });

  it("[P5-DB-15] CẤU HÌNH TRẦN KHÔNG RÕ (capRoRang = false) và tổng bài ≤ trần mặc định ⇒ QLCS (manage) duyệt được; tổng VƯỢT trần mặc định ⇒ vẫn cần approve-exception", async () => {
    await datTran(OU1, 3);
    const nho = await dungVuotTran("15a", 5); // giữ 3 + đề xuất 2 = 5 ≤ 6
    const lon = await dungVuotTran("15b", 9); // trần 3: giữ 3 + đề xuất 6 = 9 > 6
    for (const d of [nho, lon]) {
      const goc = d.issue.payload as { hocVuot: Record<string, unknown> };
      await db.studyEntitlementXuLy.update({ where: { id: d.issue.id }, data: { payload: { hocVuot: { ...goc.hocVuot, capRoRang: false } } as Prisma.InputJsonValue } });
    }
    expect(loiMa(await duyetHocVuot(vao(QLCS(), lon.issue.id)))).toBe("KHONG_QUYEN");
    const kq = await duyetHocVuot(vao(QLCS(), nho.issue.id));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
    expect((await quyenCua(nho.don))[0]).toMatchObject({ skippedSessions: 0 });
    // Đối chứng: cấu hình RÕ RÀNG (mặc định) thì cùng đề xuất nhỏ vẫn cần approve-exception.
    const ro = await dungVuotTran("15c", 5);
    expect(loiMa(await duyetHocVuot(vao(QLCS(), ro.issue.id)))).toBe("KHONG_QUYEN");
  });

  it("[P5-DB-16] CỜ TẮT ⇒ không sinh gì (đếm hàng trước/sau mọi bảng); và đã có dòng xin duyệt mà TẮT cờ ⇒ duyệt bị từ chối, không đổi gì", async () => {
    // (a) cờ tắt từ đầu: hích + xét không ghi gì.
    await datCo(OU1, false);
    const a = await dungDayDu("16a", { daDay: 9 });
    const truocA = await demHang();
    await hichCapQuyenHocChoDon(a.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await xetXepLopChoDon(a.don, "KE_TOAN_XAC_NHAN", NOW)).boQua).toBe("CO_TAT");
    expect(await demHang()).toEqual(truocA);
    expect(await quyenCua(a.don)).toHaveLength(0);
    // (b) có dòng rồi mới tắt cờ.
    await datCo(OU1, true);
    const b = await dungVuotTran("16b", 9);
    await datCo(OU1, false);
    const truocB = await demHang();
    const kq = await duyetHocVuot(vao(GIAM_DOC(), b.issue.id));
    expect(loiMa(kq)).toBe("KHONG_CHO_PHEP");
    expect(await demHang()).toEqual(truocB);
    expect((await quyenCua(b.don))[0]).toMatchObject({ skippedSessions: 3 });
  });

  it("[P5-DB-17] CÁCH LY CƠ SỞ: người cấp CS2 không thấy / không duyệt được dòng của CS1 (KHONG_TIM_THAY); Giám đốc ở CS2 cũng vậy", async () => {
    const c = await dungVuotTran("17", 9);
    const ou2 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    const gdCS2 = actorLit({ id: `${T}gd-cs2`, perms: ["entitlements:view", "entitlements:manage", "entitlements:approve-exception"], centerIds: [CS2], orgUnitIds: [ou2] });
    expect(loiMa(await duyetHocVuot(vao(gdCS2, c.issue.id)))).toBe("KHONG_TIM_THAY");
    expect(loiMa(await dongDongHangDoi(vao(gdCS2, c.issue.id)))).toBe("KHONG_TIM_THAY");
    const doc = await docHangDoi(gdCS2, { trangThai: ["OPEN"], loai: ["CHO_DUYET_HOC_VUOT"] }, 1, NOW);
    expect(doc.dong.filter((d) => d.id === c.issue.id)).toHaveLength(0);
  });

  it("[P5-DB-18] NÚT ≡ ACTION: trang đưa nút theo quyền — CSKH (chỉ xem) không có nút nào; QLCS có 'Đóng' nhưng KHÔNG có 'Duyệt học vượt thêm'; Giám đốc có cả hai; đếm dòng đang mở thấy loại mới", async () => {
    const c = await dungVuotTran("18", 9);
    const dong = async (a: Actor) => (await docHangDoi(a, { trangThai: ["OPEN"], loai: ["CHO_DUYET_HOC_VUOT"] }, 1, NOW)).dong.find((d) => d.id === c.issue.id)!;
    const cskh = await dong(CSKH());
    expect(cskh.hanhDong).toEqual([]);
    // Kế toán / CSKH chỉ có `view`: KHÔNG có `view-money` ⇒ cột tiền = null (chưa quyết cấp `view-money` cho vai nào ngoài Admin).
    expect({ coXemTien: cskh.coXemTien, soTien: cskh.quyenHoc?.soTien }).toEqual({ coXemTien: false, soTien: null });
    expect(cskh.deXuatHocVuot).toMatchObject({ soBaiCan: 9, tran: 6, baiDeXuatThem: "1–3", quyenCan: "APPROVE_EXCEPTION" });
    const qlcs = await dong(QLCS());
    expect(qlcs.hanhDong).toContain("DONG");
    expect(qlcs.hanhDong).not.toContain("DUYET_HOC_VUOT");
    expect(qlcs.hanhDong, "dòng do người quyết: không có 'Thử cấp lại'").not.toContain("THU_LAI");
    const gd = await dong(GIAM_DOC());
    expect(gd.hanhDong).toEqual(expect.arrayContaining(["DONG", "DUYET_HOC_VUOT"]));
    expect((await demDangMo(CSKH())).CHO_DUYET_HOC_VUOT).toBeGreaterThanOrEqual(1);
    // Nút hiện thì action phải cho: Giám đốc bấm đúng nút được hiển thị.
    expect((await duyetHocVuot(vao(GIAM_DOC(), c.issue.id))).ok).toBe(true);
    const sau = (await docHangDoi(GIAM_DOC(), { trangThai: ["DA_XU_LY"], loai: ["CHO_DUYET_HOC_VUOT"] }, 1, NOW)).dong.find((d) => d.id === c.issue.id)!;
    expect(sau.hanhDong, "đã đóng ⇒ hết nút").toEqual([]);
  });

  // ═══ C · THỨ TỰ: QUYỀN HỌC TRƯỚC, GHI DANH ACTIVE SAU (quyết định 3) — convertLeadV2 THẬT ═══════════════════════════════
  async function chotLead(tenCa: string, o: { soBuoi?: 12 | 24 | 48; scope: boolean; daDay?: number; coTien?: boolean }) {
    const lop = `${T}lop-${tenCa}`;
    await dungLop({ id: lop, daDay: o.daDay ?? 3 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-${tenCa}`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-${tenCa}` }, select: { id: true } });
    const don = `${T}don-${tenCa}`;
    const item = `${T}item-${tenCa}`;
    let tien = 5_000_000;
    if (o.scope) {
      [tien] = (await dungDon(don, [{ id: item, soBuoi: o.soBuoi ?? 12, studentId: null, leadChildId: con.id }], { leadId: lead.id })) as [number];
    } else {
      await db.order.create({ data: { id: don, code: `ORD-2699-P5-${++dem}-${tenCa}`, type: "COURSE", status: "PENDING_PAYMENT", customerName: `${T}khach`, customerPhone: SDT, totalAmount: tien, subtotal: tien, centerId: CS1, leadId: lead.id } });
      await db.orderItem.create({ data: { id: item, orderId: don, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: tien, totalPrice: tien, discountAmount: 0, status: "ACTIVE", metadata: { courseId: KHOA, soBuoi: o.soBuoi ?? 24, leadChildId: con.id } } });
    }
    if (o.coTien) await thu(don, item, tien);
    const kq = await convertLeadV2(
      { id: KE_TOAN, name: "Hệ thống — test P5" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: `${T}khach-${tenCa}`,
        parentPhone: "84905123456",
        students: [{ leadChildId: con.id, name: `${T}be-${tenCa}`, courseId: KHOA, listPrice: GIA48, classId: lop, consentMedia: false }],
        idempotencyKey: `${T}idem-${tenCa}`,
        allowNoPayment: { reason: "test P5 — không tiền" },
      },
    );
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    const gd = await db.enrollment.findFirstOrThrow({ where: { classId: lop, leadChildId: con.id } });
    return { gd, don, item, lop, tien, leadId: lead.id, conId: con.id };
  }

  it("[P5-DB-19] THIẾU QUYỀN HỌC ⇒ KHÔNG ghi danh active: cờ BẬT + dòng SCOPE, tiền CHƯA đủ ⇒ ghi danh PENDING (Chờ xếp lớp), không quyền học, hàng đợi có issue CHO_XEP_LOP nói rõ", async () => {
    const c = await chotLead("19", { scope: true, soBuoi: 12, coTien: false });
    expect(c.gd.status).toBe("PENDING");
    expect(c.gd.buoiBatDau).toBeNull();
    expect(await quyenCua(c.don)).toHaveLength(0);
    const [cho] = await choCua(c.don);
    expect(cho).toMatchObject({ trangThai: "OPEN", orderItemId: c.item });
    expect(cho!.lyDo).toMatch(/chưa có quyền học hợp lệ/);
    // Ghi danh PENDING không thuộc roster "đang học" (ENROLLMENT_ACTIVE_STATUS_LIST không chứa PENDING).
    const { ENROLLMENT_ACTIVE_STATUS_LIST } = await import("@/lib/enrollment-status");
    expect(ENROLLMENT_ACTIVE_STATUS_LIST).not.toContain(c.gd.status);
  });

  it("[P5-DB-20] CÓ QUYỀN HỌC ⇒ ghi danh active ĐÚNG buổi bắt đầu: tiền đủ + hích ⇒ quyền học ACTIVE start 4–15, ghi danh PENDING → STUDYING, buoiBatDau 4, có EnrollmentAuditLog + AuditLog, issue đóng; hích lại không ghi thêm", async () => {
    const c = await chotLead("20", { scope: true, soBuoi: 12, coTien: false });
    expect(c.gd.status).toBe("PENDING");
    await thu(c.don, c.item, c.tien);
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", enrollmentId: c.gd.id, studentId: c.gd.studentId, startLessonOrder: 4, endLessonOrder: 15 });
    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: c.gd.id } });
    expect(gd).toMatchObject({ status: "STUDYING", buoiBatDau: 4 });
    expect(gd.startedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await db.enrollmentAuditLog.findMany({ where: { enrollmentId: c.gd.id }, select: { fromStatus: true, toStatus: true, changedByUserId: true, reason: true } })).toEqual([
      { fromStatus: "PENDING", toStatus: "STUDYING", changedByUserId: null, reason: expect.stringMatching(/quyền học trước, ghi danh active sau/) },
    ]);
    expect(await db.auditLog.count({ where: { entityType: "Enrollment", entityId: c.gd.id, action: "STATUS_CHANGE", module: "enrollment" } })).toBe(1);
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "DA_XU_LY" });
    // IDEMPOTENT: hích lại, gọi hàm xét trực tiếp ⇒ không đổi gì.
    const truoc = await demHang();
    for (let i = 0; i < 3; i++) await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", new Date(NOW.getTime() + (i + 1) * 3_600_000));
    expect((await xetXepLopChoDon(c.don, "CHUYEN_DOI", NOW)).daKichHoat).toEqual([]);
    expect(await demHang()).toEqual(truoc);
  });

  it("[P5-DB-21] KÍCH HOẠT CHỈ ĐỤNG GHI DANH ĐANG PENDING: ghi danh đã STUDYING (đường thủ công) của dòng SCOPE giữ nguyên chữ qua xếp lớp; lớp CHƯA khai giảng ⇒ CONFIRMED (luật 11/10)", async () => {
    // (a) đã STUDYING: không đổi, không audit trạng thái.
    const a = await dungDayDu("21a", { soBuoi: 12, daDay: 2 });
    await hichCapQuyenHocChoDon(a.don, "KE_TOAN_XAC_NHAN", NOW);
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: a.gd } })).toMatchObject({ status: "STUDYING", buoiBatDau: 3 });
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: a.gd } })).toBe(0);
    // (b) ghi danh PENDING vào lớp chưa khai giảng (PLANNED) ⇒ sau xếp lớp là CONFIRMED "Đã xếp lớp", không STUDYING.
    const lop = `${T}lop-21b`;
    await dungLop({ id: lop, daDay: 0 });
    await db.class.update({ where: { id: lop }, data: { status: "PLANNED" } });
    const hv = await dungHocVien(`${T}hv-21b`, "21b");
    const gd = await ghiDanh(`${T}gd-21b`, hv, lop, { status: "PENDING" });
    const don = `${T}don-21b`;
    const item = `${T}item-21b`;
    const [tien] = await dungDon(don, [{ id: item, soBuoi: 12, studentId: hv, enrollmentId: gd }]);
    await thu(don, item, tien!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: gd } })).toMatchObject({ status: "CONFIRMED" });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gd } })).startedAt).toBeNull();
  });

  it("[P5-DB-22] CỜ TẮT / ĐƠN THƯỜNG ⇒ NGUYÊN CHỮ: cờ tắt ⇒ ghi danh ACTIVE (mặc định) và buoiBatDau 37; đơn thường 24 buổi cờ BẬT ⇒ ACTIVE, buoiBatDau 25; không audit trạng thái", async () => {
    await datCo(OU1, false);
    const tat = await chotLead("22a", { scope: true, soBuoi: 12 });
    expect(tat.gd).toMatchObject({ status: "ACTIVE", buoiBatDau: 37 });
    await datCo(OU1, true);
    const thuong = await chotLead("22b", { scope: false, soBuoi: 24 });
    expect(thuong.gd).toMatchObject({ status: "ACTIVE", buoiBatDau: 25 });
    expect(await choCua(thuong.don)).toHaveLength(0);
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: { in: [tat.gd.id, thuong.gd.id] } } })).toBe(0);
  });

  it("[P5-DB-23] ĐA BÉ / ĐA KHOÁ KHÔNG TRỘN: một lượt chốt hai bé — bé A dòng SCOPE (khoá 1), bé B dòng THƯỜNG (khoá 2) ⇒ A PENDING, B ACTIVE; tiền của A đủ ⇒ chỉ A được kích hoạt, B không bị đụng", async () => {
    const lopA = `${T}lop-23a`;
    const lopB = `${T}lop-23b`;
    await dungLop({ id: lopA, daDay: 2 });
    await dungLop({ id: lopB, daDay: 2, courseId: KHOA_2 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-23`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const conA = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-23a` }, select: { id: true } });
    const conB = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-23b` }, select: { id: true } });
    const don = `${T}don-23`;
    const [tienA] = await dungDon(don, [{ id: `${T}item-23a`, soBuoi: 12, courseId: KHOA, studentId: null, leadChildId: conA.id }], { leadId: lead.id });
    await db.orderItem.create({
      data: { id: `${T}item-23b`, orderId: don, type: "COURSE_ENROLLMENT", itemName: "Sata 4", quantity: 1, unitPrice: 5_000_000, totalPrice: 5_000_000, discountAmount: 0, status: "ACTIVE", metadata: { courseId: KHOA_2, soBuoi: 24, leadChildId: conB.id } },
    });
    const kq = await convertLeadV2(
      { id: KE_TOAN, name: "Hệ thống — test P5" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: `${T}khach-23`,
        parentPhone: "84905123456",
        students: [
          { leadChildId: conB.id, name: `${T}be-23b`, courseId: KHOA_2, listPrice: GIA48, classId: lopB, consentMedia: false },
          { leadChildId: conA.id, name: `${T}be-23a`, courseId: KHOA, listPrice: GIA48, classId: lopA, consentMedia: false },
        ],
        idempotencyKey: `${T}idem-23`,
        allowNoPayment: { reason: "test P5 — không tiền" },
      },
    );
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    const gdA = await db.enrollment.findFirstOrThrow({ where: { classId: lopA } });
    const gdB = await db.enrollment.findFirstOrThrow({ where: { classId: lopB } });
    expect({ a: gdA.status, b: gdB.status }).toEqual({ a: "PENDING", b: "ACTIVE" });
    expect({ a: gdA.buoiBatDau, b: gdB.buoiBatDau }).toEqual({ a: null, b: 25 });
    await thu(don, `${T}item-23a`, tienA!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gdA.id } })).status).toBe("STUDYING");
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: gdB.id } })).toMatchObject({ status: "ACTIVE", buoiBatDau: 25 });
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: gdB.id } })).toBe(0);
    expect(await quyenCua(don)).toHaveLength(1);
  });

  it("[P5-DB-25] CRON ĐỐI SOÁT chạy 2 lần với dòng xin duyệt đang mở: IDEMPOTENT (đếm hàng + updatedAt nguyên), cron ĐẾM dòng mới nhưng KHÔNG tự đóng / sửa nó, 0 đơn lỗi", async () => {
    const c = await dungVuotTran("25", 9);
    const truoc = await demHang();
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000)); // nhích đồng hồ để `@updatedAt` của một lần ghi thừa KHÔNG trùng giá trị cũ (xem [P5-DB-07])
    let bao1, bao2;
    try {
      bao1 = await chayDoiSoatQuyenHoc({ now: NOW, gioiHanDonMoiCoSo: 100 });
      bao2 = await chayDoiSoatQuyenHoc({ now: NOW, gioiHanDonMoiCoSo: 100 });
    } finally {
      vi.setSystemTime(NOW);
    }
    for (const b of [bao1, bao2]) expect({ soDonLoi: b.soDonLoi, loi: b.loi }).toEqual({ soDonLoi: 0, loi: [] });
    expect(bao2.dangMoTheoLoai.CHO_DUYET_HOC_VUOT).toBeGreaterThanOrEqual(1);
    expect(await demHang()).toEqual(truoc);
    const [sau] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(sau).toMatchObject({ trangThai: "OPEN" });
    expect(sau!.updatedAt.toISOString()).toBe(c.issue.updatedAt.toISOString());
  });

  it("[P5-DB-24] HÀNG ĐỢI KHÔNG gắn học viên / ghi danh trực tiếp: sau mọi hành động của người, OrderItem.studentId / enrollmentId KHÔNG đổi (chỉ màn Chuyển đổi/Ghi danh làm việc đó)", async () => {
    const c = await dungVuotTran("24", 9);
    await db.orderItem.update({ where: { id: c.item }, data: { studentId: c.hv, enrollmentId: c.gd } });
    const truoc = await db.orderItem.findUniqueOrThrow({ where: { id: c.item }, select: { studentId: true, enrollmentId: true } });
    await duyetHocVuot(vao(GIAM_DOC(), c.issue.id));
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: c.item }, select: { studentId: true, enrollmentId: true } })).toEqual(truoc);
  });
  // ═══ BỔ SUNG SAU LƯỢT CẤY LỖI ĐỘC LẬP (13/10/2026) — mỗi ca dưới đây khoá một LỖ mà lượt cấy 159 phép tìm ra ═══════════════════════════════════════════════
  it("[P5-DB-26] KHÔNG TRỘN BÉ CÙNG LỚP: hai bé cùng lớp, cùng khoá, đều SCOPE; chỉ bé A đủ tiền ⇒ chỉ ghi danh của A được kích hoạt, bé B vẫn PENDING", async () => {
    const lop = `${T}lop-26`;
    await dungLop({ id: lop, daDay: 2 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-26`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const conA = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-26a` }, select: { id: true } });
    const conB = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-26b` }, select: { id: true } });
    const don = `${T}don-26`;
    const [tienA] = await dungDon(
      don,
      [
        { id: `${T}item-26a`, soBuoi: 12, courseId: KHOA, studentId: null, leadChildId: conA.id },
        { id: `${T}item-26b`, soBuoi: 12, courseId: KHOA, studentId: null, leadChildId: conB.id },
      ],
      { leadId: lead.id },
    );
    const kq = await convertLeadV2(
      { id: KE_TOAN, name: "Hệ thống — test P5" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: `${T}khach-26`,
        parentPhone: "84905123456",
        students: [
          { leadChildId: conA.id, name: `${T}be-26a`, courseId: KHOA, listPrice: GIA48, classId: lop, consentMedia: false },
          { leadChildId: conB.id, name: `${T}be-26b`, courseId: KHOA, listPrice: GIA48, classId: lop, consentMedia: false },
        ],
        idempotencyKey: `${T}idem-26`,
        allowNoPayment: { reason: "test P5 — không tiền" },
      },
    );
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    const gdA = await db.enrollment.findFirstOrThrow({ where: { classId: lop, leadChildId: conA.id } });
    const gdB = await db.enrollment.findFirstOrThrow({ where: { classId: lop, leadChildId: conB.id } });
    expect({ a: gdA.status, b: gdB.status }).toEqual({ a: "PENDING", b: "PENDING" });
    await thu(don, `${T}item-26a`, tienA!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gdA.id } })).status).toBe("STUDYING");
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: gdB.id } })).toMatchObject({ status: "PENDING", buoiBatDau: null });
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: gdB.id } })).toBe(0);
  });

  it("[P5-DB-27] KHÔNG TRỘN KHOÁ CỦA CÙNG HỌC VIÊN: hai ghi danh PENDING (hai khoá) của một học viên, chỉ khoá A đủ tiền ⇒ chỉ ghi danh A được kích hoạt, khoá B còn PENDING", async () => {
    const lopA = `${T}lop-27a`;
    const lopB = `${T}lop-27b`;
    await dungLop({ id: lopA, daDay: 2 });
    await dungLop({ id: lopB, daDay: 2, courseId: KHOA_2 });
    const hv = await dungHocVien(`${T}hv-27`, "27");
    const gdA = await ghiDanh(`${T}gd-27a`, hv, lopA, { status: "PENDING" });
    const gdB = await ghiDanh(`${T}gd-27b`, hv, lopB, { courseId: KHOA_2, status: "PENDING" });
    const don = `${T}don-27`;
    const [tienA] = await dungDon(don, [
      { id: `${T}item-27a`, soBuoi: 12, courseId: KHOA, studentId: hv, enrollmentId: gdA },
      { id: `${T}item-27b`, soBuoi: 12, courseId: KHOA_2, studentId: hv, enrollmentId: gdB },
    ]);
    await thu(don, `${T}item-27a`, tienA!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gdA } })).status).toBe("STUDYING");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gdB } })).status).toBe("PENDING");
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: gdB } })).toBe(0);
  });

  it("[P5-DB-28] duyệt KHÔNG ghi OrderItem — fixture KHÔNG sẵn giá trị trùng: (a) dòng đơn CHƯA gắn học viên / ghi danh ⇒ vẫn NULL; (b) dòng đơn gắn học viên / ghi danh KHÁC ⇒ nguyên giá trị đó", async () => {
    const a = await dungVuotTran("28a", 9);
    await db.orderItem.update({ where: { id: a.item }, data: { studentId: null, enrollmentId: null } });
    const kqA = await duyetHocVuot(vao(GIAM_DOC(), a.issue.id));
    expect(kqA.ok && kqA.daLam, JSON.stringify(kqA)).toBe(true);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: a.item }, select: { studentId: true, enrollmentId: true } })).toEqual({ studentId: null, enrollmentId: null });

    const b = await dungVuotTran("28b", 9);
    const hvKhac = await dungHocVien(`${T}hv-28b-x`, "28b-x");
    const gdKhac = await ghiDanh(`${T}gd-28b-x`, hvKhac, b.lop);
    await db.orderItem.update({ where: { id: b.item }, data: { studentId: hvKhac, enrollmentId: gdKhac } });
    const kqB = await duyetHocVuot(vao(GIAM_DOC(), b.issue.id));
    expect(kqB.ok && kqB.daLam, JSON.stringify(kqB)).toBe(true);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: b.item }, select: { studentId: true, enrollmentId: true } })).toEqual({ studentId: hvKhac, enrollmentId: gdKhac });
  });

  it("[P5-DB-29] duyệt GHI dấu quyết định của người lên payload của dòng: `daQuyet.hanhDong = DUYET_HOC_VUOT`, đúng người, đúng lý do, dấu vân = lý do của dòng LÚC DUYỆT; đề xuất gốc (`hocVuot`) còn nguyên", async () => {
    const c = await dungVuotTran("29", 9);
    const kq = await duyetHocVuot(vao(GIAM_DOC(), c.issue.id, "Đồng ý cho bé học vượt đủ 3 bài đầu"));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
    const [dong] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(docDaQuyet(dong!.payload)).toMatchObject({ hanhDong: "DUYET_HOC_VUOT", boi: { id: `${T}giam-doc` }, lyDo: "Đồng ý cho bé học vượt đủ 3 bài đầu", dauVan: c.issue.lyDo });
    expect(docDeXuat(dong!.payload)).toMatchObject({ baiDeXuatThem: [1, 2, 3], entitlementId: c.q.id });
  });

  it("[P5-DB-30] quyền học ĐÃ ĐỔI LỚP sau khi dòng được mở ⇒ duyệt bị từ chối (KHONG_CHO_PHEP), KHÔNG đổi gì (đếm hàng + skippedSessions + dòng vẫn mở)", async () => {
    const c = await dungVuotTran("30", 9);
    const khac = `${T}lop-30-x`;
    await dungLop({ id: khac, daDay: 9 });
    await db.studyEntitlement.update({ where: { id: c.q.id }, data: { classId: khac } });
    const truoc = await demHang();
    const kq = await duyetHocVuot(vao(GIAM_DOC(), c.issue.id));
    expect(loiMa(kq)).toBe("KHONG_CHO_PHEP");
    expect(await demHang()).toEqual(truoc);
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 3, classId: khac });
    expect((await choCua(c.don, "CHO_DUYET_HOC_VUOT"))[0]).toMatchObject({ trangThai: "OPEN" });
  });

  it("[P5-DB-31] quyền học ĐÃ GẮN SANG GHI DANH KHÁC sau khi dòng được mở ⇒ duyệt bị từ chối, KHÔNG đổi gì", async () => {
    const c = await dungVuotTran("31", 9);
    const khac = `${T}lop-31-x`;
    await dungLop({ id: khac, daDay: 9 });
    const gd2 = await ghiDanh(`${T}gd-31-x`, c.hv, khac);
    await db.studyEntitlement.update({ where: { id: c.q.id }, data: { enrollmentId: gd2 } });
    const truoc = await demHang();
    const kq = await duyetHocVuot(vao(GIAM_DOC(), c.issue.id));
    expect(loiMa(kq)).toBe("KHONG_CHO_PHEP");
    expect(await demHang()).toEqual(truoc);
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 3, enrollmentId: gd2 });
  });

  it("[P5-DB-32] DEDUPE (nhánh không tới được qua đường thật — mô phỏng bằng SQL đặt lại quyền học): dòng xin duyệt NGƯỜI ĐÃ ĐÓNG + quyền học xếp lại ⇒ KHÔNG ném (không P2002 cuộn ngược lần xếp lớp), KHÔNG dòng thứ hai, KHÔNG mở lại, dòng đóng KHÔNG bị ghi lại", async () => {
    const c = await dungVuotTran("32", 9);
    const dong1 = await dongDongHangDoi(vao(QLCS(), c.issue.id, "Không duyệt, đóng dòng này lại"));
    expect(dong1.ok && dong1.daLam, JSON.stringify(dong1)).toBe(true);
    const [daDong] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(daDong).toMatchObject({ trangThai: "DA_XU_LY" });
    // Chỉ script / SQL tay làm được việc này (cap-tu-don không cấp lại quyền đã VOIDED, xếp lớp bỏ qua quyền đã xếp) — nên đây là MÔ PHỎNG, không phải đường thật.
    await db.studyEntitlement.update({
      where: { id: c.q.id },
      data: { status: "AWAITING_PLACEMENT", enrollmentId: null, classId: null, startLessonOrder: null, endLessonOrder: null, skippedSessions: 0, scopeLockedAt: null },
    });
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
    try {
      await xetXepLopChoDon(c.don, "CHUYEN_DOI", new Date(NOW.getTime() + 3_600_000));
    } finally {
      vi.setSystemTime(NOW);
    }
    expect((await quyenCua(c.don))[0], "fixture: quyền học phải được xếp lại").toMatchObject({ status: "ACTIVE", skippedSessions: 3 });
    const cac = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(cac).toHaveLength(1);
    expect(cac[0]).toMatchObject({ trangThai: "DA_XU_LY", lyDo: daDong!.lyDo });
    expect(cac[0]!.updatedAt.toISOString()).toBe(daDong!.updatedAt.toISOString());
  });

  it("[P5-DB-33] KÍCH HOẠT ghi danh PENDING ⇒ đồng bộ nhóm chat ĐÚNG LỚP của ghi danh đó (chat law 5), qua hàm thật `syncConversationMembership`", async () => {
    const c = await chotLead("33", { scope: true, soBuoi: 12, coTien: false });
    expect(c.gd.status).toBe("PENDING");
    vi.mocked(syncChat.syncConversationMembership).mockClear();
    await thu(c.don, c.item, c.tien);
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd.id } })).status).toBe("STUDYING");
    const lop = vi.mocked(syncChat.syncConversationMembership).mock.calls.map((a) => a[1]);
    expect(lop.filter((x) => x === c.gd.classId)).toHaveLength(1);
    // Đối chứng: ghi danh đã STUDYING (không PENDING) ⇒ xếp lớp KHÔNG đồng bộ nhóm chat (chỉ bước kích hoạt mới đồng bộ).
    const d = await dungDayDu("33b", { soBuoi: 12, daDay: 2 });
    vi.mocked(syncChat.syncConversationMembership).mockClear();
    await hichCapQuyenHocChoDon(d.don, "KE_TOAN_XAC_NHAN", NOW);
    expect(vi.mocked(syncChat.syncConversationMembership)).not.toHaveBeenCalled();
  });

  it("[P5-DB-34] `demDangMo`: loại CHO_DUYET_HOC_VUOT chưa có dòng nào ⇒ ĐÚNG 0 (không undefined), mọi loại đều có khoá; có dòng ⇒ đếm đúng", async () => {
    const khong = await demDangMo(GIAM_DOC());
    for (const loai of ["CHO_CHUYEN_DOI", "CHO_XEP_LOP", "CHO_DUYET_HOC_VUOT", "CAN_THU_HOI", "TREO_DUYET_TAY", "THIEU_QUYEN_HOC", "LECH_DU_LIEU"] as const) expect(khong[loai], loai).toBe(0);
    expect(Object.keys(khong).sort()).toEqual(["CAN_THU_HOI", "CHO_CHUYEN_DOI", "CHO_DUYET_HOC_VUOT", "CHO_XEP_LOP", "LECH_DU_LIEU", "THIEU_QUYEN_HOC", "TREO_DUYET_TAY"]);
    await dungVuotTran("34", 9);
    expect((await demDangMo(GIAM_DOC())).CHO_DUYET_HOC_VUOT).toBe(1);
  });

  it("[P5-DB-35] gọi THẲNG dịch vụ bằng người KHÔNG có manage lẫn approve-exception, trên dòng 'cấu hình không rõ' (tầng MANAGE) ⇒ mã KHONG_QUYEN (không rơi sang KHONG_CHO_PHEP); người có manage thì qua được", async () => {
    await datTran(OU1, 3);
    const nho = await dungVuotTran("35", 5);
    const goc = nho.issue.payload as { hocVuot: Record<string, unknown> };
    await db.studyEntitlementXuLy.update({ where: { id: nho.issue.id }, data: { payload: { hocVuot: { ...goc.hocVuot, capRoRang: false } } as Prisma.InputJsonValue } });
    expect(loiMa(await duyetHocVuot(vao(KHONG_QUYEN(), nho.issue.id)))).toBe("KHONG_QUYEN");
    expect(loiMa(await duyetHocVuot(vao(CSKH(), nho.issue.id)))).toBe("KHONG_QUYEN");
    const kq = await duyetHocVuot(vao(QLCS(), nho.issue.id));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
  });

  it("[P5-DB-36] MIGRATION: INSERT SQL thô KHÔNG truyền `freeMakeupSessions` ⇒ = 0 (DEFAULT 0 còn nguyên — mã cũ không biết cột này vẫn ghi được quyền học); âm bị CHECK từ chối", async () => {
    const id = `${T}ent-36`;
    await dungHocVien(`${T}hv-36`, "36");
    await db.$executeRaw`INSERT INTO "StudyEntitlement" ("id", "studentId", "courseId", "centerId", "purchaseKind", "purchaseSessions", "listAmount", "netAmount", "pricingSnapshot", "updatedAt", "origin")
      VALUES (${id}, ${`${T}hv-36`}, ${KHOA}, ${CS1}, 'FULL'::"PurchaseKind", 48, 8976000, 8976000, '{}'::jsonb, now(), 'MANUAL'::"EntitlementOrigin")`;
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id } })).freeMakeupSessions).toBe(0);
    await expect(
      db.$executeRaw`INSERT INTO "StudyEntitlement" ("id", "studentId", "courseId", "centerId", "purchaseKind", "purchaseSessions", "listAmount", "netAmount", "pricingSnapshot", "updatedAt", "origin", "freeMakeupSessions")
        VALUES (${`${id}-neg`}, ${`${T}hv-36`}, ${KHOA}, ${CS1}, 'FULL'::"PurchaseKind", 48, 8976000, 8976000, '{}'::jsonb, now(), 'MANUAL'::"EntitlementOrigin", -1)`,
    ).rejects.toThrow(/free_makeup_chk/);
    await db.studyEntitlement.delete({ where: { id } });
  });

  // ── Luật 5 với RoleDef SEED THẬT (không `actorLit`): seed vai → gán UserOrgRole → `resolveActorUncached` → `can()` v2 ──────────────────────────────────────────────
  it("[P5-DB-37] QUYỀN THEO VAI bằng RoleDef seed THẬT: view / manage / approve-exception / view-money đúng bảng; QLCS manage CHỈ trong cơ sở mình; CSKH & kế toán không manage; view-money không ai ngoài Admin; đầu-cuối: QLCS không duyệt vượt trần, Giám đốc duyệt được, QLCS cơ sở khác không thấy dòng", async () => {
    await seedRoles();
    const ou2 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    const ouHo = (await db.orgUnit.findUniqueOrThrow({ where: { code: "HO" }, select: { id: true } })).id;
    const mk = async (khoa: string, vai: string, orgUnitId: string): Promise<Actor> => {
      const u = await seedUser({ email: `${T}rb-${khoa}@p5.test`, role: "TEACHER" });
      const role = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
      await db.userOrgRole.upsert({
        where: { userId_orgUnitId_roleId: { userId: u.id, orgUnitId, roleId: role.id } },
        update: { status: "ACTIVE", effectiveTo: null, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
        // `effectiveFrom` TƯỜNG MINH: `Date` bị đóng băng ở NOW (10/2026) còn mặc định của cột là `now()` của DB ⇒ vai "chưa hiệu lực" và actor rỗng quyền.
        create: { userId: u.id, orgUnitId, roleId: role.id, grantedById: u.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
      return resolveActorUncached(u.id);
    };
    const [cm1, cm2, cskh, ktCs, ktHo, gd, admin] = await Promise.all([
      mk("cm1", "CENTER_MANAGER", OU1),
      mk("cm2", "CENTER_MANAGER", ou2),
      mk("cskh", "CENTER_SALES_CSM", OU1),
      mk("kt-cs", "CENTER_ACCOUNTANT", OU1),
      mk("kt-ho", "HO_ACCOUNTANT", ouHo),
      mk("gd", "GIAM_DOC", ouHo),
      mk("admin", "SUPER_ADMIN", ouHo),
    ]);
    const T1 = { centerId: CS1, orgUnitId: OU1 };
    const T2 = { centerId: CS2, orgUnitId: ou2 };
    const K = { view: "entitlements:view", manage: "entitlements:manage", duyet: "entitlements:approve-exception", tien: "entitlements:view-money" } as const;
    // QLCS cơ sở 1
    expect([can(cm1, K.view), can(cm1, K.manage, T1), can(cm1, K.manage, T2), can(cm1, K.manage), can(cm1, K.duyet, T1), can(cm1, K.tien, T1)]).toEqual([true, true, false, false, false, false]);
    expect([can(cm2, K.manage, T2), can(cm2, K.manage, T1)]).toEqual([true, false]);
    // CSKH + hai kế toán: chỉ xem
    for (const [ten, a] of [["cskh", cskh], ["kt-cs", ktCs], ["kt-ho", ktHo]] as const) {
      expect([can(a, K.view), can(a, K.manage, T1), can(a, K.duyet, T1), can(a, K.tien, T1)], ten).toEqual([true, false, false, false]);
    }
    // Giám đốc (HO): xem + xử lý + duyệt vượt trần ở MỌI cơ sở, KHÔNG view-money
    expect([can(gd, K.view), can(gd, K.manage, T1), can(gd, K.manage, T2), can(gd, K.duyet, T2), can(gd, K.tien, T1)]).toEqual([true, true, true, true, false]);
    // Admin: tất cả; view-money chỉ Admin
    expect([can(admin, K.view), can(admin, K.manage, T2), can(admin, K.duyet, T1), can(admin, K.tien, T1)]).toEqual([true, true, true, true]);
    // Đầu-cuối bằng actor thật
    const c = await dungVuotTran("37", 9);
    expect(loiMa(await duyetHocVuot(vao(cm1, c.issue.id)))).toBe("KHONG_QUYEN");
    expect(loiMa(await duyetHocVuot(vao(cskh, c.issue.id)))).toBe("KHONG_QUYEN");
    expect(loiMa(await dongDongHangDoi(vao(cskh, c.issue.id)))).toBe("KHONG_QUYEN");
    expect(loiMa(await duyetHocVuot(vao(cm2, c.issue.id)))).toBe("KHONG_TIM_THAY");
    const doc = async (a: Actor) => (await docHangDoi(a, { trangThai: ["OPEN"], loai: ["CHO_DUYET_HOC_VUOT"] }, 1, NOW)).dong.find((d) => d.id === c.issue.id);
    expect(await doc(cm2)).toBeUndefined();
    expect((await doc(cm1))?.hanhDong).toEqual(["DONG"]);
    expect((await doc(cskh))?.hanhDong).toEqual([]);
    expect((await doc(ktCs))?.coXemTien).toBe(false);
    expect((await doc(gd))?.hanhDong).toEqual(["DONG", "DUYET_HOC_VUOT"]);
    const kq = await duyetHocVuot(vao(gd, c.issue.id, "Giám đốc đồng ý cho học vượt thêm"));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
  });

  // ── Khoá chống đua: mỗi khoá được kiểm RIÊNG LẺ, xác định (không phụ thuộc thời gian ngẫu nhiên) ───────────────────────────────────────────────────────────────
  /** Giữ một khoá trong MỘT transaction ngoài cho tới khi gọi `nha()`. */
  async function giuKhoa(giu: (tx: Prisma.TransactionClient) => Promise<void>): Promise<{ nha: () => void; xong: Promise<void> }> {
    let nha!: () => void;
    const cho = new Promise<void>((ok) => (nha = ok));
    let daGiu!: () => void;
    const gd = new Promise<void>((ok) => (daGiu = ok));
    const xong = db.$transaction(
      async (tx) => {
        await giu(tx);
        daGiu();
        await cho;
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
    await gd;
    return { nha, xong };
  }
  const trangThaiSau = async (p: Promise<unknown>, ms: number): Promise<"xong" | "cho"> =>
    Promise.race([p.then(() => "xong" as const), new Promise<"cho">((ok) => setTimeout(() => ok("cho"), ms))]);

  it("[P5-DB-38] KHOÁ ĐƠN của duyệt học vượt (riêng lẻ): người khác đang giữ khoá đơn ⇒ duyệt PHẢI CHỜ (không ghi gì); nhả khoá ⇒ duyệt xong đúng một lần", async () => {
    const c = await dungVuotTran("38", 9);
    const g = await giuKhoa((tx) => khoaDonTrongTx(tx, c.don));
    try {
      const p = duyetHocVuot(vao(GIAM_DOC(), c.issue.id));
      expect(await trangThaiSau(p, 2_500), "đang bị khoá đơn ⇒ chưa được xong").toBe("cho");
      expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 3 });
      g.nha();
      await g.xong;
      const kq = await p;
      expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
    } finally {
      g.nha();
      await g.xong.catch(() => undefined);
    }
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 0 });
  });

  it("[P5-DB-39] KHOÁ DÒNG QUYỀN HỌC (`FOR UPDATE`) của duyệt học vượt (riêng lẻ): người khác giữ `FOR KEY SHARE` trên quyền học (xung đột với FOR UPDATE nhưng KHÔNG với UPDATE thường) ⇒ duyệt PHẢI CHỜ; nhả ⇒ xong", async () => {
    const c = await dungVuotTran("39", 9);
    const g = await giuKhoa(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StudyEntitlement" WHERE "id" = ${c.q.id} FOR KEY SHARE`;
    });
    try {
      const p = duyetHocVuot(vao(GIAM_DOC(), c.issue.id));
      expect(await trangThaiSau(p, 2_500), "quyền học đang bị giữ khoá ⇒ chưa được xong").toBe("cho");
      g.nha();
      await g.xong;
      const kq = await p;
      expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
    } finally {
      g.nha();
      await g.xong.catch(() => undefined);
    }
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 0 });
  });
});
