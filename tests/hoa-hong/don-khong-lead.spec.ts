// @vitest-environment node
/**
 * [NHH-H-NL-*] — ĐƠN KHÔNG CÓ LEAD, đầu-cuối trên Postgres THẬT (quyết định chủ dự án Stage 3 (b); 05 AC-TRX-06; 04 §7.1).
 *
 *   «Đơn không có lead ⇒ KHÔNG vào hàng chờ MANUAL_REVIEW của NGUỒN; vào hàng chờ `UNRESOLVED_BENEFICIARY` (hiển thị: "Chưa phân giải người hưởng").
 *    Không tạo lead giả, không gán UNKNOWN chỉ để chạy. UI Sổ phải thấy rõ.»
 *
 * Bốn mệnh đề, mỗi mệnh đề một ca có ĐỐI CHỨNG:
 *   01  quét một khoản của đơn không lead KHÔNG đẻ `Lead`, `LeadAttribution` hay `LeadTouchpoint`; `Order.leadId` vẫn NULL;
 *   02  hàng chờ NGUỒN (MANUAL_REVIEW của lib/nguon) không đổi một đơn vị — đơn không lead không bao giờ ở đó;
 *   03  hàm đọc hàng chờ SỔ (`docHangChoSo`) trả nhóm «Chưa phân giải người hưởng» RIÊNG, không chặn khoá, kèm lý do «không có lead»;
 *   04  quyền đọc + cách ly cơ sở của chính hàm đọc đó (mỗi ca deny có đối chứng dương).
 *
 * Chạy: `pnpm test:hoa-hong-db`. Mỗi ca tự dựng kịch bản (luật 18); ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import type { CommissionHoldCode } from "@prisma/client";

import { PermissionError } from "../../lib/auth/can";
import { db } from "../../lib/db";
import { docHangChoSo } from "../../lib/hoa-hong/hang-cho-so-doc";
import { loaiCuaMa } from "../../lib/hoa-hong/hang-cho-so-nhom";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { demHangChoNguon } from "../../lib/nguon/doc-hang-cho";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, ganNguon, ganVai, nguoiKyHo, nguoiKyQlcs, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-H-NL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

/** Dựng đơn KHÔNG lead (cả đơn lẫn học viên đều không mang lead) + một khoản thu đã xác nhận, rồi quét. */
async function donKhongLeadDaQuet(k: KichBan) {
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, "a", { coLead: false });
  // `dungBe` gắn `student.leadId = k.lead?.id` — với kịch bản coLead:false thì đã null; khẳng định để ca không đúng "vì lý do sai".
  expect((await db.student.findUniqueOrThrow({ where: { id: be.studentId }, select: { leadId: true } })).leadId).toBeNull();
  const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
  const kq = await quetKhoan(db, bc, id);
  return { be, id, kq };
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-H-NL] đơn không có lead ⇒ hàng chờ «Chưa phân giải người hưởng»", () => {
  let HO: Awaited<ReturnType<typeof nguoiKyHo>>;
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    HO = await nguoiKyHo();
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-H-NL-01] quét khoản của đơn KHÔNG lead: 0 Lead mới, 0 LeadAttribution mới, 0 touchpoint mới, Order.leadId vẫn NULL; SALE/SALE_ADMIN treo, vai khác vẫn ra tiền", async () => {
    const k = await kb("nl01", { coLead: false });
    const truoc = { lead: await db.lead.count(), attr: await db.leadAttribution.count(), tp: await db.leadTouchpoint.count() };
    const { be, id, kq } = await donKhongLeadDaQuet(k);

    expect(kq).toMatchObject({ loai: "DA_GHI", soDong: 2, treo: 2 }); // QLCS + QC có tiền; SALE + SALE_ADMIN treo
    expect({ lead: await db.lead.count(), attr: await db.leadAttribution.count(), tp: await db.leadTouchpoint.count() }).toEqual(truoc);
    expect((await db.order.findUniqueOrThrow({ where: { id: be.orderId }, select: { leadId: true } })).leadId).toBeNull();
    // Không "gán UNKNOWN cho chạy": không có dòng sổ nào mang nhóm nguồn UNKNOWN hay leadId giả.
    const dong = await db.commissionTransaction.findMany({ where: { paymentId: id } });
    expect(dong.map((d) => d.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING"]);
    expect(dong.every((d) => d.leadId === null)).toBe(true);
    expect(dong.every((d) => d.sourceGroupCode !== "UNKNOWN" || d.leadId === null)).toBe(true);
    // Phân loại vẫn đi theo HỌC VIÊN, không cần lead (04 §4.4): lần mua đầu ⇒ NEW.
    expect(dong.every((d) => d.transactionTypeCode === "NEW")).toBe(true);
    // Đối chứng dương: hàng chờ KHÔNG phải kiểu xem-tay-phân-loại.
    const holds = await db.commissionHold.findMany({ where: { paymentId: id } });
    expect(holds.map((h) => h.code)).toEqual(["UNRESOLVED_BENEFICIARY", "UNRESOLVED_BENEFICIARY"]);
    expect(holds.some((h) => h.code === "MANUAL_REVIEW_REQUIRED")).toBe(false);
  });

  it("[NHH-H-NL-02] hàng chờ NGUỒN không đổi: đơn không lead không bao giờ nằm trong MANUAL_REVIEW của lib/nguon (đối chứng: lead UNKNOWN thật thì CÓ nằm)", async () => {
    const k = await kb("nl02", { coLead: false });
    const truoc = await demHangChoNguon(HO.quyen, null);
    await donKhongLeadDaQuet(k);
    expect(await demHangChoNguon(HO.quyen, null)).toBe(truoc);

    // Đối chứng dương: một lead mang nhóm UNKNOWN THẬT làm số đếm tăng đúng 1 — vậy thước đo này CÓ nhạy với hàng chờ nguồn.
    const kLead = await kb("nl02b");
    await ganNguon(kLead, "UNKNOWN");
    expect(await demHangChoNguon(HO.quyen, null)).toBe(truoc + 1);
  });

  it("[NHH-H-NL-03] docHangChoSo: nhóm «Chưa phân giải người hưởng» riêng, KHÔNG chặn khoá kỳ, lý do «không có lead»; nhóm chặn không lẫn", async () => {
    const k = await kb("nl03", { coLead: false });
    const { id } = await donKhongLeadDaQuet(k);
    const kq = await docHangChoSo(db, HO.quyen, { centerId: k.centerId });

    const treo = kq.dong.filter((d) => d.nhom === "CHUA_PHAN_GIAI_NGUOI_HUONG");
    expect(treo.map((d) => d.vai).sort()).toEqual(["SALE", "SALE_ADMIN"]);
    for (const d of treo) {
      expect(d).toMatchObject({ ma: "UNRESOLVED_BENEFICIARY", tenMa: "Chưa phân giải người hưởng", chanKhoa: false, khongCoLead: true, lyDoMa: "KHONG_CO_LEAD", paymentId: id });
      expect(d.lyDo).toMatch(/không có lead/i);
      expect(d.tienVai).toBeGreaterThan(0);
    }
    expect(kq.dong.filter((d) => d.nhom === "CHAN_KHOA_KY")).toEqual([]);
    expect(kq.dem).toEqual({ CHAN_KHOA_KY: 0, CHUA_PHAN_GIAI_NGUOI_HUONG: 2, SO_DU_AM: 0 });
    // Lọc theo nhóm cho đúng tập con; nhóm khác ⇒ rỗng nhưng số đếm vẫn đủ (pill không phụ thuộc bộ lọc).
    const chiChan = await docHangChoSo(db, HO.quyen, { centerId: k.centerId, nhom: "CHAN_KHOA_KY" });
    expect(chiChan.dong).toEqual([]);
    expect(chiChan.dem.CHUA_PHAN_GIAI_NGUOI_HUONG).toBe(2);
  });

  it("[NHH-H-NL-03b] đối chứng dương: đơn CÓ lead đủ người ⇒ 0 hàng chờ «chưa phân giải» cho lý do KHÔNG_CÓ_LEAD; hàng chờ CHẶN thì rơi vào nhóm chặn", async () => {
    const k = await kb("nl03b"); // có lead, có sale + admin
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, id);
    const kq = await docHangChoSo(db, HO.quyen, { centerId: k.centerId });
    expect(kq.dong.filter((d) => d.khongCoLead)).toEqual([]);

    // Một hàng chờ CHẶN thật (khoản gắn dòng chưa có học viên ⇒ CHO_HOC_VIEN) phải vào nhóm CHẶN KHOÁ, không vào nhóm chưa-phân-giải.
    const be2 = await dungBe(k, "b");
    const id2 = await tienVe(k, be2, { soTien: 5_000_000, ngay: D("2026-10-14") });
    await db.orderItem.update({ where: { id: be2.orderItemId }, data: { studentId: null, enrollmentId: null } });
    await db.payment.update({ where: { id: id2 }, data: { enrollmentId: null } });
    await quetKhoan(db, bc, id2);
    const sau = await docHangChoSo(db, HO.quyen, { centerId: k.centerId });
    expect(sau.dong.filter((d) => d.nhom === "CHAN_KHOA_KY").map((d) => [d.ma, d.chanKhoa])).toEqual([["CHO_HOC_VIEN", true]]);
    expect(sau.dem.CHAN_KHOA_KY).toBe(1);
  });

  it("[NHH-H-NL-04] quyền + cách ly: HO thấy; QLCS của CHÍNH cơ sở thấy; QLCS cơ sở KHÁC không thấy dòng nào; vai chỉ view-self bị từ chối (đối chứng dương: HO và QLCS đúng cơ sở)", async () => {
    const k = await kb("nl04", { coLead: false });
    const kKhac = await kb("nl04x", { coLead: false });
    await donKhongLeadDaQuet(k);

    // Dương: HO
    expect((await docHangChoSo(db, HO.quyen, { centerId: k.centerId })).dem.CHUA_PHAN_GIAI_NGUOI_HUONG).toBe(2);
    // Dương: QLCS đúng cơ sở
    const qlcs = await nguoiKyQlcs(k);
    expect((await docHangChoSo(db, qlcs.quyen, {})).dem.CHUA_PHAN_GIAI_NGUOI_HUONG).toBe(2);
    // Âm: QLCS của cơ sở KHÁC không thấy hàng chờ của cơ sở này (kể cả khi tự điền centerId của cơ sở kia).
    const qlcsKhac = await nguoiKyQlcs(kKhac);
    const thayCuaKhac = await docHangChoSo(db, qlcsKhac.quyen, { centerId: k.centerId });
    expect(thayCuaKhac.dong).toEqual([]);
    expect(thayCuaKhac.dem).toEqual({ CHAN_KHOA_KY: 0, CHUA_PHAN_GIAI_NGUOI_HUONG: 0, SO_DU_AM: 0 });
    // Âm: Sale chỉ có view-self (không có view-center) ⇒ PermissionError, không phải danh sách rỗng.
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    const sale = await actorCua(k.sale.id);
    await expect(docHangChoSo(db, sale, {})).rejects.toBeInstanceOf(PermissionError);
  });

  it("[NHH-H-NL-06] LOẠI hiển thị: mỗi mã rơi đúng loại, đếm theo loại không phụ thuộc bộ lọc, lọc `loai` ∧ `nhom` là AND, canXuLy = Σ loại; đóng hàng chờ thì số giảm", async () => {
    const k = await kb("nl06", { coLead: false });
    const MA: Array<[CommissionHoldCode, "SOFT" | "HARD"]> = [
      ["UNRESOLVED_BENEFICIARY", "SOFT"], ["POLICY_OVERLAP", "HARD"], ["PENDING_REGULATION", "HARD"], ["CAP_EXCEEDED", "HARD"],
      ["CHUA_GAN_CON", "SOFT"], ["CHO_HOC_VIEN", "SOFT"], ["INPUT_DRIFT", "HARD"], ["PAYMENT_WITHDRAWN", "HARD"], ["NEGATIVE_BALANCE", "SOFT"],
    ];
    for (const [code, severity] of MA) {
      await db.commissionHold.create({
        data: { holdKey: `${k.ma}:loai:${code}`, code, severity, status: "OPEN", detail: {}, centerId: k.centerId, orgUnitId: null },
      });
    }
    const kq = await docHangChoSo(db, HO.quyen, { centerId: k.centerId });
    expect(kq.demTheoLoai).toEqual({
      CHUA_PHAN_GIAI_NGUOI_HUONG: 1, CHO_CHINH_SACH: 2, VUOT_TRAN: 1, THIEU_DU_LIEU_THANH_TOAN: 2, CHO_DIEU_CHINH: 2, SO_DU_AM: 1,
    });
    expect(kq.canXuLy).toBe(9);
    expect(kq.dong.length).toBe(9);
    for (const d of kq.dong) expect(d.loai, d.ma).toBe(loaiCuaMa(d.ma));

    const chiTran = await docHangChoSo(db, HO.quyen, { centerId: k.centerId, loai: "VUOT_TRAN" });
    expect(chiTran.dong.map((d) => d.ma)).toEqual(["CAP_EXCEEDED"]);
    expect(chiTran.tongSo).toBe(1);
    expect(chiTran.demTheoLoai).toEqual(kq.demTheoLoai); // pill không nhảy theo bộ lọc
    expect(chiTran.canXuLy).toBe(9);
    // AND: loại «chờ chính sách» ∧ nhóm «số dư âm» ⇒ giao rỗng (không phải hợp).
    const giaoRong = await docHangChoSo(db, HO.quyen, { centerId: k.centerId, loai: "CHO_CHINH_SACH", nhom: "SO_DU_AM" });
    expect(giaoRong.dong).toEqual([]);

    // Đóng một hàng chờ ⇒ số giảm đúng 1 ở đúng loại.
    await db.commissionHold.update({ where: { holdKey: `${k.ma}:loai:CAP_EXCEEDED` }, data: { status: "RESOLVED", resolvedAt: NOW } });
    const sau = await docHangChoSo(db, HO.quyen, { centerId: k.centerId });
    expect(sau.demTheoLoai.VUOT_TRAN).toBe(0);
    expect(sau.canXuLy).toBe(8);

    // Cách ly: QLCS cơ sở KHÁC không thấy (đối chứng dương ở trên: HO thấy 9).
    const qlcsKhac = await nguoiKyQlcs(await kb("nl06x", { coLead: false }));
    const khac = await docHangChoSo(db, qlcsKhac.quyen, { centerId: k.centerId });
    expect(khac.canXuLy).toBe(0);
    expect(khac.dong).toEqual([]);
  });

  it("[NHH-H-NL-05] hàng chờ chưa quy được cơ sở (centerId NULL) chỉ người tầm nhìn toàn hệ thấy; QLCS không thấy", async () => {
    const k = await kb("nl05", { coLead: false });
    const holdKey = `${k.ma}:khong-co-so`;
    await db.commissionHold.create({
      data: { holdKey, code: "UNRESOLVED_BENEFICIARY", severity: "SOFT", status: "OPEN", detail: { vai: "SALE", lyDo: "KHONG_QUY_VE_CO_SO", tienVai: 123_000 }, centerId: null, orgUnitId: null },
    });
    const qlcs = await nguoiKyQlcs(k);
    const hoThay = (await docHangChoSo(db, HO.quyen, {})).dong.find((d) => d.holdKey === holdKey);
    expect(hoThay).toMatchObject({ centerId: null, lyDoMa: "KHONG_QUY_VE_CO_SO", khongCoLead: false, tienVai: 123_000 });
    expect((await docHangChoSo(db, qlcs.quyen, {})).dong.find((d) => d.holdKey === holdKey)).toBeUndefined();
  });
});
