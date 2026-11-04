// tests/finance/chinh-sach-p5-chuyen-doi.test.ts — PR5 quyết định 3 ở ĐƯỜNG CHUYỂN ĐỔI ĐƠN (`chuyenDoiDonAction`), Postgres THẬT. Mã ca: [P5-CD-xx].
//
// Chạy:  DATABASE_URL=…/satarobo_test_p5 DIRECT_URL=$DATABASE_URL TEST_DATABASE_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/chinh-sach-p5-chuyen-doi.test.ts
//
// Gọi THẲNG `chuyenDoiDonAction` (chỉ mock cổng ngoài: phiên đăng nhập, quyền, `revalidatePath`, và câu hỏi "đã có tiền webhook chưa"). Hích quyền học là mã THẬT:
// tiền chưa đủ ⇒ ghi danh PENDING; tiền đủ ⇒ cấp quyền + chốt phạm vi + KÍCH HOẠT ngay trong cùng lời gọi. Mỗi ca tự dựng lại (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({ uid: "fx-p5cd-giao-vu" }));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "Giáo vụ fixture" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async () => true, canViewLeadPii: async () => true }));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => actorQuanTri() };
});
vi.mock("@/lib/payments/tien-webhook-vao-don", () => ({
  tienWebhookCuaDon: async () => ({ soTien: 1_000, soLuot: 1 }),
  duocChuyenDoi: () => true,
  lyDoChuaChuyenDoiDuoc: () => null,
}));

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { canonicalPhone } from "@/lib/phone";
import { chuyenDoiDonAction } from "@/app/(admin)/admin/orders/[id]/chuyen-doi/_actions";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";

if (!RUN_DB_TESTS) console.warn(`[P5-CD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-p5cd-";
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const DON = `${T}don`;
const ITEM = `${T}item`;
const SDT = "0905777321";
const EMAIL = "p5cd-phu-huynh@example.test";
const NOW = new Date("2026-10-11T03:00:00Z");
const NGAY = 24 * 60 * 60 * 1000;
const TIEN = 2_640_000;
const DA_XAC_NHAN = "CONFIRMED" as const;

const actorQuanTri = (): Actor => ({
  userId: h.uid,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
});

let CS1 = "";
let OU1 = "";

async function datCo(bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}

async function donDep() {
  const khoan = await db.payment.findMany({ where: { orderId: DON }, select: { id: true } });
  await db.studyEntitlementXuLy.deleteMany({ where: { orderId: DON } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { orderId: DON } } });
  await db.studyEntitlement.deleteMany({ where: { orderId: DON } });
  await db.makeupNeed.deleteMany({ where: { classId: LOP } });
  await db.receipt.deleteMany({ where: { paymentId: { in: khoan.map((k) => k.id) } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityId: DON }, { entityType: "Enrollment" }, { actorName: { startsWith: "Hệ thống — " } }] } });
  await db.payment.updateMany({ where: { orderId: DON }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  const gd = await db.enrollment.findMany({ where: { classId: LOP }, select: { id: true } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: gd.map((g) => g.id) } } });
  await db.enrollment.deleteMany({ where: { id: { in: gd.map((g) => g.id) } } });
  const sdt = [SDT, canonicalPhone(SDT) ?? SDT];
  const hs = await db.student.findMany({ where: { parentPhone: { in: sdt } }, select: { id: true } });
  await db.student.deleteMany({ where: { id: { in: hs.map((s) => s.id) } } });
  await db.user.deleteMany({ where: { OR: [{ email: EMAIL }, { phone: { in: sdt } }] } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.classSessionPlan.deleteMany({ where: { classId: LOP } });
  await db.class.deleteMany({ where: { id: LOP } });
}

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

/** Đơn SCOPE 12 buổi (chưa học viên) hoặc đơn THƯỜNG (metadata cũ, không dấu SCOPE) + lớp đã dạy 3 buổi. */
async function dungFixture(o: { scope: boolean; coTien: boolean }) {
  await donDep();
  await db.class.create({ data: { id: LOP, name: `${T}lop`, courseId: KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
  for (let i = 0; i < 15; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${LOP}-p${i}`, classId: LOP, seq: i + 1, order: i } });
    const qua = i < 3;
    await db.classSession.create({ data: { id: `${LOP}-s${i}`, classId: LOP, centerId: CS1, planId: plan.id, date: qua ? new Date(NOW.getTime() - (4 - i) * NGAY) : new Date(NOW.getTime() + (i - 2) * NGAY), status: qua ? "COMPLETED" : "SCHEDULED" } });
  }
  let metadata: Prisma.InputJsonValue = { courseId: KHOA, soBuoi: 12 };
  if (o.scope) {
    const dong: DongVao = { loai: "COURSE_ENROLLMENT", tenDong: "Sata 3", soLuong: 1, donGiaKhach: TIEN, soKhoanGiam: 0, laLopNhom: true, tongSoBuoiKhoa: 48, soBuoiMua: 12, gia48: 10_560_000, conKhoa: "con-a" };
    const kq = keHoachDon([dong], BOI_CANH);
    const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi: 12 }, KHOA);
    if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: planner không ra SCOPE");
    metadata = md as Prisma.InputJsonValue;
  }
  await db.order.create({
    data: { id: DON, code: `ORD-2699-P5CD-${o.scope ? "S" : "T"}${o.coTien ? "1" : "0"}`, type: "COURSE", status: "PENDING_PAYMENT", customerName: `${T}khach`, customerPhone: SDT, customerEmail: EMAIL, totalAmount: TIEN, subtotal: TIEN, centerId: CS1 },
  });
  await db.orderItem.create({
    data: { id: ITEM, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: TIEN, totalPrice: TIEN, discountAmount: 0, status: "ACTIVE", metadata },
  });
  if (o.coTien) {
    await db.payment.create({ data: { orderId: DON, orderItemId: ITEM, amount: TIEN, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: DA_XAC_NHAN, centerId: CS1 } });
  }
}
const chuyenDoi = (buoiBatDau?: number) =>
  chuyenDoiDonAction({ orderId: DON, dong: [{ orderItemId: ITEM, tenBe: `${T}Bé thử`, classId: LOP, ...(buoiBatDau ? { buoiBatDau } : {}) }] });
const ghiDanhCua = () => db.enrollment.findFirstOrThrow({ where: { classId: LOP } });

describe.skipIf(!RUN_DB_TESTS)("[P5-CD] chuyển đổi đơn: quyền học TRƯỚC, ghi danh active SAU — Postgres THẬT", () => {
  beforeAll(async () => {
    // `chuyenDoiDonAction` đọc đồng hồ thật (`new Date()`) để xét "buổi đã qua" — đóng băng CHỈ `Date` ở NOW (luật 19), không giả timer khác (Prisma cần).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await db.course.upsert({ where: { id: KHOA }, create: { id: KHOA, name: "Sata 3 (fixture P5CD)", slug: KHOA, price: 10_560_000, totalSessions: 48 }, update: { price: 10_560_000, totalSessions: 48 } });
  });
  beforeEach(async () => {
    await datCo(true);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await donDep();
    await datCo(null);
    await db.course.deleteMany({ where: { id: KHOA } });
  });

  it("[P5-CD-01] cờ BẬT + dòng SCOPE + tiền CHƯA đủ ⇒ ghi danh PENDING (không STUDYING), không quyền học, hàng đợi có dòng CHO_XEP_LOP", async () => {
    await dungFixture({ scope: true, coTien: false });
    expect(await chuyenDoi()).toMatchObject({ ok: true, soCon: 1 });
    const gd = await ghiDanhCua();
    expect(gd.status).toBe("PENDING");
    // [28/10/2026] dòng phạm vi mua KHÔNG trọn (12/48): Sale chọn buổi bắt đầu, mặc định 37 (tổng − mua + 1) — lưu NGUYÊN cho quyền học đọc (NULL = không ai chọn).
    expect(gd.buoiBatDau).toBe(37);
    expect(await db.studyEntitlement.count({ where: { orderId: DON } })).toBe(0);
    const [cho] = await db.studyEntitlementXuLy.findMany({ where: { orderId: DON, loai: "CHO_XEP_LOP" } });
    expect(cho).toMatchObject({ trangThai: "OPEN", orderItemId: ITEM });
    expect(cho!.lyDo).toMatch(/chưa có quyền học hợp lệ/);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: ITEM }, select: { enrollmentId: true } })).toMatchObject({ enrollmentId: gd.id });
  });

  it("[P5-CD-02] cờ BẬT + dòng SCOPE + tiền ĐỦ, Sale chọn buổi 4 ⇒ cấp quyền, chốt phạm vi 4–15 rồi MỚI kích hoạt ghi danh (PENDING → STUDYING, đúng buổi bắt đầu), có nhật ký trạng thái", async () => {
    await dungFixture({ scope: true, coTien: true });
    expect(await chuyenDoi(4)).toMatchObject({ ok: true });
    const gd = await ghiDanhCua();
    expect(gd).toMatchObject({ status: "STUDYING", buoiBatDau: 4 });
    const [q] = await db.studyEntitlement.findMany({ where: { orderId: DON } });
    expect(q).toMatchObject({ status: "ACTIVE", enrollmentId: gd.id, startLessonOrder: 4, endLessonOrder: 15 });
    expect(await db.enrollmentAuditLog.findMany({ where: { enrollmentId: gd.id }, select: { fromStatus: true, toStatus: true } })).toEqual([{ fromStatus: "PENDING", toStatus: "STUDYING" }]);
  });

  it("[P5-CD-03] cờ TẮT ⇒ NGUYÊN CHỮ: ghi danh STUDYING ngay, buoiBatDau 37 (luật 'học các buổi cuối' cũ), không nhật ký trạng thái, không quyền học", async () => {
    await datCo(false);
    await dungFixture({ scope: true, coTien: true });
    expect(await chuyenDoi()).toMatchObject({ ok: true });
    const gd = await ghiDanhCua();
    expect(gd).toMatchObject({ status: "STUDYING" });
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: gd.id } })).toBe(0);
    expect(await db.studyEntitlement.count({ where: { orderId: DON } })).toBe(0);
  });

  it("[P5-CD-04] ĐƠN THƯỜNG (không dấu SCOPE) khi cờ BẬT ⇒ STUDYING ngay như cũ, không nhật ký trạng thái, không dòng hàng đợi", async () => {
    await dungFixture({ scope: false, coTien: true });
    expect(await chuyenDoi()).toMatchObject({ ok: true });
    const gd = await ghiDanhCua();
    expect(gd.status).toBe("STUDYING");
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: gd.id } })).toBe(0);
    expect(await db.studyEntitlementXuLy.count({ where: { orderId: DON } })).toBe(0);
  });
});
