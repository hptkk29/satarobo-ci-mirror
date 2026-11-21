// tests/finance/chinh-sach-p5.test.ts — PR5: CHÍNH SÁCH HỌC BÙ MIỄN PHÍ · KEEP_LATEST · GHI DANH TREO CHỜ QUYỀN HỌC · DUYỆT HỌC VƯỢT KHI VƯỢT TRẦN, trên POSTGRES THẬT.
// Mã ca: [P5-DB-xx].
//
// ⚠️ LUẬT HỌC VƯỢT ĐÃ ĐỔI [chủ dự án chốt 21/10/2026]: gói trọn vào lớp trễ — D = số bài đã dạy, n = `enrollment.catchUpMaxSessions` (mặc định 6):
//   D = 0 ⇒ NONE · 1 ≤ D ≤ n ⇒ CATCH_UP (mọi bài đã qua thành nhu cầu bù MIỄN PHÍ, `MakeupNeed.nguon = HOC_VUOT`) · D > n ⇒ OVER_CAP_SKIPPED (bỏ HẾT, không bù, KHÔNG xin duyệt).
//   Không còn FREE_MAKEUP cho gói trọn (chỉ còn ở MUA TIẾP), `catchUpOverCapPolicy` và `lateEntryMaxLessons` không còn được đọc. Xếp lớp KHÔNG còn tạo dòng `CHO_DUYET_HOC_VUOT`;
//   dòng ĐÃ MỞ trước 21/10 vẫn duyệt / đóng được — các ca duyệt dựng dòng cũ bằng `dungDongHocVuotCu`.
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
import { deXuatHocVuot, docDeXuat, lyDoChoDuyetHocVuot, payloadDeXuat } from "@/lib/entitlements/hoc-vuot-duyet";
import { chiaBaiThanhBuoi } from "@/lib/entitlements/hoc-vuot";
import type { KetQuaXepLop } from "@/lib/entitlements/bat-dau-khi-xep-lop";
import { thiHanhHanhDongCho } from "@/lib/entitlements/hang-doi/ghi-dong";
import { docDaQuyet } from "@/lib/entitlements/da-quyet";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { laDongMienPhi, NGUON_BU_HOC_VUOT } from "@/lib/hoc-bu/xep-case";
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
/** Ngưỡng n (`enrollment.catchUpMaxSessions`) đang hiệu lực ở CS1 — `datTran` ghi nhận để `dungDongHocVuotCu` dựng dòng cũ KHỚP với cấu hình (mặc định 6). */
let tranDangDat = 6;
async function datTran(orgUnitId: string, tran: number | null) {
  tranDangDat = tran ?? 6;
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

  // ═══ A · HỌC BÙ MIỄN PHÍ KHÔNG TRỪ QUYỀN CHÍNH (quyết định 1) — nay CHỈ CÒN Ở MUA TIẾP ═════════════════════════════════
  // [21/10/2026, chủ dự án chốt] Gói TRỌN vào lớp trễ KHÔNG còn chế độ FREE_MAKEUP (xem mục B): bài đã qua thành nhu cầu bù MIỄN PHÍ (`MakeupNeed.nguon = HOC_VUOT`) hoặc bị bỏ qua. `freeMakeupSessions`
  // chỉ còn sinh ở đường MUA TIẾP (`truoc`): các bài lỡ giữa bài cuối của lần mua trước và bài kế tiếp của lớp. Ba ca dưới dựng quyền học ĐÚNG đường đó; mục đích giữ nguyên
  // (học bù miễn phí KHÔNG trừ quyền học chính).
  async function dungQuyenMuaTiep(tenCa: string) {
    const hv = await dungHocVien(`${T}hv-${tenCa}`, tenCa);
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
    // Lần mua trước kết thúc ở bài 12; lớp đang ở bài 16 ⇒ bài 13–15 là bài LỠ ⇒ học bù miễn phí.
    const { phamVi } = await db.$transaction((tx) =>
      xepLopTrongTx(tx, { entitlementId: q.id, enrollmentId: `${T}gd-${tenCa}`, classId: `${T}lop-${tenCa}`, baiKeTiepCuaLop: 16, truoc: { end: 12, graceUsed: 0 }, cauHinh: CAU_HINH_PHAM_VI_MAC_DINH, baiMoiBuoiHocVuot: 3, actor: NGUOI_TEST, now: NOW }, CO_CS1()),
    );
    return { hv, phamVi, quyen: () => db.studyEntitlement.findUniqueOrThrow({ where: { id: q.id } }), id: q.id };
  }

  it("[P5-DB-01] FREE_MAKEUP (MUA TIẾP, mua trước hết bài 12, lớp đang ở bài 16): `freeMakeupSessions` = 3 (bài 13–15), không có dòng Usage, không nhu cầu học vượt, không dòng chờ — còn GÓI TRỌN vào trễ thì KHÔNG còn FREE_MAKEUP", async () => {
    const m = await dungQuyenMuaTiep("01");
    expect(m.phamVi.catchupMode).toBe("FREE_MAKEUP");
    const q = await m.quyen();
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 13, endLessonOrder: 24, skippedSessions: 0, freeMakeupSessions: 3, consumedSessions: 0 });
    expect((q.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "FREE_MAKEUP", freeMakeupLessons: [13, 14, 15], requiredCatchupLessons: [] });
    expect(await demUsage(q.id)).toBe(0);
    expect(await nhuCauBu(m.hv)).toHaveLength(0);
    expect(await db.studyEntitlementXuLy.count({ where: { studentId: m.hv } }), "FREE_MAKEUP không mở dòng chờ nào").toBe(0);

    // Đối chứng (luật 21/10/2026): GÓI TRỌN, lớp đã dạy 3 ⇒ CATCH_UP — KHÔNG phải FREE_MAKEUP, `freeMakeupSessions` = 0, 3 nhu cầu bù mang nguồn HOC_VUOT, không dòng xin duyệt.
    const c = await dungDayDu("01b", { daDay: 3 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q2] = await quyenCua(c.don);
    expect(q2).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 0, freeMakeupSessions: 0, consumedSessions: 0 });
    expect((q2!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "CATCH_UP", freeMakeupLessons: [], requiredCatchupLessons: [1, 2, 3] });
    const nc = await nhuCauBu(c.hv);
    expect(nc).toHaveLength(3);
    for (const n of nc) expect(n.nguon).toBe(NGUON_BU_HOC_VUOT);
    expect(await demUsage(q2!.id)).toBe(0);
    expect(await choCua(c.don, "CHO_DUYET_HOC_VUOT")).toHaveLength(0);
  });

  it("[P5-DB-02] ghi nhận một bài học bù MIỄN PHÍ (bài 14, MUA TIẾP): kết quả HOC_BO_SUNG, sổ cái trước/sau BẰNG NHAU (0 hàng Usage), consumed vẫn 0, trạng thái vẫn ACTIVE, đúng MỘT dòng audit BONUS_LEARN", async () => {
    const m = await dungQuyenMuaTiep("02");
    const truoc = { usage: await db.studyEntitlementUsage.count(), tong: await demUsage(m.id) };
    const kq = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: m.id, lessonOrder: 14, nguon: "MAKEUP", actor: NGUOI_TEST, now: NOW }, CO_CS1()));
    expect(kq).toEqual({ ghi: false, lyDo: "HOC_BO_SUNG" });
    expect({ usage: await db.studyEntitlementUsage.count(), tong: await demUsage(m.id) }, "FREE_MAKEUP không sinh Usage của quyền chính").toEqual(truoc);
    expect(await m.quyen()).toMatchObject({ consumedSessions: 0, status: "ACTIVE", freeMakeupSessions: 3 });
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: m.id, action: "BONUS_LEARN" } })).toBe(1);
    // Cùng bài nhưng nguồn khác (CATCH_UP) cũng không vào sổ; huỷ ghi nhận bài đó không có gì để huỷ.
    expect(await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: m.id, lessonOrder: 13, nguon: "CATCH_UP", actor: NGUOI_TEST, now: NOW }, CO_CS1()))).toEqual({ ghi: false, lyDo: "HOC_BO_SUNG" });
    expect(await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: m.id, lessonOrder: 14, lyDo: "điểm danh sửa", actor: NGUOI_TEST, now: NOW }, CO_CS1()))).toMatchObject({ daHuy: false });
    expect(await demUsage(m.id)).toBe(0);
    // Đối chứng dương: bài 16 (bài lớp) vẫn tiêu thụ bình thường — 12 buổi − 3 học bù miễn phí − 1 vừa học = còn 8.
    const lop = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: m.id, lessonOrder: 16, nguon: "CLASS", actor: NGUOI_TEST, now: NOW }, CO_CS1()));
    expect(lop).toMatchObject({ ghi: true, loai: "TIEU_THU", daTieuThu: 1, conLai: 8 });
    expect(await demUsage(m.id)).toBe(1);
  });

  it("[P5-DB-03] KHÔNG KÉO DÀI 'hết quyền' (MUA TIẾP): bài lỡ 13–15 học bù miễn phí, học hết bài 16–24 qua lớp (9 bài) mà KHÔNG bù bài 13–15 ⇒ quyền học EXHAUSTED đúng lúc (còn lại 0), không kẹt ở 3", async () => {
    const m = await dungQuyenMuaTiep("03");
    let cuoi: Awaited<ReturnType<typeof ghiNhanBaiTrongTx>> | null = null;
    for (let bai = 16; bai <= 24; bai++) {
      cuoi = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: m.id, lessonOrder: bai, nguon: "CLASS", actor: NGUOI_TEST, now: NOW }, CO_CS1()));
      if (bai < 24) expect(cuoi, `bài ${bai}`).toMatchObject({ ghi: true, trangThai: "ACTIVE" });
    }
    expect(cuoi).toMatchObject({ ghi: true, trangThai: "EXHAUSTED", daTieuThu: 9, conLai: 0 });
    expect(await m.quyen()).toMatchObject({ status: "EXHAUSTED", consumedSessions: 9 });
    expect(await demUsage(m.id)).toBe(9);
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

  // ═══ B · GÓI TRỌN VÀO LỚP TRỄ — LUẬT HỌC VƯỢT [chủ dự án chốt 21/10/2026, thay luật KEEP_LATEST + xin duyệt] ═══════════════════════
  // D = số bài lớp đã dạy trước khi học viên vào; n = `enrollment.catchUpMaxSessions` (mặc định 6, QLCS đặt theo cơ sở, tối đa 12).
  //   D = 0       ⇒ NONE.
  //   1 ≤ D ≤ n   ⇒ CATCH_UP: MỌI bài đã qua thành nhu cầu bù (`MakeupNeed`, ORDER_CONVERSION) mang `nguon = HOC_VUOT` ⇒ MIỄN PHÍ (không trừ lượt bù, không đòi phí).
  //   D > n       ⇒ OVER_CAP_SKIPPED: bỏ TẤT CẢ bài đã qua (skippedSessions = D), KHÔNG bù, KHÔNG tạo dòng xin duyệt `CHO_DUYET_HOC_VUOT`.
  // `catchUpOverCapPolicy` (KEEP_LATEST / DROP_ALL) và `lateEntryMaxLessons` KHÔNG còn được đọc cho gói trọn (vùng FREE_MAKEUP của gói trọn đã bỏ).
  const khongCoDongDuyet = async (orderId: string) => {
    expect(await choCua(orderId, "CHO_DUYET_HOC_VUOT"), "xếp lớp KHÔNG còn tạo dòng xin duyệt học vượt").toHaveLength(0);
  };
  const xepLopCua = (q: { configSnapshot: unknown } | undefined) => (q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop;
  /** Gói trọn, D ≤ n: CATCH_UP — D nhu cầu bù, đúng buổi đã dạy của từng bài, TẤT CẢ mang nguon HOC_VUOT. */
  const kiemCatchUp = async (c: { don: string; hv: string; lop: string }, d: number, n: number) => {
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 0, freeMakeupSessions: 0, consumedSessions: 0 });
    expect(xepLopCua(q)).toMatchObject({ catchupMode: "CATCH_UP", skippedLessons: [], requiredCatchupLessons: r(1, d), catchUpMaxSessions: n });
    const nc = await nhuCauBu(c.hv);
    expect(nc.map((x) => x.missedSessionId).sort(), `D=${d}: mỗi bài đã qua một nhu cầu bù`).toEqual(r(0, d - 1).map((i) => `${c.lop}-s${i}`).sort());
    for (const x of nc) expect(x, `D=${d}`).toMatchObject({ sourceType: "ORDER_CONVERSION", nguon: NGUON_BU_HOC_VUOT, status: "PENDING", studentId: c.hv });
    expect(await demUsage(q!.id), `D=${d}: học vượt KHÔNG trừ quyền học chính`).toBe(0);
    await khongCoDongDuyet(c.don);
  };
  /** Gói trọn, D > n: OVER_CAP_SKIPPED — bỏ TẤT CẢ D bài, KHÔNG nhu cầu bù, KHÔNG dòng xin duyệt. */
  const kiemBoHet = async (c: { don: string; hv: string }, d: number, n: number) => {
    const [q] = await quyenCua(c.don);
    expect(q, `D=${d}`).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: d, freeMakeupSessions: 0, consumedSessions: 0 });
    expect(xepLopCua(q), `D=${d}`).toMatchObject({ catchupMode: "OVER_CAP_SKIPPED", skippedLessons: r(1, d), requiredCatchupLessons: [], catchupSessions: [], catchUpMaxSessions: n });
    expect(await nhuCauBu(c.hv), `D=${d}: vượt n ⇒ không bù gì`).toHaveLength(0);
    expect(await demUsage(q!.id)).toBe(0);
    await khongCoDongDuyet(c.don);
  };

  it("[P5-DB-06] BIÊN quanh n=6: đã dạy 1 và ĐÚNG trần 6 ⇒ CATCH_UP đủ bài (nhu cầu bù MIỄN PHÍ nguon HOC_VUOT); TRẦN+1 (đã dạy 7) ⇒ OVER_CAP_SKIPPED bỏ HẾT 7 bài, KHÔNG bù, KHÔNG dòng xin duyệt", async () => {
    const c1 = await dungDayDu("06c", { daDay: 1 });
    const c6 = await dungDayDu("06a", { daDay: 6 });
    const c7 = await dungDayDu("06b", { daDay: 7 });
    for (const c of [c1, c6, c7]) await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemCatchUp(c1, 1, 6);
    await kiemCatchUp(c6, 6, 6);
    await kiemBoHet(c7, 7, 6);
  });

  it("[P5-DB-07] RẤT NHIỀU buổi (đã dạy 36): bỏ HẾT 36 bài (không giữ bài gần nhất), không nhu cầu bù, không dòng xin duyệt; chạy lại KHÔNG ghi gì thêm (quyền học nguyên `updatedAt`)", async () => {
    const c = await dungDayDu("07", { daDay: 36 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemBoHet(c, 36, 6);
    const [q] = await quyenCua(c.don);
    // IDEMPOTENT: hích 3 lần + gọi thẳng hàm xét 2 lần ⇒ không đổi hàng nào, không đổi `updatedAt`.
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
    const lai = (await quyenCua(c.don))[0];
    expect(lai!.updatedAt.toISOString()).toBe(q!.updatedAt.toISOString());
    await khongCoDongDuyet(c.don);
  });

  it("[P5-DB-08] NGƯỠNG THEO CƠ SỞ: n=3 ⇒ đã dạy 3 bù đủ, đã dạy 5 bỏ HẾT 5; n=10 ⇒ đã dạy 8 vẫn bù đủ 8; n=12 ⇒ đã dạy 12 bù đủ, đã dạy 13 bỏ HẾT 13 — luôn KHÔNG dòng xin duyệt", async () => {
    await datTran(OU1, 3);
    const a3 = await dungDayDu("08c", { daDay: 3 });
    const a5 = await dungDayDu("08a", { daDay: 5 });
    await hichCapQuyenHocChoDon(a3.don, "KE_TOAN_XAC_NHAN", NOW);
    await hichCapQuyenHocChoDon(a5.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemCatchUp(a3, 3, 3);
    await kiemBoHet(a5, 5, 3);

    await datTran(OU1, 10);
    const b = await dungDayDu("08b", { daDay: 8 });
    await hichCapQuyenHocChoDon(b.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemCatchUp(b, 8, 10);

    await datTran(OU1, 12);
    const d12 = await dungDayDu("08d", { daDay: 12 });
    const d13 = await dungDayDu("08e", { daDay: 13 });
    await hichCapQuyenHocChoDon(d12.don, "KE_TOAN_XAC_NHAN", NOW);
    await hichCapQuyenHocChoDon(d13.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemCatchUp(d12, 12, 12);
    await kiemBoHet(d13, 13, 12);
  });

  it("[P5-DB-09] DROP_ALL KHÔNG CÒN TÁC DỤNG (chỉ còn là cài đặt cũ): vượt trần vẫn bỏ HẾT (đã dạy 8), không bù, không dòng xin duyệt; trong trần (đã dạy 4) vẫn bù đủ — DROP_ALL không làm mất bài bù", async () => {
    await datChinhSach("DROP_ALL");
    const vuot = await dungDayDu("09", { daDay: 8 });
    const trong = await dungDayDu("09b", { daDay: 4 });
    await hichCapQuyenHocChoDon(vuot.don, "KE_TOAN_XAC_NHAN", NOW);
    await hichCapQuyenHocChoDon(trong.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemBoHet(vuot, 8, 6);
    await kiemCatchUp(trong, 4, 6);
  });

  it("[P5-DB-10] CHÍNH SÁCH VƯỢT TRẦN KHÔNG ĐỔI KẾT QUẢ: không cài đặt · KEEP_LATEST · DROP_ALL cho CÙNG một kết quả (đã dạy 8: bỏ hết 8, không bù, không dòng xin duyệt)", async () => {
    const ketQua: unknown[] = [];
    for (const [i, v] of ([null, "KEEP_LATEST", "DROP_ALL"] as const).entries()) {
      await datChinhSach(v);
      const c = await dungDayDu(`10${"abc"[i]}`, { daDay: 8 });
      await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
      await kiemBoHet(c, 8, 6);
      const [q] = await quyenCua(c.don);
      const xep = xepLopCua(q);
      ketQua.push({ skippedSessions: q!.skippedSessions, catchupMode: xep.catchupMode, skippedLessons: xep.skippedLessons, requiredCatchupLessons: xep.requiredCatchupLessons, catchupSessions: xep.catchupSessions, soNhuCau: (await nhuCauBu(c.hv)).length });
    }
    expect(ketQua[1]).toEqual(ketQua[0]);
    expect(ketQua[2]).toEqual(ketQua[0]);
  });

  // ═══ E/F · DUYỆT HỌC VƯỢT — DÒNG CŨ (mở TRƯỚC 21/10/2026) VẪN DUYỆT / ĐÓNG ĐƯỢC ═════════════════════════════════════════════════════════
  // Từ 21/10/2026 xếp lớp KHÔNG còn tạo dòng `CHO_DUYET_HOC_VUOT` (mục B). Nhưng dòng ĐÃ MỞ từ trước phải còn duyệt / đóng được, nên các ca dưới dựng ĐÚNG hình dạng dòng cũ:
  // quyền học ở dạng KEEP_LATEST cũ (bỏ D − n bài ĐẦU (`skippedSessions = D − n`), giữ n bài gần nhất làm học vượt, các nhu cầu bù cũ mang `nguon = NULL`) + một dòng xin duyệt OPEN
  // dựng bằng chính `deXuatHocVuot` / `payloadDeXuat` / `thiHanhHanhDongCho` mà đường cũ từng dùng. Khi DUYỆT, các nhu cầu tạo THÊM mang `nguon = HOC_VUOT` (miễn phí).
  async function dungDongHocVuotCu(tenCa: string, daDay = 9) {
    const n = tranDangDat;
    expect(daDay, "fixture: dòng cũ chỉ có khi vượt trần").toBeGreaterThan(n);
    const c = await dungDayDu(tenCa, { daDay });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q0] = await quyenCua(c.don);
    // Luật MỚI: xếp lớp bỏ HẾT và không xin duyệt — đây là điểm xuất phát, rồi ta lùi quyền học về dạng cũ.
    expect(q0, "fixture: xếp lớp theo luật mới").toMatchObject({ status: "ACTIVE", skippedSessions: daDay });
    await khongCoDongDuyet(c.don);
    const bo = r(1, daDay - n);
    const giu = r(daDay - n + 1, daDay);
    const baiMoiBuoi = 3;
    const catchupSessions = chiaBaiThanhBuoi(giu, baiMoiBuoi);
    const ketQuaCu: KetQuaXepLop = {
      startLesson: 1,
      endLesson: 48,
      skippedLessons: bo,
      lessonsBeforeStart: [],
      freeMakeupLessons: [],
      requiredCatchupLessons: giu,
      catchupSessions,
      catchupMode: "OVER_CAP_SKIPPED",
      canXemTay: true,
    };
    const dx = deXuatHocVuot(ketQuaCu, { ...CAU_HINH_PHAM_VI_MAC_DINH, catchUpMaxSessions: n, catchUpOverCapPolicy: "KEEP_LATEST" }, true, baiMoiBuoi);
    if (!dx) throw new Error("fixture: không dựng được đề xuất học vượt");
    const cs0 = q0!.configSnapshot as { xepLop: Record<string, unknown> };
    await db.studyEntitlement.update({
      where: { id: q0!.id },
      data: {
        skippedSessions: bo.length,
        configSnapshot: { ...cs0, xepLop: { ...cs0.xepLop, catchupMode: "OVER_CAP_SKIPPED", skippedLessons: bo, requiredCatchupLessons: giu, catchupSessions } } as Prisma.InputJsonValue,
      },
    });
    await db.$transaction(async (tx) => {
      // Nhu cầu bù của đường CŨ: n bài gần nhất, KHÔNG nhãn nguồn (`nguon = NULL`).
      for (const bai of giu) await taoDongHocBu(tx, { studentId: c.hv, missedSessionId: `${c.lop}-s${bai - 1}`, nguon: "ORDER_CONVERSION", createdById: null, orgUnitId: OU1 });
      await thiHanhHanhDongCho(
        tx,
        "CHO_DUYET_HOC_VUOT",
        { viec: "TAO_MOI", lyDo: lyDoChoDuyetHocVuot(dx) },
        null,
        { orderId: c.don, orderItemId: c.item, courseId: KHOA, leadChildId: null, studentId: c.hv, entitlementId: q0!.id, centerId: CS1, orgUnitId: OU1 },
        payloadDeXuat(dx, { entitlementId: q0!.id, enrollmentId: c.gd, classId: c.lop }) as Prisma.InputJsonValue,
        NOW,
      );
    });
    const [issue] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(issue, "fixture: phải có dòng xin duyệt").toBeDefined();
    const [q] = await quyenCua(c.don);
    return { ...c, issue: issue!, q: q! };
  }

  it("[P5-DB-11] QLCS (chỉ `manage`) KHÔNG duyệt được phần vượt trần: bị từ chối KHONG_QUYEN, không đổi gì (đếm hàng + quyền học + dòng vẫn mở)", async () => {
    const c = await dungDongHocVuotCu("11");
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
    const c = await dungDongHocVuotCu("12");
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
    const c2 = await dungDongHocVuotCu("12b");
    expect(loiMa(await dongDongHangDoi(vao(CSKH(), c2.issue.id)))).toBe("KHONG_QUYEN");
  });

  it("[P5-DB-13] Giám đốc (approve-exception) DUYỆT: bài bị bỏ thành học vượt qua cơ chế có sẵn — skippedSessions co lại, catchupSessions dài thêm, MakeupNeed ORDER_CONVERSION; KHÔNG Usage, KHÔNG đụng OrderItem / ghi danh; audit đủ; bấm lại không nhân đôi", async () => {
    const c = await dungDongHocVuotCu("13", 9);
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
    // [21/10/2026] Các nhu cầu tạo THÊM lúc duyệt (bài 1–3) mang nguồn HOC_VUOT ⇒ MIỄN PHÍ; 6 nhu cầu của dòng cũ (bài 4–9, dựng trước 21/10) giữ nguon NULL, không backfill.
    const nguonTheoBai = new Map(nc.map((n) => [n.missedSessionId, n.nguon] as const));
    for (const bai of [1, 2, 3]) expect(nguonTheoBai.get(`${c.lop}-s${bai - 1}`), `bài ${bai} do duyệt tạo`).toBe(NGUON_BU_HOC_VUOT);
    for (const bai of r(4, 9)) expect(nguonTheoBai.get(`${c.lop}-s${bai - 1}`), `bài ${bai} của dòng cũ`).toBeNull();
    const mienPhi = nc.filter((n) => laDongMienPhi(n)).length;
    expect(mienPhi, "chỉ 3 nhu cầu mới là miễn phí").toBe(3);

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
    const c = await dungDongHocVuotCu("14", 8);
    const admin = actorLit({ id: `${T}admin`, superAdmin: true });
    const kq = await Promise.all([1, 2, 3].map(() => duyetHocVuot(vao(admin, c.issue.id))));
    expect(kq.filter((k) => k.ok && k.daLam)).toHaveLength(1);
    expect(await nhuCauBu(c.hv)).toHaveLength(8);
    expect((await quyenCua(c.don))[0]).toMatchObject({ skippedSessions: 0 });
    expect(await db.auditLog.count({ where: { action: "EXTRA_CATCHUP_APPROVED", entityId: c.q.id } })).toBe(1);
  });

  it("[P5-DB-15] CẤU HÌNH TRẦN KHÔNG RÕ (capRoRang = false) và tổng bài ≤ trần mặc định ⇒ QLCS (manage) duyệt được; tổng VƯỢT trần mặc định ⇒ vẫn cần approve-exception", async () => {
    await datTran(OU1, 3);
    const nho = await dungDongHocVuotCu("15a", 5); // giữ 3 + đề xuất 2 = 5 ≤ 6
    const lon = await dungDongHocVuotCu("15b", 9); // trần 3: giữ 3 + đề xuất 6 = 9 > 6
    for (const d of [nho, lon]) {
      const goc = d.issue.payload as { hocVuot: Record<string, unknown> };
      await db.studyEntitlementXuLy.update({ where: { id: d.issue.id }, data: { payload: { hocVuot: { ...goc.hocVuot, capRoRang: false } } as Prisma.InputJsonValue } });
    }
    expect(loiMa(await duyetHocVuot(vao(QLCS(), lon.issue.id)))).toBe("KHONG_QUYEN");
    const kq = await duyetHocVuot(vao(QLCS(), nho.issue.id));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
    expect((await quyenCua(nho.don))[0]).toMatchObject({ skippedSessions: 0 });
    // Đối chứng: cấu hình RÕ RÀNG (mặc định) thì cùng đề xuất nhỏ vẫn cần approve-exception.
    const ro = await dungDongHocVuotCu("15c", 5);
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
    const b = await dungDongHocVuotCu("16b", 9);
    await datCo(OU1, false);
    const truocB = await demHang();
    const kq = await duyetHocVuot(vao(GIAM_DOC(), b.issue.id));
    expect(loiMa(kq)).toBe("KHONG_CHO_PHEP");
    expect(await demHang()).toEqual(truocB);
    expect((await quyenCua(b.don))[0]).toMatchObject({ skippedSessions: 3 });
  });

  it("[P5-DB-17] CÁCH LY CƠ SỞ: người cấp CS2 không thấy / không duyệt được dòng của CS1 (KHONG_TIM_THAY); Giám đốc ở CS2 cũng vậy", async () => {
    const c = await dungDongHocVuotCu("17", 9);
    const ou2 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    const gdCS2 = actorLit({ id: `${T}gd-cs2`, perms: ["entitlements:view", "entitlements:manage", "entitlements:approve-exception"], centerIds: [CS2], orgUnitIds: [ou2] });
    expect(loiMa(await duyetHocVuot(vao(gdCS2, c.issue.id)))).toBe("KHONG_TIM_THAY");
    expect(loiMa(await dongDongHangDoi(vao(gdCS2, c.issue.id)))).toBe("KHONG_TIM_THAY");
    const doc = await docHangDoi(gdCS2, { trangThai: ["OPEN"], loai: ["CHO_DUYET_HOC_VUOT"] }, 1, NOW);
    expect(doc.dong.filter((d) => d.id === c.issue.id)).toHaveLength(0);
  });

  it("[P5-DB-18] NÚT ≡ ACTION: trang đưa nút theo quyền — CSKH (chỉ xem) không có nút nào; QLCS có 'Đóng' nhưng KHÔNG có 'Duyệt học vượt thêm'; Giám đốc có cả hai; đếm dòng đang mở thấy loại mới", async () => {
    const c = await dungDongHocVuotCu("18", 9);
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
    const c = await dungDongHocVuotCu("25", 9);
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
    const c = await dungDongHocVuotCu("24", 9);
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
    const a = await dungDongHocVuotCu("28a", 9);
    await db.orderItem.update({ where: { id: a.item }, data: { studentId: null, enrollmentId: null } });
    const kqA = await duyetHocVuot(vao(GIAM_DOC(), a.issue.id));
    expect(kqA.ok && kqA.daLam, JSON.stringify(kqA)).toBe(true);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: a.item }, select: { studentId: true, enrollmentId: true } })).toEqual({ studentId: null, enrollmentId: null });

    const b = await dungDongHocVuotCu("28b", 9);
    const hvKhac = await dungHocVien(`${T}hv-28b-x`, "28b-x");
    const gdKhac = await ghiDanh(`${T}gd-28b-x`, hvKhac, b.lop);
    await db.orderItem.update({ where: { id: b.item }, data: { studentId: hvKhac, enrollmentId: gdKhac } });
    const kqB = await duyetHocVuot(vao(GIAM_DOC(), b.issue.id));
    expect(kqB.ok && kqB.daLam, JSON.stringify(kqB)).toBe(true);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: b.item }, select: { studentId: true, enrollmentId: true } })).toEqual({ studentId: hvKhac, enrollmentId: gdKhac });
  });

  it("[P5-DB-29] duyệt GHI dấu quyết định của người lên payload của dòng: `daQuyet.hanhDong = DUYET_HOC_VUOT`, đúng người, đúng lý do, dấu vân = lý do của dòng LÚC DUYỆT; đề xuất gốc (`hocVuot`) còn nguyên", async () => {
    const c = await dungDongHocVuotCu("29", 9);
    const kq = await duyetHocVuot(vao(GIAM_DOC(), c.issue.id, "Đồng ý cho bé học vượt đủ 3 bài đầu"));
    expect(kq.ok && kq.daLam, JSON.stringify(kq)).toBe(true);
    const [dong] = await choCua(c.don, "CHO_DUYET_HOC_VUOT");
    expect(docDaQuyet(dong!.payload)).toMatchObject({ hanhDong: "DUYET_HOC_VUOT", boi: { id: `${T}giam-doc` }, lyDo: "Đồng ý cho bé học vượt đủ 3 bài đầu", dauVan: c.issue.lyDo });
    expect(docDeXuat(dong!.payload)).toMatchObject({ baiDeXuatThem: [1, 2, 3], entitlementId: c.q.id });
  });

  it("[P5-DB-30] quyền học ĐÃ ĐỔI LỚP sau khi dòng được mở ⇒ duyệt bị từ chối (KHONG_CHO_PHEP), KHÔNG đổi gì (đếm hàng + skippedSessions + dòng vẫn mở)", async () => {
    const c = await dungDongHocVuotCu("30", 9);
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
    const c = await dungDongHocVuotCu("31", 9);
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

  it("[P5-DB-32] DEDUPE (nhánh không tới được qua đường thật — mô phỏng bằng SQL đặt lại quyền học): dòng xin duyệt CŨ mà NGƯỜI ĐÃ ĐÓNG + quyền học xếp lại ⇒ KHÔNG ném (không P2002 cuộn ngược lần xếp lớp), KHÔNG dòng thứ hai, KHÔNG mở lại, dòng đóng KHÔNG bị ghi lại; xếp lại theo luật mới bỏ HẾT 9 bài", async () => {
    const c = await dungDongHocVuotCu("32", 9);
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
    // [21/10/2026] Xếp lại theo luật MỚI: vượt n ⇒ bỏ HẾT 9 bài (không còn giữ 6 bài gần nhất) và KHÔNG tạo / mở lại / ghi dòng xin duyệt nào.
    expect((await quyenCua(c.don))[0], "fixture: quyền học phải được xếp lại").toMatchObject({ status: "ACTIVE", skippedSessions: 9 });
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
    await dungDongHocVuotCu("34", 9);
    expect((await demDangMo(GIAM_DOC())).CHO_DUYET_HOC_VUOT).toBe(1);
  });

  it("[P5-DB-35] gọi THẲNG dịch vụ bằng người KHÔNG có manage lẫn approve-exception, trên dòng 'cấu hình không rõ' (tầng MANAGE) ⇒ mã KHONG_QUYEN (không rơi sang KHONG_CHO_PHEP); người có manage thì qua được", async () => {
    await datTran(OU1, 3);
    const nho = await dungDongHocVuotCu("35", 5);
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
    const c = await dungDongHocVuotCu("37", 9);
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
    const c = await dungDongHocVuotCu("38", 9);
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
    const c = await dungDongHocVuotCu("39", 9);
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

  // ═══ G · NHU CẦU BÙ CỦA HỌC VƯỢT LÀ MIỄN PHÍ — đọc qua MỘT hàm của màn Học bù ═══════════════════════════════════════════════════════════
  /** Đọc dòng cần bù qua `docDongTheoId` — cùng hàm màn Học bù và action xếp case dùng (nút ≡ action). `db` trần: xem cách `bao-luu-p6` đo `PHUC_HOC`. */
  const docDongBu = (ids: readonly string[]) => docDongTheoId(db as unknown as Parameters<typeof docDongTheoId>[0], ids, null);

  it("[P5-DB-40] NHU CẦU BÙ CỦA HỌC VƯỢT (D ≤ n) ĐỌC RA LÀ MIEN_PHI và KHÔNG trừ lượt — kể cả khi học viên HẾT LƯỢT (0 lượt còn): `phi = MIEN_PHI`, `xep = { ok, dungLuot: false }`", async () => {
    const c = await dungDayDu("40", { daDay: 5 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    await kiemCatchUp(c, 5, 6);
    const ids = (await nhuCauBu(c.hv)).map((x) => x.id);
    expect(ids).toHaveLength(5);
    // Ép HẾT LƯỢT: mọi nhu cầu đã dùng hạn mức ⇒ lượt còn = 0. Miễn phí phải THẮNG hết lượt (nếu không, bé vừa vào lớp trễ đã bị đòi phí cho buổi đã đóng tiền).
    await db.makeupNeed.updateMany({ where: { id: { in: ids } }, data: { usedQuota: true } });
    const dong = await docDongBu(ids);
    expect(dong).toHaveLength(5);
    for (const d of dong) {
      expect(d.luot.con, "fixture: học viên đã hết lượt").toBe(0);
      expect(d.phi).toEqual({ loai: "MIEN_PHI" });
      expect(d.xep).toEqual({ ok: true, dungLuot: false });
    }
    const tho = await db.makeupNeed.findMany({ where: { id: { in: ids } }, select: { nguon: true, freeApprovedAt: true } });
    for (const n of tho) expect({ mienPhi: laDongMienPhi(n), freeApprovedAt: n.freeApprovedAt }, "miễn phí do NGUỒN, không do duyệt tay").toEqual({ mienPhi: true, freeApprovedAt: null });
  });

  it("[P5-DB-41] ĐỐI CHỨNG: nhu cầu ORDER_CONVERSION CŨ (`nguon = NULL`, trước 21/10) KHÔNG miễn phí — hết lượt thì CAN_THU và không xếp được; gỡ nhãn HOC_VUOT khỏi chính nhu cầu vừa miễn phí là mất miễn phí", async () => {
    const c = await dungDayDu("41", { daDay: 3 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const ids = (await nhuCauBu(c.hv)).map((x) => x.id);
    expect(ids).toHaveLength(3);
    await db.makeupNeed.updateMany({ where: { id: { in: ids } }, data: { usedQuota: true } });
    for (const d of await docDongBu(ids)) expect(d.phi, "đối chứng dương: có nhãn HOC_VUOT ⇒ miễn phí").toEqual({ loai: "MIEN_PHI" });
    await db.makeupNeed.updateMany({ where: { id: { in: ids } }, data: { nguon: null } });
    for (const d of await docDongBu(ids)) {
      expect(d.luot.con).toBe(0);
      expect(d.phi).toEqual({ loai: "CAN_THU" });
      expect(d.xep.ok).toBe(false);
    }
  });
});
