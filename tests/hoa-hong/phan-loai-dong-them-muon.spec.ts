// @vitest-environment node
/**
 * [PLM-*] — DÒNG THÊM MUỘN VÀO ĐƠN CÓ SẴN + BẢO LƯU THEO GIỜ MÁY CHỦ (luật phân loại v5), đầu-cuối trên Postgres THẬT: dòng tiền dựng bằng hàm ghi thật (`recordPayment` → `confirmPayment`),
 * phân loại bằng `phanLoaiDongDon`, quét bằng `quetKhoan`, số tiền đọc THẲNG từ bảng sổ.
 *
 * Lỗ (reviewer tài chính vòng 5): khoá K của một DÒNG lấy `Order.createdAt` của ĐƠN CHỨA nó. Dòng học phí được THÊM vào đơn cũ (`themConVaoDonAction` — người có `orders:manage`)
 * thừa kế K của đơn cũ ⇒ lần mua tái tục bị phân loại NEW 9% (900.000đ trên 10tr) thay vì RENEWAL 2% (200.000đ). Probe: học viên S mua đơn A (01/09, đã thu, NEW); thêm dòng cho S vào đơn O của
 * anh/chị em tạo từ 01/08 thay vì mở đơn mới ⇒ K(dòng mới) = (01/08, O) sớm hơn A ⇒ A thành SAU, không là tiền lệ.
 *
 * Nhận diện dòng thêm muộn = dòng AuditLog `THEM_CON_VAO_DON` do máy chủ ghi CÙNG transaction (`conMoi.id` = id dòng) — KHÔNG đoán theo khoảng cách `OrderItem.createdAt − Order.createdAt` (đường nhập
 * cũ đặt `Order.createdAt` = ngày trong sheet nhưng dòng mang giờ NHẬP, `[NHH-TRX-D17]`): `[PLM-04]` giữ điều đó.
 *
 *   [PLM-01] probe: dòng thêm muộn sau khi A đã NEW ⇒ RENEWAL 200.000đ (trước vá: NEW 900.000đ)
 *   [PLM-02] HOÁN VỊ dữ liệu: dòng muộn đã có TRƯỚC khi A được quét ⇒ A vẫn NEW (trước vá: A bị giữ vì «tiền lệ chưa chốt»), L sau đó RENEWAL
 *   [PLM-03] HOÁN VỊ quét: L được quét TRƯỚC A ⇒ L giữ; A NEW; quét lại L ⇒ RENEWAL — cùng kết quả cuối với [PLM-02]
 *   [PLM-04] không có dấu audit ⇒ KHÔNG bị coi là thêm muộn dù dòng tạo muộn hơn đơn rất nhiều (đối chứng với cách đoán theo ngưỡng thời gian)
 *   [PLM-05] cùng học viên, cùng ĐƠN: dòng thêm muộn là lần mua riêng ⇒ RENEWAL
 *   [PLM-06] τ của dòng thêm muộn chỉ tính từ khoản thu GHI SAU khi dòng tồn tại — khoản của anh/chị em trước đó không kéo τ về quá khứ (bảo lưu bắt đúng)
 *   [PLM-07] bảo lưu xét CẢ ngày khai lẫn giờ máy chủ: lùi `paidDate` ra ngoài kỳ bảo lưu không thoát được (và chiều ngược); đối chứng dương: dữ liệu trung thực ngoài kỳ ⇒ vẫn NEW
 *   [PLM-08] dòng thêm muộn vào đơn CHƯA KIỂM CHỨNG giờ tạo ⇒ giờ lúc thêm vẫn là giờ máy chủ đã kiểm chứng ⇒ RENEWAL (không bị giữ vì đơn gốc)
 *
 * Mỗi ca tự dựng kịch bản riêng (luật 18); ngày TUYỆT ĐỐI (luật 19). NEW 9% · RENEWAL 2% trên khoản 10.000.000đ ⇒ 900.000đ vs 200.000đ.
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/phan-loai-dong-them-muon.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { AUDIT_NGUON_DON_NHAP_CU, phanLoaiDongDon } from "../../lib/hoa-hong/phan-loai-giao-dich-db";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, type Be, type KichBan } from "./_kich-ban";
import { ghimGioGhi, tienVeTrungThuc as tienVe } from "./phan-loai-gio-ghi";

if (!RUN_DB_TESTS) console.warn(`[PLM] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const NEW_10TR = 900_000;
const RENEWAL_10TR = 200_000;
const RULES = [
  { vai: "SALE", rate: 0.09 },
  { vai: "SALE", rate: 0.02, loai: "RENEWAL" as const },
];
const cuaToi: KichBan[] = [];

async function kichBan(tien: string) {
  const k = await dungKichBan(tien, { rules: RULES });
  cuaToi.push(k);
  return { k, bc: await boiCanh(k, NOW) };
}

/**
 * Thêm MỘT dòng học phí của học viên `be` vào đơn CÓ SẴN `orderId` vào lúc `luc` — đúng hình dạng `themConVaoDon`: ghi danh mới + `OrderItem` gắn vào đơn cũ + dòng AuditLog
 * `finance / Order / THEM_CON_VAO_DON` với `newValues.conMoi.id` = id dòng, cùng giờ. `coDau = false` dựng dòng tạo muộn mà KHÔNG có dấu (như đường nhập cũ).
 */
async function themDongMuon(k: KichBan, be: Be, orderId: string, ten: string, luc: Date, coDau = true): Promise<Be> {
  const id = `${k.ma}-${ten}`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 4 ${id}`, slug: `${id}-sata4`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const gd = await db.enrollment.create({ data: { id: `${id}-gd`, studentId: be.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: luc } });
  const dong = await db.orderItem.create({
    data: { id: `${id}-oi`, orderId, type: "COURSE_ENROLLMENT", itemName: `Học phí ${ten}`, quantity: 1, unitPrice: 10_000_000, totalPrice: 10_000_000, studentId: be.studentId, enrollmentId: gd.id, createdAt: luc },
  });
  if (coDau) {
    await db.auditLog.create({
      data: {
        actorName: "fixture PLM",
        module: "finance",
        entityType: "Order",
        entityId: orderId,
        action: "THEM_CON_VAO_DON",
        changedFields: ["items", "totalAmount"],
        newValues: { conMoi: { id: dong.id, ten: `Học phí ${ten}`, thanhTien: 10_000_000 } },
        createdAt: luc,
      },
    });
  }
  return { studentId: be.studentId, enrollmentId: gd.id, orderId, orderItemId: dong.id };
}

const stCua = (orderItemId: string) => db.studentTransaction.findUniqueOrThrow({ where: { orderItemId } });
const tienSale = async (paymentId: string) => (await dongSoCuaKhoan(paymentId)).filter((d) => d.roleCode === "SALE").map((d) => ({ loai: d.transactionTypeCode, tien: d.amount }));

describe.skipIf(!RUN_DB_TESTS)("[PLM] dòng thêm muộn vào đơn có sẵn + bảo lưu theo giờ máy chủ (luật v5)", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  /** T (anh/chị) có đơn O từ 01/08, đã thu 05/08 (trước mốc cutover ⇒ không vào lượt quét). S mua đơn A 01/09. */
  async function dung(tien: string) {
    const { k, bc } = await kichBan(tien);
    const beT = await dungBe(k, "t", { ngayDon: D("2026-08-01") });
    await tienVe(k, beT, { soTien: 10_000_000, ngay: D("2026-08-05") });
    const beA = await dungBe(k, "s", { ngayDon: D("2026-09-01") });
    return { k, bc, beT, beA };
  }

  it("[PLM-01] PROBE: S đã NEW ở đơn A; dòng của S được THÊM vào đơn cũ của anh/chị em (01/08) vào 02/10 ⇒ dòng mới RENEWAL 200.000đ — không phải NEW 900.000đ", async () => {
    const c = await dung("plm01");
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect(await quetKhoan(db, c.bc, pA)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pA)).toEqual([{ loai: "NEW", tien: NEW_10TR }]);

    const beL = await themDongMuon(c.k, c.beA, c.beT.orderId, "l", D("2026-10-02"));
    const pL = await tienVe(c.k, beL, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, c.bc, pL)).toMatchObject({ loai: "DA_GHI" });
    expect(await stCua(beL.orderItemId)).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "RENEWAL", reasonCode: "PRIOR_PURCHASE" });
    expect(await tienSale(pL)).toEqual([{ loai: "RENEWAL", tien: RENEWAL_10TR }]);
    // A đã đóng băng — không bị lần thêm muộn lật.
    expect(await stCua(c.beA.orderItemId)).toMatchObject({ transactionTypeCode: "NEW" });
  });

  it("[PLM-02] HOÁN VỊ DỮ LIỆU: dòng muộn đã nằm trong đơn O TRƯỚC khi A được quét ⇒ A vẫn NEW (dòng muộn ra đời SAU A nên không là tiền lệ của A), rồi dòng muộn RENEWAL", async () => {
    const c = await dung("plm02");
    const beL = await themDongMuon(c.k, c.beA, c.beT.orderId, "l", D("2026-10-02"));
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const pL = await tienVe(c.k, beL, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, c.bc, pA)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pA)).toEqual([{ loai: "NEW", tien: NEW_10TR }]);
    expect(await quetKhoan(db, c.bc, pL)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pL)).toEqual([{ loai: "RENEWAL", tien: RENEWAL_10TR }]);
  });

  it("[PLM-03] HOÁN VỊ QUÉT: quét dòng muộn TRƯỚC A ⇒ bị GIỮ (A chưa thu — chưa biết có phải lần mua thật không); A NEW; quét lại dòng muộn ⇒ RENEWAL — cùng kết quả cuối với [PLM-02]", async () => {
    const c = await dung("plm03");
    const beL = await themDongMuon(c.k, c.beA, c.beT.orderId, "l", D("2026-10-02"));
    const pL = await tienVe(c.k, beL, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const dau = await quetKhoan(db, c.bc, pL);
    expect(dau.loai).toBe("GIU");
    expect(await dongSoCuaKhoan(pL)).toEqual([]);

    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, c.bc, pA)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pA)).toEqual([{ loai: "NEW", tien: NEW_10TR }]);
    expect(await quetKhoan(db, c.bc, pL)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pL)).toEqual([{ loai: "RENEWAL", tien: RENEWAL_10TR }]);
  });

  it("[PLM-04] ĐỐI CHỨNG: dòng tạo muộn hơn đơn rất nhiều nhưng KHÔNG có dấu audit (như đường nhập cũ — dòng mang giờ NHẬP) ⇒ KHÔNG bị coi là thêm muộn: K vẫn là của đơn ⇒ kết quả như trước vá (NEW)", async () => {
    const c = await dung("plm04");
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, c.bc, pA);
    const beL = await themDongMuon(c.k, c.beA, c.beT.orderId, "l", D("2026-10-02"), false);
    // K của dòng = (01/08, O) < K(A) = 01/09 ⇒ A là SAU ⇒ không là tiền lệ ⇒ NEW. (Nếu đoán «muộn» theo khoảng cách giờ thì dòng này sẽ thành RENEWAL.)
    expect(await phanLoaiDongDon(db, { orderItemId: beL.orderItemId })).toMatchObject({ loai: "NEW", maLuat: "FIRST_PURCHASE" });
  });

  it("[PLM-05] CÙNG học viên, CÙNG đơn: dòng gốc đã thu + dòng THÊM MUỘN vào chính đơn ấy ⇒ dòng muộn là lần mua riêng ⇒ RENEWAL (trước vá: «cùng đơn = một lần mua» ⇒ NEW)", async () => {
    const { k, bc } = await kichBan("plm05");
    const beA = await dungBe(k, "s", { ngayDon: D("2026-09-01") });
    const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect(await quetKhoan(db, bc, pA)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pA)).toEqual([{ loai: "NEW", tien: NEW_10TR }]);

    const beL = await themDongMuon(k, beA, beA.orderId, "l", D("2026-10-02"));
    const pL = await tienVe(k, beL, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, bc, pL)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pL)).toEqual([{ loai: "RENEWAL", tien: RENEWAL_10TR }]);
    // Đối chứng dương: dòng GỐC không bị dòng muộn lật ngược (vẫn NEW).
    expect(await stCua(beA.orderItemId)).toMatchObject({ transactionTypeCode: "NEW" });
  });

  it("[PLM-06] τ của dòng thêm muộn tính từ khoản thu GHI SAU khi dòng tồn tại: khoản của anh/chị em (05/08) không kéo τ về trước kỳ bảo lưu 05/10 ⇒ dòng muộn thu 12/10 dính BAO_LUU", async () => {
    const c = await dung("plm06");
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, c.bc, pA);
    const beL = await themDongMuon(c.k, c.beA, c.beT.orderId, "l", D("2026-10-02"));
    await db.studentReserve.create({
      data: { studentId: beL.studentId, enrollmentId: beL.enrollmentId, reason: "ốm", startedAt: D("2026-10-05"), createdByName: "fixture PLM", isActive: true },
    });
    await tienVe(c.k, beL, { soTien: 10_000_000, ngay: D("2026-10-12") });
    const r = await phanLoaiDongDon(db, { orderItemId: beL.orderItemId });
    expect([r?.trangThai, r?.maLuat]).toEqual(["PENDING_REGULATION", "BAO_LUU"]);
    // τ của dòng là khoản của CHÍNH nó (12/10), không phải khoản của anh/chị em (05/08).
    expect(r?.bangChung.tau).toBe(D("2026-10-12").toISOString());
  });

  it("[PLM-07] bảo lưu 01/06–30/06: khoản thu thật 15/06 khai paidDate = 20/05 (lùi ra ngoài kỳ) ⇒ vẫn PENDING_REGULATION / BAO_LUU; đối chứng: khai đúng 15/06 ⇒ BAO_LUU như cũ; thu thật 20/05 khai 20/05 (ngoài kỳ cả hai cách) ⇒ NEW", async () => {
    const lap = async (tien: string, paidDate: Date, gioGhi: Date) => {
      const { k } = await kichBan(tien);
      const be = await dungBe(k, "a", { ngayDon: D("2026-05-01") });
      await db.studentReserve.create({
        data: { studentId: be.studentId, enrollmentId: be.enrollmentId, reason: "ốm", startedAt: D("2026-06-01"), endedAt: D("2026-06-30"), createdByName: "fixture PLM", isActive: false },
      });
      const p = await tienVe(k, be, { soTien: 10_000_000, ngay: paidDate });
      await ghimGioGhi(p, gioGhi);
      const r = await phanLoaiDongDon(db, { orderItemId: be.orderItemId });
      return [r?.loai, r?.trangThai, r?.maLuat];
    };
    expect(await lap("plm07a", D("2026-05-20"), D("2026-06-15"))).toEqual(["MANUAL_REVIEW", "PENDING_REGULATION", "BAO_LUU"]);
    expect(await lap("plm07b", D("2026-06-15"), D("2026-06-15"))).toEqual(["MANUAL_REVIEW", "PENDING_REGULATION", "BAO_LUU"]);
    expect(await lap("plm07c", D("2026-05-20"), D("2026-05-20"))).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
    // chiều ngược: ngày khai TRONG kỳ nhưng giờ máy chủ NGOÀI kỳ ⇒ cũng giữ (hai cách đọc lệch nhau thì không để người khai chọn).
    expect(await lap("plm07d", D("2026-06-15"), D("2026-05-20"))).toEqual(["MANUAL_REVIEW", "PENDING_REGULATION", "BAO_LUU"]);
  });

  it("[PLM-08] dòng thêm muộn vào đơn CHƯA KIỂM CHỨNG GIỜ TẠO (đơn nhập giao dịch cũ): giờ lúc thêm là giờ máy chủ đã kiểm chứng ⇒ vẫn RENEWAL, không bị giữ `BACKFILL_ORDER_TIME_UNVERIFIED` vì đơn gốc", async () => {
    const c = await dung("plm08");
    // Đơn O của T là đơn «nhập giao dịch cũ» (dấu AuditLog do máy chủ ghi) — `Order.createdAt` của nó không nói được lúc mua thật.
    await db.auditLog.create({
      data: { actorName: "fixture PLM", module: "finance", entityType: "Order", entityId: c.beT.orderId, action: "CREATE", newValues: { source: AUDIT_NGUON_DON_NHAP_CU }, createdAt: D("2026-08-02") },
    });
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect(await quetKhoan(db, c.bc, pA)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pA)).toEqual([{ loai: "NEW", tien: NEW_10TR }]);

    const beL = await themDongMuon(c.k, c.beA, c.beT.orderId, "l", D("2026-10-02"));
    const pL = await tienVe(c.k, beL, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, c.bc, pL)).toMatchObject({ loai: "DA_GHI" });
    expect(await tienSale(pL)).toEqual([{ loai: "RENEWAL", tien: RENEWAL_10TR }]);
  });
});
