// @vitest-environment node
/**
 * [SRC-INT-23..27] — TÍCH HỢP ĐỔI NGUỒN SAU THANH TOÁN (lane C2 · mục 5): sổ cũ KHÔNG bị sửa · đề xuất + audit · tách nhiệm người yêu cầu / duyệt 1 / duyệt 2 · ngưỡng hai cấp theo YÊU CẦU LOGIC
 * (D2 = SUM_ABS_LOGICAL_EVENT) · cả đường GỘP LEAD. Postgres THẬT; đổi nguồn đi qua `doiNguonLead` / `gopLead` thật, sổ do ENGINE THẬT tính, duyệt bằng `duyetDeXuat` thật.
 *
 * Phần đã có ca riêng (KHÔNG làm lại): `[GHH-01..06]` (gộp lead phát sự kiện + «Áp dụng» bị chặn), `[SEG-01..03]` (tách nhiệm trên đường đổi nguồn THƯỜNG), `[YC-01..05]` (yêu cầu logic, đường thường),
 * `[HNS-01..06]` (D2 trên hàng chờ), `[DXD-*]` (CHECK/trigger của đề xuất). Phần CHƯA có ca nào, và là lý do tệp tồn tại:
 *
 *   [SRC-INT-23] ĐƯỜNG GỘP LEAD: người đề xuất = người BẤM GỘP (`payload.actorId` của sự kiện) — người ấy (dù giữ cả hai khoá duyệt) KHÔNG duyệt, KHÔNG từ chối đề xuất do chính mình gộp ra; sổ không đổi;
 *                audit `GOP_LEAD_NGUON` có; đối chứng dương: người khác duyệt ⇒ SOURCE_CORRECTION về đúng phụ huynh. (SRC-09: trùng SĐT ⇒ gộp, nguồn đổi theo first-claim.)
 *   [SRC-INT-24] ĐƯỜNG GỘP + HAI CẤP: ngưỡng thấp ⇒ SECOND_APPROVAL_REQUIRED; người gộp ≠ cấp 1 ≠ cấp 2 (cấp 1 không làm cấp 2; người gộp không làm cấp nào); sổ chỉ ghi sau cấp 2; DB lưu đủ BA người khác nhau.
 *   [SRC-INT-25] KHÔNG TÁCH NHỎ ĐỂ NÉ NGƯỠNG (đường gộp): MỘT lượt gộp chạm HAI ô, mỗi ô +100.000 < ngưỡng 150.000 nhưng Σ yêu cầu = 200.000 ≥ ngưỡng ⇒ CẢ HAI đề xuất cấp hai (TU_NGUONG_YEU_CAU);
 *                đối chứng dương: ngưỡng 250.000 ⇒ cả hai MỘT người.
 *   [SRC-INT-26] SỔ CŨ KHÔNG MUTATE (đường thường): đổi nguồn sau thu ⇒ dòng sổ cũ byte-identical qua: sự kiện · đề xuất PENDING · audit · duyệt; chỉ THÊM dòng SOURCE_CORRECTION (mang nguồn MỚI) trỏ về dòng gốc;
 *                audit `DOI_NGUON_SAU_THU` + `APPROVE_POST` có đủ; quét lại sau duyệt ⇒ KHONG_DOI (không điều chỉnh đôi).
 *   [SRC-INT-27] NGƯỠNG ĐỌC TỪ `hoaHong.nguongDuyetHaiCap` LÚC LẬP, ĐI HẾT ĐƯỜNG THẬT: không đặt ⇒ mặc định; đặt thấp ⇒ cấp hai + `thresholdSnapshot` đúng số; đặt HỎNG ⇒ cấp hai (fail-closed);
 *                đổi setting SAU khi lập không đổi đề xuất cũ.
 *
 * LUẬT 18: mỗi ca tự dựng hiện trường, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối. Chạy: `pnpm test:hoa-hong-db`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import type { Actor } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { duyetDeXuat, tuChoiDeXuat, type NguoiDuyetDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { KHOA_DUYET_DE_XUAT } from "../../lib/hoa-hong/quan-tri-dieu-chinh";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { gopLead } from "../../lib/lead/gop-lead";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { clearSettingsCache } from "../../lib/settings/service";
import { capKhoaGhiNguon, damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, donViHoiSo, dongSoCuaKhoan, dungBe, dungKichBan, ganNguon, ganVai, nguoiKyHo, themChinhSachNhom, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[SRC-INT-doi-nguon] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
const SU_KIEN = "nguon.da-doi-sau-thanh-toan";
const CO_SAU: KiemQuyen = async (action) => action === "sources:override-after-payment";
const actorCoSo = (userId: string, centerId: string) =>
  capKhoaGhiNguon(({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor);

const datNguong = async (v: unknown | null) => {
  await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
  if (v !== null) await db.systemSetting.create({ data: { key: KHOA_NGUONG, valueJson: v as never } });
  clearSettingsCache();
};

describe.skipIf(!RUN_DB_TESTS)("[SRC-INT-DOI] tích hợp đổi nguồn sau thanh toán — đề xuất · tách nhiệm · ngưỡng · gộp lead", () => {
  const cuaToi: KichBan[] = [];
  let NGUOI: Awaited<ReturnType<typeof nguoiKyHo>>;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
  }, 120_000);
  beforeEach(async () => {
    await datNguong(null);
  });
  afterAll(async () => {
    await datNguong(null);
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  /** Một người giữ CẢ HAI khoá duyệt (kế toán HO + nhân sự HO) — người «nguy hiểm nhất» của tách nhiệm. */
  async function nguoiHaiKhoa(ten: string): Promise<NguoiDuyetDeXuat> {
    const u = await seedUser({ email: `${ten}-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: ten, phone: null });
    const ho = await donViHoiSo();
    await ganVai(u.id, ho, "HO_ACCOUNTANT");
    await ganVai(u.id, ho, "HO_HR");
    const quyen = await actorCua(u.id);
    expect(can(quyen, KHOA_DUYET_DE_XUAT.DISPUTE)).toBe(true); // không đủ hai khoá thì ca không chứng minh gì (luật 11)
    expect(can(quyen, KHOA_DUYET_DE_XUAT.SOURCE_CHANGE)).toBe(true);
    return { userId: u.id, ten, quyen };
  }

  const demDieuChinh = (paymentId: string) => db.commissionTransaction.count({ where: { entryKind: { in: ["INPUT_CORRECTION", "SOURCE_CORRECTION", "DISPUTE_ADJUSTMENT"] }, calcSlot: { paymentId } } });
  const dxCua = (paymentId: string) => db.commissionAdjustmentRequest.findFirstOrThrow({ where: { paymentId, origin: "SOURCE_CHANGE" }, orderBy: { createdAt: "desc" } });
  const chupSo = async (khoan: string) =>
    (await dongSoCuaKhoan(khoan)).map((d) => ({ id: d.id, entryKind: d.entryKind, roleCode: d.roleCode, beneficiaryUserId: d.beneficiaryUserId, amount: d.amount, sourceGroupCode: d.sourceGroupCode, inputHash: d.inputHash, createdAt: d.createdAt.toISOString(), resolverBasis: d.resolverBasis }));

  /** Lead PAID_ADS + `soKhoan` khoản thu 10tr (mỗi khoản một bé ⇒ một ô) ĐÃ QUÉT; chính sách PARENT_REFERRAL REFERRER_PARENT 1% (⇒ mỗi ô +100.000 nếu đổi sang PH giới thiệu). */
  async function dung(ten: string, soKhoan = 1) {
    const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS", { attributedAt: D("2026-10-01") });
    const bc = await boiCanh(k, NOW);
    const khoan: string[] = [];
    for (let i = 0; i < soKhoan; i++) {
      const id = await tienVe(k, await dungBe(k, `b${i}`), { soTien: 10_000_000, ngay: D(`2026-10-1${i + 2}`) });
      await quetKhoan(db, bc, id);
      khoan.push(id);
    }
    return { k, ph, nhom, bc, khoan, goc: khoan[0]! };
  }

  // ── đường THƯỜNG ──────────────────────────────────────────────────────────────────────────────────
  async function doiNguonThuong(x: Awaited<ReturnType<typeof dung>>, nguoiDoi: string) {
    const kq = await doiNguonLead({
      actor: actorCoSo(nguoiDoi, x.k.centerId),
      actorName: "Người đổi",
      kiemQuyen: CO_SAU,
      leadId: x.k.lead!.id,
      groupId: x.nhom.PARENT_REFERRAL,
      thamChieu: { employeeId: null, parentUserId: x.ph.id, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
      bayGio: NOW,
    });
    expect(kq).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    return (await db.domainEvent.findMany({ where: { type: SU_KIEN, dedupeKey: { startsWith: `${SU_KIEN}:${x.k.lead!.id}:` } }, orderBy: { createdAt: "desc" } }))[0]!;
  }

  // ── đường GỘP ────────────────────────────────────────────────────────────────────────────────────
  /** Lead PHỤ cùng SĐT với lead chính, mang quy nguồn PARENT_REFERRAL SỚM hơn (⇒ thắng first-claim, đổi nguồn lead chính). */
  async function leadPhu(x: Awaited<ReturnType<typeof dung>>, hau: string) {
    const lead = await db.lead.create({ data: { parentName: `${x.k.ma}-${hau}`, phone: x.k.lead!.phone, status: "DA_DANG_KY", convertedById: x.k.sale.id, adminId: x.k.saleAdmin.id, centerId: x.k.centerId } });
    await ganNguon({ ...x.k, lead }, "PARENT_REFERRAL", { phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    return lead;
  }
  async function gop(x: Awaited<ReturnType<typeof dung>>, nguoiGop: string) {
    const phu = await leadPhu(x, "phu");
    const kq = await gopLead(db, { phuId: phu.id, chinhId: x.k.lead!.id, apply: true, actorName: "Hệ thống (gộp lead)", actorUserId: nguoiGop });
    expect(kq.nguon.cach).toBe("PHU_THANG");
    const evs = await db.domainEvent.findMany({ where: { type: SU_KIEN, payloadJson: { path: ["leadId"], equals: x.k.lead!.id } }, orderBy: { createdAt: "asc" } });
    expect(evs).toHaveLength(1);
    expect(evs[0]!.dedupeKey).toBe(`${SU_KIEN}:${x.k.lead!.id}:gop:${phu.id}`);
    return evs[0]!;
  }
  /** Đúng thứ consumer thật (`onNguonDaDoiSauThanhToan`) làm: người đề xuất lấy từ `payload.actorId` của sự kiện, không từ nơi nào khác. */
  async function lapDeXuat(x: Awaited<ReturnType<typeof dung>>, ev: { id: string; payloadJson: unknown }) {
    const actorId = (ev.payloadJson as { actorId?: unknown }).actorId;
    expect(typeof actorId).toBe("string");
    return apDungDoiNguonSauThu(db, x.bc, { leadId: x.k.lead!.id, refEventId: ev.id, requestedById: actorId as string });
  }

  it("[SRC-INT-23] gộp lead: người BẤM GỘP là người đề xuất ⇒ dù giữ cả hai khoá cũng không duyệt / không từ chối đề xuất của chính mình; sổ không đổi; người khác duyệt được", async () => {
    // Cấy: bỏ `requestedById` khỏi `lyDoKhongDuocDuyet` ⇒ hai `rejects` không ném ⇒ đỏ. Cấy 2: `baoDoiNguonKhiGop` đặt `actorId` = null/khác người bấm ⇒ đề xuất mang sai người ⇒ ca `requestedById` đỏ.
    const nguoiGop = await nguoiHaiKhoa("src23-gop");
    const x = await dung("src23");
    const ev = await gop(x, nguoiGop.userId);
    expect(ev.payloadJson).toMatchObject({ actorId: nguoiGop.userId, tuNhom: "PAID_ADS", denNhom: "PARENT_REFERRAL" });
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: x.k.lead!.id, action: "GOP_LEAD_NGUON" } })).toBeGreaterThan(0); // đổi nguồn do gộp có dấu vết audit trên lead chính
    const soTruoc = await chupSo(x.goc);

    expect((await lapDeXuat(x, ev)).theoKetQua).toEqual({ DE_XUAT: 1 });
    const dx = await dxCua(x.goc);
    expect(dx).toMatchObject({ requestedById: nguoiGop.userId, status: "PENDING", governance: "SINGLE_APPROVAL", origin: "SOURCE_CHANGE", leadId: x.k.lead!.id });
    expect(await chupSo(x.goc)).toEqual(soTruoc); // lập đề xuất KHÔNG ghi sổ

    await expect(duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: nguoiGop, lyDo: "Tự duyệt đề xuất do chính mình gộp lead" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
    await expect(tuChoiDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: nguoiGop, lyDo: "Tự từ chối đề xuất do chính mình gộp lead" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
    expect(await demDieuChinh(x.goc)).toBe(0);
    expect((await dxCua(x.goc)).status).toBe("PENDING");
    expect(await chupSo(x.goc)).toEqual(soTruoc);

    // đối chứng DƯƠNG: người KHÁC cùng khoá duyệt ⇒ ghi sổ, về đúng phụ huynh
    expect(await duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Người khác đối chiếu và đồng ý điều chỉnh do gộp lead" })).toMatchObject({ loai: "DA_GHI" });
    const moi = await db.commissionTransaction.findMany({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: x.goc } }, select: { roleCode: true, beneficiaryUserId: true, amount: true } });
    expect(moi.some((d) => d.roleCode === "REFERRER_PARENT" && d.beneficiaryUserId === x.ph.id && d.amount === 100_000)).toBe(true);
  });

  it("[SRC-INT-24] gộp lead + hai cấp: người gộp ≠ cấp 1 ≠ cấp 2; cấp 1 không làm cấp 2; sổ chỉ ghi sau cấp 2; DB lưu BA người khác nhau", async () => {
    // Cấy: bỏ nhánh `cap === 2 && nguoiDuyetId === approver1Id` ⇒ cấp 1 tự làm cấp 2 ⇒ đỏ (và DB `khac_nguoi_chk` là lưới dưới cùng).
    await datNguong(50_000);
    const nguoiGop = await seedUser({ email: `src24-gop-${Date.now().toString(36)}@ci.test`, role: "SALES_CSM", name: "src24 gop", phone: null });
    const cap1 = await nguoiHaiKhoa("src24-cap1");
    const x = await dung("src24");
    const ev = await gop(x, nguoiGop.id);
    await lapDeXuat(x, ev);
    const dx = await dxCua(x.goc);
    expect(dx).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", status: "PENDING", requestedById: nguoiGop.id, thresholdSnapshot: 50_000 });

    expect(await duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: cap1, lyDo: "Cấp 1 đã đối chiếu nguồn sau gộp lead" })).toMatchObject({ loai: "DA_DUYET_CAP_1" });
    await expect(duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: cap1, lyDo: "Cấp 1 tự duyệt cấp 2 của chính mình" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
    expect(await demDieuChinh(x.goc)).toBe(0);
    expect((await dxCua(x.goc)).status).toBe("APPROVED_L1");

    expect(await duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Cấp 2 đồng ý ghi điều chỉnh vào sổ" })).toMatchObject({ loai: "DA_GHI", cap: 2 });
    const xong = await dxCua(x.goc);
    expect(xong.status).toBe("POSTED");
    expect(new Set([xong.requestedById, xong.approver1Id, xong.approver2Id]).size).toBe(3);
    expect(await demDieuChinh(x.goc)).toBeGreaterThan(0);
  });

  it("[SRC-INT-25] KHÔNG TÁCH NHỎ ĐỂ NÉ NGƯỠNG (gộp lead): một lượt gộp chạm hai ô, mỗi ô +100.000 < ngưỡng 150.000 nhưng Σ yêu cầu 200.000 ≥ ngưỡng ⇒ CẢ HAI cấp hai; ngưỡng 250.000 ⇒ cả hai MỘT người", async () => {
    // Cấy: `duBaoTongYeuCau` bỏ qua anh em cùng yêu cầu (dùng riêng từng ô) ⇒ cả hai đề xuất SINGLE ở nhánh ngưỡng 150.000 ⇒ đỏ.
    const nguoiGop = await seedUser({ email: `src25-gop-${Date.now().toString(36)}@ci.test`, role: "SALES_CSM", name: "src25 gop", phone: null });
    for (const [nguong, kyVong] of [
      [150_000, "SECOND_APPROVAL_REQUIRED"],
      [250_000, "SINGLE_APPROVAL"],
    ] as const) {
      await datNguong(nguong);
      const x = await dung(`src25-${nguong}`, 2);
      const ev = await gop(x, nguoiGop.id);
      expect((await lapDeXuat(x, ev)).theoKetQua).toEqual({ DE_XUAT: 2 });
      for (const khoan of x.khoan) {
        const dx = await dxCua(khoan);
        expect(dx.absTotal, `ngưỡng ${nguong}`).toBe(100_000); // mỗi ô một mình KHÔNG đạt ngưỡng 150.000
        expect(dx.governance, `ngưỡng ${nguong}`).toBe(kyVong);
        if (kyVong === "SECOND_APPROVAL_REQUIRED") expect(JSON.stringify(dx.governanceWhy)).toContain("TU_NGUONG_YEU_CAU");
        else expect(JSON.stringify(dx.governanceWhy)).not.toContain("TU_NGUONG_YEU_CAU");
      }
    }
  });

  it("[SRC-INT-26] sổ cũ KHÔNG mutate (đường thường): dòng cũ byte-identical qua sự kiện · đề xuất · duyệt; chỉ THÊM SOURCE_CORRECTION mang nguồn mới; audit đủ; quét lại ⇒ không điều chỉnh đôi", async () => {
    // Cấy: consumer `apDungDoiNguonSauThu` ghi thẳng dòng điều chỉnh (bỏ qua đề xuất) ⇒ `demDieuChinh` ≠ 0 trước khi duyệt ⇒ đỏ. Cấy 2: `duyetDeXuat` sửa dòng gốc thay vì thêm dòng ⇒ `soTruoc` lệch ⇒ đỏ.
    const x = await dung("src26");
    const nguoiDoi = await seedUser({ email: `${x.k.ma}-doi@ci.test`, role: "SALES_CSM", name: `${x.k.ma}-doi`, phone: null });
    const soTruoc = await chupSo(x.goc);
    expect(soTruoc.every((d) => d.sourceGroupCode === "PAID_ADS")).toBe(true);

    const ev = await doiNguonThuong(x, nguoiDoi.id);
    expect(await chupSo(x.goc)).toEqual(soTruoc); // sự kiện đổi nguồn KHÔNG chạm sổ
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: x.k.lead!.id, action: "DOI_NGUON_SAU_THU", actorId: nguoiDoi.id } })).toBe(1);

    expect((await lapDeXuat(x, ev)).theoKetQua).toEqual({ DE_XUAT: 1 });
    const dx = await dxCua(x.goc);
    expect(dx).toMatchObject({ status: "PENDING", requestedById: nguoiDoi.id, refEventId: ev.id });
    expect(await chupSo(x.goc)).toEqual(soTruoc); // đề xuất PENDING KHÔNG chạm sổ
    expect(await demDieuChinh(x.goc)).toBe(0);

    expect(await duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Đối chiếu xác nhận phụ huynh giới thiệu, đồng ý điều chỉnh" })).toMatchObject({ loai: "DA_GHI" });
    const sau = await chupSo(x.goc);
    const idCu = new Set(soTruoc.map((d) => d.id));
    expect(sau.filter((d) => idCu.has(d.id))).toEqual(soTruoc); // dòng cũ nguyên văn (so theo id: `dongSoCuaKhoan` sắp theo vai nên dòng mới có thể chen trước)
    const them = sau.filter((d) => !idCu.has(d.id));
    expect(them.length).toBeGreaterThan(0);
    expect(them.every((d) => d.entryKind === "SOURCE_CORRECTION")).toBe(true); // chỉ THÊM, và chỉ loại điều chỉnh
    expect(them.some((d) => d.roleCode === "REFERRER_PARENT" && d.amount === 100_000 && d.sourceGroupCode === "PARENT_REFERRAL")).toBe(true); // nguồn MỚI nằm ở dòng MỚI

    expect(await db.auditLog.count({ where: { entityType: "CommissionAdjustmentRequest", entityId: dx.id, action: "APPROVE_POST" } })).toBe(1);
    // quét lại: không còn gì để điều chỉnh — không ghi đôi
    const r = await quetKhoan(db, x.bc, x.goc);
    expect(r.loai).toBe("KHONG_DOI");
    expect(await chupSo(x.goc)).toEqual(sau);
  });

  it("[SRC-INT-27] ngưỡng đọc từ hoaHong.nguongDuyetHaiCap LÚC LẬP: không đặt ⇒ một người; đặt thấp ⇒ cấp hai + snapshot đúng; đặt HỎNG ⇒ cấp hai (fail-closed); đổi setting sau không đổi đề xuất cũ", async () => {
    // Cấy: `docNguongHaiCap` bỏ nhánh «hỏng ⇒ null» (trả mặc định khi giá trị sai kiểu) ⇒ ca «hỏng» ra SINGLE ⇒ đỏ.
    const nguoiDoi = await seedUser({ email: `src27-doi-${Date.now().toString(36)}@ci.test`, role: "SALES_CSM", name: "src27 doi", phone: null });
    const ca = async (ten: string, nguong: unknown | null) => {
      await datNguong(nguong);
      const x = await dung(ten);
      const ev = await doiNguonThuong(x, nguoiDoi.id);
      await lapDeXuat(x, ev);
      return { x, dx: await dxCua(x.goc) };
    };

    const macDinh = await ca("src27a", null);
    expect(macDinh.dx).toMatchObject({ governance: "SINGLE_APPROVAL" });
    expect(macDinh.dx.thresholdSnapshot).toBeGreaterThan(macDinh.dx.absTotal); // ngưỡng mặc định lớn hơn 100.000

    const thap = await ca("src27b", 50_000);
    expect(thap.dx).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", thresholdSnapshot: 50_000 });

    const hong = await ca("src27c", "không phải số");
    expect(hong.dx.governance).toBe("SECOND_APPROVAL_REQUIRED");
    expect(hong.dx.thresholdSnapshot).toBeNull();

    // đổi setting SAU khi lập: đề xuất đã lập giữ nguyên mức đã chụp
    await datNguong(10_000_000);
    expect(await dxCua(thap.x.goc)).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", thresholdSnapshot: 50_000 });
  });
});
