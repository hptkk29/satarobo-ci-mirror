// @vitest-environment node
/**
 * [PLQ-*] — PHÂN LOẠI NEW/RENEWAL CÓ PHỤ THUỘC THỜI ĐIỂM QUÉT KHÔNG? Đầu-cuối trên Postgres THẬT (engine thật, dòng tiền dựng bằng hàm ghi thật).
 *
 * Nghi vấn (reviewer gt2 R1-M5, suy từ mã): `phan-loai-giao-dich-db.ts` lấy "thực thu của lần mua trước" ở THỜI ĐIỂM QUÉT (không cắt theo ngày thu của
 * khoản đang xét), còn `chotPhanLoai` (quet-khoan.ts) ĐÓNG BĂNG kết quả lần quét đầu ⇒ cùng một dữ liệu, quét sớm hay quét muộn cho phân loại KHÁC nhau.
 *
 * KẾT LUẬN: TÁI HIỆN ĐƯỢC. Kịch bản: học viên có đơn A (tạo 01/09, 10tr) và đơn B (tạo 10/09, 10tr). B thu 05/10, A thu 12/10.
 *   · cron quét NGAY khi B thu (A chưa thu)            ⇒ B = NEW      (mức NEW)
 *   · cron nghẽn / bù khoản trễ, quét cả A lẫn B một mẻ ⇒ B = RENEWAL  (mức RENEWAL)
 * Cùng bộ dữ liệu cuối cùng, hai kết quả khác nhau — chỉ vì cron chạy lúc nào. Chênh = (mức NEW − mức RENEWAL) × cơ sở tính của khoản B; xem PLQ-04.
 *
 * Quy ước ca: ca XANH = mô tả HÀNH VI HIỆN TẠI (dữ kiện); `it.fails` = hành vi ĐÚNG mong muốn, sẽ ĐỎ khi bản vá hạ cánh (buộc gỡ ghim — mẫu
 * "GHIM BUG bằng it.fails" của CLAUDE.md). Mỗi ca tự dựng kịch bản riêng (luật 18); ngày TUYỆT ĐỐI (luật 19).
 *
 * KHÔNG sửa luật phân loại ở đợt này (chạm tiền): đề xuất sửa nằm ở docs/source-commission/08-nguon-dong.md §14.
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc riêng `vitest run -c vitest.db.config.ts tests/hoa-hong/phan-loai-thoi-diem-quet.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { quetCacKhoan } from "../../lib/hoa-hong/quet-ky";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, hoanTien, tienVe, type Be, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[PLQ] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
/** NEW 9% / RENEWAL 2% — đúng cặp mức của bài toán (một vai SALE để số tiền đọc thẳng được, không lẫn người hưởng khác). */
const RULES = [
  { vai: "SALE", rate: 0.09 },
  { vai: "SALE", rate: 0.02, loai: "RENEWAL" as const },
];
const cuaToi: KichBan[] = [];

async function kb() {
  const k = await dungKichBan("plq", { rules: RULES });
  cuaToi.push(k);
  return k;
}

/** LẦN MUA THỨ HAI của CÙNG học viên (đơn + ghi danh + MỘT dòng học phí), `ngayDon` = ngày của ĐƠN. (Bản sao của helper trong phan-loai-lan-mua.spec.ts.) */
async function lanMuaThem(k: KichBan, be: Be, ten: string, ngayDon: Date, tongTien = 10_000_000): Promise<Be> {
  const id = `${k.ma}-${ten}`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 4 ${id}`, slug: `${id}-sata4`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const enr = await db.enrollment.create({
    data: { id: `${id}-gd`, studentId: be.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: ngayDon },
  });
  const order = await db.order.create({
    data: {
      id: `${id}-don`,
      code: `${id}-don`.toUpperCase(),
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH",
      customerPhone: k.lead?.phone ?? "0990000001",
      totalAmount: tongTien,
      centerId: k.centerId,
      leadId: k.lead?.id ?? null,
      createdAt: ngayDon,
    },
  });
  const item = await db.orderItem.create({
    data: {
      id: `${id}-oi`,
      orderId: order.id,
      type: "COURSE_ENROLLMENT",
      itemName: `Học phí ${ten}`,
      quantity: 1,
      unitPrice: tongTien,
      totalPrice: tongTien,
      studentId: be.studentId,
      enrollmentId: enr.id,
      createdAt: ngayDon,
    },
  });
  return { studentId: be.studentId, enrollmentId: enr.id, orderId: order.id, orderItemId: item.id };
}

type QuanSat = { loai: string[]; tien: number };
async function quanSat(paymentId: string): Promise<QuanSat> {
  const dong = await dongSoCuaKhoan(paymentId);
  return { loai: [...new Set(dong.map((d) => d.transactionTypeCode))], tien: dong.reduce((s, d) => s + d.amount, 0) };
}

/** Dữ liệu CHUNG của mọi ca: A tạo 01/09, B tạo 10/09 (A TRƯỚC B), mỗi đơn 10tr một dòng học phí. */
async function capDon() {
  const k = await kb();
  const bc = await boiCanh(k, NOW);
  const beA = await dungBe(k, "a", { ngayDon: D("2026-09-01") });
  const beB = await lanMuaThem(k, beA, "b", D("2026-09-10"));
  return { k, bc, beA, beB };
}

/** CRON KỊP: B thu 05/10 và quét NGAY (A chưa thu), rồi A thu 12/10 và quét. */
async function quetKip() {
  const { k, bc, beA, beB } = await capDon();
  const pB = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
  await quetKhoan(db, bc, pB);
  const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, pA);
  return { A: await quanSat(pA), B: await quanSat(pB), k, beA, beB };
}

/** CRON NGHẼN / BÙ TRỄ: CÙNG dữ liệu, nhưng cả hai khoản được quét MỘT MẺ theo (paidDate, id) — đúng thứ tự `quetCacKhoan` của quét kỳ. */
async function quetMotMe() {
  const { k, bc, beA, beB } = await capDon();
  const pB = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
  const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
  const tong = await quetCacKhoan(db, bc, [pB, pA]); // paidDate tăng dần: B (05/10) trước A (12/10)
  expect(tong.loi).toEqual([]);
  return { A: await quanSat(pA), B: await quanSat(pB), k, beA, beB };
}

describe.skipIf(!RUN_DB_TESTS)("[PLQ] phân loại NEW/RENEWAL theo thời điểm quét", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[PLQ-01] đối chứng dương: A thu TRƯỚC rồi B thu, cron quét kịp từng khoản ⇒ A = NEW 9%, B = RENEWAL 2% (luật 'lần mua đầu NEW, lần kế RENEWAL' chạy đúng)", async () => {
    const { k, bc, beA, beB } = await capDon();
    const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, bc, pA);
    const pB = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, pB);

    const a = await quanSat(pA);
    const b = await quanSat(pB);
    expect(a.loai).toEqual(["NEW"]);
    expect(b.loai).toEqual(["RENEWAL"]);
    expect(a.tien).toBeGreaterThan(b.tien * 4); // 9% vs 2% trên cùng 10tr (cùng VAT) ⇒ gấp ~4,5 lần — không phải hai con số 0
    expect(b.tien).toBeGreaterThan(0);
  });

  it("[PLQ-02] HIỆN TRẠNG: B thu 05/10 (A đã tạo từ 01/09 nhưng CHƯA thu) và quét NGAY ⇒ B = NEW; A thu 12/10 sau đó vẫn NEW ⇒ CẢ HAI NEW 9% (dù A tạo trước)", async () => {
    const r = await quetKip();
    expect(r.B.loai).toEqual(["NEW"]);
    expect(r.A.loai).toEqual(["NEW"]);
    // Phân loại của B đã ĐÓNG BĂNG ở lượt quét đầu: A thu sau đó không kéo B về RENEWAL.
    const st = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: r.beB.orderItemId } });
    expect(st).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "NEW", reasonCode: "FIRST_PURCHASE" });
  });

  it("[PLQ-03] HIỆN TRẠNG: CÙNG dữ liệu như PLQ-02 nhưng cron quét MỘT MẺ khi cả hai đã thu ⇒ B = RENEWAL 2%, A = NEW", async () => {
    const r = await quetMotMe();
    expect(r.B.loai).toEqual(["RENEWAL"]);
    expect(r.A.loai).toEqual(["NEW"]);
    const st = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: r.beB.orderItemId } });
    expect(st).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "RENEWAL", reasonCode: "PRIOR_PURCHASE" });
  });

  // NỢ CÒN HỞ — ghim bằng `it.fails`. Thân ca mô tả hành vi ĐÚNG (kết quả không phụ thuộc lúc cron chạy). Hôm nay nó ném ⇒ ca "xanh"; vá xong ca đỏ,
  // buộc người vá gỡ ghim và đảo PLQ-02/PLQ-03 cho khớp. Chống xanh giả: nếu hàm dựng kịch bản ném (hỏng fixture) thì PLQ-02/PLQ-03 ở trên đỏ cùng lúc.
  it.fails("[PLQ-04] NỢ: cùng dữ liệu cuối cùng ⇒ phân loại của B (và số tiền hoa hồng) PHẢI như nhau dù cron quét kịp hay quét một mẻ", async () => {
    const kip = await quetKip();
    const mot = await quetMotMe();
    expect(kip.B.loai).toEqual(mot.B.loai);
    expect(kip.B.tien).toBe(mot.B.tien);
  });

  it("[PLQ-05] chênh lệch tiền của PLQ-04 đo được: cùng khoản B 10tr, quét kịp trả NEW, quét một mẻ trả RENEWAL ⇒ lệch = (9% − 2%) × cơ sở tính, và KHÔNG có hàng chờ nào báo sự bất định", async () => {
    const kip = await quetKip();
    const mot = await quetMotMe();
    const chenh = kip.B.tien - mot.B.tien;
    expect(kip.B.tien).toBeGreaterThan(mot.B.tien);
    // 9% − 2% = 7% của cơ sở tính; tiền NEW/RENEWAL tỉ lệ 9:2 (cùng VAT, làm tròn) ⇒ chênh/NEW ≈ 7/9.
    expect(Math.abs(chenh / kip.B.tien - 7 / 9)).toBeLessThan(0.01);
    // Đo 10/10/2026 (VAT 0 ở kỳ này): 900.000đ (NEW) vs 200.000đ (RENEWAL) trên khoản 10.000.000đ ⇒ lệch 700.000đ.
    expect(chenh).toBeGreaterThan(0);
    // Không dấu hiệu nào cho người vận hành: không hold OPEN ở khoản B của cả hai kịch bản.
    for (const x of [kip, mot]) {
      expect(await db.commissionHold.count({ where: { orderItemId: x.beB.orderItemId, status: "OPEN" } })).toBe(0);
    }
  });

  it("[PLQ-06] mặt thứ hai (hoàn tiền): B quét lúc A còn tiền ⇒ RENEWAL và GIỮ; còn B chưa quét lần nào khi A đã hoàn sạch ⇒ NEW — cũng phụ thuộc thời điểm quét", async () => {
    // (a) B quét khi A còn thực thu, rồi A hoàn sạch: B GIỮ RENEWAL (đóng băng, kể cả đợt thu sau).
    const a1 = await capDon();
    const pA1 = await tienVe(a1.k, a1.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, a1.bc, pA1);
    const pB1 = await tienVe(a1.k, a1.beB, { soTien: 4_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, a1.bc, pB1);
    await hoanTien(a1.k, pA1, { soTien: 10_000_000, ngay: D("2026-10-20") });
    const pB1b = await tienVe(a1.k, a1.beB, { soTien: 6_000_000, ngay: D("2026-10-25") });
    await quetKhoan(db, a1.bc, pB1b);
    expect((await quanSat(pB1)).loai).toEqual(["RENEWAL"]);
    expect((await quanSat(pB1b)).loai).toEqual(["RENEWAL"]);

    // (b) CÙNG dữ liệu, nhưng B chỉ được quét SAU khi A đã hoàn sạch ⇒ A không còn là "lần mua thật" ⇒ B = NEW.
    const a2 = await capDon();
    const pA2 = await tienVe(a2.k, a2.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const pB2 = await tienVe(a2.k, a2.beB, { soTien: 4_000_000, ngay: D("2026-10-12") });
    await hoanTien(a2.k, pA2, { soTien: 10_000_000, ngay: D("2026-10-20") });
    const pB2b = await tienVe(a2.k, a2.beB, { soTien: 6_000_000, ngay: D("2026-10-25") });
    await quetCacKhoan(db, a2.bc, [pB2, pB2b]);
    expect((await quanSat(pB2)).loai).toEqual(["NEW"]);
    expect((await quanSat(pB2b)).loai).toEqual(["NEW"]);
  });
});
