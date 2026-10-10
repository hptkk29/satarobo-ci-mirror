// @vitest-environment node
/**
 * [NHH-PER-05/06] · [NHH-SEC-05/07/08] · xuất xlsx · đánh dấu đã chi · kết chuyển âm — trên Postgres THẬT (04 §12–§13, 05 AC-PER/AC-SEC).
 *
 * Người thao tác KỲ mang `quyen` = Actor đã resolve từ DB (vai THẬT: Kế toán HO / QLCS neo tại cơ sở) — `passesScope` của dịch vụ chạy trên nó.
 * Mỗi kịch bản dùng cơ sở riêng nên một lô xuất bởi QLCS của kịch bản chỉ gom đúng kỳ của nó (HO thì gom MỌI cơ sở — các ca HO chỉ khẳng định
 * điều không phụ thuộc dữ liệu của bộ khác). Ngày TUYỆT ĐỐI (luật 19); `now` của khoá kỳ = ngày tuyệt đối SAU mọi `updatedAt` của fixture.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Trần thời gian của bộ: mặc định 5s là trần của máy nhanh + DB mới tinh. DB test TÍCH khoản qua các lượt chạy (sổ bất biến không dọn được) và các ca quét toàn hệ
// chậm dần theo đó — đo 08/10: cùng mã, lượt 1 đỏ vì timeout, lượt 2 xanh. Nâng trần ở ĐÚNG bộ này, không phải toàn repo.
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { chuyenRaSoat, doiHangChoSangKySau, khoaKyHoaHong, tinhKy, traLaiKy, type NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { danhDauDaChi, xuatBangChi } from "../../lib/hoa-hong/xuat-ky";
import {
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganNguon,
  hoanTien,
  lamNhanVien,
  nguoiKyHo,
  nguoiKyQlcs,
  themChinhSachNhom,
  tienVe,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-XQ] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
/** Ca nhiều bước (tính → rà soát → khoá → xuất → chi) trên DB tích dữ liệu qua các lượt chạy: mặc định 5s của vitest là TRẦN CỦA MÁY NHANH, không phải của luật. */
const TRAN_CA_NANG = 60_000;
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
const kyCua = (k: KichBan, thang: string) => db.commissionPeriod.findFirstOrThrow({ where: { period: thang, centerId: k.centerId } });
const loi = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
  } catch (e) {
    return e instanceof HoaHongError ? e.ma : `LA:${String(e)}`;
  }
  return null;
};
const soAudit = (entityId: string, action?: string) => db.auditLog.count({ where: { entityId, ...(action ? { action } : {}) } });

/** Tính → rà soát → khoá kỳ `thang` của kịch bản (đúng vòng đời thật). */
async function khoaThang(k: KichBan, thang: string, nguoi: NguoiThaoTacKy) {
  const bc = await boiCanh(k, NOW);
  const ky = await kyCua(k, thang);
  await tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 0, actor: nguoi });
  await chuyenRaSoat(db, { periodId: ky.id, actor: nguoi, now: NOW });
  await khoaKyHoaHong(db, { periodId: ky.id, actor: nguoi, now: NOW, lyDo: `khoá kỳ ${thang} để chi hoa hồng` });
  return ky;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-XQ] khoá · xuất · đã chi · phạm vi ghi", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-PER-05] khoá kỳ bắt buộc LÝ DO ≥ 10 ký tự: thiếu ⇒ THIEU_LY_DO, kỳ không đổi, 0 audit; đủ ⇒ LOCKED + MỘT audit LOCK mang đúng lý do và người", async () => {
    const k = await kb("per05", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql = await nguoiKyQlcs(k);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), id);
    const ky = await kyCua(k, "2026-10");
    await tinhKy(db, await boiCanh(k, NOW), { periodId: ky.id, soThangDoiSoat: 0, actor: ql });
    await chuyenRaSoat(db, { periodId: ky.id, actor: ql, now: NOW });

    expect(await loi(() => khoaKyHoaHong(db, { periodId: ky.id, actor: ql, now: NOW, lyDo: "ngắn" }))).toBe("THIEU_LY_DO");
    expect(await loi(() => khoaKyHoaHong(db, { periodId: ky.id, actor: ql, now: NOW, lyDo: "         " }))).toBe("THIEU_LY_DO");
    expect((await kyCua(k, "2026-10")).status).toBe("REVIEWING");
    expect(await soAudit(ky.id, "LOCK")).toBe(0);

    await khoaKyHoaHong(db, { periodId: ky.id, actor: ql, now: NOW, lyDo: "khoá kỳ 10 để chi lương" });
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");
    const au = await db.auditLog.findMany({ where: { entityId: ky.id, action: "LOCK" } });
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ module: "hoa-hong", entityType: "CommissionPeriod", actorId: ql.userId });
    expect(au[0]!.reason).toBe("khoá kỳ 10 để chi lương");
    // trả lại cũng bắt lý do (đối chứng ở trạng thái khác)
    expect(await loi(() => traLaiKy(db, { periodId: ky.id, actor: ql, now: NOW, lyDo: "x" }))).toBe("THIEU_LY_DO");
  });

  it("[NHH-SEC-07] GHI phải trong phạm vi: QLCS CS1 tính/rà soát/khoá/dời hàng chờ kỳ của CS2 ⇒ NGOAI_PHAM_VI, kỳ nguyên trạng, 0 audit; đối chứng: chính QLCS CS1 làm được kỳ CS1, Kế toán HO làm được kỳ CS2", async () => {
    const k1 = await kb("sec07a", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const k2 = await kb("sec07b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql1 = await nguoiKyQlcs(k1);
    const ho = await nguoiKyHo();
    const id2 = await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k2, NOW), id2);
    const ky2 = await kyCua(k2, "2026-10");
    const bc2 = await boiCanh(k2, NOW);

    expect(await loi(() => tinhKy(db, bc2, { periodId: ky2.id, soThangDoiSoat: 0, actor: ql1 }))).toBe("NGOAI_PHAM_VI");
    expect((await kyCua(k2, "2026-10")).status).toBe("OPEN");
    // đối chứng dương: HO tính được kỳ CS2 (không thì "bị từ chối" có thể chỉ là kỳ hỏng)
    await tinhKy(db, bc2, { periodId: ky2.id, soThangDoiSoat: 0, actor: ho });
    expect(await loi(() => chuyenRaSoat(db, { periodId: ky2.id, actor: ql1, now: NOW }))).toBe("NGOAI_PHAM_VI");
    await chuyenRaSoat(db, { periodId: ky2.id, actor: ho, now: NOW });
    expect(await loi(() => khoaKyHoaHong(db, { periodId: ky2.id, actor: ql1, now: NOW, lyDo: "khoá kỳ của cơ sở khác" }))).toBe("NGOAI_PHAM_VI");
    expect(await loi(() => traLaiKy(db, { periodId: ky2.id, actor: ql1, now: NOW, lyDo: "trả lại kỳ của cơ sở khác" }))).toBe("NGOAI_PHAM_VI");
    expect((await kyCua(k2, "2026-10")).status).toBe("REVIEWING");
    expect(await soAudit(ky2.id, "LOCK")).toBe(0);
    expect(await soAudit(ky2.id, "RETURN")).toBe(0);
    await khoaKyHoaHong(db, { periodId: ky2.id, actor: ho, now: NOW, lyDo: "HO khoá kỳ CS2 để chi lương" });
    expect((await kyCua(k2, "2026-10")).status).toBe("LOCKED");

    // chính QLCS CS1 làm được kỳ CS1
    const id1 = await tienVe(k1, await dungBe(k1, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k1, NOW), id1);
    const ky1 = await khoaThang(k1, "2026-10", ql1);
    expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky1.id } })).status).toBe("LOCKED");

    // dời hàng chờ: hàng chờ chặn của kỳ CS2 — QLCS CS1 không dời được
    const hold = await db.commissionHold.create({
      data: { holdKey: `${k2.ma}:chan`, code: "MANUAL_REVIEW_REQUIRED", severity: "HARD", status: "OPEN", paymentId: id2, blockingPeriodId: ky2.id, detail: { lyDo: "fixture" } },
    });
    expect(await loi(() => doiHangChoSangKySau(db, { kyCutover: "2026-10" }, { holdId: hold.id, actor: ql1, now: NOW, lyDo: "dời hàng chờ của cơ sở khác" }))).toBe("NGOAI_PHAM_VI");
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).blockingPeriodId).toBe(ky2.id);
    await db.commissionHold.update({ where: { id: hold.id }, data: { status: "RESOLVED", resolvedAt: NOW, resolutionNote: "dọn fixture" } });
  }, TRAN_CA_NANG);

  it("[NHH-SEC-05] ĐỌC kỳ qua scopedDb: QLCS CS1 thấy kỳ CS1 và KHÔNG thấy kỳ CS2; Kế toán HO thấy cả hai (đối chứng dương)", async () => {
    const k1 = await kb("sec05a", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const k2 = await kb("sec05b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    for (const k of [k1, k2]) await quetKhoan(db, await boiCanh(k, NOW), await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") }));
    const ql1 = await nguoiKyQlcs(k1);
    const ho = await nguoiKyHo();
    const ids = [(await kyCua(k1, "2026-10")).id, (await kyCua(k2, "2026-10")).id];
    const thay = async (a: NguoiThaoTacKy) => (await scopedDb(a.quyen).commissionPeriod.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id).sort();
    expect(await thay(ql1)).toEqual([ids[0]]);
    expect(await thay(ho)).toEqual([...ids].sort());
    // và dòng sổ của kỳ: cùng ranh giới
    const dong = async (a: NguoiThaoTacKy) => (await scopedDb(a.quyen).commissionTransaction.findMany({ where: { periodId: { in: ids } }, select: { periodId: true } })).map((r) => r.periodId);
    expect(new Set(await dong(ql1))).toEqual(new Set([ids[0]]));
    expect(new Set(await dong(ho))).toEqual(new Set(ids));
  });

  it("[NHH-PER-06] xuất xlsx: PAYROLL chỉ NHÂN VIÊN nội bộ, người giới thiệu ngoài (phụ huynh) ra lô QUYẾT TOÁN riêng; kỳ LOCKED→EXPORTED; xuất lại không chi hai lần; đánh dấu đã chi → kỳ PAID khi MỌI lô đã chi", async () => {
    const k = await kb("per06", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    const ql = await nguoiKyQlcs(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `PH giới thiệu ${k.ma}`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
    await lamNhanVien(k.sale.id, "sale");
    await lamNhanVien(k.qlcs.id, "qlcs");
    await ganNguon(k, "PARENT_REFERRAL", { phHuynhUserId: ph.id, attributedAt: new Date("2026-10-01T03:00:00.000Z") });
    const id = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), id);
    expect((await dongSoCuaKhoan(id)).map((d) => [d.roleCode, d.amount]).sort()).toEqual([["CENTER_MANAGER", 200_000], ["REFERRER_PARENT", 200_000], ["SALE", 400_000]]);
    await khoaThang(k, "2026-10", ql);

    // chưa có lô nào ⇒ đánh dấu chi một lô không tồn tại bị từ chối
    expect(await loi(() => danhDauDaChi(db, { batchId: "khong-co", actor: ql, now: NOW, lyDo: "đánh dấu đã chi tháng 10" }))).toBe("LO_KHONG_TON_TAI");
    expect(await loi(() => xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "ngắn" }))).toBe("THIEU_LY_DO");

    const pay = await xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "xuất bảng lương tháng 10" });
    expect(pay).toMatchObject({ kind: "PAYROLL", soDong: 2, tongChi: 600_000, soKyDaKhoa: 1, soKyChuaKhoa: 0 });
    // QLCS chỉ gom kỳ của cơ sở mình; mọi kỳ cơ sở khác của tháng được ĐẾM là ngoài phạm vi (không gom, không lộ nội dung)
    expect(pay.soKyNgoaiPhamVi).toBe(await db.commissionPeriod.count({ where: { period: "2026-10", centerId: { not: k.centerId } } }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(pay.xlsx as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bảng lương 2026-10", "Chi tiết dòng sổ"]);
    const bang = wb.worksheets[0]!;
    const nguoi: string[] = [];
    bang.eachRow((r, i) => i > 1 && nguoi.push(String(r.getCell(1).value)));
    expect(nguoi.filter((t) => t !== "TỔNG").sort()).toEqual([`${k.ma}-ql`, `${k.ma}-sale`].sort());
    expect(nguoi.some((t) => t.includes("PH giới thiệu"))).toBe(false); // người ngoài KHÔNG có mặt trong bảng lương
    expect(Number(bang.lastRow!.getCell(5).value)).toBe(600_000); // dòng TỔNG: số chi
    expect(wb.worksheets[1]!.rowCount - 1).toBe(2);

    expect((await kyCua(k, "2026-10")).status).toBe("EXPORTED");
    const ngoai = await xuatBangChi(db, { thang: "2026-10", kind: "EXTERNAL_SETTLEMENT", actor: ql, now: NOW, lyDo: "quyết toán người giới thiệu ngoài" });
    expect(ngoai).toMatchObject({ kind: "EXTERNAL_SETTLEMENT", soDong: 1, tongChi: 200_000 });
    // xuất lại: không dòng nào còn trống lô ⇒ TỪ CHỐI (không chi hai lần, không đẻ lô rỗng, không audit thừa)
    const soLoTruoc = await db.commissionPayoutBatch.count({ where: { month: "2026-10" } });
    expect(await loi(() => xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "bấm xuất lại lần hai" }))).toBe("KHONG_CO_DONG_DE_XUAT");
    expect(await db.commissionPayoutBatch.count({ where: { month: "2026-10" } })).toBe(soLoTruoc); // không đẻ lô rỗng
    expect(await db.commissionTransaction.count({ where: { paymentId: id, payoutBatchId: null } })).toBe(0);

    // đã chi: lô nội bộ trước ⇒ kỳ CHƯA PAID (lô ngoài còn EXPORTED); lô ngoài sau ⇒ PAID
    expect(await danhDauDaChi(db, { batchId: pay.batchId, actor: ql, now: NOW, lyDo: "đã chuyển khoản bảng lương" })).toEqual({ soDong: 2, soKyPaid: 0 });
    expect((await kyCua(k, "2026-10")).status).toBe("EXPORTED");
    expect(await loi(() => danhDauDaChi(db, { batchId: pay.batchId, actor: ql, now: NOW, lyDo: "đánh dấu lần hai" }))).toBe("LO_DA_CHI");
    expect(await danhDauDaChi(db, { batchId: ngoai.batchId, actor: ql, now: NOW, lyDo: "đã chuyển khoản quyết toán" })).toEqual({ soDong: 1, soKyPaid: 1 });
    expect((await kyCua(k, "2026-10")).status).toBe("PAID");
    expect((await dongSoCuaKhoan(id)).every((d) => d.payoutStatus === "PAID")).toBe(true);
    // SEC-08: mỗi thao tác một audit có lý do
    const ky = await kyCua(k, "2026-10");
    expect(await soAudit(ky.id, "EXPORT")).toBe(2); // đúng 2 lô; lần bấm xuất lại bị từ chối nên KHÔNG có audit thừa
    expect((await db.auditLog.findMany({ where: { entityId: { in: [pay.batchId, ngoai.batchId] }, action: "MARK_PAID" } })).every((a) => (a.reason ?? "").length >= 10)).toBe(true);
  }, TRAN_CA_NANG);

  it("[NHH-PER-06b] xuất/đánh dấu chi ngoài phạm vi: lô của QLCS chỉ gom kỳ cơ sở mình (kỳ CS khác đã khoá vẫn nguyên); tháng chỉ có kỳ cơ sở khác ⇒ NGOAI_PHAM_VI; đánh dấu chi lô của cơ sở khác ⇒ NGOAI_PHAM_VI, lô nguyên trạng", async () => {
    const k1 = await kb("per06b1", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const k2 = await kb("per06b2", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql1 = await nguoiKyQlcs(k1);
    const ql2 = await nguoiKyQlcs(k2);
    await lamNhanVien(k2.sale.id, "sale2");
    await lamNhanVien(k1.sale.id, "sale1");
    // kỳ của CS1 CŨNG đã khoá và CHƯA xuất: lô của QLCS CS2 không được cuốn nó theo (đối chứng — thiếu nó ca vẫn xanh khi bộ lọc phạm vi bị gỡ)
    const id1 = await tienVe(k1, await dungBe(k1, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k1, NOW), id1);
    await khoaThang(k1, "2026-10", ql1);
    const id2 = await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k2, NOW), id2);
    await khoaThang(k2, "2026-10", ql2);
    const r = await xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql2, now: NOW, lyDo: "QLCS CS2 xuất kỳ của mình" });
    expect(r.soDong).toBe(1);
    expect(r.tongChi).toBe(300_000);
    expect(await db.commissionTransaction.count({ where: { paymentId: id1, payoutBatchId: null, payoutStatus: "APPROVED" } })).toBe(1); // CS1 nguyên trạng
    expect(await loi(() => danhDauDaChi(db, { batchId: r.batchId, actor: ql1, now: NOW, lyDo: "QLCS CS1 đánh dấu chi lô CS2" }))).toBe("NGOAI_PHAM_VI");
    expect((await db.commissionPayoutBatch.findUniqueOrThrow({ where: { id: r.batchId } })).status).toBe("EXPORTED");
    expect((await dongSoCuaKhoan(id2)).every((d) => d.payoutStatus === "EXPORTED")).toBe(true);
    expect(await danhDauDaChi(db, { batchId: r.batchId, actor: ql2, now: NOW, lyDo: "QLCS CS2 đánh dấu đã chi" })).toMatchObject({ soDong: 1 });
    // QLCS của cơ sở KHÔNG có kỳ nào trong tháng, trong khi cơ sở khác có: NGOAI_PHAM_VI chứ không giả vờ "chưa khoá"
    const k3 = await kb("per06b3", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql3 = await nguoiKyQlcs(k3);
    expect(await loi(() => xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql3, now: NOW, lyDo: "QLCS cơ sở không có kỳ nào" }))).toBe("NGOAI_PHAM_VI");
  }, TRAN_CA_NANG);

  it("[NHH-PER-06c] kết chuyển ÂM: hoàn tiền sau khi đã chi ⇒ tháng sau ròng âm ⇒ xuất 0 + hàng chờ NEGATIVE_BALANCE (mềm); tháng kế có dương ⇒ trừ phần âm rồi mới chi, hàng chờ đóng", async () => {
    const k = await kb("per06c", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql = await nguoiKyQlcs(k);
    await lamNhanVien(k.sale.id, "sale");
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    await khoaThang(k, "2026-10", ql);
    const t10 = await xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "xuất lương tháng 10" });
    expect(t10).toMatchObject({ soDong: 1, tongChi: 300_000, amKetChuyen: [] });
    await danhDauDaChi(db, { batchId: t10.batchId, actor: ql, now: NOW, lyDo: "đã chuyển khoản tháng 10" });

    // Tháng 11: chỉ có hoàn tiền 4tr ⇒ −120.000 vào kỳ 11 (kỳ gốc đã PAID — không mở lại)
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-10") });
    expect((await quetKhoan(db, bc, hoan)).loai).toBe("DA_DAO");
    expect((await dongSoCuaKhoan(hoan)).map((d) => d.amount)).toEqual([-120_000]);
    await khoaThang(k, "2026-11", ql);
    const t11 = await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "xuất lương tháng 11" });
    expect(t11).toMatchObject({ soDong: 1, tongChi: 0 }); // không chi số âm
    expect(t11.amKetChuyen).toEqual([{ nguoi: `U:${k.sale.id}`, so: -120_000 }]);
    const mo = await db.commissionHold.findMany({ where: { code: "NEGATIVE_BALANCE", status: "OPEN", holdKey: { endsWith: `U:${k.sale.id}` } } });
    expect(mo).toHaveLength(1);
    expect(mo[0]).toMatchObject({ severity: "SOFT", blockingPeriodId: null });
    expect(mo[0]!.detail).toMatchObject({ canXemTay: false }); // nhân viên ĐANG LÀM: trừ dần vào lương tháng sau, không cần ai xem tay
    await danhDauDaChi(db, { batchId: t11.batchId, actor: ql, now: NOW, lyDo: "tháng 11 không có số chi" });

    // Tháng 12: khoản mới +300.000 ⇒ chi 180.000 sau khi trừ −120.000; hàng chờ đóng, không còn âm
    const moi = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-12-05") });
    await quetKhoan(db, bc, moi);
    await khoaThang(k, "2026-12", ql);
    const t12 = await xuatBangChi(db, { thang: "2026-12", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "xuất lương tháng 12" });
    expect(t12).toMatchObject({ soDong: 1, tongChi: 180_000, amKetChuyen: [] });
    expect(await db.commissionHold.count({ where: { code: "NEGATIVE_BALANCE", status: "OPEN", holdKey: { endsWith: `U:${k.sale.id}` } } })).toBe(0);
    expect((await db.commissionHold.findMany({ where: { code: "NEGATIVE_BALANCE", holdKey: { endsWith: `U:${k.sale.id}` } } })).map((h) => h.status)).toEqual(["RESOLVED"]);
  }, TRAN_CA_NANG);

  // Rà độc lập 08/10 — hai lỗ cùng gốc: hàng chờ NEGATIVE_BALANCE nạp TOÀN CỤC (không theo người trong lô) và `holdKey` không có lô trong khoá.
  //  (a) QLCS cơ sở C xuất ⇒ nợ âm của Sale cơ sở A bị cuốn vào lô của C (lộ trong xlsx, hàng chờ bị đóng "Đã tiêu thụ ở lô C"), rồi tạo lại hàng chờ cùng khoá ⇒ P2002.
  //  (b) cùng một NGƯỜI có dòng ở hai cơ sở, xuất lần hai cùng tháng khi vẫn còn âm ⇒ tạo hàng chờ trùng khoá ⇒ P2002, CẢ lô bị rollback.
  async function dungHaiCoSoMotNguoi(tien: string) {
    const a = await kb(`${tien}a`, { rules: [{ vai: "SALE", rate: 0.03 }] });
    const b = await kb(`${tien}b`, { rules: [{ vai: "SALE", rate: 0.03 }] });
    const qlA = await nguoiKyQlcs(a);
    const qlB = await nguoiKyQlcs(b);
    await lamNhanVien(a.sale.id, "x");
    await db.lead.update({ where: { id: b.lead!.id }, data: { convertedById: a.sale.id } }); // cơ sở B cũng trả hoa hồng Sale cho CÙNG người
    return { a, b, qlA, qlB, x: a.sale.id };
  }
  async function goc10HoanNov(k: KichBan) {
    const goc = await tienVe(k, await dungBe(k, "g"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), goc);
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-10") });
    expect((await quetKhoan(db, await boiCanh(k, NOW), hoan)).loai).toBe("DA_DAO");
  }
  const holdAm = (x: string) => db.commissionHold.findMany({ where: { code: "NEGATIVE_BALANCE", holdKey: { endsWith: `U:${x}` } }, orderBy: { createdAt: "asc" } });

  it("[NHH-PER-06e] cùng một người âm ở HAI cơ sở, xuất lần hai CÙNG tháng khi còn âm ⇒ thành công (không P2002); nợ cộng dồn −240.000 trong MỘT hàng chờ mở, hàng chờ cũ đóng", async () => {
    const { a, b, qlA, qlB, x } = await dungHaiCoSoMotNguoi("per06e");
    await goc10HoanNov(a);
    await goc10HoanNov(b);
    await khoaThang(a, "2026-11", qlA);
    const l1 = await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: qlA, now: NOW, lyDo: "xuất lương tháng 11 — cơ sở A" });
    expect(l1).toMatchObject({ soDong: 1, tongChi: 0, amKetChuyen: [{ nguoi: `U:${x}`, so: -120_000 }] });

    await khoaThang(b, "2026-11", qlB);
    const l2 = await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: qlB, now: NOW, lyDo: "xuất lương tháng 11 — cơ sở B" });
    expect(l2).toMatchObject({ soDong: 1, tongChi: 0, amKetChuyen: [{ nguoi: `U:${x}`, so: -240_000 }] });

    const holds = await holdAm(x);
    expect(holds.map((h) => h.status)).toEqual(["RESOLVED", "OPEN"]);
    expect(holds[1]!.detail).toMatchObject({ so: -240_000, loLenh: l2.batchId });
    expect(new Set(holds.map((h) => h.holdKey)).size).toBe(2); // khoá khác nhau theo lô
  }, TRAN_CA_NANG);

  it("[NHH-PER-06f] nợ âm của người cơ sở A KHÔNG bị cuốn vào lô của QLCS cơ sở C: không lộ trong xlsx, hàng chờ vẫn MỞ nguyên, xuất không lỗi; đối chứng: người ấy có dòng trong lô thì nợ được trừ", async () => {
    const a = await kb("per06fa", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const c = await kb("per06fc", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const qlA = await nguoiKyQlcs(a);
    const qlC = await nguoiKyQlcs(c);
    await lamNhanVien(a.sale.id, "x");
    await lamNhanVien(c.sale.id, "y");
    await goc10HoanNov(a);
    await khoaThang(a, "2026-11", qlA);
    await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: qlA, now: NOW, lyDo: "xuất lương tháng 11 — cơ sở A" });
    const truoc = (await holdAm(a.sale.id)).map((h) => ({ id: h.id, status: h.status, detail: h.detail }));
    expect(truoc).toEqual([expect.objectContaining({ status: "OPEN" })]);

    const moiC = await tienVe(c, await dungBe(c, "m"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, await boiCanh(c, NOW), moiC);
    await khoaThang(c, "2026-11", qlC);
    const lc = await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: qlC, now: NOW, lyDo: "xuất lương tháng 11 — cơ sở C" });
    expect(lc).toMatchObject({ soDong: 1, tongChi: 300_000, amKetChuyen: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(lc.xlsx as unknown as ArrayBuffer);
    const ten: string[] = [];
    wb.worksheets[0]!.eachRow((r, i) => i > 1 && ten.push(String(r.getCell(1).value)));
    expect(ten.filter((t) => t !== "TỔNG")).toEqual([`${c.ma}-sale`]); // KHÔNG có người của cơ sở A
    expect((await holdAm(a.sale.id)).map((h) => ({ id: h.id, status: h.status, detail: h.detail }))).toEqual(truoc); // nguyên vẹn

    // đối chứng dương: người ấy CÓ dòng trong lô (cơ sở C cũng trả Sale cho X) ⇒ nợ −120.000 được trừ vào 300.000
    const d = await kb("per06fd", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const qlD = await nguoiKyQlcs(d);
    await db.lead.update({ where: { id: d.lead!.id }, data: { convertedById: a.sale.id } });
    const moiD = await tienVe(d, await dungBe(d, "m"), { soTien: 10_000_000, ngay: D("2026-11-06") });
    await quetKhoan(db, await boiCanh(d, NOW), moiD);
    await khoaThang(d, "2026-11", qlD);
    const ld = await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: qlD, now: NOW, lyDo: "xuất lương tháng 11 — cơ sở D" });
    expect(ld).toMatchObject({ soDong: 1, tongChi: 180_000, amKetChuyen: [] });
    expect((await holdAm(a.sale.id)).map((h) => h.status)).toEqual(["RESOLVED"]);
  }, TRAN_CA_NANG);

  // 04 §13/Q19 (header của xuat-ky.ts đã hứa, mã chưa làm — rà độc lập 08/10): người ĐÃ NGHỈ hoặc người NGOÀI mang âm không có lương để trừ ⇒ cùng hàng chờ nhưng cờ xem tay.
  it("[NHH-PER-06g] âm kết chuyển của người ĐÃ NGHỈ (lô lương) và người NGOÀI (lô quyết toán) mang cờ canXemTay + lý do; hàng chờ vẫn MỀM, không chặn khoá kỳ", async () => {
    const k = await kb("per06g", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql = await nguoiKyQlcs(k);
    const nv = await lamNhanVien(k.sale.id, "nghi");
    await goc10HoanNov(k);
    await db.employee.update({ where: { id: nv }, data: { status: "RESIGNED" } });
    await khoaThang(k, "2026-11", ql);
    const luong = await xuatBangChi(db, { thang: "2026-11", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "xuất lương tháng 11 — người đã nghỉ" });
    expect(luong.amKetChuyen).toEqual([{ nguoi: `U:${k.sale.id}`, so: -120_000 }]);
    const h = await holdAm(k.sale.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ severity: "SOFT", status: "OPEN", blockingPeriodId: null });
    expect(h[0]!.detail).toMatchObject({ canXemTay: true, lyDoXemTay: "NGUOI_DA_NGHI" });

    // người NGOÀI (không có Employee): dòng thuộc lô quyết toán
    const ng = await kb("per06gx", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const qlNg = await nguoiKyQlcs(ng);
    await goc10HoanNov(ng);
    await khoaThang(ng, "2026-11", qlNg);
    const qt = await xuatBangChi(db, { thang: "2026-11", kind: "EXTERNAL_SETTLEMENT", actor: qlNg, now: NOW, lyDo: "quyết toán tháng 11 — người ngoài" });
    expect(qt.amKetChuyen).toEqual([{ nguoi: `U:${ng.sale.id}`, so: -120_000 }]);
    expect((await holdAm(ng.sale.id))[0]!.detail).toMatchObject({ canXemTay: true, lyDoXemTay: "NGUOI_NGOAI" });
  }, TRAN_CA_NANG);

  // Cấy 08/10: bỏ so `kind` khi nạp âm kết chuyển ⇒ 0 ca đỏ. Hai lô (lương nội bộ / quyết toán ngoài) là hai khoản tiền khác nhau, thuế khác nhau: nợ của lô này không được
  // trừ vào lô kia dù cùng một người.
  it("[NHH-PER-06d] âm kết chuyển tách theo LOẠI LÔ: nợ của lô QUYẾT TOÁN không bị trừ vào lô LƯƠNG của cùng người, và hàng chờ nợ ấy vẫn MỞ", async () => {
    const k = await kb("per06d", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql = await nguoiKyQlcs(k);
    await lamNhanVien(k.sale.id, "sale");
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), goc);
    await khoaThang(k, "2026-10", ql);
    const no = await db.commissionHold.create({
      data: {
        holdKey: `NEGATIVE_BALANCE:EXTERNAL_SETTLEMENT:2026-09:U:${k.sale.id}`,
        code: "NEGATIVE_BALANCE",
        severity: "SOFT",
        status: "OPEN",
        detail: { lyDo: "fixture", nguoi: `U:${k.sale.id}`, so: -100_000, kind: "EXTERNAL_SETTLEMENT", thang: "2026-09" },
      },
    });
    const lo = await xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ql, now: NOW, lyDo: "xuất lương tháng 10" });
    expect(lo).toMatchObject({ soDong: 1, tongChi: 300_000, amKetChuyen: [] }); // không bị trừ 100.000 của lô khác
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: no.id } })).status).toBe("OPEN");
  }, TRAN_CA_NANG);

  it("[NHH-SEC-08] thao tác kỳ hỏng giữa chừng ⇒ KHÔNG audit, KHÔNG đổi trạng thái (audit cùng transaction với phép ghi, từ chối = throw trước phép ghi đầu)", async () => {
    const k = await kb("sec08", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const ql = await nguoiKyQlcs(k);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), id);
    const ky = await kyCua(k, "2026-10");
    await tinhKy(db, await boiCanh(k, NOW), { periodId: ky.id, soThangDoiSoat: 0, actor: ql });
    await chuyenRaSoat(db, { periodId: ky.id, actor: ql, now: NOW });
    const truoc = await soAudit(ky.id);
    // hàng chờ chặn khoá ⇒ khoá bị từ chối: không đổi trạng thái, không thêm audit
    const hold = await db.commissionHold.create({ data: { holdKey: `${k.ma}:chan`, code: "MANUAL_REVIEW_REQUIRED", severity: "HARD", status: "OPEN", paymentId: id, blockingPeriodId: ky.id, detail: { lyDo: "fixture" } } });
    expect(await loi(() => khoaKyHoaHong(db, { periodId: ky.id, actor: ql, now: NOW, lyDo: "khoá khi còn hàng chờ chặn" }))).toBe("KY_CHUYEN_KHONG_HOP_LE");
    expect((await kyCua(k, "2026-10")).status).toBe("REVIEWING");
    expect(await soAudit(ky.id)).toBe(truoc);
    expect((await db.commissionTransaction.findMany({ where: { periodId: ky.id } })).every((d) => d.payoutStatus === "PENDING")).toBe(true);
    await db.commissionHold.update({ where: { id: hold.id }, data: { status: "RESOLVED", resolvedAt: NOW, resolutionNote: "dọn fixture" } });
    await khoaKyHoaHong(db, { periodId: ky.id, actor: ql, now: NOW, lyDo: "khoá sau khi hàng chờ đã đóng" });
    expect(await soAudit(ky.id, "LOCK")).toBe(1);
  });
});
