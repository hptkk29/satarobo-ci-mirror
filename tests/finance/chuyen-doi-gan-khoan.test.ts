// tests/finance/chuyen-doi-gan-khoan.test.ts — [CDK-*] CHUYỂN ĐỔI ĐƠN PHẢI GẮN KHOẢN ĐÃ THU VÀO GHI DANH (#666), Postgres THẬT.
//
// Chạy:  pnpm test:finance-db   (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// Gọi THẲNG `chuyenDoiDonAction` (chỉ mock cổng ngoài: phiên đăng nhập, quyền, `revalidatePath`, hích quyền học và câu hỏi
// "đã có tiền webhook chưa" — nó cần cả chuỗi BankTransaction→PaymentAllocation, không liên quan thứ đang đo). Mọi thứ còn
// lại là mã THẬT: scopedDb, transaction, tạo học viên/ghi danh, planner gắn khoản.
//
// Fixture mang HÌNH DẠNG THẬT của luồng đơn (đo 15/09, `chia-khoan-theo-don.ts`): dòng đơn `studentId` NULL + `metadata.courseId`;
// đơn KHÔNG có `leadId`; `Enrollment.finalPrice` NULL ngay sau chuyển đổi (⇒ đường lùi chia ĐỀU, khác phép chia theo tiền dòng —
// nhờ vậy ca 2 bé phân biệt được "đúng bé" với "chia bừa"). `[CDK-00]` kiểm chính fixture.
//
// KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({ actor: null as unknown as Actor, uid: "fx-cdk-giao-vu" }));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: h.uid, name: "Giáo vụ fixture" } }),
}));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async () => true }));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => h.actor };
});
vi.mock("@/lib/entitlements/hich", () => ({ hichCapQuyenHocChoDon: vi.fn() }));
vi.mock("@/lib/payments/tien-webhook-vao-don", () => ({
  tienWebhookCuaDon: async () => ({ soTien: 1_000, soLuot: 1 }),
  duocChuyenDoi: () => true,
  lyDoChuaChuyenDoiDuoc: () => null,
}));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { canonicalPhone } from "@/lib/phone";
import { confirmPayment, ganGhiDanhChoKhoanCuaDon } from "@/lib/finance/payment";
import { ganKhoanSauChuyenDoi } from "@/lib/finance/gan-khoan-sau-chuyen-doi";
import { chuyenDoiDonAction } from "@/app/(admin)/admin/orders/[id]/chuyen-doi/_actions";

if (!RUN_DB_TESTS) console.warn(`[CDK] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-cdk-";
const CS = `${T}co-so`;
const KA = `${T}khoa-a`;
const KB = `${T}khoa-b`;
const LA = `${T}lop-a`;
const LB = `${T}lop-b`;
const DON = `${T}don`;
const IT_A = `${T}it-a`;
const IT_B = `${T}it-b`;
const KE_TOAN = `${T}ke-toan`;
const SDT = "0905777123";
const EMAIL = "cdk-phu-huynh@example.test";
/** Hằng thay literal trạng thái kế toán: lưới [BUOC-6] (lib/finance/truc-a.test.ts) cấm cặp đó ngoài debt.ts. */
const DA_XAC_NHAN = "CONFIRMED" as const;

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
/** Người cấp CƠ SỞ: mọi đọc qua `scopedDb` bị lọc theo `centerId` — đúng cái mà đường vá phải chịu được. */
const actorCoSo = (): Actor => ({ ...actorQuanTri(), isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [CS] });

async function don() {
  const khoan = await db.payment.findMany({ where: { orderId: DON }, select: { id: true } });
  const idKhoan = khoan.map((k) => k.id);
  await db.receipt.deleteMany({ where: { paymentId: { in: idKhoan } } });
  await db.domainEvent.deleteMany({ where: { OR: idKhoan.map((id) => ({ dedupeKey: { contains: id } })) } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityId: { in: idKhoan } }] } });
  await db.payment.updateMany({ where: { orderId: DON }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  const gd = await db.enrollment.findMany({ where: { classId: { in: [LA, LB] } }, select: { id: true, studentId: true } });
  await db.enrollment.deleteMany({ where: { id: { in: gd.map((g) => g.id) } } });
  const sdt = [SDT, canonicalPhone(SDT) ?? SDT];
  const hs = await db.student.findMany({ where: { parentPhone: { in: sdt } }, select: { id: true } });
  await db.student.deleteMany({ where: { id: { in: hs.map((s) => s.id) } } });
  await db.user.deleteMany({ where: { OR: [{ email: EMAIL }, { phone: { in: sdt } }] } });
  await db.class.deleteMany({ where: { id: { in: [LA, LB] } } });
  await db.course.deleteMany({ where: { id: { in: [KA, KB] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Dấu SCOPE hợp lệ (đủ để `docPhamViDong` nhận ra) — chỉ dùng cho ca "đơn phạm vi". */
const phamVi = (courseId: string, thanhTien: number) => ({
  courseId,
  soBuoi: 48,
  phamVi: {
    phienBan: 1,
    loaiMua: "FULL",
    soBuoiMua: 48,
    niemYet: thanhTien,
    giamGia: 0,
    thanhTien,
    donGiaMoiBuoi: null,
    pricingSnapshot: { soBuoi: 48, thanhTien, gia48: thanhTien },
  },
});

type Dong = { id: string; courseId: string; gia: number; phamVi?: boolean };

async function dungFixture(dong: Dong[]) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture CDK", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.course.create({ data: { id: KA, name: "Sata A fixture", slug: `${T}sata-a` } });
  await db.course.create({ data: { id: KB, name: "Sata B fixture", slug: `${T}sata-b` } });
  await db.class.create({ data: { id: LA, name: "Lớp A fixture", courseId: KA, centerId: CS } });
  await db.class.create({ data: { id: LB, name: "Lớp B fixture", courseId: KB, centerId: CS } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269927-000601",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH fixture CDK",
      customerPhone: SDT,
      customerEmail: EMAIL,
      totalAmount: dong.reduce((s, d) => s + d.gia, 0),
      centerId: CS,
    },
  });
  for (const d of dong) {
    await db.orderItem.create({
      data: {
        id: d.id,
        orderId: DON,
        studentId: null,
        type: "COURSE_ENROLLMENT",
        itemName: d.id,
        quantity: 1,
        unitPrice: d.gia,
        totalPrice: d.gia,
        metadata: d.phamVi ? phamVi(d.courseId, d.gia) : { courseId: d.courseId },
      },
    });
  }
}

const khoan = (
  id: string,
  amount: number,
  ketoan: "PENDING" | typeof DA_XAC_NHAN = "PENDING",
  centerId: string | null = CS,
) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "BANK_TRANSFER",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: "RECORDED",
      accountantStatus: ketoan,
      centerId,
    },
  });

const cacKhoan = () => db.payment.findMany({ where: { orderId: DON, deletedAt: null }, orderBy: { id: "asc" } });
const chuyen = (...dong: { it: string; ten: string; lop: string }[]) =>
  chuyenDoiDonAction({
    orderId: DON,
    dong: dong.map((d) => ({ orderItemId: d.it, tenBe: d.ten, ngaySinh: null, classId: d.lop })),
  });
const BE_A = { it: IT_A, ten: "Bé Một Fixture", lop: LA };
const BE_B = { it: IT_B, ten: "Bé Hai Fixture", lop: LB };
const ghiDanhCuaDong = async (it: string) =>
  (await db.orderItem.findUniqueOrThrow({ where: { id: it }, select: { enrollmentId: true } })).enrollmentId;

describe.skipIf(!RUN_DB_TESTS)("[CDK-00..10] Chuyển đổi đơn gắn khoản đã thu vào ghi danh — Postgres thật", () => {
  beforeEach(() => {
    h.actor = actorQuanTri();
  });
  afterAll(don);

  it("[CDK-00] fixture mang hình dạng thật: đơn KHÔNG leadId, dòng KHÔNG học viên + có khoá, khoản chưa gắn ghi danh", async () => {
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p1`, 3_000_000);
    const o = await db.order.findUniqueOrThrow({ where: { id: DON }, select: { leadId: true, items: true } });
    expect(o.leadId).toBeNull();
    expect(o.items[0]).toMatchObject({ studentId: null, enrollmentId: null, metadata: { courseId: KA } });
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([null]);
  });

  it("[CDK-01] khoản PENDING có sẵn ⇒ gắn đúng ghi danh ⇒ kế toán XÁC NHẬN được ⇒ có Receipt (đơn KHÔNG leadId)", async () => {
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p1`, 3_000_000);
    await khoan(`${T}p2`, 3_000_000);

    const kq = await chuyen(BE_A);
    expect(kq).toMatchObject({ ok: true, soCon: 1 });

    const gd = await ghiDanhCuaDong(IT_A);
    expect(gd).not.toBeNull();
    const ds = await cacKhoan();
    expect(ds.map((p) => p.enrollmentId)).toEqual([gd, gd]);
    expect(ds.reduce((s, p) => s + p.amount, 0)).toBe(6_000_000);

    const xn = await confirmPayment({ paymentId: `${T}p1`, confirmedById: KE_TOAN });
    expect(xn.ok).toBe(true);
    const bienLai = await db.receipt.findMany({ where: { paymentId: `${T}p1` } });
    expect(bienLai).toHaveLength(1);
    expect(bienLai[0]!.enrollmentId).toBe(gd);
  });

  it("[CDK-02] đơn 2 bé chuyển cùng lúc ⇒ mỗi khoản chia theo TIỀN DÒNG, đúng bé (không rơi đường lùi chia đều)", async () => {
    await dungFixture([
      { id: IT_A, courseId: KA, gia: 4_000_000 },
      { id: IT_B, courseId: KB, gia: 2_000_000 },
    ]);
    await khoan(`${T}p1`, 3_000_000);

    expect(await chuyen(BE_A, BE_B)).toMatchObject({ ok: true, soCon: 2 });

    const gdA = (await ghiDanhCuaDong(IT_A))!;
    const gdB = (await ghiDanhCuaDong(IT_B))!;
    expect(gdA).not.toBe(gdB);
    const ds = await cacKhoan();
    expect(ds).toHaveLength(2);
    const theoGd = new Map(ds.map((p) => [p.enrollmentId, p.amount]));
    // Đường lùi (finalPrice cùng NULL ⇒ chia đều) sẽ ra 1.500.000 / 1.500.000.
    expect(theoGd.get(gdA)).toBe(2_000_000);
    expect(theoGd.get(gdB)).toBe(1_000_000);
    expect(ds.reduce((s, p) => s + p.amount, 0)).toBe(3_000_000);
  });

  it("[CDK-03] đơn 2 bé, chỉ chuyển MỘT bé ⇒ CHƯA gắn (không đẩy cả khoản về bé đó); chuyển nốt bé kia ⇒ chia đúng", async () => {
    await dungFixture([
      { id: IT_A, courseId: KA, gia: 4_000_000 },
      { id: IT_B, courseId: KB, gia: 2_000_000 },
    ]);
    await khoan(`${T}p1`, 3_000_000);

    expect(await chuyen(BE_A)).toMatchObject({ ok: true, soCon: 1 });
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([null]);

    expect(await chuyen(BE_B)).toMatchObject({ ok: true, soCon: 1 });
    const gdA = (await ghiDanhCuaDong(IT_A))!;
    const gdB = (await ghiDanhCuaDong(IT_B))!;
    const theoGd = new Map((await cacKhoan()).map((p) => [p.enrollmentId, p.amount]));
    expect(theoGd.get(gdA)).toBe(2_000_000);
    expect(theoGd.get(gdB)).toBe(1_000_000);
  });

  it("[CDK-04] đơn PHẠM VI có khoản ĐÃ XÁC NHẬN chưa gắn ⇒ chuyển đổi VẪN THÀNH CÔNG; khoản đó nằm yên, khoản chờ thì gắn", async () => {
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000, phamVi: true }]);
    await khoan(`${T}p-xn`, 3_000_000, DA_XAC_NHAN);
    await khoan(`${T}p-cho`, 3_000_000);

    const kq = await chuyen(BE_A);
    expect(kq).toMatchObject({ ok: true, soCon: 1 });

    const gd = await ghiDanhCuaDong(IT_A);
    const ds = new Map((await cacKhoan()).map((p) => [p.id, p]));
    expect(ds.get(`${T}p-xn`)).toMatchObject({ enrollmentId: null, amount: 3_000_000, accountantStatus: DA_XAC_NHAN });
    expect(ds.get(`${T}p-cho`)).toMatchObject({ enrollmentId: gd, amount: 3_000_000 });
  });

  it("[CDK-05] đơn THƯỜNG có khoản đã xác nhận chưa gắn (dữ liệu lạ) ⇒ cũng KHÔNG làm hỏng lượt chuyển đổi, và không bị sửa", async () => {
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p-xn`, 6_000_000, DA_XAC_NHAN);

    expect(await chuyen(BE_A)).toMatchObject({ ok: true, soCon: 1 });
    expect(await ghiDanhCuaDong(IT_A)).not.toBeNull();
    expect((await cacKhoan())[0]).toMatchObject({ enrollmentId: null, amount: 6_000_000, accountantStatus: DA_XAC_NHAN });
  });

  it("[CDK-06] người cấp CƠ SỞ (mọi đọc qua scopedDb bị lọc theo cơ sở) cũng gắn được — không chỉ Quản trị tối cao", async () => {
    h.actor = actorCoSo();
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p1`, 6_000_000);

    expect(await chuyen(BE_A)).toMatchObject({ ok: true, soCon: 1 });
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([await ghiDanhCuaDong(IT_A)]);
  });

  it("[CDK-07] idempotent: chạy lại bước gắn khi không còn khoản chưa gắn ⇒ không đổi gì, không tách thêm", async () => {
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p1`, 6_000_000);
    await chuyen(BE_A);
    const truoc = await cacKhoan();

    const lai = await db.$transaction((tx) => ganKhoanSauChuyenDoi(tx, { orderId: DON, actor: { id: KE_TOAN, name: "KT" } }));
    expect(lai).toEqual({ daChay: true, linked: 0, splitCreated: 0, boQua: 0 });
    expect(await cacKhoan()).toEqual(truoc);
  });

  it("[CDK-08] nhật ký CONVERT ghi lại kết quả gắn khoản (kế toán lần ngược được vì sao khoản gắn / chưa gắn)", async () => {
    await dungFixture([
      { id: IT_A, courseId: KA, gia: 4_000_000 },
      { id: IT_B, courseId: KB, gia: 2_000_000 },
    ]);
    await khoan(`${T}p1`, 3_000_000);
    await chuyen(BE_A);
    await chuyen(BE_B);

    const nhatKy = await db.auditLog.findMany({
      where: { entityType: "Order", entityId: DON, action: "CONVERT" },
      orderBy: { createdAt: "asc" },
    });
    const g = nhatKy.map((n) => (n.newValues as { ganKhoan?: Record<string, unknown> }).ganKhoan);
    expect(g[0]).toMatchObject({ daChay: false, lyDo: "CON_DONG_CHUA_CHUYEN", soDongChuaChuyen: 1 });
    expect(g[1]).toMatchObject({ daChay: true, linked: 1, splitCreated: 1 });
  });

  it("[CDK-09] MẶC ĐỊNH của hàm gắn (NEM) vẫn NÉM khi khoản ĐÃ XÁC NHẬN phải TÁCH tiền (đơn 2 bé) — không bao giờ sửa `amount` của tiền đã đối soát; chỉ Chuyển đổi mới xin BO_QUA", async () => {
    await dungFixture([
      { id: IT_A, courseId: KA, gia: 4_000_000 },
      { id: IT_B, courseId: KB, gia: 2_000_000 },
    ]);
    await khoan(`${T}p-xn`, 3_000_000, DA_XAC_NHAN);
    // Chuyển đổi xin BO_QUA ⇒ khoản đã xác nhận nằm yên chưa gắn.
    expect(await chuyen(BE_A, BE_B)).toMatchObject({ ok: true, soCon: 2 });
    expect((await cacKhoan())[0]).toMatchObject({ enrollmentId: null, amount: 3_000_000, accountantStatus: DA_XAC_NHAN });
    // Gắn lại bằng hàm mặc định: phép chia 4:2 đòi tách 2.000.000 / 1.000.000 ⇒ NÉM, không đổi gì.
    await expect(
      db.$transaction((tx) => ganGhiDanhChoKhoanCuaDon(tx, { orderId: DON, actor: { id: KE_TOAN, name: "KT" } })),
    ).rejects.toThrow(/ĐÃ XÁC NHẬN/);
    expect((await cacKhoan())[0]).toMatchObject({ enrollmentId: null, amount: 3_000_000, accountantStatus: DA_XAC_NHAN });
  });

  it("[CDK-09b] #969 — khoản ĐÃ XÁC NHẬN mà GẮN NGUYÊN được (đơn 1 bé) ⇒ hàm gắn mặc định CHỈ điền `enrollmentId`: số tiền, trạng thái, ngày thu, ghi chú giữ nguyên; có AuditLog; chạy lại không làm gì", async () => {
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p-xn`, 6_000_000, DA_XAC_NHAN);
    expect(await chuyen(BE_A)).toMatchObject({ ok: true, soCon: 1 });
    const gd = (await ghiDanhCuaDong(IT_A))!;
    const truoc = (await cacKhoan())[0]!;
    expect(truoc.enrollmentId, "Chuyển đổi (BO_QUA) để nguyên").toBeNull();

    const kq = await db.$transaction((tx) => ganGhiDanhChoKhoanCuaDon(tx, { orderId: DON, actor: { id: KE_TOAN, name: "KT" } }));
    expect(kq).toMatchObject({ linked: 1, splitCreated: 0 });
    const sau = (await cacKhoan())[0]!;
    expect(sau).toMatchObject({ enrollmentId: gd, amount: 6_000_000, accountantStatus: DA_XAC_NHAN, saleStatus: "RECORDED", note: truoc.note });
    expect(sau.paidDate.toISOString()).toBe(truoc.paidDate.toISOString());
    expect(await cacKhoan(), "không thêm Payment").toHaveLength(1);
    const nk = await db.auditLog.findFirst({ where: { entityType: "Payment", entityId: `${T}p-xn`, action: "UPDATE" } });
    expect(nk?.newValues).toMatchObject({ enrollmentId: gd, source: "gan-sau-convert" });

    const lai = await db.$transaction((tx) => ganGhiDanhChoKhoanCuaDon(tx, { orderId: DON, actor: { id: KE_TOAN, name: "KT" } }));
    expect(lai).toMatchObject({ linked: 0, splitCreated: 0 });
    expect((await cacKhoan())[0]).toEqual(sau);
  });

  it("[CDK-10] GIỚI HẠN ĐÃ BIẾT: khoản `centerId` NULL không hiện với người cấp cơ sở ⇒ nằm yên; đường KHÔNG scope (script vá dữ liệu cũ) gắn được", async () => {
    h.actor = actorCoSo();
    await dungFixture([{ id: IT_A, courseId: KA, gia: 6_000_000 }]);
    await khoan(`${T}p1`, 6_000_000, "PENDING", null);

    expect(await chuyen(BE_A)).toMatchObject({ ok: true, soCon: 1 });
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([null]);

    const gd = await ghiDanhCuaDong(IT_A);
    const sau = await db.$transaction((tx) => ganKhoanSauChuyenDoi(tx, { orderId: DON, actor: { id: KE_TOAN, name: "KT" } }));
    expect(sau).toMatchObject({ daChay: true, linked: 1 });
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([gd]);
  });
});
