// @vitest-environment node
/**
 * [PLB-*] — ĐƠN GHI BÙ (backfill lead cũ) / ĐƠN NHẬP GIAO DỊCH CŨ KHÔNG ĐƯỢC LÀM ĐỔI NEW/RENEWAL BẰNG NGÀY DO NGƯỜI NHẬP KHAI. Đầu-cuối trên Postgres THẬT; đơn ghi bù dựng bằng HÀM GHI THẬT
 * `createBackfillOrderPaymentInTx`, đơn nhập cũ bằng `ghiGiaoDichCuChoHocVienInTx` (đường mà convert-lead-v2 / bulk-convert / thiếu-học-phí / nhập giao dịch cũ đi) — không `order.create` tay.
 *
 * LỊCH SỬ. Gốc lỗi (reviewer gộp UAT 11/10/2026): khoá thứ tự lần mua K = (Order.createdAt, Order.id), mà hàm ghi bù KHÔNG đặt `createdAt` nên đơn mang `now()` = giờ NHẬP; học viên có đơn
 * thật B (tạo 10/10, thu 15/10) và đơn ghi bù E' (khoản thu tháng 1, nhập 12/10) ⇒ E' không là tiền lệ của B ⇒ B = NEW 9% thay vì RENEWAL 2%. Hai bản vá đầu (§17.A, §17.R3b) dịch thời điểm mua
 * về NGÀY THU người nhập khai — và reviewer vòng 3 chứng minh người hưởng hoa hồng (`payments:record`) tự khai ngày lùi để lật NEW/RENEWAL.
 *
 * LUẬT v3 (chủ dự án chốt 2026-10-17, §3/§4): thứ tự lần mua dựa trên DẤU THỜI GIAN MÁY CHỦ (Order.createdAt; đơn ghi bù / nhập cũ: giờ AuditLog tạo đơn) + Order.id; KHÔNG ngày nào do người nhập khai.
 * Đơn ghi bù chỉ có cận trên của lúc mua ⇒ đơn đứng SAU mà chưa kiểm chứng ⇒ không biết thứ tự ⇒ GIỮ (BACKFILL_ORDER_TIME_UNVERIFIED), không đoán. Hệ quả kiểm bằng ca:
 *   [PLB-01..04] đơn ghi bù nhập SAU khi B được tạo ⇒ cả hai bị giữ, và KHAI NGÀY NÀO cũng ra y hệt; nhập TRƯỚC ⇒ chắc chắn là tiền lệ ⇒ B = RENEWAL, E' = NEW.
 *   [PLB-05..08] đơn THƯỜNG không bị kéo lùi theo `Payment.paidDate` (giữ nguyên ý chống gian lận của vòng 3).
 *   [PLB-09..10] đơn NHẬP GIAO DỊCH CŨ (Order.createdAt = ngày trong sheet) cùng lớp "giờ tạo chưa kiểm chứng".
 *   [PLB-11..12] hoà giờ tạo phân xử bằng id; nhiều khoản thu của một đơn không đổi thứ tự.
 *   [PLB-T1..T2] (luật v4) tiền lệ đã thu rồi HUỶ / HOÀN: ngày thu / ngày hoàn do người ghi khai KHÔNG đổi được NEW/RENEWAL khỏi kết quả theo giờ máy chủ — chỉ ra đúng kết quả đó hoặc bị GIỮ.
 *
 * Mỗi ca tự dựng kịch bản riêng (luật 18); ngày TUYỆT ĐỐI (luật 19). Hàm ghi thật đóng dấu `createdAt = now()` bằng đồng hồ THẬT (cả `Order` lẫn dòng AuditLog), nên fixture GHIM lại cả hai về một
 * ngày tuyệt đối (mô phỏng "nhập lúc 12/10") — đúng phần dấu thời gian, không đụng logic nào.
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/phan-loai-don-ghi-bu.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { createBackfillOrderPaymentInTx } from "../../lib/crm/backfill-order";
import { ghiGiaoDichCuChoHocVienInTx } from "../../lib/finance/ghi-giao-dich-cu";
import { confirmPayment, recordPayment } from "../../lib/finance/payment";
import { phanLoaiDongDon } from "../../lib/hoa-hong/phan-loai-giao-dich-db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { D, donKichBan, dungBe, dungKichBan, hoanTien, tienVe, type Be, type KichBan } from "./_kich-ban";
import { ghimGioGhi } from "./phan-loai-gio-ghi";

if (!RUN_DB_TESTS) console.warn(`[PLB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const cuaToi: KichBan[] = [];

/**
 * Dựng: học viên có đơn THẬT B (tạo `ngayTaoB`, thu `ngayThuB`, đã xác nhận) và đơn GHI BÙ E' do hàm thật tạo (khoản thu `ngayThuE`, nhập `ngayNhapE`, CHƯA xác nhận),
 * đã nối về CÙNG học viên + ghi danh BẰNG TAY: `docLanMuaTheoHocVien` tìm tiền lệ qua `OrderItem.studentId` / `Enrollment.studentId`, mà luồng convert HIỆN KHÔNG gắn hai cột đó lên dòng của đơn ghi bù
 * (`linkRecordedPaymentsToEnrollments` chỉ gắn `Payment.enrollmentId`) — giới hạn dữ liệu có sẵn, ghi ở 08 §17.A mục 2, KHÔNG phải việc của bản vá này.
 */
async function dungCa(p: { ngayTaoB: Date; ngayThuB: Date; ngayThuE: Date; ngayNhapE: Date }) {
  const k = await dungKichBan("plb", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
  cuaToi.push(k);
  const beB = await dungBe(k, "b", { tongTien: 10_000_000, ngayDon: p.ngayTaoB });
  await tienVe(k, beB, { soTien: 10_000_000, ngay: p.ngayThuB });

  const ket = await db.$transaction((tx) =>
    createBackfillOrderPaymentInTx(tx, {
      actor: { id: k.ketToanA.id, name: "Kế toán A fixture" },
      lead: { id: k.lead!.id, centerId: k.centerId, parentName: "PH", phone: k.lead!.phone, email: null },
      paid: { amount: 5_000_000, paidDate: p.ngayThuE, items: [{ itemName: "Học phí ghi bù", unitPrice: 5_000_000 }] },
    }),
  );
  if (!ket.created || !ket.paymentId) throw new Error("backfill không tạo được khoản");
  const pay = await db.payment.findUniqueOrThrow({ where: { id: ket.paymentId }, select: { orderId: true } });
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: pay.orderId }, select: { id: true } });
  // Giờ NHẬP là đồng hồ thật — ghim về ngày tuyệt đối (chỉ dấu thời gian): cả `Order.createdAt` lẫn dòng AuditLog tạo đơn (nguồn giờ máy chủ mà bộ phân loại đọc).
  await db.order.update({ where: { id: pay.orderId }, data: { createdAt: p.ngayNhapE } });
  const daGhim = await db.auditLog.updateMany({ where: { module: "finance", entityType: "Payment", action: "CREATE", entityId: ket.paymentId }, data: { createdAt: p.ngayNhapE } });
  expect(daGhim.count, "đơn ghi bù phải có đúng một dòng audit tạo khoản").toBe(1);

  const id = `${k.ma}-e`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 2 ${id}`, slug: `${id}-sata2`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const gd = await db.enrollment.create({
    data: { id: `${id}-gd`, studentId: beB.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: p.ngayNhapE },
  });
  await db.orderItem.update({ where: { id: item.id }, data: { studentId: beB.studentId, enrollmentId: gd.id } });
  await db.payment.update({ where: { id: ket.paymentId }, data: { enrollmentId: gd.id, orderItemId: item.id } });
  return { k, beB, eOrderItemId: item.id, ePaymentId: ket.paymentId, eOrderId: pay.orderId };
}

/**
 * Thêm một đơn THƯỜNG thứ hai cho CÙNG học viên (không qua hàm ghi bù): đơn tạo `ngayTao`, khoản thu đi qua `recordPayment`/`confirmPayment` THẬT với `ngayThu` do NGƯỜI GHI tự chọn
 * (đúng như `recordPaymentAction`: `paidDate` là chuỗi người dùng gõ, không có cận dưới; `note`/`method` là chuỗi tự do). Dựng ghi danh riêng để dòng đơn nối đúng học viên.
 */
async function donThem(k: KichBan, be: Be, p: { ten: string; ngayTao: Date; ngayThu: Date; method?: string; ghiChu?: string }) {
  const id = `${k.ma}-${p.ten}`;
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: k.khoa.id, centerId: k.centerId } }); // (studentId, classId) là khoá duy nhất của ghi danh
  const gd = await db.enrollment.create({
    data: { id: `${id}-gd`, studentId: be.studentId, classId: lop.id, courseId: k.khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: p.ngayTao },
  });
  const don = await db.order.create({
    data: {
      id: `${id}-don`,
      code: `${id}-don`.toUpperCase(),
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH",
      customerPhone: k.lead!.phone,
      totalAmount: 10_000_000,
      centerId: k.centerId,
      leadId: k.lead!.id,
      createdAt: p.ngayTao,
    },
  });
  const dong = await db.orderItem.create({
    data: { id: `${id}-oi`, orderId: don.id, type: "COURSE_ENROLLMENT", itemName: `Học phí ${p.ten}`, quantity: 1, unitPrice: 10_000_000, totalPrice: 10_000_000, studentId: be.studentId, enrollmentId: gd.id, createdAt: p.ngayTao },
  });
  const r = await recordPayment({
    orderId: don.id,
    enrollmentId: gd.id,
    amount: 10_000_000,
    method: p.method ?? "cash",
    paidDate: p.ngayThu,
    note: p.ghiChu ?? null,
    recordedById: k.ketToanA.id,
    centerId: k.centerId,
  });
  if (!r.ok) throw new Error(`recordPayment: ${r.error}`);
  await db.payment.update({ where: { id: r.paymentId }, data: { orderItemId: dong.id } });
  const c = await confirmPayment({ paymentId: r.paymentId, confirmedById: k.ketToanB.id });
  if (!c.ok) throw new Error(`confirmPayment: ${c.error}`);
  return { orderId: don.id, orderItemId: dong.id, paymentId: r.paymentId };
}

const phanLoai = async (orderItemId: string) => {
  const r = await phanLoaiDongDon(db, { orderItemId });
  return r ? `${r.loai}/${r.maLuat}` : null;
};

describe.skipIf(!RUN_DB_TESTS)("[PLB] đơn ghi bù đứng đúng chỗ trong thứ tự lần mua", () => {
  beforeAll(() => {
    assertTestDb();
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
  }, 60_000);

  const phanLoaiHaiDon = async (c: Awaited<ReturnType<typeof dungCa>>) => ({ b: await phanLoai(c.beB.orderItemId), e: await phanLoai(c.eOrderItemId) });

  it("[PLB-01] ca của reviewer: B tạo 10/10 thu 15/10; đơn ghi bù (khai thu 20/01, máy chủ nhận 12/10) CHƯA xác nhận ⇒ không ai biết đơn nào mua trước ⇒ B bị GIỮ BACKFILL_ORDER_TIME_UNVERIFIED, KHÔNG lọt NEW 9%", async () => {
    const c = await dungCa({ ngayTaoB: D("2026-10-10"), ngayThuB: D("2026-10-15"), ngayThuE: D("2026-01-20"), ngayNhapE: D("2026-10-12") });
    // Đối chứng: đơn ghi bù thật sự mang giờ NHẬP (sau B) — đây là điều khiến lỗi gốc xảy ra.
    const e = await db.order.findUniqueOrThrow({ where: { id: c.eOrderId }, select: { createdAt: true } });
    expect(e.createdAt.getTime()).toBeGreaterThan(D("2026-10-10").getTime());
    expect(await phanLoai(c.beB.orderItemId)).toBe("MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED");
  });

  it("[PLB-02] cùng ca, kế toán xác nhận khoản ghi bù ⇒ VẪN giữ cả hai (xác nhận khoản thu là xác nhận TIỀN, không phải xác nhận NGÀY mua): B và E' đều BACKFILL_ORDER_TIME_UNVERIFIED, bằng chứng nêu dòng của nhau", async () => {
    const c = await dungCa({ ngayTaoB: D("2026-10-10"), ngayThuB: D("2026-10-15"), ngayThuE: D("2026-01-20"), ngayNhapE: D("2026-10-12") });
    const x = await confirmPayment({ paymentId: c.ePaymentId, confirmedById: c.k.ketToanB.id });
    expect(x.ok, JSON.stringify(x)).toBe(true);
    expect(await phanLoaiHaiDon(c)).toEqual({ b: "MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED", e: "MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED" });
    const kqB = await phanLoaiDongDon(db, { orderItemId: c.beB.orderItemId });
    const kqE = await phanLoaiDongDon(db, { orderItemId: c.eOrderItemId });
    expect(kqB?.bangChung.lanMuaThuTuChuaKiemIds).toEqual([c.eOrderItemId]);
    expect(kqE?.bangChung.lanMuaThuTuChuaKiemIds).toEqual([c.beB.orderItemId]);
  });

  it.each([
    { ten: "khai thu sớm hơn B (20/01)", ngayThuE: D("2026-01-20") },
    { ten: "khai thu SAU B (20/10) — từng ra B = NEW / E' = RENEWAL ở luật cũ", ngayThuE: D("2026-10-20") },
    { ten: "khai thu rất xa trong quá khứ (2020)", ngayThuE: D("2020-01-01") },
    { ten: "khai thu trong tương lai (2030)", ngayThuE: D("2030-01-01") },
  ])("[PLB-03] (§4) người nhập KHAI NGÀY NÀO cũng KHÔNG đổi phân loại: $ten ⇒ y hệt [PLB-02]", async ({ ngayThuE }) => {
    const c = await dungCa({ ngayTaoB: D("2026-10-10"), ngayThuB: D("2026-10-15"), ngayThuE, ngayNhapE: D("2026-10-12") });
    const x = await confirmPayment({ paymentId: c.ePaymentId, confirmedById: c.k.ketToanB.id });
    expect(x.ok, JSON.stringify(x)).toBe(true);
    expect(await phanLoaiHaiDon(c)).toEqual({ b: "MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED", e: "MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED" });
  });

  it.each([
    { ten: "khai thu sớm (20/01)", ngayThuE: D("2026-01-20") },
    { ten: "khai thu muộn (2030)", ngayThuE: D("2030-01-01") },
  ])("[PLB-04] đối chứng DƯƠNG: đơn ghi bù được máy chủ nhận TRƯỚC khi B được tạo (nhập 08/10 < tạo B 10/10) ⇒ chắc chắn là tiền lệ (mua ≤ nhập < tạo B) ⇒ B = RENEWAL, E' = NEW — $ten, không đổi gì", async ({ ngayThuE }) => {
    const c = await dungCa({ ngayTaoB: D("2026-10-10"), ngayThuB: D("2026-10-15"), ngayThuE, ngayNhapE: D("2026-10-08") });
    const x = await confirmPayment({ paymentId: c.ePaymentId, confirmedById: c.k.ketToanB.id });
    expect(x.ok, JSON.stringify(x)).toBe(true);
    expect(await phanLoaiHaiDon(c)).toEqual({ b: "RENEWAL/PRIOR_PURCHASE", e: "NEW/FIRST_PURCHASE" });
  });

  // ── [PLB-05..08] ĐƠN THƯỜNG KHÔNG ĐƯỢC KÉO LÙI THEO `Payment.paidDate` (rà vòng 2): ngày thu do NGƯỜI GHI tự gõ, không có cận dưới ────────────────────────────────────────────
  // Hai lỗ cùng gốc: `thoiDiemMua` dịch thời điểm mua về NGÀY THU của MỌI đơn. (a) Người hưởng hoa hồng (CENTER_SALES_CSM có payments:record) ghi khoản thu của đơn X với paidDate lùi ⇒ X thành lần mua
  // đầu (NEW 9%) và đơn cũ thành RENEWAL. (b) Khách chuyển khoản tối hôm trước, sale lên đơn sáng hôm sau (chênh 32 giờ > dung sai 24 giờ) ⇒ đơn bị kéo lùi, đảo thứ tự với đơn tạo giữa hai mốc.
  // Luật nay: CHỈ đơn nhận diện được là GHI BÙ bằng dấu hiệu phía server (AuditLog `finance/Payment/CREATE` do `createBackfillOrderPaymentInTx` ghi cùng transaction) mới được dùng ngày thu;
  // mọi đơn khác dùng `Order.createdAt`, và kể cả đơn ghi bù cũng dùng ngày thu GHI LÚC TẠO (audit), không dùng `Payment.paidDate` hiện tại (sửa được khi khoản còn PENDING).

  it("[PLB-05] (a) gian lận paidDate lùi: đơn X tạo 10/10 nhưng người ghi nhập paidDate = 01/01 (kèm cả marker `[backfill-import]` và method 'backfill' tự gõ) ⇒ X vẫn SAU đơn E cũ (tạo 01/03, thu 05/03): X = RENEWAL 2%, E = NEW", async () => {
    // Cấy: cho `thoiDiemMua` tin ngày thu của MỌI đơn (bỏ nhận diện ghi bù) ⇒ X kéo về 01/01 ⇒ X = NEW, E = RENEWAL ⇒ ca đỏ.
    const k = await dungKichBan("plb5", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
    cuaToi.push(k);
    const beE = await dungBe(k, "e", { tongTien: 10_000_000, ngayDon: D("2026-03-01") });
    await tienVe(k, beE, { soTien: 10_000_000, ngay: D("2026-03-05") });
    const x = await donThem(k, beE, { ten: "x", ngayTao: D("2026-10-10"), ngayThu: D("2026-01-01"), method: "backfill", ghiChu: "[backfill-import] gõ tay" });
    expect(await phanLoai(beE.orderItemId)).toBe("NEW/FIRST_PURCHASE");
    expect(await phanLoai(x.orderItemId)).toBe("RENEWAL/PRIOR_PURCHASE");
  });

  // Hoán vị: hai thứ tự ĐẶT TÊN bản ghi (đơn nào có `id` nhỏ hơn) — kết quả chỉ phụ thuộc giờ tạo đơn, không phụ thuộc id.
  it.each([
    { ten: "A có id nhỏ", dauTen: "a", sauTen: "b" },
    { ten: "B có id nhỏ", dauTen: "z", sauTen: "b0" },
  ])("[PLB-06] (b) khách chuyển khoản tối 10/10, sale lên đơn sáng 11/10 (chênh 32 giờ): đơn A tạo 10/10 09:00 vẫn đứng TRƯỚC — A = NEW, B = RENEWAL — $ten", async ({ dauTen, sauTen }) => {
    // Cấy: dung sai ngày-so-giờ áp cho mọi đơn ⇒ B (thu 10/10 00:00, tạo 11/10 08:00) kéo về trước A ⇒ B = NEW, A = RENEWAL ⇒ ca đỏ.
    const k = await dungKichBan("plb6", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
    cuaToi.push(k);
    const taoA = new Date("2026-10-10T02:00:00.000Z"); // 10/10 09:00 giờ VN
    const taoB = new Date("2026-10-11T01:00:00.000Z"); // 11/10 08:00 giờ VN
    const thuB = new Date("2026-10-09T17:00:00.000Z"); // 10/10 00:00 giờ VN — khách chuyển khoản TỐI 10/10, ghi nhận theo ngày
    const beA = await dungBe(k, dauTen, { ngayDon: taoA });
    await tienVe(k, beA, { soTien: 10_000_000, ngay: taoA });
    const b = await donThem(k, beA, { ten: sauTen, ngayTao: taoB, ngayThu: thuB });
    expect(await phanLoai(beA.orderItemId)).toBe("NEW/FIRST_PURCHASE");
    expect(await phanLoai(b.orderItemId)).toBe("RENEWAL/PRIOR_PURCHASE");
  });

  it("[PLB-07] đối chứng: đơn thường xếp theo giờ TẠO — đơn tạo trước luôn là lần mua trước, dù khoản thu của nó muộn hơn khoản thu của đơn tạo sau", async () => {
    const k = await dungKichBan("plb7", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
    cuaToi.push(k);
    const beA = await dungBe(k, "a", { ngayDon: D("2026-10-10") });
    await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-20") }); // A tạo trước nhưng thu muộn
    const b = await donThem(k, beA, { ten: "b", ngayTao: D("2026-10-12"), ngayThu: D("2026-10-13") }); // B tạo sau, thu sớm hơn A
    expect(await phanLoai(beA.orderItemId)).toBe("NEW/FIRST_PURCHASE");
    expect(await phanLoai(b.orderItemId)).toBe("RENEWAL/PRIOR_PURCHASE");
  });

  it("[PLB-08] đơn GHI BÙ: sửa `Payment.paidDate` khi khoản còn PENDING KHÔNG đổi phân loại (trước/sau y hệt) — ngày thu hiện tại không còn là đầu vào của thứ tự mua", async () => {
    // Cấy: loader đọc `Payment.paidDate` hiện tại để dịch thời điểm mua ⇒ sửa ngày làm đổi kết quả ⇒ ca đỏ.
    const c = await dungCa({ ngayTaoB: D("2026-10-10"), ngayThuB: D("2026-10-15"), ngayThuE: D("2026-10-20"), ngayNhapE: D("2026-10-12") });
    const truoc = await phanLoaiHaiDon(c);
    await db.payment.update({ where: { id: c.ePaymentId }, data: { paidDate: D("2026-01-20") } }); // người dùng sửa ngày thu khi khoản còn PENDING
    expect(await phanLoaiHaiDon(c)).toEqual(truoc);
    const x = await confirmPayment({ paymentId: c.ePaymentId, confirmedById: c.k.ketToanB.id });
    expect(x.ok, JSON.stringify(x)).toBe(true);
    await db.payment.update({ where: { id: c.ePaymentId }, data: { paidDate: D("2030-01-01") } });
    expect(await phanLoaiHaiDon(c)).toEqual({ b: "MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED", e: "MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED" });
  });

  // ── [PLB-09..10] ĐƠN NHẬP GIAO DỊCH CŨ: `Order.createdAt` = NGÀY TRONG SHEET do người nhập khai (quyền `payments:record`) ───────────────────────────────────────────────────────
  // Cùng lớp "giờ tạo chưa kiểm chứng" với đơn ghi bù, nhưng lỗ nằm ở CHÍNH `Order.createdAt` (không phải `Payment.paidDate`): ngày sheet lùi/tiến tuỳ ý. Giờ máy chủ của đường này là dòng AuditLog
  // `finance/Order/CREATE source=nhap-giao-dich-cu`. Dòng đơn của đường này chưa mang studentId/enrollmentId nên hôm nay chưa vào lịch sử mua — fixture nối tay (như [PLB-01..04]) để thấy luật
  // đã sẵn khi nối, thay vì mở lại lỗ lúc đó.
  async function donNhapCu(k: KichBan, be: Be, p: { ngaySheet: Date; ngayNhap: Date; xacNhan: boolean }) {
    const hv = await db.student.findUniqueOrThrow({ where: { id: be.studentId }, select: { id: true } });
    const ra = await db.$transaction((tx) =>
      ghiGiaoDichCuChoHocVienInTx(tx, {
        actor: { id: k.ketToanA.id, name: "Kế toán A fixture" },
        hocVienId: hv.id,
        giaoDich: [{ sheet: `PLB-${k.ma}`, dong: 1, maHV: null, hoTen: null, sdt: null, hocPhi: 5_000_000, ngay: p.ngaySheet, khoa: "Học phí cũ", coSo: null, tinhTrang: "", ghiChu: "", sale: null }],
        saleUserId: null,
      }),
    );
    if ("loi" in ra || !ra.orderId) throw new Error(`nhập cũ: ${"loi" in ra ? ra.loi : "không tạo đơn"}`);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: ra.orderId }, select: { id: true } });
    const lop = await db.class.create({ data: { id: `${k.ma}-cu-lop`, name: `Lớp cũ ${k.ma}`, courseId: k.khoa.id, centerId: k.centerId } });
    const gd = await db.enrollment.create({ data: { id: `${k.ma}-cu-gd`, studentId: be.studentId, classId: lop.id, courseId: k.khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: p.ngaySheet } });
    await db.orderItem.update({ where: { id: item.id }, data: { studentId: be.studentId, enrollmentId: gd.id } });
    const khoan = await db.payment.findMany({ where: { orderId: ra.orderId }, select: { id: true } });
    for (const x of khoan) await db.payment.update({ where: { id: x.id }, data: { enrollmentId: gd.id, orderItemId: item.id } });
    const daGhim = await db.auditLog.updateMany({ where: { module: "finance", entityType: "Order", action: "CREATE", entityId: ra.orderId }, data: { createdAt: p.ngayNhap } });
    expect(daGhim.count, "đơn nhập cũ phải có đúng một dòng audit tạo đơn").toBe(1);
    if (p.xacNhan) for (const x of khoan) expect((await confirmPayment({ paymentId: x.id, confirmedById: k.ketToanB.id })).ok).toBe(true);
    return { orderId: ra.orderId, orderItemId: item.id };
  }

  async function caNhapCu(p: { ngaySheet: Date; ngayNhap: Date }) {
    const k = await dungKichBan("plb9", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
    cuaToi.push(k);
    const beB = await dungBe(k, "b", { tongTien: 10_000_000, ngayDon: D("2026-10-10") });
    await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-15") });
    const cu = await donNhapCu(k, beB, { ...p, xacNhan: true });
    return { k, beB, cu };
  }

  it.each([
    { ten: "ngày sheet 01/01/2026", ngaySheet: D("2026-01-01") },
    { ten: "ngày sheet 2020 (lùi xa)", ngaySheet: D("2020-03-03") },
    { ten: "ngày sheet 2030 (tương lai)", ngaySheet: D("2030-01-01") },
  ])("[PLB-09] đơn nhập cũ được máy chủ ghi nhận SAU khi B tạo (nhập 12/10 > tạo B 10/10) ⇒ KHÔNG biết đơn nào mua trước ⇒ cả hai bị giữ — $ten KHÔNG đổi kết quả", async ({ ngaySheet }) => {
    const c = await caNhapCu({ ngaySheet, ngayNhap: D("2026-10-12") });
    expect(await phanLoai(c.beB.orderItemId)).toBe("MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED");
    expect(await phanLoai(c.cu.orderItemId)).toBe("MANUAL_REVIEW/BACKFILL_ORDER_TIME_UNVERIFIED");
  });

  it("[PLB-10] đối chứng DƯƠNG: đơn nhập cũ được máy chủ ghi nhận TRƯỚC khi B tạo (nhập 08/10) ⇒ chắc chắn là tiền lệ ⇒ B = RENEWAL, đơn cũ = NEW — kể cả khi ngày sheet là 2030 (không đọc)", async () => {
    const c = await caNhapCu({ ngaySheet: D("2030-01-01"), ngayNhap: D("2026-10-08") });
    expect(await phanLoai(c.beB.orderItemId)).toBe("RENEWAL/PRIOR_PURCHASE");
    expect(await phanLoai(c.cu.orderItemId)).toBe("NEW/FIRST_PURCHASE");
  });

  // ── [PLB-11..12] HOÀ GIỜ TẠO và NHIỀU KHOẢN THU ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it.each([
    { ten: "A có id nhỏ", dauTen: "a", sauTen: "b" },
    { ten: "B có id nhỏ", dauTen: "z", sauTen: "b0" },
  ])("[PLB-11] hai đơn thường CÙNG giờ tạo đến từng mili-giây: id đơn nhỏ hơn là lần mua trước — đúng MỘT NEW và MỘT RENEWAL, $ten, đổi id thì đổi vai", async ({ dauTen, sauTen }) => {
    const k = await dungKichBan("plb11", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
    cuaToi.push(k);
    const ngay = new Date("2026-10-10T03:00:00.000Z");
    const beA = await dungBe(k, dauTen, { ngayDon: ngay });
    await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
    const b = await donThem(k, beA, { ten: sauTen, ngayTao: ngay, ngayThu: D("2026-10-11") });
    const [la, lb] = [await phanLoai(beA.orderItemId), await phanLoai(b.orderItemId)];
    expect([la, lb].sort()).toEqual(["NEW/FIRST_PURCHASE", "RENEWAL/PRIOR_PURCHASE"]);
    const idNho = beA.orderId < b.orderId ? "a" : "b";
    expect(idNho === "a" ? la : lb).toBe("NEW/FIRST_PURCHASE");
  });

  it("[PLB-12] nhiều khoản thu của MỘT đơn (3 đợt, ngày bất kỳ) không đổi thứ tự lần mua: A có 3 khoản, B có 1 khoản ngày lùi sâu ⇒ A (tạo trước) vẫn NEW, B vẫn RENEWAL", async () => {
    const k = await dungKichBan("plb12", { rules: [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" }] });
    cuaToi.push(k);
    const beA = await dungBe(k, "a", { ngayDon: D("2026-10-01") });
    for (const [ngay, tien] of [[D("2026-10-25"), 3_000_000], [D("2026-10-05"), 3_000_000], [D("2026-10-15"), 4_000_000]] as const) await tienVe(k, beA, { soTien: tien, ngay });
    const b = await donThem(k, beA, { ten: "b", ngayTao: D("2026-10-10"), ngayThu: D("2020-01-01") });
    expect(await phanLoai(beA.orderItemId)).toBe("NEW/FIRST_PURCHASE");
    expect(await phanLoai(b.orderItemId)).toBe("RENEWAL/PRIOR_PURCHASE");
  });

  // ── [PLB-T1..T2] NGÀY THU / NGÀY HOÀN DO NGƯỜI GHI KHAI KHÔNG QUYẾT ĐƯỢC NEW/RENEWAL của tiền lệ đã thu rồi HUỶ/HOÀN (luật v4 — đóng nốt nửa còn lại của §4) ──────────────────────────────────────
  // Trước v4: τ = ngày thu dương đầu của đơn = `Payment.paidDate` (người ghi khai) được so với mốc huỷ (giờ máy chủ) và ngày khoản hoàn (cũng người khai) ⇒ cùng một sự thật (A thu 05/09 rồi huỷ 20/09;
  // B tạo 10/09) ra B = RENEWAL 2% nếu B khai thu 15/09, B = NEW 9% nếu khai 25/09 — người hưởng hoa hồng (`payments:record`) chọn được.
  // Luật v4: xếp tiền lệ bằng HAI cách đọc (ngày khai · giờ máy chủ `Payment.createdAt`); khác nhau ⇒ GIỮ `PRECEDENT_STATUS_DATE_DEPENDENT`, không đoán. Bất biến kiểm ở đây: KHAI NGÀY NÀO cũng không ra
  // NEW/RENEWAL khác với kết quả theo giờ máy chủ — chỉ ra đúng kết quả đó (khi ngày khai không rơi giữa hai mốc) hoặc bị GIỮ.
  // Fixture ghi bằng đồng hồ THẬT nên `Payment.createdAt` là «bây giờ»: ca nào cần «khoản này được ghi lúc X» phải GHIM `createdAt` (luật 19) — dữ liệu trung thực = ngày khai ≈ ngày ghi.
  const RULES_NR = [{ vai: "SALE", rate: 0.09 }, { vai: "SALE", rate: 0.02, loai: "RENEWAL" as const }];
  const GIU = "MANUAL_REVIEW/PRECEDENT_STATUS_DATE_DEPENDENT";

  /** A: tạo 01/09, thu 05/09 (khai đúng ngày ghi), HUỶ 20/09 (giờ máy chủ). B (cùng học viên): tạo 10/09, khoản thu đầu khai `khaiB` nhưng máy chủ ghi lúc `ghiB`. */
  async function caHuy(p: { ghiB: Date; khaiB: Date }) {
    const k = await dungKichBan("plbt1", { rules: RULES_NR });
    cuaToi.push(k);
    const beA = await dungBe(k, "a", { ngayDon: D("2026-09-01") });
    const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-09-05") });
    await ghimGioGhi(pA, D("2026-09-05"));
    await db.order.update({ where: { id: beA.orderId }, data: { status: "CANCELLED" } });
    await db.orderStatusHistory.create({ data: { orderId: beA.orderId, fromStatus: "CONFIRMED", toStatus: "CANCELLED", changedByName: "fixture PLB-T1", createdAt: D("2026-09-20") } });
    const b = await donThem(k, beA, { ten: "b", ngayTao: D("2026-09-10"), ngayThu: p.khaiB });
    await ghimGioGhi(b.paymentId, p.ghiB);
    return { k, beA, b };
  }

  it.each([
    { ten: "máy chủ ghi B 22/09 (SAU huỷ ⇒ A đã chết) · B khai 15/09 (TRƯỚC huỷ ⇒ A còn sống): hai cách đọc LỆCH ⇒ GIỮ, không RENEWAL 2%", ghiB: D("2026-09-22"), khaiB: D("2026-09-15"), mong: GIU },
    { ten: "máy chủ ghi B 22/09 · B khai 25/09: hai cách đọc cùng ra «A đã chết» ⇒ NEW", ghiB: D("2026-09-22"), khaiB: D("2026-09-25"), mong: "NEW/FIRST_PURCHASE" },
    { ten: "đối chứng DƯƠNG, dữ liệu trung thực (khai = ghi = 22/09) ⇒ NEW như trước v4, KHÔNG thêm hold", ghiB: D("2026-09-22"), khaiB: D("2026-09-22"), mong: "NEW/FIRST_PURCHASE" },
    { ten: "máy chủ ghi B 18/09 (TRƯỚC huỷ ⇒ A còn sống) · B khai 25/09 (SAU huỷ — lùi để thành NEW 9%): LỆCH ⇒ GIỮ, không NEW", ghiB: D("2026-09-18"), khaiB: D("2026-09-25"), mong: GIU },
    { ten: "máy chủ ghi B 18/09 · B khai 15/09: hai cách đọc cùng ra «A còn sống» ⇒ RENEWAL", ghiB: D("2026-09-18"), khaiB: D("2026-09-15"), mong: "RENEWAL/PRIOR_PURCHASE" },
    { ten: "đối chứng DƯƠNG, dữ liệu trung thực (khai = ghi = 18/09) ⇒ RENEWAL như trước v4, KHÔNG thêm hold", ghiB: D("2026-09-18"), khaiB: D("2026-09-18"), mong: "RENEWAL/PRIOR_PURCHASE" },
  ])("[PLB-T1] cùng sự thật «A thu 05/09 rồi huỷ 20/09, B tạo 10/09»: $ten", async ({ ghiB, khaiB, mong }) => {
    const c = await caHuy({ ghiB, khaiB });
    expect(await phanLoai(c.b.orderItemId)).toBe(mong);
    // Bằng chứng nêu đúng đơn vướng khi giữ; không giữ thì không có.
    const kq = await phanLoaiDongDon(db, { orderItemId: c.b.orderItemId });
    expect(kq?.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual(mong === GIU ? [c.beA.orderItemId] : []);
  });

  it.each([
    { ten: "A còn sống theo giờ máy chủ (B ghi 18/09 < huỷ 20/09): khai ngày nào cũng KHÔNG ra NEW", ghiB: D("2026-09-18"), khongBaoGioRa: "NEW/FIRST_PURCHASE" },
    { ten: "A đã chết theo giờ máy chủ (B ghi 22/09 > huỷ 20/09): khai ngày nào cũng KHÔNG ra RENEWAL", ghiB: D("2026-09-22"), khongBaoGioRa: "RENEWAL/PRIOR_PURCHASE" },
  ])("[PLB-T1b] (bất biến) $ten — quét nhiều ngày khai (2020 · trước/giữa/sau mốc huỷ · 2030)", async ({ ghiB, khongBaoGioRa }) => {
    for (const khaiB of [D("2020-01-01"), D("2026-09-01"), D("2026-09-19"), D("2026-09-20"), D("2026-09-21"), D("2026-10-30"), D("2030-01-01")]) {
      const c = await caHuy({ ghiB, khaiB });
      const ra = await phanLoai(c.b.orderItemId);
      expect(ra, `khai ${khaiB.toISOString()}`).not.toBe(khongBaoGioRa);
      expect([GIU, ghiB.getTime() < D("2026-09-20").getTime() ? "RENEWAL/PRIOR_PURCHASE" : "NEW/FIRST_PURCHASE"], `khai ${khaiB.toISOString()}`).toContain(ra);
    }
  });

  it("[PLB-T3] τ máy chủ là giờ ghi SỚM NHẤT trong các khoản thu dương của đơn (không phải khoản cuối): B thu hai đợt, đợt 1 ghi 18/09 (A còn sống), đợt 2 ghi 25/09 (A đã chết) ⇒ RENEWAL — trung thực; đợt 2 khai LÙI 10/09 cũng không đổi gì (cùng phía)", async () => {
    for (const khaiDot2 of [D("2026-09-25"), D("2026-09-10")]) {
      const c = await caHuy({ ghiB: D("2026-09-18"), khaiB: D("2026-09-18") });
      // đợt 2 của B: cùng đơn, cùng dòng — ghi bằng hàm thật rồi ghim giờ ghi 25/09.
      const dot2 = await tienVe(c.k, { studentId: c.beA.studentId, enrollmentId: `${c.k.ma}-b-gd`, orderId: c.b.orderId, orderItemId: c.b.orderItemId }, { soTien: 1_000_000, ngay: khaiDot2 });
      await ghimGioGhi(dot2, D("2026-09-25"));
      expect(await phanLoai(c.b.orderItemId), `đợt 2 khai ${khaiDot2.toISOString()}`).toBe("RENEWAL/PRIOR_PURCHASE");
    }
  });

  /** A: thu 05/09 rồi HOÀN SẠCH (máy chủ ghi khoản hoàn lúc `ghiHoan`, người ghi khai ngày hoàn `khaiHoan`). B: tạo 10/09, khoản thu đầu khai VÀ ghi 15/09 (trung thực). */
  async function caHoan(p: { ghiHoan: Date; khaiHoan: Date }) {
    const k = await dungKichBan("plbt2", { rules: RULES_NR });
    cuaToi.push(k);
    const beA = await dungBe(k, "a", { ngayDon: D("2026-09-01") });
    const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-09-05") });
    await ghimGioGhi(pA, D("2026-09-05"));
    const b = await donThem(k, beA, { ten: "b", ngayTao: D("2026-09-10"), ngayThu: D("2026-09-15") });
    await ghimGioGhi(b.paymentId, D("2026-09-15"));
    const hoan = await hoanTien(k, pA, { soTien: 10_000_000, ngay: p.khaiHoan });
    await ghimGioGhi(hoan, p.ghiHoan);
    return { k, beA, b };
  }

  it.each([
    { ten: "máy chủ ghi hoàn 12/09 (TRƯỚC τ ⇒ A đã hoàn sạch) · khai hoàn 20/09 (SAU τ ⇒ A còn nguyên): LỆCH ⇒ GIỮ", ghiHoan: D("2026-09-12"), khaiHoan: D("2026-09-20"), mong: GIU },
    { ten: "máy chủ ghi hoàn 12/09 · khai hoàn 2030: LỆCH ⇒ GIỮ", ghiHoan: D("2026-09-12"), khaiHoan: D("2030-01-01"), mong: GIU },
    { ten: "đối chứng DƯƠNG, trung thực (ghi = khai = 12/09 < τ 15/09) ⇒ A bị loại ⇒ NEW", ghiHoan: D("2026-09-12"), khaiHoan: D("2026-09-12"), mong: "NEW/FIRST_PURCHASE" },
    { ten: "máy chủ ghi hoàn 20/09 (SAU τ ⇒ hoàn muộn không viết lại lịch sử) · khai hoàn 12/09 (TRƯỚC τ — lùi để thành NEW 9%): LỆCH ⇒ GIỮ", ghiHoan: D("2026-09-20"), khaiHoan: D("2026-09-12"), mong: GIU },
    { ten: "đối chứng DƯƠNG, trung thực (ghi = khai = 20/09 > τ 15/09) ⇒ A vẫn là lần mua thật ⇒ RENEWAL", ghiHoan: D("2026-09-20"), khaiHoan: D("2026-09-20"), mong: "RENEWAL/PRIOR_PURCHASE" },
  ])("[PLB-T2] khoản HOÀN của tiền lệ: $ten", async ({ ghiHoan, khaiHoan, mong }) => {
    const c = await caHoan({ ghiHoan, khaiHoan });
    expect(await phanLoai(c.b.orderItemId)).toBe(mong);
  });
});
