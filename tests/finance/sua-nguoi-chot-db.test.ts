// tests/finance/sua-nguoi-chot-db.test.ts — [SNC-DB-*] «sửa Lead.convertedById legacy» trên Postgres THẬT: đọc đầu vào → kế hoạch → cổng ghi Wave 1 → ghi → kiểm sau ghi.
//
// Chạy bộ này:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/sua-nguoi-chot-db.test.ts`). `pnpm test:unit` trần SKIP — log "SKIP" nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `SNC_`; KHÔNG `resetDb()`; mọi hàm DB nhận PHẠM VI = đúng id lead fixture (không "TAT_CA").
// Kỳ `2099-05`/`2099-06`: `CommissionStatement.period` là @unique toàn cục — cấm đụng kỳ thật.
//
// Ánh xạ yêu cầu → ca: HIGH→Sale thật [01,02] · mơ hồ→fail-closed [01] · đã đúng→skip [01,03] · lead không BACKFILL→skip [09] · rerun idempotent [03] · digest tất định (unit [SNC-30]) ·
// lệch số đếm/sha [06] · chữ ký/nonce/replay [04,05] · apply không chạy khi chưa qua cổng [04,10] · trôi trạng thái [07] · lỗi muộn ⇒ cả lượt lùi [08] · kỳ đã duyệt [01,07c].
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";
import { dungCongGhiThu, OWNER_THU, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_SUA_NGUOI_CHOT,
  docKeHoachSuaNguoiChot,
  ghiSuaNguoiChot,
  ghiSuaNguoiChotTrongTx,
  kiemSauGhi,
  tinhTacDongKy,
  type DauVaoGhiSuaNguoiChot,
  type PhamViSuaNguoiChot,
} from "@/lib/nguon/sua-nguoi-chot-db";
import type { ChinhSachE2, KeHoachSuaNguoiChot } from "@/lib/nguon/sua-nguoi-chot";
import type { QuyetDinhOwner } from "@/lib/nguon/sua-nguoi-chot-quyet-dinh";

if (!RUN_DB_TESTS) console.warn(`[SNC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "SNC_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const U_ADMIN = `${P}u_admin`;
const U_LIEN = `${P}u_lien`;
const U_VAN = `${P}u_van`;
// Người nhận của QUYẾT ĐỊNH OWNER: Sale có Employee + mã nhân viên (khoá để planner giải ra User.id). Mã TEST, không phải mã thật.
const U_NHAN_A = `${P}u_nhan_a`; // Sale CS1
const U_NHAN_B = `${P}u_nhan_b`; // Sale CS2
const U_QUAN_TRI_CO_MA = `${P}u_quantri_ma`; // SUPER_ADMIN nhưng CÓ mã nhân viên ⇒ không phải Sale hợp lệ
const MA_A = `${P}NV.A`;
const MA_B = `${P}NV.B`;
const MA_QT = `${P}NV.QT`;
const KY_THU = "2099-06";
const KY_DUYET = "2099-05";
const NGAY_THU = new Date("2099-06-15T03:00:00.000Z");
const NGAY_THU_DUYET = new Date("2099-05-15T03:00:00.000Z");
const T_IMPORT = new Date("2026-08-07T01:13:57.000Z");
const MOC = new Date("2026-10-15T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9300001", runAttempt: "1" } } as const;
const KHOA_LUOT = `luot:${LUOT.nguonChay.runId}:${LUOT.nguonChay.runAttempt}`;
// Tên gọi lạ để KHÔNG trùng nhân sự thật/seed trong DB test (planner đối chiếu tên Excel với MỌI Sale).
const TEN_LIEN = "Snczelien";
const GHI_CHU_LIEN = `[Import ĐK Excel] Sales: ${TEN_LIEN} · Nguồn: Ads`;

const POL: ChinhSachE2 = "GIU_XEM_TAY";
const phamVi = (...ids: string[]): PhamViSuaNguoiChot => ({ leadIds: ids.map((i) => `${P}${i}`) });
const CG = (kh: KeHoachSuaNguoiChot, o: Partial<TuyChinhCongGhi> = {}) => dungCongGhiThu(WORKFLOW_WAVE1.suaNguoiChot, kh.dongDauRa, { now: MOC, ...o });
const nhap = (pv: PhamViSuaNguoiChot, kh: KeHoachSuaNguoiChot, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiSuaNguoiChot> = {}): DauVaoGhiSuaNguoiChot => ({
  phamVi: pv,
  chinhSachE2: kh.chinhSachE2,
  soDuyet: kh.soGhi,
  soDuyetXemTay: kh.soXemTay,
  keHoachSha: kh.sha,
  ghiDuoc: true,
  actor: ACTOR_SUA_NGUOI_CHOT,
  luotChay: LUOT,
  congGhi,
  quyetDinh: [],
  ...o,
});

async function don() {
  const orders = await db.order.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) {
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: leadIds } } });
    await db.leadStatusHistory.deleteMany({ where: { leadId: { in: leadIds } } });
  }
  await db.auditLog.deleteMany({ where: { entityType: "SuaNguoiChotLegacy", entityId: KHOA_LUOT } });
  await db.auditLog.deleteMany({ where: { module: "write-gate", actorName: OWNER_THU } });
  const stmts = await db.commissionStatement.findMany({ where: { period: { in: [KY_THU, KY_DUYET] } }, select: { id: true } });
  if (stmts.length) {
    const ids = stmts.map((s) => s.id);
    await db.commissionLine.deleteMany({ where: { statementId: { in: ids } } });
    await db.commissionStatement.deleteMany({ where: { id: { in: ids } } });
  }
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
}

async function donCoDinh() {
  await db.user.deleteMany({ where: { id: { startsWith: P } } });
  await db.employee.deleteMany({ where: { id: { startsWith: P } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function taoNguoi(id: string, name: string, o: { centerId: string | null; role: "SALES_CSM" | "SUPER_ADMIN"; isActive?: boolean; deletedAt?: Date | null; maNhanVien?: string }) {
  if (o.maNhanVien !== undefined) await db.employee.create({ data: { id: `${P}e_${id}`, employeeCode: o.maNhanVien, fullName: name, jobTitle: "Tu van tuyen sinh", department: "KINH_DOANH" } });
  await db.user.create({
    data: { id, name, email: `${id}@test.invalid`, role: o.role, roles: [o.role], centerId: o.centerId, isActive: o.isActive ?? true, deletedAt: o.deletedAt ?? null, employeeId: o.maNhanVien !== undefined ? `${P}e_${id}` : null },
  });
}

/** Lead có dòng BACKFILL_IMPORT (người chạy = U_ADMIN) và người chốt = U_ADMIN, trừ khi nói khác. */
async function taoLead(ten: string, o: { phone: string; note?: string | null; assignedToId?: string | null; convertedById?: string | null; coImport?: boolean; centerId?: string }) {
  const id = `${P}${ten}`;
  await db.lead.create({
    data: {
      id,
      parentName: id,
      phone: o.phone,
      status: "DA_DANG_KY",
      centerId: o.centerId ?? CS1,
      note: o.note === undefined ? null : o.note,
      assignedToId: o.assignedToId === undefined ? null : o.assignedToId,
      convertedById: o.convertedById === undefined ? U_ADMIN : o.convertedById,
      convertedAt: T_IMPORT,
    },
  });
  if (o.coImport !== false) {
    await db.auditLog.create({
      data: {
        actorId: U_ADMIN,
        actorName: "SNC admin",
        module: "enrollment",
        entityType: "Lead",
        entityId: id,
        action: "STATUS_CHANGE",
        reason: "BACKFILL_IMPORT: nhập liệu ban đầu, chưa ghi nhận khoản thu trong hệ thống",
        changedFields: [],
        createdAt: T_IMPORT,
      },
    });
  }
  return id;
}

async function taoDon(ma: string, o: { leadId?: string | null; customerPhone?: string; centerId?: string }) {
  return db.order.create({
    data: {
      id: `${P}o_${ma}`,
      code: `${P}${ma}`,
      type: "COURSE",
      customerName: "PH",
      customerPhone: o.customerPhone ?? "0900000000",
      totalAmount: 1,
      centerId: o.centerId ?? CS2,
      leadId: o.leadId ?? null,
    },
    select: { id: true },
  });
}

async function taoThu(orderId: string, amount: number, paidDate: Date) {
  return db.payment.create({
    data: {
      id: `${P}p_${orderId}`,
      orderId,
      amount,
      method: "CASH",
      paidDate,
      confirmedAt: new Date(paidDate.getTime() + 3_600_000),
      centerId: CS2,
      saleStatus: "RECORDED",
      accountantStatus: TRANG_THAI_THUC_THU[0],
    },
  });
}

const nguoiChot = async (ids: string[]) => Object.fromEntries((await db.lead.findMany({ where: { id: { in: ids } }, select: { id: true, convertedById: true } })).map((l) => [l.id, l.convertedById]));
const demDauVet = async () => ({
  audit: await db.auditLog.count(),
  wg: await db.auditLog.count({ where: { module: "write-gate", actorName: OWNER_THU } }),
});

describe.skipIf(!RUN_DB_TESTS)("[SNC-DB] sửa Lead.convertedById legacy — DB thật", () => {
  beforeAll(async () => {
    await don();
    await donCoDinh();
    await db.center.create({ data: { id: CS1, name: "SNC cơ sở 1", slug: `${P}cs1-slug`, address: "Không có thật" } });
    await db.center.create({ data: { id: CS2, name: "SNC cơ sở 2", slug: `${P}cs2-slug`, address: "Không có thật" } });
    await taoNguoi(U_ADMIN, "SNC Admin", { centerId: null, role: "SUPER_ADMIN" });
    await taoNguoi(U_LIEN, `Nguyen ${TEN_LIEN}`, { centerId: CS2, role: "SALES_CSM" });
    await taoNguoi(U_VAN, "Nguyen Sncvan", { centerId: CS2, role: "SALES_CSM" });
    await taoNguoi(U_NHAN_A, "Snc Nhan A", { centerId: CS1, role: "SALES_CSM", maNhanVien: MA_A });
    await taoNguoi(U_NHAN_B, "Snc Nhan B", { centerId: CS2, role: "SALES_CSM", maNhanVien: MA_B });
    await taoNguoi(U_QUAN_TRI_CO_MA, "Snc Quan tri", { centerId: CS1, role: "SUPER_ADMIN", maNhanVien: MA_QT });
  });
  beforeEach(don);
  afterAll(async () => {
    await don();
    await donCoDinh();
    await db.$disconnect();
  });

  /**
   * Hiện trường:
   *  l1 — Excel «Snczelien» = người được gán + Liên TỰ có hoạt động trước import, đơn CHƯA nối (MOT qua SĐT) ⇒ REASSIGN → U_LIEN (E2 độc lập)
   *  l2 — không bằng chứng, đơn ĐÃ nối                                                ⇒ CLEAR → NULL
   *  l3 — người chốt đã là Sale hợp lệ                                                ⇒ ALREADY_CORRECT
   *  l4 — Excel khớp NHƯNG đơn đã nối có thu trong kỳ APPROVED                       ⇒ MANUAL_REVIEW (không ghi)
   *  (E2 một nguồn, ngoài mẫu, đọc dấu vết độc lập từ bảng thật: các ca [SNC-DB-14..16])
   */
  async function hienTruong() {
    const l1 = await taoLead("l1", { phone: "84900008001", note: GHI_CHU_LIEN, assignedToId: U_LIEN });
    const l2 = await taoLead("l2", { phone: "84900008002" });
    const l3 = await taoLead("l3", { phone: "84900008003", convertedById: U_VAN });
    const l4 = await taoLead("l4", { phone: "84900008004", note: GHI_CHU_LIEN, assignedToId: U_LIEN });
    await db.leadActivity.create({ data: { leadId: l1, actorId: U_LIEN, actorName: "SNC Lien", type: "NOTE", content: "Sale tu cham lead truoc import", createdAt: new Date(T_IMPORT.getTime() - 86_400_000) } });
    const o1 = await taoDon("1", { customerPhone: "0900008001" }); // chưa nối
    const o2 = await taoDon("2", { leadId: l2 });
    const o3 = await taoDon("3", { leadId: l3 });
    const o4 = await taoDon("4", { leadId: l4 });
    await taoThu(o1.id, 10_000_000, NGAY_THU);
    await taoThu(o2.id, 10_000_000, NGAY_THU);
    await taoThu(o3.id, 10_000_000, NGAY_THU);
    await taoThu(o4.id, 10_000_000, NGAY_THU_DUYET);
    await db.commissionStatement.create({ data: { period: KY_DUYET, status: "APPROVED" } });
    const pv = phamVi("l1", "l2", "l3", "l4");
    const { kh, dauVao } = await docKeHoachSuaNguoiChot(db, pv, POL, []);
    return { l1, l2, l3, l4, o1, o2, o3, o4, pv, kh, dauVao, ids: [l1, l2, l3, l4] };
  }

  it("[SNC-DB-01] kế hoạch trên hiện trường: HIGH → Sale thật · mơ hồ → NULL · đã đúng → giữ · kỳ đã duyệt → xem tay; đơn liên quan nói rõ đường (ĐÃ NỐI / MOT)", async () => {
    const { kh, dauVao, l1, l2, l3, l4 } = await hienTruong();
    const dong = Object.fromEntries(kh.dong.map((d) => [d.leadId, d]));
    expect(dong[l1]).toMatchObject({ loai: "REASSIGN", newConvertedById: U_LIEN, evidenceClass: "E2_EXCEL_SALES_VA_BANG_CHUNG_DOC_LAP", campusCheck: "MATCH", confidence: "HIGH" });
    expect(dong[l2]).toMatchObject({ loai: "CLEAR", newConvertedById: null, reasonCode: "KHONG_CO_BANG_CHUNG" });
    expect(dong[l3]).toMatchObject({ loai: "ALREADY_CORRECT", newConvertedById: U_VAN });
    expect(dong[l4]).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "COMMISSION_DA_KHOA_THU_TRONG_KY_DA_DUYET", newConvertedById: U_ADMIN });
    expect(kh.tom).toMatchObject({ tongPhamVi: 4, daDung: 1, seDoi: 1, seXoaVeXemTay: 1, xemTay: 1, khongHopLe: 0, boQua: 0 });
    expect(kh.soGhi).toBe(2);
    expect(kh.soXemTay).toBe(1);
    expect(dauVao.don.find((d) => d.orderId === `${P}o_1`)?.duong).toBe("NOI_DON_MOT");
    expect(dauVao.don.find((d) => d.orderId === `${P}o_2`)?.duong).toBe("DA_NOI");
  });

  it("[SNC-DB-02] ghi hợp lệ: chỉ đổi đúng 2 lead; audit từng lead + audit mức lượt + claim nonce; KHÔNG đụng Order.leadId / Lead.source / attribution", async () => {
    const { kh, pv, l1, l2, l3, l4, o1, o2 } = await hienTruong();
    const truocSource = await db.lead.findMany({ where: { id: { in: [l1, l2] } }, select: { id: true, source: true }, orderBy: { id: "asc" } });
    const { cong, artifact } = CG(kh);
    expect(await ghiSuaNguoiChot(db, nhap(pv, kh, cong))).toEqual({ daGhi: 2, daDoi: 1, daXoa: 1 });
    expect(await nguoiChot([l1, l2, l3, l4])).toEqual({ [l1]: U_LIEN, [l2]: null, [l3]: U_VAN, [l4]: U_ADMIN });
    // audit từng lead
    const au = await db.auditLog.findMany({ where: { entityType: "Lead", action: "LEGACY_CONVERTER_FIX", entityId: { in: [l1, l2] } }, orderBy: { entityId: "asc" } });
    expect(au).toHaveLength(2);
    expect(au[0]!.oldValues).toEqual({ convertedById: U_ADMIN });
    expect(au[0]!.newValues).toMatchObject({ convertedById: U_LIEN, reasonCode: "LEGACY_BACKFILL_CONVERTER_FIX", approvalNonce: artifact.payload.nonce, approvalDigest: artifact.payload.inputDigest, runRef: "test:1" });
    expect(au[1]!.newValues).toMatchObject({ convertedById: null, dongLoai: "CLEAR", dongLyDo: "KHONG_CO_BANG_CHUNG" });
    // audit mức lượt + claim
    const luot = await db.auditLog.findMany({ where: { entityType: "SuaNguoiChotLegacy", entityId: KHOA_LUOT } });
    expect(luot).toHaveLength(1);
    expect(luot[0]!.newValues).toMatchObject({ expectedCount: 2, expectedReview: 1, keHoachSha: kh.sha, actualCount: 2, reassigned: 1, clearedToReview: 1, khop: true });
    const wg = await db.auditLog.findMany({ where: { id: `wg:${artifact.payload.nonce}` } });
    expect(wg).toHaveLength(1);
    expect(wg[0]!.newValues).toMatchObject({ workflow: WORKFLOW_WAVE1.suaNguoiChot, expectedRowCount: kh.dongDauRa.length, appliedRowCount: kh.dongDauRa.length });
    // KHÔNG đụng chỗ khác
    expect((await db.order.findUnique({ where: { id: o1.id }, select: { leadId: true } }))!.leadId).toBeNull();
    expect((await db.order.findUnique({ where: { id: o2.id }, select: { leadId: true } }))!.leadId).toBe(l2);
    expect(await db.lead.findMany({ where: { id: { in: [l1, l2] } }, select: { id: true, source: true }, orderBy: { id: "asc" } })).toEqual(truocSource);
    expect(await db.leadAttribution.count({ where: { leadId: { in: [l1, l2, l3, l4] } } })).toBe(0);
  });

  it("[SNC-DB-03] IDEMPOTENT: sau khi ghi, lập lại kế hoạch ⇒ 0 dòng GHI; ghi lại với --expect=0 là no-op (không cần artifact, không dấu vết); kiểm sau ghi sạch + dựng dòng hoàn tác", async () => {
    const { kh, pv, l1, l2 } = await hienTruong();
    await ghiSuaNguoiChot(db, nhap(pv, kh, CG(kh).cong));
    const { kh: kh2 } = await docKeHoachSuaNguoiChot(db, pv, POL, []);
    expect(kh2.soGhi).toBe(0);
    expect(kh2.dong.find((d) => d.leadId === l1)).toMatchObject({ loai: "ALREADY_CORRECT" });
    expect(kh2.dong.find((d) => d.leadId === l2)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "DA_BO_TRONG_FAIL_CLOSED" });
    const truoc = await demDauVet();
    const congRong: DauVaoCongGhi = { ...CG(kh2).cong, artifact: null };
    expect(await ghiSuaNguoiChot(db, nhap(pv, kh2, congRong))).toEqual({ daGhi: 0, daDoi: 0, daXoa: 0 });
    expect(await demDauVet()).toEqual(truoc);
    const k = await kiemSauGhi(db, pv, POL, []);
    expect(k).toMatchObject({ conLaiCanGhi: 0, banGhiAudit: 2, troiTraiAudit: [], hong: 0 });
    expect(k.hoanTac).toEqual([
      { leadId: l1, hienTaiMongDoi: U_LIEN, hoanVe: U_ADMIN },
      { leadId: l2, hienTaiMongDoi: null, hoanVe: U_ADMIN },
    ]);
    // ai đó đổi lại sau khi ghi ⇒ kiểm sau ghi BÁO trôi
    await db.lead.update({ where: { id: l1 }, data: { convertedById: U_VAN } });
    expect((await kiemSauGhi(db, pv, POL, [])).troiTraiAudit).toEqual([l1]);
  });

  const TU_CHOI: Array<[string, string, (kh: KeHoachSuaNguoiChot) => Partial<TuyChinhCongGhi> | "thieu"]> = [
    ["[SNC-DB-04a] sai digest (owner ký dòng khác)", "LECH_DIGEST", (kh) => ({ rowsKy: kh.dongDauRa.map((d, i) => (i === 1 ? `${d}x` : d)) })],
    ["[SNC-DB-04b] hết hạn", "HET_HAN", () => ({ hanGio: 1, nowCong: new Date("2026-10-15T04:03:01.000Z") })],
    ["[SNC-DB-04c] sai workflow (artifact của nối đơn)", "SAI_WORKFLOW", () => ({ workflowKy: WORKFLOW_WAVE1.noiDon })],
    ["[SNC-DB-04d] sai môi trường", "SAI_MOI_TRUONG", () => ({ moiTruongKy: "prod" })],
    ["[SNC-DB-04e] thiếu artifact", "THIEU_ARTIFACT", () => "thieu"],
    ["[SNC-DB-04f] chưa ghim vân tay", "KHOA_KHONG_KHOP", () => ({ ghim: "" })],
  ];
  it.each(TU_CHOI)("%s ⇒ %s, ABORT trước phép ghi đầu: người chốt không đổi · 0 dòng audit mới · 0 hàng wg:", async (_ten, maMong, tao) => {
    const { kh, pv, ids } = await hienTruong();
    const o = tao(kh);
    const c = o === "thieu" ? { ...CG(kh).cong, artifact: null } : CG(kh, o).cong;
    const truoc = { ...(await demDauVet()), chot: await nguoiChot(ids) };
    const loi = await ghiSuaNguoiChot(db, nhap(pv, kh, c)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).toBeInstanceOf(CongGhiTuChoi);
    expect((loi as CongGhiTuChoi).ma).toBe(maMong);
    expect({ ...(await demDauVet()), chot: await nguoiChot(ids) }).toEqual(truoc);
    // đối chứng dương: cùng hiện trường, artifact ĐÚNG ⇒ ghi được
    expect((await ghiSuaNguoiChot(db, nhap(pv, kh, CG(kh).cong))).daGhi).toBe(2);
  });

  it("[SNC-DB-05] REPLAY: cùng artifact dùng lần hai ⇒ DA_DUNG, người chốt giữ nguyên như vừa đặt lại (cổng nonce chứ không phải tính idempotent của updateMany)", async () => {
    const { kh, pv, ids, l1 } = await hienTruong();
    const { cong } = CG(kh);
    await ghiSuaNguoiChot(db, nhap(pv, kh, cong));
    // đặt lại hiện trường như trước khi ghi, rồi phát lại ĐÚNG artifact đó
    await db.lead.updateMany({ where: { id: { in: [`${P}l1`, `${P}l2`] } }, data: { convertedById: U_ADMIN } });
    const truoc = await nguoiChot(ids);
    expect(truoc[l1]).toBe(U_ADMIN);
    await expect(ghiSuaNguoiChot(db, nhap(pv, kh, cong))).rejects.toMatchObject({ ma: "DA_DUNG" });
    expect(await nguoiChot(ids)).toEqual(truoc);
    // và gọi THẲNG trong tx (bỏ lượt kiểm sớm) vẫn vỡ khoá chính wg:<nonce>
    await expect(db.$transaction((tx) => ghiSuaNguoiChotTrongTx(tx, nhap(pv, kh, cong)))).rejects.toMatchObject({ ma: "DA_DUNG" });
    expect(await nguoiChot(ids)).toEqual(truoc);
  });

  it("[SNC-DB-06] số đếm / sha lệch ⇒ KHÔNG ghi gì (không cần artifact đúng): --expect, --expect-review, --ke-hoach-sha, thiếu tham số", async () => {
    const { kh, pv, ids } = await hienTruong();
    const { cong } = CG(kh);
    const truoc = { ...(await demDauVet()), chot: await nguoiChot(ids) };
    const ca: Array<[string, Partial<DauVaoGhiSuaNguoiChot>]> = [
      ["--expect lệch", { soDuyet: kh.soGhi + 1 }],
      ["--expect-review lệch", { soDuyetXemTay: kh.soXemTay + 1 }],
      ["--ke-hoach-sha lệch", { keHoachSha: "0".repeat(64) }],
      ["thiếu --expect", { soDuyet: null }],
      ["thiếu --expect-review", { soDuyetXemTay: null }],
      ["thiếu --ke-hoach-sha", { keHoachSha: null }],
      ["kết nối chỉ đọc", { ghiDuoc: false }],
    ];
    for (const [ten, o] of ca) {
      await expect(ghiSuaNguoiChot(db, nhap(pv, kh, cong, o)), ten).rejects.toThrow();
      expect({ ...(await demDauVet()), chot: await nguoiChot(ids) }, ten).toEqual(truoc);
    }
    expect((await ghiSuaNguoiChot(db, nhap(pv, kh, cong))).daGhi).toBe(2); // đối chứng dương
  });

  it("[SNC-DB-06b] cổng số đếm/sha nằm TRONG transaction: gọi THẲNG ghiSuaNguoiChotTrongTx (bỏ lượt kiểm trước tx) với artifact ĐÚNG nhưng --expect / --expect-review / --ke-hoach-sha sai ⇒ vẫn ném, 0 đổi, nonce chưa đốt", async () => {
    const { kh, pv, ids } = await hienTruong();
    const { cong, artifact } = CG(kh);
    const truoc = { ...(await demDauVet()), chot: await nguoiChot(ids) };
    for (const o of [{ soDuyet: kh.soGhi + 1 }, { soDuyetXemTay: kh.soXemTay + 1 }, { keHoachSha: "0".repeat(64) }] as Array<Partial<DauVaoGhiSuaNguoiChot>>) {
      await expect(db.$transaction((tx) => ghiSuaNguoiChotTrongTx(tx, nhap(pv, kh, cong, o)))).rejects.toThrow(/≠|sha/);
      expect({ ...(await demDauVet()), chot: await nguoiChot(ids) }).toEqual(truoc);
    }
    expect(await db.auditLog.count({ where: { id: `wg:${artifact.payload.nonce}` } })).toBe(0);
    expect(await db.$transaction((tx) => ghiSuaNguoiChotTrongTx(tx, nhap(pv, kh, cong)))).toEqual({ daGhi: 2, daDoi: 1, daXoa: 1 }); // đối chứng dương
  });

  it("[SNC-DB-07] TRÔI TRẠNG THÁI giữa lúc duyệt và lúc ghi ⇒ sha lệch ⇒ ném, 0 đổi: (a) Sale đích bị vô hiệu · (b) người chốt bị ai đó đổi tay · (c) kỳ vừa được DUYỆT", async () => {
    const f = await hienTruong();
    const cong = CG(f.kh).cong;
    const truoc = { ...(await demDauVet()), chot: await nguoiChot(f.ids) };

    await db.user.update({ where: { id: U_LIEN }, data: { isActive: false } });
    await expect(ghiSuaNguoiChot(db, nhap(f.pv, f.kh, cong))).rejects.toThrow(/≠|sha/);
    await db.user.update({ where: { id: U_LIEN }, data: { isActive: true } });

    await db.lead.update({ where: { id: f.l2 }, data: { convertedById: U_VAN } });
    await expect(ghiSuaNguoiChot(db, nhap(f.pv, f.kh, cong))).rejects.toThrow(/≠|sha/);
    await db.lead.update({ where: { id: f.l2 }, data: { convertedById: U_ADMIN } });

    await db.commissionStatement.create({ data: { period: KY_THU, status: "APPROVED" } }); // l2 có thu trong KY_THU và ĐÃ NỐI ⇒ vào xem tay
    await expect(ghiSuaNguoiChot(db, nhap(f.pv, f.kh, cong))).rejects.toThrow(/≠|sha/);
    const { kh: moi } = await docKeHoachSuaNguoiChot(db, f.pv, POL, []);
    expect(moi.dong.find((d) => d.leadId === f.l2)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "COMMISSION_DA_KHOA_THU_TRONG_KY_DA_DUYET" });
    await db.commissionStatement.deleteMany({ where: { period: KY_THU } });

    expect({ ...(await demDauVet()), chot: await nguoiChot(f.ids) }).toEqual(truoc);
    // đối chứng dương: hiện trường trở lại như lúc duyệt ⇒ ghi được
    expect((await ghiSuaNguoiChot(db, nhap(f.pv, f.kh, cong))).daGhi).toBe(2);
  });

  it("[SNC-DB-08] lỗi MUỘN (sau khi đã đổi lead + ghi audit) ⇒ CẢ LƯỢT LÙI: người chốt không đổi · không audit · không claim nonce", async () => {
    const { kh, pv, ids } = await hienTruong();
    const { cong, artifact } = CG(kh);
    const truoc = { ...(await demDauVet()), chot: await nguoiChot(ids) };
    // `batDauLuc` hỏng ⇒ `dungBanGhiLuotSua` ném Ở BƯỚC CUỐI, sau mọi updateMany + audit từng lead
    const hong = { ...LUOT, batDauLuc: new Date("khong-phai-ngay") };
    await expect(ghiSuaNguoiChot(db, nhap(pv, kh, cong, { luotChay: hong }))).rejects.toThrow(/batDauLuc/);
    expect({ ...(await demDauVet()), chot: await nguoiChot(ids) }).toEqual(truoc);
    expect(await db.auditLog.count({ where: { id: `wg:${artifact.payload.nonce}` } })).toBe(0); // nonce CHƯA bị đốt
    expect((await ghiSuaNguoiChot(db, nhap(pv, kh, cong))).daGhi).toBe(2); // artifact vẫn dùng được
  });

  it("[SNC-DB-13] HẬU ĐIỀU KIỆN: một trigger làm ghi ra giá trị KHÁC kế hoạch (updateMany vẫn đổi đúng 1 dòng) ⇒ ném «Hậu điều kiện», cả lượt lùi, nonce chưa đốt", async () => {
    const { kh, pv, ids, l1 } = await hienTruong();
    const { cong, artifact } = CG(kh);
    await db.$executeRaw`CREATE OR REPLACE FUNCTION snc_tamper() RETURNS trigger AS $fn$ BEGIN NEW."convertedById" := 'SNC_u_van'; RETURN NEW; END $fn$ LANGUAGE plpgsql`;
    await db.$executeRaw`CREATE TRIGGER snc_tamper_trg BEFORE UPDATE OF "convertedById" ON "Lead" FOR EACH ROW WHEN (NEW.id = 'SNC_l1') EXECUTE FUNCTION snc_tamper()`;
    try {
      const truoc = { ...(await demDauVet()), chot: await nguoiChot(ids) };
      await expect(ghiSuaNguoiChot(db, nhap(pv, kh, cong))).rejects.toThrow(/Hậu điều kiện/);
      expect({ ...(await demDauVet()), chot: await nguoiChot(ids) }).toEqual(truoc);
      expect((await nguoiChot([l1]))[l1]).toBe(U_ADMIN);
      expect(await db.auditLog.count({ where: { id: `wg:${artifact.payload.nonce}` } })).toBe(0);
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS snc_tamper_trg ON "Lead"`;
      await db.$executeRaw`DROP FUNCTION IF EXISTS snc_tamper()`;
    }
    expect((await ghiSuaNguoiChot(db, nhap(pv, kh, cong))).daGhi).toBe(2); // đối chứng dương: hết trigger ⇒ ghi được
  });

  it("[SNC-DB-09] PHẠM VI: lead có BACKFILL_IMPORT nhưng NGOÀI phạm vi không vào kế hoạch và không bị đụng; lead KHÔNG có BACKFILL_IMPORT chỉ vào như «ngoài mẫu» (xem tay) và không bị ghi", async () => {
    const f = await hienTruong();
    const ngoai = await taoLead("ngoai", { phone: "84900008009" });
    await taoDon("9", { leadId: ngoai });
    const khongImport = await taoLead("khongimport", { phone: "84900008010", coImport: false });
    await taoDon("10", { leadId: khongImport });
    const { kh } = await docKeHoachSuaNguoiChot(db, phamVi("l1", "l2", "l3", "l4", "khongimport"), POL, []);
    // `khongimport` KHÔNG có BACKFILL_IMPORT nhưng do tài khoản người-chạy-import chốt + có đơn ⇒ vào kế hoạch NHƯ «ngoài mẫu» (xem tay), KHÔNG ghi
    expect(kh.dong.map((d) => d.leadId).sort()).toEqual([...f.ids, khongImport].sort());
    expect(kh.dong.find((d) => d.leadId === khongImport)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT" });
    expect(kh.tom.tongPhamVi).toBe(5);
    await ghiSuaNguoiChot(db, nhap(phamVi("l1", "l2", "l3", "l4", "khongimport"), kh, CG(kh).cong));
    expect(await nguoiChot([ngoai, khongImport])).toEqual({ [ngoai]: U_ADMIN, [khongImport]: U_ADMIN });
  });

  it("[SNC-DB-10] gọi THẲNG ghiSuaNguoiChotTrongTx (bỏ lượt kiểm trước tx) mà thiếu artifact ⇒ vẫn ném CongGhiTuChoi, 0 đổi — cổng nằm TRONG transaction", async () => {
    const { kh, pv, ids } = await hienTruong();
    const truoc = { ...(await demDauVet()), chot: await nguoiChot(ids) };
    const c = { ...CG(kh).cong, artifact: null };
    await expect(db.$transaction((tx) => ghiSuaNguoiChotTrongTx(tx, nhap(pv, kh, c)))).rejects.toBeInstanceOf(CongGhiTuChoi);
    expect({ ...(await demDauVet()), chot: await nguoiChot(ids) }).toEqual(truoc);
  });

  it("[SNC-DB-11] kế hoạch có dòng INVALID (id người chốt treo) ⇒ KHÔNG ghi dù đủ ba số + artifact đúng; xử lý xong ⇒ ghi được", async () => {
    await taoLead("hong", { phone: "84900008020", convertedById: `${P}khong_ton_tai` });
    await taoDon("20", { leadId: `${P}hong` });
    const l1 = await taoLead("l1", { phone: "84900008001", note: GHI_CHU_LIEN, assignedToId: U_LIEN });
    await taoDon("1", { leadId: l1 });
    const pv = phamVi("hong", "l1");
    const { kh } = await docKeHoachSuaNguoiChot(db, pv, POL, []);
    expect(kh.tom.khongHopLe).toBe(1);
    await expect(ghiSuaNguoiChot(db, nhap(pv, kh, CG(kh).cong))).rejects.toThrow(/INVALID/);
    expect((await nguoiChot([l1]))[l1]).toBe(U_ADMIN);
    await db.lead.update({ where: { id: `${P}hong` }, data: { convertedById: U_VAN } });
    const { kh: kh2 } = await docKeHoachSuaNguoiChot(db, pv, POL, []);
    expect((await ghiSuaNguoiChot(db, nhap(pv, kh2, CG(kh2).cong))).daGhi).toBe(1);
  });

  it("[SNC-DB-12] tác động hoa hồng THẬT qua engine: nối đơn nguyên trạng ⇒ SALE về Admin; sửa RỒI nối ⇒ SALE về Sale thật; lead bị CLEAR ⇒ SALE treo", async () => {
    const f = await hienTruong();
    const { ky } = await tinhTacDongKy(db, f.kh, f.dauVao);
    const k = ky.find((x) => x.period === KY_THU)!;
    expect(k).toBeDefined();
    const theo = Object.fromEntries(k.sale.map((s) => [s.recipientId, s]));
    // o1 (l1, CHƯA nối): hôm nay không ai nhận; nối nguyên trạng ⇒ Admin; sửa rồi nối ⇒ U_LIEN
    expect(theo[U_LIEN]!.truoc).toBe(0);
    expect(theo[U_LIEN]!.noiDonNhuCu).toBe(0);
    expect(theo[U_LIEN]!.suaVaNoi).toBeGreaterThan(0);
    // o2 (l2, ĐÃ nối, bị CLEAR): hôm nay Admin nhận; sau sửa thì treo
    expect(theo[U_ADMIN]!.truoc).toBeGreaterThan(0);
    expect(theo[U_ADMIN]!.noiDonNhuCu).toBeGreaterThan(theo[U_ADMIN]!.truoc); // + o1 nối nguyên trạng
    expect(theo[U_ADMIN]!.suaVaNoi).toBe(0);
    expect(k.treoSale.chiSua).toBeGreaterThan(k.treoSale.truoc);
    expect(theo[U_VAN]!.truoc).toBeGreaterThan(0); // l3 (đã đúng) không đổi ở mọi kịch bản
    expect(theo[U_VAN]!.suaVaNoi).toBe(theo[U_VAN]!.truoc);
  });

  it("[SNC-DB-14] E2 MỘT NGUỒN: Excel «Sales» = người được gán nhưng KHÔNG dấu vết độc lập ⇒ mặc định CLEAR (hold); chính sách DOI ⇒ REASSIGN MEDIUM; chính sách nằm trong dòng PLAN — artifact ký cho chính sách này KHÔNG dùng được cho chính sách kia", async () => {
    const l5 = await taoLead("l5", { phone: "84900008005", note: GHI_CHU_LIEN, assignedToId: U_LIEN });
    await taoDon("5", { leadId: l5 });
    const pv = phamVi("l5");
    const { kh: giu, dauVao } = await docKeHoachSuaNguoiChot(db, pv, "GIU_XEM_TAY", []);
    expect(dauVao.hanhDong.filter((h) => h.nguoi === U_LIEN)).toEqual([]); // DB thật: không hoạt động/audit/gán nào của Liên trên lead này
    expect(giu.dong[0]).toMatchObject({ loai: "CLEAR", newConvertedById: null, reasonCode: "E2_MOT_NGUON_CHO_DOI_CHIEU", evidenceClass: "E2_MOT_NGUON" });
    expect(giu.tom).toMatchObject({ e2Tong: 1, e2DocLap: 0, e2MotNguon: 1 });
    const { kh: doi } = await docKeHoachSuaNguoiChot(db, pv, "DOI_MOT_NGUON", []);
    expect(doi.dong[0]).toMatchObject({ loai: "REASSIGN", newConvertedById: U_LIEN, confidence: "MEDIUM", evidenceClass: "E2_MOT_NGUON" });
    expect(doi.sha).not.toBe(giu.sha);

    // artifact ký cho DOI, ghi với GIU (cùng số đếm: 1 dòng GHI) ⇒ lõi dựng lại dòng của GIU ⇒ KHÔNG khớp digest ⇒ từ chối, 0 đổi
    const congDoi = CG(doi).cong;
    const truoc = { ...(await demDauVet()), chot: await nguoiChot([l5]) };
    await expect(ghiSuaNguoiChot(db, nhap(pv, giu, congDoi))).rejects.toMatchObject({ ma: "LECH_DIGEST" });
    // và ghi với sha/chính sách của DOI nhưng cờ GIU ⇒ sha kế hoạch lệch
    await expect(ghiSuaNguoiChot(db, nhap(pv, doi, congDoi, { chinhSachE2: "GIU_XEM_TAY" }))).rejects.toThrow(/≠|sha/);
    expect({ ...(await demDauVet()), chot: await nguoiChot([l5]) }).toEqual(truoc);
    // đối chứng dương: đúng chính sách đã ký
    expect((await ghiSuaNguoiChot(db, nhap(pv, doi, congDoi))).daDoi).toBe(1);
    expect((await nguoiChot([l5]))[l5]).toBe(U_LIEN);
  });

  it("[SNC-DB-15] DẤU VẾT ĐỘC LẬP đọc từ BẢNG THẬT: LeadActivity · AuditLog · LeadAssignmentHistory của CHÍNH người đó TRƯỚC import ⇒ E2 ĐỘC LẬP HIGH; sau import ⇒ không tính", async () => {
    const truoc = new Date(T_IMPORT.getTime() - 3_600_000);
    const sau = new Date(T_IMPORT.getTime() + 3_600_000);
    const mk = async (ten: string, phone: string) => {
      const id = await taoLead(ten, { phone, note: GHI_CHU_LIEN, assignedToId: U_LIEN });
      await taoDon(`d_${ten}`, { leadId: id });
      return id;
    };
    const a = await mk("hd", "84900008011");
    const b = await mk("au", "84900008012");
    const c = await mk("gl", "84900008013");
    const d = await mk("sau", "84900008014");
    await db.leadActivity.create({ data: { leadId: a, actorId: U_LIEN, actorName: "x", type: "NOTE", content: "x", createdAt: truoc } });
    await db.auditLog.create({ data: { actorId: U_LIEN, actorName: "x", module: "leads", entityType: "Lead", entityId: b, action: "lead.update", changedFields: [], createdAt: truoc } });
    await db.leadAssignmentHistory.create({ data: { leadId: c, toUserId: U_LIEN, assignedById: U_ADMIN, createdAt: truoc } });
    await db.leadActivity.create({ data: { leadId: d, actorId: U_LIEN, actorName: "x", type: "NOTE", content: "x", createdAt: sau } }); // SAU import
    const { kh } = await docKeHoachSuaNguoiChot(db, phamVi("hd", "au", "gl", "sau"), "GIU_XEM_TAY", []);
    const dong = Object.fromEntries(kh.dong.map((x) => [x.leadId, x]));
    for (const id of [a, b, c]) expect(dong[id], id).toMatchObject({ loai: "REASSIGN", newConvertedById: U_LIEN, confidence: "HIGH", evidenceClass: "E2_EXCEL_SALES_VA_BANG_CHUNG_DOC_LAP" });
    expect(dong[a]!.saleEvidence).toContain("HOAT_DONG");
    expect(dong[b]!.saleEvidence).toContain("AUDIT");
    expect(dong[c]!.saleEvidence).toContain("GAN_LICH_SU");
    expect(dong[d]).toMatchObject({ loai: "CLEAR", reasonCode: "E2_MOT_NGUON_CHO_DOI_CHIEU" }); // hành động SAU import không chứng minh gì về ai chốt
    expect(kh.tom).toMatchObject({ e2Tong: 4, e2DocLap: 3, e2MotNguon: 1, e2MoHo: 0 });
  });

  it("[SNC-DB-16] NGOÀI MẪU đọc từ DB: lead do tài khoản người-chạy-import chốt nhưng KHÔNG có BACKFILL_IMPORT, có đơn ⇒ MANUAL_REVIEW, KHÔNG BAO GIỜ được ghi (kể cả khi ghi các dòng khác)", async () => {
    const f = await hienTruong();
    const ngoai = await taoLead("ngoaimau", { phone: "84900008030", coImport: false, note: GHI_CHU_LIEN, assignedToId: U_LIEN });
    await taoDon("30", { leadId: ngoai });
    const khongPhai = await taoLead("khongphai", { phone: "84900008031", coImport: false, convertedById: U_VAN });
    await taoDon("31", { leadId: khongPhai });
    const pv = phamVi("l1", "l2", "l3", "l4", "ngoaimau", "khongphai");
    const { kh } = await docKeHoachSuaNguoiChot(db, pv, POL, []);
    expect(kh.dong.find((x) => x.leadId === ngoai)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT", newConvertedById: U_ADMIN });
    expect(kh.dong.some((x) => x.leadId === khongPhai)).toBe(false); // người chốt không phải tài khoản import ⇒ không phải mẫu này
    expect(kh.tom.ngoaiMau).toBe(1);
    expect(kh.soXemTay).toBe(2); // l4 (khoá) + ngoaimau
    await ghiSuaNguoiChot(db, nhap(pv, kh, CG(kh).cong));
    expect(await nguoiChot([ngoai, khongPhai, f.l4])).toEqual({ [ngoai]: U_ADMIN, [khongPhai]: U_VAN, [f.l4]: U_ADMIN });
  });

  // ── QUYẾT ĐỊNH CỦA OWNER (23/10/2026): [SNC-DB-17..19] ──────────────────────────────────────────────────────────────────────
  /**
   * Hiện trường (mọi người chốt = U_ADMIN, người chạy import = U_ADMIN):
   *  qa — BACKFILL, CS1, gán U_VAN, đơn CS1        ⇒ quyết định: đổi sang MA_A (CS1)
   *  qb — KHÔNG BACKFILL (ngoài mẫu), CS2, đơn CS2  ⇒ quyết định: đổi sang MA_B (CS2)
   *  qc — KHÔNG BACKFILL (ngoài mẫu), CS2           ⇒ quyết định: GIỮ NGUYÊN
   *  qd — BACKFILL, người chốt đã là Sale U_VAN      ⇒ không quyết định, đã đúng
   *  qe — KHÔNG BACKFILL (ngoài mẫu), KHÔNG quyết định ⇒ vẫn MANUAL_REVIEW (đối chứng: bảng KHÔNG chạm lead ngoài bảng)
   */
  async function hienTruongQuyetDinh() {
    const qa = await taoLead("qa", { phone: "84900009001", assignedToId: U_VAN, centerId: CS1 });
    const qb = await taoLead("qb", { phone: "84900009002", coImport: false, centerId: CS2 });
    const qc = await taoLead("qc", { phone: "84900009003", coImport: false, centerId: CS2 });
    const qd = await taoLead("qd", { phone: "84900009004", convertedById: U_VAN, centerId: CS2 });
    const qe = await taoLead("qe", { phone: "84900009005", coImport: false, centerId: CS2 });
    const oa = await taoDon("qa", { leadId: qa, centerId: CS1 });
    const ob = await taoDon("qb", { leadId: qb, centerId: CS2 });
    const oc = await taoDon("qc", { leadId: qc, centerId: CS2 });
    const od = await taoDon("qd", { leadId: qd, centerId: CS2 });
    const oe = await taoDon("qe", { leadId: qe, centerId: CS2 });
    for (const o of [oa, ob, oc, od, oe]) await taoThu(o.id, 10_000_000, NGAY_THU);
    const quyetDinh: QuyetDinhOwner[] = [
      { leadId: qa, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_A } },
      { leadId: qb, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_B } },
      { leadId: qc, hanhDong: "GIU_NGUYEN" },
    ];
    const pv = phamVi("qa", "qb", "qc", "qd", "qe");
    const { kh, dauVao } = await docKeHoachSuaNguoiChot(db, pv, POL, quyetDinh);
    return { qa, qb, qc, qd, qe, pv, quyetDinh, kh, dauVao, ids: [qa, qb, qc, qd, qe] };
  }
  const nhapQD = (f: Awaited<ReturnType<typeof hienTruongQuyetDinh>>, kh: KeHoachSuaNguoiChot, congGhi: DauVaoCongGhi) => nhap(f.pv, kh, congGhi, { quyetDinh: f.quyetDinh });
  const nenLead = async (ids: string[]) =>
    (await db.lead.findMany({ where: { id: { in: ids } }, select: { id: true, assignedToId: true, convertedAt: true, status: true, source: true, centerId: true }, orderBy: { id: "asc" } }));

  it("[SNC-DB-17] GHI theo quyết định owner: người nhận giải từ mã nhân viên; chỉ đổi convertedById (assignedToId · convertedAt · status · nguồn · đơn · sổ hoa hồng KHÔNG đổi); lead GIỮ và lead ngoài bảng nguyên vẹn; audit mang mã owner", async () => {
    const f = await hienTruongQuyetDinh();
    const { kh } = f;
    expect(kh.dong.find((d) => d.leadId === f.qa)).toMatchObject({ loai: "REASSIGN", newConvertedById: U_NHAN_A, evidenceClass: "OWNER_QUYET_DINH", confidence: "OWNER", campusCheck: "MATCH" });
    expect(kh.dong.find((d) => d.leadId === f.qb)).toMatchObject({ loai: "REASSIGN", newConvertedById: U_NHAN_B, campusCheck: "MATCH" });
    expect(kh.dong.find((d) => d.leadId === f.qc)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_GIU_NGUYEN", newConvertedById: U_ADMIN });
    expect(kh.dong.find((d) => d.leadId === f.qd)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "NGUOI_CHOT_LA_SALE_HOP_LE" });
    expect(kh.dong.find((d) => d.leadId === f.qe)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT" });
    expect(kh).toMatchObject({ soGhi: 2, soXemTay: 1 });
    expect(kh.tom).toMatchObject({ ownerDoi: 2, ownerGiu: 1, khongHopLe: 0, ngoaiMau: 1 });

    const nenTruoc = await nenLead(f.ids);
    const donTruoc = await db.order.findMany({ where: { code: { startsWith: P } }, select: { id: true, leadId: true, totalAmount: true }, orderBy: { id: "asc" } });
    const congTruoc = { dongKy: await db.commissionLine.count(), soMoi: await db.commissionTransaction.count({ where: { leadId: { in: f.ids } } }) };
    const { cong, artifact } = CG(kh);
    const r = await ghiSuaNguoiChot(db, nhapQD(f, kh, cong));
    expect(r).toEqual({ daGhi: 2, daDoi: 2, daXoa: 0 });

    expect(await nguoiChot(f.ids)).toEqual({ [f.qa]: U_NHAN_A, [f.qb]: U_NHAN_B, [f.qc]: U_ADMIN, [f.qd]: U_VAN, [f.qe]: U_ADMIN });
    expect(await nenLead(f.ids)).toEqual(nenTruoc); // assignedToId, convertedAt, status, source, centerId: y nguyên
    expect(await db.order.findMany({ where: { code: { startsWith: P } }, select: { id: true, leadId: true, totalAmount: true }, orderBy: { id: "asc" } })).toEqual(donTruoc);
    expect({ dongKy: await db.commissionLine.count(), soMoi: await db.commissionTransaction.count({ where: { leadId: { in: f.ids } } }) }).toEqual(congTruoc);

    const au = await db.auditLog.findMany({ where: { entityType: "Lead", action: "LEGACY_CONVERTER_FIX", entityId: { in: f.ids } }, orderBy: { entityId: "asc" } });
    expect(au.map((a) => a.entityId)).toEqual([f.qa, f.qb]); // lead GIỮ và lead ngoài bảng KHÔNG có audit sửa
    for (const a of au) {
      expect(a.reason).toMatch(/^OWNER_DECISION_CONVERTER_FIX:/);
      expect(a.oldValues).toEqual({ convertedById: U_ADMIN });
      expect(a.newValues).toMatchObject({ reasonCode: "LEGACY_BACKFILL_CONVERTER_FIX", dongLoai: "REASSIGN", dongLyDo: "OWNER_QUYET_DINH_DOI_NGUOI_CHOT", evidenceClass: "OWNER_QUYET_DINH", confidence: "OWNER", approvalNonce: artifact.payload.nonce });
    }

    // IDEMPOTENT: lập lại ⇒ 0 dòng GHI; ghi lại không cần artifact, không dấu vết; kiểm sau ghi sạch
    const { kh: kh2 } = await docKeHoachSuaNguoiChot(db, f.pv, POL, f.quyetDinh);
    expect(kh2.soGhi).toBe(0);
    expect(kh2.soXemTay).toBe(1); // lead ngoài bảng vẫn xem tay — bảng không che nó
    expect(kh2.dong.find((d) => d.leadId === f.qa)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_DA_AP_DUNG", newConvertedById: U_NHAN_A });
    expect(kh2.dong.find((d) => d.leadId === f.qb)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_DA_AP_DUNG", newConvertedById: U_NHAN_B });
    const truoc = await demDauVet();
    expect(await ghiSuaNguoiChot(db, nhapQD(f, kh2, { ...CG(kh2).cong, artifact: null }))).toEqual({ daGhi: 0, daDoi: 0, daXoa: 0 });
    expect(await demDauVet()).toEqual(truoc);
    const k = await kiemSauGhi(db, f.pv, POL, f.quyetDinh);
    expect(k).toMatchObject({ conLaiCanGhi: 0, banGhiAudit: 2, troiTraiAudit: [], hong: 0 });
    expect(k.hoanTac).toEqual([
      { leadId: f.qa, hienTaiMongDoi: U_NHAN_A, hoanVe: U_ADMIN },
      { leadId: f.qb, hienTaiMongDoi: U_NHAN_B, hoanVe: U_ADMIN },
    ]);
  });

  const KHONG_GIAI_QUYET: Array<[string, (qa: string) => QuyetDinhOwner[], string]> = [
    ["[SNC-DB-18a] mã nhân viên KHÔNG tồn tại", (qa) => [{ leadId: qa, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: `${P}NV.KHONG-CO` } }], "QUYET_DINH_NGUOI_NHAN_KHONG_GIAI_QUYET_DUOC_DUY_NHAT"],
    ["[SNC-DB-18b] mã trỏ tới tài khoản KHÔNG phải Sale (SUPER_ADMIN)", (qa) => [{ leadId: qa, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_QT } }], "QUYET_DINH_NGUOI_NHAN_KHONG_PHAI_SALE_HOP_LE"],
    ["[SNC-DB-18c] người nhận Sale nhưng KHÁC CƠ SỞ với lead/đơn (qa ở CS1, MA_B ở CS2)", (qa) => [{ leadId: qa, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_B } }], "QUYET_DINH_SAI_CO_SO"],
    ["[SNC-DB-18d] lead trong quyết định KHÔNG tồn tại", () => [{ leadId: `${P}khong-co-lead`, hanhDong: "GIU_NGUYEN" }], "QUYET_DINH_LEAD_KHONG_TON_TAI"],
  ];
  it.each(KHONG_GIAI_QUYET)("%s ⇒ INVALID (%s) và --ghi TỪ CHỐI cả lượt: người chốt không đổi · 0 dòng audit mới · 0 hàng wg:", async (_ten, taoQd, ma) => {
    const qa = await taoLead("qa", { phone: "84900009011", assignedToId: U_VAN, centerId: CS1 });
    const oa = await taoDon("qa", { leadId: qa, centerId: CS1 });
    await taoThu(oa.id, 10_000_000, NGAY_THU);
    const pv = phamVi("qa");
    const qd = taoQd(qa);
    const { kh } = await docKeHoachSuaNguoiChot(db, pv, POL, qd);
    expect(kh.tom.khongHopLe).toBe(1);
    expect(kh.dong.find((d) => d.reasonCode === ma)).toBeDefined();
    const truoc = { ...(await demDauVet()), chot: await nguoiChot([qa]) };
    const loi = await ghiSuaNguoiChot(db, nhap(pv, kh, CG(kh).cong, { quyetDinh: qd, soDuyet: kh.soGhi })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).toBeInstanceOf(Error);
    expect((loi as Error).message).toMatch(/INVALID/);
    expect({ ...(await demDauVet()), chot: await nguoiChot([qa]) }).toEqual(truoc);
    // đối chứng dương: cùng hiện trường, mã ĐÚNG ⇒ ghi được
    const dung: QuyetDinhOwner[] = [{ leadId: qa, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_A } }];
    const { kh: tot } = await docKeHoachSuaNguoiChot(db, pv, POL, dung);
    expect((await ghiSuaNguoiChot(db, nhap(pv, tot, CG(tot).cong, { quyetDinh: dung }))).daGhi).toBe(1);
    expect(await nguoiChot([qa])).toEqual({ [qa]: U_NHAN_A });
  });

  it("[SNC-DB-19] quyết định + khoá hoa hồng: lead được quyết nhưng có khoản thu trong kỳ ĐÃ DUYỆT ⇒ MANUAL_REVIEW, KHÔNG ghi (kể cả khi ghi dòng khác); quyết định lệch sau khi duyệt (người chốt đã là Sale khác) ⇒ cũng xem tay", async () => {
    const khoa = await taoLead("qf", { phone: "84900009021", coImport: false, centerId: CS2 });
    const of = await taoDon("qf", { leadId: khoa, centerId: CS2 });
    await taoThu(of.id, 10_000_000, NGAY_THU_DUYET);
    await db.commissionStatement.create({ data: { period: KY_DUYET, status: "APPROVED" } });
    const troi = await taoLead("qg", { phone: "84900009022", coImport: false, centerId: CS2, convertedById: U_VAN });
    const og = await taoDon("qg", { leadId: troi, centerId: CS2 });
    await taoThu(og.id, 10_000_000, NGAY_THU);
    const nen = await taoLead("qh", { phone: "84900009023", centerId: CS1 }); // BACKFILL, đổi được ⇒ để cả lượt có ít nhất một dòng ghi thật
    const oh = await taoDon("qh", { leadId: nen, centerId: CS1 });
    await taoThu(oh.id, 10_000_000, NGAY_THU);
    const qd: QuyetDinhOwner[] = [
      { leadId: khoa, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_B } },
      { leadId: troi, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_B } },
      { leadId: nen, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_A } },
    ];
    const pv = phamVi("qf", "qg", "qh");
    const { kh } = await docKeHoachSuaNguoiChot(db, pv, POL, qd);
    expect(kh.dong.find((d) => d.leadId === khoa)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "COMMISSION_DA_KHOA_THU_TRONG_KY_DA_DUYET", newConvertedById: U_ADMIN });
    expect(kh.dong.find((d) => d.leadId === troi)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "QUYET_DINH_NGUOI_CHOT_DA_DOI_SANG_SALE_KHAC", newConvertedById: U_VAN });
    expect(kh).toMatchObject({ soGhi: 1, soXemTay: 2 });
    await ghiSuaNguoiChot(db, nhap(pv, kh, CG(kh).cong, { quyetDinh: qd }));
    expect(await nguoiChot([khoa, troi, nen])).toEqual({ [khoa]: U_ADMIN, [troi]: U_VAN, [nen]: U_NHAN_A });
  });

  it("[SNC-DB-19b] khoá hoa hồng đọc THEO ID cho lead quyết định: lead KHÔNG có BACKFILL_IMPORT mà có CommissionLine trong bảng kê APPROVED (kỳ thu CHƯA duyệt) ⇒ XEM TAY; đối chứng dương: gỡ dòng kỳ ⇒ đổi được", async () => {
    const lk = await taoLead("qi", { phone: "84900009031", coImport: false, centerId: CS2 });
    const oi = await taoDon("qi", { leadId: lk, centerId: CS2 });
    await taoThu(oi.id, 10_000_000, NGAY_THU); // kỳ KY_THU chưa duyệt — khoá CHỈ đến từ dòng bảng kê
    const st = await db.commissionStatement.create({ data: { period: KY_DUYET, status: "APPROVED" } });
    await db.commissionLine.create({ data: { statementId: st.id, recipientId: U_VAN, tier: "SALE", amount: 400_000, leadId: lk } });
    const qd: QuyetDinhOwner[] = [{ leadId: lk, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_B } }];
    const pv = phamVi("qi");
    const { kh } = await docKeHoachSuaNguoiChot(db, pv, POL, qd);
    expect(kh.dong).toHaveLength(1);
    expect(kh.dong[0]).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "COMMISSION_DA_KHOA_DONG_KY_DA_DUYET", newConvertedById: U_ADMIN });
    expect(kh).toMatchObject({ soGhi: 0, soXemTay: 1 });
    await db.commissionLine.deleteMany({ where: { leadId: lk } });
    const { kh: mo } = await docKeHoachSuaNguoiChot(db, pv, POL, qd);
    expect(mo.dong[0]).toMatchObject({ loai: "REASSIGN", newConvertedById: U_NHAN_B });
  });
});
