// @vitest-environment node
/**
 * [PLQ-*] — PHÂN LOẠI NEW/RENEWAL CÓ CÒN PHỤ THUỘC THỜI ĐIỂM QUÉT KHÔNG? Đầu-cuối trên Postgres THẬT (engine thật, dòng tiền dựng bằng hàm ghi thật).
 *
 * LỊCH SỬ: nghi vấn gt2 R1-M5 (10/10/2026) — luật v1 lấy "thực thu của lần mua trước" ở THỜI ĐIỂM QUÉT và `chotPhanLoai` ĐÓNG BĂNG lần quét đầu ⇒ cùng
 * dữ liệu cuối, quét sớm hay muộn cho phân loại KHÁC (B = NEW 900k vs RENEWAL 200k, lệch 700k/10tr). Các ca này từng ghim lỗi đó (PLQ-04 là `it.fails`).
 *
 * NAY (luật v2, 2026-10-16 — `phan-loai-tat-dinh.spec.ts` [PLD-*] là bộ đầy đủ): phân loại là hàm của THỨ TỰ MUA (Order.createdAt, Order.id) + τ (ngày thu
 * đầu của ĐƠN) + huỷ/hoàn có mốc. Khoản của B khi A (tạo trước) CHƯA có đồng nào KHÔNG được NEW tạm: nó bị GIỮ (hold) và tự nhả ở nhịp cron kế. Sáu ca dưới
 * đây vẫn là kịch bản gốc (A tạo 01/09, B tạo 10/09, B thu 05/10, A thu 12/10), đã đảo theo luật mới; PLQ-04 thành ca THƯỜNG (gỡ `it.fails`).
 *
 * Mỗi ca tự dựng kịch bản riêng (luật 18); ngày TUYỆT ĐỐI (luật 19).
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc riêng `vitest run -c vitest.db.config.ts tests/hoa-hong/phan-loai-thoi-diem-quet.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { quetCacKhoan, quetKy } from "../../lib/hoa-hong/quet-ky";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, type Be, type KichBan } from "./_kich-ban";
// Luật v4: fixture ghi khoản bằng đồng hồ thật ⇒ ghim `createdAt = paidDate` (dữ liệu trung thực) — xem phan-loai-gio-ghi.ts.
import { hoanTienTrungThuc as hoanTien, tienVeTrungThuc as tienVe } from "./phan-loai-gio-ghi";

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

/** Một NHỊP cron thật của kỳ 10/2026 (tập Q1 + Q3 hàng chờ mở…) — nơi khoản đang GIỮ được nhả. */
async function nhipCron(k: KichBan, bc: Awaited<ReturnType<typeof boiCanh>>) {
  const tong = await quetKy(db, bc, { thang: "2026-10", centerId: k.centerId, soThangDoiSoat: 0 });
  expect(tong.loi).toEqual([]);
}

/** CRON KỊP: B thu 05/10 và quét NGAY (A chưa thu ⇒ B bị GIỮ), A thu 12/10 và quét, rồi tới nhịp cron kế. `holdTruocCron` = số hàng chờ mở của B ngay trước nhịp ấy. */
async function quetKip() {
  const { k, bc, beA, beB } = await capDon();
  const pB = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
  await quetKhoan(db, bc, pB);
  const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, pA);
  const holdTruocCron = await db.commissionHold.count({ where: { paymentId: pB, status: "OPEN" } });
  await nhipCron(k, bc);
  return { A: await quanSat(pA), B: await quanSat(pB), holdTruocCron, k, beA, beB };
}

/** CRON NGHẼN / BÙ TRỄ: CÙNG dữ liệu, nhưng cả hai khoản được quét MỘT MẺ theo (paidDate, id) — đúng thứ tự `quetCacKhoan` của quét kỳ — rồi tới nhịp cron kế. */
async function quetMotMe() {
  const { k, bc, beA, beB } = await capDon();
  const pB = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
  const pA = await tienVe(k, beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
  const tong = await quetCacKhoan(db, bc, [pB, pA]); // paidDate tăng dần: B (05/10) trước A (12/10)
  expect(tong.loi).toEqual([]);
  const holdTruocCron = await db.commissionHold.count({ where: { paymentId: pB, status: "OPEN" } });
  await nhipCron(k, bc);
  return { A: await quanSat(pA), B: await quanSat(pB), holdTruocCron, k, beA, beB };
}

describe.skipIf(!RUN_DB_TESTS)("[PLQ] phân loại NEW/RENEWAL theo thời điểm quét (luật v2: KHÔNG còn phụ thuộc)", () => {
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

  it("[PLQ-02] B thu 05/10 khi A (đã tạo từ 01/09) CHƯA thu, quét NGAY ⇒ B bị GIỮ (không NEW tạm); A thu 12/10 vẫn NEW; tới nhịp cron kế B nhả ⇒ RENEWAL 2% (trước đây: cả hai NEW 9%)", async () => {
    const r = await quetKip();
    expect(r.holdTruocCron).toBe(1); // trong lúc chờ, người vận hành THẤY khoản đang giữ — không im lặng
    expect(r.A).toEqual({ loai: ["NEW"], tien: 900_000 });
    expect(r.B).toEqual({ loai: ["RENEWAL"], tien: 200_000 });
    const st = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: r.beB.orderItemId } });
    expect(st).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "RENEWAL", reasonCode: "PRIOR_PURCHASE" });
  });

  it("[PLQ-03] CÙNG dữ liệu như PLQ-02 nhưng cron quét MỘT MẺ khi cả hai đã thu ⇒ B = RENEWAL 2%, A = NEW (như cũ); B không cần giữ vì A đã có tiền ngay lúc quét", async () => {
    const r = await quetMotMe();
    expect(r.holdTruocCron).toBe(0);
    expect(r.B).toEqual({ loai: ["RENEWAL"], tien: 200_000 });
    expect(r.A).toEqual({ loai: ["NEW"], tien: 900_000 });
    const st = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: r.beB.orderItemId } });
    expect(st).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "RENEWAL", reasonCode: "PRIOR_PURCHASE" });
  });

  // ĐÃ VÁ (luật v2): từng là `it.fails` ghim nợ. Hôm nay là ca thường — cùng dữ liệu cuối ⇒ cùng phân loại VÀ cùng tiền, dù cron quét kịp hay quét một mẻ.
  it("[PLQ-04] cùng dữ liệu cuối cùng ⇒ phân loại của B (và số tiền hoa hồng) NHƯ NHAU dù cron quét kịp hay quét một mẻ", async () => {
    const kip = await quetKip();
    const mot = await quetMotMe();
    expect(kip.B.loai).toEqual(mot.B.loai);
    expect(kip.B.tien).toBe(mot.B.tien);
    expect(kip.A).toEqual(mot.A);
  });

  it("[PLQ-05] chênh lệch tiền ĐÃ BIẾN MẤT: khoản B 10tr quét kịp và quét một mẻ đều trả RENEWAL 200.000đ (trước: 900.000đ vs 200.000đ, lệch 700.000đ); khoản bị giữ có hàng chờ báo, không im lặng", async () => {
    const kip = await quetKip();
    const mot = await quetMotMe();
    expect(kip.B.tien - mot.B.tien).toBe(0);
    expect(kip.B.tien).toBe(200_000);
    // Quét kịp: B bị giữ ĐÚNG MỘT hàng chờ mở trước nhịp cron. Quét một mẻ: A đã có tiền lúc quét B ⇒ không cần giữ.
    expect(kip.holdTruocCron).toBe(1);
    expect(mot.holdTruocCron).toBe(0);
    // Sau nhịp cron, không còn hàng chờ nào mở ở khoản B.
    for (const x of [kip, mot]) {
      expect(await db.commissionHold.count({ where: { orderItemId: x.beB.orderItemId, status: "OPEN" } })).toBe(0);
    }
  });

  it("[PLQ-06] mặt thứ hai (hoàn tiền): hoàn A SAU khi B có tiền (20/10 > τ(B) = 12/10) KHÔNG lật B — dù B quét trước hay sau lúc hoàn đều RENEWAL (trước: quét trước ⇒ RENEWAL, quét sau ⇒ NEW)", async () => {
    // (a) B quét khi A còn thực thu, rồi A hoàn sạch: B GIỮ RENEWAL (kể cả đợt thu sau).
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

    // (b) CÙNG dữ liệu, nhưng B chỉ được quét SAU khi A đã hoàn sạch: hoàn xảy ra SAU τ(B) ⇒ không viết lại lịch sử ⇒ vẫn RENEWAL (v1: NEW).
    const a2 = await capDon();
    const pA2 = await tienVe(a2.k, a2.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const pB2 = await tienVe(a2.k, a2.beB, { soTien: 4_000_000, ngay: D("2026-10-12") });
    await hoanTien(a2.k, pA2, { soTien: 10_000_000, ngay: D("2026-10-20") });
    const pB2b = await tienVe(a2.k, a2.beB, { soTien: 6_000_000, ngay: D("2026-10-25") });
    await quetCacKhoan(db, a2.bc, [pB2, pB2b]);
    expect((await quanSat(pB2)).loai).toEqual(["RENEWAL"]);
    expect((await quanSat(pB2b)).loai).toEqual(["RENEWAL"]);
    expect(await quanSat(pB2)).toEqual(await quanSat(pB1));
    expect(await quanSat(pB2b)).toEqual(await quanSat(pB1b));
  });
});
