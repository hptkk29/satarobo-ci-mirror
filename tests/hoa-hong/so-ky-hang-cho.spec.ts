// @vitest-environment node
/**
 * [NHH-PER-*] / [NHH-COM-07/09/10/11/13/14/17] / [NHH-TRX-08/09] / [NHH-SEC-04..08] — KỲ · HÀNG CHỜ · Ô TÍNH · QUYỀN ĐỌC SỔ,
 * trên Postgres THẬT (04 §10.5, §12; 02 §9.6, §11.1; 05 AC-PER, AC-SEC).
 *
 * Dòng tiền dựng bằng HÀM GHI THẬT (xem `_kich-ban.ts`); thay đổi đầu vào (đổi người chốt, bỏ gắn khoản, thêm người phụ trách)
 * dựng bằng chính hàm thật của repo khi có (`boGanKhoanKhoiCon`, `chuyenTienGiuaCon`, `refundPayment`…).
 *
 * ⚠️ Cổng khoá kỳ so DẤU THỜI GIAN CỦA DB (`updatedAt` = `now()` thật) với `lastCalculatedAt` ⇒ các ca về cổng khoá truyền `now` = đồng hồ THẬT
 * ngay sau khi dựng fixture (luật 19 bất khả thi ở đúng chỗ này: thứ được so là dấu thời gian do chính Postgres đóng).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Trần thời gian của bộ: mặc định 5s là trần của máy nhanh + DB mới tinh. DB test TÍCH khoản qua các lượt chạy (sổ bất biến không dọn được) và các ca quét toàn hệ
// chậm dần theo đó — đo 08/10: cùng mã, lượt 1 đỏ vì timeout, lượt 2 xanh. Nâng trần ở ĐÚNG bộ này, không phải toàn repo.
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { boGanKhoanKhoiCon, chuyenTienGiuaCon, ganKhoanDaThuChoCon } from "../../lib/finance/ghi-tien-don";
import { chayTrongKhoa } from "../../lib/hoa-hong/ghi-so";
import { dongHangChoDaHetCan, ghiHangCho } from "../../lib/hoa-hong/hang-cho";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import type { NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { chuyenRaSoat, doiHangChoSangKySau, demHangChoChan, khoaKyHoaHong, tinhKy, traLaiKy } from "../../lib/hoa-hong/ky-service";
import { docSoHoaHong, duKienCuaToi } from "../../lib/hoa-hong/doc-so";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docTapQuet, doiSoatNen, quetKy } from "../../lib/hoa-hong/quet-ky";
import {
  actorCua,
  boiCanh,
  D,
  datMocCutover,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganVai,
  donViHoiSo,
  hoanTien,
  donKichBan,
  taoChinhSachFx,
  nguoiKyHo,
  themGvTrial,
  tienVe,
  tuChoi,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-PER] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const NOW_NEN = D("2026-11-20");
let NGUOI: NguoiThaoTacKy;
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
const kyCua = (k: KichBan, thang: string) => db.commissionPeriod.findFirstOrThrow({ where: { period: thang, centerId: k.centerId } });

describe.skipIf(!RUN_DB_TESTS)("[NHH-PER] kỳ · hàng chờ · ô tính · quyền đọc", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  // ── Kỳ theo giờ VN, khoản đến muộn, H22 ─────────────────────────────────────────────────────

  it("[NHH-COM-14] kỳ theo paidDate GIỜ VN: 23:30 +07 ngày cuối tháng 10 là kỳ 10; 00:30 +07 ngày 01/11 là kỳ 11", async () => {
    const k = await kb("com14", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a", { tongTien: 20_000_000 });
    const a = await tienVe(k, be, { soTien: 1_000_000, ngay: new Date("2026-10-31T16:30:00.000Z") }); // 23:30 +07, 31/10
    const b = await tienVe(k, be, { soTien: 1_000_000, ngay: new Date("2026-10-31T17:30:00.000Z") }); // 00:30 +07, 01/11
    expect(await quetKhoan(db, bc, a)).toMatchObject({ loai: "DA_GHI", kyGhi: "2026-10" });
    expect(await quetKhoan(db, bc, b)).toMatchObject({ loai: "DA_GHI", kyGhi: "2026-11" });
    expect((await dongSoCuaKhoan(a))[0]!.naturalPeriod).toBe("2026-10");
    expect((await dongSoCuaKhoan(b))[0]!.naturalPeriod).toBe("2026-11");
  });

  it("[NHH-COM-14b]/[NHH-COM-07] kỳ hiệu lực đã qua RÀ SOÁT/KHOÁ ⇒ khoản đến muộn vào kỳ OPEN kế tiếp: LATE_ARRIVAL, giữ naturalPeriod, KHÔNG mở lại kỳ cũ (H22)", async () => {
    const k = await kb("com14b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const be = await dungBe(k, "a", { tongTien: 30_000_000 });
    const dau = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, dau);
    const ky10 = await kyCua(k, "2026-10");
    await tinhKy(db, bc, { periodId: ky10.id, soThangDoiSoat: 3, actor: NGUOI });
    await chuyenRaSoat(db, { periodId: ky10.id, actor: NGUOI, now: new Date() });
    await khoaKyHoaHong(db, { periodId: ky10.id, actor: NGUOI, now: new Date(), lyDo: "khoá kỳ 10 để chi lương" });
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");

    // khoản thu của tháng 10 nhưng kế toán xác nhận SAU khi kỳ đã khoá
    const muon = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-20") });
    const r = await quetKhoan(db, bc, muon);
    expect(r).toMatchObject({ loai: "DA_GHI", kyGhi: "2026-11", lateArrival: true, tong: 300_000 });
    const d = (await dongSoCuaKhoan(muon))[0]!;
    expect(d).toMatchObject({ entryKind: "LATE_ARRIVAL", naturalPeriod: "2026-10", lateArrival: true, reasonCode: "KY_GOC_DA_DONG", refEventType: "PAYMENT", refEventId: muon });
    // kỳ 10 vẫn LOCKED và KHÔNG nhận thêm dòng nào
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");
    expect(await db.commissionTransaction.count({ where: { periodId: ky10.id } })).toBe(1);
    // có audit giải thích
    expect(await db.auditLog.count({ where: { module: "hoa-hong", action: "LATE_ARRIVAL", entityType: "CommissionCalcSlot" } })).toBeGreaterThan(0);
  });

  it("[NHH-COM-07] hoàn tiền khi kỳ của ngày hoàn đã LOCKED ⇒ REVERSAL vào kỳ OPEN kế tiếp, tham chiếu dòng gốc, kỳ cũ không mở lại", async () => {
    const k = await kb("com07", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const be = await dungBe(k, "a");
    const goc = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, goc);
    const ky10 = await kyCua(k, "2026-10");
    await tinhKy(db, bc, { periodId: ky10.id, soThangDoiSoat: 3, actor: NGUOI });
    await chuyenRaSoat(db, { periodId: ky10.id, actor: NGUOI, now: new Date() });
    await khoaKyHoaHong(db, { periodId: ky10.id, actor: NGUOI, now: new Date(), lyDo: "khoá kỳ 10 để chi lương" });

    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-10-25") }); // hoàn ghi ngày thuộc kỳ ĐÃ KHOÁ
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO", tong: -120_000, kyGhi: "2026-11", lateArrival: true });
    const dao = (await dongSoCuaKhoan(hoan))[0]!;
    expect(dao).toMatchObject({ entryKind: "REVERSAL", naturalPeriod: "2026-10", lateArrival: true });
    expect(dao.refEntryId).toBe((await dongSoCuaKhoan(goc))[0]!.id);
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");
    expect(await db.commissionTransaction.count({ where: { periodId: ky10.id } })).toBe(1);
  });

  it("[NHH-PER-03b] khoản thuộc kỳ TRƯỚC mốc: không có kỳ cũ ⇒ engine CŨ lo (0 dòng); kỳ cũ APPROVED mà không có manifest ⇒ MANUAL_REVIEW_REQUIRED; engine mới KHÔNG tạo kỳ < mốc", async () => {
    const k = await kb("per03b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    const truocMoc = await tienVe(k, be, { soTien: 5_000_000, ngay: D("2026-09-15") });
    expect(await quetKhoan(db, bc, truocMoc)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" });
    expect(await dongSoCuaKhoan(truocMoc)).toEqual([]);

    // Kỳ cũ 2026-09 đã DUYỆT, repo CHƯA có manifest (PR0m) ⇒ không quyết được chủ ⇒ giữ, không đoán.
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "APPROVED" }, create: { period: "2026-09", status: "APPROVED" } });
    try {
      const khac = await tienVe(k, be, { soTien: 5_000_000, ngay: D("2026-09-16") });
      expect(await quetKhoan(db, bc, khac)).toMatchObject({ loai: "GIU", hangCho: ["MANUAL_REVIEW_REQUIRED"] });
      expect(await dongSoCuaKhoan(khac)).toEqual([]);
    } finally {
      await db.commissionStatement.update({ where: { period: "2026-09" }, data: { status: "DRAFT" } }).catch(() => undefined);
    }
    expect(await db.commissionPeriod.count({ where: { centerId: k.centerId, period: { lt: "2026-10" } } })).toBe(0);
  });

  it("[NHH-PER-02b] khoaKyDeGhi từ chối kỳ TRƯỚC mốc cutover (KY_TRUOC_MOC) dù kỳ ấy còn OPEN — engine mới không ghi kỳ cũ; đối chứng: kỳ đúng mốc khoá được", async () => {
    const k = await kb("per02b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const dv = await db.orgUnit.findFirstOrThrow({ where: { id: `${k.ma}-ou` }, select: { id: true } });
    const kyCu = await db.commissionPeriod.create({ data: { period: "2026-08", centerId: k.centerId, orgUnitId: dv.id, status: "OPEN" } });
    const kyDung = await db.commissionPeriod.create({ data: { period: "2026-10", centerId: k.centerId, orgUnitId: dv.id, status: "OPEN" } });
    const loi = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        return e instanceof HoaHongError ? e.ma : `LA:${String(e)}`;
      }
      return null;
    };
    expect(await loi(() => chayTrongKhoa(db, { khoaKhoan: ["khoa-truoc-moc"], kyCutoverDaDoc: "2026-10" }, (h) => h.khoaKyDeGhi([kyCu.id])))).toBe("KY_TRUOC_MOC");
    expect(await loi(() => chayTrongKhoa(db, { khoaKhoan: ["khoa-truoc-moc"], kyCutoverDaDoc: "2026-10" }, (h) => h.khoaKyDeGhi([kyDung.id])))).toBeNull();
  });

  it("[NHH-PER-02] kỳ LOCKED không nhận dòng: cổng ghiSo ném KY_DA_DONG; ghiDong khi chưa khoá kỳ ném KY_CHUA_KHOA", async () => {
    const k = await kb("per02", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const be = await dungBe(k, "a");
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date()); // SAU fixture: lastCalculatedAt phải ≥ mọi updatedAt của đầu vào
    await quetKhoan(db, bc, id);
    const ky = await kyCua(k, "2026-10");
    await tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
    await chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() });
    await khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "khoá kỳ 10 để chi lương" });

    const loi = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        return e instanceof HoaHongError ? e.ma : `LA:${String(e)}`;
      }
      return null;
    };
    expect(await loi(() => chayTrongKhoa(db, { khoaKhoan: [id], kyCutoverDaDoc: "2026-10" }, (h) => h.khoaKyDeGhi([ky.id])))).toBe("KY_DA_DONG");
    const goc = (await dongSoCuaKhoan(id))[0]! as unknown as Record<string, unknown>;
    expect(await loi(() => chayTrongKhoa(db, { khoaKhoan: [id], kyCutoverDaDoc: "2026-10" }, (h) => h.ghiDong([{ ...goc, id: undefined, idempotencyKey: "x", periodId: ky.id } as never])))).toBe("KY_CHUA_KHOA");
    // mốc đổi giữa lúc nạp và lúc ghi ⇒ dừng
    expect(await loi(() => chayTrongKhoa(db, { khoaKhoan: [id], kyCutoverDaDoc: "2026-09" }, async () => 1))).toBe("MOC_DA_DOI");
    // trigger DB là lớp dưới cùng: INSERT thẳng vào kỳ LOCKED bị chặn dù đi vòng qua cổng ứng dụng
    await expect(db.commissionTransaction.create({ data: { ...goc, id: undefined, idempotencyKey: "vong-cong", periodId: ky.id } as never })).rejects.toThrow(/không ghi thêm dòng sổ/);
    // Tính lại kỳ ĐÃ KHOÁ bị từ chối NGAY ở cổng chuyển trạng thái. Cấy 08/10: bỏ cổng ⇒ 0 ca đỏ — vẫn bị chặn, nhưng muộn (sau khi đã quét cả kỳ) và bằng mã KY_DA_DONG.
    expect(await loi(() => tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI }))).toBe("KY_CHUYEN_KHONG_HOP_LE");
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");
  });

  // ── Hàng chờ ────────────────────────────────────────────────────────────────────────────────

  // Cấy 08/10: bỏ lọc `idempotencyKey` đã có trong `ghiDong` (luôn `createMany`) ⇒ 0 ca đỏ — mọi đường thật đều đã chặn lượt ghi thứ hai ở nơi khác
  // (ô tính, `KHONG_CO_GI_DE_DAO`…), nên lớp phòng thứ hai này chưa từng được chạm. Ca này gọi THẲNG cổng với khoá đã tồn tại.
  it("[NHH-GS-01] ghiDong IDEMPOTENT: dòng có idempotencyKey ĐÃ CÓ không bị ghi lại (daGhi = 0), được trả trong `trung` kèm hash cũ/mới để người gọi so; số dòng sổ không đổi", async () => {
    const k = await kb("gs01", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, await boiCanh(k, new Date()), id);
    const truoc = await dongSoCuaKhoan(id);
    expect(truoc.length).toBeGreaterThan(0);
    const goc = truoc[0]! as unknown as Record<string, unknown>;
    const ky = await kyCua(k, "2026-10");
    const r = await chayTrongKhoa(db, { khoaKhoan: [id], kyCutoverDaDoc: "2026-10" }, async (h) => {
      await h.khoaKyDeGhi([ky.id]);
      return h.ghiDong([{ ...goc, id: undefined, inputHash: "hash-moi" } as never]);
    });
    expect(r.daGhi).toBe(0);
    expect(r.trung).toEqual([{ idempotencyKey: goc.idempotencyKey, hashCu: goc.inputHash, hashMoi: "hash-moi" }]);
    expect((await dongSoCuaKhoan(id)).length).toBe(truoc.length);
  });

  // Cấy 08/10 (vòng 4): bỏ `ON CONFLICT … DO NOTHING` của `taoO` ⇒ chỉ MỘT ca đỏ (khoá advisory theo khoản đã tuần tự hoá mọi đường thật) — tức nó là lớp phòng thứ hai
  // chưa từng được chạm. Ca này cho hai lượt giữ HAI khoá advisory KHÁC NHAU (khoan-a / khoan-b) cùng tạo MỘT ô: lượt thua phải nhận `null`, không ném P2002.
  it("[NHH-GS-02] taoO ĐUA không qua khoá khoản: hai lượt cùng tạo MỘT ô ⇒ đúng một lượt nhận id, lượt kia nhận null (ON CONFLICT DO NOTHING), đúng MỘT ô trong DB, không lượt nào ném", async () => {
    const k = await kb("gs02", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    const slot = { paymentId: id, orderItemKey: `${k.ma}-oi`, revenueComponent: "TUITION" as const, netBase: 10_000_000, firstInputHash: "h-gs02", originalLineCount: 1, centerId: k.centerId, orgUnitId: k.ouId };
    const tao = (khoa: string) => chayTrongKhoa(db, { khoaKhoan: [khoa], kyCutoverDaDoc: "2026-10" }, (h) => h.taoO([slot]));
    const kq = await Promise.all([tao(`${k.ma}-khoa-a`), tao(`${k.ma}-khoa-b`)]);
    expect(kq.filter((x) => x !== null)).toHaveLength(1);
    expect(kq.filter((x) => x === null)).toHaveLength(1);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id } })).toBe(1);
  });

  // Cấy 08/10 (vòng 4): bỏ `code: { not: "NEGATIVE_BALANCE" }` của `dongHangChoDaHetCan` ⇒ 0 ca đỏ. NEGATIVE_BALANCE thuộc bước XUẤT (nợ âm cuốn kỳ sau), không phải thứ lượt quét
  // tự nhìn thấy điều kiện biến mất; lượt quét đóng nó là xoá một khoản NỢ của người hưởng khỏi hàng chờ.
  it("[NHH-HC-03] lượt quét ĐÓNG hàng chờ do chính nó sinh khi điều kiện hết, nhưng KHÔNG đóng NEGATIVE_BALANCE (thuộc bước xuất); hàng chờ đã đóng ghi lý do tự động", async () => {
    const k = await kb("hc03", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    const nhap = (code: "CHO_HOC_VIEN" | "NEGATIVE_BALANCE") => ({
      holdKey: `HC03:${code}:${k.ma}`,
      code,
      paymentId: id,
      orderId: null,
      orderItemId: null,
      studentId: null,
      entryId: null,
      calcSlotId: null,
      blockingPeriodId: null,
      centerId: k.centerId,
      orgUnitId: k.ouId,
      detail: {},
    });
    await db.$transaction(async (tx) => {
      await ghiHangCho(tx, nhap("CHO_HOC_VIEN"), new Date());
      await ghiHangCho(tx, nhap("NEGATIVE_BALANCE"), new Date());
    });
    const dong = await db.$transaction((tx) => dongHangChoDaHetCan(tx, id, new Set<string>(), new Date("2026-11-20T03:00:00.000Z")));
    expect(dong).toBe(1);
    const cho = await db.commissionHold.findUniqueOrThrow({ where: { holdKey: `HC03:CHO_HOC_VIEN:${k.ma}` } });
    expect(cho).toMatchObject({ status: "RESOLVED" });
    expect(cho.resolutionNote).toMatch(/Tự đóng/);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { holdKey: `HC03:NEGATIVE_BALANCE:${k.ma}` } })).status).toBe("OPEN");
    // và hàng chờ còn trong `conGiu` thì KHÔNG bị đóng
    const lai = await db.$transaction((tx) => dongHangChoDaHetCan(tx, id, new Set<string>([`HC03:NEGATIVE_BALANCE:${k.ma}`]), new Date()));
    expect(lai).toBe(0);
  });

  // Cấy 08/10: bỏ nhánh `DISMISSED` của `ghiHangCho` ⇒ 0 ca đỏ. "Giữ nguyên kèm lý do" là quyết định CỦA NGƯỜI DUYỆT; nếu lượt quét sau mở lại và ghi đè
  // thì người duyệt phải bấm lại mỗi đêm và lý do họ để lại bị xoá.
  it("[NHH-HC-02] hàng chờ đã 'giữ nguyên' (DISMISSED) KHÔNG bị lượt ghi sau mở lại hay ghi đè; đối chứng: hàng chờ RESOLVED thì mở lại được (04 §10.5)", async () => {
    const k = await kb("hc02", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const holdKey = `HC02:${k.ma}`;
    const nhap = (lan: number) => ({
      holdKey,
      code: "CHO_HOC_VIEN" as const,
      paymentId: null,
      orderId: null,
      orderItemId: null,
      studentId: null,
      entryId: null,
      calcSlotId: null,
      blockingPeriodId: null,
      centerId: k.centerId,
      orgUnitId: k.ouId,
      detail: { lan },
    });
    const ghi = (lan: number) => db.$transaction((tx) => ghiHangCho(tx, nhap(lan), new Date()));
    await ghi(1);
    await db.commissionHold.update({ where: { holdKey }, data: { status: "DISMISSED" } });
    await ghi(2);
    const sau = await db.commissionHold.findUniqueOrThrow({ where: { holdKey } });
    expect(sau.status).toBe("DISMISSED");
    expect(sau.detail).toEqual({ lan: 1 });
    // đối chứng dương: RESOLVED (tự giải, điều kiện quay lại) ⇒ MỞ LẠI và cập nhật chi tiết
    await db.commissionHold.update({ where: { holdKey }, data: { status: "RESOLVED" } });
    await ghi(3);
    const lai = await db.commissionHold.findUniqueOrThrow({ where: { holdKey } });
    expect(lai.status).toBe("OPEN");
    expect(lai.detail).toEqual({ lan: 3 });
  });

  it("[NHH-TRX-08] đơn KHÔNG lead ⇒ SALE/SALE_ADMIN treo: 0 dòng cho hai vai đó + hàng chờ mềm UNRESOLVED_BENEFICIARY (blockingPeriodId NULL); vai khác vẫn sinh dòng", async () => {
    const k = await kb("trx08", { coLead: false });
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a", { coLead: false }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const r = await quetKhoan(db, bc, id);
    expect(r).toMatchObject({ loai: "DA_GHI", soDong: 2, treo: 2 }); // QLCS 2% + QC 1%; treo SALE + SALE_ADMIN
    expect((await dongSoCuaKhoan(id)).map((d) => d.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING"]);
    const holds = await db.commissionHold.findMany({ where: { paymentId: id }, orderBy: { holdKey: "asc" } });
    expect(holds.map((h) => [h.code, h.severity, h.status, h.blockingPeriodId])).toEqual([
      ["UNRESOLVED_BENEFICIARY", "SOFT", "OPEN", null],
      ["UNRESOLVED_BENEFICIARY", "SOFT", "OPEN", null],
    ]);
    expect((holds[0]!.detail as { lyDo: string }).lyDo).toBe("KHONG_CO_LEAD");
  });

  it("[NHH-TRX-08b] kỳ chỉ có hàng chờ TREO ⇒ KHOÁ ĐƯỢC (treo không chặn khoá); hàng chờ chặn thì không", async () => {
    const k = await kb("trx08b", { coLead: false });
    const id = await tienVe(k, await dungBe(k, "a", { coLead: false }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, id);
    const ky = await kyCua(k, "2026-10");
    expect(await demHangChoChan(db, ky.id)).toBe(0);
    await tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
    await chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() });
    await khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "kỳ chỉ có hàng chờ treo" });
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");
  });

  it("[NHH-PER-09] CHO_HOC_VIEN tự giải: khoản gắn dòng chưa có học viên ⇒ hàng chờ mềm; có Student (đường convert không chạm Payment.updatedAt) ⇒ lượt quét sau sinh dòng, hàng chờ đóng, lượt 3 không ghi thêm", async () => {
    const k = await kb("per09", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    // gỡ học viên khỏi dòng + ghi danh: hình dạng "đơn tạo trước convert" (schema:6735 — 18 đơn / 24 khoản trên prod 16/09)
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await db.orderItem.update({ where: { id: be.orderItemId }, data: { studentId: null, enrollmentId: null } });
    await db.payment.update({ where: { id }, data: { enrollmentId: null } });

    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "GIU", hangCho: ["CHO_HOC_VIEN"] });
    expect(await dongSoCuaKhoan(id)).toEqual([]);
    const h = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "CHO_HOC_VIEN" } });
    expect(h).toMatchObject({ severity: "SOFT", status: "OPEN" });
    expect(h.blockingPeriodId).not.toBeNull(); // mềm nhưng CHẶN khoá kỳ (trừ khi dời kỳ)

    // convert tạo Student → gán cho dòng (KHÔNG đổi Payment.updatedAt)
    const antes = (await db.payment.findUniqueOrThrow({ where: { id } })).updatedAt;
    await db.orderItem.update({ where: { id: be.orderItemId }, data: { studentId: be.studentId } });
    expect((await db.payment.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(antes);

    // tập Q3 (khoản có hàng chờ OPEN) PHẢI nhặt được khoản này dù Payment.updatedAt không đổi
    const tap = await docTapQuet(db, bc, { thang: "2026-11", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(tap).toContain(id);
    const tong = await quetKy(db, bc, { thang: "2026-11", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(tong.loi).toEqual([]);
    expect((await dongSoCuaKhoan(id)).map((d) => d.amount)).toEqual([300_000]);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("RESOLVED");
    await quetKy(db, bc, { thang: "2026-11", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(await dongSoCuaKhoan(id)).toHaveLength(1);
  });

  it("[NHH-COM-13] chuyển tiền giữa hai bé (chuyenTienGiuaCon THẬT) ⇒ CẢ HAI vế vào hàng chờ cứng INTERNAL_TRANSFER, 0 dòng; hoa hồng đã ghi KHÔNG đổi", async () => {
    const k = await kb("com13", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const a = await dungBe(k, "a", { tongTien: 10_000_000 });
    const b = await dungBe(k, "b", { tongTien: 10_000_000, donSan: a.orderId });
    const gocA = await tienVe(k, a, { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, gocA);

    const r = await chuyenTienGiuaCon({ orderId: a.orderId, tuOrderItemId: a.orderItemId, denOrderItemId: b.orderItemId, soTien: 4_000_000, lyDo: "gắn nhầm bé", centerId: k.centerId, actor: { id: k.ketToanB.id, name: "kt" } });
    expect(r.ok).toBe(true);
    const cap = await db.payment.findMany({ where: { orderId: a.orderId, method: "chuyen-noi-bo" }, orderBy: { amount: "asc" } });
    expect(cap.map((x) => x.amount)).toEqual([-4_000_000, 4_000_000]);
    for (const x of cap) expect(await quetKhoan(db, bc, x.id)).toMatchObject({ loai: "GIU", hangCho: ["INTERNAL_TRANSFER"] });
    const holds = await db.commissionHold.findMany({ where: { paymentId: { in: cap.map((x) => x.id) } } });
    expect(holds.map((h) => [h.code, h.severity, h.status])).toEqual([["INTERNAL_TRANSFER", "HARD", "OPEN"], ["INTERNAL_TRANSFER", "HARD", "OPEN"]]);
    expect(holds.every((h) => h.blockingPeriodId !== null)).toBe(true);
    // KHÔNG tự đảo / tự tính: không có dòng nào cho hai vế, hoa hồng của khoản gốc giữ nguyên
    for (const x of cap) expect(await dongSoCuaKhoan(x.id)).toEqual([]);
    expect(await db.commissionTransaction.aggregate({ where: { paymentId: gocA }, _sum: { amount: true } })).toMatchObject({ _sum: { amount: 300_000 } });
  });

  // ── Ô tính: chặn TRẢ HAI LẦN sau khi đầu vào đổi (02 §9.6) ────────────────────────────────────

  it("[NHH-COM-17a] đổi Lead.convertedById sau lượt quét 1 ⇒ lượt 2: 0 ORIGINAL mới + ĐÚNG 1 hàng chờ INPUT_DRIFT (Sale cũ −, Sale mới +); đối chứng không đổi ⇒ không gì", async () => {
    const k = await kb("com17a", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    expect((await quetKhoan(db, bc, id)).loai).toBe("KHONG_DOI"); // đối chứng dương
    expect(await db.commissionHold.count({ where: { paymentId: id } })).toBe(0);

    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi` });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    const r = await quetKhoan(db, bc, id);
    expect(r).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    expect((await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "ORIGINAL")).toHaveLength(1); // 0 ORIGINAL mới
    const holds = await db.commissionHold.findMany({ where: { paymentId: id, code: "INPUT_DRIFT" } });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ severity: "HARD", status: "OPEN" });
    const chenh = (holds[0]!.detail as { chenh: { key: string; chenh: number }[] }).chenh.map((c) => [c.key.split("|")[2], c.chenh]);
    expect(chenh).toEqual(expect.arrayContaining([[k.sale.id, -300_000], [moi.id, 300_000]]));
    // lượt quét thứ ba: cùng hash ⇒ KHÔNG đẻ hàng chờ thứ hai
    await quetKhoan(db, bc, id);
    expect(await db.commissionHold.count({ where: { paymentId: id, code: "INPUT_DRIFT" } })).toBe(1);
  });

  it("[NHH-COM-17b] BỎ GẮN khoản khỏi bé rồi GẮN LẠI sang bé khác (hàm thật) ⇒ lượt quét sau KHÔNG ghi ORIGINAL cho bé mới; bé mới là RENEWAL (đã mua trước) ⇒ INPUT_DRIFT đòi lại", async () => {
    const k = await kb("com17b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const a = await dungBe(k, "a", { tongTien: 10_000_000 });
    const b = await dungBe(k, "b", { tongTien: 10_000_000, donSan: a.orderId });
    const id = await tienVe(k, a, { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    expect((await dongSoCuaKhoan(id))[0]!.amount).toBe(300_000);

    // bé B đã có một lần mua TRƯỚC (đơn khác, có tiền thật) ⇒ dòng của B là RENEWAL ⇒ không rule ⇒ kỳ vọng 0
    const cu = await dungBe(k, "b-cu", { tongTien: 5_000_000, ngayDon: D("2026-01-10") });
    await db.orderItem.update({ where: { id: cu.orderItemId }, data: { studentId: b.studentId } });
    await tienVe(k, cu, { soTien: 5_000_000, ngay: D("2026-01-12") });

    expect((await boGanKhoanKhoiCon({ orderId: a.orderId, paymentId: id, lyDo: "gắn nhầm bé", actor: { id: k.ketToanB.id, name: "kt" } })).ok).toBe(true);
    expect((await ganKhoanDaThuChoCon({ orderId: a.orderId, paymentId: id, orderItemId: b.orderItemId, actor: { id: k.ketToanB.id, name: "kt" } })).ok).toBe(true);

    const r = await quetKhoan(db, bc, id);
    expect(r).toMatchObject({ loai: "TROI" });
    expect((await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "ORIGINAL")).toHaveLength(1);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id } })).toBe(1); // KHÔNG đẻ ô thứ hai cho (khoản × bé B)
    expect(await db.commissionHold.count({ where: { paymentId: id, code: "INPUT_DRIFT" } })).toBe(1);
  });

  it("[NHH-COM-17c] thêm người QC hồi tố (chiaDeuTien chia theo TẬP người) ⇒ KHÔNG ghi thêm dòng cho người mới và KHÔNG giảm người cũ; INPUT_DRIFT", async () => {
    const k = await kb("com17c", { rules: [{ vai: "MARKETING", rate: 0.01 }] });
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    expect(await dongSoCuaKhoan(id)).toHaveLength(1);
    await db.centerCommissionAssignee.create({ data: { centerId: k.centerId, role: "QC", userId: k.qc2.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: k.ma } });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "TROI" });
    expect(await dongSoCuaKhoan(id)).toHaveLength(1);
    expect((await dongSoCuaKhoan(id))[0]!.amount).toBe(100_000);
    expect(await db.commissionHold.count({ where: { paymentId: id, code: "INPUT_DRIFT" } })).toBe(1);
  });

  it("[NHH-COM-17d] chính sách đổi sang EXCLUDE (version mới, lỗi cấu hình) ⇒ INPUT_DRIFT với chênh −tiền; dòng cũ KHÔNG biến mất khỏi so sánh", async () => {
    const k = await kb("com17d", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    const bc1 = await boiCanh(k, NOW);
    await quetKhoan(db, bc1, id);
    // Version 2: Sale EXCLUDE, hiệu lực từ ngày trước ngày thu (fixture cho phép — guardrail kích hoạt có bộ test riêng).
    await taoChinhSachFx(k.ma, [{ vai: "SALE", kieu: "EXCLUDE" }], 2, k.chinhSach.policyId, "2026-04-01T00:00:00.000Z");
    const bc2 = await boiCanh(k, NOW);
    const r = await quetKhoan(db, bc2, id);
    expect(r).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    const h = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT" } });
    expect((h.detail as { chenh: { chenh: number }[] }).chenh.map((c) => c.chenh)).toEqual([-300_000]);
    expect((await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "ORIGINAL")).toHaveLength(1);
  });

  it("[NHH-COM-17e] hạ trần xuống dưới tổng tỉ lệ (lỗi cấu hình) sau khi ô đã có tiền ⇒ INPUT_DRIFT mang mã lỗi gốc, KHÔNG tự cắt, dòng đã sinh giữ nguyên (D1: hạ trần không xoá dòng)", async () => {
    const k = await kb("com17e");
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    const tong = (await dongSoCuaKhoan(id)).reduce((s, d) => s + d.amount, 0);
    const bcThap = await boiCanh(k, NOW, "2026-10", { hoaHong: { ...bc.hoaHong, tranTongTiLe: 0.05 } });
    expect(await quetKhoan(db, bcThap, id)).toMatchObject({ loai: "TROI", lyDo: "LOI_CAU_HINH" });
    const h = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT" } });
    expect((h.detail as { loi: string }).loi).toBe("VUOT_TRAN");
    expect((await dongSoCuaKhoan(id)).reduce((s, d) => s + d.amount, 0)).toBe(tong);
  });

  // ── Cổng khoá kỳ (PER-08) ───────────────────────────────────────────────────────────────────

  it("[NHH-PER-08] khoá kỳ: (b) đầu vào đổi sau lần Tính ⇒ từ chối dù Payment.updatedAt không đổi; Tính lại ⇒ INPUT_DRIFT (hàng chờ CHẶN) ⇒ từ chối; giải xong ⇒ khoá được", async () => {
    const k = await kb("per08", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, id);
    const ky = await kyCua(k, "2026-10");
    await tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
    expect((await kyCua(k, "2026-10")).status).toBe("CALCULATED");

    // Lead.convertedById đổi — KHÔNG chạm Payment.updatedAt (đúng loại đầu vào mà cổng chỉ-so-Payment bị mù)
    const antes = (await db.payment.findUniqueOrThrow({ where: { id } })).updatedAt;
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi` });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    expect((await db.payment.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(antes);
    await expect(chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() })).rejects.toThrow(/Tính lại/);

    // Tính lại ⇒ phát hiện trôi ⇒ hàng chờ chặn
    const bc2 = await boiCanh(k, new Date());
    await tinhKy(db, bc2, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
    expect(await demHangChoChan(db, ky.id)).toBe(1);
    await chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() }); // đã Tính SAU thay đổi cuối ⇒ qua
    await expect(khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "thử khoá khi còn hàng chờ" })).rejects.toThrow(/hàng chờ/);

    // người duyệt chọn "giữ nguyên" (DISMISSED + lý do) ⇒ hash vào hashDaChapNhan ⇒ Tính lại không đẻ lại hàng chờ
    await db.commissionHold.updateMany({ where: { paymentId: id, code: "INPUT_DRIFT" }, data: { status: "DISMISSED", resolutionNote: "Giữ nguyên: người chốt mới đúng" } });
    await traLaiKy(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "trả lại để Tính lại sau khi giải hàng chờ" });
    const bc3 = await boiCanh(k, new Date());
    await tinhKy(db, bc3, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
    expect(await demHangChoChan(db, ky.id)).toBe(0);
    await chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() });
    await khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "đã giải hàng chờ, khoá kỳ" });
    expect((await kyCua(k, "2026-10")).status).toBe("LOCKED");
    // dòng của kỳ khoá đã APPROVED để chi
    expect((await dongSoCuaKhoan(id)).every((d) => d.payoutStatus === "APPROVED")).toBe(true);
  });

  it("[NHH-PER-08e] khoá bắt buộc LÝ DO ≥ 10 ký tự; không nhảy cóc (OPEN → khoá) ", async () => {
    const k = await kb("per08e", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, id);
    const ky = await kyCua(k, "2026-10");
    await expect(khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "ngắn" })).rejects.toThrow(/lý do/);
    await expect(khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "lý do đủ dài ở đây" })).rejects.toThrow(/REVIEWING/);
  });

  it("[NHH-PER-08f] 'Dời sang kỳ sau': hàng chờ chặn chuyển sang kỳ kế (lý do bắt buộc, có audit); KHÔNG xoá hàng chờ", async () => {
    const k = await kb("per08f", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, new Date());
    const id = await tienVe(k, await dungBe(k, "a", { coLead: false }), { soTien: 10_000_000, ngay: D("2026-10-12"), gan: false });
    await db.orderItem.updateMany({ where: { orderId: (await db.payment.findUniqueOrThrow({ where: { id } })).orderId }, data: { studentId: null, enrollmentId: null } });
    await db.payment.update({ where: { id }, data: { enrollmentId: null } });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "GIU" });
    const h = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id } });
    const ky10 = await kyCua(k, "2026-10");
    expect(h.blockingPeriodId).toBe(ky10.id);
    await expect(doiHangChoSangKySau(db, bc, { holdId: h.id, actor: NGUOI, now: new Date(), lyDo: "ngắn" })).rejects.toThrow(/lý do/);
    const r = await doiHangChoSangKySau(db, bc, { holdId: h.id, actor: NGUOI, now: new Date(), lyDo: "chờ văn bản của BGĐ, dời sang kỳ sau" });
    expect(r.kySau).toBe("2026-11");
    const sau = await db.commissionHold.findUniqueOrThrow({ where: { id: h.id } });
    expect(sau.status).toBe("OPEN");
    expect(sau.blockingPeriodId).toBe((await kyCua(k, "2026-11")).id);
    expect(await demHangChoChan(db, ky10.id)).toBe(0);
  });

  // ── Đối soát nền (PER-10) ───────────────────────────────────────────────────────────────────

  // Cấy 08/10: bỏ chống lùi của `lastCalculatedAt` ⇒ 0 ca đỏ. Lượt Tính bắt đầu đọc SỚM hơn nhưng xong SAU không được kéo mốc lùi lại: mốc lùi ⇒ cổng khoá (b) so với
  // một mốc CŨ ⇒ cho khoá trên số liệu đã đổi sau lần Tính mới nhất.
  it("[NHH-PER-08g] Tính KHÔNG lùi: lượt Tính bắt đầu đọc sớm hơn mà xong sau không đè `lastCalculatedAt` của lượt mới hơn", async () => {
    const k = await kb("per08g", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, await boiCanh(k, new Date()), id);
    const ky = await kyCua(k, "2026-10");
    const T1 = D("2026-11-01");
    const T2 = D("2026-12-01");
    await tinhKy(db, await boiCanh(k, T2), { periodId: ky.id, soThangDoiSoat: 0, actor: NGUOI });
    await tinhKy(db, await boiCanh(k, T1), { periodId: ky.id, soThangDoiSoat: 0, actor: NGUOI });
    expect((await kyCua(k, "2026-10")).lastCalculatedAt!.getTime()).toBe(T2.getTime());
  });

  // Cấy 08/10: bỏ cổng kỳ < mốc ở `quetKy` ⇒ 0 ca đỏ (kỳ cũ không tạo được nên `tinhKy` không bao giờ tới đây, chỉ lời gọi trực tiếp mới thấy).
  it("[NHH-PER-10d] quét kỳ TRƯỚC mốc cutover bị từ chối (KY_TRUOC_MOC) — engine mới không đụng kỳ cũ kể cả khi gọi trực tiếp; đối chứng: đúng mốc thì quét được", async () => {
    const k = await kb("per10d", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    await expect(quetKy(db, bc, { thang: "2026-09", centerId: k.centerId, soThangDoiSoat: 0 })).rejects.toMatchObject({ ma: "KY_TRUOC_MOC" });
    await expect(quetKy(db, bc, { thang: "2026-10", centerId: k.centerId, soThangDoiSoat: 0 })).resolves.toBeDefined();
  });

  // Cấy 08/10: Q2 (đến muộn) thành tập rỗng ⇒ 0 ca đỏ — hai ca đến muộn (COM-07/14b) gọi `quetKhoan` thẳng nên không đi qua tập quét.
  it("[NHH-PER-10e] Q2: khoản của kỳ tự nhiên TRƯỚC, CHƯA có ô (đến muộn sau mốc cutover) nằm trong tập quét của kỳ sau; đã có ô thì KHÔNG (đối chứng)", async () => {
    const k = await kb("per10e", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, new Date("2026-12-20T03:00:00.000Z"));
    const muon = await tienVe(k, await dungBe(k, "a"), { soTien: 5_000_000, ngay: D("2026-10-10") });
    const daCo = await tienVe(k, await dungBe(k, "b"), { soTien: 5_000_000, ngay: D("2026-10-11") });
    await quetKhoan(db, bc, daCo);
    const tap = await docTapQuet(db, bc, { thang: "2026-12", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(tap).toContain(muon);
    expect(tap).not.toContain(daCo);
  });

  // Q6 và Q4 chồng nhau (từ chối khoản làm `updatedAt` nhảy qua `lastCheckedAt` nên Q4 cũng thấy). Muốn chứng minh Q6 tự đứng được thì phải loại Q4: đẩy
  // `lastCheckedAt` của ô ra sau mọi `updatedAt`. Cấy 08/10: Q6 thành tập rỗng ⇒ 0 ca đỏ.
  it("[NHH-PER-10f] Q6 quét NGƯỢC: khoản đã có ô mà nay rời thực thu nằm trong tập quét dù Q4 không thấy — thiếu Q6 thì dòng gốc vẫn được chi", async () => {
    const k = await kb("per10f", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, new Date("2026-12-20T03:00:00.000Z"));
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 5_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, id);
    const tap = () => docTapQuet(db, bc, { thang: "2026-12", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(await tap()).not.toContain(id);
    await tuChoi(k, id);
    await db.$executeRaw`UPDATE "CommissionCalcSlot" SET "lastCheckedAt" = '2099-01-01T00:00:00Z' WHERE "paymentId" = ${id}`;
    expect(await tap()).toContain(id);
  });

  // Cấy 08/10: bỏ kiểm trạng thái OPEN ở `doiHangChoSangKySau` ⇒ 0 ca đỏ — vẫn bị chặn nhưng ở lớp sau, trong transaction, bằng mã khác (TRANG_THAI_DA_DOI).
  // Mã lỗi là thứ màn hình dịch thành câu cho người dùng nên "đỏ vì mã khác" cũng là hỏng.
  it("[NHH-PER-08i] 'Dời sang kỳ sau': hàng chờ ĐÃ ĐÓNG ⇒ HANG_CHO_KHONG_MO; hàng chờ KHÔNG chặn kỳ nào ⇒ HANG_CHO_KHONG_CHAN (đúng mã, không rơi vào lỗi chung)", async () => {
    const k = await kb("per08i", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, id);
    const ky = await kyCua(k, "2026-10");
    const dong = await db.commissionHold.create({ data: { holdKey: `${k.ma}:dong`, code: "MANUAL_REVIEW_REQUIRED", severity: "HARD", status: "RESOLVED", paymentId: id, blockingPeriodId: ky.id, detail: { lyDo: "fixture" } } });
    const mem = await db.commissionHold.create({ data: { holdKey: `${k.ma}:mem`, code: "UNRESOLVED_BENEFICIARY", severity: "SOFT", status: "OPEN", paymentId: id, detail: { lyDo: "fixture" } } });
    const ma = async (holdId: string): Promise<string | null> => {
      try {
        await doiHangChoSangKySau(db, bc, { holdId, actor: NGUOI, now: new Date(), lyDo: "chờ văn bản bổ sung" });
      } catch (e) {
        return e instanceof HoaHongError ? e.ma : `LA:${String(e)}`;
      }
      return null;
    };
    expect(await ma(dong.id)).toBe("HANG_CHO_KHONG_MO");
    expect(await ma(mem.id)).toBe("HANG_CHO_KHONG_CHAN");
  });

  it("[NHH-PER-10a] tập quét: Q5 chỉ với soThangDoiSoat > 0 — khoản có ô của 2 tháng trước nằm trong tập khi N = 3, KHÔNG khi N = 1", async () => {
    const k = await kb("per10a", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, new Date("2026-12-20T03:00:00.000Z"));
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, id);
    const tap = (n: number) => docTapQuet(db, bc, { thang: "2026-12", centerId: k.centerId, soThangDoiSoat: n });
    expect(await tap(3)).toContain(id); // 12, 11, 10
    expect(await tap(1)).not.toContain(id); // chỉ tháng 12
    expect(await tap(0)).not.toContain(id);
    // Cấy 08/10: đổi `soThangDoiSoat > 0` thành `>= 0` ⇒ 0 ca đỏ — với N = 0 công thức lùi `−(N−1)` thành +1 tháng và nhặt khoản của các tháng SAU kỳ đang
    // quét; fixture chỉ có khoản THÁNG TRƯỚC nên không bao giờ thấy. Khoản dưới đây thu ở tháng 1/2027 (sau kỳ 12/2026).
    const idSau = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2027-01-15") });
    await quetKhoan(db, bc, idSau);
    expect(await tap(1)).toContain(idSau); // đối chứng dương: N = 1 nhặt mọi khoản có ô từ đầu tháng 12 trở đi
    expect(await tap(0)).not.toContain(idSau); // N = 0 là CÔNG TẮC TẮT Q5, không phải "cửa sổ 0 tháng"
  });

  it("[NHH-PER-10b] đối soát nền phát hiện trôi KHÔNG ai bấm Tính: cron quét lại khoản 2 tháng trước ⇒ INPUT_DRIFT", async () => {
    const k = await kb("per10b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW_NEN); // ngày tuyệt đối (luật 19): cửa sổ 3 tháng tính từ đây, không trôi theo tờ lịch
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, id);
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi` });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    const r = await doiSoatNen(db, await boiCanh(k, NOW_NEN), { soThang: 3, gioiHan: 100_000 });
    expect(r.loi).toEqual([]);
    expect(await db.commissionHold.count({ where: { paymentId: id, code: "INPUT_DRIFT" } })).toBe(1);
  }, 120_000); // đối soát nền quét TOÀN HỆ: DB test tích khoản qua các lượt chạy (sổ bất biến, không dọn được) nên thời gian tăng theo số lượt

  // Cấy 08/10: đổi `sap.length > gioiHan` thành `>=` ⇒ 0 ca đỏ — chưa ca nào đo số khoản đúng NGƯỠNG. Cắt thì phải BÁO (`biCat`), và đúng ngưỡng thì không được báo.
  it("[NHH-PER-10c] đối soát nền: số khoản BẰNG giới hạn thì KHÔNG cắt; vượt giới hạn 1 khoản ⇒ biCat = true và chỉ xử lý đúng `gioiHan` khoản (cắt phải báo, không im lặng)", async () => {
    const k = await kb("per10c", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW_NEN);
    for (const ten of ["a", "b"]) await quetKhoan(db, bc, await tienVe(k, await dungBe(k, ten), { soTien: 5_000_000, ngay: D("2026-10-12") }));
    const doi = (gioiHan: number) => doiSoatNen(db, bc, { soThang: 3, gioiHan });
    await doi(100_000); // khởi động: lượt đầu cập nhật lastCheckedAt / đóng hàng chờ tự giải ⇒ tập khoản ổn định cho ba phép đo sau
    const dau = await doi(100_000);
    const n = dau.soKhoan;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(dau.biCat).toBe(false);
    const bang = await doi(n);
    expect({ soKhoan: bang.soKhoan, biCat: bang.biCat }).toEqual({ soKhoan: n, biCat: false }); // đúng ngưỡng ⇒ không cắt
    const cat = await doi(n - 1);
    expect({ soKhoan: cat.soKhoan, biCat: cat.biCat }).toEqual({ soKhoan: n - 1, biCat: true });
  }, 180_000);

  it("[NHH-COM-16] khoản đã tính bị rejectPayment (rời thực thu) ⇒ quét ngược sinh ĐÚNG 1 hàng chờ cứng PAYMENT_WITHDRAWN chặn khoá; khoản không bị từ chối ⇒ 0", async () => {
    const k = await kb("com16", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a", { tongTien: 20_000_000 });
    const bi = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    const ok = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-13") });
    await quetKhoan(db, bc, bi);
    await quetKhoan(db, bc, ok);
    await tuChoi(k, bi);
    expect(await quetKhoan(db, bc, bi)).toMatchObject({ loai: "RUT_TIEN" });
    expect(await quetKhoan(db, bc, bi)).toMatchObject({ loai: "RUT_TIEN" }); // idempotent
    const holds = await db.commissionHold.findMany({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ severity: "HARD", status: "OPEN" });
    expect(holds[0]!.blockingPeriodId).not.toBeNull();
    expect(await db.commissionHold.count({ where: { code: "PAYMENT_WITHDRAWN", paymentId: ok } })).toBe(0);
    // không tự đảo: sổ KHÔNG đổi
    expect((await dongSoCuaKhoan(bi)).map((d) => d.amount)).toEqual([300_000]);
    // tập quét kỳ nhặt khoản bị rút (Q6) dù nó không thuộc WHERE_THUC_THU
    expect(await docTapQuet(db, bc, { thang: "2026-11", centerId: k.centerId, soThangDoiSoat: 0 })).toContain(bi);
  });

  // Lỗ đo 08/10 (rà độc lập): `rejectPayment` KHÔNG chặn từ chối khoản HOÀN. Dòng REVERSAL đã ghi vẫn ở lại ⇒ người hưởng bị thu hồi tiền theo một khoản hoàn
  // mà kế toán đã bác (thực thu của gốc quay về 10tr, đúng ra phải ra 300.000 chứ không phải 180.000), và KHÔNG ai biết: khoản hoàn không có ô nên Q6 (tìm ô) mù.
  it("[NHH-COM-16i] khoản HOÀN của gốc thuộc SỔ CŨ (đã sinh LEGACY_REVERSAL) bị rejectPayment ⇒ cùng luật với REVERSAL: Q6 chân hoàn nhặt nó, hàng chờ cứng chặn khoá, sổ KHÔNG tự đảo; hoàn không bị bác ⇒ 0 hàng chờ", async () => {
    const k = await kb("com16i", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a", { tongTien: 20_000_000 }), { soTien: 10_000_000, ngay: D("2026-09-10") }); // TRƯỚC mốc 2026-10 ⇒ engine cũ
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "DRAFT" }, create: { period: "2026-09", status: "DRAFT" } });
    const biBac = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    const giu = await hoanTien(k, goc, { soTien: 1_000_000, ngay: D("2026-11-06") });
    expect(await quetKhoan(db, bc, biBac)).toMatchObject({ loai: "DA_DAO_LEGACY", tong: -320_000 });
    expect(await quetKhoan(db, bc, giu)).toMatchObject({ loai: "DA_DAO_LEGACY" });

    await tuChoi(k, biBac);
    expect(await db.commissionHold.count({ where: { paymentId: biBac } })).toBe(0);
    // kỳ 12: không khoản nào có paidDate trong kỳ ⇒ chỉ chân Q6 (hoàn) mới nhặt được; đối chứng: khoản hoàn không bị bác thì KHÔNG có mặt
    const tapKy12 = await docTapQuet(db, bc, { thang: "2026-12", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(tapKy12).toContain(biBac);
    expect(tapKy12).not.toContain(giu);
    expect((await doiSoatNen(db, bc, { soThang: 0, gioiHan: 100_000 })).theoKetQua["RUT_TIEN"]).toBeGreaterThanOrEqual(1);
    const holds = await db.commissionHold.findMany({ where: { code: "PAYMENT_WITHDRAWN", paymentId: biBac } });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ severity: "HARD", status: "OPEN", centerId: k.centerId });
    expect(holds[0]!.blockingPeriodId).not.toBeNull();
    expect(await db.commissionHold.count({ where: { paymentId: giu } })).toBe(0);
    expect((await dongSoCuaKhoan(biBac)).map((d) => d.amount).sort((a, b) => a - b)).toEqual([-160_000, -80_000, -40_000, -40_000]);
    expect(await demHangChoChan(db, (await kyCua(k, "2026-11")).id)).toBeGreaterThanOrEqual(1);
  });

  it("[NHH-COM-16b] khoản HOÀN đã đảo bị rejectPayment ⇒ hàng chờ cứng PAYMENT_WITHDRAWN trên khoản hoàn, chặn khoá; sổ KHÔNG đổi; hoàn không bị bác ⇒ 0 hàng chờ; khôi phục ⇒ tự đóng", async () => {
    const k = await kb("com16b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a", { tongTien: 20_000_000 });
    const goc = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const biBac = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    const giu = await hoanTien(k, goc, { soTien: 1_000_000, ngay: D("2026-11-06") });
    expect(await quetKhoan(db, bc, biBac)).toMatchObject({ loai: "DA_DAO", tong: -120_000 });
    expect(await quetKhoan(db, bc, giu)).toMatchObject({ loai: "DA_DAO" });

    await tuChoi(k, biBac);
    // Q6 phải nhặt khoản hoàn bị rút NGAY từ lúc nó rời thực thu — trước khi có hàng chờ nào (nếu không, chỉ Q3 nhặt được và không ai tạo hàng chờ đầu tiên)
    expect(await db.commissionHold.count({ where: { paymentId: biBac } })).toBe(0);
    // kỳ 12: không khoản nào có paidDate trong kỳ ⇒ chỉ chân Q6 mới nhặt được (đối chứng: khoản hoàn không bị bác thì KHÔNG có mặt)
    const tapKy12 = await docTapQuet(db, bc, { thang: "2026-12", centerId: k.centerId, soThangDoiSoat: 0 });
    expect(tapKy12).toContain(biBac);
    expect(tapKy12).not.toContain(giu);
    // đối soát nền (toàn hệ) nhặt nó TRƯỚC khi ai quét riêng — kể cả khi không ai bấm Tính kỳ ⇒ chính nó tạo hàng chờ đầu tiên
    expect((await doiSoatNen(db, bc, { soThang: 0, gioiHan: 100_000 })).theoKetQua["RUT_TIEN"]).toBeGreaterThanOrEqual(1);
    expect(await db.commissionHold.count({ where: { code: "PAYMENT_WITHDRAWN", paymentId: biBac } })).toBe(1);
    expect(await quetKhoan(db, bc, biBac)).toMatchObject({ loai: "RUT_TIEN" });
    expect(await quetKhoan(db, bc, biBac)).toMatchObject({ loai: "RUT_TIEN" }); // idempotent
    const holds = await db.commissionHold.findMany({ where: { code: "PAYMENT_WITHDRAWN", paymentId: biBac } });
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ severity: "HARD", status: "OPEN", centerId: k.centerId });
    expect(holds[0]!.blockingPeriodId).not.toBeNull();
    // đối chứng dương: khoản hoàn KHÔNG bị bác thì không có hàng chờ nào
    expect(await db.commissionHold.count({ where: { paymentId: giu } })).toBe(0);
    // không tự đảo ngược lại: sổ nguyên vẹn
    expect((await dongSoCuaKhoan(biBac)).map((d) => d.amount)).toEqual([-120_000]);
    // khoá kỳ bị chặn bởi hàng chờ cứng
    expect(await demHangChoChan(db, (await kyCua(k, "2026-11")).id)).toBeGreaterThanOrEqual(1);

    // khôi phục khoản hoàn (kế toán bác nhầm, bấm lại) ⇒ hàng chờ tự đóng, sổ vẫn không đảo lần hai
    await db.payment.update({ where: { id: biBac }, data: { accountantStatus: "REFUNDED" } });
    expect(await quetKhoan(db, bc, biBac)).toMatchObject({ loai: "BO_QUA", lyDo: "DA_XU_LY" });
    expect(await db.commissionHold.count({ where: { paymentId: biBac, status: "OPEN" } })).toBe(0);
    expect(await db.commissionTransaction.count({ where: { paymentId: biBac } })).toBe(1);
  });

  // ── GV Trial · người nghỉ · cơ sở của giao dịch ──────────────────────────────────────────────

  it("[NHH-COM-11] GV Trial: bé có buổi PRESENT ⇒ GV được 1% THEO THỰC THU; ghi danh đã có CommissionLine(TRIAL_TEACHER) cũ ⇒ engine mới LOẠI (LEGACY_DA_TRA), 0 hàng chờ", async () => {
    const k = await kb("com11");
    const gv = await seedUser({ email: `${k.ma}-gv@ci.test`, role: "SALES_CSM", name: `${k.ma}-gv` });
    const bc = await boiCanh(k, NOW);
    const leadChildId = await themGvTrial(k, gv.id);

    const coGv = await dungBe(k, "co", { leadChildId });
    const idCo = await tienVe(k, coGv, { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, idCo);
    expect((await dongSoCuaKhoan(idCo)).find((d) => d.roleCode === "TRIAL_TEACHER")).toMatchObject({ beneficiaryUserId: gv.id, amount: 100_000 });

    // ghi danh khác của CÙNG bé đã được trả bằng engine CŨ (1% × finalPrice lúc convert) ⇒ không trả lần hai
    const daTra = await dungBe(k, "da-tra", { leadChildId });
    const stm = await db.commissionStatement.upsert({ where: { period: "2026-08" }, update: {}, create: { period: "2026-08", status: "DRAFT" } });
    await db.commissionLine.create({ data: { statementId: stm.id, recipientId: gv.id, tier: "TRIAL_TEACHER", amount: 100_000, enrollmentId: daTra.enrollmentId } });
    const idDaTra = await tienVe(k, daTra, { soTien: 10_000_000, ngay: D("2026-11-06") });
    await quetKhoan(db, bc, idDaTra);
    const dongs = await dongSoCuaKhoan(idDaTra);
    expect(dongs.find((d) => d.roleCode === "TRIAL_TEACHER")).toBeUndefined();
    expect(dongs.length).toBeGreaterThan(0); // 4 vai kia nguyên vẹn
    expect(await db.commissionHold.count({ where: { paymentId: idDaTra } })).toBe(0);
    await db.commissionLine.deleteMany({ where: { statementId: stm.id, enrollmentId: daTra.enrollmentId } });
  });

  it("[NHH-COM-09] người hưởng RESIGNED ⇒ không sinh dòng, nguồn vẫn trỏ, hàng chờ mềm NGUOI_HUONG_NGHI; đối chứng ACTIVE có dòng", async () => {
    const k = await kb("com09", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const nv = await db.employee.create({ data: { employeeCode: `E${k.ma}`.toUpperCase().slice(0, 20), fullName: `NV ${k.ma}`, jobTitle: "Sale", department: "KINH_DOANH", status: "ACTIVE" } });
    await db.user.update({ where: { id: k.sale.id }, data: { employeeId: nv.id } });
    const a = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, bc, a)).loai).toBe("DA_GHI"); // ACTIVE: có dòng
    expect((await dongSoCuaKhoan(a))[0]!.amount).toBe(300_000);

    await db.employee.update({ where: { id: nv.id }, data: { status: "RESIGNED" } });
    const b = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-11-06") });
    expect(await quetKhoan(db, bc, b)).toMatchObject({ loai: "DA_GHI", soDong: 0, treo: 1 });
    expect(await dongSoCuaKhoan(b)).toEqual([]);
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: b } })).detail).toMatchObject({ lyDo: "NGUOI_HUONG_NGHI", vai: "SALE" });
    // dòng ĐÃ GHI trước khi nghỉ giữ nguyên (bất biến) và vẫn được chi
    expect((await dongSoCuaKhoan(a))[0]).toMatchObject({ amount: 300_000, beneficiaryUserId: k.sale.id });
  });

  it("[NHH-COM-10] lead CS1, đơn CS2 ⇒ QLCS theo cơ sở của GIAO DỊCH (CS2), không theo cơ sở của lead", async () => {
    const k1 = await kb("com10a", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    const k2 = await kb("com10b", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    const bc = await boiCanh(k2, NOW);
    // lead thuộc k1 (CS1), nhưng đơn + khoản thu thuộc k2 (CS2)
    const be = await dungBe(k2, "a");
    await db.order.update({ where: { id: be.orderId }, data: { leadId: k1.lead!.id } });
    const id = await tienVe(k2, be, { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    expect((await dongSoCuaKhoan(id)).map((d) => [d.roleCode, d.beneficiaryUserId, d.centerId])).toEqual([["CENTER_MANAGER", k2.qlcs.id, k2.centerId]]);
  });

  // ── Quyền ĐỌC sổ (SEC-04..SEC-08) ───────────────────────────────────────────────────────────

  it("[NHH-SEC-04] Sale chỉ thấy dòng CỦA MÌNH (kể cả dòng CS khác), lọc người khác bị ÉP về mình; QLCS thấy cả cơ sở mình quản nhưng KHÔNG thấy cơ sở khác; Kế toán HO thấy tất cả", async () => {
    const k1 = await kb("sec04a");
    const k2 = await kb("sec04b");
    const bc1 = await boiCanh(k1, NOW);
    const bc2 = await boiCanh(k2, NOW);
    const id1 = await tienVe(k1, await dungBe(k1, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    const id2 = await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc1, id1);
    await quetKhoan(db, bc2, id2);

    // Sale CS1 CÒN làm Sale cho một lead mà đơn thuộc CS2 (lead CS1, đơn CS2): dòng CS2 của CHÍNH Sale này.
    const be2 = await dungBe(k2, "cheo");
    await db.order.update({ where: { id: be2.orderId }, data: { leadId: k1.lead!.id } });
    const id3 = await tienVe(k2, be2, { soTien: 10_000_000, ngay: D("2026-11-06") });
    await quetKhoan(db, bc2, id3);

    const ho = await donViHoiSo();
    await ganVai(k1.sale.id, k1.ouId, "CENTER_SALES_CSM");
    await ganVai(k1.qlcs.id, k1.ouId, "CENTER_MANAGER");
    const ketToanHo = await seedUser({ email: `${k1.ma}-kt-ho@ci.test`, role: "ACCOUNTANT", name: `${k1.ma}-kt-ho` });
    await ganVai(ketToanHo.id, ho, "HO_ACCOUNTANT");

    const sale = await actorCua(k1.sale.id);
    const ra = await docSoHoaHong(db, sale, {});
    const cuaSale = ra.dong.map((d) => d.paymentId).sort();
    expect(cuaSale).toEqual([id1, id3].sort()); // [04d] dòng CS2 của chính mình vẫn thấy
    expect(ra.dong.every((d) => d.nguoiHuong.id === k1.sale.id)).toBe(true); // không thấy vai khác
    // lọc người khác ⇒ ÉP về mình, không ném lỗi, không lộ
    const ep = await docSoHoaHong(db, sale, { nguoiHuong: k2.sale.id });
    expect(ep.dong.map((d) => d.paymentId).sort()).toEqual(cuaSale);

    const qlcs = await actorCua(k1.qlcs.id);
    const rq = await docSoHoaHong(db, qlcs, {});
    const tapQ = new Set(rq.dong.map((d) => d.paymentId));
    expect(tapQ.has(id1)).toBe(true); // cơ sở mình quản
    expect(tapQ.has(id2)).toBe(false); // [04d] QLCS CS1 KHÔNG thấy dòng CS2 của người khác
    expect(rq.dong.every((d) => d.centerId === k1.centerId)).toBe(true);
    // QLCS thấy dòng CỦA NGƯỜI KHÁC trong cơ sở mình, không chỉ dòng của chính họ. Cấy 08/10: nhánh `centerId in cs` thành `{}` ⇒ 0 ca đỏ — `tapQ.has(id1)`
    // ở trên đã đúng nhờ chính dòng QLCS của khoản id1, nên không chứng minh được QLCS đọc được dòng của Sale.
    expect(rq.dong.some((d) => d.paymentId === id1 && d.nguoiHuong.id === k1.sale.id)).toBe(true);
    // QLCS lọc theo người hưởng khác trong cơ sở mình: ĐƯỢC (có view-center)
    const rqLoc = await docSoHoaHong(db, qlcs, { nguoiHuong: k1.qlcs.id });
    expect(rqLoc.dong.length).toBeGreaterThan(0);
    expect(rqLoc.dong.every((d) => d.nguoiHuong.id === k1.qlcs.id)).toBe(true);

    const kt = await actorCua(ketToanHo.id);
    // (lọc theo cơ sở: DB test tích luỹ dòng của các lượt chạy trước, trang đầu không đủ để nói "thấy tất cả")
    const tapK1 = new Set((await docSoHoaHong(db, kt, { thang: "2026-11", centerId: k1.centerId, coTrang: 200 })).dong.map((d) => d.paymentId));
    const tapK2 = new Set((await docSoHoaHong(db, kt, { thang: "2026-11", centerId: k2.centerId, coTrang: 200 })).dong.map((d) => d.paymentId));
    expect(tapK1.has(id1)).toBe(true); // đối chứng dương: HO thấy CẢ HAI cơ sở
    expect(tapK2.has(id2) && tapK2.has(id3)).toBe(true);

    // không có cả hai key ⇒ đóng cửa
    const ph = await seedUser({ email: `${k1.ma}-ph@ci.test`, role: "PARENT", name: `${k1.ma}-ph` });
    await expect(docSoHoaHong(db, await actorCua(ph.id), {})).rejects.toThrow(/quyền/i);
    // kẹp phân trang: trần 200 dòng/trang, tối thiểu 1 dòng / trang 1. Cấy 08/10: bỏ trần ⇒ 0 ca đỏ — một lời gọi `coTrang: 100000` kéo cả sổ.
    expect(await docSoHoaHong(db, kt, { coTrang: 100_000 })).toMatchObject({ coTrang: 200 });
    expect(await docSoHoaHong(db, kt, { coTrang: 0, trang: 0 })).toMatchObject({ coTrang: 1, trang: 1 });
  });

  it("[NHH-SEC-04c] 'dự kiến của bạn': chỉ phần CỦA MÌNH; trên lead của Sale khác ⇒ rỗng; QLCS (có view-center) cũng chỉ thấy phần của chính mình", async () => {
    const k = await kb("sec04c");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    await ganVai(k.qlcs.id, k.ouId, "CENTER_MANAGER");
    const khac = await seedUser({ email: `${k.ma}-sale-khac@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-khac` });
    await ganVai(khac.id, k.ouId, "CENTER_SALES_CSM");
    const bc = await boiCanh(k, NOW);

    const sale = await duKienCuaToi(db, bc, await actorCua(k.sale.id), { orderId: be.orderId });
    expect(sale.duKienCuaToi.map((d) => [d.roleCode, d.soTien])).toEqual([["SALE", 400_000]]);
    expect(sale.giaDinh.join(" ")).toMatch(/HÔM NAY/);

    const ql = await duKienCuaToi(db, bc, await actorCua(k.qlcs.id), { orderId: be.orderId });
    expect(ql.duKienCuaToi.map((d) => [d.roleCode, d.soTien])).toEqual([["CENTER_MANAGER", 200_000]]); // chỉ phần CỦA QLCS — không thấy Sale 400.000

    const khacR = await duKienCuaToi(db, bc, await actorCua(khac.id), { leadId: k.lead!.id });
    expect(khacR.duKienCuaToi).toEqual([]); // lead của Sale khác ⇒ rỗng
    expect(khacR.daGhiCuaToi).toEqual([]);

    // VAT HÔM NAY: bảng VAT 10% ⇒ cơ sở = round(10.000.000 / 1,1) = 9.090.909 ⇒ Sale 4% = 363.636. Cấy 08/10: `vatNay = 0` ⇒ 0 ca đỏ (mọi ca dùng bảng VAT rỗng).
    const bcVat = { ...bc, hoaHong: { ...bc.hoaHong, vatTheoNgay: [{ tuNgay: "2026-01-01", tiLe: 0.1 }] } };
    const coVat = await duKienCuaToi(db, bcVat, await actorCua(k.sale.id), { orderId: be.orderId });
    expect(coVat.duKienCuaToi.map((d) => [d.roleCode, d.soTien])).toEqual([["SALE", 363_636]]);

    // không có `commission:view-self` ⇒ đóng cửa (fail-closed). Cấy 08/10: bỏ cổng ⇒ 0 ca đỏ.
    const ph = await seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph` });
    await expect(duKienCuaToi(db, bc, await actorCua(ph.id), { orderId: be.orderId })).rejects.toThrow(/quyền/i);
  });
});
