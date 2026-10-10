// Ca [GHD-*] — GẮN GHI DANH cho khoản chưa gắn (GĐ 8b hoá đơn điện tử, PLAN Q-mở 8) trên Postgres THẬT.
//
// Fixture mang HÌNH DẠNG THẬT của luồng lead (đo 15/09 + GĐ 0):
//   · dòng đơn lập từ `/orders/new?leadId=` có `studentId` NULL + `metadata.courseId`;
//   · SĐT trên đơn dạng nội địa `0905…`, SĐT phụ huynh trên học viên dạng `84905…` (di sản chuẩn hoá cũ)
//     ⇒ ứng viên chỉ tìm ra nếu tra bằng `expandPhoneVariants`.
// `[GHD-00]` kiểm chính fixture — thiếu nó thì mọi ca dưới có thể xanh vì không tìm ra ứng viên nào.
//
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  ensureOrderPaymentRecorded,
  ganGhiDanhChoKhoanCuaDon,
  napGanGhiDanhCuaDon,
  thucHienKeHoachGan,
} from "@/lib/finance/payment";
import { lapKeHoachGanGhiDanh } from "@/lib/finance/ke-hoach-gan-ghi-danh";
import {
  ganGhiDanhTuManHoaDon,
  LoiGanGhiDanh,
  napXemTruocGanGhiDanh,
} from "@/lib/finance/hoa-don/gan-ghi-danh";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import type { Actor } from "@/lib/auth/actor";

if (!RUN_DB_TESTS) console.warn(`[GHD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ghd-";
const CS = `${T}center`;
const CS2 = `${T}center2`;
const K4 = `${T}sata4`;
const K3 = `${T}sata3`;
const L4 = `${T}lop4`;
const L4B = `${T}lop4b`;
const L3 = `${T}lop3`;
const HS1 = `${T}hs1`;
const HS2 = `${T}hs2`;
const GD1 = `${T}gd1`;
const DON = `${T}don`;
const P1 = `${T}p1`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SDT_DON = "0905123987";
const SDT_HV = "84905123987";

async function don() {
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityType: "Payment", newValues: { path: ["splitFrom"], string_starts_with: T } }] } });
  const cacKhoan = await db.payment.findMany({ where: { orderId: DON }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityId: { in: cacKhoan.map((k) => k.id) } } });
  await db.payment.updateMany({ where: { orderId: DON }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { in: [L4, L4B, L3] } } });
  await db.course.deleteMany({ where: { id: { in: [K4, K3] } } });
  await db.student.deleteMany({ where: { id: { in: [HS1, HS2] } } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS2] } } });
}

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture GHD", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở 2 fixture GHD", slug: `${T}co-so-2`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: K4, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.course.create({ data: { id: K3, name: "Sata 3 fixture", slug: `${T}sata-3` } });
  await db.class.create({ data: { id: L4, name: "S4 fixture A", courseId: K4, centerId: CS } });
  await db.class.create({ data: { id: L4B, name: "S4 fixture B", courseId: K4, centerId: CS } });
  await db.class.create({ data: { id: L3, name: "S3 fixture", courseId: K3, centerId: CS } });
  await db.student.create({ data: { id: HS1, name: "Nguyễn Bé Một", parentPhone: SDT_HV } });
  await db.student.create({ data: { id: HS2, name: "Nguyễn Bé Hai", parentPhone: SDT_HV } });
  await ghiDanh(GD1, HS1, L4, K4);
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269927-000501",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH fixture GHD",
      customerPhone: SDT_DON,
      totalAmount: 6_000_000,
      centerId: CS,
    },
  });
  await db.orderItem.create({
    data: {
      id: `${T}it1`,
      orderId: DON,
      studentId: null,
      type: "COURSE_ENROLLMENT",
      itemName: "Sata 4",
      quantity: 1,
      unitPrice: 6_000_000,
      totalPrice: 6_000_000,
      metadata: { courseId: K4 },
    },
  });
}

const ghiDanh = (id: string, studentId: string, classId: string, courseId: string, centerId: string = CS) =>
  db.enrollment.create({ data: { id, studentId, classId, courseId, finalPrice: 6_000_000, centerId } });

const khoan = (
  id: string,
  amount: number,
  o: { adjustmentOfId?: string; paymentType?: "PAYMENT" | "ADJUSTMENT"; accountantStatus?: "PENDING" | "CONFIRMED" } = {},
) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "BANK_TRANSFER",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: "RECORDED",
      accountantStatus: o.accountantStatus ?? "PENDING",
      centerId: CS,
      paymentType: o.paymentType ?? "PAYMENT",
      adjustmentOfId: o.adjustmentOfId ?? null,
    },
  });
const ganTuDong = () => db.$transaction((tx) => ganGhiDanhChoKhoanCuaDon(tx, { orderId: DON, actor: KT }));
const cacKhoan = () => db.payment.findMany({ where: { orderId: DON, deletedAt: null }, orderBy: { createdAt: "asc" } });

describe.skipIf(!RUN_DB_TESTS)("[GHD-00..03] gắn ghi danh — đường tự động, Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[GHD-00] fixture mang hình dạng thật: dòng đơn KHÔNG học viên + khoá; SĐT 0… trên đơn, 84… trên học viên; vẫn tìm ra ứng viên", async () => {
    const it0 = await db.orderItem.findUniqueOrThrow({ where: { id: `${T}it1` } });
    expect(it0.studentId).toBeNull();
    expect(it0.metadata).toEqual({ courseId: K4 });
    expect(SDT_DON.startsWith("0") && SDT_HV.startsWith("84")).toBe(true);
    await khoan(P1, 3_000_000);
    const d = await db.$transaction((tx) => napGanGhiDanhCuaDon(tx, DON));
    expect(d?.coHocVien).toBe(true);
    expect(d?.ghiDanh.map((g) => g.enrollmentId)).toEqual([GD1]);
    expect(d?.khoan.map((k) => k.id)).toEqual([P1]);
  });

  it("[GHD-01] cùng MỘT kế hoạch chạy HAI lần (đua) ⇒ lượt sau đổi 0 dòng, KHÔNG tách chồng", async () => {
    await ghiDanh(`${T}gd2`, HS2, L4, K4); // hai bé cùng khoá ⇒ kế hoạch TÁCH
    await khoan(P1, 3_000_000);
    const d = (await db.$transaction((tx) => napGanGhiDanhCuaDon(tx, DON)))!;
    const kh = lapKeHoachGanGhiDanh({ ...d, trongTam: () => true });
    expect(kh.dong[0]).toMatchObject({ ketQua: "TACH" });

    const lan1 = await db.$transaction((tx) => thucHienKeHoachGan(tx, d, kh, KT, "test-dua"));
    expect(lan1).toEqual({ linked: 1, splitCreated: 1, doi: [] });
    const lan2 = await db.$transaction((tx) => thucHienKeHoachGan(tx, d, kh, KT, "test-dua"));
    expect(lan2).toEqual({ linked: 0, splitCreated: 0, doi: [P1] });

    const ds = await cacKhoan();
    expect(ds).toHaveLength(2);
    expect(ds.reduce((s, p) => s + p.amount, 0)).toBe(3_000_000);
    expect(new Set(ds.map((p) => p.enrollmentId))).toEqual(new Set([GD1, `${T}gd2`]));
  });

  it("[GHD-02] đường tự động (ghi nhận tiền): bé có HAI ghi danh cùng khoá ⇒ để TRỐNG; đối chứng: một ghi danh ⇒ gắn", async () => {
    await ghiDanh(`${T}gd1b`, HS1, L4B, K4);
    const r = await db.$transaction((tx) =>
      ensureOrderPaymentRecorded(tx, { orderId: DON, soDot: 1, amount: 3_000_000, centerId: CS, actor: KT }),
    );
    expect(r).toMatchObject({ ok: true, created: true });
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([null]);

    await dungFixture();
    await db.$transaction((tx) =>
      ensureOrderPaymentRecorded(tx, { orderId: DON, soDot: 1, amount: 3_000_000, centerId: CS, actor: KT }),
    );
    expect((await cacKhoan()).map((p) => p.enrollmentId)).toEqual([GD1]);
  });

  it("[GHD-03] khoản chờ đã bị ĐẢO (ròng 0) ⇒ KHÔNG gắn; đối chứng: chưa đảo ⇒ gắn", async () => {
    await khoan(P1, 3_000_000);
    await khoan(`${T}p1-dao`, -3_000_000, { adjustmentOfId: P1, paymentType: "ADJUSTMENT" });
    await ganTuDong();
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).enrollmentId).toBeNull();

    await dungFixture();
    await khoan(P1, 3_000_000);
    await ganTuDong();
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).enrollmentId).toBe(GD1);
  });
});

// ─── Đường THỦ CÔNG từ màn hoá đơn ────────────────────────────────────────────────────────────

/** Actor tối thiểu đúng hình dạng `actionCenterScope` đọc (quyền `payments:confirm` neo ở đâu). */
const keToan = (centerScope: "ALL" | string[]): Actor =>
  ({
    userId: KT.id,
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
  }) as unknown as Actor;
const KT_CS1 = keToan([CS]);
const KT_HO = keToan("ALL");

const xem = (actor: Actor = KT_CS1) => napXemTruocGanGhiDanh({ actor, orderId: DON, lanThuKey: "k", khoanTrongLanThu: [P1] });
const ganTay = (dau: string, actor: Actor = KT_CS1) =>
  ganGhiDanhTuManHoaDon({ actor, nguoiGhi: KT, orderId: DON, lanThuKey: "k", dauKeHoach: dau });
const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return "KHONG_NEM";
  } catch (e) {
    return e instanceof LoiGanGhiDanh ? e.ma : `LA:${String(e)}`;
  }
};
const HD = `${T}hd`;
const nhap = (paymentId: string) =>
  db.hoaDonDienTu.create({
    data: {
      id: HD,
      orderId: DON,
      centerId: CS,
      trangThai: "NHAP",
      kyHieu: "1C26TSR",
      soHoaDon: "951",
      ngayPhatHanh: new Date("2026-09-20T00:00:00Z"),
      tepPdfKey: `hoa-don/CS1/2026/${DON}/u.pdf`,
      tepPdfTen: "hd.pdf",
      guiEmailKhach: false,
      tongTien: 3_000_000,
      taoBoiId: KT.id,
      khoan: { create: [{ paymentId, soTien: 3_000_000 }] },
    },
  });
const soNhatKyGan = () => db.auditLog.count({ where: { entityId: DON, action: "GAN_GHI_DANH_KHOAN" } });

describe.skipIf(!RUN_DB_TESTS)("[GHD-04..08] gắn ghi danh — đường THỦ CÔNG từ màn hoá đơn, Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[GHD-04] khoản đang nằm trong bản NHÁP, một bé ⇒ gắn giữ nguyên số tiền + dòng nối; rồi chốt ⇒ CONFIRMED + đúng MỘT phiếu thu", async () => {
    await khoan(P1, 3_000_000);
    await nhap(P1);
    const xt = (await xem())!;
    expect(xt).toMatchObject({ soGan: 1, soTach: 0, chan: null });
    expect(xt.dong[0]).toMatchObject({ ketQua: "GAN", trongLanThu: true, dich: [{ ten: "Nguyễn Bé Một", khoa: "Sata 4 fixture", lop: "S4 fixture A" }] });

    expect(await ganTay(xt.dau)).toEqual({ gan: 1, tach: 0, boQua: 0 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: P1 } });
    expect(p).toMatchObject({ enrollmentId: GD1, amount: 3_000_000 });
    expect(await db.hoaDonKhoan.findMany({ where: { paymentId: P1 }, select: { soTien: true, hieuLuc: true } })).toEqual([
      { soTien: 3_000_000, hieuLuc: true },
    ]);
    expect(await db.auditLog.count({ where: { entityId: P1, action: "UPDATE", newValues: { path: ["source"], equals: "man-hoa-don" } } })).toBe(1);
    expect(await soNhatKyGan()).toBe(1);

    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD }, select: { updatedAt: true } });
    const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
    await chotHoaDon({
      nguoiChot: KT,
      actor: KT_CS1,
      orderId: DON,
      hoaDonId: HD,
      now: new Date("2699-09-26T08:00:00Z"),
      phienBan: hd.updatedAt,
      emailDuKien: nguoiMuaChoDon(donHt).email,
    });
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe("CONFIRMED");
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(1);
  });

  it("[GHD-04b] đối chứng: KHÔNG gắn mà chốt ⇒ khoản vẫn CHỜ, câu nói đúng chỗ gắn", async () => {
    await khoan(P1, 3_000_000);
    await nhap(P1);
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD }, select: { updatedAt: true } });
    const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
    // Học viên bị xoá ⇒ không ghi danh nào ⇒ chốt không tự gắn được.
    await db.enrollment.deleteMany({ where: { id: GD1 } });
    const kq = await chotHoaDon({
      nguoiChot: KT,
      actor: KT_CS1,
      orderId: DON,
      hoaDonId: HD,
      now: new Date("2699-09-26T08:00:00Z"),
      phienBan: hd.updatedAt,
      emailDuKien: nguoiMuaChoDon(donHt).email,
    });
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe("PENDING");
    expect(kq.conCho[0]?.lyDo).toMatch(/mục 'Gắn ghi danh' trên dòng này/);
  });

  it("[GHD-05] hai bé + khoản đang khoá ⇒ không gắn được (0 ghi); đối chứng: gỡ bản nháp ⇒ TÁCH, tổng đúng", async () => {
    await ghiDanh(`${T}gd2`, HS2, L4, K4);
    await khoan(P1, 3_000_000);
    await nhap(P1);
    const xt = (await xem())!;
    expect(xt).toMatchObject({ soGan: 0, soTach: 0 });
    expect(xt.dong[0]?.lyDo).toMatch(/hoá đơn nháp 1C26TSR-951 — gỡ bản nháp/);
    expect(await maLoi(ganTay(xt.dau))).toBe("KHONG_GAN_DUOC");
    expect(await cacKhoan()).toHaveLength(1);
    expect(await soNhatKyGan()).toBe(0);

    await db.hoaDonDienTu.deleteMany({ where: { id: HD } });
    const moi = (await xem())!;
    expect(moi).toMatchObject({ soTach: 1 });
    expect(await ganTay(moi.dau)).toMatchObject({ tach: 1 });
    const ds = await cacKhoan();
    expect(ds).toHaveLength(2);
    expect(ds.reduce((t, x) => t + x.amount, 0)).toBe(3_000_000);
  });

  it("[GHD-06] kế hoạch đã XEM cũ (có ghi danh mới) ⇒ KE_HOACH_DA_DOI, 0 ghi; xem lại ⇒ gắn được", async () => {
    await khoan(P1, 3_000_000);
    const cu = (await xem())!;
    await ghiDanh(`${T}gd2`, HS2, L4, K4); // kế hoạch đổi từ GAN sang TÁCH
    expect(await maLoi(ganTay(cu.dau))).toBe("KE_HOACH_DA_DOI");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).enrollmentId).toBeNull();
    expect(await soNhatKyGan()).toBe(0);
    const moi = (await xem())!;
    expect(moi.dau).not.toBe(cu.dau);
    expect(await maLoi(ganTay(moi.dau))).toBe("KHONG_NEM");
  });

  it("[GHD-07] ghi danh ở CS2, kế toán CS1 ⇒ ngoài phạm vi: không tên, không ghi; kế toán Hội sở ⇒ gắn được", async () => {
    await db.enrollment.update({ where: { id: GD1 }, data: { centerId: CS2 } });
    await khoan(P1, 3_000_000);
    const xt = (await xem(KT_CS1))!;
    expect(xt.dong[0]).toMatchObject({ ketQua: "BO_QUA", dich: [], lyDo: expect.stringMatching(/ngoài phạm vi kế toán/) });
    expect(JSON.stringify(xt)).not.toContain("Nguyễn Bé Một");
    expect(await maLoi(ganTay(xt.dau, KT_CS1))).toBe("KHONG_GAN_DUOC");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).enrollmentId).toBeNull();

    const ho = (await xem(KT_HO))!;
    expect(ho.soGan).toBe(1);
    expect(await ganTay(ho.dau, KT_HO)).toMatchObject({ gan: 1 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).enrollmentId).toBe(GD1);
  });

  it("[GHD-08] đơn có khoản ĐÃ XÁC NHẬN mà chưa gắn ⇒ CO_KHOAN_DA_XAC_NHAN (lỗi có mã, không phải Error trần), 0 ghi", async () => {
    await khoan(P1, 3_000_000);
    await khoan(`${T}p-xn`, 1_000_000, { accountantStatus: "CONFIRMED" });
    const xt = (await xem())!;
    expect(xt.chan).toMatch(/dữ liệu lệch/);
    expect(await maLoi(ganTay(xt.dau))).toBe("CO_KHOAN_DA_XAC_NHAN");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).enrollmentId).toBeNull();
    expect(await soNhatKyGan()).toBe(0);
  });
});
