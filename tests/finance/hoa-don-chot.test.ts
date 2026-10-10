// Ca [HDC-*] — CHỐT HOÁ ĐƠN (bước ⑤) + LÕI XÁC NHẬN KHOẢN trên Postgres THẬT.
// docs/ke-toan-hoa-don/PLAN.md §4 ⑤ + §0.1 phương án (b) + "Điều chỉnh sau GĐ 0" mục 1.
//
//   · Chốt = hoá đơn NHAP → DA_XAC_NHAN. Khoản còn CHỜ mà đủ điều kiện ⇒ xác nhận + RCP cùng lượt;
//     không đủ (thiếu ghi danh / AC5) ⇒ GIỮ CHỜ, hoá đơn VẪN chốt.
//   · Mọi cổng đứng trước phép ghi đầu tiên: từ chối ⇒ KHÔNG ghi gì (hoá đơn vẫn NHAP, khoản vẫn CHỜ).
//   · Bấm đôi ⇒ đúng MỘT lượt thắng, một phiếu RCP, một lượt email.
//   · Lõi `xacNhanKhoanTrongTx` (qua `confirmPayment`): AC5 + tiền ròng > 0 nay nằm ở lõi.
//
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chotHoaDon, LoiChotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { confirmPayment } from "@/lib/finance/payment";
import { gatewayMarker, installmentMarker } from "@/lib/finance/payment-markers";

if (!RUN_DB_TESTS) console.warn(`[HDC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdc-";
const CS = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const HD = `${T}hd`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SALE = `${T}sale`;
const P_OK = `${T}p-ok`;
const P_NOGD = `${T}p-nogd`;
const P_TU = `${T}p-tu`;
const NOW = new Date("2699-09-26T08:00:00Z");
/** Cơ sở THỨ HAI — chỉ là mã trên `Payment.centerId` (cột trần, không khoá ngoại). */
const CS2 = `${T}center-2`;
const DOT = `${T}dot1`;
const BT = `${T}bt1`;
const TXN = `${T}txn-dot1`;
const P_CK = `${T}p-ck-dot`;

/** Actor tối thiểu đúng hình dạng `actionCenterScope` đọc (quyền `payments:confirm` neo ở đâu). */
const keToan = (centerScope: "ALL" | string[]): Actor =>
  ({
    userId: KT.id,
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
  }) as unknown as Actor;
/** Kế toán CỦA cơ sở giữ đơn — đúng người mà cổng action (`congKeToanDon`) cho qua. */
const KT_CS = keToan([CS]);
const KT_HO = keToan("ALL");

async function don() {
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS } });
}

const khoan = (id: string, amount: number, o: { enrollmentId?: string | null; recordedById?: string | null } = {}) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "BANK_TRANSFER",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      enrollmentId: o.enrollmentId === undefined ? GD : o.enrollmentId,
      recordedById: o.recordedById === undefined ? SALE : o.recordedById,
      centerId: CS,
    },
  });

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDC", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HDC", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Bé HDC" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  await db.order.create({
    data: { id: DON, code: "ORD-269926-000201", type: "COURSE", status: "CONFIRMED", customerName: "PH HDC", customerPhone: "0999000888", totalAmount: 9_000_000, centerId: CS },
  });
}

/**
 * Hoá đơn NHÁP đủ tệp + số, giữ các khoản cho trước. GĐ 8: email nhận hoá đơn là email HIỆN TẠI của ĐƠN
 * lúc chốt ⇒ `emailNhan` của fixture được đặt lên ĐƠN (invoiceEmail); bản nháp giữ bản chụp cũ.
 */
const nhap = async (
  ids: string[],
  o: Partial<{ emailNhan: string | null; guiEmailKhach: boolean; soHoaDon: string | null; soTien: number }> = {},
) => {
  await db.order.update({ where: { id: DON }, data: { invoiceEmail: o.emailNhan === undefined ? "ph@example.com" : o.emailNhan } });
  return db.hoaDonDienTu.create({
    data: {
      id: HD,
      orderId: DON,
      centerId: CS,
      trangThai: "NHAP",
      kyHieu: "1C26TSR",
      soHoaDon: o.soHoaDon === undefined ? "901" : o.soHoaDon,
      ngayPhatHanh: new Date("2026-09-20T00:00:00Z"),
      tepPdfKey: `hoa-don/CS1/2026/${DON}/u.pdf`,
      tepPdfTen: "hd.pdf",
      emailNhan: o.emailNhan === undefined ? "ph@example.com" : o.emailNhan,
      guiEmailKhach: o.guiEmailKhach ?? true,
      tongTien: (o.soTien ?? 3_000_000) * ids.length,
      taoBoiId: KT.id,
      khoan: { create: ids.map((paymentId) => ({ paymentId, soTien: o.soTien ?? 3_000_000 })) },
    },
  });
};

/** Như action thật: phiên bản bản nháp + email hiện tại của đơn đọc ngay trước khi bấm. */
async function chot(actor: Actor = KT_CS) {
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: HD }, select: { updatedAt: true } });
  const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
  return chotHoaDon({
    nguoiChot: KT,
    actor,
    orderId: DON,
    hoaDonId: HD,
    now: NOW,
    phienBan: hd?.updatedAt ?? new Date(0),
    emailDuKien: nguoiMuaChoDon(donHt).email,
  });
}

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiChotHoaDon ? e.ma : String(e);
  }
}

describe.skipIf(!RUN_DB_TESTS)("[HDC] chốt hoá đơn — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDC-01] đường vui: hoá đơn ĐÃ XÁC NHẬN · khoản CHỜ ⇒ CONFIRMED + đúng MỘT phiếu RCP · một lượt email", async () => {
    await khoan(P_OK, 3_000_000);
    await nhap([P_OK]);
    const kq = await chot();

    expect(kq.daXacNhan.map((x) => x.paymentId)).toEqual([P_OK]);
    expect(kq.daXacNhan[0]!.receiptCode).toMatch(/^RCP-/);
    expect(kq.conCho).toEqual([]);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).toMatchObject({
      trangThai: "DA_XAC_NHAN",
      xacNhanBoiId: KT.id,
    });
    expect(await db.payment.findUniqueOrThrow({ where: { id: P_OK } })).toMatchObject({
      accountantStatus: "CONFIRMED",
      confirmedById: KT.id,
    });
    expect(await db.receipt.count({ where: { paymentId: P_OK } })).toBe(1);
    const email = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId: HD } });
    expect(email.map((e) => [e.lanGui, e.toi, e.trangThai])).toEqual([[1, "ph@example.com", "CHO"]]);
    expect(await db.auditLog.count({ where: { entityId: HD, action: "XAC_NHAN_HOA_DON" } })).toBe(1);
  });

  it("[HDC-02] khoản thiếu ghi danh + khoản do CHÍNH kế toán ghi ⇒ hoá đơn VẪN chốt, hai khoản GIỮ CHỜ, không phiếu", async () => {
    await khoan(P_NOGD, 3_000_000, { enrollmentId: null });
    await khoan(P_TU, 3_000_000, { recordedById: KT.id });
    await nhap([P_NOGD, P_TU]);
    const kq = await chot();

    expect(kq.daXacNhan).toEqual([]);
    expect(kq.conCho.map((c) => c.paymentId).sort()).toEqual([P_NOGD, P_TU].sort());
    expect(kq.conCho.find((c) => c.paymentId === P_TU)!.lyDo).toMatch(/chính bạn/);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
    const ps = await db.payment.findMany({ where: { id: { in: [P_NOGD, P_TU] } }, select: { accountantStatus: true } });
    expect(ps.map((p) => p.accountantStatus)).toEqual(["PENDING", "PENDING"]);
    expect(await db.receipt.count({ where: { paymentId: { in: [P_NOGD, P_TU] } } })).toBe(0);
  });

  it("[HDC-03] bỏ tick gửi email / khách không có email ⇒ KHÔNG có lượt gửi", async () => {
    await khoan(P_OK, 3_000_000);
    await nhap([P_OK], { guiEmailKhach: false });
    await chot();
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);

    await dungFixture();
    await khoan(P_OK, 3_000_000);
    await nhap([P_OK], { emailNhan: null });
    await chot();
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);
  });

  it("[HDC-04] hai kế toán bấm CÙNG LÚC ⇒ đúng một lượt thắng, một phiếu RCP, một lượt email", async () => {
    await khoan(P_OK, 3_000_000);
    await nhap([P_OK]);
    const kq = await Promise.allSettled([chot(), chot()]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((k): k is PromiseRejectedResult => k.status === "rejected")!;
    expect((thua.reason as LoiChotHoaDon).ma).toBe("DA_DOI");
    expect(await db.receipt.count({ where: { paymentId: P_OK } })).toBe(1);
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(1);
  });

  it("[HDC-05] tiền của khoản ĐỔI sau khi lưu nháp (bút toán đảo) ⇒ TIEN_DA_DOI, KHÔNG ghi gì", async () => {
    await khoan(P_OK, 3_000_000);
    await nhap([P_OK]);
    await db.payment.create({
      data: {
        id: `${T}p-dao`,
        orderId: DON,
        amount: -1_000_000,
        method: "BANK_TRANSFER",
        paidDate: new Date("2699-09-21T03:00:00Z"),
        paymentType: "ADJUSTMENT",
        adjustmentOfId: P_OK,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        centerId: CS,
      },
    });
    expect(await maLoi(chot())).toBe("TIEN_DA_DOI");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("NHAP");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_OK } })).accountantStatus).toBe("PENDING");
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);
  });

  it("[HDC-06] đơn đã HUỶ ⇒ DON_DA_HUY; thiếu số hoá đơn ⇒ THIEU_THONG_TIN — cả hai không ghi gì", async () => {
    await khoan(P_OK, 3_000_000);
    await nhap([P_OK], { soHoaDon: null });
    expect(await maLoi(chot())).toBe("THIEU_THONG_TIN");

    await db.hoaDonDienTu.update({ where: { id: HD }, data: { soHoaDon: "902" } });
    await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });
    expect(await maLoi(chot())).toBe("DON_DA_HUY");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("NHAP");
    expect(await db.receipt.count({ where: { paymentId: P_OK } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDC-L] lõi xác nhận khoản (qua confirmPayment) — cổng mới nằm ở LÕI", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDC-L1] AC5: người ghi nhận TỰ xác nhận ⇒ từ chối (trước chỉ có ở tầng action)", async () => {
    await khoan(P_TU, 3_000_000, { recordedById: KT.id });
    const r = await confirmPayment({ paymentId: P_TU, confirmedById: KT.id });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/tự xác nhận/);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_TU } })).accountantStatus).toBe("PENDING");
  });

  it("[HDC-L2] dòng gốc đã bị ĐẢO TRỌN ⇒ không cấp phiếu thu cho tiền đã gỡ", async () => {
    await khoan(P_OK, 3_000_000);
    await db.payment.create({
      data: {
        id: `${T}p-dao-tron`,
        orderId: DON,
        amount: -3_000_000,
        method: "BANK_TRANSFER",
        paidDate: new Date("2699-09-21T03:00:00Z"),
        paymentType: "ADJUSTMENT",
        adjustmentOfId: P_OK,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        centerId: CS,
      },
    });
    const r = await confirmPayment({ paymentId: P_OK, confirmedById: KT.id });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/gỡ \/ tách hết/);
    expect(await db.receipt.count({ where: { paymentId: P_OK } })).toBe(0);
  });

  it("[HDC-L3] đối chứng dương: khoản hợp lệ ⇒ xác nhận, một phiếu; gọi lại ⇒ idempotent, không phiếu thứ hai", async () => {
    await khoan(P_OK, 3_000_000);
    const a = await confirmPayment({ paymentId: P_OK, confirmedById: KT.id });
    expect(a).toMatchObject({ ok: true, alreadyConfirmed: false });
    const b = await confirmPayment({ paymentId: P_OK, confirmedById: KT.id });
    expect(b).toMatchObject({ ok: true, alreadyConfirmed: true });
    expect(await db.receipt.count({ where: { paymentId: P_OK } })).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDC-07..11] GĐ 8 — chốt ghim phiên bản · nghi trùng trong transaction · email chụp lúc chốt", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Bản nháp gõ tay để TÁCH email của bản nháp với email của đơn (hàm `nhap` đặt hai cái trùng nhau). */
  const nhapTach = async (ids: string[], o: { emailNhap: string | null; emailDon: string | null; guiEmailKhach?: boolean; khongTrungLyDo?: string }) => {
    await db.order.update({ where: { id: DON }, data: { invoiceEmail: o.emailDon } });
    await db.hoaDonDienTu.create({
      data: {
        id: HD,
        orderId: DON,
        centerId: CS,
        trangThai: "NHAP",
        kyHieu: "1C26TSR",
        soHoaDon: "905",
        ngayPhatHanh: new Date("2026-09-20T00:00:00Z"),
        tepPdfKey: `hoa-don/CS1/2026/${DON}/t.pdf`,
        tepPdfTen: "hd.pdf",
        emailNhan: o.emailNhap,
        guiEmailKhach: o.guiEmailKhach ?? true,
        tongTien: 3_000_000 * ids.length,
        taoBoiId: KT.id,
        ...(o.khongTrungLyDo ? { khongTrungLyDo: o.khongTrungLyDo, khongTrungBoiId: KT.id, khongTrungLuc: NOW } : {}),
        khoan: { create: ids.map((paymentId) => ({ paymentId, soTien: 3_000_000 })) },
      },
    });
  };
  const phienBan = async () => (await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD }, select: { updatedAt: true } })).updatedAt;
  const chotVoi = (pb: Date, emailDuKien: string | null) =>
    chotHoaDon({ nguoiChot: KT, actor: KT_CS, orderId: DON, hoaDonId: HD, now: NOW, phienBan: pb, emailDuKien });
  const khongGhiGi = async () => {
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("NHAP");
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: T } } })).toBe(0);
  };

  it("[HDC-07] phiên bản CŨ (bản nháp vừa bị sửa) ⇒ DA_DOI, KHÔNG ghi gì; đúng phiên bản ⇒ chốt", async () => {
    await khoan(P_OK, 3_000_000);
    await nhapTach([P_OK], { emailNhap: "ph@example.com", emailDon: "ph@example.com" });
    const cu = await phienBan();
    await db.hoaDonDienTu.update({ where: { id: HD }, data: { soHoaDon: "906" } }); // người khác sửa
    expect(await maLoi(chotVoi(cu, "ph@example.com"))).toBe("DA_DOI");
    await khongGhiGi();
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_OK } })).accountantStatus).toBe("PENDING");
    await chotVoi(await phienBan(), "ph@example.com");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDC-08] hoá đơn chỉ giữ khoản KHAI TAY, đơn có khoản chuyển khoản ⇒ NGHI_TRUNG trong transaction; có 'không trùng' ⇒ qua", async () => {
    await db.payment.create({
      data: {
        id: `${T}p-ck`,
        orderId: DON,
        amount: 3_000_000,
        method: "BANK_TRANSFER",
        note: gatewayMarker("SEPAY", "FT-HDC-08"),
        paidDate: new Date("2699-09-19T03:00:00Z"),
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        enrollmentId: GD,
        recordedById: SALE,
        centerId: CS,
      },
    });
    await db.payment.create({
      data: {
        id: `${T}p-khai`,
        orderId: DON,
        amount: 3_000_000,
        method: "auto",
        note: installmentMarker(1),
        paidDate: new Date("2699-09-19T03:00:00Z"),
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        enrollmentId: GD,
        recordedById: SALE,
        centerId: CS,
      },
    });
    await nhapTach([`${T}p-khai`], { emailNhap: null, emailDon: null, guiEmailKhach: false });
    expect(await maLoi(chotVoi(await phienBan(), null))).toBe("NGHI_TRUNG");
    await khongGhiGi();

    await db.hoaDonDienTu.update({
      where: { id: HD },
      data: { khongTrungLyDo: "Đối chiếu sao kê: khai tay là đợt 2 tiền mặt", khongTrungBoiId: KT.id, khongTrungLuc: NOW },
    });
    await chotVoi(await phienBan(), null);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDC-08b] hoá đơn chỉ giữ khoản CHUYỂN KHOẢN ⇒ không có gì để nghi, chốt thẳng", async () => {
    await db.payment.create({
      data: {
        id: `${T}p-ck`,
        orderId: DON,
        amount: 3_000_000,
        method: "BANK_TRANSFER",
        note: gatewayMarker("SEPAY", "FT-HDC-08b"),
        paidDate: new Date("2699-09-19T03:00:00Z"),
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        enrollmentId: GD,
        recordedById: SALE,
        centerId: CS,
      },
    });
    await nhapTach([`${T}p-ck`], { emailNhap: null, emailDon: null, guiEmailKhach: false });
    await chotVoi(await phienBan(), null);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDC-09] bản nháp CHƯA có email, đơn nay có ⇒ gửi tới email của ĐƠN, KHÔNG báo 'khách không có email'", async () => {
    await khoan(P_OK, 3_000_000);
    await nhapTach([P_OK], { emailNhap: null, emailDon: "b.moi@example.com" });
    const kq = await chotVoi(await phienBan(), "b.moi@example.com");
    expect(kq.coGuiEmail).toBe(true);
    expect((await db.hoaDonGuiEmail.findFirstOrThrow({ where: { hoaDonId: HD } })).toi).toBe("b.moi@example.com");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).emailNhan).toBe("b.moi@example.com");
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.khong-email:${HD}` } })).toBe(0);
  });

  it("[HDC-10] bản nháp mang email CŨ, đơn đã đổi ⇒ gửi tới email MỚI, bản chụp sau chốt là email mới", async () => {
    await khoan(P_OK, 3_000_000);
    await nhapTach([P_OK], { emailNhap: "a.cu@example.com", emailDon: "b.moi@example.com" });
    await chotVoi(await phienBan(), "b.moi@example.com");
    expect((await db.hoaDonGuiEmail.findFirstOrThrow({ where: { hoaDonId: HD } })).toi).toBe("b.moi@example.com");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).emailNhan).toBe("b.moi@example.com");
  });

  it("[HDC-11] nút đã hứa email A mà đơn nay là B ⇒ EMAIL_DA_DOI, không ghi gì; bỏ tick gửi thì không so", async () => {
    await khoan(P_OK, 3_000_000);
    await nhapTach([P_OK], { emailNhap: "a.cu@example.com", emailDon: "b.moi@example.com" });
    expect(await maLoi(chotVoi(await phienBan(), "a.cu@example.com"))).toBe("EMAIL_DA_DOI");
    await khongGhiGi();
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_OK } })).accountantStatus).toBe("PENDING");

    await db.hoaDonDienTu.update({ where: { id: HD }, data: { guiEmailKhach: false } });
    await chotVoi(await phienBan(), "a.cu@example.com");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);
  });
});

// PLAN §4 bước ⑤ hứa hai kiểm TRONG transaction mà trước đây bước chốt chưa có:
//   · "nhóm vẫn DU" — lần thu dựng lại DƯỚI KHOÁ ĐƠN bằng chính `gomLanThu`: đợt bị sửa / huỷ giữa lúc
//     lưu nháp và lúc bấm thì không chốt một tờ nói "đủ" cho tiền không còn đủ;
//   · "mỗi khoản thuộc tập cơ sở KẾ TOÁN của actor" — theo `Payment.centerId`, không chỉ cơ sở của đơn.
// Cộng phần CHỤP LẠI tiền tha làm tròn lúc chốt (Q-mở 4: số thu thật, phần tha hiện RIÊNG).
describe.skipIf(!RUN_DB_TESTS)("[HDC-12..16] lần thu dựng lại trong transaction · phạm vi theo Payment.centerId · tiền tha", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const LY_DO_THEO_SO = "Phụ huynh báo không đóng nốt phần thiếu của đợt 1";
  const P_CS2 = `${T}p-cs2`;

  /**
   * Đợt 1 phải thu 3.000.000 · MỘT giao dịch SePay 2.997.000 rót vào, THA 3.000 (dung sai làm tròn)
   * ⇒ lần thu ĐỦ · khoản webhook trỏ về giao dịch bằng marker (hình dạng thật của `payos-ingest`).
   */
  async function dungDot() {
    await db.paymentRequest.create({
      data: { id: DOT, orderId: DON, installmentNo: 1, amountDue: 3_000_000, status: "PAID", sortOrder: 1, centerId: CS },
    });
    await db.bankTransaction.create({
      data: {
        id: BT,
        provider: "SEPAY",
        providerTxnId: TXN,
        amount: 2_997_000,
        transferredAt: new Date("2699-09-20T10:00:00Z"),
        status: "MATCHED",
        centerId: CS,
      },
    });
    await db.paymentAllocation.create({
      data: { bankTransactionId: BT, paymentRequestId: DOT, amount: 2_997_000, roundingWaived: 3_000, centerId: CS },
    });
    await db.payment.create({
      data: {
        id: P_CK,
        orderId: DON,
        amount: 2_997_000,
        method: "BANK_TRANSFER",
        note: gatewayMarker("SEPAY", TXN),
        paidDate: new Date("2699-09-20T03:00:00Z"),
        enrollmentId: GD,
        recordedById: SALE,
        centerId: CS,
      },
    });
  }

  const khongGhiGi = async (khoanIds: string[]) => {
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("NHAP");
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);
    expect(await db.receipt.count({ where: { paymentId: { in: khoanIds } } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: HD, action: "XAC_NHAN_HOA_DON" } })).toBe(0);
    const ps = await db.payment.findMany({ where: { id: { in: khoanIds } }, select: { confirmedById: true } });
    expect(ps.map((p) => p.confirmedById)).toEqual(khoanIds.map(() => null));
  };

  it("[HDC-12] lần thu ĐỦ nhờ tiền tha ⇒ chốt; tiền tha CHỤP LẠI lúc chốt (bản nháp mang 0 ⇒ 3.000), tổng vẫn là số thu thật", async () => {
    await dungDot();
    await nhap([P_CK], { soTien: 2_997_000 });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).tienThaLamTron).toBe(0); // tiền đề
    await chot();
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).toMatchObject({
      trangThai: "DA_XAC_NHAN",
      tongTien: 2_997_000,
      tienThaLamTron: 3_000,
    });
  });

  it("[HDC-13] đợt bị NÂNG số phải thu sau khi lưu nháp (lần thu THIẾU) ⇒ LAN_THU_THIEU, KHÔNG ghi gì; đối chứng 'xuất theo số đã thu' ⇒ chốt được", async () => {
    await dungDot();
    await nhap([P_CK], { soTien: 2_997_000 });
    await db.paymentRequest.update({ where: { id: DOT }, data: { amountDue: 4_000_000 } });
    expect(await maLoi(chot())).toBe("LAN_THU_THIEU");
    await khongGhiGi([P_CK]);

    await db.hoaDonDienTu.update({ where: { id: HD }, data: { xuatTheoSoDaThu: true, xuatTheoSoDaThuLyDo: LY_DO_THEO_SO } });
    await chot();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDC-14] đợt bị HUỶ (VOID) sau khi lưu nháp ⇒ DOT_DA_HUY, KHÔNG ghi gì — kể cả bản nháp mang 'xuất theo số đã thu'", async () => {
    await dungDot();
    await nhap([P_CK], { soTien: 2_997_000 });
    await db.hoaDonDienTu.update({ where: { id: HD }, data: { xuatTheoSoDaThu: true, xuatTheoSoDaThuLyDo: LY_DO_THEO_SO } });
    await db.paymentRequest.update({ where: { id: DOT }, data: { status: "VOID" } });
    expect(await maLoi(chot())).toBe("DOT_DA_HUY");
    await khongGhiGi([P_CK]);
  });

  it("[HDC-15] khoản mang cơ sở KHÁC (CS2) trong đơn CS1: kế toán CS1 ⇒ NGOAI_PHAM_VI, KHÔNG ghi gì; đối chứng kế toán Hội sở ⇒ chốt được", async () => {
    await khoan(P_OK, 3_000_000);
    await khoan(P_CS2, 3_000_000);
    await db.payment.update({ where: { id: P_CS2 }, data: { centerId: CS2 } });
    await nhap([P_OK, P_CS2]);
    expect(await maLoi(chot(KT_CS))).toBe("NGOAI_PHAM_VI");
    await khongGhiGi([P_OK, P_CS2]);

    const kq = await chot(KT_HO);
    expect(kq.daXacNhan.map((x) => x.paymentId).sort()).toEqual([P_OK, P_CS2].sort());
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDC-16] khoản CHƯA có cơ sở (centerId NULL — dữ liệu cũ) ⇒ tính theo cơ sở của hoá đơn: kế toán CS2 bị chặn, kế toán CS1 chốt được", async () => {
    await khoan(P_OK, 3_000_000);
    await db.payment.update({ where: { id: P_OK }, data: { centerId: null } });
    await nhap([P_OK]);
    expect(await maLoi(chot(keToan([CS2])))).toBe("NGOAI_PHAM_VI");
    await khongGhiGi([P_OK]);
    await chot(KT_CS);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });
});
