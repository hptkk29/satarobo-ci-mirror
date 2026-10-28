// tests/finance/chuyen-doi-hoc-vuot-db.test.ts — [CDH-*] CHUYỂN ĐỔI ĐƠN: buổi bắt đầu do Sale nhập, lớp theo vai, HỌC VƯỢT BÙ chờ QLCS duyệt,
// đồng ý hình ảnh, hồ sơ bé + phụ huynh ghi vào học viên, Quản trị tối cao đổi buổi bắt đầu (chủ dự án 27/10/2026), Postgres THẬT.
//
// Chạy:  pnpm test:finance-db   (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// Gọi THẲNG `chuyenDoiDonAction` / `doiBuoiBatDauAction` / `duyetYeuCauHocVuot` — chỉ mock cổng ngoài (phiên, quyền theo TẬP đặt tay, actor, revalidate, hích quyền học,
// câu hỏi tiền webhook). KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố id; mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  actor: null as unknown as Actor,
  uid: "fx-cdh-nguoi-thao-tac",
  quyen: new Set<string>(),
}));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "Người thao tác fixture" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: async (k: string) => h.quyen.has(k),
  canViewLeadPii: async () => h.quyen.has("leads:view-pii"),
  assertPermission: async (k: string) => {
    if (!h.quyen.has(k)) throw new Error(`thiếu ${k}`);
  },
}));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => h.actor };
});
vi.mock("@/lib/entitlements/hich", () => ({ hichCapQuyenHocChoDon: async () => undefined }));
vi.mock("@/lib/payments/tien-webhook-vao-don", () => ({
  tienWebhookCuaDon: async () => ({ soTien: 1_000, soLuot: 1 }),
  duocChuyenDoi: (t: { soTien: number }) => t.soTien > 0,
  lyDoChuaChuyenDoiDuoc: () => "chưa có tiền",
}));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { canonicalPhone } from "@/lib/phone";
import { chuyenDoiDonAction, doiBuoiBatDauAction } from "@/app/(admin)/admin/orders/[id]/chuyen-doi/_actions";
import { duyetYeuCauHocVuot, tuChoiYeuCauHocVuot } from "@/lib/orders/hoc-vuot-chuyen-doi";

if (!RUN_DB_TESTS) console.warn(`[CDH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-cdh-";
const CS = `${T}co-so`;
const CS2 = `${T}co-so-2`;
const KA = `${T}khoa`;
const LOP = `${T}lop`;
const LOP_CS2 = `${T}lop-cs2`;
const DON = `${T}don`;
const IT = `${T}it`;
const SDT = "0905777888";
const EMAIL = "cdh-phu-huynh@example.test";
const NOW = new Date();
const NGAY = 24 * 3600_000;

const actor = (): Actor =>
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

const SALE_Q = ["enrollments:create"];
const QLCS_Q = ["enrollments:create", "makeup:waive"];
const ADMIN_Q = ["enrollments:create", "enrollments:override-progress", "makeup:waive"];

async function don() {
  const sdt = [SDT, canonicalPhone(SDT) ?? SDT];
  const sv = await db.student.findMany({ where: { OR: [{ parentPhone: { in: sdt } }, { name: { startsWith: "Bé CDH" } }] }, select: { id: true } });
  const ids = sv.map((s) => s.id);
  await db.enrollmentCatchUpRequest.deleteMany({ where: { orderId: DON } });
  await db.makeupCreditEntry.deleteMany({ where: { account: { studentId: { in: ids } } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: { in: ids } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: ids } } });
  await db.studentConsent.deleteMany({ where: { studentId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  const gd = await db.enrollment.findMany({ where: { classId: { in: [LOP, LOP_CS2] } }, select: { id: true } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: gd.map((g) => g.id) } } });
  await db.enrollment.deleteMany({ where: { id: { in: gd.map((g) => g.id) } } });
  await db.student.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { OR: [{ email: EMAIL }, { phone: { in: sdt } }] } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP_CS2] } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { in: [LOP, LOP_CS2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP_CS2] } } });
  await db.course.deleteMany({ where: { id: KA } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS2] } } });
}

async function dungLop(id: string, centerId: string, daDay: number) {
  await db.class.create({ data: { id, name: `Lớp ${id}`, courseId: KA, centerId, status: "ACTIVE", maxStudents: 12 } });
  for (let i = 0; i < daDay + 4; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${id}-p${i}`, classId: id, seq: i + 1, order: i } });
    await db.classSession.create({
      data: {
        id: `${id}-s${i}`,
        classId: id,
        centerId,
        planId: plan.id,
        date: i < daDay ? new Date(NOW.getTime() - (daDay - i + 1) * NGAY) : new Date(NOW.getTime() + (i - daDay + 1) * NGAY),
        status: i < daDay ? "COMPLETED" : "SCHEDULED",
      },
    });
  }
}

/** Nền: 2 cơ sở, khoá 48 buổi, lớp `LOP` ở CS đã dạy `daDay` buổi, lớp `LOP_CS2` ở CS2 (chưa dạy), đơn mua `soBuoi` buổi ở CS. */
async function dungNen(daDay: number, soBuoi: number | null = null) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở CDH 1", slug: `${T}cs1`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở CDH 2", slug: `${T}cs2`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KA, name: "Sata CDH fixture", slug: `${T}sata`, totalSessions: 48 } });
  await dungLop(LOP, CS, daDay);
  await dungLop(LOP_CS2, CS2, 0);
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269927-000888",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH fixture CDH",
      customerPhone: SDT,
      customerEmail: EMAIL,
      totalAmount: 6_000_000,
      centerId: CS,
    },
  });
  await db.orderItem.create({
    data: {
      id: IT,
      orderId: DON,
      type: "COURSE_ENROLLMENT",
      itemName: IT,
      quantity: 1,
      unitPrice: 6_000_000,
      totalPrice: 6_000_000,
      metadata: { courseId: KA, coachFormat: "GROUP", ...(soBuoi ? { soBuoi } : {}) },
    },
  });
}

const dongGui = (extra: Record<string, unknown> = {}) => ({ orderItemId: IT, tenBe: "Bé CDH Một", classId: LOP, ...extra });

describe.skipIf(!RUN_DB_TESTS)("[CDH-00..] Chuyển đổi: buổi bắt đầu · học vượt bù · duyệt · đồng ý hình ảnh — Postgres thật", () => {
  beforeEach(() => {
    h.actor = actor();
    h.uid = `${T}nguoi-thao-tac`;
    h.quyen = new Set(SALE_Q);
  });
  afterAll(don);

  it("[CDH-01] SALE chọn lớp đã học 3 buổi cho bé mua đủ khoá: bắt buộc tích học vượt + số buổi bù; thiếu ⇒ từ chối, KHÔNG ghi gì", async () => {
    await dungNen(3);
    const kq = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui()] });
    expect(kq).toMatchObject({ ok: false });
    expect((kq as { error: string }).error).toMatch(/học vượt/);
    expect(await db.enrollment.count({ where: { classId: LOP } })).toBe(0);
    expect(await db.student.count({ where: { name: "Bé CDH Một" } })).toBe(0);
  });

  it("[CDH-02] SALE khai b = 2 ≤ v = 3 ⇒ ghi danh tạo, yêu cầu PENDING (v 3, b 2), CHƯA có dòng cần bù, CHƯA cộng lượt", async () => {
    await dungNen(3);
    const kq = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 2 } })] });
    expect(kq).toMatchObject({ ok: true, soCon: 1, soPhieuHocBu: 0, soChoDuyet: 1 });
    const yc = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
    expect(yc).toMatchObject({ status: "PENDING", startLesson: 1, sessionsToCatchUp: 3, makeupSessions: 2, centerId: CS });
    expect(await db.makeupNeed.count({ where: { studentId: yc.studentId } })).toBe(0);
    expect(await db.makeupCreditEntry.count({ where: { account: { studentId: yc.studentId } } })).toBe(0);
  });

  it("[CDH-03] QLCS tự chuyển đổi ⇒ yêu cầu APPROVED ngay: 3 dòng cần bù ORDER_CONVERSION + bút toán +2 lượt `ADJUSTMENT:hocvuot:<id>`", async () => {
    await dungNen(3);
    h.quyen = new Set(QLCS_Q);
    const kq = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 2 } })] });
    expect(kq).toMatchObject({ ok: true, soPhieuHocBu: 3, soChoDuyet: 0 });
    const yc = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
    expect(yc.status).toBe("APPROVED");
    const needs = await db.makeupNeed.findMany({ where: { studentId: yc.studentId }, select: { sourceType: true, status: true } });
    expect(needs).toHaveLength(3);
    expect(needs.every((n) => n.sourceType === "ORDER_CONVERSION" && n.status === "PENDING")).toBe(true);
    const ent = await db.makeupCreditEntry.findFirstOrThrow({ where: { idemKey: `ADJUSTMENT:hocvuot:${yc.id}` } });
    expect(ent.grantedDelta).toBe(2);
  });

  it("[CDH-04] DUYỆT yêu cầu PENDING: sinh dòng cần bù + cộng b lượt; duyệt lần hai ⇒ từ chối, không nhân đôi", async () => {
    await dungNen(3);
    await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 2 } })] });
    const yc = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
    const r1 = await db.$transaction((tx) => duyetYeuCauHocVuot(tx, yc.id, { id: null, name: "QLCS fixture" }, new Date()));
    expect(r1).toMatchObject({ ok: true, soDongBu: 3, luotCong: 2 });
    const r2 = await db.$transaction((tx) => duyetYeuCauHocVuot(tx, yc.id, { id: null, name: "QLCS fixture" }, new Date()));
    expect(r2).toMatchObject({ ok: false });
    expect(await db.makeupNeed.count({ where: { studentId: yc.studentId } })).toBe(3);
    expect(await db.makeupCreditEntry.count({ where: { idemKey: `ADJUSTMENT:hocvuot:${yc.id}` } })).toBe(1);
  });

  it("[CDH-05] TỪ CHỐI cần lý do ≥ 10 ký tự; từ chối xong KHÔNG sinh dòng cần bù, KHÔNG cộng lượt, ghi danh giữ nguyên", async () => {
    await dungNen(3);
    await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 2 } })] });
    const yc = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
    expect(await db.$transaction((tx) => tuChoiYeuCauHocVuot(tx, yc.id, { id: null, name: "QLCS" }, new Date(), "ngắn"))).toMatchObject({ ok: false });
    expect(await db.$transaction((tx) => tuChoiYeuCauHocVuot(tx, yc.id, { id: null, name: "QLCS" }, new Date(), "Phụ huynh đổi sang lớp khác, không học vượt"))).toMatchObject({ ok: true });
    expect((await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: yc.id } })).status).toBe("REJECTED");
    expect(await db.makeupNeed.count({ where: { studentId: yc.studentId } })).toBe(0);
    expect(await db.enrollment.count({ where: { studentId: yc.studentId, classId: LOP } })).toBe(1);
  });

  it("[CDH-06] b vượt v (4 > 3) hoặc b = 0 ⇒ từ chối", async () => {
    await dungNen(3);
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 4 } })] })).toMatchObject({ ok: false });
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 0 } })] })).toMatchObject({ ok: false });
    expect(await db.enrollment.count({ where: { classId: LOP } })).toBe(0);
  });

  it("[CDH-07] TRẦN mặc định 6: lớp đã học 7 buổi ⇒ SALE bị từ chối; QLCS xếp được (tự duyệt); lớp CƠ SỞ KHÁC: Sale/QLCS bị từ chối, Quản trị tối cao xếp được", async () => {
    await dungNen(7);
    const sale = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 3 } })] });
    expect(sale).toMatchObject({ ok: false });
    expect((sale as { error: string }).error).toMatch(/quá trần 6/);

    h.quyen = new Set(QLCS_Q);
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ classId: LOP_CS2 })] })).toMatchObject({ ok: false }); // lớp CS2 không nằm trong danh sách của vai QLCS
    const ql = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ hocVuot: { soBuoiBu: 3 } })] });
    expect(ql).toMatchObject({ ok: true, soPhieuHocBu: 7 });
  });

  it("[CDH-08] Quản trị tối cao xếp được lớp của cơ sở KHÁC với đơn (lớp CS2, chưa dạy ⇒ không phải bù)", async () => {
    await dungNen(0);
    h.quyen = new Set(ADMIN_Q);
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ classId: LOP_CS2 })] })).toMatchObject({ ok: true, soCon: 1, soChoDuyet: 0 });
    expect((await db.enrollment.findFirstOrThrow({ where: { classId: LOP_CS2 } })).status).toBe("STUDYING");
  });

  it("[CDH-09] Đơn mua 24 buổi: Sale nhập buổi bắt đầu ngoài [1, 25] ⇒ từ chối; bắt đầu 13 ⇒ lưu `Enrollment.buoiBatDau = 13`", async () => {
    await dungNen(0, 24);
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ buoiBatDau: 26 })] })).toMatchObject({ ok: false });
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ buoiBatDau: 13 })] })).toMatchObject({ ok: true });
    expect((await db.enrollment.findFirstOrThrow({ where: { classId: LOP } })).buoiBatDau).toBe(13);
  });

  it("[CDH-10] Lớp đã học 14 buổi, bé mua 24 buổi bắt đầu buổi 13: chỉ phải bù 2 buổi (không phải 14) — buổi bắt đầu quyết số buổi bù", async () => {
    await dungNen(14, 24);
    const kq = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ buoiBatDau: 13, hocVuot: { soBuoiBu: 2 } })] });
    expect(kq).toMatchObject({ ok: true, soChoDuyet: 1 });
    expect(await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } })).toMatchObject({ startLesson: 13, sessionsToCatchUp: 2, makeupSessions: 2 });
  });

  it("[CDH-11] Đồng ý hình ảnh: tick ⇒ StudentConsent CLASS_MEDIA GRANTED + audit; không tick ⇒ không có dòng; consent đã THU HỒI không bị lật", async () => {
    await dungNen(0);
    await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ dongYHinhAnh: true })] });
    const hv = await db.student.findFirstOrThrow({ where: { name: "Bé CDH Một" } });
    expect(await db.studentConsent.findUnique({ where: { studentId_type: { studentId: hv.id, type: "CLASS_MEDIA" } } })).toMatchObject({ status: "GRANTED" });
    expect(await db.auditLog.count({ where: { entityType: "StudentConsent", entityId: hv.id, action: "CONSENT_GRANTED_AT_CONVERT" } })).toBe(1);

    await dungNen(0);
    await chuyenDoiDonAction({ orderId: DON, dong: [dongGui()] });
    const hv2 = await db.student.findFirstOrThrow({ where: { name: "Bé CDH Một" } });
    expect(await db.studentConsent.count({ where: { studentId: hv2.id } })).toBe(0);
  });

  it("[CDH-12] Thông tin bé + phụ huynh nhập ở màn chuyển đổi được GHI vào học viên (giới tính, lớp ở trường, trường, ngày sinh, quan hệ, địa chỉ…)", async () => {
    await dungNen(0);
    const kq = await chuyenDoiDonAction({
      orderId: DON,
      phuHuynh: { ten: "Phụ huynh Đã Sửa", email: EMAIL, quanHe: "Mẹ", gioiTinh: "FEMALE", ngaySinh: "1990-05-20", facebook: "https://facebook.com/ph", diaChi: "12 Lê Lợi", tinh: "Đà Nẵng", phuong: "Hải Châu" },
      dong: [dongGui({ ngaySinh: "2017-03-09", gioiTinh: "MALE", lopTruong: 3, truong: "Tiểu học Trần Văn Ơn" })],
    });
    expect(kq).toMatchObject({ ok: true });
    const hv = await db.student.findFirstOrThrow({ where: { name: "Bé CDH Một" } });
    expect(hv).toMatchObject({
      gender: "MALE",
      currentGrade: 3,
      school: "Tiểu học Trần Văn Ơn",
      parentName: "Phụ huynh Đã Sửa",
      parentRelation: "Mẹ",
      parentGender: "FEMALE",
      parentFacebookUrl: "https://facebook.com/ph",
      address: "12 Lê Lợi",
      city: "Đà Nẵng",
      ward: "Hải Châu",
    });
    expect(hv.dateOfBirth?.toISOString().slice(0, 10)).toBe("2017-03-09");
    expect(hv.parentDob?.toISOString().slice(0, 10)).toBe("1990-05-20");
  });

  it("[CDH-13] Quản trị tối cao ĐỔI buổi bắt đầu 1 → 3 (đơn 24 buổi, lớp đã học 3 buổi) sau khi đã duyệt học vượt: bù 3 → 1, lượt cộng 2 → 1, dòng cần bù buổi 1–2 bị gỡ, Enrollment.buoiBatDau = 3; đơn MUA ĐỦ khoá thì từ chối (chỉ buổi 1)", async () => {
    await dungNen(3, 24);
    h.quyen = new Set(QLCS_Q);
    await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ buoiBatDau: 1, hocVuot: { soBuoiBu: 2 } })] });
    const yc0 = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
    const gd = await db.enrollment.findFirstOrThrow({ where: { studentId: yc0.studentId, classId: LOP } });

    // Không phải Quản trị tối cao ⇒ từ chối
    expect(await doiBuoiBatDauAction({ orderId: DON, enrollmentId: gd.id, buoiBatDau: 3, lyDo: "Phụ huynh xin dời sang học từ buổi 3" })).toMatchObject({ ok: false });

    h.quyen = new Set(ADMIN_Q);
    const kq = await doiBuoiBatDauAction({ orderId: DON, enrollmentId: gd.id, buoiBatDau: 3, lyDo: "Phụ huynh xin dời sang học từ buổi 3" });
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, buoiBatDau: 3, canBu: 1 });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gd.id } })).buoiBatDau).toBe(3);
    const yc = await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: yc0.id } });
    expect(yc).toMatchObject({ status: "APPROVED", startLesson: 3, sessionsToCatchUp: 1, makeupSessions: 1 });
    const sau = await db.makeupNeed.findMany({ where: { studentId: yc.studentId, status: { not: "CANCELLED" } } });
    expect(sau).toHaveLength(1);
    const delta = await db.makeupCreditEntry.findMany({ where: { idemKey: { startsWith: `ADJUSTMENT:hocvuot:${yc.id}` } }, select: { grantedDelta: true } });
    expect(delta.reduce((s, e) => s + e.grantedDelta, 0)).toBe(1); // +2 lúc duyệt, −1 lúc đổi
  });

  it("[CDH-14] Đổi buổi bắt đầu về nơi không còn phải bù (lớp đã học 3, bắt đầu buổi 5) ⇒ yêu cầu CANCELLED, rút hết lượt đã cộng", async () => {
    await dungNen(3, 24);
    h.quyen = new Set(QLCS_Q);
    await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ buoiBatDau: 1, hocVuot: { soBuoiBu: 3 } })] });
    const yc0 = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
    const gd = await db.enrollment.findFirstOrThrow({ where: { studentId: yc0.studentId, classId: LOP } });
    h.quyen = new Set(ADMIN_Q);
    expect(await doiBuoiBatDauAction({ orderId: DON, enrollmentId: gd.id, buoiBatDau: 5, lyDo: "Dời bé sang học từ buổi 5 theo ý phụ huynh" })).toMatchObject({ ok: true, canBu: 0 });
    expect((await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: yc0.id } })).status).toBe("CANCELLED");
    expect(await db.makeupNeed.count({ where: { studentId: yc0.studentId, status: { not: "CANCELLED" } } })).toBe(0);
    const delta = await db.makeupCreditEntry.findMany({ where: { idemKey: { startsWith: `ADJUSTMENT:hocvuot:${yc0.id}` } }, select: { grantedDelta: true } });
    expect(delta.reduce((s, e) => s + e.grantedDelta, 0)).toBe(0);
  });

  it("[CDH-15] Dòng đơn đã chuyển đổi ⇒ không chuyển đổi lần hai; ghi danh không thuộc đơn ⇒ không đổi buổi bắt đầu được", async () => {
    await dungNen(0);
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui()] })).toMatchObject({ ok: true });
    expect(await chuyenDoiDonAction({ orderId: DON, dong: [dongGui()] })).toMatchObject({ ok: false });
    h.quyen = new Set(ADMIN_Q);
    expect(await doiBuoiBatDauAction({ orderId: DON, enrollmentId: "khong-ton-tai", buoiBatDau: 1, lyDo: "Lý do đủ dài để qua cổng" })).toMatchObject({ ok: false });
  });
});
