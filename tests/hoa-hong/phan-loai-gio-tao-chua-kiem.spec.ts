// @vitest-environment node
/**
 * [PLU-*] — ĐƠN "GIỜ TẠO CHƯA KIỂM CHỨNG" ĐI QUA ENGINE THẬT (luật phân loại v3, 2026-10-17). Đầu-cuối trên Postgres THẬT: đơn ghi bù dựng bằng `createBackfillOrderPaymentInTx`, tiền vào bằng
 * `recordPayment` / `confirmPayment`, quét bằng `quetKhoan` / `quetCacKhoan` / `quetKy` (đúng tập Q1…Q6 của cron), so bóng bằng `chaySoBong`.
 *
 * Spec này giữ phần mà `phan-loai-don-ghi-bu.spec.ts` (hàm phân loại một dòng) không chứng minh được:
 *   [PLU-01] THỨ TỰ DỮ LIỆU ĐẾN (không phải giờ cron): B đã được quét và ĐÓNG BĂNG (CLASSIFIED) TRƯỚC khi đơn ghi bù được nhập ⇒ B KHÔNG đổi; đơn ghi bù ra hold có bằng chứng nêu dòng của B.
 *            Cái giá phải nói thẳng: B có thể đã lấy NEW sai (nếu đơn ghi bù thật ra mua trước) — luật không viết lại lịch sử đã đóng băng (cùng nguyên tắc với huỷ/hoàn sau τ).
 *   [PLU-02] HOÁN VỊ quét: B→E', E'→B, một mẻ, quét lại — cùng dữ liệu cuối ⇒ cùng kết quả (cả hai bị giữ, 0 dòng sổ).
 *   [PLU-03] hold mới KHÔNG chặn vĩnh viễn: cùng mã `MANUAL_REVIEW_REQUIRED` nên "dời sang kỳ sau" dùng được.
 *   [PLU-04] so bóng tách hai loại hold lịch sử mua khỏi lỗi dữ liệu, và KHÔNG đổi `hold.tong` (cổng giữ nguyên).
 *
 * ⚠️ `ngayThu` của đơn ghi bù ở đây nằm TRONG tháng mốc cutover (≥ 2026-10): ngày thu còn quyết khoản thuộc engine CŨ hay MỚI (`chuSoHuuButToan`) — đó là chuyện CHỦ SỞ HỮU của sổ, không phải thứ tự mua;
 * khai tháng trước mốc thì khoản đi đường engine cũ và `quetKhoan` trả BO_QUA (khác với phân loại).
 *
 * Mỗi ca tự dựng kịch bản riêng (luật 18); ngày TUYỆT ĐỐI (luật 19); `NOW` truyền vào bối cảnh quét. NEW 9% · RENEWAL 2% trên khoản 10.000.000đ ⇒ 900.000đ vs 200.000đ.
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/phan-loai-gio-tao-chua-kiem.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { createBackfillOrderPaymentInTx } from "../../lib/crm/backfill-order";
import { confirmPayment } from "../../lib/finance/payment";
import { laDoiDuocSangKySau } from "../../lib/hoa-hong/hang-cho-so-nhom";
import { quetCacKhoan, quetKy } from "../../lib/hoa-hong/quet-ky";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { chaySoBong } from "../../lib/hoa-hong/so-bong-db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, kiemCuaSoSach, tienVe, type Be, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[PLU] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const NEW_10TR = 900_000;
const RULES = [
  { vai: "SALE", rate: 0.09 },
  { vai: "SALE", rate: 0.02, loai: "RENEWAL" as const },
];
const cuaToi: KichBan[] = [];

/**
 * Học viên có đơn THẬT B (tạo `ngayTaoB`) — chưa thu. Đơn GHI BÙ E' chưa có: nhập bằng `nhapDonGhiBu` ở thời điểm test chọn (để dựng được thứ tự "B quét xong rồi E' mới đến").
 */
async function dungBeB(tien: string, ngayTaoB: Date) {
  const k = await dungKichBan(tien, { rules: RULES });
  cuaToi.push(k);
  const bc = await boiCanh(k, NOW);
  const beB = await dungBe(k, "b", { tongTien: 10_000_000, ngayDon: ngayTaoB });
  return { k, bc, beB };
}
type Ca = Awaited<ReturnType<typeof dungBeB>>;

/** Nhập đơn ghi bù bằng HÀM GHI THẬT, ghim giờ máy chủ về `ngayNhap`, nối về cùng học viên, rồi (tuỳ chọn) kế toán xác nhận. `ngayThu` = ngày NGƯỜI NHẬP khai — luật v3 không đọc nó. */
async function nhapDonGhiBu(c: Ca, p: { ngayThu: Date; ngayNhap: Date; xacNhan?: boolean }) {
  const { k, beB } = c;
  const ket = await db.$transaction((tx) =>
    createBackfillOrderPaymentInTx(tx, {
      actor: { id: k.ketToanA.id, name: "Kế toán A fixture" },
      lead: { id: k.lead!.id, centerId: k.centerId, parentName: "PH", phone: k.lead!.phone, email: null },
      paid: { amount: 10_000_000, paidDate: p.ngayThu, items: [{ itemName: "Học phí ghi bù", unitPrice: 10_000_000 }] },
    }),
  );
  if (!ket.created || !ket.paymentId) throw new Error("backfill không tạo được khoản");
  const pay = await db.payment.findUniqueOrThrow({ where: { id: ket.paymentId }, select: { orderId: true } });
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: pay.orderId }, select: { id: true } });
  await db.order.update({ where: { id: pay.orderId }, data: { createdAt: p.ngayNhap } });
  expect((await db.auditLog.updateMany({ where: { module: "finance", entityType: "Payment", action: "CREATE", entityId: ket.paymentId }, data: { createdAt: p.ngayNhap } })).count).toBe(1);
  const id = `${k.ma}-e`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 2 ${id}`, slug: `${id}-sata2`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const gd = await db.enrollment.create({ data: { id: `${id}-gd`, studentId: beB.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: p.ngayNhap } });
  await db.orderItem.update({ where: { id: item.id }, data: { studentId: beB.studentId, enrollmentId: gd.id } });
  await db.payment.update({ where: { id: ket.paymentId }, data: { enrollmentId: gd.id, orderItemId: item.id } });
  if (p.xacNhan !== false) expect((await confirmPayment({ paymentId: ket.paymentId, confirmedById: k.ketToanB.id })).ok).toBe(true);
  return { orderId: pay.orderId, orderItemId: item.id, paymentId: ket.paymentId };
}

/** LẦN MUA THỨ HAI của CÙNG học viên (đơn + ghi danh + MỘT dòng học phí, chưa thu). `ngayDon` = Order.createdAt. */
async function lanMuaThem(k: KichBan, be: Be, ten: string, ngayDon: Date): Promise<Be> {
  const id = `${k.ma}-${ten}`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 4 ${id}`, slug: `${id}-sata4`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const enr = await db.enrollment.create({ data: { id: `${id}-gd`, studentId: be.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: ngayDon } });
  const order = await db.order.create({
    data: { id: `${id}-don`, code: `${id}-don`.toUpperCase(), type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: k.lead?.phone ?? "0990000001", totalAmount: 10_000_000, centerId: k.centerId, leadId: k.lead?.id ?? null, createdAt: ngayDon },
  });
  const item = await db.orderItem.create({
    data: { id: `${id}-oi`, orderId: order.id, type: "COURSE_ENROLLMENT", itemName: `Học phí ${ten}`, quantity: 1, unitPrice: 10_000_000, totalPrice: 10_000_000, studentId: be.studentId, enrollmentId: enr.id, createdAt: ngayDon },
  });
  return { studentId: be.studentId, enrollmentId: enr.id, orderId: order.id, orderItemId: item.id };
}

const holdMo = (paymentId: string) => db.commissionHold.findMany({ where: { paymentId, status: "OPEN" }, select: { code: true, detail: true, blockingPeriodId: true, status: true } });
const stCua = (orderItemId: string) => db.studentTransaction.findUnique({ where: { orderItemId } });
const tienCua = async (paymentId: string) => (await dongSoCuaKhoan(paymentId)).reduce((s, d) => s + d.amount, 0);

describe.skipIf(!RUN_DB_TESTS)("[PLU] đơn giờ-tạo-chưa-kiểm-chứng qua engine thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[PLU-01] DỮ LIỆU ĐẾN SAU: B quét xong ⇒ NEW 900k ĐÓNG BĂNG; rồi đơn ghi bù E' (máy chủ nhận 12/10 > tạo B 10/10) mới được nhập ⇒ B KHÔNG đổi, quét lại/cron vẫn NEW; E' bị GIỮ, bằng chứng nêu dòng của B", async () => {
    const c = await dungBeB("plu1", D("2026-10-10"));
    const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-15") });
    expect((await quetKhoan(db, c.bc, pB)).loai).not.toBe("GIU");
    expect(await tienCua(pB)).toBe(NEW_10TR);
    expect(await stCua(c.beB.orderItemId)).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "NEW" });

    const e = await nhapDonGhiBu(c, { ngayThu: D("2026-10-20"), ngayNhap: D("2026-10-12") });
    const r = await quetKhoan(db, c.bc, e.paymentId);
    expect(r.loai).toBe("GIU");
    expect(await dongSoCuaKhoan(e.paymentId)).toEqual([]);
    const giu = await holdMo(e.paymentId);
    expect(giu).toHaveLength(1);
    expect(giu[0]).toMatchObject({ code: "MANUAL_REVIEW_REQUIRED", detail: { maLuat: "BACKFILL_ORDER_TIME_UNVERIFIED" } });
    expect(JSON.stringify(giu[0]!.detail)).toContain(c.beB.orderId); // người xử lý thấy NGAY đơn nào đang vướng
    expect(await stCua(e.orderItemId)).toMatchObject({ status: "MANUAL_REVIEW_REQUIRED", reasonCode: "BACKFILL_ORDER_TIME_UNVERIFIED", evidence: { lanMuaThuTuChuaKiemIds: [c.beB.orderItemId] } });

    // B không đổi dù quét lại và dù cron chạy.
    await quetKhoan(db, c.bc, pB);
    await quetKy(db, c.bc, { thang: "2026-10", centerId: c.k.centerId, soThangDoiSoat: 0 });
    expect(await stCua(c.beB.orderItemId)).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "NEW" });
    expect(await tienCua(pB)).toBe(NEW_10TR);
    expect(await holdMo(e.paymentId)).toHaveLength(1);
  });

  it("[PLU-02] HOÁN VỊ QUÉT: cùng dữ liệu cuối (B + đơn ghi bù, cả hai đã thu), quét B→E', E'→B, một mẻ, và quét B hai lần ⇒ ĐỀU: cả hai bị GIỮ BACKFILL_ORDER_TIME_UNVERIFIED, 0 dòng sổ, đúng 1 hold mở mỗi khoản", async () => {
    const quan = async (c: Ca, pB: string, e: Awaited<ReturnType<typeof nhapDonGhiBu>>) => ({
      stB: (await stCua(c.beB.orderItemId))?.reasonCode,
      stE: (await stCua(e.orderItemId))?.reasonCode,
      tienB: await tienCua(pB),
      tienE: await tienCua(e.paymentId),
      holdB: (await holdMo(pB)).map((h) => h.code + "/" + (h.detail as { maLuat?: string }).maLuat),
      holdE: (await holdMo(e.paymentId)).map((h) => h.code + "/" + (h.detail as { maLuat?: string }).maLuat),
    });
    const ra: Record<string, Awaited<ReturnType<typeof quan>>> = {};
    for (const cach of ["B→E", "E→B", "mẻ", "B,B"] as const) {
      const c = await dungBeB(`plu2${cach.length}${cach.charCodeAt(0)}`, D("2026-10-10"));
      const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-15") });
      const e = await nhapDonGhiBu(c, { ngayThu: D("2026-10-20"), ngayNhap: D("2026-10-12") });
      if (cach === "B→E") for (const id of [pB, e.paymentId]) await quetKhoan(db, c.bc, id);
      if (cach === "E→B") for (const id of [e.paymentId, pB]) await quetKhoan(db, c.bc, id);
      if (cach === "mẻ") expect((await quetCacKhoan(db, c.bc, [pB, e.paymentId])).loi).toEqual([]);
      if (cach === "B,B") for (const id of [pB, pB, e.paymentId, e.paymentId]) await quetKhoan(db, c.bc, id);
      ra[cach] = await quan(c, pB, e);
    }
    const chuan = { stB: "BACKFILL_ORDER_TIME_UNVERIFIED", stE: "BACKFILL_ORDER_TIME_UNVERIFIED", tienB: 0, tienE: 0, holdB: ["MANUAL_REVIEW_REQUIRED/BACKFILL_ORDER_TIME_UNVERIFIED"], holdE: ["MANUAL_REVIEW_REQUIRED/BACKFILL_ORDER_TIME_UNVERIFIED"] };
    for (const [cach, r] of Object.entries(ra)) expect(r, cach).toEqual(chuan);
  });

  it("[PLU-03] hold mới KHÔNG chặn kỳ vĩnh viễn: cùng mã MANUAL_REVIEW_REQUIRED nên nút/cổng 'dời sang kỳ sau' nhận nó (mã luật không quyết chuyện dời được)", async () => {
    const c = await dungBeB("plu3", D("2026-10-10"));
    const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-15") });
    const e = await nhapDonGhiBu(c, { ngayThu: D("2026-10-20"), ngayNhap: D("2026-10-12") });
    await quetCacKhoan(db, c.bc, [pB, e.paymentId]);
    const giu = await holdMo(e.paymentId);
    expect(giu).toHaveLength(1);
    expect(giu[0]!.blockingPeriodId, "hold phải gắn kỳ để có thứ mà 'dời' hỏi").not.toBeNull();
    expect(laDoiDuocSangKySau({ code: giu[0]!.code as "MANUAL_REVIEW_REQUIRED", status: giu[0]!.status, blockingPeriodId: giu[0]!.blockingPeriodId })).toBe(true);
  });

  it("[PLU-04] so bóng tách hai loại hold lịch sử mua KHỎI lỗi dữ liệu và KHÔNG đổi cổng: PREVIOUS_PURCHASE_UNRESOLVED (đơn trước chưa thu — hold nghiệp vụ được chấp nhận) và BACKFILL_ORDER_TIME_UNVERIFIED (cần người quyết) đếm riêng, `hold.tong` vẫn gồm cả hai", async () => {
    // (a) A (tạo trước) chưa thu đồng nào, B thu 2025-08-10 ⇒ khoản của B giữ PREVIOUS_PURCHASE_UNRESOLVED.
    const ka = await dungKichBan("plu4a", { rules: RULES });
    cuaToi.push(ka);
    const beA = await dungBe(ka, "a", { tongTien: 10_000_000, ngayDon: D("2025-08-01") });
    const beBa = await lanMuaThem(ka, beA, "b", D("2025-08-05"));
    await tienVe(ka, beBa, { soTien: 10_000_000, ngay: D("2025-08-10") });
    await kiemCuaSoSach([ka], "2025-08-01", "2025-08-31");
    const a = await chaySoBong({ client: db, now: NOW, kyP: "2027-01", tuNgay: "2025-08-01", denNgay: "2025-08-31", tranSoKhoan: 500 });
    expect(a.chuaTinh.theoMa).toHaveProperty("MANUAL_REVIEW_REQUIRED");
    expect(a.holdLichSuMua).toEqual({ lanMuaTruocChuaChot: { soKhoan: 1, soTienThu: 10_000_000 }, thuTuMuaChuaKiem: { soKhoan: 0, soTienThu: 0 } });
    expect(a.hold.tong).toBe(1); // cổng không đổi: vẫn đếm đủ

    // (b) B thật + đơn ghi bù nhập sau (khai thu 2025-09-20, máy chủ nhận 2025-09-12 > tạo B 2025-09-10) ⇒ hai khoản, hai hold UNVERIFIED.
    const c = await dungBeB("plu4b", D("2025-09-10"));
    await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2025-09-15") });
    await nhapDonGhiBu(c, { ngayThu: D("2025-09-20"), ngayNhap: D("2025-09-12") });
    await kiemCuaSoSach([c.k], "2025-09-01", "2025-09-30");
    const b = await chaySoBong({ client: db, now: NOW, kyP: "2027-01", tuNgay: "2025-09-01", denNgay: "2025-09-30", tranSoKhoan: 500 });
    expect(b.holdLichSuMua).toEqual({ lanMuaTruocChuaChot: { soKhoan: 0, soTienThu: 0 }, thuTuMuaChuaKiem: { soKhoan: 2, soTienThu: 20_000_000 } });
    expect(b.hold.tong).toBe(2);
    expect(b.chuaTinh.soKhoan).toBe(2);
  });
});
