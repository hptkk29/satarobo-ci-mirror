// tests/finance/sale-tu-xep-lop.test.ts — [STX-*] SALE TỰ XẾP / CHUYỂN LỚP + GHI DANH TAY CÓ GẮN QUYỀN HỌC (chủ dự án 21/10/2026), Postgres THẬT.
//
// Chạy:  pnpm test:finance-db   (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// Gọi THẲNG `chuyenDoiDonAction` / `transferEnrollment` / `enrollStudent` — chỉ mock cổng ngoài (phiên, quyền theo TẬP đặt tay, actor, revalidate, hích quyền học,
// câu hỏi tiền webhook). Mọi thứ còn lại là mã THẬT: scopedDb, transaction, tạo học viên/ghi danh, hocVienCuaSale, chuyenLopTrongTx.
//
// KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  actor: null as unknown as Actor,
  uid: "fx-stx-nguoi-thao-tac",
  quyen: new Set<string>(),
  hich: [] as string[],
}));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "Người thao tác fixture" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: async (k: string) => h.quyen.has(k),
  canViewLeadPii: async () => h.quyen.has("leads:view-pii"),
  // `checkPrerequisites` (gọi trong enrollStudent) tự đòi `enrollments:edit` bằng assertPermission.
  assertPermission: async (k: string) => {
    if (!h.quyen.has(k)) throw new Error(`thiếu ${k}`);
  },
}));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => h.actor };
});
vi.mock("@/lib/entitlements/hich", () => ({
  hichCapQuyenHocChoDon: async (orderId: string) => {
    h.hich.push(orderId);
  },
}));
vi.mock("@/lib/payments/tien-webhook-vao-don", () => ({
  tienWebhookCuaDon: async () => ({ soTien: 1_000, soLuot: 1 }),
  duocChuyenDoi: () => true,
  lyDoChuaChuyenDoiDuoc: () => null,
}));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { canonicalPhone } from "@/lib/phone";
import { chuyenDoiDonAction } from "@/app/(admin)/admin/orders/[id]/chuyen-doi/_actions";
import { enrollStudent, transferEnrollment } from "@/app/(admin)/admin/enrollments/_actions";
import { chuyenLopTrongTx } from "@/lib/enrollments/chuyen-lop";
import { approveTransfer } from "@/lib/transfer/service";
import { ganGhiDanhTayVaoQuyenHoc } from "@/lib/enrollments/gan-quyen-hoc-ghi-danh-tay";

if (!RUN_DB_TESTS) console.warn(`[STX] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-stx-";
const CS = `${T}co-so`;
const CS2 = `${T}co-so-2`;
const KA = `${T}khoa-a`;
const KB = `${T}khoa-b`;
const LOP1 = `${T}lop-1`;
const LOP2 = `${T}lop-2`;
const LOP_KHAC_KHOA = `${T}lop-khac-khoa`;
const LOP_KHAC_CS = `${T}lop-khac-co-so`;
const SALE = `${T}sale`;
const SALE_KHAC = `${T}sale-khac`;
const LEAD = `${T}lead`;
const CON = `${T}lead-con`;
const DON = `${T}don`;
const IT = `${T}it`;
const IT2 = `${T}it2`;
const HV = `${T}hv`;
const HV_KHAC = `${T}hv-khac`;
const SDT = "0905333444";
const EMAIL = "stx-phu-huynh@example.test";
const CAC_LOP = [LOP1, LOP2, LOP_KHAC_KHOA, LOP_KHAC_CS];

const actorQuanTri = (): Actor =>
  ({
    userId: h.uid,
    isSuperAdmin: true,
    isHoLevel: true,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) satisfies Actor;

async function don() {
  await db.studyEntitlement.deleteMany({ where: { centerId: { in: [CS, CS2] } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  const gd = await db.enrollment.findMany({ where: { classId: { in: CAC_LOP } }, select: { id: true } });
  const idGd = gd.map((g) => g.id);
  await db.studentTransferRequest.deleteMany({ where: { studentId: { in: [HV, HV_KHAC] } } });
  await db.studentCenterHistory.deleteMany({ where: { studentId: { in: [HV, HV_KHAC] } } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: idGd } } });
  await db.enrollment.updateMany({ where: { id: { in: idGd } }, data: { transferredToId: null, renewedFromEnrollmentId: null } });
  await db.enrollment.deleteMany({ where: { id: { in: idGd } } });
  const sdt = [SDT, canonicalPhone(SDT) ?? SDT];
  await db.student.deleteMany({ where: { OR: [{ id: { in: [HV, HV_KHAC] } }, { parentPhone: { in: sdt } }] } });
  await db.leadChild.deleteMany({ where: { leadId: LEAD } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: [SALE, SALE_KHAC] } }, { email: EMAIL }, { phone: { in: sdt } }] } });
  await db.class.deleteMany({ where: { id: { in: CAC_LOP } } });
  await db.course.deleteMany({ where: { id: { in: [KA, KB] } } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS2] } } });
}

type Tuy = { leadSale?: string | null; coLead?: boolean };

/** Nền: 2 cơ sở, 2 khoá, 4 lớp (lớp 1+2 cùng khoá A cơ sở CS; lớp khác khoá; lớp khác cơ sở), 2 sale. */
async function dungNen() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở STX 1", slug: `${T}cs1`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở STX 2", slug: `${T}cs2`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KA, name: "Sata A fixture STX", slug: `${T}sata-a` } });
  await db.course.create({ data: { id: KB, name: "Sata B fixture STX", slug: `${T}sata-b` } });
  await db.class.create({ data: { id: LOP1, name: "Lớp 1 STX", courseId: KA, centerId: CS } });
  await db.class.create({ data: { id: LOP2, name: "Lớp 2 STX", courseId: KA, centerId: CS } });
  await db.class.create({ data: { id: LOP_KHAC_KHOA, name: "Lớp khác khoá STX", courseId: KB, centerId: CS } });
  await db.class.create({ data: { id: LOP_KHAC_CS, name: "Lớp khác cơ sở STX", courseId: KA, centerId: CS2 } });
  await db.user.create({ data: { id: SALE, name: "Sale chăm lead", email: "stx-sale@example.test", role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  await db.user.create({ data: { id: SALE_KHAC, name: "Sale khác", email: "stx-sale-khac@example.test", role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
}

async function dungDon(t: Tuy = {}) {
  const coLead = t.coLead ?? true;
  if (coLead) {
    await db.lead.create({
      data: { id: LEAD, parentName: "PH fixture STX", phone: SDT, centerId: CS, assignedToId: t.leadSale === undefined ? SALE : t.leadSale },
    });
    await db.leadChild.create({ data: { id: CON, leadId: LEAD, fullName: "Bé Lead Fixture" } });
  }
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269927-000777",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH fixture STX",
      customerPhone: SDT,
      customerEmail: EMAIL,
      totalAmount: 6_000_000,
      centerId: CS,
      leadId: coLead ? LEAD : null,
    },
  });
  await db.orderItem.create({
    data: {
      id: IT,
      orderId: DON,
      studentId: null,
      type: "COURSE_ENROLLMENT",
      itemName: IT,
      quantity: 1,
      unitPrice: 6_000_000,
      totalPrice: 6_000_000,
      metadata: { courseId: KA, ...(coLead ? { leadChildId: CON } : {}) },
    },
  });
}

const chuyenDoi = () =>
  chuyenDoiDonAction({ orderId: DON, dong: [{ orderItemId: IT, tenBe: "Bé Một Fixture", ngaySinh: null, classId: LOP1 }] });

async function hocVien(id: string, saleId: string | null, lop = LOP1, buoiBatDau: number | null = null) {
  await db.student.create({ data: { id, name: `HV ${id}`, studentCode: `${id}-ma`, centerId: CS, parentName: "PH", parentPhone: "0905000111" } });
  const gd = await db.enrollment.create({
    data: { studentId: id, classId: lop, courseId: KA, centerId: CS, status: "STUDYING", saleId, buoiBatDau },
    select: { id: true },
  });
  return gd.id;
}

const quyenHoc = (id: string, studentId: string, extra: Partial<Prisma.StudyEntitlementUncheckedCreateInput> = {}) =>
  db.studyEntitlement.create({
    data: {
      id,
      studentId,
      courseId: KA,
      centerId: CS,
      purchaseKind: "FULL",
      purchaseSessions: 48,
      listAmount: 6_000_000,
      netAmount: 6_000_000,
      pricingSnapshot: {},
      // CHECK `StudyEntitlement_origin_chk`: nguồn PAYMENT phải có đơn + dòng đơn; quyền dựng tay không đơn là LEGACY_BACKFILL.
      origin: extra.orderItemId ? "PAYMENT" : "LEGACY_BACKFILL",
      ...extra,
    },
  });

describe.skipIf(!RUN_DB_TESTS)("[STX-00..] Sale tự xếp / chuyển lớp + ghi danh tay gắn quyền học — Postgres thật", () => {
  beforeEach(() => {
    h.actor = actorQuanTri();
    h.uid = `${T}nguoi-thao-tac`;
    h.quyen = new Set(["enrollments:create", "enrollments:edit", "enrollments:override-progress"]);
    h.hich = [];
  });
  afterAll(don);

  it("[STX-01] Chuyển đổi: sale phụ trách = người chăm LEAD, KHÔNG phải người bấm chốt (admin tạo đơn giùm); Student nối về lead; Enrollment.leadChildId KHÔNG ghi", async () => {
    await dungNen();
    await dungDon({ leadSale: SALE });
    expect(h.uid).not.toBe(SALE); // đối chứng: người bấm khác sale phụ trách
    expect(await chuyenDoi()).toMatchObject({ ok: true, soCon: 1 });

    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: IT }, select: { enrollmentId: true, studentId: true } });
    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: dong.enrollmentId! }, select: { saleId: true, leadChildId: true } });
    expect(gd.saleId).toBe(SALE);
    expect(gd.leadChildId).toBeNull(); // tín hiệu "đã chốt" của báo cáo trial-sale — không thổi phồng
    const hv = await db.student.findUniqueOrThrow({ where: { id: dong.studentId! }, select: { leadId: true, leadChildId: true } });
    expect(hv).toEqual({ leadId: LEAD, leadChildId: CON });
  });

  it("[STX-02] lead chưa có người chăm ⇒ saleId để TRỐNG (không rơi về người bấm); đơn không có lead ⇒ cũng trống, chuyển đổi vẫn thành công", async () => {
    await dungNen();
    await dungDon({ leadSale: null });
    expect(await chuyenDoi()).toMatchObject({ ok: true });
    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: IT }, select: { enrollmentId: true } });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: dong.enrollmentId! }, select: { saleId: true } })).saleId).toBeNull();

    await dungNen();
    await dungDon({ coLead: false });
    expect(await chuyenDoi()).toMatchObject({ ok: true });
    const dong2 = await db.orderItem.findUniqueOrThrow({ where: { id: IT }, select: { enrollmentId: true, studentId: true } });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: dong2.enrollmentId! }, select: { saleId: true } })).saleId).toBeNull();
    expect((await db.student.findUniqueOrThrow({ where: { id: dong2.studentId! }, select: { leadId: true } })).leadId).toBeNull();
  });

  it("[STX-03] Chuyển lớp (quản lý): buoiBatDau + saleId đi theo; quyền học dời sang ghi danh MỚI + lớp mới; KHÔNG chép leadChildId", async () => {
    await dungNen();
    h.quyen = new Set(["enrollments:create", "enrollments:transfer"]);
    const gdCu = await hocVien(HV, SALE, LOP1, 5);
    await quyenHoc(`${T}q1`, HV, { status: "ACTIVE", enrollmentId: gdCu, classId: LOP1, startLessonOrder: 5, endLessonOrder: 52 });

    const kq = await transferEnrollment({ enrollmentId: gdCu, targetClassId: LOP2, reason: "Đổi ca học theo yêu cầu" });
    expect(kq.ok).toBe(true);
    const moi = await db.enrollment.findFirstOrThrow({ where: { studentId: HV, classId: LOP2 }, select: { id: true, buoiBatDau: true, saleId: true, leadChildId: true } });
    expect(moi).toMatchObject({ buoiBatDau: 5, saleId: SALE, leadChildId: null });
    const q = await db.studyEntitlement.findUniqueOrThrow({ where: { id: `${T}q1` }, select: { enrollmentId: true, classId: true, status: true } });
    expect(q).toEqual({ enrollmentId: moi.id, classId: LOP2, status: "ACTIVE" });
  });

  it("[STX-04] Chuyển sang lớp KHÁC KHOÁ (đường F4) ⇒ KHÔNG chép buoiBatDau của khoá cũ, quyền học khoá cũ KHÔNG bị dời", async () => {
    await dungNen();
    const gdCu = await hocVien(HV, SALE, LOP1, 5);
    await quyenHoc(`${T}q1`, HV, { status: "ACTIVE", enrollmentId: gdCu, classId: LOP1 });
    const kq = await db.$transaction((tx) =>
      chuyenLopTrongTx(tx, { oldEnrollmentId: gdCu, targetClassId: LOP_KHAC_KHOA, reason: "Đổi khoá (F4)", actor: { id: null, name: "fixture" } }),
    );
    const moi = await db.enrollment.findUniqueOrThrow({ where: { id: kq.newEnrollmentId }, select: { buoiBatDau: true, saleId: true } });
    expect(moi).toEqual({ buoiBatDau: null, saleId: SALE });
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: `${T}q1` }, select: { enrollmentId: true } })).enrollmentId).toBe(gdCu);
  });

  it("[STX-05] SALE (không có transfer) tự chuyển lớp: học viên CỦA MÌNH cùng khoá + cùng cơ sở ⇒ được, audit ghi rõ Sale tự chuyển", async () => {
    await dungNen();
    h.uid = SALE;
    h.quyen = new Set(["enrollments:create"]);
    const gd = await hocVien(HV, SALE, LOP1);
    const kq = await transferEnrollment({ enrollmentId: gd, targetClassId: LOP2, reason: "Phụ huynh đổi lịch" });
    expect(kq.ok).toBe(true);
    const log = await db.enrollmentAuditLog.findFirstOrThrow({ where: { enrollmentId: gd, toStatus: "TRANSFERRED" }, select: { reason: true } });
    expect(log.reason).toContain("Sale tự chuyển");
  });

  it("[STX-06] SALE bị TỪ CHỐI: học viên của sale KHÁC · lớp khác khoá · lớp khác cơ sở — và không ghi gì (đối chứng dương ở STX-05)", async () => {
    await dungNen();
    h.uid = SALE;
    h.quyen = new Set(["enrollments:create"]);
    const cuaMinh = await hocVien(HV, SALE, LOP1);
    const cuaNguoi = await hocVien(HV_KHAC, SALE_KHAC, LOP1);

    const a = await transferEnrollment({ enrollmentId: cuaNguoi, targetClassId: LOP2, reason: "Thử chuyển người khác" });
    expect(a.ok).toBe(false);
    expect(a.ok ? "" : a.error).toContain("do mình phụ trách");
    const b = await transferEnrollment({ enrollmentId: cuaMinh, targetClassId: LOP_KHAC_KHOA, reason: "Thử đổi khoá" });
    expect(b.ok ? "" : b.error).toContain("khác khoá");
    const c = await transferEnrollment({ enrollmentId: cuaMinh, targetClassId: LOP_KHAC_CS, reason: "Thử đổi cơ sở" });
    expect(c.ok ? "" : c.error).toContain("khác cơ sở");

    expect(await db.enrollment.count({ where: { studentId: { in: [HV, HV_KHAC] }, status: "TRANSFERRED" } })).toBe(0);
    expect(await db.enrollment.count({ where: { classId: { in: [LOP2, LOP_KHAC_KHOA, LOP_KHAC_CS] } } })).toBe(0);
  });

  it("[STX-06b] SALE không chuyển được ghi danh đang CHỜ XẾP LỚP (PENDING, quyền học chưa chốt) — nhưng quản lý thì chuyển được", async () => {
    await dungNen();
    h.uid = SALE;
    h.quyen = new Set(["enrollments:create"]);
    const gd = await hocVien(HV, SALE, LOP1);
    await db.enrollment.update({ where: { id: gd }, data: { status: "PENDING" } });
    const kq = await transferEnrollment({ enrollmentId: gd, targetClassId: LOP2, reason: "Thử chuyển ghi danh chờ xếp" });
    expect(kq.ok ? "" : kq.error).toContain("Chờ xếp lớp");
    expect(await db.enrollment.count({ where: { classId: LOP2 } })).toBe(0);

    h.quyen = new Set(["enrollments:create", "enrollments:transfer"]);
    expect((await transferEnrollment({ enrollmentId: gd, targetClassId: LOP2, reason: "Quản lý chuyển ghi danh chờ xếp" })).ok).toBe(true);
  });

  it("[STX-07] người KHÔNG có cả transfer lẫn create ⇒ từ chối; học viên 'của mình' suy qua phiếu LEAD khi ghi danh chưa gán sale", async () => {
    await dungNen();
    h.uid = SALE;
    h.quyen = new Set();
    const gd = await hocVien(HV, null, LOP1);
    expect(await transferEnrollment({ enrollmentId: gd, targetClassId: LOP2, reason: "Không có quyền" })).toMatchObject({ ok: false, error: "Không có quyền chuyển lớp" });

    // Ghi danh chưa gán sale ⇒ rơi về Sale của phiếu lead (định nghĩa hocVienCuaSale).
    await db.lead.create({ data: { id: LEAD, parentName: "PH", phone: SDT, centerId: CS, assignedToId: SALE } });
    await db.student.update({ where: { id: HV }, data: { leadId: LEAD } });
    h.quyen = new Set(["enrollments:create"]);
    expect(await transferEnrollment({ enrollmentId: gd, targetClassId: LOP2, reason: "Sale của lead" })).toMatchObject({ ok: true });
  });

  it("[STX-08] ghi danh TAY: học viên có đúng MỘT quyền học chờ xếp (cùng khoá) ⇒ dòng đơn nối vào ghi danh + hích; 0 quyền ⇒ như cũ, không hích", async () => {
    await dungNen();
    await dungDon();
    await db.student.create({ data: { id: HV, name: "HV tay", studentCode: `${HV}-ma`, centerId: CS, parentName: "PH", parentPhone: "0905000111" } });
    await quyenHoc(`${T}q1`, HV, { status: "AWAITING_PLACEMENT", orderId: DON, orderItemId: IT });

    const kq = await enrollStudent({ studentId: HV, classId: LOP1 });
    expect(kq).toMatchObject({ ok: true });
    const gdId = kq.ok ? kq.data!.enrollmentId : "";
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: IT }, select: { enrollmentId: true } })).enrollmentId).toBe(gdId);
    expect(h.hich).toEqual([DON]);

    // Đối chứng: học viên không có quyền học chờ xếp ⇒ y như cũ.
    h.hich = [];
    await db.student.create({ data: { id: HV_KHAC, name: "HV tay 2", studentCode: `${HV_KHAC}-ma`, centerId: CS, parentName: "PH", parentPhone: "0905000222" } });
    expect((await enrollStudent({ studentId: HV_KHAC, classId: LOP1 })).ok).toBe(true);
    expect(h.hich).toEqual([]);
  });

  it("[STX-09] KHÔNG ĐOÁN: hai quyền học chờ xếp cùng khoá ⇒ MO_HO, không nối; dòng đơn đã gắn ghi danh khác ⇒ không ghi đè", async () => {
    await dungNen();
    await dungDon();
    await db.orderItem.create({
      data: { id: IT2, orderId: DON, studentId: null, type: "COURSE_ENROLLMENT", itemName: IT2, quantity: 1, unitPrice: 1, totalPrice: 1, metadata: { courseId: KA } },
    });
    await db.student.create({ data: { id: HV, name: "HV tay", studentCode: `${HV}-ma`, centerId: CS, parentName: "PH", parentPhone: "0905000111" } });
    const gd = await db.enrollment.create({ data: { studentId: HV, classId: LOP1, courseId: KA, centerId: CS, status: "STUDYING" }, select: { id: true } });
    const tx = db as unknown as Prisma.TransactionClient;

    await quyenHoc(`${T}q1`, HV, { status: "AWAITING_PLACEMENT", orderId: DON, orderItemId: IT });
    await quyenHoc(`${T}q2`, HV, { status: "AWAITING_PLACEMENT", orderId: DON, orderItemId: IT2 });
    expect(await ganGhiDanhTayVaoQuyenHoc(tx, { studentId: HV, courseId: KA, enrollmentId: gd.id })).toEqual({ kieu: "MO_HO", soQuyen: 2 });
    expect(await db.orderItem.count({ where: { orderId: DON, enrollmentId: { not: null } } })).toBe(0);

    await db.studyEntitlement.update({ where: { id: `${T}q2` }, data: { status: "VOIDED" } });
    const khac = await db.enrollment.create({ data: { studentId: HV, classId: LOP2, courseId: KA, centerId: CS, status: "STUDYING" }, select: { id: true } });
    await db.orderItem.update({ where: { id: IT }, data: { enrollmentId: khac.id } });
    expect(await ganGhiDanhTayVaoQuyenHoc(tx, { studentId: HV, courseId: KA, enrollmentId: gd.id })).toEqual({ kieu: "MO_HO", soQuyen: 1 });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: IT }, select: { enrollmentId: true } })).enrollmentId).toBe(khac.id);
  });

  it("[STX-10] /chuyen-lop (approveTransfer, KHÁC CƠ SỞ): buoiBatDau + saleId đi theo, quyền học dời sang ghi danh mới + lớp mới, nhưng GIỮ cơ sở của ĐƠN (doanh thu); không chép leadChildId", async () => {
    await dungNen();
    const gdCu = await hocVien(HV, SALE, LOP1, 5);
    await quyenHoc(`${T}q1`, HV, { status: "ACTIVE", enrollmentId: gdCu, classId: LOP1, startLessonOrder: 5, endLessonOrder: 52 });
    const yc = await db.studentTransferRequest.create({
      data: { studentId: HV, fromClassId: LOP1, fromCenterId: CS, toClassId: LOP_KHAC_CS, toCenterId: CS2, status: "PENDING", reason: "Chuyển nhà" },
      select: { id: true },
    });

    expect(await approveTransfer(yc.id, null)).toEqual({ ok: true });
    const moi = await db.enrollment.findFirstOrThrow({ where: { studentId: HV, classId: LOP_KHAC_CS }, select: { id: true, buoiBatDau: true, saleId: true, leadChildId: true } });
    expect(moi).toMatchObject({ buoiBatDau: 5, saleId: SALE, leadChildId: null });
    const q = await db.studyEntitlement.findUniqueOrThrow({ where: { id: `${T}q1` }, select: { enrollmentId: true, classId: true, centerId: true, status: true } });
    expect(q).toEqual({ enrollmentId: moi.id, classId: LOP_KHAC_CS, centerId: CS, status: "ACTIVE" });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gdCu }, select: { status: true } })).status).toBe("TRANSFERRED");
  });
});
