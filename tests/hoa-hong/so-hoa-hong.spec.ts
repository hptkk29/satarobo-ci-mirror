// @vitest-environment node
/**
 * [NHH-COM-*] — ENGINE GHI SỔ HOA HỒNG trên Postgres THẬT (04 §10–§11, 05 AC-COM).
 *
 * Dòng tiền dựng bằng HÀM GHI THẬT (`recordPayment`/`confirmPayment`/`refundPayment`/`adjustPayment`/`rejectPayment`) — xem
 * `_kich-ban.ts`. Hàm quyết định đã có lưới thuần; thứ chỉ DB chứng minh: đầu vào được nạp ĐÚNG cột thật, ô tính chặn trả hai
 * lần, idempotency, trigger chặn dòng sai hình, hoàn tiền đảo đúng dòng gốc.
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18) với tiền tố riêng. Sổ BẤT BIẾN nên không dọn được bằng xoá —
 * `huyChinhSach` vô hiệu hoá chính sách của ca để không lọt vào bộ test khác. Ngày khoản thu TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Trần thời gian của bộ: mặc định 5s là trần của máy nhanh + DB mới tinh. DB test TÍCH khoản qua các lượt chạy (sổ bất biến không dọn được) và các ca quét toàn hệ
// chậm dần theo đó — đo 08/10: cùng mã, lượt 1 đỏ vì timeout, lượt 2 xanh. Nâng trần ở ĐÚNG bộ này, không phải toàn repo.
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { getSetting } from "../../lib/settings/service";
import {
  boiCanh,
  D,
  datMocCutover,
  dieuChinh,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganNguon,
  hoanTien,
  lamNhanVien,
  donKichBan,
  taoChinhSachFx,
  tienVe,
  tomTat,
  tuChoi,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-COM] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-COM] engine ghi sổ hoa hồng", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-COM-01] chỉ thực thu sinh hoa hồng: PENDING và REJECTED KHÔNG sinh dòng; CONFIRMED mới sinh (A1)", async () => {
    const k = await kb("com01");
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    const cho = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12"), xacNhan: false });
    expect(await quetKhoan(db, bc, cho)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_THUC_THU" });
    expect(await dongSoCuaKhoan(cho)).toEqual([]);

    const tuChoiId = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await tuChoi(k, tuChoiId);
    expect(await quetKhoan(db, bc, tuChoiId)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_THUC_THU" });

    // đối chứng dương: xác nhận khoản đầu ⇒ sinh dòng
    const ok = await tienVe(k, await dungBe(k, "c"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, bc, ok)).toMatchObject({ loai: "DA_GHI", soDong: 4 });
  });

  it("[NHH-COM-03] HĐ 12tr chia 3 đợt 4tr, Sale 3% ⇒ 120.000đ MỖI đợt ở kỳ 10, 11, 12; cả ba đợt NEW (một StudentTransaction)", async () => {
    const k = await kb("com03", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2026-12-20"));
    const be = await dungBe(k, "a", { tongTien: 12_000_000 });
    const dot = [await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-05") }), await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-11-05") }), await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-12-05") })];
    const kyGhi: string[] = [];
    for (const id of dot) {
      const r = await quetKhoan(db, bc, id);
      expect(r).toMatchObject({ loai: "DA_GHI", soDong: 1, tong: 120_000, lateArrival: false });
      if (r.loai === "DA_GHI") kyGhi.push(r.kyGhi);
    }
    expect(kyGhi).toEqual(["2026-10", "2026-11", "2026-12"]);
    const dong = (await Promise.all(dot.map(dongSoCuaKhoan))).flat();
    expect(dong.map((d) => [d.entryKind, d.amount, d.transactionTypeCode])).toEqual([["ORIGINAL", 120_000, "NEW"], ["ORIGINAL", 120_000, "NEW"], ["ORIGINAL", 120_000, "NEW"]]);
    expect(await db.studentTransaction.count({ where: { orderItemId: be.orderItemId } })).toBe(1);
  });

  // Cấy 08/10 (từng trường của dòng sổ bị bỏ/đổi): `leadId` · `studentTransactionId` · `resolverBasis` ⇒ 0 ca đỏ; `grossAmount` chỉ được canh bởi một ca VAT riêng. Sổ BẤT BIẾN nên
  // mọi thứ phải CHỤP đủ lúc ghi — đọc lại sau này không có chính sách "live" để hỏi (quyết định chủ dự án: "đọc lại KHÔNG phụ thuộc chính sách live").
  // Ca này khẳng định CẢ DÒNG; mỗi giá trị mong đợi lấy từ id/ngày của FIXTURE, không từ chính mã đang ghi.
  it("[NHH-COM-22] dòng ORIGINAL CHỤP ĐỦ: người hưởng · vai · học viên · khách · đơn · dòng đơn · phân loại · nguồn · chính sách (+version, văn bản, rule) · cơ sở tính · tỉ lệ · trần · kỳ · ngày", async () => {
    const k = await kb("com22", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const nhanVienId = await lamNhanVien(k.sale.id, "sale");
    await ganNguon(k, "PAID_ADS");
    const be = await dungBe(k, "a");
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), id);
    const dong = await dongSoCuaKhoan(id);
    expect(dong).toHaveLength(1);
    const d = dong[0]!;
    const st = await db.studentTransaction.findFirstOrThrow({ where: { orderItemId: be.orderItemId } });
    const nguon = await db.leadAttribution.findFirstOrThrow({ where: { leadId: k.lead!.id } });
    const vai = await db.beneficiaryRole.findUniqueOrThrow({ where: { code: "SALE" } });
    const rule = await db.commissionRule.findFirstOrThrow({ where: { versionId: k.chinhSach.versionId } });
    const khoan = await db.payment.findUniqueOrThrow({ where: { id } });
    expect(d).toMatchObject({
      entryKind: "ORIGINAL",
      lateArrival: false,
      naturalPeriod: "2026-10",
      paymentId: id,
      orderId: be.orderId,
      orderItemId: be.orderItemId,
      studentId: be.studentId,
      leadId: k.lead!.id,
      studentTransactionId: st.id,
      transactionTypeCode: "NEW",
      revenueComponent: "TUITION",
      splitMethod: "DONG",
      attributionId: nguon.id,
      sourceGroupId: nguon.groupId,
      sourceGroupCode: "PAID_ADS",
      beneficiaryRoleId: vai.id,
      roleCode: "SALE",
      beneficiaryKind: "USER",
      beneficiaryUserId: k.sale.id,
      beneficiaryAffiliateId: null,
      beneficiaryEmployeeId: nhanVienId,
      beneficiaryName: (await db.user.findUniqueOrThrow({ where: { id: k.sale.id } })).name,
      resolverType: vai.resolverType,
      resolverBasis: { canCu: "LEAD_CONVERTED_BY" },
      policyId: k.chinhSach.policyId,
      policyVersionId: k.chinhSach.versionId,
      versionNo: 1,
      ruleId: rule.id,
      documentNumber: `${k.ma}-vb1`,
      calcKind: "PERCENT",
      scopeOrderVersion: "v1",
      grossAmount: 10_000_000,
      netBase: 10_000_000,
      fixedAmount: null,
      amount: 300_000,
      centerId: k.centerId,
      orgUnitId: k.ouId,
    });
    expect([Number(d.vatRate), Number(d.rate), Number(d.capRate), Number(d.equivalentRate)]).toEqual([0, 0.03, Number(await getSetting("crm.commissionMaxTotalRate")), 0.03]);
    expect(d.rateDate.getTime()).toBe(D("2026-10-12").getTime());
    expect(d.assigneeDate!.getTime()).toBe(khoan.confirmedAt!.getTime());
    expect(d.reason).toContain(k.chinhSach.policyCode);
    expect(d.candidates).toMatchObject({ tienVai: 300_000, cachTach: "DONG", ngoaiCuaSo: false, nguonKhongRo: false });
    const o = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: id } });
    expect(d.calcSlotId).toBe(o.id);
    expect(d.inputHash).toBe(o.firstInputHash); // dấu vân tay chụp trên dòng = dấu vân tay chụp trên ô lúc tạo
    expect(d.inputHash).toMatch(/^[0-9a-f]{64}$/);

    // Dòng REVERSAL CHÉP nguyên ảnh chụp của dòng gốc (người hưởng, chính sách, nguồn… của dòng gốc — không tra lại hôm nay), chỉ khác phần tiền / kỳ / tham chiếu.
    const hoan = await hoanTien(k, id, { soTien: 4_000_000, ngay: D("2026-11-10") });
    expect((await quetKhoan(db, await boiCanh(k, NOW), hoan)).loai).toBe("DA_DAO");
    const dao = (await dongSoCuaKhoan(hoan))[0]!;
    expect(dao).toMatchObject({
      entryKind: "REVERSAL",
      refEntryId: d.id,
      refEventType: "PAYMENT",
      refEventId: hoan,
      reasonCode: "HOAN_TIEN",
      inputHash: d.inputHash,
      paymentId: hoan,
      naturalPeriod: "2026-11",
      lateArrival: false,
      calcSlotId: d.calcSlotId,
      orderId: d.orderId,
      orderItemId: d.orderItemId,
      studentId: d.studentId,
      leadId: d.leadId,
      studentTransactionId: d.studentTransactionId,
      transactionTypeCode: d.transactionTypeCode,
      revenueComponent: d.revenueComponent,
      splitMethod: d.splitMethod,
      attributionId: d.attributionId,
      sourceGroupId: d.sourceGroupId,
      sourceGroupCode: d.sourceGroupCode,
      beneficiaryRoleId: d.beneficiaryRoleId,
      roleCode: d.roleCode,
      beneficiaryKind: d.beneficiaryKind,
      beneficiaryUserId: d.beneficiaryUserId,
      beneficiaryEmployeeId: d.beneficiaryEmployeeId,
      beneficiaryName: d.beneficiaryName,
      resolverType: d.resolverType,
      resolverBasis: d.resolverBasis,
      policyId: d.policyId,
      policyVersionId: d.policyVersionId,
      versionNo: d.versionNo,
      ruleId: d.ruleId,
      documentNumber: d.documentNumber,
      calcKind: d.calcKind,
      scopeOrderVersion: d.scopeOrderVersion,
      grossAmount: -4_000_000,
      netBase: -4_000_000,
      amount: -120_000,
      centerId: d.centerId,
      orgUnitId: d.orgUnitId,
    });
    expect([Number(dao.vatRate), Number(dao.rate), Number(dao.capRate), Number(dao.equivalentRate)]).toEqual([Number(d.vatRate), Number(d.rate), Number(d.capRate), Number(d.equivalentRate)]);
    expect(dao.rateDate.getTime()).toBe(d.rateDate.getTime());
    expect(dao.assigneeDate!.getTime()).toBe(d.assigneeDate!.getTime());
    expect(dao.reason).toContain(d.id);

    // Cùng dòng khi bảng VAT KHÁC 0 (cấy 08/10: `vatRate` luôn 0 / `netBase` = gross ⇒ 0 ca đỏ, vì mọi ca còn lại dùng bảng VAT RỖNG): 11.000.000 đã gồm VAT 10% ⇒ cơ sở 10.000.000.
    const bc0 = await boiCanh(k, NOW);
    const bcVat = { ...bc0, hoaHong: { ...bc0.hoaHong, vatTheoNgay: [{ tuNgay: "2026-01-01", tiLe: 0.1 }] } };
    const idV = await tienVe(k, await dungBe(k, "v", { tongTien: 11_000_000 }), { soTien: 11_000_000, ngay: D("2026-10-13") });
    await quetKhoan(db, bcVat, idV);
    const dv = (await dongSoCuaKhoan(idV))[0]!;
    expect(dv).toMatchObject({ grossAmount: 11_000_000, netBase: 10_000_000, amount: 300_000 });
    expect(Number(dv.vatRate)).toBe(0.1);
    // hoàn 2.200.000 (gồm VAT) ⇒ cơ sở đảo 2.000.000 theo vatRate CỦA DÒNG GỐC ⇒ −60.000; dòng đảo CHÉP vatRate của dòng gốc
    const hoanV = await hoanTien(k, idV, { soTien: 2_200_000, ngay: D("2026-11-11") });
    expect((await quetKhoan(db, bcVat, hoanV)).loai).toBe("DA_DAO");
    const daoV = (await dongSoCuaKhoan(hoanV))[0]!;
    expect(daoV).toMatchObject({ grossAmount: -2_200_000, netBase: -2_000_000, amount: -60_000 });
    expect(Number(daoV.vatRate)).toBe(0.1);
  });

  it("[NHH-COM-04] quét HAI lần = 0 dòng mới, 0 ô mới, 0 hàng chờ (idempotent)", async () => {
    const k = await kb("com04");
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI", soDong: 4, tong: 800_000 });
    const truoc = await dongSoCuaKhoan(id);
    const r2 = await quetKhoan(db, bc, id);
    expect(r2.loai).toBe("KHONG_DOI");
    expect(await dongSoCuaKhoan(id)).toHaveLength(truoc.length);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id } })).toBe(1);
    expect(await db.commissionHold.count({ where: { paymentId: id } })).toBe(0);
  });

  it("[NHH-COM-04b] HAI lượt quét SONG SONG cùng khoản không trùng: đúng 1 ô, 4 dòng", async () => {
    const k = await kb("com04b");
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const [a, b] = await Promise.all([quetKhoan(db, bc, id), quetKhoan(db, bc, id)]);
    expect([a.loai, b.loai].filter((x) => x === "DA_GHI")).toHaveLength(1);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id } })).toBe(1);
    expect(await db.commissionTransaction.count({ where: { paymentId: id } })).toBe(4);
  });

  it("[NHH-COM-04c] kích hoạt version MỚI rồi quét lại cùng khoản ⇒ 0 ORIGINAL mới (khoá không chứa policyVersionId)", async () => {
    const k = await kb("com04c");
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, id);
    // version 2 cùng policy: Sale 4% → 3%, hiệu lực từ 01/11 — SAU ngày thu 12/10. Version 1 vẫn là cái thắng ở rateDate (V2 của 04 §18).
    await taoChinhSachFx(k.ma, [{ vai: "SALE", rate: 0.03 }], 2, k.chinhSach.policyId, "2026-10-31T17:00:00.000Z");
    const bc2 = await boiCanh(k, NOW);
    const r = await quetKhoan(db, bc2, id);
    expect(r.loai).toBe("KHONG_DOI"); // version mới KHÔNG đẻ dòng thứ hai và KHÔNG làm lệch số cũ
    expect((await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "ORIGINAL")).toHaveLength(4);
  });

  it("[NHH-COM-06] đơn HAI bé, khoản gốc gắn bé A, hoàn 4tr bằng refundPayment THẬT (không mang orderItemId) ⇒ CHỈ ô bé A giảm −120.000đ; bé B không đổi", async () => {
    const k = await kb("com06", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const a = await dungBe(k, "a");
    const b = await dungBe(k, "b", { donSan: a.orderId });
    const gocA = await tienVe(k, a, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const gocB = await tienVe(k, b, { soTien: 10_000_000, ngay: D("2026-10-11") });
    expect(await quetKhoan(db, bc, gocA)).toMatchObject({ loai: "DA_GHI", tong: 300_000 });
    expect(await quetKhoan(db, bc, gocB)).toMatchObject({ loai: "DA_GHI", tong: 300_000 });

    const hoan = await hoanTien(k, gocA, { soTien: 4_000_000, ngay: D("2026-11-20") });
    const r = await quetKhoan(db, bc, hoan);
    expect(r).toMatchObject({ loai: "DA_DAO", soDong: 1, tong: -120_000, kyGhi: "2026-11", lateArrival: false });

    const dao = await dongSoCuaKhoan(hoan);
    expect(dao).toHaveLength(1);
    expect(dao[0]).toMatchObject({ entryKind: "REVERSAL", amount: -120_000, beneficiaryUserId: k.sale.id, reasonCode: "HOAN_TIEN", naturalPeriod: "2026-11" });
    // đảo THEO DÒNG GỐC: tham chiếu đúng dòng ORIGINAL của bé A, cùng ô; netBase âm = cơ sở đã hoàn
    const goc = (await dongSoCuaKhoan(gocA))[0]!;
    expect(dao[0]).toMatchObject({ refEntryId: goc.id, calcSlotId: goc.calcSlotId, netBase: -4_000_000, vatRate: expect.anything() });
    // bé B không đổi
    expect(await db.commissionTransaction.count({ where: { paymentId: gocB, entryKind: "REVERSAL" } })).toBe(0);
    expect(await dongSoCuaKhoan(gocB)).toHaveLength(1);

    // quét lại hoàn: đã xử lý ⇒ không đảo lần hai
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "BO_QUA", lyDo: "DA_XU_LY" });
    expect(await db.commissionTransaction.count({ where: { paymentId: hoan } })).toBe(1);

    // hoàn tiếp phần còn lại 6tr ⇒ đảo SẠCH −180.000, tổng ô về đúng 0
    const hoan2 = await hoanTien(k, gocA, { soTien: 6_000_000, ngay: D("2026-11-21") });
    expect(await quetKhoan(db, bc, hoan2)).toMatchObject({ loai: "DA_DAO", tong: -180_000 });
    const rong = await db.commissionTransaction.aggregate({ where: { calcSlotId: goc.calcSlotId }, _sum: { amount: true } });
    expect(rong._sum.amount).toBe(0);
  });

  // Số LẺ có chủ đích (luật 9 — "dữ liệu tròn trịa trong test là dữ liệu không kiểm được gì"): mọi ca hoàn khác dùng 10tr/4tr/6tr nên đảo và kỳ vọng luôn trùng.
  // Đo 08/10 trên DB thật: gốc 1.326.956 × 1% = 13.270; hoàn 753.016 ⇒ dòng đảo −7.530 (tỉ lệ tiền của dòng) ⇒ ròng 5.740; kỳ vọng trên cơ sở còn lại 573.940 × 1% = 5.739,4 ⇒ 5.739.
  // Không có dung sai thì lượt quét kế tiếp đẻ INPUT_DRIFT CỨNG chênh −1đ cho khoản gốc và chặn khoá kỳ — dù đầu vào không đổi.
  it("[NHH-COM-24] hoàn MỘT PHẦN số lẻ rồi quét lại khoản gốc ⇒ KHÔNG đẻ INPUT_DRIFT giả (chênh làm tròn 1đ); hoàn lần hai và đối chứng đầu vào đổi THẬT vẫn nổ", async () => {
    const k = await kb("com24", { rules: [{ vai: "SALE", rate: 0.01 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const be = await dungBe(k, "a", { tongTien: 2_000_000 });
    const goc = await tienVe(k, be, { soTien: 1_326_956, ngay: D("2026-10-10") });
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "DA_GHI", tong: 13_270 });

    const hoan1 = await hoanTien(k, goc, { soTien: 753_016, ngay: D("2026-11-20") });
    expect(await quetKhoan(db, bc, hoan1)).toMatchObject({ loai: "DA_DAO", tong: -7_530 });
    let hoan2: string | null = null;
    const ron = async () => (await db.commissionTransaction.aggregate({ where: { paymentId: { in: [goc, hoan1, ...(hoan2 ? [hoan2] : [])] } }, _sum: { amount: true } }))._sum.amount;
    expect(await ron()).toBe(5_740); // ≠ kỳ vọng 5.739 — đúng 1đ lệch làm tròn

    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "KHONG_DOI" });
    expect(await db.commissionHold.count({ where: { paymentId: goc, code: "INPUT_DRIFT" } })).toBe(0);
    expect(await db.commissionHold.count({ where: { paymentId: goc, status: "OPEN", severity: "HARD" } })).toBe(0);
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "KHONG_DOI" }); // lượt hai: hash đã ghi nhận, không đổi gì

    // hoàn lần hai (số lẻ nữa) rồi quét lại — vẫn không drift giả
    hoan2 = await hoanTien(k, goc, { soTien: 111_111, ngay: D("2026-11-21") });
    expect(await quetKhoan(db, bc, hoan2)).toMatchObject({ loai: "DA_DAO" });
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "KHONG_DOI" });
    expect(await db.commissionHold.count({ where: { paymentId: goc, code: "INPUT_DRIFT" } })).toBe(0);

    // đối chứng dương: đổi tỉ lệ THẬT (1% ⇒ 2%) thì phải nổ INPUT_DRIFT — dung sai không được nuốt thay đổi thật
    await taoChinhSachFx(k.ma, [{ vai: "SALE", rate: 0.02 }], 2, k.chinhSach.policyId, "2026-09-30T17:00:00.000Z"); // hiệu lực từ 01/10 VN ⇒ áp cho khoản thu 10/10
    const bc2 = await boiCanh(k, D("2026-11-25"));
    expect(await quetKhoan(db, bc2, goc)).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    expect(await db.commissionHold.count({ where: { paymentId: goc, code: "INPUT_DRIFT", severity: "HARD", status: "OPEN" } })).toBe(1);
  });

  it("[NHH-COM-20] V3: 2 QC mỗi người 50.000, hoàn 4tr ⇒ MỖI người −20.000đ, Σ vai Marketing −40.000đ", async () => {
    const k = await kb("com20", { qc: false, rules: [{ vai: "MARKETING", rate: 0.01 }] });
    // hai người phụ trách QC cùng lúc (chồng lấn hợp lệ — schema:967)
    for (const u of [k.qc, k.qc2]) {
      await db.centerCommissionAssignee.create({ data: { centerId: k.centerId, role: "QC", userId: u.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: k.ma } });
    }
    const bc = await boiCanh(k, D("2026-11-25"));
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-10") });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI", soDong: 2, tong: 100_000 });
    const hoan = await hoanTien(k, id, { soTien: 4_000_000, ngay: D("2026-11-20") });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO", soDong: 2, tong: -40_000 });
    expect(tomTat(await dongSoCuaKhoan(hoan))).toEqual({ [`MARKETING:${k.qc.id}`]: -20_000, [`MARKETING:${k.qc2.id}`]: -20_000 });
  });

  it("[NHH-COM-08] adjustPayment GIẢM ⇒ đảo đúng ô gốc (delta âm có gốc, không mang orderItemId)", async () => {
    const k = await kb("com08", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const be = await dungBe(k, "a");
    const goc = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    await quetKhoan(db, bc, goc);
    const adj = await dieuChinh(k, goc, 6_000_000); // số đúng cuối cùng 6tr ⇒ delta −4tr
    // adjustPayment giữ paidDate GỐC ⇒ kỳ của bút toán điều chỉnh là kỳ 10 (đã có dòng) — đảo vào kỳ OPEN
    expect(await quetKhoan(db, bc, adj)).toMatchObject({ loai: "DA_DAO", tong: -120_000 });
    expect(tomTat(await dongSoCuaKhoan(adj))).toEqual({ [`SALE:${k.sale.id}`]: -120_000 });
  });
});
