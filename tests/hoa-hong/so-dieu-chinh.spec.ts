// @vitest-environment node
/**
 * [NHH-COM-08b/12/16c..h/17g/h/18/19] / [NHH-FLOW-E] — ĐIỀU CHỈNH · HOÀN TIỀN · GIẢI HÀNG CHỜ · ĐỔI NGUỒN SAU THU (PR5b),
 * trên Postgres THẬT (04 §10.4, §10.5, §11; 05 AC-COM).
 *
 * Dòng tiền dựng bằng HÀM GHI THẬT (`recordPayment`/`confirmPayment`/`refundPayment`/`adjustPayment`/`rejectPayment`) — xem `_kich-ban.ts`. Đổi nguồn dựng bằng
 * `doiNguonLead` THẬT (PR2) rồi cho consumer ăn chính DomainEvent mà nó phát ra.
 *
 * Mã `17g`/`17h`: dòng PR5b của lộ trình ghi `COM-17e/f` cho giải INPUT_DRIFT, nhưng `17e` đã thuộc ca "hạ trần" của PR5a (mã trùng) — dùng chữ cái kế tiếp.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18) với tiền tố riêng. Sổ BẤT BIẾN nên không dọn được bằng xoá. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import type { Actor } from "../../lib/auth/actor";
import { onNguonDaDoiSauThanhToan } from "../../lib/hoa-hong/_handlers/doi-nguon-sau-thu";
import { apDungDoiNguonSauThu, xemTruocDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { chayTrongKhoa } from "../../lib/hoa-hong/ghi-so";
import { ghiHangCho } from "../../lib/hoa-hong/hang-cho";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { chuyenRaSoat, demHangChoChan, khoaKyHoaHong, tinhKy, type NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { quetKhoan, saoTuDongGoc } from "../../lib/hoa-hong/quet-khoan";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import {
  boiCanh,
  D,
  datMocCutover,
  dieuChinh,
  huyChinhSach,
  dongSoCuaKhoan,
  donKichBan,
  dungBe,
  dungKichBan,
  ganNguon,
  hoanTien,
  nguoiKyHo,
  nguoiKyQlcs,
  themChinhSachNhom,
  tienVe,
  tomTat,
  tuChoi,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-ADJ] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
let NGUOI: NguoiThaoTacKy;
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
const kyCua = (k: KichBan, thang: string) => db.commissionPeriod.findFirstOrThrow({ where: { period: thang, centerId: k.centerId } });
const rongCua = async (paymentIds: string[]) => {
  const ds = await db.commissionTransaction.findMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { calcSlot: { paymentId: { in: paymentIds } } }] } });
  const m = new Map<string, number>();
  for (const d of ds) {
    const key = `${d.roleCode}:${d.beneficiaryUserId ?? d.beneficiaryAffiliateId}`;
    m.set(key, (m.get(key) ?? 0) + d.amount);
  }
  return Object.fromEntries([...m.entries()].filter(([, v]) => v !== 0));
};
/** Khoá một kỳ bằng đường thật (Tính → rà soát → Khoá). */
async function khoaKy(k: KichBan, thang: string, bc: Awaited<ReturnType<typeof boiCanh>>) {
  const ky = await kyCua(k, thang);
  // `lastCalculatedAt` = lúc BẮT ĐẦU Tính: phải SAU mọi `updatedAt` của fixture (cổng khoá so dấu thời gian do chính Postgres đóng) ⇒ đồng hồ thật, như COM-07.
  await tinhKy(db, { ...bc, now: new Date() }, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
  await chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() });
  await khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "khoá kỳ để chi lương (ca test)" });
  expect((await kyCua(k, thang)).status).toBe("LOCKED");
  return ky;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-ADJ] điều chỉnh · hoàn · giải hàng chờ · đổi nguồn sau thu", () => {
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

  // ── Điều chỉnh TĂNG (adjustPayment delta dương) — 04 §11.2 ───────────────────────────────────

  it("[NHH-COM-08b] adjustPayment TĂNG ⇒ ô MỚI chép rule/tỉ lệ/NGƯỜI từ ô gốc: Sale đổi SAU khi thu gốc mà delta VẪN theo người đã nhận phần gốc", async () => {
    const k = await kb("com08b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const be = await dungBe(k, "a");
    const goc = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    await quetKhoan(db, bc, goc);
    const gocRow = (await dongSoCuaKhoan(goc))[0]!;

    // người chốt đổi SAU khi thu gốc (đúng ca chép-từ-gốc sinh ra để xử lý)
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });

    const adj = await dieuChinh(k, goc, 12_000_000); // số đúng cuối cùng 12tr ⇒ delta +2tr
    expect(await quetKhoan(db, bc, adj)).toMatchObject({ loai: "DA_GHI", soDong: 1, tong: 60_000, lateArrival: false });
    const d = (await dongSoCuaKhoan(adj))[0]!;
    expect(d).toMatchObject({
      entryKind: "ORIGINAL",
      beneficiaryUserId: k.sale.id, // KHÔNG phải `moi`: sửa số của chính lần thu ấy
      amount: 60_000, // 3% × 2tr
      netBase: 2_000_000,
      reasonCode: "DIEU_CHINH_TANG",
      refEventType: "PAYMENT",
      refEventId: goc,
      ruleId: gocRow.ruleId,
      policyVersionId: gocRow.policyVersionId,
      sourceGroupCode: gocRow.sourceGroupCode,
    });
    expect(d.calcSlotId).not.toBe(gocRow.calcSlotId); // ô RIÊNG của delta
    // Ngày dùng để chọn chính sách/VAT của delta = ngày thu GỐC (`adjustPayment` chép `paidDate` của gốc — lib/finance/payment.ts), nên bảng VAT đổi giữa hai lần không lệch cơ sở của delta với dòng gốc.
    expect(d.rateDate.getTime()).toBe(gocRow.rateDate.getTime());
    expect(d.vatRate.toString()).toBe(gocRow.vatRate.toString());
    // quét lại: không đẻ thêm, không INPUT_DRIFT giả
    expect((await quetKhoan(db, bc, adj)).loai).toBe("KHONG_DOI");
    expect(await db.commissionHold.count({ where: { paymentId: adj } })).toBe(0);
    // bút toán âm sau đó trỏ về GỐC đảo cả phần delta (04 §11.2 "nhóm đảo") — hoàn 6tr / cơ sở 10tr của ô gốc
    const hoan = await hoanTien(k, goc, { soTien: 6_000_000, ngay: D("2026-11-05") });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO" });
  });

  it("[NHH-COM-08d] điều chỉnh TĂNG BỎ dòng FIXED_PER_PURCHASE (tiền cố định theo LẦN MUA, không theo số tiền thu): delta +2tr chỉ sinh dòng PERCENT, không sinh phần cố định tỉ lệ", async () => {
    const k = await kb("com08d", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "SALE_ADMIN", kieu: "FIXED_PER_PURCHASE", tien: 100_000 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-10") });
    await quetKhoan(db, bc, goc);
    expect(tomTat(await dongSoCuaKhoan(goc))).toEqual({ [`SALE:${k.sale.id}`]: 300_000, [`SALE_ADMIN:${k.saleAdmin.id}`]: 100_000 }); // đối chứng dương: dòng cố định CÓ ở khoản gốc

    const adj = await dieuChinh(k, goc, 12_000_000);
    expect(await quetKhoan(db, bc, adj)).toMatchObject({ loai: "DA_GHI", soDong: 1, tong: 60_000 });
    expect(tomTat(await dongSoCuaKhoan(adj))).toEqual({ [`SALE:${k.sale.id}`]: 60_000 });
    expect((await quetKhoan(db, bc, adj)).loai).toBe("KHONG_DOI");
  });

  it("[NHH-COM-08e] hoàn một phần đảo dòng FIXED_PER_PURCHASE theo TỈ LỆ TIỀN của chính dòng (4tr/10tr ⇒ −40.000 trên 100.000, công thức chung 04 §11.1), không đảo cả 100.000 và không bỏ qua", async () => {
    const k = await kb("com08e", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "SALE_ADMIN", kieu: "FIXED_PER_PURCHASE", tien: 100_000 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-10") });
    await quetKhoan(db, bc, goc);
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO", soDong: 2, tong: -160_000 });
    expect(tomTat(await dongSoCuaKhoan(hoan))).toEqual({ [`SALE:${k.sale.id}`]: -120_000, [`SALE_ADMIN:${k.saleAdmin.id}`]: -40_000 });
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 180_000, [`SALE_ADMIN:${k.saleAdmin.id}`]: 60_000 });
  });

  // GHIM BUG (it.fails — hẹn, không phải quên): kỳ vọng của dòng CỐ ĐỊNH không co theo cơ sở còn lại, nên sau hoàn một phần lượt quét thường báo INPUT_DRIFT đòi lại đúng 40.000 vừa thu hồi.
  // Chưa vá vì `FIXED_PER_PURCHASE` KHÔNG kích hoạt được ở P0 (04 §9.2, Q14: chưa chốt chi lúc nào / chia theo tỉ lệ thu) — fixture ở đây ghi thẳng DB, vòng qua guardrail kích hoạt.
  // Khi Q14 được quyết, vá `kyVongCua` cho dòng cố định rồi GỠ ghim này (vá xong ca XANH ⇒ Vitest báo đỏ buộc gỡ).
  it.fails("[NHH-COM-08f] (GHIM BUG) quét thường sau hoàn một phần KHÔNG báo trôi giả cho dòng FIXED_PER_PURCHASE", async () => {
    const k = await kb("com08f", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "SALE_ADMIN", kieu: "FIXED_PER_PURCHASE", tien: 100_000 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-10") });
    await quetKhoan(db, bc, goc);
    await quetKhoan(db, bc, await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") }));
    expect((await quetKhoan(db, bc, goc)).loai).toBe("KHONG_DOI");
  });

  it("[NHH-COM-08c] đối chứng: gốc CHƯA có ô ⇒ delta chạy pipeline thường (người chốt HÔM NAY) — chứng minh nhánh chép không bị bật nhầm", async () => {
    const k = await kb("com08c", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2026-11-25"));
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-10") }); // KHÔNG quét gốc
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    const adj = await dieuChinh(k, goc, 12_000_000);
    expect(await quetKhoan(db, bc, adj)).toMatchObject({ loai: "DA_GHI", tong: 60_000 });
    const d = (await dongSoCuaKhoan(adj))[0]!;
    expect(d).toMatchObject({ entryKind: "ORIGINAL", beneficiaryUserId: moi.id, reasonCode: null });
  });

  // ── LEGACY_REVERSAL — 04 §11.3, H22 ──────────────────────────────────────────────────────────

  it("[NHH-COM-12] khoản thu TRƯỚC mốc (chủ CŨ), hoàn SAU mốc ⇒ LEGACY_REVERSAL tự động: âm ĐÚNG bằng số engine CŨ sẽ ra (rate theo ngày thu GỐC), 0 hàng chờ, kỳ cũ không bị đụng (H22)", async () => {
    const k = await kb("com12", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-09-10") });
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "DRAFT" }, create: { period: "2026-09", status: "DRAFT" } });
    // BGĐ đổi tỉ lệ SALE 4% → 2% từ 01/10: thu hồi PHẢI đòi lại 4% đã trả (rateDate = ngày GỐC), không phải 2% hôm nay
    const cau = await db.commissionRateConfig.create({ data: { tier: "SALE", rate: 0.02, effectiveFrom: D("2026-10-01"), reason: k.ma } });
    try {
      expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" }); // gốc thuộc engine cũ
      const nStmt = await db.commissionStatement.count();
      const nLine = await db.commissionLine.count();

      const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
      const r = await quetKhoan(db, bc, hoan);
      expect(r).toMatchObject({ loai: "DA_DAO_LEGACY", soDong: 4, tong: -320_000, kyGhi: "2026-11", lateArrival: false });

      const dong = await dongSoCuaKhoan(hoan);
      expect(dong.every((d) => d.entryKind === "LEGACY_REVERSAL")).toBe(true);
      // SALE 4% · SALE_ADMIN 1% · QL_TT 2% (→ CENTER_MANAGER) · QC 1% (→ MARKETING), mỗi người −x% × 4tr
      expect(tomTat(dong)).toEqual({
        [`SALE:${k.sale.id}`]: -160_000,
        [`SALE_ADMIN:${k.saleAdmin.id}`]: -40_000,
        [`CENTER_MANAGER:${k.qlcs.id}`]: -80_000,
        [`MARKETING:${k.qc.id}`]: -40_000,
      });
      const mau = dong.find((d) => d.roleCode === "SALE")!;
      expect(mau).toMatchObject({
        calcSlotId: null,
        legacyTier: "SALE",
        naturalPeriod: "2026-11",
        reasonCode: "GOC_THUOC_ENGINE_CU",
        refEventType: "PAYMENT",
        refEventId: goc, // tham chiếu GIAO DỊCH GỐC (H22)
        paymentId: hoan,
        transactionTypeCode: "LEGACY",
      });
      expect(mau.rateDate.getTime()).toBe(D("2026-09-10").getTime()); // tỉ lệ theo ngày GỐC

      // tự động: 0 hàng chờ; không động tới sổ cũ; không tạo kỳ < mốc
      expect(await db.commissionHold.count({ where: { paymentId: hoan } })).toBe(0);
      expect([await db.commissionStatement.count(), await db.commissionLine.count()]).toEqual([nStmt, nLine]);
      expect(await db.commissionPeriod.count({ where: { centerId: k.centerId, period: { lt: "2026-10" } } })).toBe(0);
      // idempotent
      expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "BO_QUA", lyDo: "DA_XU_LY" });
      expect(await db.commissionTransaction.count({ where: { paymentId: hoan } })).toBe(4);
    } finally {
      await db.commissionRateConfig.delete({ where: { id: cau.id } });
    }
  });

  it("[NHH-COM-12d] H22: kỳ của ngày hoàn đã LOCKED ⇒ LEGACY_REVERSAL vào kỳ OPEN kế tiếp, giữ naturalPeriod, KHÔNG mở lại kỳ đã khoá, có AuditLog", async () => {
    const k = await kb("com12d", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, new Date());
    const cu = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-09-12") });
    const moiBe = await dungBe(k, "b");
    const trongKy = await tienVe(k, moiBe, { soTien: 10_000_000, ngay: D("2026-11-03") });
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "DRAFT" }, create: { period: "2026-09", status: "DRAFT" } });
    await quetKhoan(db, bc, trongKy); // tạo kỳ 2026-11 của cơ sở
    const ky11 = await khoaKy(k, "2026-11", bc);

    const hoan = await hoanTien(k, cu, { soTien: 4_000_000, ngay: D("2026-11-20") }); // ngày hoàn thuộc kỳ ĐÃ KHOÁ
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO_LEGACY", kyGhi: "2026-12", lateArrival: true });
    const dong = await dongSoCuaKhoan(hoan);
    expect(dong).toHaveLength(4);
    expect(dong.every((d) => d.naturalPeriod === "2026-11" && d.lateArrival)).toBe(true);
    const ky12 = await kyCua(k, "2026-12");
    expect(dong.every((d) => d.periodId === ky12.id)).toBe(true);
    // kỳ 11 vẫn LOCKED, không nhận thêm dòng nào
    expect((await kyCua(k, "2026-11")).status).toBe("LOCKED");
    expect(await db.commissionTransaction.count({ where: { periodId: ky11.id, entryKind: "LEGACY_REVERSAL" } })).toBe(0);
    const audit = await db.auditLog.findFirst({ where: { module: "hoa-hong", action: "LEGACY_REVERSAL", entityType: "CommissionPeriod", entityId: ky12.id } });
    expect(audit).not.toBeNull();
    expect(audit!.reason).toContain(hoan);
  });

  it("[NHH-COM-12e] khoản HOÀN thuộc chủ CŨ (ngày hoàn TRƯỚC mốc) ⇒ engine mới KHÔNG đảo gì: BO_QUA KHONG_PHAI_CHU, 0 dòng, 0 hàng chờ (bảng kê cũ lo việc thu hồi — đảo hai lần là trả hai lần)", async () => {
    const k = await kb("com12e", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-09-10") });
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "DRAFT" }, create: { period: "2026-09", status: "DRAFT" } });
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-09-20") }); // cả gốc lẫn hoàn đều trước mốc 2026-10
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" });
    expect(await dongSoCuaKhoan(hoan)).toEqual([]);
    expect(await db.commissionHold.count({ where: { paymentId: hoan } })).toBe(0);
    // đối chứng dương: hoàn SAU mốc của cùng gốc đó thì engine mới có việc (LEGACY_REVERSAL)
    const hoanSau = await hoanTien(k, goc, { soTien: 1_000_000, ngay: D("2026-11-03") });
    expect(await quetKhoan(db, bc, hoanSau)).toMatchObject({ loai: "DA_DAO_LEGACY" });
  });

  it("[NHH-COM-12g] khoản HOÀN đã sinh LEGACY_REVERSAL mà kế toán BÁC sau đó ⇒ KHÔNG im lặng: hàng chờ PAYMENT_WITHDRAWN cứng chặn khoá kỳ ghi; 'áp dụng' trả lại ĐÚNG số đã thu hồi (+320.000, từng người, kind DISPUTE_ADJUSTMENT mượn), quét lại không mở lại hàng chờ", async () => {
    const k = await kb("com12g", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-09-10") });
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "DRAFT" }, create: { period: "2026-09", status: "DRAFT" } });
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO_LEGACY", soDong: 4, tong: -320_000 });
    const hoanRieng = tomTat(await dongSoCuaKhoan(hoan));
    expect(Object.values(hoanRieng).reduce((s, v) => s + v, 0)).toBe(-320_000);

    await tuChoi(k, hoan); // kế toán bác khoản hoàn (rejectPayment cho phép ở mọi trạng thái)
    const r = await quetKhoan(db, bc, hoan);
    expect(r.loai).toBe("RUT_TIEN"); // KHÔNG còn BO_QUA:KHONG_THUC_THU im lặng
    const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: hoan, code: "PAYMENT_WITHDRAWN" } });
    expect(hold).toMatchObject({ severity: "HARD", status: "OPEN" });
    expect(hold.blockingPeriodId).not.toBeNull();
    expect((hold.detail as { loaiKhoan?: string }).loaiKhoan).toBe("HOAN");
    expect(await db.commissionTransaction.count({ where: { paymentId: hoan } })).toBe(4); // lượt quét KHÔNG tự đảo (bác có thể là bấm nhầm — 01 §6.2)

    const kq = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Khoản hoàn bị bác — trả lại hoa hồng đã thu hồi", nguoi: NGUOI });
    expect(kq).toMatchObject({ loai: "DA_AP_DUNG", soDong: 4, tong: 320_000 });
    const tra = await db.commissionTransaction.findMany({ where: { refEventType: "HOLD", refEventId: hold.id } });
    expect(tra).toHaveLength(4);
    expect(tomTat(tra)).toEqual(Object.fromEntries(Object.entries(hoanRieng).map(([key, v]) => [key, -v])));
    const legacyIds = new Set((await dongSoCuaKhoan(hoan)).filter((d) => d.entryKind === "LEGACY_REVERSAL").map((d) => d.id));
    expect(tra.every((d) => d.refEntryId !== null && legacyIds.has(d.refEntryId) && d.calcSlotId === null && d.paymentId === hoan)).toBe(true);
    // Ròng theo người về 0 (khoản hoàn đã bị vô hiệu hoá) và hàng chờ đã RESOLVED; quét lại không đẻ gì thêm.
    expect(await rongCua([hoan])).toEqual({}); // rongCua cộng mọi dòng mang paymentId = khoản hoàn: −x (LEGACY_REVERSAL) + x (trả lại) = 0
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("RESOLVED");
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "BO_QUA" });
    expect(await db.commissionHold.count({ where: { paymentId: hoan, status: "OPEN" } })).toBe(0);
  });

  it("[NHH-COM-12b] gốc thuộc kỳ cũ APPROVED mà KHÔNG có manifest ⇒ MANUAL_REVIEW_REQUIRED, 0 dòng (không đoán gốc thuộc engine nào)", async () => {
    const k = await kb("com12b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-09-15") });
    await db.commissionStatement.upsert({ where: { period: "2026-09" }, update: { status: "APPROVED" }, create: { period: "2026-09", status: "APPROVED" } });
    try {
      const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
      expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "GIU", hangCho: ["MANUAL_REVIEW_REQUIRED"] });
      expect(await dongSoCuaKhoan(hoan)).toEqual([]);
      const h = await db.commissionHold.findFirstOrThrow({ where: { paymentId: hoan } });
      expect(h).toMatchObject({ severity: "HARD", status: "OPEN" });
    } finally {
      await db.commissionStatement.update({ where: { period: "2026-09" }, data: { status: "DRAFT" } });
    }
  });

  // ── Giải hàng chờ PAYMENT_WITHDRAWN — 04 §10.5, 01 §6.2 ─────────────────────────────────────

  async function khoanBiRut(ten: string) {
    const k = await kb(ten, { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const bi = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, bi);
    await tuChoi(k, bi);
    await quetKhoan(db, bc, bi);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
    return { k, bc, bi, hold };
  }

  it("[NHH-COM-16c] giải PAYMENT_WITHDRAWN bằng ĐẢO ⇒ INPUT_CORRECTION = −ròng từng người (cùng ô), hàng chờ RESOLVED, kỳ hết bị chặn; quét lại không sinh thêm; giải lần hai bị từ chối", async () => {
    const { k, bc, bi, hold } = await khoanBiRut("com16c");
    const ky = await kyCua(k, "2026-11");
    expect(await demHangChoChan(db, hold.blockingPeriodId!)).toBe(1);

    const r = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Kế toán từ chối thật, thu hồi hoa hồng", nguoi: NGUOI });
    expect(r).toMatchObject({ loai: "DA_AP_DUNG", soDong: 1, tong: -300_000, kyGhi: "2026-11" });
    const dong = await dongSoCuaKhoan(bi);
    expect(dong.map((d) => [d.entryKind, d.amount])).toEqual([["ORIGINAL", 300_000], ["INPUT_CORRECTION", -300_000]]);
    const dc = dong.find((d) => d.entryKind === "INPUT_CORRECTION")!;
    expect(dc).toMatchObject({ calcSlotId: dong[0]!.calcSlotId, refEventType: "HOLD", refEventId: hold.id, reasonCode: "KHOAN_BI_RUT_DAO", refEntryId: dong[0]!.id, periodId: ky.id });
    expect((await rongCua([bi]))).toEqual({}); // ròng về 0

    const sau = await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(sau).toMatchObject({ status: "RESOLVED", resolvedById: NGUOI.userId });
    expect(sau.resolutionNote).toContain("Kế toán từ chối thật");
    expect(await demHangChoChan(db, hold.blockingPeriodId!)).toBe(0);
    const audit = await db.auditLog.findFirst({ where: { entityType: "CommissionHold", entityId: hold.id, action: "APPLY" } });
    expect(audit?.reason).toContain("Kế toán từ chối thật");

    // quét lại: khoản đã đảo sạch ⇒ không còn tiền ⇒ không dựng lại hàng chờ, không ghi thêm
    expect(await quetKhoan(db, bc, bi)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_THUC_THU" });
    expect(await db.commissionHold.count({ where: { paymentId: bi, status: "OPEN" } })).toBe(0);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: bi } } })).toBe(2);
    // giải lần hai ⇒ từ chối, không ghi
    await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "bấm lần hai cho chắc", nguoi: NGUOI })).rejects.toMatchObject({ ma: "HANG_CHO_KHONG_GIAI_DUOC" });
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: bi } } })).toBe(2);
  });

  it("[NHH-COM-16d] 'giữ nguyên' BẮT LÝ DO ≥ 10 ký tự; có lý do ⇒ DISMISSED, sổ KHÔNG đổi, lượt quét sau KHÔNG mở lại; lý do ngắn ⇒ từ chối và hàng chờ vẫn OPEN", async () => {
    const { bc, bi, hold } = await khoanBiRut("com16d");
    await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "ngắn", nguoi: NGUOI })).rejects.toMatchObject({ ma: "THIEU_LY_DO" });
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");

    const r = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Bấm nhầm, đã xác nhận lại ở phiếu khác", nguoi: NGUOI });
    expect(r).toEqual({ loai: "DA_GIU_NGUYEN" });
    expect(await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).toMatchObject({ status: "DISMISSED", resolvedById: NGUOI.userId });
    expect((await dongSoCuaKhoan(bi)).map((d) => d.entryKind)).toEqual(["ORIGINAL"]);
    expect(await quetKhoan(db, bc, bi)).toMatchObject({ loai: "RUT_TIEN" });
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("DISMISSED"); // KHÔNG mở lại
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: bi } } })).toBe(1);
  });

  it("[NHH-COM-16h] 'giữ nguyên' CHỐNG ĐUA: hai người cùng bấm trên MỘT hàng chờ ⇒ đúng MỘT lượt thành công, MỘT dòng nhật ký DISMISS (ghi có điều kiện OPEN, người sau đổi 0 dòng ⇒ throw trước audit)", async () => {
    const { bc, hold } = await khoanBiRut("com16h");
    const kq = await Promise.allSettled([
      giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Người thứ nhất: bấm nhầm, đã xác nhận lại", nguoi: NGUOI }),
      giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Người thứ hai: cũng thấy bấm nhầm", nguoi: NGUOI }),
    ]);
    expect(kq.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(thua.reason).toMatchObject({ ma: expect.stringMatching(/^(TRANG_THAI_DA_DOI|HANG_CHO_KHONG_GIAI_DUOC)$/) });
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "DISMISS" } })).toBe(1);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("DISMISSED");
  });

  it("[NHH-COM-16e] khoản HOÀN bị bác: giải AP_DUNG ⇒ INPUT_CORRECTION +120.000 trả lại đúng số đã thu hồi (ròng gốc về 300.000)", async () => {
    const k = await kb("com16e", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, hoan);
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 180_000 });
    await tuChoi(k, hoan);
    await quetKhoan(db, bc, hoan);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: hoan } });

    const r = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Khoản hoàn bị bác — trả lại hoa hồng đã thu hồi", nguoi: NGUOI });
    expect(r).toMatchObject({ loai: "DA_AP_DUNG", soDong: 1, tong: 120_000 });
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 300_000 });
    const dc = await db.commissionTransaction.findFirstOrThrow({ where: { entryKind: "INPUT_CORRECTION", refEventId: hold.id } });
    expect(dc).toMatchObject({ amount: 120_000, reasonCode: "KHOAN_HOAN_BI_RUT_KHOI_PHUC" });
    expect(dc.netBase).toBe(4_000_000); // cơ sở TRẢ LẠI mang dấu DƯƠNG (dòng REVERSAL gốc chụp −4tr): đối xứng, không phải −4tr lần nữa
    expect(dc.refEntryId).toBe((await dongSoCuaKhoan(hoan))[0]!.id); // trỏ đúng dòng REVERSAL mà nó vô hiệu hoá
    expect(await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).toMatchObject({ status: "RESOLVED" });
    // Lượt quét/cron SAU khi đã giải: khoản hoàn vẫn bị bác nhưng số đã thu hồi ĐÃ được trả lại ⇒ KHÔNG mở lại hàng chờ (`ghiHangCho` mở lại RESOLVED) — nếu mở lại, hàng chờ treo
    // vĩnh viễn chặn khoá kỳ (giải lần hai bị khoá idempotency từ chối) và cron đối soát nền lặp lại mỗi đêm.
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_THUC_THU" });
    expect(await db.commissionHold.count({ where: { paymentId: hoan, status: "OPEN" } })).toBe(0);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("RESOLVED");
    // Cơ sở còn lại QUAY VỀ 10tr (hoàn đã vô hiệu): quét lại gốc KHÔNG báo INPUT_DRIFT giả đòi lại đúng 120.000 vừa trả.
    expect((await quetKhoan(db, bc, goc)).loai).toBe("KHONG_DOI");
    expect(await db.commissionHold.count({ where: { paymentId: goc, code: "INPUT_DRIFT" } })).toBe(0);
    // và hoàn LẦN SAU tính trên cơ sở 10tr: hoàn 2tr ⇒ −60.000 (không phải −90.000 như khi cơ sở còn bị trừ 4tr)
    const hoan2 = await hoanTien(k, goc, { soTien: 2_000_000, ngay: D("2026-11-09") });
    expect(await quetKhoan(db, bc, hoan2)).toMatchObject({ loai: "DA_DAO", tong: -60_000 });
  });

  it("[NHH-COM-16f] khoản đã QUAY LẠI thực thu (kế toán xác nhận lại) mà bấm 'đảo' ⇒ TỪ CHỐI, không ghi dòng nào (không thu hồi oan tiền hợp lệ)", async () => {
    const { bc, bi, hold } = await khoanBiRut("com16f");
    await db.payment.update({ where: { id: bi }, data: { accountantStatus: "CONFIRMED" } });
    await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "đảo cho chắc ăn nhé", nguoi: NGUOI })).rejects.toMatchObject({ ma: "KHOAN_DA_QUAY_LAI_THUC_THU" });
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: bi } } })).toBe(1);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
  });

  it("[NHH-COM-16g] phạm vi GHI: QLCS cơ sở KHÁC không giải được hàng chờ của cơ sở này (NGOAI_PHAM_VI, 0 dòng, hàng chờ nguyên); đối chứng: Kế toán HO giải được", async () => {
    const { bc, bi, hold } = await khoanBiRut("com16g");
    const khac = await kb("com16g-khac", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const qlcsKhac = await nguoiKyQlcs(khac);
    await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "thử giải hàng chờ cơ sở khác", nguoi: qlcsKhac })).rejects.toMatchObject({ ma: "NGOAI_PHAM_VI" });
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: bi } } })).toBe(1);
    const ok = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Kế toán HO giải hàng chờ", nguoi: NGUOI });
    expect(ok.loai).toBe("DA_AP_DUNG");
  });

  // ── Giải hàng chờ INPUT_DRIFT — 04 §10.4 bước 3 ─────────────────────────────────────────────

  async function troiNguoiChot(ten: string) {
    const k = await kb(ten, { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    await quetKhoan(db, bc, id);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT" } });
    return { k, bc, id, moi, hold };
  }

  it("[NHH-COM-17g] giải INPUT_DRIFT bằng ÁP DỤNG ⇒ INPUT_CORRECTION = đúng chênh lệch từng người (Sale cũ −300.000, Sale mới +300.000), cùng ô; hàng chờ RESOLVED; quét lại KHONG_DOI", async () => {
    const { k, bc, id, moi, hold } = await troiNguoiChot("com17g");
    const r = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Người chốt đã đổi — áp dụng theo người mới", nguoi: NGUOI });
    expect(r).toMatchObject({ loai: "DA_AP_DUNG", soDong: 2, tong: 0 });
    const dc = (await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "INPUT_CORRECTION");
    expect(tomTat(dc)).toEqual({ [`SALE:${k.sale.id}`]: -300_000, [`SALE:${moi.id}`]: 300_000 });
    expect(dc.every((d) => d.refEventType === "HOLD" && d.refEventId === hold.id && d.reasonCode === "INPUT_DRIFT_AP_DUNG")).toBe(true);
    expect(await rongCua([id])).toEqual({ [`SALE:${moi.id}`]: 300_000 });
    expect(await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).toMatchObject({ status: "RESOLVED" });
    // Dấu "đã khớp" ghi NGAY trong lượt giải (cấy 09/10: gỡ nó thì lượt quét sau tự khớp lại vì chênh = 0 — nên chỉ khẳng định TRỰC TIẾP trên ô mới bắt được):
    const o = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: id } });
    expect(o.lastMatchedHash).not.toBe(o.firstInputHash); // đầu vào hôm nay (người chốt mới) đã được chấp nhận
    expect(o.lastCheckedAt.getTime()).toBe(NOW.getTime());
    expect((await quetKhoan(db, bc, id)).loai).toBe("KHONG_DOI");
    expect(await db.commissionHold.count({ where: { paymentId: id, status: "OPEN" } })).toBe(0);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } })).toBe(3);
  });

  it("[NHH-COM-17k] áp dụng INPUT_DRIFT chỉ ghi ĐÚNG chênh lệch người duyệt đã THẤY: đầu vào đổi THÊM một lần trước khi bấm ⇒ DAU_VAO_DA_DOI, 0 dòng mới, hàng chờ OPEN; Tính lại rồi duyệt hàng chờ MỚI thì ghi cho người mới", async () => {
    const { k, bc, id, moi, hold } = await troiNguoiChot("com17k");
    // người duyệt đang nhìn hàng chờ: Sale cũ −300.000 / `moi` +300.000. Trước khi bấm, người chốt đổi LẦN NỮA sang `nua` (chưa ai quét).
    const nua = await seedUser({ email: `${k.ma}-sale-nua@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-nua`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: nua.id } });
    await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng theo hàng chờ đã xem", nguoi: NGUOI })).rejects.toMatchObject({ ma: "DAU_VAO_DA_DOI" });
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } })).toBe(1); // chỉ dòng gốc
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "APPLY" } })).toBe(0);

    // Tính lại ⇒ hàng chờ MỚI mang chênh lệch về `nua`; duyệt nó thì tiền về đúng `nua`, không phải `moi`.
    await quetKhoan(db, bc, id);
    const holdMoi = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT", status: "OPEN" } });
    expect(holdMoi.id).not.toBe(hold.id);
    const r = await giaiHangCho(db, bc, { holdId: holdMoi.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng theo người chốt mới nhất", nguoi: NGUOI });
    expect(r.loai).toBe("DA_AP_DUNG");
    expect(await rongCua([id])).toEqual({ [`SALE:${nua.id}`]: 300_000 });
    expect(moi.id).not.toBe(nua.id);
  });

  it("[NHH-COM-17i] giải INPUT_DRIFT CHỐNG ĐUA: hai người cùng bấm 'áp dụng' trên MỘT hàng chờ ⇒ đúng MỘT lượt thành công, MỘT dòng nhật ký APPLY (người sau thấy hàng chờ đã RESOLVED sau khoá khoản)", async () => {
    const { bc, id, hold } = await troiNguoiChot("com17i");
    const kq = await Promise.allSettled([
      giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Người thứ nhất áp dụng theo người mới", nguoi: NGUOI }),
      giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Người thứ hai cũng áp dụng theo người mới", nguoi: NGUOI }),
    ]);
    expect(kq.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(thua.reason).toMatchObject({ ma: expect.stringMatching(/^(TRANG_THAI_DA_DOI|HANG_CHO_KHONG_GIAI_DUOC)$/) });
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "APPLY" } })).toBe(1);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } })).toBe(3); // gốc + 2 dòng chênh — không nhân đôi
  });

  it("[NHH-COM-17j] áp dụng INPUT_DRIFT KHÔNG ghi trên số lỗi: (a) hôm nay VƯỢT TRẦN ⇒ DAU_VAO_LOI_CAU_HINH · (b) khoản không còn dựng được kỳ vọng ⇒ KHONG_TINH_DUOC · (c) hàng chờ mất ô ⇒ HANG_CHO_THIEU_O — hàng chờ vẫn OPEN, 0 dòng mới", async () => {
    const { k, bc, id, hold } = await troiNguoiChot("com17j");
    const dem = () => db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } });
    const truoc = await dem();
    const giai = (b: typeof bc, holdId: string) => giaiHangCho(db, b, { holdId, quyetDinh: "AP_DUNG", lyDo: "Thử áp dụng trên số lỗi cấu hình", nguoi: NGUOI });

    // (a) trần hôm nay thấp hơn tỉ lệ của rule (3% > 1%) — kỳ vọng hôm nay là VUOT_TRAN
    const bcTran = { ...bc, hoaHong: { ...bc.hoaHong, tranTongTiLe: 0.01 } };
    await expect(giai(bcTran, hold.id)).rejects.toMatchObject({ ma: "DAU_VAO_LOI_CAU_HINH" });

    // (c) hàng chờ INPUT_DRIFT không gắn ô — dựng bằng đúng đường ghi hàng chờ của engine
    const khongO = `COM17J-KHONG-O:${k.ma}`;
    await db.$transaction((tx) =>
      ghiHangCho(tx, { holdKey: khongO, code: "INPUT_DRIFT", paymentId: id, orderId: null, orderItemId: null, studentId: null, entryId: null, calcSlotId: null, blockingPeriodId: null, centerId: k.centerId, orgUnitId: k.ouId, detail: {} }, NOW),
    );
    const holdKhongO = await db.commissionHold.findUniqueOrThrow({ where: { holdKey: khongO } });
    await expect(giai(bc, holdKhongO.id)).rejects.toMatchObject({ ma: "HANG_CHO_THIEU_O" });

    // (b) dòng đơn của khoản đổi sang loại NGOÀI phạm vi hoa hồng (vật tư) ⇒ lượt dựng kỳ vọng không còn ra "TINH"
    const don = await db.payment.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
    await db.orderItem.updateMany({ where: { orderId: don.orderId }, data: { type: "PRODUCT" } });
    try {
      await expect(giai(bc, hold.id)).rejects.toMatchObject({ ma: "KHONG_TINH_DUOC" });
    } finally {
      await db.orderItem.updateMany({ where: { orderId: don.orderId }, data: { type: "COURSE_ENROLLMENT" } });
    }

    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await dem()).toBe(truoc);
    // đối chứng dương: hết lỗi ⇒ giải được
    expect(await giai(bc, hold.id)).toMatchObject({ loai: "DA_AP_DUNG" });
  });

  it("[NHH-COM-17h] giải INPUT_DRIFT bằng 'giữ nguyên' ⇒ sổ KHÔNG đổi, DISMISSED, hash vào `hashDaChapNhan`: quét lại KHONG_DOI và KHÔNG báo lại; đầu vào đổi LẦN NỮA thì vẫn báo", async () => {
    const { k, bc, id, hold } = await troiNguoiChot("com17h");
    expect(await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Giữ người chốt cũ — đã thoả thuận", nguoi: NGUOI })).toEqual({ loai: "DA_GIU_NGUYEN" });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "KHONG_DOI" });
    expect(await db.commissionHold.count({ where: { paymentId: id, status: "OPEN" } })).toBe(0);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } })).toBe(1);
    // đổi LẦN NỮA (hash khác) ⇒ vẫn báo
    const nua = await seedUser({ email: `${k.ma}-sale-nua@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-nua`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: nua.id } });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "TROI" });
    expect(await db.commissionHold.count({ where: { paymentId: id, status: "OPEN", code: "INPUT_DRIFT" } })).toBe(1);
  });

  // ── Đổi nguồn SAU thanh toán → SOURCE_CORRECTION — V8 ───────────────────────────────────────

  const CO_SAU: KiemQuyen = async (action) => action === "sources:override-after-payment";
  const actorCoSo = (userId: string, centerId: string) =>
    ({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor;

  /** Hoàn 4tr rồi đổi nguồn PAID_ADS → PARENT_REFERRAL (đúng quyền) — dựng bằng `doiNguonLead` THẬT, trả DomainEvent nó phát. */
  async function doiNguonSauHoan(ten: string) {
    const k = await kb(ten, { rules: [{ vai: "SALE", rate: 0.04 }] });
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS");
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, hoan);
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 240_000 });

    const kq = await doiNguonLead({
      actor: actorCoSo("u-doi-nguon", k.centerId),
      actorName: "Người đổi",
      kiemQuyen: CO_SAU,
      leadId: k.lead!.id,
      groupId: nhom.PARENT_REFERRAL,
      thamChieu: { employeeId: null, parentUserId: ph.id, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
      bayGio: NOW,
    });
    expect(kq).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const ev = await db.domainEvent.findFirstOrThrow({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${k.lead!.id}:` } } });
    return { k, bc, goc, hoan, ph, ev };
  }

  it("[NHH-COM-18] V8: hoàn 4tr rồi đổi nguồn CÓ QUYỀN ⇒ SOURCE_CORRECTION tính trên cơ sở CÒN LẠI 6tr: REFERRER_PARENT +60.000đ, Sale 0 dòng; xử lý lại / Tính lại hai lần không ghi thêm", async () => {
    const { k, bc, goc, hoan, ph, ev } = await doiNguonSauHoan("com18");
    const kq1 = await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    expect(kq1.theoKetQua).toEqual({ DA_DIEU_CHINH: 1 });

    const sc = await db.commissionTransaction.findMany({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } });
    expect(sc).toHaveLength(1); // Sale: chênh = 0 ⇒ KHÔNG có dòng
    expect(sc[0]).toMatchObject({
      roleCode: "REFERRER_PARENT",
      beneficiaryUserId: ph.id,
      amount: 60_000, // 1% × 6tr — KHÔNG phải 100.000 (1% × toàn netBase 10tr)
      netBase: 6_000_000,
      refEventType: "ATTRIBUTION",
      refEventId: ev.id,
      reasonCode: "DOI_NGUON_SAU_THU",
      naturalPeriod: "2026-11",
      lateArrival: false,
    });
    // KỲ GHI SỔ là kỳ của NGÀY SỰ KIỆN đổi nguồn (11), KHÔNG phải kỳ của khoản thu (10): kỳ khoản thu có thể đã LOCKED/EXPORTED, sửa vào đó là mở lại kỳ.
    expect(sc[0]!.periodId).toBe((await kyCua(k, "2026-11")).id);
    expect(sc[0]!.periodId).not.toBe((await kyCua(k, "2026-10")).id);
    const gocSlot = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: goc } });
    expect(sc[0]!.calcSlotId).toBe(gocSlot.id);
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 240_000, [`REFERRER_PARENT:${ph.id}`]: 60_000 });

    // xử lý LẠI cùng sự kiện + sự kiện khác (đường backfill) + quét thường ⇒ không ghi thêm, không INPUT_DRIFT
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: `audit:khac` });
    expect((await quetKhoan(db, bc, goc)).loai).toBe("KHONG_DOI");
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } })).toBe(1);
    expect(await db.commissionHold.count({ where: { paymentId: goc, status: "OPEN" } })).toBe(0);
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 240_000, [`REFERRER_PARENT:${ph.id}`]: 60_000 });
  });

  it("[NHH-COM-18f] đổi nguồn CÓ QUYỀN chỉ tự ghi phần do NGUỒN gây ra: Sale cũ→mới (chuyển tiền) + đổi nguồn ⇒ REFERRER_PARENT +100.000 tự ghi, Sale vẫn INPUT_DRIFT chờ duyệt (không ghi thẳng vào sổ gắn nhãn 'đổi nguồn'); duyệt xong tiền về Sale mới", async () => {
    const k = await kb("com18f", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS");
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    expect(await rongCua([goc])).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });

    // (1) người chốt đổi sang Sale mới — CHƯA ai quét (chuyển tiền giữa hai người, luật bắt qua INPUT_DRIFT)
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    // (2) rồi nguồn đổi có quyền
    const kqDoi = await doiNguonLead({
      actor: actorCoSo("u-doi-nguon", k.centerId),
      actorName: "Người đổi",
      kiemQuyen: CO_SAU,
      leadId: k.lead!.id,
      groupId: nhom.PARENT_REFERRAL,
      thamChieu: { employeeId: null, parentUserId: ph.id, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
      bayGio: NOW,
    });
    expect(kqDoi).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const ev = await db.domainEvent.findFirstOrThrow({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${k.lead!.id}:` } } });

    // XEM TRƯỚC (dry-run của script backfill): CHỈ ĐỌC, nói đúng cái sẽ ghi và cái để lại cho người duyệt.
    const xem = await xemTruocDoiNguonSauThu(db, bc, k.lead!.id);
    expect(xem).toHaveLength(1);
    expect(xem[0]).toMatchObject({ paymentId: goc, ketQua: "GHI" });
    expect(xem[0]!.tuGhi.map((c) => [c.key, c.chenh])).toEqual([[`REFERRER_PARENT|USER|${ph.id}`, 100_000]]);
    expect(xem[0]!.choDuyet.map((c) => c.chenh).sort((a, b) => a - b)).toEqual([-400_000, 400_000]);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: goc } } })).toBe(1); // xem trước không ghi gì

    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    const sc = await db.commissionTransaction.findMany({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } });
    expect(tomTat(sc)).toEqual({ [`REFERRER_PARENT:${ph.id}`]: 100_000 }); // KHÔNG có dòng nào của Sale
    expect(await rongCua([goc])).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 100_000 });
    const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: goc, code: "INPUT_DRIFT", status: "OPEN" } });
    const chenh = (hold.detail as { chenh: { key: string; chenh: number }[] }).chenh;
    expect(Object.fromEntries(chenh.map((c) => [c.key, c.chenh]))).toEqual({ [`SALE|USER|${k.sale.id}`]: -400_000, [`SALE|USER|${moi.id}`]: 400_000 }); // người duyệt thấy ĐÚNG phần Sale, không lẫn phần nguồn
    // lượt quét thường sau đó KHÔNG đẻ thêm dòng / hàng chờ
    expect((await quetKhoan(db, bc, goc)).loai).toBe("TROI");
    expect(await db.commissionHold.count({ where: { paymentId: goc, code: "INPUT_DRIFT", status: "OPEN" } })).toBe(1);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: goc } } })).toBe(2);

    // người duyệt áp dụng ⇒ tiền Sale về người mới; người giới thiệu giữ nguyên 100.000
    const r = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Người chốt mới thật sự phụ trách đơn này", nguoi: NGUOI });
    expect(r.loai).toBe("DA_AP_DUNG");
    expect(await rongCua([goc])).toEqual({ [`SALE:${moi.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 100_000 });
  });

  it("[NHH-COM-18b] ô có DISPUTE_ADJUSTMENT ⇒ đổi nguồn KHÔNG tự ghi: rơi về INPUT_DRIFT cho người duyệt (khiếu nại có thể đã bù đúng phần đó)", async () => {
    const { k, bc, goc, ev } = await doiNguonSauHoan("com18b");
    // một dòng khiếu nại duyệt trên ô — ghi bằng ĐÚNG đường ghi duy nhất (`ghiDong`), sao snapshot từ dòng ORIGINAL
    const g = await db.commissionTransaction.findFirstOrThrow({ where: { paymentId: goc, entryKind: "ORIGINAL" } });
    const slot = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: goc } });
    const ky = await kyCua(k, "2026-10");
    await chayTrongKhoa(db, { khoaKhoan: [goc], kyCutoverDaDoc: "2026-10" }, async (h) => {
      await h.khoaKyDeGhi([ky.id]);
      await h.ghiDong([
        saoTuDongGoc(g, {
          idempotencyKey: `DSP|${k.ma}`,
          entryKind: "DISPUTE_ADJUSTMENT",
          calcSlotId: slot.id,
          periodId: ky.id,
          naturalPeriod: "2026-10",
          lateArrival: false,
          paymentId: goc,
          amount: 1_000,
          reason: "khiếu nại được duyệt (ca test)",
          reasonCode: "KHIEU_NAI",
          grossAmount: 0,
          netBase: 0,
          inputHash: g.inputHash,
          refEntryId: g.id,
          refEventType: "DISPUTE",
          refEventId: `dsp-${k.ma}`,
        }),
      ]);
    });
    const r = await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    expect(r.theoKetQua).toEqual({ TROI: 1 });
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } })).toBe(0);
    expect(await db.commissionHold.count({ where: { paymentId: goc, code: "INPUT_DRIFT", status: "OPEN" } })).toBe(1);
  });

  it("[NHH-COM-18d] đầu vào đổi LẦN NỮA sau khi đã áp dụng CÙNG sự kiện ⇒ KHÔNG ghi nửa chừng: rơi về INPUT_DRIFT cho người duyệt, sổ giữ nguyên (khoá idempotency theo sự kiện × ô × người)", async () => {
    const { k, bc, goc, hoan, ph, ev } = await doiNguonSauHoan("com18d");
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    const truoc = await rongCua([goc, hoan]);
    expect(truoc).toEqual({ [`SALE:${k.sale.id}`]: 240_000, [`REFERRER_PARENT:${ph.id}`]: 60_000 });

    // phụ huynh giới thiệu bị đổi sang người khác NGAY SAU đó (không qua doiNguonLead: không có sự kiện mới) rồi consumer bị chạy lại với CÙNG sự kiện
    const ph2 = await seedUser({ email: `${k.ma}-ph2@ci.test`, role: "PARENT", name: `${k.ma}-ph2`, phone: null });
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { referrerParentUserId: ph2.id } });
    const r = await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    expect(r.theoKetQua).toEqual({ TROI: 1 });
    expect(await rongCua([goc, hoan])).toEqual(truoc); // KHÔNG dòng nào ghi (nếu ghi nửa chừng, ph2 +60.000 sẽ lọt mà ph không bị đòi lại)
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } })).toBe(1);
    const h = await db.commissionHold.findMany({ where: { paymentId: goc, code: "INPUT_DRIFT", status: "OPEN" } });
    expect(h).toHaveLength(1);
    // sự kiện MỚI (id khác) thì áp dụng được: ph −60.000, ph2 +60.000
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: `${ev.id}-lan2` });
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 240_000, [`REFERRER_PARENT:${ph2.id}`]: 60_000 });
  });

  it("[NHH-COM-18e] người CHỈ CÓ dòng điều chỉnh (vào ô nhờ SOURCE_CORRECTION) vẫn có mẫu snapshot: hoàn tiếp SAU đổi nguồn đảo cả REFERRER_PARENT theo tỉ lệ tiền của chính họ, không ném", async () => {
    const { k, bc, goc, hoan, ph, ev } = await doiNguonSauHoan("com18e");
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id });
    const hoan2 = await hoanTien(k, goc, { soTien: 3_000_000, ngay: D("2026-11-10") }); // cơ sở còn lại 6tr → hoàn 3tr = một nửa
    expect(await quetKhoan(db, bc, hoan2)).toMatchObject({ loai: "DA_DAO", soDong: 2, tong: -150_000 });
    expect(tomTat(await dongSoCuaKhoan(hoan2))).toEqual({ [`SALE:${k.sale.id}`]: -120_000, [`REFERRER_PARENT:${ph.id}`]: -30_000 });
    const sc = await db.commissionTransaction.findFirstOrThrow({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } });
    expect((await db.commissionTransaction.findFirstOrThrow({ where: { paymentId: hoan2, roleCode: "REFERRER_PARENT" } })).refEntryId).toBe(sc.id); // mẫu = dòng điều chỉnh
    expect(await rongCua([goc, hoan, hoan2])).toEqual({ [`SALE:${k.sale.id}`]: 120_000, [`REFERRER_PARENT:${ph.id}`]: 30_000 });
    expect((await quetKhoan(db, bc, goc)).loai).toBe("KHONG_DOI"); // và không INPUT_DRIFT giả sau hai lần hoàn
  });

  it("[NHH-COM-18c] consumer của DomainEvent: engine BẬT ⇒ ghi SOURCE_CORRECTION; engine TẮT ⇒ bỏ qua (không ném, không ghi)", async () => {
    const { k, goc, ev } = await doiNguonSauHoan("com18c");
    const dat = (batEngine: boolean) =>
      db.systemSetting.upsert({ where: { key: "hoaHong.engineBat" }, update: { valueJson: batEngine }, create: { key: "hoaHong.engineBat", valueJson: batEngine } });
    // Consumer dựng bối cảnh bằng `dungBoiCanhQuet` (mọi chính sách ACTIVE trong DB, không lọc theo kịch bản) ⇒ chính sách GLOBAL của các ca trước CÙNG tệp sẽ chồng lấn
    // (POLICY_OVERLAP). Huỷ chúng: các ca sau tự dựng bối cảnh lọc theo kịch bản của mình nên không bị ảnh hưởng.
    for (const o of cuaToi) if (o !== k) await huyChinhSach([o.chinhSach.policyCode, ...o.chinhSachThem]);
    const payload = ev.payloadJson as Record<string, unknown>;
    const dem = () => db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: goc } } });
    try {
      await dat(false);
      await onNguonDaDoiSauThanhToan({ id: ev.id, type: ev.type, payload });
      expect(await dem()).toBe(0);
      await dat(true);
      await onNguonDaDoiSauThanhToan({ id: ev.id, type: ev.type, payload });
      expect(await dem()).toBe(1);
      await onNguonDaDoiSauThanhToan({ id: ev.id, type: ev.type, payload }); // retry của dispatcher ⇒ idempotent
      expect(await dem()).toBe(1);
      expect(k.lead).not.toBeNull();
    } finally {
      await db.systemSetting.deleteMany({ where: { key: "hoaHong.engineBat" } });
    }
  });

  // ── Hai lượt hoàn SONG SONG — 04 §10.6 ──────────────────────────────────────────────────────

  it("[NHH-COM-19] hai lượt hoàn SONG SONG cùng gốc (Promise.all) ⇒ Σ đảo ≤ dòng gốc, ròng KHÔNG âm, không lượt nào ném; hoàn đủ ⇒ ròng đúng 0", async () => {
    const k = await kb("com19", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const r1 = await hoanTien(k, goc, { soTien: 6_000_000, ngay: D("2026-11-05") });
    const r2 = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-06") });
    const [a, b] = await Promise.all([quetKhoan(db, bc, r1), quetKhoan(db, bc, r2)]);
    expect([a.loai, b.loai]).toEqual(["DA_DAO", "DA_DAO"]);
    const dao = await db.commissionTransaction.findMany({ where: { entryKind: "REVERSAL", paymentId: { in: [r1, r2] } } });
    expect(dao.reduce((s, d) => s + d.amount, 0)).toBe(-300_000); // đúng bằng dòng gốc, không hơn
    expect(await rongCua([goc, r1, r2])).toEqual({});
    // quét lại song song cả hai lần nữa ⇒ không đảo thêm
    await Promise.all([quetKhoan(db, bc, r1), quetKhoan(db, bc, r2)]);
    expect(await db.commissionTransaction.count({ where: { entryKind: "REVERSAL", paymentId: { in: [r1, r2] } } })).toBe(2);
  });

  // Cấy 09/10: gỡ cả khoá khoản gốc lẫn khoá dòng ô khỏi `quetDao` mà `[NHH-COM-19]` (6tr + 4tr) VẪN XANH — tỉ lệ TIỀN của chính dòng cộng lại luôn đúng bằng ròng dù mỗi lượt
  // tính trên cơ sở cũ, nên số "đẹp" không tạo được vượt ròng. Chỉ LÀM TRÒN mới lộ: ròng 1đ, hai khoản hoàn mỗi khoản đúng NỬA cơ sở ⇒ mỗi lượt (tính trên cơ sở cũ) đòi round(0,5) = 1đ.
  it("[NHH-COM-19d] CÙNG MỘT khoản hoàn bị quét SONG SONG hai lần (retry của dispatcher chồng lên cron) ⇒ đúng MỘT lượt đảo, lượt kia BO_QUA DA_XU_LY; một dòng nhật ký ADJUST", async () => {
    const k = await kb("com19d", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    const kq = await Promise.all([quetKhoan(db, bc, hoan), quetKhoan(db, bc, hoan)]);
    expect(kq.map((x) => x.loai).sort()).toEqual(["BO_QUA", "DA_DAO"]);
    expect(kq.find((x) => x.loai === "BO_QUA")).toMatchObject({ lyDo: "DA_XU_LY" });
    expect(await db.commissionTransaction.count({ where: { paymentId: hoan, entryKind: "REVERSAL" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "CommissionCalcSlot", action: "ADJUST", reason: `hoàn tiền ${hoan}` } })).toBe(1);
    expect(await rongCua([goc, hoan])).toEqual({ [`SALE:${k.sale.id}`]: 180_000 });
  });

  it("[NHH-COM-19c] ròng 1đ, hai khoản hoàn mỗi khoản NỬA cơ sở chạy SONG SONG ⇒ đúng MỘT lượt đảo −1đ, lượt kia không có gì để đảo; ròng về 0, KHÔNG lượt nào ném (lỗi làm tròn lộ ra nếu hai lượt cùng tính trên cơ sở cũ)", async () => {
    const k = await kb("com19c", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 34, ngay: D("2026-10-12") }); // 3% × 34 = 1,02 ⇒ 1đ
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "DA_GHI", tong: 1 });
    const r1 = await hoanTien(k, goc, { soTien: 17, ngay: D("2026-11-05") });
    const r2 = await hoanTien(k, goc, { soTien: 17, ngay: D("2026-11-06") });
    const [a, b] = await Promise.all([quetKhoan(db, bc, r1), quetKhoan(db, bc, r2)]);
    expect([a.loai, b.loai].sort()).toEqual(["BO_QUA", "DA_DAO"]);
    expect(await db.commissionTransaction.count({ where: { entryKind: "REVERSAL", paymentId: { in: [r1, r2] } } })).toBe(1);
    expect(await rongCua([goc, r1, r2])).toEqual({});
  });

  it("[NHH-COM-19b] lưới dưới cùng: SQL thô chèn dòng ÂM làm ròng < 0 ⇒ trigger `rong_khong_am` NÉM (không đảo quá số đã ghi)", async () => {
    const k = await kb("com19b", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const g = await db.commissionTransaction.findFirstOrThrow({ where: { paymentId: goc } });
    const ky = await kyCua(k, "2026-10");
    const loi = await chayTrongKhoa(db, { khoaKhoan: [goc], kyCutoverDaDoc: "2026-10" }, async (h) => {
      await h.khoaKyDeGhi([ky.id]);
      return h
        .ghiDong([
          saoTuDongGoc(g, {
            idempotencyKey: `QUA|${k.ma}`,
            entryKind: "REVERSAL",
            calcSlotId: g.calcSlotId,
            periodId: ky.id,
            naturalPeriod: "2026-10",
            lateArrival: false,
            paymentId: goc,
            amount: -g.amount - 1, // vượt ròng 1đ
            reason: "cố đảo quá",
            reasonCode: "HOAN_TIEN",
            grossAmount: 0,
            netBase: 0,
            inputHash: g.inputHash,
            refEntryId: g.id,
            refEventType: "PAYMENT",
            refEventId: "x",
          }),
        ])
        .then(() => null)
        .catch((e: unknown) => e);
    }).catch((e: unknown) => e);
    expect(String(loi)).toMatch(/không đảo quá số đã ghi/);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: goc } } })).toBe(1);
    expect(loi instanceof HoaHongError).toBe(false);
  });

  // ── Luồng E — thanh toán → hoa hồng → kỳ LOCKED → hoàn một phần → dòng âm kỳ sau (H22) ──────

  it("[NHH-FLOW-E] thu 10tr (kỳ 10) → hoa hồng 300.000 → kỳ 10 KHOÁ → hoàn 4tr NGÀY THUỘC kỳ 10 ⇒ −120.000 vào kỳ 11 (kỳ hiệu lực 10, kỳ ghi sổ 11) · kỳ 10 nguyên vẹn · hoàn tiếp tháng 11 ⇒ −60.000 · ròng 120.000", async () => {
    const k = await kb("floweE", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, new Date());
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "DA_GHI", tong: 300_000, kyGhi: "2026-10" });
    const ky10 = await khoaKy(k, "2026-10", bc);
    const lock = await kyCua(k, "2026-10");
    const soDongKy10 = await db.commissionTransaction.count({ where: { periodId: ky10.id } });

    const hoan1 = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-10-25") }); // ngày hoàn nằm TRONG kỳ đã khoá
    expect(await quetKhoan(db, bc, hoan1)).toMatchObject({ loai: "DA_DAO", tong: -120_000, kyGhi: "2026-11", lateArrival: true });
    const d1 = (await dongSoCuaKhoan(hoan1))[0]!;
    expect(d1).toMatchObject({ entryKind: "REVERSAL", naturalPeriod: "2026-10", lateArrival: true, refEntryId: (await dongSoCuaKhoan(goc))[0]!.id });
    expect(d1.periodId).toBe((await kyCua(k, "2026-11")).id);

    const hoan2 = await hoanTien(k, goc, { soTien: 2_000_000, ngay: D("2026-11-08") });
    expect(await quetKhoan(db, bc, hoan2)).toMatchObject({ loai: "DA_DAO", tong: -60_000, kyGhi: "2026-11", lateArrival: false });

    // kỳ 10: vẫn LOCKED, cùng thời điểm khoá, không thêm dòng nào (H22: không mở lại kỳ)
    const sau = await kyCua(k, "2026-10");
    expect(sau.status).toBe("LOCKED");
    expect(sau.lockedAt?.getTime()).toBe(lock.lockedAt?.getTime());
    expect(await db.commissionTransaction.count({ where: { periodId: ky10.id } })).toBe(soDongKy10);
    expect(await rongCua([goc, hoan1, hoan2])).toEqual({ [`SALE:${k.sale.id}`]: 120_000 });
    // kỳ 11 vẫn Tính/khoá được bình thường với hai dòng âm
    const ky11 = await kyCua(k, "2026-11");
    expect(await db.commissionTransaction.count({ where: { periodId: ky11.id, amount: { lt: 0 } } })).toBe(2);
  });
});
