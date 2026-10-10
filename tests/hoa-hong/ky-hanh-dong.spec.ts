// @vitest-environment node
/**
 * [NHH-KY-ACT-01..08] — LỚP MỎNG của tab Kỳ (`lib/hoa-hong/ky-hanh-dong.ts` + `ky-doc.ts`) trên Postgres THẬT.
 *
 * Service kỳ (`ky-service`, `xuat-ky`) đã có bộ riêng (`so-xuat-quyen.spec.ts`: lý do, phạm vi, kết chuyển âm, xuất lần hai). Bộ này canh những gì LỚP MỎNG thêm:
 *   · cờ gác (engine tắt · xuất bảng chi tắt) — đúng với người gọi thẳng Server Action;
 *   · "Tính" lần đầu MỞ kỳ — nhưng chỉ SAU khi đã kiểm phạm vi (ngoài phạm vi ⇒ không có kỳ nào được tạo);
 *   · khoá: bấm lén khi còn hàng chờ chặn ⇒ SERVER từ chối dù UI không vẽ nút; số liệu đã đọc lệch số hiện tại ⇒ từ chối;
 *   · số trên màn (`tongHopTheoKy`) bằng phép đếm của CHÍNH cổng khoá, và cô lập theo cơ sở.
 *
 * Mỗi ca "bị từ chối" đi kèm đối chứng dương (cùng kịch bản, đường hợp lệ ⇒ được) — ca chỉ khẳng định bị từ chối luôn đạt khi fixture hỏng.
 * Mỗi kịch bản dựng cơ sở riêng (luật 18) nên mỗi ca chạy ĐƯỢC MỘT MÌNH. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import {
  chuyenRaSoatHanhDong,
  danhDauDaChiHanhDong,
  khoaHanhDong,
  traLaiHanhDong,
  tinhKyHanhDong,
  xuatHanhDong,
  type PhuThuoc,
} from "../../lib/hoa-hong/ky-hanh-dong";
import { chupSoLieuKy, docDanhSachKy, docManHinhKy, demHangChoChanTheoTamNhin, tongHopTheoKy } from "../../lib/hoa-hong/ky-doc";
import { demHangChoChan, tinhKy } from "../../lib/hoa-hong/ky-service";
import { cauChanKhoa, gomChan, hanhDongCuaKy } from "../../lib/hoa-hong/ky-man-hinh";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import {
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  dungBe,
  dongSoCuaKhoan,
  dungKichBan,
  hoanTien,
  lamNhanVien,
  nguoiKyHo,
  nguoiKyQlcs,
  tienVe,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-KY-ACT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const THANG = "2026-10";
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = { rules: [{ vai: "SALE", rate: 0.03 }] }) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
const kyCua = (k: KichBan, thang = THANG) => db.commissionPeriod.findFirstOrThrow({ where: { period: thang, centerId: k.centerId } });
const soAudit = (entityId: string, action: string) => db.auditLog.count({ where: { entityId, action } });

/** Phụ thuộc của kịch bản: bối cảnh quét CHỈ gồm chính sách của kịch bản (rule lạ của bộ khác không lọt vào). Cờ cố định theo ca — không bộ nhớ đệm. */
function phuThuoc(k: KichBan, co: { engine?: boolean; xuat?: boolean } = {}): PhuThuoc {
  return {
    engineBat: async () => co.engine ?? true,
    xuatLuongBat: async () => co.xuat ?? true,
    dungBoiCanh: async (now) =>
      co.engine === false ? { loai: "TAT", lyDo: "ENGINE_TAT" } : { loai: "BAT", bc: await boiCanh(k, now) },
    soThangDoiSoat: async () => 0,
  };
}

/** Tính → chuyển rà soát bằng ĐƯỜNG THẬT của lớp mỏng. */
async function denRaSoat(k: KichBan, nguoi: Awaited<ReturnType<typeof nguoiKyQlcs>>, pt = phuThuoc(k)) {
  const t = await tinhKyHanhDong(pt, { nguoi, now: NOW, thang: THANG, centerId: k.centerId });
  expect(t.ok, JSON.stringify(t)).toBe(true);
  const ky = await kyCua(k);
  const c = await chuyenRaSoatHanhDong(pt, { nguoi, now: NOW, periodId: ky.id });
  expect(c.ok, JSON.stringify(c)).toBe(true);
  return ky;
}
async function khoaDuoc(k: KichBan, nguoi: Awaited<ReturnType<typeof nguoiKyQlcs>>, pt = phuThuoc(k)) {
  const ky = await denRaSoat(k, nguoi, pt);
  const daThay = (await chupSoLieuKy(ky.id))!;
  const r = await khoaHanhDong(pt, { nguoi, now: NOW, periodId: ky.id, lyDo: "khoá kỳ 10 để chi lương", daThay });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return ky;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-KY-ACT] lớp mỏng của tab Kỳ", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-KY-ACT-01] Tính lần đầu MỞ kỳ — nhưng ngoài phạm vi / trước mốc ⇒ KHÔNG kỳ nào được tạo; đối chứng: Kế toán HO Tính ⇒ kỳ CALCULATED + khoản được quét", async () => {
    const k1 = await kb("act01a");
    const k2 = await kb("act01b");
    const ql1 = await nguoiKyQlcs(k1);
    const ho = await nguoiKyHo();
    const id2 = await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k2);
    const demKy = (thang: string) => db.commissionPeriod.count({ where: { period: thang, centerId: k2.centerId } });

    const ngoai = await tinhKyHanhDong(pt, { nguoi: ql1, now: NOW, thang: THANG, centerId: k2.centerId });
    expect(ngoai).toMatchObject({ ok: false, ma: "NGOAI_PHAM_VI" });
    expect(await demKy(THANG)).toBe(0); // bamKy là phép GHI: phạm vi phải kiểm TRƯỚC nó
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id2 } })).toBe(0);

    const cu = await tinhKyHanhDong(pt, { nguoi: ho, now: NOW, thang: "2026-09", centerId: k2.centerId });
    expect(cu).toMatchObject({ ok: false, ma: "KY_TRUOC_MOC" });
    expect(await demKy("2026-09")).toBe(0);

    const ok = await tinhKyHanhDong(pt, { nguoi: ho, now: NOW, thang: THANG, centerId: k2.centerId });
    expect(ok).toMatchObject({ ok: true, soKhoan: 1 });
    expect((await kyCua(k2)).status).toBe("CALCULATED");
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id2 } })).toBe(1);
    expect(await soAudit((await kyCua(k2)).id, "CALCULATE")).toBe(1);
  });

  it("[NHH-KY-ACT-02] kỳ đang RÀ SOÁT mà bấm Tính ⇒ từ chối TRƯỚC lượt quét (không khoản nào bị ghi); đối chứng: Trả lại rồi Tính lại ⇒ khoản mới được quét", async () => {
    const k = await kb("act02");
    const ql = await nguoiKyQlcs(k);
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    const ky = await denRaSoat(k, ql, pt);
    const moi = await tienVe(k, await dungBe(k, "b"), { soTien: 5_000_000, ngay: D("2026-10-20") });

    const r = await tinhKyHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, centerId: k.centerId });
    expect(r).toMatchObject({ ok: false, ma: "KY_CHUYEN_KHONG_HOP_LE" });
    expect(await db.commissionCalcSlot.count({ where: { paymentId: moi } })).toBe(0); // lượt quét KHÔNG chạy
    expect((await kyCua(k)).status).toBe("REVIEWING");
    // và gọi THẲNG service (không qua lớp mỏng) cũng vậy: cổng nằm ở `tinhKy`, nơi cuối cùng trước lượt quét
    const thang = await tinhKy(db, await boiCanh(k, NOW), { periodId: ky.id, soThangDoiSoat: 0, actor: ql }).catch((e: unknown) => e);
    expect(thang).toMatchObject({ ma: "KY_CHUYEN_KHONG_HOP_LE" });
    expect(await db.commissionCalcSlot.count({ where: { paymentId: moi } })).toBe(0);

    expect(await traLaiHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo: "trả lại để tính khoản mới" })).toMatchObject({ ok: true });
    expect(await tinhKyHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, centerId: k.centerId })).toMatchObject({ ok: true });
    expect(await db.commissionCalcSlot.count({ where: { paymentId: moi } })).toBe(1);
  });

  it("[NHH-KY-ACT-03] KHOÁ: còn hàng chờ chặn ⇒ SERVER từ chối dù bấm lén; thiếu lý do ⇒ từ chối; số liệu lệch ⇒ từ chối; đối chứng: hết hàng chờ + số khớp ⇒ LOCKED", async () => {
    const k = await kb("act03");
    const ql = await nguoiKyQlcs(k);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    const ky = await denRaSoat(k, ql, pt);
    const truocKhoa = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
    expect(truocKhoa.kyGhiTiep).toBe("2026-11"); // thứ hộp thoại khoá sẽ nói với kế toán
    const hold = await db.commissionHold.create({
      data: { holdKey: `${k.ma}:chan`, code: "MANUAL_REVIEW_REQUIRED", severity: "HARD", status: "OPEN", paymentId: id, blockingPeriodId: ky.id, detail: { lyDo: "fixture" } },
    });
    const daThay = (await chupSoLieuKy(ky.id))!;
    const lyDo = "khoá kỳ 10 để chi lương";

    const chan = await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo, daThay });
    expect(chan).toMatchObject({ ok: false, ma: "KY_CHUYEN_KHONG_HOP_LE" });
    expect(chan.ok ? "" : chan.loi).toMatch(/hàng chờ/);
    expect((await kyCua(k)).status).toBe("REVIEWING");
    expect(await soAudit(ky.id, "LOCK")).toBe(0);

    await db.commissionHold.update({ where: { id: hold.id }, data: { status: "RESOLVED", resolvedAt: NOW, resolutionNote: "dọn fixture" } });
    expect(await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo: "ngắn", daThay })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo, daThay: { ...daThay, hoaHong: daThay.hoaHong + 1 } })).toMatchObject({ ok: false, ma: "SO_LIEU_DA_DOI" });
    expect(await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo, daThay: { ...daThay, lastCalculatedAt: "2020-01-01T00:00:00.000Z" } })).toMatchObject({ ok: false, ma: "SO_LIEU_DA_DOI" });
    expect((await kyCua(k)).status).toBe("REVIEWING");
    expect(await soAudit(ky.id, "LOCK")).toBe(0);

    const ok = await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo, daThay });
    expect(ok).toMatchObject({ ok: true });
    expect((await kyCua(k)).status).toBe("LOCKED");
    const au = await db.auditLog.findMany({ where: { entityId: ky.id, action: "LOCK" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.reason).toBe(lyDo);
    expect(await db.commissionTransaction.count({ where: { periodId: ky.id, payoutStatus: "APPROVED" } })).toBeGreaterThan(0);

    // Lời hứa của hộp thoại khoá: hoàn tiền phát sinh SAU khi khoá ghi vào đúng kỳ mà hộp thoại đã nói; kỳ đã khoá không nhận dòng mới.
    const soDongKy = await db.commissionTransaction.count({ where: { periodId: ky.id } });
    const hoan = await hoanTien(k, id, { soTien: 1_000_000, ngay: D("2026-10-25") });
    await quetKhoan(db, await boiCanh(k, NOW), hoan);
    const dongHoan = await dongSoCuaKhoan(hoan);
    expect(dongHoan.length).toBeGreaterThan(0);
    const kyDong = await db.commissionPeriod.findUniqueOrThrow({ where: { id: dongHoan[0]!.periodId } });
    expect(kyDong.period).toBe(truocKhoa.kyGhiTiep);
    expect(dongHoan[0]).toMatchObject({ naturalPeriod: THANG, lateArrival: true });
    expect(await db.commissionTransaction.count({ where: { periodId: ky.id } })).toBe(soDongKy);
    expect((await kyCua(k)).status).toBe("LOCKED");
  });

  it("[NHH-KY-ACT-03b] khoá/rà soát/trả lại kỳ CƠ SỞ KHÁC ⇒ NGOAI_PHAM_VI kể cả khi số liệu gửi lên SAI (phạm vi kiểm trước, không lộ 'số có khớp không'); đối chứng: Kế toán HO làm được", async () => {
    const k1 = await kb("act03b1");
    const k2 = await kb("act03b2");
    const ql1 = await nguoiKyQlcs(k1);
    const ho = await nguoiKyHo();
    await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt2 = phuThuoc(k2);
    const ky2 = await denRaSoat(k2, ho, pt2);
    const daThay = (await chupSoLieuKy(ky2.id))!;

    expect(await khoaHanhDong(pt2, { nguoi: ql1, now: NOW, periodId: ky2.id, lyDo: "QLCS CS1 khoá kỳ của CS2", daThay: { ...daThay, hoaHong: -1 } })).toMatchObject({ ok: false, ma: "NGOAI_PHAM_VI" });
    expect(await traLaiHanhDong(pt2, { nguoi: ql1, now: NOW, periodId: ky2.id, lyDo: "QLCS CS1 trả lại kỳ của CS2" })).toMatchObject({ ok: false, ma: "NGOAI_PHAM_VI" });
    expect((await kyCua(k2)).status).toBe("REVIEWING");
    expect(await khoaHanhDong(pt2, { nguoi: ho, now: NOW, periodId: ky2.id, lyDo: "HO khoá kỳ CS2 để chi lương", daThay })).toMatchObject({ ok: true });
  });

  it("[NHH-KY-ACT-04] cờ gác: ENGINE tắt ⇒ mọi thao tác ENGINE_TAT, kỳ nguyên trạng; đối chứng: bật lại ⇒ làm được", async () => {
    const k = await kb("act04");
    const ql = await nguoiKyQlcs(k);
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const tat = phuThuoc(k, { engine: false });

    expect(await tinhKyHanhDong(tat, { nguoi: ql, now: NOW, thang: THANG, centerId: k.centerId })).toMatchObject({ ok: false, ma: "ENGINE_TAT" });
    expect(await db.commissionPeriod.count({ where: { period: THANG, centerId: k.centerId } })).toBe(0);

    const ky = await denRaSoat(k, ql); // bật
    expect(await traLaiHanhDong(tat, { nguoi: ql, now: NOW, periodId: ky.id, lyDo: "thử trả lại khi engine tắt" })).toMatchObject({ ok: false, ma: "ENGINE_TAT" });
    expect(await khoaHanhDong(tat, { nguoi: ql, now: NOW, periodId: ky.id, lyDo: "thử khoá khi engine tắt", daThay: (await chupSoLieuKy(ky.id))! })).toMatchObject({ ok: false, ma: "ENGINE_TAT" });
    expect((await kyCua(k)).status).toBe("REVIEWING");
  });

  it("[NHH-KY-ACT-05] XUẤT bảng chi: cờ xuatLuongBat TẮT ⇒ XUAT_TAT, 0 lô; BẬT ⇒ xlsx đọc lại được; xuất lần hai ⇒ từ chối, 0 lô thừa; kỳ chưa khoá ⇒ từ chối", async () => {
    const k = await kb("act05");
    const ql = await nguoiKyQlcs(k);
    await lamNhanVien(k.sale.id, "sale");
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    await khoaDuoc(k, ql, pt);
    const soLo = () => db.commissionPayoutBatch.count({ where: { month: THANG } });
    const truoc = await soLo();
    const lyDo = "xuất bảng lương tháng 10";

    expect(await xuatHanhDong(phuThuoc(k, { xuat: false }), { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo })).toMatchObject({ ok: false, ma: "XUAT_TAT" });
    expect(await xuatHanhDong(phuThuoc(k, { engine: false }), { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo })).toMatchObject({ ok: false, ma: "ENGINE_TAT" });
    expect(await soLo()).toBe(truoc);
    expect((await kyCua(k)).status).toBe("LOCKED");
    expect(await xuatHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo: "ngắn" })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });

    const r = await xuatHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xuat).toMatchObject({ soDong: 1, tongChi: 300_000, soKyDaKhoa: 1 });
    expect(r.xuat.tep.tenTep).toBe("hoa-hong-bang-luong-2026-10.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(r.xuat.tep.base64, "base64") as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bảng lương 2026-10", "Chi tiết dòng sổ"]);
    expect(await soLo()).toBe(truoc + 1);
    expect((await kyCua(k)).status).toBe("EXPORTED");

    const lai = await xuatHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo: "bấm xuất lần hai" });
    expect(lai).toMatchObject({ ok: false, ma: "KHONG_CO_DONG_DE_XUAT" });
    expect(await soLo()).toBe(truoc + 1);

    // kỳ chưa khoá: một cơ sở khác chỉ ở RÀ SOÁT ⇒ QLCS của nó không xuất được
    const k3 = await kb("act05c");
    const ql3 = await nguoiKyQlcs(k3);
    await tienVe(k3, await dungBe(k3, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await denRaSoat(k3, ql3);
    expect(await xuatHanhDong(pt, { nguoi: ql3, now: NOW, thang: THANG, kind: "PAYROLL", lyDo })).toMatchObject({ ok: false, ma: "CHUA_CO_KY_KHOA" });
  });

  it("[NHH-KY-ACT-06] ĐÁNH DẤU ĐÃ CHI: cờ TẮT ⇒ từ chối, lô nguyên trạng; thiếu lý do ⇒ từ chối; đối chứng: bật + lý do ⇒ kỳ PAID; lần hai ⇒ LO_DA_CHI", async () => {
    const k = await kb("act06");
    const ql = await nguoiKyQlcs(k);
    await lamNhanVien(k.sale.id, "sale");
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    await khoaDuoc(k, ql, pt);
    const x = await xuatHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo: "xuất bảng lương tháng 10" });
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const batchId = x.xuat.batchId;

    expect(await danhDauDaChiHanhDong(phuThuoc(k, { xuat: false }), { nguoi: ql, now: NOW, batchId, lyDo: "đã chuyển khoản bảng lương" })).toMatchObject({ ok: false, ma: "XUAT_TAT" });
    expect(await danhDauDaChiHanhDong(pt, { nguoi: ql, now: NOW, batchId, lyDo: "ngắn" })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect((await db.commissionPayoutBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("EXPORTED");
    expect((await kyCua(k)).status).toBe("EXPORTED");

    expect(await danhDauDaChiHanhDong(pt, { nguoi: ql, now: NOW, batchId, lyDo: "đã chuyển khoản bảng lương" })).toMatchObject({ ok: true, soDong: 1, soKyPaid: 1 });
    expect((await kyCua(k)).status).toBe("PAID");
    expect(await danhDauDaChiHanhDong(pt, { nguoi: ql, now: NOW, batchId, lyDo: "đánh dấu lần hai" })).toMatchObject({ ok: false, ma: "LO_DA_CHI" });
  });

  it("[NHH-KY-ACT-07] SỐ trên màn: cơ sở tính cộng theo Ô (không nhân theo số vai), hoa hồng/điều chỉnh/số người đúng; hàng chờ chặn = ĐÚNG phép đếm của cổng khoá, tách theo mã; mã mềm không chặn", async () => {
    const k = await kb("act07", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    const ql = await nguoiKyQlcs(k);
    const id = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    expect((await tinhKyHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, centerId: k.centerId })).ok).toBe(true);
    const ky = await kyCua(k);

    const t1 = (await tongHopTheoKy([ky.id])).get(ky.id)!;
    // Hai vai × hai người nhưng MỘT ô: cơ sở tính là 10.000.000 (không 20.000.000).
    expect(t1).toMatchObject({ coSoTinh: 10_000_000, hoaHong: 500_000, dieuChinh: 0, soNguoi: 2, soChan: 0 });

    // Hoàn 4tr cùng tháng ⇒ dòng đảo vào CÙNG kỳ (còn mở): điều chỉnh −200.000, tổng ròng 300.000; cơ sở tính KHÔNG đổi (là cơ sở của khoản MỚI ghi).
    const hoan = await hoanTien(k, id, { soTien: 4_000_000, ngay: D("2026-10-20") });
    await quetKhoan(db, await boiCanh(k, NOW), hoan);
    const t2 = (await tongHopTheoKy([ky.id])).get(ky.id)!;
    expect(t2).toMatchObject({ coSoTinh: 10_000_000, hoaHong: 500_000, dieuChinh: -200_000, soNguoi: 2 });
    expect(t2.hoaHong + t2.dieuChinh).toBe(300_000);

    // Hàng chờ: 2 chờ duyệt tay + 1 vượt trần (CHẶN) · 1 vai treo (MỀM, không chặn) · 1 đã đóng (không tính).
    const mk = (suffix: string, code: "MANUAL_REVIEW_REQUIRED" | "CAP_EXCEEDED" | "UNRESOLVED_BENEFICIARY", p: { chan: boolean; dong?: boolean }) =>
      db.commissionHold.create({
        data: {
          holdKey: `${k.ma}:${suffix}`,
          code,
          severity: code === "UNRESOLVED_BENEFICIARY" ? "SOFT" : "HARD",
          status: p.dong ? "RESOLVED" : "OPEN",
          paymentId: id,
          centerId: k.centerId,
          blockingPeriodId: p.chan ? ky.id : null,
          detail: { lyDo: "fixture" },
        },
      });
    await mk("m1", "MANUAL_REVIEW_REQUIRED", { chan: true });
    await mk("m2", "MANUAL_REVIEW_REQUIRED", { chan: true });
    await mk("c1", "CAP_EXCEEDED", { chan: true });
    await mk("t1", "UNRESOLVED_BENEFICIARY", { chan: false });
    await mk("d1", "MANUAL_REVIEW_REQUIRED", { chan: true, dong: true });

    // Cơ sở KHÁC cũng có hàng chờ chặn + hàng chờ treo: số của cơ sở này KHÔNG được cộng chúng.
    const k2 = await kb("act07x");
    const ql2 = await nguoiKyQlcs(k2);
    await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect((await tinhKyHanhDong(phuThuoc(k2), { nguoi: ql2, now: NOW, thang: THANG, centerId: k2.centerId })).ok).toBe(true);
    const ky2 = await kyCua(k2);
    await db.commissionHold.create({ data: { holdKey: `${k2.ma}:chan`, code: "CAP_EXCEEDED", severity: "HARD", status: "OPEN", blockingPeriodId: ky2.id, centerId: k2.centerId, detail: { lyDo: "fixture" } } });
    await db.commissionHold.create({ data: { holdKey: `${k2.ma}:treo`, code: "UNRESOLVED_BENEFICIARY", severity: "SOFT", status: "OPEN", centerId: k2.centerId, detail: { lyDo: "fixture" } } });

    const man = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
    expect(man.soLieu.soChan).toBe(3);
    expect(man.soLieu.soChan).toBe(await demHangChoChan(db, ky.id)); // MỘT phép đếm với cổng khoá
    expect(man.chanTheoMa).toEqual({ MANUAL_REVIEW_REQUIRED: 2, CAP_EXCEEDED: 1 });
    expect(man.treo).toBe(1);
    // Hội sở thấy MỌI cơ sở — bộ lọc `centerId` của chính phép đếm mới giữ số này đúng (tầm nhìn scope không làm hộ).
    expect((await docManHinhKy((await nguoiKyHo()).quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" })).treo).toBe(1);
    expect(cauChanKhoa(gomChan(man.chanTheoMa))).toBe("2 khoản chờ duyệt tay · 1 khoản vượt trần");

    // Pill tab Kỳ = hàng chờ CHẶN của các kỳ CHƯA khoá trong tầm nhìn: mỗi QLCS chỉ thấy số của cơ sở mình…
    expect(await demHangChoChanTheoTamNhin(ql.quyen)).toBe(3);
    expect(await demHangChoChanTheoTamNhin(ql2.quyen)).toBe(1);
    // …và một kỳ ĐÃ KHOÁ không còn là việc chặn nữa (dù hàng chờ vẫn mở).
    await db.commissionPeriod.update({ where: { id: ky2.id }, data: { status: "LOCKED" } });
    expect(await demHangChoChanTheoTamNhin(ql2.quyen)).toBe(0);
  });

  it("[NHH-KY-ACT-08] CÔ LẬP CƠ SỞ khi ĐỌC: QLCS CS1 thấy kỳ CS1, KHÔNG thấy kỳ CS2 (cả danh sách lẫn kỳ đang chọn); Kế toán HO thấy cả hai; lọc trạng thái + phân trang ở truy vấn", async () => {
    const k1 = await kb("act08a");
    const k2 = await kb("act08b");
    const ql1 = await nguoiKyQlcs(k1);
    const ho = await nguoiKyHo();
    for (const k of [k1, k2]) await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await tinhKyHanhDong(phuThuoc(k1), { nguoi: ql1, now: NOW, thang: THANG, centerId: k1.centerId });
    await tinhKyHanhDong(phuThuoc(k2), { nguoi: ho, now: NOW, thang: THANG, centerId: k2.centerId });
    const ky1 = await kyCua(k1);
    const ky2 = await kyCua(k2);

    const dsQl = await docDanhSachKy(ql1.quyen, { trangThai: null, trang: 1 });
    expect(dsQl.dong.every((d) => d.centerId === k1.centerId)).toBe(true);
    expect(dsQl.dong.map((d) => d.id)).toContain(ky1.id);
    expect(dsQl.dong.map((d) => d.id)).not.toContain(ky2.id);
    expect(dsQl.tong).toBe(await db.commissionPeriod.count({ where: { centerId: k1.centerId } })); // tổng đếm cũng qua tầm nhìn
    // HO: thấy kỳ CS2 (đối chứng dương) — tìm đúng id ở mọi trang, vì DB test chứa kỳ của các bộ khác
    const dsHo = await docDanhSachKy(ho.quyen, { trangThai: null, trang: 1 });
    expect(dsHo.tong).toBeGreaterThanOrEqual(2);
    const dong2 = (await docDanhSachKy(ho.quyen, { trangThai: "CALCULATED", trang: 1 })).dong;
    expect(dong2.every((d) => d.status === "CALCULATED")).toBe(true);
    // Phân trang ở truy vấn: trang quá biên bị kẹp về trang cuối chứ không trả bảng rỗng
    const quaBien = await docDanhSachKy(ho.quyen, { trangThai: null, trang: 9999 });
    expect(quaBien.trang).toBe(quaBien.soTrang);
    expect(quaBien.dong.length).toBeGreaterThan(0);
    expect(dsHo.dong.length).toBeLessThanOrEqual(dsHo.coTrang);

    // Kỳ đang chọn: QLCS CS1 hỏi CS2 ⇒ rỗng, không lộ gì; HO hỏi ⇒ thấy
    const lenHo = await docManHinhKy(ho.quyen, { thang: THANG, centerId: k2.centerId, kyCutover: "2026-10" });
    expect(lenHo.ky?.id).toBe(ky2.id);
    expect(lenHo.soLieu.hoaHong).toBe(300_000);
    const lenQl = await docManHinhKy(ql1.quyen, { thang: THANG, centerId: k2.centerId, kyCutover: "2026-10" });
    expect(lenQl.ky).toBeNull();
    expect(lenQl.soLieu).toMatchObject({ hoaHong: 0, soNguoi: 0, soChan: 0 });
  });

  it("[NHH-KY-ACT-09] đầu vào đổi SAU lần Tính (đo trên DB thật): màn thấy mốc trôi và KHÔNG vẽ nút Chuyển rà soát; đối chứng: Tính sau thay đổi ⇒ vẽ", async () => {
    const k = await kb("act09");
    const ql = await nguoiKyQlcs(k);
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    // Tính với đồng hồ ở QUÁ KHỨ: mọi `updatedAt` của fixture (đồng hồ thật) đều MỚI HƠN lần Tính ⇒ đầu vào trôi.
    const quaKhu = D("2020-01-01");
    await tinhKyHanhDong(phuThuoc(k), { nguoi: ql, now: quaKhu, thang: THANG, centerId: k.centerId });
    const doc = async () => {
      const man = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
      return {
        man,
        h: hanhDongCuaKy({
          trangThai: man.ky!.status,
          truocMoc: false,
          coQuyenQuanLy: true,
          soChan: man.soLieu.soChan,
          lastCalculatedAt: man.ky!.lastCalculatedAt,
          dauVaoMoiNhat: man.dauVaoMoiNhat,
          cauChan: null,
          ngayTinhCuoi: null,
          xuatLuongBat: true,
          chuaXuat: man.chuaXuat,
          soLoChoChi: man.loChoChi.length,
        }),
      };
    };
    const troi = await doc();
    expect(troi.man.dauVaoMoiNhat!.getTime()).toBeGreaterThan(troi.man.ky!.lastCalculatedAt!.getTime());
    expect(troi.h.chinh).toBe("TINH_LAI");
    expect([troi.h.chinh, ...troi.h.phu]).not.toContain("CHUYEN_RA_SOAT");

    await tinhKyHanhDong(phuThuoc(k), { nguoi: ql, now: NOW, thang: THANG, centerId: k.centerId });
    const sach = await doc();
    expect(sach.h.chinh).toBe("CHUYEN_RA_SOAT");
    // và cổng server đồng ý với màn: nút vừa hiện thì bấm được
    expect(await chuyenRaSoatHanhDong(phuThuoc(k), { nguoi: ql, now: NOW, periodId: sach.man.ky!.id })).toMatchObject({ ok: true });
  });

  it("[NHH-KY-ACT-11] Payment sửa SAU lần Tính khi kỳ đang RÀ SOÁT: màn KHÔNG vẽ Khoá (nút chính là Trả lại), SERVER từ chối khoá dù bấm lén; đối chứng: Trả lại + Tính lại + rà soát ⇒ khoá được", async () => {
    const k = await kb("act11");
    const ql = await nguoiKyQlcs(k);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    expect((await tinhKyHanhDong(pt, { nguoi: ql, now: D("2027-02-18"), thang: THANG, centerId: k.centerId })).ok).toBe(true);
    const ky = await kyCua(k);
    expect(await chuyenRaSoatHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id })).toMatchObject({ ok: true });

    // Cổng KHOÁ (a) hàng chờ chặn = 0 — chỉ vế (b) "đầu vào đổi sau lần Tính" làm kỳ kẹt: Payment được sửa ngày 19/02, sau lần Tính 18/02.
    await db.payment.update({ where: { id }, data: { updatedAt: D("2027-02-19") } });
    const man = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
    expect(man.soLieu.soChan).toBe(0);
    expect(man.dauVaoMoiNhat!.getTime()).toBeGreaterThan(man.ky!.lastCalculatedAt!.getTime());
    const h = hanhDongCuaKy({
      trangThai: man.ky!.status,
      truocMoc: false,
      coQuyenQuanLy: true,
      soChan: man.soLieu.soChan,
      lastCalculatedAt: man.ky!.lastCalculatedAt,
      dauVaoMoiNhat: man.dauVaoMoiNhat,
      cauChan: null,
      ngayTinhCuoi: null,
      xuatLuongBat: true,
      chuaXuat: man.chuaXuat,
      soLoChoChi: man.loChoChi.length,
    });
    expect(h.chinh).toBe("TRA_LAI");
    expect([h.chinh, ...h.phu]).not.toContain("KHOA");
    expect(h.khongVe.find((x) => x.hanhDong === "KHOA")?.lyDo).toMatch(/đã đổi sau lần Tính/);

    const lyDo = "khoá kỳ 10 để chi lương";
    const daThay = (await chupSoLieuKy(ky.id))!;
    const bamLen = await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo, daThay });
    expect(bamLen).toMatchObject({ ok: false, ma: "KY_CHUYEN_KHONG_HOP_LE" });
    expect(bamLen.ok ? "" : bamLen.loi).toMatch(/đầu vào|đổi/i);
    expect((await kyCua(k)).status).toBe("REVIEWING");
    expect(await soAudit(ky.id, "LOCK")).toBe(0);

    expect(await traLaiHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo: "trả lại: khoản thu được sửa sau lần Tính" })).toMatchObject({ ok: true });
    expect(await tinhKyHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, centerId: k.centerId })).toMatchObject({ ok: true });
    expect(await chuyenRaSoatHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id })).toMatchObject({ ok: true });
    expect(await khoaHanhDong(pt, { nguoi: ql, now: NOW, periodId: ky.id, lyDo, daThay: (await chupSoLieuKy(ky.id))! })).toMatchObject({ ok: true });
    expect((await kyCua(k)).status).toBe("LOCKED");
  });

  it("[NHH-KY-ACT-10] phần CHI TRẢ của màn: kỳ khoá ⇒ chuaXuat/phamViXuat đúng và chỉ gồm kỳ trong tầm nhìn; sau Xuất ⇒ hiện lô chờ chi, chuaXuat về 0; sau Đánh dấu ⇒ hết lô", async () => {
    const k = await kb("act10");
    const kx = await kb("act10x");
    const ql = await nguoiKyQlcs(k);
    await lamNhanVien(k.sale.id, "sale");
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await tienVe(kx, await dungBe(kx, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const pt = phuThuoc(k);
    await khoaDuoc(k, ql, pt);
    await khoaDuoc(kx, await nguoiKyQlcs(kx)); // kỳ CS khác cũng đã khoá — KHÔNG được lọt vào tầm nhìn/lô của QLCS này

    const khoa = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
    expect(khoa.ky!.status).toBe("LOCKED");
    expect(khoa.chuaXuat).toEqual({ noiBo: 1, ngoai: 0 });
    expect(khoa.phamViXuat).toHaveLength(1);
    expect(khoa.phamViXuat[0]).toMatchObject({ status: "LOCKED", soDongNoiBo: 1, tienNoiBo: 300_000, soDongNgoai: 0 });
    expect(khoa.loChoChi).toEqual([]);
    expect(khoa.soKyChuaKhoa).toBe(0); // kỳ duy nhất trong tầm nhìn đã khoá

    const x = await xuatHanhDong(pt, { nguoi: ql, now: NOW, thang: THANG, kind: "PAYROLL", lyDo: "xuất bảng lương tháng 10" });
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const xong = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
    expect(xong.ky!.status).toBe("EXPORTED");
    expect(xong.chuaXuat).toEqual({ noiBo: 0, ngoai: 0 });
    expect(xong.loChoChi).toMatchObject([{ id: x.xuat.batchId, kind: "PAYROLL", soDong: 1, tongTien: 300_000 }]);

    await danhDauDaChiHanhDong(pt, { nguoi: ql, now: NOW, batchId: x.xuat.batchId, lyDo: "đã chuyển khoản bảng lương" });
    const paid = await docManHinhKy(ql.quyen, { thang: THANG, centerId: k.centerId, kyCutover: "2026-10" });
    expect(paid.ky!.status).toBe("PAID");
    expect(paid.loChoChi).toEqual([]);
    expect(paid.soKyChuaKhoa).toBe(0); // kỳ ĐÃ CHI không phải "kỳ chưa khoá" (bản đầu đếm mọi kỳ không LOCKED/EXPORTED ⇒ báo thừa 1 kỳ ở màn xuất)
  });
});
