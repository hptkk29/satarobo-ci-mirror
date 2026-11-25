// @vitest-environment node
/**
 * [PLD-*] — PHÂN LOẠI NEW/RENEWAL TẤT ĐỊNH (luật v2, 2026-10-16). Đầu-cuối trên Postgres THẬT: engine thật, dòng tiền dựng bằng hàm ghi thật
 * (`recordPayment` / `confirmPayment` / `refundPayment`), quét bằng `quetKhoan` / `quetCacKhoan` / `quetKy` (đúng tập Q1…Q6 của cron).
 *
 * BẤT BIẾN CẦN GIỮ: cùng DỮ LIỆU cuối cùng ⇒ cùng phân loại và cùng số tiền, bất kể cron quét lúc nào, khoản nào quét trước, quét lẻ hay một mẻ,
 * quét lại bao nhiêu lần. Khoá thứ tự lần mua là (Order.createdAt, Order.id); τ = ngày thu đầu của ĐƠN; huỷ/hoàn có mốc ≤ τ thì tiền lệ bị loại,
 * sau τ thì không viết lại lịch sử; tiền lệ chưa thu & chưa huỷ ⇒ khoản được GIỮ (hold) và tự nhả ở nhịp cron kế.
 *
 * Số tiền: NEW 9% · RENEWAL 2% trên cùng khoản 10.000.000đ (VAT 0 ở kỳ 10/2026) ⇒ 900.000đ vs 200.000đ.
 *
 * Mỗi ca tự dựng kịch bản riêng (luật 18); ngày TUYỆT ĐỐI (luật 19); `NOW` truyền vào bối cảnh quét, không đọc đồng hồ.
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/phan-loai-tat-dinh.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { BO_LUAT_PHAN_LOAI } from "../../lib/hoa-hong/phan-loai-giao-dich";
import { phanLoaiDongDon } from "../../lib/hoa-hong/phan-loai-giao-dich-db";
import { quetCacKhoan, quetKy } from "../../lib/hoa-hong/quet-ky";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, type Be, type KichBan } from "./_kich-ban";
// Luật v4: fixture ghi khoản bằng đồng hồ thật ⇒ ghim `createdAt = paidDate` (dữ liệu trung thực) — xem phan-loai-gio-ghi.ts.
import { hoanTienTrungThuc as hoanTien, tienVeTrungThuc as tienVe } from "./phan-loai-gio-ghi";

if (!RUN_DB_TESTS) console.warn(`[PLD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const NEW_10TR = 900_000;
const RENEWAL_10TR = 200_000;
const RULES = [
  { vai: "SALE", rate: 0.09 },
  { vai: "SALE", rate: 0.02, loai: "RENEWAL" as const },
];
const cuaToi: KichBan[] = [];

async function kb() {
  const k = await dungKichBan("pld", { rules: RULES });
  cuaToi.push(k);
  return k;
}

/** LẦN MUA THỨ HAI của CÙNG học viên (đơn + ghi danh + MỘT dòng học phí). `ngayDon` = Order.createdAt. */
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

/** Huỷ đơn: trạng thái cuối + (nếu có `luc`) dòng lịch sử mang MỐC huỷ — đúng cách `updateOrderStatusAction` ghi. `luc = null` ⇒ không để lại mốc (dữ liệu cũ). */
async function huyDon(orderId: string, luc: Date | null): Promise<void> {
  await db.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
  if (luc) await db.orderStatusHistory.create({ data: { orderId, fromStatus: "CONFIRMED", toStatus: "CANCELLED", changedByName: "fixture PLD", createdAt: luc } });
}

type QuanSat = { loai: string[]; tien: number };
async function quanSat(paymentId: string): Promise<QuanSat> {
  const dong = await dongSoCuaKhoan(paymentId);
  return { loai: [...new Set(dong.map((d) => d.transactionTypeCode))], tien: dong.reduce((s, d) => s + d.amount, 0) };
}
const holdMo = (paymentId: string) => db.commissionHold.findMany({ where: { paymentId, status: "OPEN" }, select: { code: true, detail: true } });
const stCua = (orderItemId: string) => db.studentTransaction.findUniqueOrThrow({ where: { orderItemId } });

/** Một NHỊP cron thật của kỳ: tập quét Q1 + Q3 (hàng chờ mở) + … cho cơ sở của kịch bản. */
async function cron(c: Pick<Cap, "k" | "bc">, thang = "2026-10") {
  const tong = await quetKy(db, c.bc, { thang, centerId: c.k.centerId, soThangDoiSoat: 0 });
  expect(tong.loi, "cron không được lỗi khoản nào").toEqual([]);
  return tong;
}

/** Dữ liệu CHUNG: A tạo trước, B tạo sau; mỗi đơn 10tr một dòng học phí; cùng một học viên. */
async function capDon(p: { tenA?: string; tenB?: string; ngayA?: Date; ngayB?: Date } = {}) {
  const k = await kb();
  const bc = await boiCanh(k, NOW);
  const beA = await dungBe(k, p.tenA ?? "a", { ngayDon: p.ngayA ?? D("2026-09-01") });
  const beB = await lanMuaThem(k, beA, p.tenB ?? "b", p.ngayB ?? D("2026-09-10"));
  return { k, bc, beA, beB };
}
type Cap = Awaited<ReturnType<typeof capDon>>;

describe.skipIf(!RUN_DB_TESTS)("[PLD] phân loại NEW/RENEWAL TẤT ĐỊNH theo thứ tự mua", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[PLD-01] kịch bản 1 — A thu trước, B thu sau: A = NEW 900k, B = RENEWAL 200k, MỌI thứ tự quét (A→B, B→A, một mẻ)", async () => {
    const ketQua: Record<string, { A: QuanSat; B: QuanSat }> = {};
    for (const cach of ["A→B", "B→A", "mẻ"] as const) {
      const c = await capDon();
      const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
      const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-12") });
      if (cach === "A→B") for (const id of [pA, pB]) await quetKhoan(db, c.bc, id);
      if (cach === "B→A") for (const id of [pB, pA]) await quetKhoan(db, c.bc, id);
      if (cach === "mẻ") expect((await quetCacKhoan(db, c.bc, [pA, pB])).loi).toEqual([]);
      ketQua[cach] = { A: await quanSat(pA), B: await quanSat(pB) };
    }
    for (const [cach, r] of Object.entries(ketQua)) {
      expect(r.A, cach).toEqual({ loai: ["NEW"], tien: NEW_10TR });
      expect(r.B, cach).toEqual({ loai: ["RENEWAL"], tien: RENEWAL_10TR });
    }
  });

  it("[PLD-02] kịch bản 2 — B THU TRƯỚC khi A (tạo trước) có tiền: B bị GIỮ (không NEW tạm), A thu xong thì B tự nhả ở nhịp cron kế ⇒ RENEWAL 200k", async () => {
    const c = await capDon();
    const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const r1 = await quetKhoan(db, c.bc, pB);
    expect(r1.loai).toBe("GIU");
    // Không dòng sổ nào lọt ra, và người vận hành thấy NGAY đơn nào đang giữ.
    expect(await dongSoCuaKhoan(pB)).toEqual([]);
    const giu = await holdMo(pB);
    expect(giu).toHaveLength(1);
    expect(giu[0]).toMatchObject({ code: "MANUAL_REVIEW_REQUIRED", detail: { maLuat: "PREVIOUS_PURCHASE_UNRESOLVED" } });
    expect(JSON.stringify(giu[0]!.detail)).toContain(c.beA.orderId);
    const st1 = await stCua(c.beB.orderItemId);
    expect(st1).toMatchObject({ status: "MANUAL_REVIEW_REQUIRED", transactionTypeCode: null, reasonCode: "PREVIOUS_PURCHASE_UNRESOLVED", rulesetVersion: BO_LUAT_PHAN_LOAI });

    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, c.bc, pA);
    expect(await quanSat(pA)).toEqual({ loai: ["NEW"], tien: NEW_10TR });
    expect(await holdMo(pB), "chưa tới nhịp cron: B vẫn giữ").toHaveLength(1);

    await cron(c);
    expect(await quanSat(pB)).toEqual({ loai: ["RENEWAL"], tien: RENEWAL_10TR });
    expect(await holdMo(pB)).toEqual([]);
    const st2 = await stCua(c.beB.orderItemId);
    expect(st2).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "RENEWAL", reasonCode: "PRIOR_PURCHASE" });
    // Bằng chứng dựng lại được: τ của B là ngày thu đầu của ĐƠN B, không phải lúc quét.
    expect(st2.evidence).toMatchObject({ tau: D("2026-10-05").toISOString(), lanMuaTruocIds: [c.beA.orderItemId], lanMuaChuaChotIds: [] });
  });

  it("[PLD-03] kịch bản 3 — tiền lệ bị HUỶ: chưa từng thu ⇒ B = NEW dù huỷ lúc nào · đã thu nhưng huỷ ≤ τ ⇒ NEW · huỷ SAU τ ⇒ không viết lại lịch sử, B = RENEWAL", async () => {
    // (a) A chưa từng thu, huỷ SAU ngày B thu (08/10 > 05/10): vẫn là NEW, và không cần chờ gì vì A đã huỷ lúc B được quét.
    const a = await capDon();
    await huyDon(a.beA.orderId, D("2026-10-08"));
    const pBa = await tienVe(a.k, a.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, a.bc, pBa);
    expect(await quanSat(pBa)).toEqual({ loai: ["NEW"], tien: NEW_10TR });
    expect((await stCua(a.beB.orderItemId)).evidence).toMatchObject({ lanMuaLoaiBo: [{ orderItemId: a.beA.orderItemId, ma: "HUY_CHUA_TUNG_THU" }] });

    // (b) A đã thu 03/10, huỷ 04/10 (≤ τ(B) = 05/10): tiền lệ bị loại ⇒ B = NEW.
    const b = await capDon();
    await tienVe(b.k, b.beA, { soTien: 10_000_000, ngay: D("2026-10-03") });
    await huyDon(b.beA.orderId, D("2026-10-04"));
    const pBb = await tienVe(b.k, b.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, b.bc, pBb);
    expect(await quanSat(pBb)).toEqual({ loai: ["NEW"], tien: NEW_10TR });
    expect((await stCua(b.beB.orderItemId)).evidence).toMatchObject({ lanMuaLoaiBo: [{ orderItemId: b.beA.orderItemId, ma: "HUY_TRUOC_MOC" }] });

    // (c) A đã thu 03/10, huỷ 20/10 (> τ(B) = 05/10). Hai cách quét — B quét NGAY (trước khi huỷ) và B quét SAU khi huỷ — phải ra CÙNG kết quả.
    const kip = await capDon();
    await tienVe(kip.k, kip.beA, { soTien: 10_000_000, ngay: D("2026-10-03") });
    const pKip = await tienVe(kip.k, kip.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, kip.bc, pKip);
    await huyDon(kip.beA.orderId, D("2026-10-20"));
    const muon = await capDon();
    await tienVe(muon.k, muon.beA, { soTien: 10_000_000, ngay: D("2026-10-03") });
    const pMuon = await tienVe(muon.k, muon.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await huyDon(muon.beA.orderId, D("2026-10-20"));
    await quetKhoan(db, muon.bc, pMuon);
    expect(await quanSat(pKip)).toEqual({ loai: ["RENEWAL"], tien: RENEWAL_10TR });
    expect(await quanSat(pMuon)).toEqual(await quanSat(pKip));
  });

  it("[PLD-04] kịch bản 4 — HOÀN tiền lệ: hoàn SAU τ không lật B (RENEWAL, quét kịp hay quét muộn như nhau); hoàn TRƯỚC τ thì tiền lệ bị loại ⇒ NEW", async () => {
    for (const [ngayHoan, mong] of [
      [D("2026-10-20"), "RENEWAL"], // > τ(B) = 12/10
      [D("2026-10-10"), "NEW"], // < τ(B)
      [D("2026-10-12"), "NEW"], // = τ(B): '≤ τ' ⇒ loại
    ] as const) {
      const kip = await capDon();
      const pA = await tienVe(kip.k, kip.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
      const muon = await capDon();
      const pAm = await tienVe(muon.k, muon.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });

      // QUÉT KỊP: B1 quét ngay khi thu (trước ngày hoàn nếu hoàn sau); QUÉT MUỘN: cả hai đợt B quét một mẻ sau khi mọi chuyện đã xảy ra.
      let b1k: string;
      if (ngayHoan.getTime() > D("2026-10-12").getTime()) {
        b1k = await tienVe(kip.k, kip.beB, { soTien: 4_000_000, ngay: D("2026-10-12") });
        await quetKhoan(db, kip.bc, b1k);
        await hoanTien(kip.k, pA, { soTien: 10_000_000, ngay: ngayHoan });
      } else {
        await hoanTien(kip.k, pA, { soTien: 10_000_000, ngay: ngayHoan });
        b1k = await tienVe(kip.k, kip.beB, { soTien: 4_000_000, ngay: D("2026-10-12") });
        await quetKhoan(db, kip.bc, b1k);
      }
      const b2k = await tienVe(kip.k, kip.beB, { soTien: 6_000_000, ngay: D("2026-10-25") });
      await quetKhoan(db, kip.bc, b2k);

      await hoanTien(muon.k, pAm, { soTien: 10_000_000, ngay: ngayHoan });
      const b1m = await tienVe(muon.k, muon.beB, { soTien: 4_000_000, ngay: D("2026-10-12") });
      const b2m = await tienVe(muon.k, muon.beB, { soTien: 6_000_000, ngay: D("2026-10-25") });
      expect((await quetCacKhoan(db, muon.bc, [b1m, b2m])).loi).toEqual([]);

      for (const id of [b1k, b2k, b1m, b2m]) expect((await quanSat(id)).loai, `hoàn ${ngayHoan.toISOString()}`).toEqual([mong]);
      expect(await quanSat(b1k)).toEqual(await quanSat(b1m));
      expect(await quanSat(b2k)).toEqual(await quanSat(b2m));
    }
  });

  it("[PLD-05] kịch bản 5 — hai đơn CÙNG GIÂY: id ĐƠN quyết, đúng một bên RENEWAL, dù ai thu trước và dù id đơn xếp ngược id dòng", async () => {
    for (const [tenA, tenB] of [
      ["a", "b"],
      ["z", "a"], // A (dựng trước) có id đơn LỚN hơn: B là đơn đứng trước theo khoá K
    ] as const) {
      const c = await capDon({ tenA, tenB, ngayA: D("2026-09-05"), ngayB: D("2026-09-05") });
      // Đơn đứng trước theo khoá K = đơn có id nhỏ hơn.
      const [dau, sau] = [c.beA, c.beB].sort((p, q) => (p.orderId < q.orderId ? -1 : 1)) as [Be, Be];
      // Thu NGƯỢC thứ tự khoá: đơn đứng SAU thu trước.
      const pSau = await tienVe(c.k, sau, { soTien: 10_000_000, ngay: D("2026-10-05") });
      await quetKhoan(db, c.bc, pSau);
      expect((await holdMo(pSau)).map((h) => h.code), `${tenA}/${tenB}: đơn đứng sau thu trước ⇒ giữ`).toEqual(["MANUAL_REVIEW_REQUIRED"]);
      const pDau = await tienVe(c.k, dau, { soTien: 10_000_000, ngay: D("2026-10-12") });
      await quetKhoan(db, c.bc, pDau);
      await cron(c);
      expect(await quanSat(pDau), `${tenA}/${tenB}`).toEqual({ loai: ["NEW"], tien: NEW_10TR });
      expect(await quanSat(pSau), `${tenA}/${tenB}`).toEqual({ loai: ["RENEWAL"], tien: RENEWAL_10TR });
    }
  });

  it("[PLD-06] kịch bản 6 — đơn NHIỀU DÒNG: các dòng cùng đơn cùng τ và không là tiền lệ của nhau (cùng NEW), và dòng thứ hai thu SAU vẫn không thành RENEWAL; thu chưa gắn dòng ở tiền lệ ⇒ giữ LICH_SU_MO_HO", async () => {
    // Đơn O (09/09) hai dòng học phí cho CÙNG học viên: L1 (be.orderItemId) và L2 (khoá khác).
    const k = await kb();
    const bc = await boiCanh(k, NOW);
    const be1 = await dungBe(k, "o", { ngayDon: D("2026-09-01") });
    const khoa2 = await db.course.create({ data: { id: `${k.ma}-o2-khoa`, name: `Sata 5 ${k.ma}`, slug: `${k.ma}-o2-sata5`, totalSessions: 48 } });
    const lop2 = await db.class.create({ data: { id: `${k.ma}-o2-lop`, name: `Lớp o2 ${k.ma}`, courseId: khoa2.id, centerId: k.centerId } });
    const gd2 = await db.enrollment.create({
      data: { id: `${k.ma}-o2-gd`, studentId: be1.studentId, classId: lop2.id, courseId: khoa2.id, centerId: k.centerId, status: "ACTIVE", createdAt: D("2026-09-01") },
    });
    const oi2 = await db.orderItem.create({
      data: { id: `${k.ma}-o2-oi`, orderId: be1.orderId, type: "COURSE_ENROLLMENT", itemName: "Học phí dòng 2", quantity: 1, unitPrice: 10_000_000, totalPrice: 10_000_000, studentId: be1.studentId, enrollmentId: gd2.id, createdAt: D("2026-09-01") },
    });
    const be2: Be = { studentId: be1.studentId, enrollmentId: gd2.id, orderId: be1.orderId, orderItemId: oi2.id };
    // Dòng 2 thu TRƯỚC (05/10), dòng 1 thu SAU (12/10): τ(đơn O) = 05/10 cho CẢ hai dòng.
    const p2 = await tienVe(k, be2, { soTien: 3_000_000, ngay: D("2026-10-05") });
    const p1 = await tienVe(k, be1, { soTien: 2_000_000, ngay: D("2026-10-12") });
    expect((await quetCacKhoan(db, bc, [p2, p1])).loi).toEqual([]);
    expect((await quanSat(p1)).loai).toEqual(["NEW"]);
    expect((await quanSat(p2)).loai).toEqual(["NEW"]);
    const st1 = await stCua(be1.orderItemId);
    const st2 = await stCua(be2.orderItemId);
    expect(st1.evidence).toMatchObject({ tau: D("2026-10-05").toISOString(), lanMuaTruocIds: [] });
    expect(st2.evidence).toMatchObject({ tau: D("2026-10-05").toISOString(), lanMuaTruocIds: [] });

    // Đơn B của CÙNG học viên, tạo sau, thu 20/10 ⇒ RENEWAL (đơn O là tiền lệ — cả hai dòng đều đã thu).
    const beB = await lanMuaThem(k, be1, "b", D("2026-09-10"));
    const pB = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-20") });
    await quetKhoan(db, bc, pB);
    expect(await quanSat(pB)).toEqual({ loai: ["RENEWAL"], tien: RENEWAL_10TR });

    // Tiền lệ có khoản thu CHƯA GẮN DÒNG trong đơn nhiều dòng ⇒ không biết tiền thuộc dòng nào ⇒ giữ (không đoán).
    const k2 = await kb();
    const bc2 = await boiCanh(k2, NOW);
    const x1 = await dungBe(k2, "o", { ngayDon: D("2026-09-01") });
    const khoaX = await db.course.create({ data: { id: `${k2.ma}-o2-khoa`, name: `Sata 5 ${k2.ma}`, slug: `${k2.ma}-o2-sata5`, totalSessions: 48 } });
    const lopX = await db.class.create({ data: { id: `${k2.ma}-o2-lop`, name: `Lớp o2 ${k2.ma}`, courseId: khoaX.id, centerId: k2.centerId } });
    const gdX = await db.enrollment.create({
      data: { id: `${k2.ma}-o2-gd`, studentId: x1.studentId, classId: lopX.id, courseId: khoaX.id, centerId: k2.centerId, status: "ACTIVE", createdAt: D("2026-09-01") },
    });
    await db.orderItem.create({
      data: { id: `${k2.ma}-o2-oi`, orderId: x1.orderId, type: "COURSE_ENROLLMENT", itemName: "Học phí dòng 2", quantity: 1, unitPrice: 10_000_000, totalPrice: 10_000_000, studentId: x1.studentId, enrollmentId: gdX.id, createdAt: D("2026-09-01") },
    });
    await db.payment.create({
      data: { id: `${k2.ma}-khong-gan`, orderId: x1.orderId, orderItemId: null, enrollmentId: null, amount: 10_000_000, method: "BANK_TRANSFER", accountantStatus: "CONFIRMED", paidDate: D("2026-10-03"), centerId: k2.centerId },
    });
    const xB = await lanMuaThem(k2, x1, "b", D("2026-09-10"));
    const pXB = await tienVe(k2, xB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, bc2, pXB);
    expect((await holdMo(pXB)).map((h) => h.code)).toEqual(["MANUAL_REVIEW_REQUIRED"]);
    expect((await holdMo(pXB))[0]!.detail).toMatchObject({ maLuat: "LICH_SU_MO_HO" });
  });

  it("[PLD-07] HOÁN VỊ quét — quét lẻ (xuôi / đảo), một mẻ (xuôi / đảo), cả kỳ bằng cron thật, quét lặp ×3, B quét một mình rồi cùng A, và CHUỖI THỜI GIAN THẬT (B thu & quét khi A chưa có đồng nào): cùng dữ liệu cuối ⇒ cùng phân loại, cùng tiền, cùng bản ghi phân loại", async () => {
    type DauVan = { A: QuanSat; B: QuanSat; stA: string; stB: string; holdMoB: number; soDongSo: number };
    // B thu TRƯỚC (05/10), A (tạo trước) thu SAU (12/10) — kịch bản gốc của PLQ.
    const thuB = (c: Cap) => tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const thuA = (c: Cap) => tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
    const cacCach: Record<string, (c: Cap) => Promise<{ pA: string; pB: string }>> = {
      "chuỗi thời gian thật": async (c) => {
        const pB = await thuB(c);
        await quetKhoan(db, c.bc, pB); // A chưa có đồng nào ⇒ giữ
        const pA = await thuA(c);
        await quetKhoan(db, c.bc, pA);
        return { pA, pB };
      },
      "B quét trước, rồi A+B một mẻ": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        await quetKhoan(db, c.bc, pB); // quét B MỘT MÌNH trước
        await quetCacKhoan(db, c.bc, [pB, pA]); // rồi A+B cùng mẻ
        return { pA, pB };
      },
      "lẻ theo ngày thu": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        await quetKhoan(db, c.bc, pB);
        await quetKhoan(db, c.bc, pA);
        return { pA, pB };
      },
      "lẻ đảo": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        await quetKhoan(db, c.bc, pA);
        await quetKhoan(db, c.bc, pB);
        return { pA, pB };
      },
      "mẻ theo ngày thu": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        await quetCacKhoan(db, c.bc, [pB, pA]);
        return { pA, pB };
      },
      "mẻ đảo": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        await quetCacKhoan(db, c.bc, [pA, pB]);
        return { pA, pB };
      },
      "cron kỳ": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        await cron(c);
        return { pA, pB };
      },
      "lặp ×3": async (c) => {
        const [pB, pA] = [await thuB(c), await thuA(c)];
        for (let i = 0; i < 3; i += 1) {
          await quetKhoan(db, c.bc, pB);
          await quetKhoan(db, c.bc, pA);
        }
        return { pA, pB };
      },
    };
    const ketQua: Record<string, DauVan> = {};
    for (const [ten, quet] of Object.entries(cacCach)) {
      const c = await capDon();
      const { pA, pB } = await quet(c);
      await cron(c); // nhịp cron kế: nhả khoản đang giữ (nếu có)
      const stA = await stCua(c.beA.orderItemId);
      const stB = await stCua(c.beB.orderItemId);
      ketQua[ten] = {
        A: await quanSat(pA),
        B: await quanSat(pB),
        stA: `${stA.status}/${stA.transactionTypeCode}/${stA.reasonCode}`,
        stB: `${stB.status}/${stB.transactionTypeCode}/${stB.reasonCode}`,
        holdMoB: (await holdMo(pB)).length,
        soDongSo: (await dongSoCuaKhoan(pA)).length + (await dongSoCuaKhoan(pB)).length,
      };
    }
    const chuan: DauVan = {
      A: { loai: ["NEW"], tien: NEW_10TR },
      B: { loai: ["RENEWAL"], tien: RENEWAL_10TR },
      stA: "CLASSIFIED/NEW/FIRST_PURCHASE",
      stB: "CLASSIFIED/RENEWAL/PRIOR_PURCHASE",
      holdMoB: 0,
      soDongSo: 2,
    };
    expect(Object.keys(ketQua)).toHaveLength(8);
    for (const [ten, r] of Object.entries(ketQua)) expect(r, ten).toEqual(chuan);
  });

  it("[PLD-08] quét lại KHÔNG đổi gì: sau khi mọi thứ đã ổn, thêm hai nhịp cron nữa ⇒ cùng tập dòng sổ, cùng bản ghi phân loại (không bị phân loại lại im lặng)", async () => {
    const c = await capDon();
    const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await cron(c);
    await cron(c);
    const truoc = {
      so: (await db.commissionTransaction.findMany({ where: { paymentId: { in: [pA, pB] } }, select: { id: true }, orderBy: { id: "asc" } })).map((x) => x.id),
      stB: await stCua(c.beB.orderItemId),
      stA: await stCua(c.beA.orderItemId),
    };
    expect(truoc.so).toHaveLength(2);
    await cron(c);
    await cron(c);
    const sau = {
      so: (await db.commissionTransaction.findMany({ where: { paymentId: { in: [pA, pB] } }, select: { id: true }, orderBy: { id: "asc" } })).map((x) => x.id),
      stB: await stCua(c.beB.orderItemId),
      stA: await stCua(c.beA.orderItemId),
    };
    expect(sau.so).toEqual(truoc.so);
    expect(sau.stB.updatedAt.getTime()).toBe(truoc.stB.updatedAt.getTime());
    expect(sau.stA.updatedAt.getTime()).toBe(truoc.stA.updatedAt.getTime());
    expect(await holdMo(pB)).toEqual([]);
  });

  it("[PLD-09] backfill đơn lịch sử CÙNG NGÀY (chỉ có ngày, không có giờ): cùng Order.createdAt và cùng ngày thu ⇒ id đơn quyết, ra cùng kết quả dù hỏi dòng nào trước", async () => {
    const ngay = D("2026-01-05");
    const c = await capDon({ ngayA: ngay, ngayB: ngay });
    await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-02-01") });
    await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-02-01") });
    const [dau, sau] = [c.beA, c.beB].sort((p, q) => (p.orderId < q.orderId ? -1 : 1)) as [Be, Be];
    for (const thuTu of [[dau, sau], [sau, dau]] as const) {
      const kq = new Map<string, string>();
      for (const be of thuTu) {
        const r = await phanLoaiDongDon(db, { orderItemId: be.orderItemId });
        kq.set(be.orderItemId, `${r?.loai}/${r?.maLuat}`);
      }
      expect(kq.get(dau.orderItemId)).toBe("NEW/FIRST_PURCHASE");
      expect(kq.get(sau.orderItemId)).toBe("RENEWAL/PRIOR_PURCHASE");
    }
  });

  it("[PLD-10] mọi khoản thu của cùng đơn KẾ THỪA phân loại của đơn: A1,A2,A3 đều NEW; B1,B2 đều RENEWAL — kể cả khi B1 (thu trước A1) quét trước A", async () => {
    const c = await capDon();
    // B1 thu & quét ĐẦU TIÊN, khi A chưa có đồng nào ⇒ phải giữ chứ không được NEW tạm.
    const pB1 = await tienVe(c.k, c.beB, { soTien: 5_000_000, ngay: D("2026-10-03") });
    expect((await quetKhoan(db, c.bc, pB1)).loai).toBe("GIU");
    const pA1 = await tienVe(c.k, c.beA, { soTien: 4_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, c.bc, pA1);
    const pA2 = await tienVe(c.k, c.beA, { soTien: 3_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, c.bc, pA2);
    const pA3 = await tienVe(c.k, c.beA, { soTien: 3_000_000, ngay: D("2026-10-20") });
    await quetKhoan(db, c.bc, pA3);
    const pB2 = await tienVe(c.k, c.beB, { soTien: 5_000_000, ngay: D("2026-10-25") });
    await quetKhoan(db, c.bc, pB2); // A đã thu ⇒ B2 phân loại ngay, và B1 vẫn đang giữ
    await cron(c);
    expect(await Promise.all([pA1, pA2, pA3].map(quanSat))).toEqual([
      { loai: ["NEW"], tien: 360_000 },
      { loai: ["NEW"], tien: 270_000 },
      { loai: ["NEW"], tien: 270_000 },
    ]);
    expect(await Promise.all([pB1, pB2].map(quanSat))).toEqual([
      { loai: ["RENEWAL"], tien: 100_000 },
      { loai: ["RENEWAL"], tien: 100_000 },
    ]);
    expect(await db.studentTransaction.count({ where: { orderItemId: { in: [c.beA.orderItemId, c.beB.orderItemId] } } })).toBe(2);
    expect(await holdMo(pB1)).toEqual([]);
  });

  it("[PLD-11] hold TỰ NHẢ qua tập quét THẬT: (a) A thu ở THÁNG SAU — B chỉ có mặt nhờ Q3 (hàng chờ mở) ⇒ RENEWAL · (b) A bị huỷ ⇒ B = NEW", async () => {
    // (a) B thu 05/10 (hold); A thu 03/11; cron kỳ 11/2026: Q1 chỉ có A, B vào tập nhờ hàng chờ OPEN của cơ sở.
    const a = await capDon();
    const pB = await tienVe(a.k, a.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect((await quetKhoan(db, a.bc, pB)).loai).toBe("GIU");
    const pA = await tienVe(a.k, a.beA, { soTien: 10_000_000, ngay: D("2026-11-03") });
    const tong = await cron(a, "2026-11");
    expect(tong.soKhoan).toBe(2);
    expect((await quanSat(pA)).loai).toEqual(["NEW"]);
    const b = await quanSat(pB);
    expect(b.loai).toEqual(["RENEWAL"]);
    expect(b.tien).toBeGreaterThan(0);
    expect(await holdMo(pB)).toEqual([]);
    expect(await db.commissionHold.count({ where: { paymentId: pB, status: "RESOLVED" } })).toBe(1);

    // (b) B thu 05/10 (hold); A (chưa từng thu) bị huỷ 08/10; cron kỳ 10/2026 ⇒ B = NEW.
    const h = await capDon();
    const pBh = await tienVe(h.k, h.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect((await quetKhoan(db, h.bc, pBh)).loai).toBe("GIU");
    await huyDon(h.beA.orderId, D("2026-10-08"));
    await cron(h);
    expect(await quanSat(pBh)).toEqual({ loai: ["NEW"], tien: NEW_10TR });
    expect(await holdMo(pBh)).toEqual([]);
    expect((await stCua(h.beB.orderItemId)).evidence).toMatchObject({ lanMuaLoaiBo: [{ ma: "HUY_CHUA_TUNG_THU" }] });
  });

  it("[PLD-12] đường DỰ KIẾN (đơn chưa có đồng nào, τ = null) dùng CÙNG luật, không đồng hồ: A chưa thu ⇒ giữ · A đã thu ⇒ RENEWAL · A thu rồi hoàn / bị huỷ ⇒ NEW", async () => {
    const c = await capDon();
    const hoi = async () => phanLoaiDongDon(db, { orderItemId: c.beB.orderItemId });
    const giu = await hoi();
    expect(giu).toMatchObject({ loai: "MANUAL_REVIEW", maLuat: "PREVIOUS_PURCHASE_UNRESOLVED", bangChung: { tau: null } });
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect(await hoi()).toMatchObject({ loai: "RENEWAL", maLuat: "PRIOR_PURCHASE", bangChung: { tau: null } });
    await hoanTien(c.k, pA, { soTien: 10_000_000, ngay: D("2026-10-30") });
    expect(await hoi()).toMatchObject({ loai: "NEW", maLuat: "FIRST_PURCHASE" });

    const h = await capDon();
    await huyDon(h.beA.orderId, null); // huỷ KHÔNG mốc (dữ liệu cũ) ⇒ coi như huỷ từ đầu
    const kq = await phanLoaiDongDon(db, { orderItemId: h.beB.orderItemId });
    expect(kq).toMatchObject({ loai: "NEW", bangChung: { lanMuaLoaiBo: [{ orderItemId: h.beA.orderItemId, ma: "HUY_KHONG_MOC" }] } });
  });

  it("[PLD-13] sổ cũ KHÔNG bị sửa: dòng phân loại sinh từ bộ luật v1 (CLASSIFIED) được GIỮ nguyên khi quét lại dù luật v2 sẽ cho kết quả khác", async () => {
    const c = await capDon();
    const pA = await tienVe(c.k, c.beA, { soTien: 10_000_000, ngay: D("2026-10-03") });
    // v1 từng chụp B = NEW (lúc đó A chưa có đồng nào). Dựng đúng dòng đó.
    const orderB = await db.order.findUniqueOrThrow({ where: { id: c.beB.orderId }, select: { centerId: true, orgUnitId: true } });
    await db.studentTransaction.create({
      data: {
        orderItemId: c.beB.orderItemId,
        orderId: c.beB.orderId,
        studentId: c.beB.studentId,
        revenueComponent: "TUITION",
        status: "CLASSIFIED",
        transactionTypeCode: "NEW",
        reasonCode: "FIRST_PURCHASE",
        evidence: {},
        rulesetVersion: "2026-10-08.v1",
        centerId: orderB.centerId,
        orgUnitId: orderB.orgUnitId,
      },
    });
    const pB = await tienVe(c.k, c.beB, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, c.bc, pA);
    await quetKhoan(db, c.bc, pB);
    // v2 sẽ phân loại B là RENEWAL (A đã thu 03/10); dòng v1 vẫn là NEW với phiên bản cũ.
    expect(await quanSat(pB)).toEqual({ loai: ["NEW"], tien: NEW_10TR });
    expect(await stCua(c.beB.orderItemId)).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "NEW", rulesetVersion: "2026-10-08.v1" });
    expect(await phanLoaiDongDon(db, { orderItemId: c.beB.orderItemId })).toMatchObject({ loai: "RENEWAL" });
  });

  it("[PLD-14] bảo lưu xét tại τ của ĐƠN, không tại ngày thu của khoản vừa quét: đơn có đợt 1 trong thời gian bảo lưu ⇒ cả đơn PENDING_REGULATION (kể cả đợt 2 thu SAU khi bảo lưu kết thúc); đơn thu hoàn toàn sau bảo lưu ⇒ không dính", async () => {
    const dungBaoLuu = async (c: Cap) => {
      await db.studentReserve.create({
        data: { studentId: c.beA.studentId, enrollmentId: c.beA.enrollmentId, reason: "ốm", startedAt: D("2026-10-01"), endedAt: D("2026-10-10"), createdByName: "fixture PLD", isActive: false },
      });
    };
    // (a) đợt 1 thu 05/10 (đang bảo lưu), đợt 2 thu 12/10 (hết bảo lưu): τ = 05/10 ⇒ MỌI đợt thừa kế PENDING_REGULATION.
    const a = await capDon();
    await dungBaoLuu(a);
    const pA1 = await tienVe(a.k, a.beA, { soTien: 4_000_000, ngay: D("2026-10-05") });
    const pA2 = await tienVe(a.k, a.beA, { soTien: 6_000_000, ngay: D("2026-10-12") });
    // quét ĐẢO: đợt 2 trước — v1 lấy ngày thu của khoản vừa quét (12/10 ⇒ không dính) nên kết quả đổi theo thứ tự quét.
    for (const id of [pA2, pA1]) await quetKhoan(db, a.bc, id);
    for (const id of [pA1, pA2]) expect((await holdMo(id)).map((h) => h.code), id).toEqual(["PENDING_REGULATION"]);
    expect(await dongSoCuaKhoan(pA1)).toEqual([]);
    expect(await dongSoCuaKhoan(pA2)).toEqual([]);
    expect(await stCua(a.beA.orderItemId)).toMatchObject({ status: "PENDING_REGULATION", reasonCode: "BAO_LUU" });

    // (b) cùng bảo lưu nhưng đơn chỉ thu từ 12/10 (sau khi hết): không dính ⇒ NEW.
    const b = await capDon();
    await dungBaoLuu(b);
    const pB = await tienVe(b.k, b.beA, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, b.bc, pB);
    expect(await quanSat(pB)).toEqual({ loai: ["NEW"], tien: NEW_10TR });
  });
});
