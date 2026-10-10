// @vitest-environment node
/**
 * [NHH-PER-03a..k] / [NHH-PER-04] / [NHH-COM-12c] — CUTOVER trên Postgres THẬT (05 "Quy tắc cutover chính thức", §2.2c; 04 §3).
 *
 * Mốc dùng trong tệp: P = 2027-03 (kỳ MỚI), P−1 = 2027-02, P−2 = 2027-01 — các tháng "yên" mà không spec nào khác chạm, nên bảng kê cũ (`CommissionStatement.period`
 * UNIQUE toàn hệ) tạo/xoá ở đây không giẫm lên `so-ky-hang-cho` (dùng 2026-09). Bảng kê của tệp này được DỌN sau từng ca (try/finally) — một bảng kê
 * APPROVED sót lại là đổi kết quả ca của spec chạy SAU (luật 18).
 *
 * Mỗi cổng có ca RIÊNG và đối chứng dương cạnh nó: ca chỉ khẳng định "từ chối" luôn đạt khi cổng hỏng hoàn toàn.
 * Cấy gỡ từng cổng ⇒ đúng ca của nó đỏ (ghi ở báo cáo PR; lưới mã nguồn `lib/hoa-hong/cutover-wiring.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { chotKyHoaHong } from "../../lib/crm/commission-run";
import { approveStatement, reopenStatement, setStatementLines } from "../../lib/crm/commission-statement";
import { ensureCommissionStatement, recordTrialTeacherCommission } from "../../lib/crm/trial-teacher-commission";
import { convertLeadV2 } from "../../lib/crm/convert-lead-v2";
import { confirmPayment } from "../../lib/finance/payment";
import { datMocCutover as datMoc } from "../../lib/hoa-hong/cutover";
import { chayTrongKhoa } from "../../lib/hoa-hong/ghi-so";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { setGlobalSetting } from "../../lib/settings/service";
import {
  actorCua,
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  donViHoiSo,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganVai,
  hoanTien,
  themGvTrial,
  tienVe,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-PER-03] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "2027-03";
const P1 = "2027-02";
const P2 = "2027-01";
const THANG_DON = [P2, P1, P, "2027-04"] as const;
const KY_VONG = "chốt ca test cutover";

const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
const AUD = { id: null as string | null, name: "Ca test cutover" };

let SA: { actor: Awaited<ReturnType<typeof actorCua>>; ten: string };
async function nguoiSuperAdmin() {
  const u = await seedUser({ email: `fx-nhh-sa-${Date.now().toString(36)}@ci.test`, role: "SUPER_ADMIN", name: "Quản trị tối cao fixture", phone: null });
  await ganVai(u.id, await donViHoiSo(), "SUPER_ADMIN");
  return { actor: await actorCua(u.id), ten: "Quản trị tối cao fixture" };
}

/** Dọn bảng kê CŨ của các tháng trong tệp (dòng trước, bảng kê sau). */
async function donBangKe() {
  const ds = await db.commissionStatement.findMany({ where: { period: { in: [...THANG_DON] } }, select: { id: true } });
  await db.commissionLine.deleteMany({ where: { statementId: { in: ds.map((s) => s.id) } } });
  await db.commissionStatement.deleteMany({ where: { id: { in: ds.map((s) => s.id) } } });
}
const demBangKe = (period: string) => db.commissionStatement.count({ where: { period } });
const giaTriMoc = async () => (await db.systemSetting.findUnique({ where: { key: "hoaHong.kyCutover" } }))?.valueJson ?? null;

describe.skipIf(!RUN_DB_TESTS)("[NHH-PER-03] cutover", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover(P);
    SA = await nguoiSuperAdmin();
  }, 120_000);
  afterEach(async () => {
    await donBangKe();
    await datMocCutover(P);
  });
  afterAll(async () => {
    await donBangKe();
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  // ── Năm cổng của đường cũ ────────────────────────────────────────────────────────────────

  it("[NHH-PER-03a] chốt cũ TỪ CHỐI tháng thuộc sổ mới: (i) k ≥ P; (ii) k < P mà đã có dòng sổ MỚI (vế hai — mốc bị SQL tay dời); đối chứng: tháng < P sạch chốt được", async () => {
    const k = await kb("per03a", { rules: [{ vai: "SALE", rate: 0.03 }] });
    // (i)
    await expect(chotKyHoaHong(AUD, { period: P, reason: KY_VONG })).rejects.toMatchObject({ code: "PERIOD_IN_NEW_LEDGER" });
    expect(await demBangKe(P)).toBe(0);
    // (ii) tạo dòng sổ mới ở P rồi dời mốc LÊN P+1 bằng SQL tay (lách cổng đặt mốc)
    const bc = await boiCanh(k, D("2027-03-20"), P);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2027-03-05") });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI" });
    await datMocCutover("2027-04");
    await expect(chotKyHoaHong(AUD, { period: P, reason: KY_VONG })).rejects.toMatchObject({ code: "PERIOD_IN_NEW_LEDGER" });
    expect(await demBangKe(P)).toBe(0);
    // đối chứng dương: tháng cũ sạch ⇒ chốt được, tạo bảng kê
    await datMocCutover(P);
    await expect(chotKyHoaHong(AUD, { period: P2, reason: KY_VONG })).resolves.toMatchObject({ period: P2 });
    expect(await demBangKe(P2)).toBe(1);
  });

  it("[NHH-PER-03d] reopenStatement TỪ CHỐI kỳ APPROVED khi mốc ≠ null; đối chứng: mốc null ⇒ mở lại được như hôm nay", async () => {
    await db.commissionStatement.create({ data: { period: P2, status: "APPROVED", approvedAt: new Date() } });
    await expect(reopenStatement({ ...AUD, isSuperAdmin: true }, P2, "mở lại thử")).rejects.toMatchObject({ code: "REOPEN_AFTER_CUTOVER" });
    expect((await db.commissionStatement.findUniqueOrThrow({ where: { period: P2 } })).status).toBe("APPROVED");
    await datMocCutover(null);
    await expect(reopenStatement({ ...AUD, isSuperAdmin: true }, P2, "mở lại khi chưa có mốc")).resolves.toMatchObject({ status: "REOPENED" });
  });

  it("[NHH-PER-03e] setGlobalSetting({ key: 'hoaHong.kyCutover' }) ⇒ TỪ CHỐI, SystemSetting KHÔNG đổi (kể cả SUPER_ADMIN, giá trị hợp lệ)", async () => {
    const truoc = await giaTriMoc();
    const r = await setGlobalSetting(SA.actor, { key: "hoaHong.kyCutover", value: "2028-01", reason: "đổi thử mốc", actorName: SA.ten });
    expect(r).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await giaTriMoc()).toBe(truoc);
    expect(truoc).toBe(P);
  });

  it("[NHH-PER-03f] approveStatement TỪ CHỐI tháng thuộc sổ mới; đối chứng: bảng kê tháng cũ duyệt được", async () => {
    await db.commissionStatement.create({ data: { period: P, status: "DRAFT" } }); // bảng kê "ma" của tháng mới (SQL tay)
    await expect(approveStatement(AUD, P, "duyệt thử")).rejects.toMatchObject({ code: "PERIOD_IN_NEW_LEDGER" });
    expect((await db.commissionStatement.findUniqueOrThrow({ where: { period: P } })).status).toBe("DRAFT");
    await db.commissionStatement.create({ data: { period: P1, status: "DRAFT" } });
    await expect(approveStatement(AUD, P1, "duyệt kỳ cũ")).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("[NHH-PER-03i] gọi THẲNG setStatementLines và ensureCommissionStatement cho kỳ ≥ P ⇒ TỪ CHỐI, 0 bảng kê; đối chứng: kỳ < P vẫn làm được", async () => {
    await expect(setStatementLines(AUD, { period: P, lines: [], reason: KY_VONG })).rejects.toMatchObject({ code: "PERIOD_IN_NEW_LEDGER" });
    await expect(ensureCommissionStatement(D("2027-03-15"))).rejects.toMatchObject({ code: "PERIOD_IN_NEW_LEDGER" });
    expect(await demBangKe(P)).toBe(0);
    await expect(setStatementLines(AUD, { period: P2, lines: [], reason: KY_VONG })).resolves.toMatchObject({ period: P2 });
    await expect(ensureCommissionStatement(D("2027-02-15"))).resolves.toMatchObject({ period: P1, approved: false });
  });

  // ── Manifest chủ sở hữu bút toán (PR0m) ──────────────────────────────────────────────────────

  it("[NHH-PER-03j] chotKyHoaHong ghi MANIFEST đầy đủ vào audit chốt: TOÀN BỘ id đã nạp (> 20 khoản, không cắt) + napLuc; số dòng bảng kê không đổi", async () => {
    const k = await kb("per03j", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const be = await dungBe(k, "a", { tongTien: 50_000_000 });
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push(await tienVe(k, be, { soTien: 100_000, ngay: new Date(`2027-01-${String(2 + (i % 20)).padStart(2, "0")}T03:00:00.000Z`) }));
    const truoc = new Date();
    const kq = await chotKyHoaHong(AUD, { period: P2, reason: KY_VONG });
    expect(kq.soButToan).toBeGreaterThanOrEqual(22);
    const stmt = await db.commissionStatement.findUniqueOrThrow({ where: { period: P2 } });
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionStatement", entityId: stmt.id, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    const nv = a.newValues as { paymentIds: string[]; napLuc: string; lineCount: number };
    expect(nv.paymentIds.length).toBeGreaterThanOrEqual(22);
    expect(ids.every((id) => nv.paymentIds.includes(id))).toBe(true); // không id nào bị cắt (note cũ chỉ in 20)
    expect(new Date(nv.napLuc).getTime()).toBeGreaterThanOrEqual(truoc.getTime());
    expect(new Date(nv.napLuc).getTime()).toBeLessThanOrEqual(Date.now()); // LÚC BẮT ĐẦU đọc — không thể ở tương lai
    expect(nv.lineCount).toBe(await db.commissionLine.count({ where: { statementId: stmt.id } }));
  });

  it("[NHH-PER-03g] datMocCutover TỪ CHỐI khi có kỳ < P APPROVED KHÔNG manifest (THIEU_MANIFEST, nêu kỳ nào); đối chứng: bảng kê duyệt SAU chốt thật (có manifest) ⇒ đặt được", async () => {
    await datMocCutover(null);
    await db.commissionStatement.create({ data: { period: P2, status: "APPROVED", approvedAt: new Date() } }); // duyệt trước PR0m: không có audit chốt
    const lan1 = datMoc(db, SA, { mocMoi: P, lyDo: "đặt mốc chuyển hoa hồng mới", now: D("2027-02-10") });
    await expect(lan1).rejects.toMatchObject({ ma: "THIEU_MANIFEST" });
    await expect(lan1).rejects.toThrowError(new RegExp(P2));
    expect(await giaTriMoc()).toBeNull();

    await donBangKe();
    await chotKyHoaHong(AUD, { period: P2, reason: KY_VONG }); // chốt THẬT ⇒ ghi manifest
    await approveStatement(AUD, P2, "duyệt kỳ cũ");
    const r = await datMoc(db, SA, { mocMoi: P, lyDo: "đặt mốc chuyển hoa hồng mới", now: D("2027-02-10") });
    expect(r).toMatchObject({ cu: null, moi: P, hanhDong: "DAT_LAN_DAU" });
    expect(await giaTriMoc()).toBe(P);
  });

  it("[NHH-PER-03h]/[NHH-COM-12c] khoản PENDING trước lần chốt, xác nhận SAU duyệt ⇒ chủ MỚI: dòng ở kỳ OPEN ≥ P, lateArrival, KHÔNG có kỳ < P; khoản NẰM TRONG manifest ⇒ chủ CŨ, hoàn sau P ⇒ LEGACY_REVERSAL", async () => {
    const k = await kb("per03h", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const be = await dungBe(k, "a", { tongTien: 20_000_000 });
    const bi = await dungBe(k, "b", { tongTien: 20_000_000 });
    const trong = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2027-02-10") }); // đã xác nhận trước chốt ⇒ vào manifest
    const cho = await tienVe(k, bi, { soTien: 10_000_000, ngay: D("2027-02-12"), xacNhan: false }); // PENDING lúc chốt
    await chotKyHoaHong(AUD, { period: P1, reason: KY_VONG });
    await approveStatement(AUD, P1, "duyệt kỳ cũ");
    const c = await confirmPayment({ paymentId: cho, confirmedById: k.ketToanB.id });
    expect(c.ok).toBe(true);

    const bc = await boiCanh(k, D("2027-03-20"), P);
    expect(await quetKhoan(db, bc, trong)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" }); // trong manifest ⇒ engine cũ đã trả
    const r = await quetKhoan(db, bc, cho);
    expect(r).toMatchObject({ loai: "DA_GHI", kyGhi: P, lateArrival: true, tong: 300_000 });
    expect((await dongSoCuaKhoan(cho))[0]).toMatchObject({ entryKind: "LATE_ARRIVAL", naturalPeriod: P1, lateArrival: true });
    expect(await db.commissionPeriod.count({ where: { centerId: k.centerId, period: { lt: P } } })).toBe(0);

    // COM-12c: hoàn khoản trong manifest SAU mốc ⇒ LEGACY_REVERSAL (gốc ở bảng kê cũ ĐÃ DUYỆT, biết chắc nhờ manifest) — KHÔNG phải MANUAL_REVIEW
    const hoan = await hoanTien(k, trong, { soTien: 4_000_000, ngay: D("2027-03-08") });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO_LEGACY", soDong: 4, tong: -320_000, kyGhi: P });
    expect(await db.commissionHold.count({ where: { paymentId: hoan } })).toBe(0);
  });

  // ── datMocCutover — các nhánh đặt / dời / gỡ trên DB thật ────────────────────────────────────

  it("[NHH-PER-03c] datMocCutover: đặt P tương lai sạch ⇒ được + AuditLog; dời MUỘN / GỠ khi đã có dòng sổ mới ⇒ TỪ CHỐI; đặt khi đã có bảng kê ≥ P ⇒ TỪ CHỐI", async () => {
    await datMocCutover(null);
    const ls = { lyDo: "đặt mốc chuyển hoa hồng mới", now: D("2027-02-10") };
    // đặt khi đã có bảng kê cũ cho tháng ≥ P ⇒ từ chối
    await db.commissionStatement.create({ data: { period: P, status: "DRAFT" } });
    await expect(datMoc(db, SA, { mocMoi: P, ...ls })).rejects.toMatchObject({ ma: "CO_BANG_KE_CU" });
    expect(await giaTriMoc()).toBeNull();
    await donBangKe();

    // đối chứng dương
    const r = await datMoc(db, SA, { mocMoi: P, ...ls });
    expect(r).toMatchObject({ cu: null, moi: P, hanhDong: "DAT_LAN_DAU" });
    expect(await giaTriMoc()).toBe(P);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: "hoaHong.kyCutover" }, orderBy: { createdAt: "desc" } });
    expect(a).toMatchObject({ action: "CREATE", reason: ls.lyDo });
    expect(a.newValues).toMatchObject({ value: P, hanhDong: "DAT_LAN_DAU" });

    // tạo dòng sổ mới ở kỳ P rồi thử dời muộn / gỡ
    const k = await kb("per03c", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2027-03-20"), P);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2027-03-05") });
    await quetKhoan(db, bc, id);
    await expect(datMoc(db, SA, { mocMoi: "2027-05", ...ls, now: D("2027-03-25") })).rejects.toMatchObject({ ma: "CO_DONG_SO_MOI" });
    await expect(datMoc(db, SA, { mocMoi: null, ...ls, now: D("2027-03-25") })).rejects.toMatchObject({ ma: "CO_DONG_SO_MOI" });
    expect(await giaTriMoc()).toBe(P); // không đổi
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } })).toBeGreaterThan(0);
  });

  it("[NHH-PER-03c3] ranh giới KHOẢNG của dời MUỘN là [P, P') — dòng sổ mới nằm ĐÚNG ở tháng P' (mốc mới) KHÔNG chặn: tháng P' vẫn thuộc sổ mới sau khi dời, chỉ [P, P') đổi chủ", async () => {
    await datMocCutover(P);
    const k = await kb("per03c3", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc = await boiCanh(k, D("2027-03-20"), P);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2027-03-05") });
    await quetKhoan(db, bc, id); // dòng sổ mới ở ĐÚNG tháng P = 2027-03
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: id } } })).toBeGreaterThan(0);

    // mốc đang ở tháng liền trước (đặt thẳng — dựng trạng thái), dời muộn lên đúng P: khoảng [P1, P) KHÔNG có dòng nào
    await datMocCutover(P1);
    const r = await datMoc(db, SA, { mocMoi: P, lyDo: "dời mốc muộn một tháng", now: D("2027-02-10") });
    expect(r).toMatchObject({ cu: P1, moi: P, hanhDong: "DOI_MUON" });
    expect(await giaTriMoc()).toBe(P);
  });

  it("[NHH-PER-03l] datMocCutover CẢNH BÁO (không chặn) vai đang hoạt động mà chưa có chính sách ACTIVE hiệu lực tại đầu kỳ P; vai CÓ chính sách (kể cả bản có hạn effectiveTo SAU đầu kỳ) thì KHÔNG bị liệt kê", async () => {
    await datMocCutover(null);
    const ma = `zcb${Date.now().toString(36)}`;
    const thieu = await db.beneficiaryRole.create({ data: { code: `${ma}A`.toUpperCase(), name: "Vai fixture thiếu chính sách", resolverType: "DIRECT_PERSON", isActive: true, sortOrder: 9001 } });
    const co = await db.beneficiaryRole.create({ data: { code: `${ma}B`.toUpperCase(), name: "Vai fixture có chính sách", resolverType: "DIRECT_PERSON", isActive: true, sortOrder: 9002 } });
    const pol = await db.commissionPolicy.create({ data: { policyCode: `${ma}-pol`, name: `CS ${ma}` } });
    const doc = await db.regulationDocument.create({
      data: { documentCode: `${ma}-vb`, title: "Quy định fixture", issuedOn: D("2026-02-20"), publishedOn: D("2026-02-20"), effectiveOn: D("2026-03-20"), approvedByName: "fixture" },
    });
    const ver = await db.commissionPolicyVersion.create({
      data: {
        policyId: pol.id,
        versionNo: 1,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-03-20T17:00:00.000Z"),
        effectiveTo: new Date("2099-01-01T00:00:00.000Z"), // CÓ hạn nhưng hạn SAU đầu kỳ P ⇒ vẫn hiệu lực tại P
        reason: "fixture",
        documentId: doc.id,
        scopeType: "GLOBAL",
        scopeKey: "GLOBAL",
        activatedAt: D("2026-03-20"),
      },
    });
    await db.commissionRule.create({ data: { versionId: ver.id, transactionTypeCode: "NEW", beneficiaryRoleId: co.id, revenueComponent: "TUITION", calcKind: "PERCENT", rate: 0.01 } });
    try {
      const r = await datMoc(db, SA, { mocMoi: P, lyDo: "đặt mốc để đo cảnh báo", now: D("2027-02-10") });
      expect(r.hanhDong).toBe("DAT_LAN_DAU");
      expect(r.canhBao.join(" | ")).toContain(thieu.code);
      expect(r.canhBao.join(" | ")).not.toContain(co.code);
      expect(await giaTriMoc()).toBe(P); // cảnh báo KHÔNG chặn
      // dời MUỘN không cảnh báo (vùng sổ mới không mở rộng)
      await datMocCutover(P1);
      const muon = await datMoc(db, SA, { mocMoi: P, lyDo: "dời mốc muộn một tháng", now: D("2027-02-10") });
      expect(muon).toMatchObject({ hanhDong: "DOI_MUON", canhBao: [] });
    } finally {
      // XOÁ HẲN (không chỉ vô hiệu): master `BeneficiaryRole` là danh mục dùng chung — bộ chính sách đòi đúng 10 vai ([NHH-POL-MIG-01]), nên vai fixture sót lại làm đỏ bộ khác (luật 18).
      await db.commissionRule.deleteMany({ where: { versionId: ver.id } });
      await db.commissionPolicyVersion.deleteMany({ where: { id: ver.id } });
      await db.commissionPolicy.deleteMany({ where: { id: pol.id } });
      await db.regulationDocument.deleteMany({ where: { id: doc.id } });
      await db.beneficiaryRole.deleteMany({ where: { id: { in: [thieu.id, co.id] } } });
    }
  });

  // ⚠️ Sổ BẤT BIẾN và DB test TÍCH dòng qua các lượt chạy (không dọn được) ⇒ ca nào cần "chưa có dòng sổ mới nào ở kỳ ≥ mốc" phải đặt mốc ở tháng KHÔNG BAO GIỜ có dữ liệu
  // (2099-xx), không phải P. Dùng P ở đây thì xanh lần đầu rồi đỏ từ lần chạy thứ hai — ca 'gỡ ok' phụ thuộc vào rác của ca trước (luật 18).
  const XA = "2099-06";
  const XA_SOM = "2099-05";

  it("[NHH-PER-03c2] chỉ SUPER_ADMIN và lý do ≥ 10 ký tự; dời SỚM sạch ⇒ được; gỡ khi chưa có dòng sổ mới ⇒ được (CUT-8 rollback trước khi dùng)", async () => {
    await datMocCutover(XA);
    const ls = { lyDo: "đặt mốc chuyển hoa hồng mới", now: D("2098-12-10") };
    const ko = await seedUser({ email: `fx-nhh-ko-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Không phải SA", phone: null });
    const khong = { actor: await actorCua(ko.id), ten: "Không phải SA" };
    await expect(datMoc(db, khong, { mocMoi: XA_SOM, ...ls })).rejects.toMatchObject({ ma: "KHONG_CO_QUYEN" });
    await expect(datMoc(db, SA, { mocMoi: XA_SOM, lyDo: "ngắn", now: ls.now })).rejects.toMatchObject({ ma: "THIEU_LY_DO" });
    expect(await giaTriMoc()).toBe(XA);

    const som = await datMoc(db, SA, { mocMoi: XA_SOM, ...ls });
    expect(som).toMatchObject({ cu: XA, moi: XA_SOM, hanhDong: "DOI_SOM" });
    expect(await giaTriMoc()).toBe(XA_SOM);
    const go = await datMoc(db, SA, { mocMoi: null, ...ls });
    expect(go).toMatchObject({ cu: XA_SOM, moi: null, hanhDong: "GO" });
    expect(await giaTriMoc()).toBeNull();
    expect(await db.auditLog.count({ where: { entityType: "SystemSetting", entityId: "hoaHong.kyCutover", action: "DELETE" } })).toBeGreaterThan(0);
  });

  it("[NHH-PER-03k] khoá advisory: lượt GHI SỔ đang dở (khoá chia sẻ) ⇒ datMocCutover (độc quyền) PHẢI CHỜ nó xong rồi mới kiểm cổng/ghi — không lọt vào giữa 'đã đọc mốc' và 'đã ghi dòng'", async () => {
    await datMocCutover(XA);
    let giai!: () => void;
    const giu = new Promise<void>((r) => (giai = r));
    const dangGhi = chayTrongKhoa(db, { khoaKhoan: ["khoa-thu-cutover"], kyCutoverDaDoc: XA }, async () => {
      await giu;
    });
    await new Promise((r) => setTimeout(r, 400)); // để lượt ghi chiếm khoá chia sẻ
    let xong = false;
    const doiMoc = datMoc(db, SA, { mocMoi: null, lyDo: "gỡ mốc khi chưa dùng", now: D("2098-12-10") }).then(() => {
      xong = true;
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(xong, "datMocCutover không được chạy xong khi lượt ghi sổ còn giữ khoá").toBe(false);
    giai();
    await dangGhi;
    await doiMoc;
    expect(xong).toBe(true);
    expect(await giaTriMoc()).toBeNull();
  });

  // ── GV Trial khi convert — PER-04 (A10) ───────────────────────────────────────────────────────

  it("[NHH-PER-04b] gọi THẲNG recordTrialTeacherCommission (đường seed UAT còn gọi nó) với bảng kê của tháng thuộc sổ MỚI ⇒ không ghi dòng nào, trả 'thuoc-so-moi'; đối chứng: tháng cũ ghi được", async () => {
    const k = await kb("per04b", { rules: [{ vai: "TRIAL_TEACHER", rate: 0.01 }] });
    const gv = await seedUser({ email: `${k.ma}-gv@ci.test`, role: "TEACHER", name: `${k.ma}-gv`, phone: null });
    const be = await dungBe(k, "a");
    // bảng kê "ma" của tháng mới (SQL tay — đường tạo bình thường đã bị cổng chặn) + bảng kê của tháng cũ
    const ma = await db.commissionStatement.create({ data: { period: P, status: "DRAFT" } });
    const cu = await db.commissionStatement.create({ data: { period: P1, status: "DRAFT" } });
    const ghi = (st: { id: string; period: string }) =>
      db.$transaction((tx) =>
        recordTrialTeacherCommission(tx, { statement: { id: st.id, period: st.period, approved: false }, teacherUserId: gv.id, enrollmentId: be.enrollmentId, finalPrice: 5_000_000, leadId: k.lead!.id }),
      );
    expect(await ghi(ma)).toEqual({ ok: false, reason: "thuoc-so-moi", period: P, amount: 50_000 });
    expect(await db.commissionLine.count({ where: { statementId: ma.id } })).toBe(0);
    expect(await ghi(cu)).toEqual({ ok: true, amount: 50_000 });
    expect(await db.commissionLine.count({ where: { statementId: cu.id, tier: "TRIAL_TEACHER" } })).toBe(1);
  });

  it("[NHH-PER-04] convert trong tháng thuộc sổ MỚI ⇒ KHÔNG tạo CommissionStatement, KHÔNG ghi CommissionLine(TRIAL_TEACHER); đối chứng: tháng P−1 ⇒ có bảng kê + dòng 1%", async () => {
    const chay = async (ten: string, ngay: string) => {
      const k = await kb(ten, { rules: [{ vai: "TRIAL_TEACHER", rate: 0.01 }] });
      const gv = await seedUser({ email: `${k.ma}-gv@ci.test`, role: "TEACHER", name: `${k.ma}-gv`, phone: null });
      const leadChildId = await themGvTrial(k, gv.id, "gv");
      const order = await db.order.create({ data: { code: `ORD-${k.ma}`.toUpperCase(), type: "COURSE", customerName: "PH", customerPhone: "0900000000", leadId: k.lead!.id, centerId: k.centerId } });
      await db.payment.create({ data: { orderId: order.id, amount: 5_000_000, method: "cash", paidDate: new Date(), saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: k.centerId } });
      const actor = await seedUser({ email: `${k.ma}-sale@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale`, phone: null });
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(ngay) }); // chỉ đồng hồ `Date` — convert đọc `new Date()` để chọn kỳ
      try {
        const res = await convertLeadV2(
          { id: actor.id, name: `${k.ma}-sale` },
          {
            leadId: k.lead!.id,
            parentEmail: `${k.ma}-ph@ci.test`,
            parentName: "PH",
            parentPhone: `0905${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
            idempotencyKey: `${k.ma}-idem`,
            students: [{ leadChildId, name: `Bé ${k.ma}`, courseId: k.khoa.id, listPrice: 5_000_000, classId: k.lop.id, consentMedia: false }],
          },
        );
        expect(res.ok, JSON.stringify(res)).toBe(true);
        return res.ok ? res.enrollmentIds[0]! : "";
      } finally {
        vi.useRealTimers();
      }
    };

    const moi = await chay("per04moi", "2027-03-15T05:00:00.000Z"); // tháng thuộc sổ MỚI
    expect(await demBangKe(P)).toBe(0);
    expect(await db.commissionLine.count({ where: { enrollmentId: moi } })).toBe(0);

    const cu = await chay("per04cu", "2027-02-15T05:00:00.000Z"); // P−1: đường cũ vẫn chạy
    expect(await demBangKe(P1)).toBe(1);
    expect(await db.commissionLine.count({ where: { enrollmentId: cu, tier: "TRIAL_TEACHER" } })).toBe(1);
  });
});
