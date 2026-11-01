// @vitest-environment node
/**
 * [HNS-01..HNS-06] — NGƯỠNG HAI CẤP của hàng chờ = Σ|chênh| của TOÀN BỘ sự kiện giải quyết LOGIC (`CO_SO_NGUONG_HANG_CHO = SUM_ABS_LOGICAL_EVENT`), trên Postgres THẬT.
 *
 * ĐỊNH NGHĨA CHỐT (chủ dự án, 19/10/2026): logical event = TOÀN BỘ financial delta mà MỘT thao tác resolve HIỆN TẠI sẽ ghi cho cùng hold / payment context; ngưỡng = Σ|delta| trên ĐÚNG tập
 * điều chỉnh mà giao dịch hiện tại chuẩn bị ghi. KHÔNG cộng: `INPUT_CORRECTION` lịch sử đã ghi từ trước · hàng chờ khác chưa được resolve trong thao tác này · ledger lịch sử.
 * Mục tiêu: không chia nhỏ (theo dòng / người hưởng / ô) để né duyệt hai cấp, nhưng cũng KHÔNG đếm quá lịch sử cũ.
 *
 * Bản đầu (#776, 18/10) đọc rộng hơn: cộng cả hàng chờ MỞ khác của khoản và cả `INPUT_CORRECTION` lịch sử. Bộ này khoá cả hai vế: CỘNG ĐỦ tập sẽ ghi (HNS-02, 03) · KHÔNG cộng hàng chờ khác (HNS-04) ·
 * KHÔNG cộng lịch sử (HNS-05) · một hàng chờ không thể chia thành hai lượt ghi (HNS-06).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { ghiHangCho } from "../../lib/hoa-hong/hang-cho";
import { CO_SO_NGUONG_HANG_CHO } from "../../lib/hoa-hong/hang-cho-xu-ly";
import { deNghiXuLy, quyetXuLy, xemTruocXuLy } from "../../lib/hoa-hong/hang-cho-xu-ly-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import type { NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, donViHoiSo, dongSoCuaKhoan, dungBe, dungKichBan, ganVai, nguoiKyHo, tienVe, tuChoi, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[HNS] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
const LY_DO = "Đã đối chiếu với kế toán trưởng";
const BANG_CHUNG = "Biên bản đối chiếu 14/10, phiếu PT-2026-1234";

type Nguoi = NguoiThaoTacKy & { userId: string };
let A: Nguoi;
let B: Nguoi;
const cuaToi: KichBan[] = [];
const kb = async (ten: string, rules?: Parameters<typeof dungKichBan>[1]) => {
  const k = await dungKichBan(ten, rules);
  cuaToi.push(k);
  return k;
};
const datNguong = (n: number | null) =>
  n === null ? db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } }) : db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: n }, create: { key: KHOA_NGUONG, valueJson: n } });
const bay = () => new Date();
const dongDieuChinh = async (paymentId: string) => (await dongSoCuaKhoan(paymentId)).filter((d) => d.entryKind === "INPUT_CORRECTION");

/** Người chốt đổi sau khi thu ⇒ INPUT_DRIFT: Sale cũ −300.000 / Sale mới +300.000 (Σ|chênh| = 600.000, MỘT hàng chờ, HAI người hưởng). */
async function troiNguoiChot(ten: string) {
  const k = await kb(ten, { rules: [{ vai: "SALE", rate: 0.03 }] });
  const bc = await boiCanh(k, NOW);
  const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
  await quetKhoan(db, bc, id);
  const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
  await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
  await quetKhoan(db, bc, id);
  const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT", status: "OPEN" } });
  return { k, bc, id, moi, hold };
}

/** Khoản thu 10tr, NHIỀU vai hưởng (bộ chính sách seed v1) bị kế toán từ chối ⇒ MỘT hàng chờ PAYMENT_WITHDRAWN mà lượt giải quyết ghi NHIỀU dòng đảo (mỗi người hưởng một dòng). */
async function khoanBiRutNhieuVai(ten: string) {
  const k = await kb(ten);
  const bc = await boiCanh(k, NOW);
  const bi = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, bi);
  await tuChoi(k, bi);
  await quetKhoan(db, bc, bi);
  const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
  return { k, bc, bi, hold };
}

/** Một hàng chờ giải-được KHÁC của cùng khoản thu (mô phỏng ô thứ hai): chèn bằng đúng hàm ghi hàng chờ của engine, như `[T1-02]`. */
async function hangChoKhac(k: KichBan, paymentId: string, chenh: number) {
  const khoa = `HNS-KHAC:${k.ma}:${Math.random().toString(36).slice(2, 8)}`;
  await db.$transaction((tx) =>
    ghiHangCho(tx, { holdKey: khoa, code: "INPUT_DRIFT", paymentId, orderId: null, orderItemId: null, studentId: null, entryId: null, calcSlotId: null, blockingPeriodId: null, centerId: k.centerId, orgUnitId: k.ouId, detail: { chenh: [{ key: "SALE|USER|x", chenh }] } }, NOW),
  );
  return db.commissionHold.findUniqueOrThrow({ where: { holdKey: khoa } });
}

describe.skipIf(!RUN_DB_TESTS)("[HNS] ngưỡng hai cấp = Σ|chênh| của đúng tập điều chỉnh MỘT thao tác resolve sẽ ghi", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    A = await nguoiKyHo();
    const u = await seedUser({ email: `fx-hns-b-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Kế toán HO B", phone: null });
    await ganVai(u.id, await donViHoiSo(), "HO_ACCOUNTANT");
    B = { userId: u.id, ten: "Kế toán HO B", quyen: await actorCua(u.id) };
  }, 120_000);
  afterAll(async () => {
    await datNguong(null);
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[HNS-01] cơ sở tính ngưỡng được đặt tên: SUM_ABS_LOGICAL_EVENT (docs + audit cùng đọc hằng này)", () => {
    expect(CO_SO_NGUONG_HANG_CHO).toBe("SUM_ABS_LOGICAL_EVENT");
  });

  it("[HNS-02] CỘNG ĐỦ TẬP SẼ GHI (không theo dòng / người hưởng): một lượt giải quyết ghi N dòng đảo, MỖI dòng dưới ngưỡng nhưng Σ|dòng| đạt ngưỡng ⇒ HAI người; một người quyết thẳng bị chặn 0 dòng; hai người ghi ĐỦ N dòng, tổng đúng bằng số đã xem; đối chứng dương: ngưỡng cao hơn Σ thì một người", async () => {
    const { bc, bi, hold } = await khoanBiRutNhieuVai("hns02");
    await datNguong(null);
    const xem0 = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem0.giaiPhong.ok).toBe(true);
    if (!xem0.giaiPhong.ok) throw new Error("xem trước phải ok");
    const dong = xem0.giaiPhong.chenh;
    const tong = xem0.giaiPhong.tongTuyetDoi;
    expect(dong.length, "fixture phải cho NHIỀU dòng đảo trong MỘT lượt giải quyết").toBeGreaterThanOrEqual(2);
    expect(Math.max(...dong.map((d) => Math.abs(d.chenh))), "mỗi dòng riêng lẻ phải DƯỚI ngưỡng sắp đặt").toBeLessThan(tong);

    await datNguong(tong); // Σ|dòng| = ngưỡng ⇒ "đạt ngưỡng"; không dòng nào đạt
    const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem).toMatchObject({ cap: "HAI_CAP", lyDoCap: "TU_NGUONG", tien: tong });
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: tong, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
    expect(await dongDieuChinh(bi)).toHaveLength(0);

    await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() });
    const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Đồng ý, số khớp biên bản", bangChung: "Biên bản 14/10 đã kiểm", tienDaThay: tong, nguoi: B, now: bay() });
    expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "HAI_CAP", ketQua: { loai: "DA_AP_DUNG", soDong: dong.length } });
    const ghi = await dongDieuChinh(bi);
    expect(ghi).toHaveLength(dong.length);
    expect(ghi.reduce((t, d) => t + Math.abs(d.amount), 0), "Σ|dòng ghi| = đúng tập đã đem so ngưỡng").toBe(tong);
    const ap = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionHold", entityId: hold.id, action: "APPLY" } });
    expect(ap.newValues).toMatchObject({ batKy: { cap: "HAI_CAP", lyDoCap: "TU_NGUONG", tienDoDuoc: tong, coSoNguong: "SUM_ABS_LOGICAL_EVENT" } });

    // đối chứng dương: cùng kịch bản, ngưỡng cao hơn Σ ⇒ MỘT người
    const dc = await khoanBiRutNhieuVai("hns02dc");
    await datNguong(tong + 1);
    expect(await xemTruocXuLy(db, dc.bc, { holdId: dc.hold.id, nguoi: A, now: bay() })).toMatchObject({ cap: "MOT_CAP", lyDoCap: "DUOI_NGUONG", tien: tong });
  });

  it("[HNS-03] KHÔNG THEO NGƯỜI HƯỞNG: hàng chờ INPUT_DRIFT 600.000 gồm hai người hưởng (300.000 mỗi người) ⇒ ngưỡng 500.000 đã đạt; đối chứng dương: ngưỡng 700.000 thì một người", async () => {
    const { bc, hold } = await troiNguoiChot("hns03");
    await datNguong(500_000);
    expect(await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() })).toMatchObject({ cap: "HAI_CAP", lyDoCap: "TU_NGUONG", tien: 600_000 });
    await datNguong(700_000);
    expect(await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() })).toMatchObject({ cap: "MOT_CAP", lyDoCap: "DUOI_NGUONG", tien: 600_000 });
  });

  it("[HNS-04] KHÔNG CỘNG HÀNG CHỜ KHÁC chưa được resolve trong thao tác này: thêm một hàng chờ MỞ khác của cùng khoản (500.000) ⇒ ngưỡng 1.000.000 vẫn đo trên 600.000 của hàng chờ đang xử lý ⇒ MỘT người quyết và ghi được; hàng chờ kia nguyên trạng", async () => {
    await datNguong(1_000_000);
    const { k, bc, id, hold } = await troiNguoiChot("hns04");
    const khac = await hangChoKhac(k, id, 500_000);
    const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem).toMatchObject({ cap: "MOT_CAP", lyDoCap: "DUOI_NGUONG", tien: 600_000 });
    expect(xem).not.toHaveProperty("tienSuKien");
    const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() });
    expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "MOT_CAP", ketQua: { loai: "DA_AP_DUNG", soDong: 2 } });
    expect(await dongDieuChinh(id)).toHaveLength(2);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: khac.id } })).status).toBe("OPEN");
  });

  it("[HNS-05] KHÔNG CỘNG `INPUT_CORRECTION` LỊCH SỬ: sau khi đã điều chỉnh 600.000 trên khoản, một hàng chờ mới 600.000 vẫn đo riêng ⇒ ngưỡng 1.000.000 ⇒ MỘT người ghi được; đối chứng: ngưỡng 500.000 thì hai người (vì chính 600.000 hiện tại)", async () => {
    await datNguong(null);
    const { k, bc, id, hold } = await troiNguoiChot("hns05");
    await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() });
    expect(await dongDieuChinh(id)).toHaveLength(2); // lịch sử: 600.000 đã ghi
    const nua = await seedUser({ email: `${k.ma}-sale-nua@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-nua`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: nua.id } });
    await quetKhoan(db, bc, id);
    const hold2 = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT", status: "OPEN" } });
    expect(hold2.id).not.toBe(hold.id);

    await datNguong(1_000_000);
    const xem = await xemTruocXuLy(db, bc, { holdId: hold2.id, nguoi: A, now: bay() });
    expect(xem).toMatchObject({ cap: "MOT_CAP", lyDoCap: "DUOI_NGUONG", tien: 600_000 });
    const r = await quyetXuLy(db, bc, { holdId: hold2.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() });
    expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "MOT_CAP" });
    expect(await dongDieuChinh(id)).toHaveLength(4);
    // đối chứng: chính tập hiện tại (600.000) vẫn đạt ngưỡng 500.000 ở một hàng chờ thứ ba
    const x3 = await troiNguoiChot("hns05dc");
    await datNguong(500_000);
    expect(await xemTruocXuLy(db, x3.bc, { holdId: x3.hold.id, nguoi: A, now: bay() })).toMatchObject({ cap: "HAI_CAP", lyDoCap: "TU_NGUONG" });
  });

  it("[HNS-06] KHÔNG CHIA MỘT HÀNG CHỜ THÀNH HAI LƯỢT GHI: sau khi đã giải quyết, lượt thứ hai (cùng người hoặc người khác) bị từ chối / idempotent, KHÔNG ghi thêm dòng nào — toàn bộ tập điều chỉnh đi qua MỘT lần so ngưỡng", async () => {
    await datNguong(null);
    const { bc, id, hold } = await troiNguoiChot("hns06");
    const vao = { holdId: hold.id, quyetDinh: "AP_DUNG" as const, lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, now: bay() };
    expect(await quyetXuLy(db, bc, { ...vao, nguoi: A })).toMatchObject({ loai: "DA_XU_LY" });
    const truoc = (await dongDieuChinh(id)).length;
    await expect(quyetXuLy(db, bc, { ...vao, nguoi: B })).rejects.toMatchObject({ ma: "TRANG_THAI_DA_DOI" });
    expect(await quyetXuLy(db, bc, { ...vao, nguoi: A })).toEqual({ loai: "DA_XU_LY_TRUOC" });
    expect(await dongDieuChinh(id)).toHaveLength(truoc);
  });
});
