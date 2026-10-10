// @vitest-environment node
/**
 * [NHH-H-CLS-*] — PHÂN LOẠI THEO LẦN MUA, đầu-cuối trên Postgres THẬT (04 §5.2, quyết định chủ dự án Stage 3 (a)).
 *
 *   «1 đơn NEW + 3 phiếu thu ⇒ cả 3 dòng sổ transactionType NEW; lần mua / học phần kế tiếp ⇒ RENEWAL».
 *
 * Lưới thuần (`phan-loai-giao-dich.test.ts`) và ca nạp (`phan-loai-giao-dich.spec.ts`) đã khoá hàm quyết định. Thứ MỘT mình ca này chứng minh được là cả
 * đường ống: dòng tiền dựng bằng hàm ghi THẬT (`recordPayment` → `confirmPayment`), `quetKhoan` thật, và đọc kết quả THẲNG từ bảng sổ — tức "phân loại
 * không phụ thuộc thứ tự / số phiếu thu" được kiểm ở chỗ mà tiền thật đi qua, không ở hàm thuần.
 *
 * Chạy: `pnpm test:hoa-hong-db`. Mỗi ca tự dựng kịch bản (luật 18); ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, tienVe, type Be, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-H-CLS] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

/**
 * LẦN MUA THỨ HAI của CÙNG học viên: đơn mới (+ ghi danh ở khoá mới) với MỘT dòng học phí — hình dạng "học phần kế tiếp". `ngayDon` là ngày của ĐƠN
 * (mốc "tạo trước/sau" của bộ phân loại — không phải ngày thu).
 */
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

describe.skipIf(!RUN_DB_TESTS)("[NHH-H-CLS] phân loại theo LẦN MUA, không theo đợt thu", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-H-CLS-01] MỘT đơn (một OrderItem) + BA phiếu thu ⇒ 3 khoản đều sinh dòng ORIGINAL loại NEW; MỘT StudentTransaction duy nhất; không có dòng RENEWAL", async () => {
    const k = await kb("cls01", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a", { tongTien: 12_000_000 });
    const phieu = [
      await tienVe(k, be, { soTien: 3_000_000, ngay: D("2026-10-05") }),
      await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-12") }),
      await tienVe(k, be, { soTien: 5_000_000, ngay: D("2026-10-19") }),
    ];
    for (const id of phieu) expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI", soDong: 2 });

    // Đọc THẲNG bảng sổ — không qua hàm của engine.
    const dong = (await Promise.all(phieu.map((id) => dongSoCuaKhoan(id)))).flat();
    expect(dong).toHaveLength(6); // 3 phiếu × (SALE + QLCS)
    expect(new Set(dong.map((d) => d.transactionTypeCode))).toEqual(new Set(["NEW"]));
    expect(new Set(dong.map((d) => d.entryKind))).toEqual(new Set(["ORIGINAL"]));
    // Cùng MỘT bản ghi phân loại cho cả ba đợt.
    const st = await db.studentTransaction.findMany({ where: { orderItemId: be.orderItemId } });
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "NEW", reasonCode: "FIRST_PURCHASE" });
    expect(new Set(dong.map((d) => d.studentTransactionId))).toEqual(new Set([st[0]!.id]));
    // Tiền đi theo đúng số của TỪNG phiếu (4% trên cơ sở tính của phiếu đó) — đối chứng rằng "NEW ×3" không phải ba dòng 0đ.
    for (const id of phieu) {
      const sale = (await dongSoCuaKhoan(id)).find((d) => d.roleCode === "SALE")!;
      expect(sale.amount).toBe(Math.round(sale.netBase * 0.04));
      expect(sale.amount).toBeGreaterThan(0);
    }
  });

  it("[NHH-H-CLS-02] lần mua KẾ TIẾP của cùng học viên ⇒ RENEWAL; không có chính sách RENEWAL ⇒ 0 dòng, 0 hàng chờ (D16) — lần mua đầu vẫn NEW", async () => {
    const k = await kb("cls02", { rules: [{ vai: "SALE", rate: 0.04 }] }); // chỉ rule NEW
    const bc = await boiCanh(k, NOW);
    const be1 = await dungBe(k, "a", { ngayDon: D("2026-09-01") });
    const be2 = await lanMuaThem(k, be1, "b", D("2026-10-02"));
    const p1 = await tienVe(k, be1, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const p2 = await tienVe(k, be2, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, bc, p1)).toMatchObject({ loai: "DA_GHI", soDong: 1 });
    const r2 = await quetKhoan(db, bc, p2);

    expect((await dongSoCuaKhoan(p1)).map((d) => d.transactionTypeCode)).toEqual(["NEW"]);
    // Phân loại của lần mua 2 là RENEWAL (đọc từ bảng phân loại), nhưng KHÔNG có rule RENEWAL ⇒ không sinh tiền.
    const st2 = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: be2.orderItemId } });
    expect(st2).toMatchObject({ status: "CLASSIFIED", transactionTypeCode: "RENEWAL", reasonCode: "PRIOR_PURCHASE" });
    expect(await dongSoCuaKhoan(p2)).toEqual([]);
    expect(await db.commissionHold.count({ where: { paymentId: p2, status: "OPEN" } })).toBe(0);
    expect(r2.loai).not.toBe("GIU"); // thiếu rule KHÔNG phải thiếu dữ liệu — không đẩy sang hàng chờ
  });

  it("[NHH-H-CLS-03] có rule RENEWAL ⇒ lần mua kế tiếp sinh dòng loại RENEWAL (cả hai đợt thu của nó), lần mua đầu vẫn NEW", async () => {
    const k = await kb("cls03", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "SALE", rate: 0.01, loai: "RENEWAL" }] });
    const bc = await boiCanh(k, NOW);
    const be1 = await dungBe(k, "a", { ngayDon: D("2026-09-01") });
    const be2 = await lanMuaThem(k, be1, "b", D("2026-10-02"));
    const p1 = await tienVe(k, be1, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const p2a = await tienVe(k, be2, { soTien: 4_000_000, ngay: D("2026-10-12") });
    const p2b = await tienVe(k, be2, { soTien: 6_000_000, ngay: D("2026-10-19") });
    for (const id of [p1, p2a, p2b]) await quetKhoan(db, bc, id);

    expect((await dongSoCuaKhoan(p1)).map((d) => d.transactionTypeCode)).toEqual(["NEW"]);
    const renewal = [...(await dongSoCuaKhoan(p2a)), ...(await dongSoCuaKhoan(p2b))];
    expect(renewal.map((d) => d.transactionTypeCode)).toEqual(["RENEWAL", "RENEWAL"]);
    for (const d of renewal) expect(d.amount).toBe(Math.round(d.netBase * 0.01));
    // MỘT bản ghi phân loại cho lần mua 2 dù có hai đợt thu.
    expect(await db.studentTransaction.count({ where: { orderItemId: be2.orderItemId } })).toBe(1);
  });

  it("[NHH-H-CLS-04] phân loại KHOÁ ở lượt quét đầu của lần mua: khoản thu SAU của cùng dòng không bị phân loại lại dù lịch sử mua đã đổi", async () => {
    const k = await kb("cls04", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "SALE", rate: 0.01, loai: "RENEWAL" }] });
    const bc = await boiCanh(k, NOW);
    // B tạo TRƯỚC A nhưng chưa ai nộp tiền cho B; A nộp đợt 1 ⇒ lúc đó học viên "chưa có lần mua thật nào trước A" ⇒ NEW.
    const beB = await dungBe(k, "b", { ngayDon: D("2026-09-05") });
    const beA = await lanMuaThem(k, beB, "a", D("2026-09-10"));
    const a1 = await tienVe(k, beA, { soTien: 5_000_000, ngay: D("2026-10-05") });
    expect(await quetKhoan(db, bc, a1)).toMatchObject({ loai: "DA_GHI" });
    expect((await dongSoCuaKhoan(a1))[0]!.transactionTypeCode).toBe("NEW");

    // Sau đó B được thu tiền thật (giờ B là "lần mua thật" tạo trước A) rồi A nộp đợt 2.
    const b1 = await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-08") });
    const a2 = await tienVe(k, beA, { soTien: 5_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, b1);
    await quetKhoan(db, bc, a2);

    // Đợt 2 của A GIỮ kết quả của đợt 1 (một lần mua = một phân loại). Nếu phân loại lại theo lịch sử hôm nay nó sẽ thành RENEWAL.
    expect((await dongSoCuaKhoan(a2)).map((d) => d.transactionTypeCode)).toEqual(["NEW"]);
    const st = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: beA.orderItemId } });
    expect(st).toMatchObject({ transactionTypeCode: "NEW", status: "CLASSIFIED" });
  });
});
