// @vitest-environment node
/**
 * [NHH-DSP-*] — KHIẾU NẠI HOA HỒNG trên Postgres THẬT (04 §15, 02 §9.5, 05 AC-DSP-01..07).
 *
 * Dòng tiền + sổ dựng bằng HÀM GHI THẬT (`recordPayment`/`confirmPayment` → `quetKhoan`) — xem `_kich-ban.ts`. Đổi nguồn dựng bằng `doiNguonLead` THẬT
 * (PR2) rồi cho consumer ăn chính DomainEvent mà nó phát ra (ca đóng khiếu nại "sửa nguồn").
 *
 * Mã ca theo 05 AC-DSP: 01 (đồ thị — bản thuần ở `lib/hoa-hong/khieu-nai-trang-thai.test.ts`, bản DB ở `khieu-nai-schema.spec.ts`) · 02a..f (tạo/đích) · 03
 * (người duyệt ≠ người khiếu nại) · 04 (bất biến) · 05a..h (quyết định + điều chỉnh) · 06 = `[NHH-PER-08d]` (không chặn khoá kỳ) · 07 (audit).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18) với tiền tố riêng. Sổ BẤT BIẾN nên không dọn được bằng xoá; bảng khiếu nại cũng không
 * bao giờ bị xoá (trigger) ⇒ `dọn` = TRUNCATE ... CASCADE trong afterAll qua `donSoCai` + `TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"` (trigger theo dòng không chạy với TRUNCATE).
 * Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Cấy lỗi SAU phép ghi dòng (05b): bọc `writeAudit` thật, ca nào cần thì `mockImplementationOnce` cho nó ném.
vi.mock("@/lib/audit/audit-log", async (importOriginal) => {
  const goc = await importOriginal<typeof import("@/lib/audit/audit-log")>();
  return { ...goc, writeAudit: vi.fn(goc.writeAudit) };
});
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { writeAudit } from "../../lib/audit/audit-log";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import type { Actor } from "../../lib/auth/actor";
import { onNguonDaDoiSauThanhToan } from "../../lib/hoa-hong/_handlers/doi-nguon-sau-thu";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { chuyenRaSoat, demHangChoChan, khoaKyHoaHong, tinhKy } from "../../lib/hoa-hong/ky-service";
import {
  dongKhieuNaiDoiNguon,
  nhanKhieuNai,
  quyetDinhKhieuNai,
  taoKhieuNai,
  type NguoiKhieuNai,
} from "../../lib/hoa-hong/khieu-nai";
import { duyetDeXuat, tuChoiDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
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
  ganNguon,
  ganVai,
  hoanTien,
  lamNhanVien,
  nguoiKyHo,
  nguoiKyQlcs,
  themChinhSachNhom,
  tienVe,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-DSP] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

const LY_DO = "Dòng hoa hồng này tính thiếu so với thoả thuận ban đầu của tôi với công ty";
const BANG_CHUNG = [{ ghiChu: "Tin nhắn Zalo ngày 05/10/2026 của quản lý xác nhận mức hưởng" }];
const LY_DO_QD = "Đã đối chiếu biên bản thoả thuận, bù phần còn thiếu";

const nguoiCua = async (u: { id: string; name?: string | null }): Promise<NguoiKhieuNai> => ({ userId: u.id, ten: u.name ?? u.id, quyen: await actorCua(u.id) });

/** Một người DUYỆT thật: user mới + vai HO_HR (có `commission_disputes:review`) neo tại `orgUnitId` (mặc định Hội sở ⇒ thấy mọi cơ sở). */
async function dungHR(ten: string, orgUnitId?: string): Promise<NguoiKhieuNai> {
  const u = await seedUser({ email: `${ten}-${Date.now().toString(36)}@ci.test`, role: "HR", name: `HR ${ten}`, phone: null });
  await ganVai(u.id, orgUnitId ?? (await donViHoiSo()), "HO_HR");
  return nguoiCua(u);
}

/** Kịch bản chuẩn: 10tr thu 12/10/2026, Sale 4% / Sale Admin 1% / QLCS 2% / Marketing 1% — đã QUÉT vào sổ (4 dòng ORIGINAL). */
async function dungCa(ten: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await kb(ten, p);
  // Người HƯỞNG phải neo vai thật tại đơn vị của cơ sở (RBAC v2 đọc quyền TỪ DỮ LIỆU): không có vai ⇒ không có `commission:view-self` ⇒ không gửi được khiếu nại.
  for (const u of [k.sale, k.saleAdmin, k.qlcs, k.qc]) await ganVai(u.id, k.ouId, "CENTER_SALES_CSM");
  await ganNguon(k, "PAID_ADS");
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, "a");
  const pay = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, pay);
  const dong = await dongSoCuaKhoan(pay);
  const cua = (vai: string) => dong.find((d) => d.roleCode === vai)!;
  return { k, bc, be, pay, dong, cua };
}

const taoDong = (nguoi: NguoiKhieuNai, transactionId: string, extra: Record<string, unknown> = {}) =>
  taoKhieuNai(db, { nguoi, dauVao: { dich: { loai: "DONG", id: transactionId }, lyDo: LY_DO, bangChung: BANG_CHUNG, ...extra } });
const taoKhoan = (nguoi: NguoiKhieuNai, paymentId: string) =>
  taoKhieuNai(db, { nguoi, dauVao: { dich: { loai: "KHOAN", id: paymentId }, lyDo: LY_DO, bangChung: BANG_CHUNG } });

/** Chạy `fn` và trả `HoaHongError` nó ném (hoặc làm hỏng ca nếu không ném). */
async function loiCua(fn: () => Promise<unknown>): Promise<HoaHongError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HoaHongError) return e;
    throw e;
  }
  throw new Error("kỳ vọng ném HoaHongError nhưng không ném");
}

const nhanVaQuyet = async (bc: Awaited<ReturnType<typeof boiCanh>>, hr: NguoiKhieuNai, disputeId: string, dauVao: unknown) => {
  await nhanKhieuNai(db, { disputeId, nguoi: hr, now: NOW });
  return quyetDinhKhieuNai(db, bc, { disputeId, nguoi: hr, dauVao });
};

/** Khoá một kỳ bằng đường thật (Tính → rà soát → Khoá). */
async function khoaKyThang(k: KichBan, thang: string, bc: Awaited<ReturnType<typeof boiCanh>>) {
  const NGUOI = await nguoiKyHo();
  const ky = await db.commissionPeriod.findFirstOrThrow({ where: { period: thang, centerId: k.centerId } });
  await tinhKy(db, { ...bc, now: new Date() }, { periodId: ky.id, soThangDoiSoat: 3, actor: NGUOI });
  await chuyenRaSoat(db, { periodId: ky.id, actor: NGUOI, now: new Date() });
  await khoaKyHoaHong(db, { periodId: ky.id, actor: NGUOI, now: new Date(), lyDo: "khoá kỳ để chi lương (ca test khiếu nại)" });
  expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky.id } })).status).toBe("LOCKED");
  return ky;
}

const auditCua = (entityId: string) => db.auditLog.findMany({ where: { entityType: "CommissionDispute", entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe.skipIf(!RUN_DB_TESTS)("[NHH-DSP] khiếu nại hoa hồng", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  // ── TẠO · ĐÍCH ───────────────────────────────────────────────────────────────────────────────

  it("[NHH-DSP-02] tạo khiếu nại trên dòng CỦA MÌNH: cơ sở chép từ dòng sổ, nội dung lưu nguyên, trạng thái OPEN; audit CREATE KHÔNG chép lý do/bằng chứng (PII)", async () => {
    const { k, dong, cua } = await dungCa("dsp02");
    const sale = await nguoiCua(k.sale);
    const r = await taoDong(sale, cua("SALE").id);
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: r.disputeId } });
    expect(row).toMatchObject({
      transactionId: cua("SALE").id,
      paymentId: null,
      raisedByUserId: k.sale.id,
      reason: LY_DO,
      status: "OPEN",
      assignedToUserId: null,
      resolution: null,
      centerId: k.centerId,
      orgUnitId: cua("SALE").orgUnitId,
    });
    expect(row.evidence).toEqual(BANG_CHUNG);
    expect(dong.length).toBeGreaterThanOrEqual(4);

    const a = await auditCua(r.disputeId);
    expect(a.map((x) => [x.module, x.action])).toEqual([["hoa-hong", "CREATE"]]);
    expect(JSON.stringify(a[0]!.newValues)).not.toContain("Zalo");
    expect(JSON.stringify(a[0]!.newValues)).not.toContain(LY_DO.slice(0, 20));
    expect(a[0]!.reason).toBeNull();
    expect(a[0]!.actorId).toBe(k.sale.id);
  });

  it("[NHH-DSP-02g] người KHÔNG giữ quyền xem hoa hồng của mình (chưa neo vai nào) ⇒ KHONG_CO_QUYEN, không ghi gì; đối chứng: neo vai CENTER_SALES_CSM thì gửi được", async () => {
    const { k, cua } = await dungCa("dsp02g");
    const khongVai = await seedUser({ email: `${k.ma}-kv@ci.test`, role: "SALES_CSM", name: `${k.ma}-kv`, phone: null });
    const e = await loiCua(async () => taoDong(await nguoiCua(khongVai), cua("SALE").id));
    expect(e.ma).toBe("KHONG_CO_QUYEN");
    expect(await db.commissionDispute.count({ where: { raisedByUserId: khongVai.id } })).toBe(0);
    await expect(taoDong(await nguoiCua(k.sale), cua("SALE").id)).resolves.toMatchObject({ dich: { loai: "DONG" } });
  });

  it("[NHH-DSP-02a] dòng của NGƯỜI KHÁC ⇒ từ chối; cùng CÂU LỖI với id không tồn tại (không lộ dòng có tồn tại)", async () => {
    const { k, cua } = await dungCa("dsp02a");
    const sale = await nguoiCua(k.sale);
    const dongQlcs = cua("CENTER_MANAGER");
    const sai = await loiCua(() => taoDong(sale, dongQlcs.id));
    const khongCo = await loiCua(() => taoDong(sale, "id-khong-ton-tai"));
    expect(sai.ma).toBe("KHONG_TIM_THAY_DICH");
    expect(sai.message).toBe(khongCo.message);
    expect(khongCo.ma).toBe("KHONG_TIM_THAY_DICH");
    expect(await db.commissionDispute.count({ where: { raisedByUserId: k.sale.id } })).toBe(0);
    // đối chứng dương: chính dòng của sale thì tạo được
    await expect(taoDong(sale, cua("SALE").id)).resolves.toMatchObject({ dich: { loai: "DONG" } });
  });

  it("[NHH-DSP-02b] khoản thu mà người khiếu nại KHÔNG có quan hệ ⇒ từ chối, CÙNG câu lỗi với khoản không tồn tại", async () => {
    const { k, pay } = await dungCa("dsp02b");
    const la = await seedUser({ email: `${k.ma}-la@ci.test`, role: "SALES_CSM", name: `${k.ma}-la`, phone: null });
    await ganVai(la.id, k.ouId, "CENTER_SALES_CSM"); // có quyền gửi khiếu nại, nhưng KHÔNG có quan hệ nào với khoản này
    const nguoiLa = await nguoiCua(la);
    const sai = await loiCua(() => taoKhoan(nguoiLa, pay));
    const khongCo = await loiCua(() => taoKhoan(nguoiLa, "pay-khong-ton-tai"));
    expect(sai.ma).toBe("KHONG_TIM_THAY_DICH");
    expect(khongCo.ma).toBe("KHONG_TIM_THAY_DICH");
    expect(sai.message).toBe(khongCo.message);
    expect(await db.commissionDispute.count({ where: { raisedByUserId: la.id } })).toBe(0);
  });

  it("[NHH-DSP-02c] đối chứng: CHỦ LEAD khiếu nại khoản thu CHƯA có dòng của mình ('lẽ ra tôi được hưởng') ⇒ được; centerId/orgUnitId chép từ khoản", async () => {
    // Chính sách chỉ có QLCS ⇒ Sale (chủ lead) KHÔNG có dòng nào trên khoản.
    const { k, pay, dong } = await dungCa("dsp02c", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    expect(dong.map((d) => d.roleCode)).toEqual(["CENTER_MANAGER"]);
    const sale = await nguoiCua(k.sale);
    const r = await taoKhoan(sale, pay);
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: r.disputeId } });
    expect(row).toMatchObject({ paymentId: pay, transactionId: null, centerId: k.centerId, status: "OPEN" });
    expect(row.orgUnitId).toBe(k.ouId);
  });

  it("[NHH-DSP-02c2] NGƯỜI GIỚI THIỆU trên nguồn (nhân sự) cũng có quan hệ; người lạ vẫn bị từ chối — đối chứng của ca trên", async () => {
    const k = await kb("dsp02c2", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    const gt = await seedUser({ email: `${k.ma}-gt@ci.test`, role: "SALES_CSM", name: `${k.ma}-gt`, phone: null });
    const nvId = await lamNhanVien(gt.id, "gt");
    await ganVai(gt.id, k.ouId, "CENTER_SALES_CSM");
    await ganNguon(k, "EMPLOYEE_REFERRAL", { nhanSuEmployeeId: nvId });
    const pay = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), pay);
    // người lạ (không phải chủ lead, không phải người giới thiệu) bị từ chối
    const la = await seedUser({ email: `${k.ma}-la2@ci.test`, role: "SALES_CSM", name: `${k.ma}-la2`, phone: null });
    await ganVai(la.id, k.ouId, "CENTER_SALES_CSM");
    expect((await loiCua(async () => taoKhoan(await nguoiCua(la), pay))).ma).toBe("KHONG_TIM_THAY_DICH");
    // người giới thiệu được
    const r = await taoKhoan(await nguoiCua(gt), pay);
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: r.disputeId } })).paymentId).toBe(pay);
  });

  it("[NHH-DSP-02d] thiếu bằng chứng / lý do ngắn ⇒ lỗi THEO Ô (`bangChung`, `lyDo`) và KHÔNG ghi gì", async () => {
    const { k, cua } = await dungCa("dsp02d");
    const sale = await nguoiCua(k.sale);
    const thieu = await loiCua(() => taoDong(sale, cua("SALE").id, { bangChung: [] }));
    expect(thieu.ma).toBe("DU_LIEU_KHONG_HOP_LE");
    expect((thieu.chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["bangChung"]);
    const ca2 = await loiCua(() => taoDong(sale, cua("SALE").id, { bangChung: [], lyDo: "ngắn" }));
    expect((ca2.chiTiet as { truong: string }[]).map((l) => l.truong).sort()).toEqual(["bangChung", "lyDo"]);
    expect(await db.commissionDispute.count({ where: { raisedByUserId: k.sale.id } })).toBe(0);
  });

  it("[NHH-DSP-02e] khoản thu ĐÃ có dòng của chính mình ⇒ chỉ sang khiếu nại DÒNG đó (không khiếu nại mức khoản)", async () => {
    const { k, pay } = await dungCa("dsp02e");
    const e = await loiCua(async () => taoKhoan(await nguoiCua(k.sale), pay));
    expect(e.ma).toBe("DA_CO_DONG_CUA_BAN");
  });

  it("[NHH-DSP-02f] đang có khiếu nại MỞ cho cùng đích ⇒ không đẻ bản thứ hai (kể cả hai cú bấm đồng thời); sau khi đóng thì gửi lại được", async () => {
    const { k, bc, cua } = await dungCa("dsp02f");
    const sale = await nguoiCua(k.sale);
    const song = await Promise.allSettled([taoDong(sale, cua("SALE").id), taoDong(sale, cua("SALE").id)]);
    expect(song.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(song.filter((s) => s.status === "rejected")).toHaveLength(1);
    const rj = (song.find((s) => s.status === "rejected") as PromiseRejectedResult).reason as HoaHongError;
    expect(rj.ma).toBe("DA_CO_KHIEU_NAI_DANG_MO");
    const id = (song.find((s) => s.status === "fulfilled") as PromiseFulfilledResult<{ disputeId: string }>).value.disputeId;
    // từ chối ⇒ đóng ⇒ gửi lại được
    const hr = await dungHR("dsp02f");
    await nhanVaQuyet(bc, hr, id, { loai: "TU_CHOI", lyDo: "Không có căn cứ trong hồ sơ thoả thuận" });
    await expect(taoDong(sale, cua("SALE").id)).resolves.toMatchObject({ dich: { loai: "DONG" } });
  });

  // ── NHẬN · NGƯỜI DUYỆT ≠ NGƯỜI KHIẾU NẠI · PHẠM VI ─────────────────────────────────────────────

  it("[NHH-DSP-03] HR TỰ nhận khiếu nại của MÌNH ⇒ từ chối (server); đối chứng: HR khác nhận được", async () => {
    const { k, bc, cua } = await dungCa("dsp03");
    // Sale đồng thời là HR (vai HO_HR neo Hội sở) — người này vừa có dòng hoa hồng vừa có quyền duyệt.
    await ganVai(k.sale.id, await donViHoiSo(), "HO_HR");
    const saleHr = await nguoiCua(k.sale);
    const kn = await taoDong(saleHr, cua("SALE").id);

    const tuNhan = await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: saleHr, now: NOW }));
    expect(tuNhan.ma).toBe("NGUOI_DUYET_LA_NGUOI_KHIEU_NAI");
    const tuQuyet = await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: saleHr, dauVao: { loai: "TU_CHOI", lyDo: "Tự từ chối khiếu nại của chính mình" } }));
    expect(tuQuyet.ma).toBe("NGUOI_DUYET_LA_NGUOI_KHIEU_NAI");
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("OPEN");

    // giao cho CHÍNH người khiếu nại bởi HR khác cũng bị chặn
    const hr = await dungHR("dsp03");
    const giaoNguoiKn = await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, nguoiNhanId: k.sale.id, now: NOW }));
    expect(giaoNguoiKn.ma).toBe("NGUOI_DUYET_LA_NGUOI_KHIEU_NAI");

    // đối chứng dương
    const ok = await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    expect(ok).toMatchObject({ loai: "DA_NHAN", nguoiXuLyId: hr.userId });
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row).toMatchObject({ status: "UNDER_REVIEW", assignedToUserId: hr.userId });
    expect(row.assignedAt).toEqual(NOW);
  });

  it("[NHH-DSP-03b] người KHÔNG giữ quyền duyệt không nhận/quyết được (KHONG_CO_QUYEN); ngoài PHẠM VI cơ sở ⇒ cùng câu 'không tìm thấy' như id lạ", async () => {
    const { k, cua } = await dungCa("dsp03b");
    const sale = await nguoiCua(k.sale);
    const kn = await taoDong(sale, cua("SALE").id);
    // QLCS neo ĐÚNG cơ sở này: THẤY khiếu nại (cùng phạm vi) nhưng không giữ quyền duyệt ⇒ KHONG_CO_QUYEN.
    const qlcs = (await nguoiKyQlcs(k)) as NguoiKhieuNai;
    expect((await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: qlcs, now: NOW }))).ma).toBe("KHONG_CO_QUYEN");
    // Người không neo vai nào (phạm vi rỗng) ⇒ cùng câu 'không tìm thấy' — không biết khiếu nại có tồn tại.
    const khongVai = await nguoiCua(await seedUser({ email: `${k.ma}-kv2@ci.test`, role: "SALES_CSM", name: `${k.ma}-kv2`, phone: null }));
    expect((await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: khongVai, now: NOW }))).ma).toBe("KHONG_TIM_THAY_KHIEU_NAI");

    // HR neo ở cơ sở KHÁC (kịch bản khác) không thấy khiếu nại của cơ sở này
    const k2 = await kb("dsp03b2");
    const hrCs2 = await dungHR("dsp03b2", k2.ouId);
    const ngoai = await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hrCs2, now: NOW }));
    const lạ = await loiCua(() => nhanKhieuNai(db, { disputeId: "kn-khong-ton-tai", nguoi: hrCs2, now: NOW }));
    expect(ngoai.ma).toBe("KHONG_TIM_THAY_KHIEU_NAI");
    expect(ngoai.message).toBe(lạ.message);
    // đối chứng dương: HR neo ĐÚNG cơ sở này nhận được
    const hrCs1 = await dungHR("dsp03b1", k.ouId);
    await expect(nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hrCs1, now: NOW })).resolves.toMatchObject({ loai: "DA_NHAN" });
  });

  it("[NHH-DSP-03c] giao lại: người được giao phải GIỮ quyền duyệt ở cơ sở này; sau khi giao, người cũ không còn quyết được (phải nhận lại)", async () => {
    const { k, bc, cua } = await dungCa("dsp03c");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const a = await dungHR("dsp03c-a");
    const b = await dungHR("dsp03c-b");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: a, now: NOW });

    const khongDuQuyen = await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: a, nguoiNhanId: k.qc.id, now: NOW }));
    expect(khongDuQuyen.ma).toBe("NGUOI_NHAN_KHONG_DU_QUYEN");
    expect((await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: a, nguoiNhanId: a.userId, now: NOW }))).ma).toBe("DA_DANG_XU_LY");

    const g = await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: a, nguoiNhanId: b.userId, now: NOW });
    expect(g).toMatchObject({ loai: "DA_GIAO_LAI", nguoiXuLyId: b.userId });
    const loiA = await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: a, dauVao: { loai: "TU_CHOI", lyDo: "Không còn là người xử lý khiếu nại này" } }));
    expect(loiA.ma).toBe("KHONG_PHAI_NGUOI_XU_LY");
    await expect(quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: b, dauVao: { loai: "TU_CHOI", lyDo: "Người xử lý mới từ chối vì thiếu căn cứ" } })).resolves.toMatchObject({ loai: "DA_TU_CHOI" });
  });

  it("[NHH-DSP-03d] chưa NHẬN thì chưa quyết được (CHUA_NHAN); quyết xong không quyết lại (CHUYEN_TRANG_THAI_SAI)", async () => {
    const { k, bc, cua } = await dungCa("dsp03d");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const hr = await dungHR("dsp03d");
    expect((await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "TU_CHOI", lyDo: "Từ chối khi chưa nhận xử lý" } }))).ma).toBe("CHUA_NHAN");
    await nhanVaQuyet(bc, hr, kn.disputeId, { loai: "TU_CHOI", lyDo: "Không có căn cứ trong hồ sơ" });
    const lai = await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "TU_CHOI", lyDo: "Quyết lại lần hai cho chắc" } }));
    expect(lai.ma).toBe("CHUYEN_TRANG_THAI_SAI");
  });

  // ── QUYẾT ĐỊNH ───────────────────────────────────────────────────────────────────────────────

  it("[NHH-DSP-05a] DUYỆT điều chỉnh tiền ⇒ ĐÚNG MỘT dòng DISPUTE_ADJUSTMENT vào kỳ OPEN, `resolutionEntryId` trỏ nó, khiếu nại ĐÃ ĐÓNG; dòng gốc KHÔNG đổi", async () => {
    const { k, bc, pay, cua } = await dungCa("dsp05a");
    const goc = cua("SALE");
    const truoc = await db.commissionTransaction.findUniqueOrThrow({ where: { id: goc.id } });
    const kn = await taoDong(await nguoiCua(k.sale), goc.id);
    const hr = await dungHR("dsp05a");
    const kq = await nhanVaQuyet(bc, hr, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 });
    expect(kq).toMatchObject({ loai: "DA_DUYET_TIEN", soTien: 50_000, kyGhi: "2026-11", lateArrival: true });

    const ds = await db.commissionTransaction.findMany({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      id: kq.loai === "DA_DUYET_TIEN" ? kq.dongDieuChinhId : "?",
      amount: 50_000,
      roleCode: "SALE",
      beneficiaryUserId: k.sale.id,
      calcSlotId: goc.calcSlotId,
      paymentId: pay,
      refEntryId: goc.id,
      refEventType: "DISPUTE",
      reasonCode: "KHIEU_NAI_DIEU_CHINH",
      naturalPeriod: "2026-10", // kỳ HIỆU LỰC = kỳ của dòng gốc (H22)
      lateArrival: true,
      calcKind: null,
      rate: null,
      grossAmount: 0,
      netBase: 0,
    });
    const kyOpen = await db.commissionPeriod.findUniqueOrThrow({ where: { id: ds[0]!.periodId } });
    expect(kyOpen).toMatchObject({ period: "2026-11", status: "OPEN", centerId: k.centerId });

    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row).toMatchObject({
      status: "CLOSED",
      resolution: "MONEY_ADJUSTMENT",
      decisionReason: LY_DO_QD,
      decidedById: hr.userId,
      resolutionEntryId: ds[0]!.id,
    });
    expect(row.decidedAt).toEqual(NOW);
    expect(row.closedAt).toEqual(NOW);
    // nội dung đã gửi nguyên vẹn
    expect(row.reason).toBe(LY_DO);
    expect(row.evidence).toEqual(BANG_CHUNG);
    // dòng gốc KHÔNG đổi một byte
    expect(await db.commissionTransaction.findUniqueOrThrow({ where: { id: goc.id } })).toEqual(truoc);
    // audit: tạo · nhận · quyết (có lý do) · đóng (hệ thống)
    const a = await auditCua(kn.disputeId);
    expect(a.map((x) => x.action)).toEqual(["CREATE", "ASSIGN", "DECIDE", "CLOSE"]);
    expect(a.find((x) => x.action === "DECIDE")!.reason).toBe(LY_DO_QD);
    expect(a.find((x) => x.action === "CLOSE")!.actorId).toBeNull();
  });

  it("[NHH-DSP-05b] cấy lỗi SAU phép ghi dòng ⇒ quyết định cũng ROLLBACK (không dòng mồ côi, không khiếu nại nửa chừng); thử lại thành công đúng MỘT dòng", async () => {
    const { k, bc, cua } = await dungCa("dsp05b");
    const goc = cua("SALE");
    const kn = await taoDong(await nguoiCua(k.sale), goc.id);
    const hr = await dungHR("dsp05b");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    const dem = () => db.commissionTransaction.count({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } });

    (writeAudit as unknown as { mockImplementationOnce: (f: () => Promise<never>) => void }).mockImplementationOnce(async () => {
      throw new Error("cấy lỗi: audit hỏng sau khi dòng điều chỉnh đã ghi");
    });
    await expect(quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 } })).rejects.toThrow(/cấy lỗi/);

    expect(await dem()).toBe(0);
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row).toMatchObject({ status: "UNDER_REVIEW", resolution: null, resolutionEntryId: null, decidedAt: null, closedAt: null });
    expect((await auditCua(kn.disputeId)).map((x) => x.action)).toEqual(["CREATE", "ASSIGN"]);

    // đối chứng dương: cùng lời gọi, không cấy lỗi ⇒ thành công, đúng một dòng
    await expect(quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 } })).resolves.toMatchObject({ loai: "DA_DUYET_TIEN" });
    expect(await dem()).toBe(1);
  });

  it("[NHH-DSP-05c] TỪ CHỐI không lý do ⇒ lỗi ô `lyDo`, khiếu nại giữ nguyên; có lý do ⇒ REJECTED rồi hệ thống đóng, KHÔNG dòng sổ nào được ghi", async () => {
    const { k, bc, cua, pay } = await dungCa("dsp05c");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const hr = await dungHR("dsp05c");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    const truocSo = await db.commissionTransaction.count({ where: { paymentId: pay } });

    const thieu = await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "TU_CHOI", lyDo: "   " } }));
    expect(thieu.ma).toBe("DU_LIEU_KHONG_HOP_LE");
    expect((thieu.chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["lyDo"]);
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("UNDER_REVIEW");

    const kq = await quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "TU_CHOI", lyDo: "Hồ sơ thoả thuận không ghi mức hưởng này" } });
    expect(kq.loai).toBe("DA_TU_CHOI");
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row).toMatchObject({ status: "CLOSED", resolution: null, resolutionEntryId: null, decisionReason: "Hồ sơ thoả thuận không ghi mức hưởng này", decidedById: hr.userId });
    expect(row.closedAt).not.toBeNull();
    expect(await db.commissionTransaction.count({ where: { paymentId: pay } })).toBe(truocSo);
    expect((await auditCua(kn.disputeId)).map((x) => x.action)).toEqual(["CREATE", "ASSIGN", "DECIDE", "CLOSE"]);
  });

  it("[NHH-DSP-05d] kỳ hiệu lực ĐÃ KHOÁ: điều chỉnh vào kỳ OPEN kế tiếp, kỳ cũ KHÔNG mở lại, không thêm dòng vào kỳ cũ (H22)", async () => {
    const { k, bc, cua } = await dungCa("dsp05d");
    const kyCu = await khoaKyThang(k, "2026-10", bc);
    const demKyCu = () => db.commissionTransaction.count({ where: { periodId: kyCu.id } });
    const truoc = await demKyCu();

    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id); // khiếu nại về dòng của kỳ ĐÃ KHOÁ vẫn được (04 §15)
    const hr = await dungHR("dsp05d");
    const kq = await nhanVaQuyet(bc, hr, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 30_000 });
    expect(kq).toMatchObject({ loai: "DA_DUYET_TIEN", kyGhi: "2026-11", lateArrival: true });
    expect(await demKyCu()).toBe(truoc);
    expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: kyCu.id } })).status).toBe("LOCKED");
  });

  it("[NHH-DSP-05e] đích KHOẢN THU: HR chọn dòng mẫu + vai ⇒ dòng điều chỉnh cho NGƯỜI KHIẾU NẠI, chính sách không chép; thiếu dòng mẫu / vai ⇒ lỗi theo ô; dòng mẫu của khoản KHÁC bị từ chối", async () => {
    const { k, bc, pay, cua } = await dungCa("dsp05e", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    const mauId = cua("CENTER_MANAGER").id;
    const sale = await nguoiCua(k.sale);
    const kn = await taoKhoan(sale, pay);
    const hr = await dungHR("dsp05e");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    const quyet = (dauVao: Record<string, unknown>) => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 80_000, ...dauVao } });

    expect(((await loiCua(() => quyet({}))).chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["mauDongId"]);
    expect(((await loiCua(() => quyet({ mauDongId: mauId }))).chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["roleCode"]);
    expect(((await loiCua(() => quyet({ mauDongId: mauId, roleCode: "VAI_KHONG_CO" }))).chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["roleCode"]);
    // dòng mẫu của khoản KHÁC
    const ca2 = await dungCa("dsp05e2", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    expect(((await loiCua(() => quyet({ mauDongId: ca2.cua("CENTER_MANAGER").id, roleCode: "REFERRER_EMPLOYEE" }))).chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["mauDongId"]);
    expect(await db.commissionTransaction.count({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } })).toBe(0);

    const kq = await quyet({ mauDongId: mauId, roleCode: "REFERRER_EMPLOYEE" });
    expect(kq.loai).toBe("DA_DUYET_TIEN");
    const d = await db.commissionTransaction.findFirstOrThrow({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } });
    expect(d).toMatchObject({
      roleCode: "REFERRER_EMPLOYEE",
      beneficiaryKind: "USER",
      beneficiaryUserId: k.sale.id,
      amount: 80_000,
      paymentId: pay,
      policyVersionId: null,
      ruleId: null,
      calcSlotId: cua("CENTER_MANAGER").calcSlotId,
    });
    expect(d.beneficiaryUserId).not.toBe(k.qlcs.id);
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("CLOSED");
    // quét lại khoản: người khiếu nại (không có trong kỳ vọng của chính sách) mang số ròng ≠ 0 từ dòng khiếu nại — không được sinh dòng "sửa ngược" nào
    const truocQuet = await db.commissionTransaction.count({ where: { OR: [{ paymentId: pay }, { calcSlot: { paymentId: pay } }] } });
    expect((await quetKhoan(db, bc, pay)).loai).toBe("KHONG_DOI");
    expect(await db.commissionHold.count({ where: { paymentId: pay, status: "OPEN" } })).toBe(0);
    expect(await db.commissionTransaction.count({ where: { OR: [{ paymentId: pay }, { calcSlot: { paymentId: pay } }] } })).toBe(truocQuet);
  });

  it("[NHH-DSP-05f] điều chỉnh ÂM (đòi lại) không vượt số ròng đã ghi: vượt ⇒ lỗi theo ô `soTien` TRƯỚC khi ghi; đúng bằng số ròng ⇒ được", async () => {
    const { k, bc, cua } = await dungCa("dsp05f");
    const goc = cua("SALE"); // 4% × 10tr/1,1? — dùng đúng số ròng đã ghi, không đoán công thức
    const kn = await taoDong(await nguoiCua(k.sale), goc.id);
    const hr = await dungHR("dsp05f");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    const dem = () => db.commissionTransaction.count({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } });

    const vuot = await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: -(goc.amount + 1) } }));
    expect((vuot.chiTiet as { truong: string }[]).map((l) => l.truong)).toEqual(["soTien"]);
    expect(await dem()).toBe(0);
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("UNDER_REVIEW");

    await expect(quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: -goc.amount } })).resolves.toMatchObject({ loai: "DA_DUYET_TIEN" });
    const tong = await db.commissionTransaction.aggregate({ where: { calcSlotId: goc.calcSlotId, roleCode: "SALE", beneficiaryUserId: k.sale.id }, _sum: { amount: true } });
    expect(tong._sum.amount).toBe(0);
  });

  it("[NHH-DSP-05g] hai HR quyết ĐỒNG THỜI cùng một khiếu nại ⇒ đúng MỘT thành công, đúng MỘT dòng điều chỉnh (không trả hai lần)", async () => {
    const { k, bc, cua } = await dungCa("dsp05g");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const hr = await dungHR("dsp05g");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    const quyet = () => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 40_000 } });
    const kq = await Promise.allSettled([quyet(), quyet()]);
    expect(kq.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.commissionTransaction.count({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } })).toBe(1);
  });

  it("[NHH-DSP-05h] sau khi điều chỉnh, QUÉT LẠI khoản không ghi thêm dòng nào và không dựng hàng chờ INPUT_DRIFT (khiếu nại không bị 'sửa ngược')", async () => {
    const { k, bc, pay, cua } = await dungCa("dsp05h");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const hr = await dungHR("dsp05h");
    await nhanVaQuyet(bc, hr, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 });
    const truoc = await db.commissionTransaction.count({ where: { OR: [{ paymentId: pay }, { calcSlot: { paymentId: pay } }] } });
    const r = await quetKhoan(db, bc, pay);
    expect(r.loai).toBe("KHONG_DOI");
    expect(await db.commissionTransaction.count({ where: { OR: [{ paymentId: pay }, { calcSlot: { paymentId: pay } }] } })).toBe(truoc);
    expect(await db.commissionHold.count({ where: { paymentId: pay, status: "OPEN" } })).toBe(0);
  });

  // ── KHÔNG CHẶN KHOÁ KỲ ───────────────────────────────────────────────────────────────────────

  it("[NHH-PER-08d] khiếu nại MỞ (OPEN và UNDER_REVIEW) KHÔNG chặn khoá kỳ: không sinh hàng chờ, kỳ khoá được, khiếu nại giữ nguyên", async () => {
    const { k, bc, cua } = await dungCa("per08d");
    const sale = await nguoiCua(k.sale);
    const kn1 = await taoDong(sale, cua("SALE").id);
    const hr = await dungHR("per08d");
    const kn2 = await taoDong(await nguoiCua(k.qlcs), cua("CENTER_MANAGER").id);
    await nhanKhieuNai(db, { disputeId: kn2.disputeId, nguoi: hr, now: NOW });
    expect(await db.commissionHold.count({ where: { centerId: k.centerId } })).toBe(0);

    const ky = await khoaKyThang(k, "2026-10", bc);
    expect(await demHangChoChan(db, ky.id)).toBe(0);
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn1.disputeId } })).status).toBe("OPEN");
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn2.disputeId } })).status).toBe("UNDER_REVIEW");
  });

  // ── SỬA NGUỒN → ĐÓNG ─────────────────────────────────────────────────────────────────────────

  it("[NHH-DSP-05i] duyệt 'sửa nguồn' ⇒ APPROVED, KHÔNG ghi sổ, KHÔNG đóng; đóng bị từ chối tới khi đổi nguồn thật đã được XỬ LÝ XONG: đề xuất đang chờ duyệt ⇒ vẫn chưa đóng; đề xuất ĐÃ DUYỆT (có SOURCE_CORRECTION) ⇒ đóng được", async () => {
    const k = await kb("dsp05i", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS");
    const bc = await boiCanh(k, NOW);
    const pay = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, pay);
    const dongSale = (await dongSoCuaKhoan(pay)).find((d) => d.roleCode === "SALE")!;

    const kn = await taoDong(await nguoiCua(k.sale), dongSale.id);
    const hr = await dungHR("dsp05i");
    const demSo = () => db.commissionTransaction.count({ where: { OR: [{ paymentId: pay }, { calcSlot: { paymentId: pay } }] } });
    const truoc = await demSo();
    const kq = await nhanVaQuyet(bc, hr, kn.disputeId, { loai: "DUYET_DOI_NGUON", lyDo: "Nguồn ghi sai, người giới thiệu là phụ huynh" });
    expect(kq.loai).toBe("DA_DUYET_DOI_NGUON");
    expect(await demSo()).toBe(truoc);
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row).toMatchObject({ status: "APPROVED", resolution: "SOURCE_CORRECTION", closedAt: null, resolutionEntryId: null });

    const chua = await loiCua(() => dongKhieuNaiDoiNguon(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW }));
    expect(chua.ma).toBe("CHUA_CO_DONG_DOI_NGUON");
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("APPROVED");

    // đổi nguồn THẬT (doiNguonLead) rồi cho consumer ăn chính DomainEvent
    const CO_SAU: KiemQuyen = async (action) => action === "sources:override-after-payment";
    const nguoiDoi = await seedUser({ email: `${k.ma}-doi-nguon@ci.test`, role: "SALES_CSM", name: `${k.ma}-doi-nguon`, phone: null });
    const actorCoSo = { userId: nguoiDoi.id, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: [k.centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as Actor;
    const doi = await doiNguonLead({
      actor: actorCoSo,
      actorName: "Người đổi",
      kiemQuyen: CO_SAU,
      leadId: k.lead!.id,
      groupId: nhom.PARENT_REFERRAL,
      thamChieu: { employeeId: null, parentUserId: ph.id, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
      bayGio: new Date(NOW.getTime() + 60_000),
    });
    expect(doi).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const ev = await db.domainEvent.findFirstOrThrow({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${k.lead!.id}:` } } });
    void onNguonDaDoiSauThanhToan;
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi.id });
    // MỚI LẬP ĐỀ XUẤT: sổ chưa đổi ⇒ khiếu nại CHƯA đóng được (trước đây đóng được ngay vì engine tự ghi)
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", paymentId: pay } })).toBe(0);
    expect((await loiCua(() => dongKhieuNaiDoiNguon(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW }))).ma).toBe("DE_XUAT_DANG_CHO_DUYET");
    expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("APPROVED");
    // người duyệt (khác người đổi nguồn) duyệt ⇒ SOURCE_CORRECTION sinh SAU lúc khiếu nại được gửi (cả hai mốc đều do DB ghi)
    const dx = await db.commissionAdjustmentRequest.findFirstOrThrow({ where: { paymentId: pay, origin: "SOURCE_CHANGE" } });
    expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: await nguoiKyHo(), lyDo: "Đã đối chiếu nguồn mới và đồng ý điều chỉnh" })).toMatchObject({ loai: "DA_GHI" });
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", paymentId: pay } })).toBeGreaterThanOrEqual(1);

    const dong = await dongKhieuNaiDoiNguon(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    expect(dong.disputeId).toBe(kn.disputeId);
    const row2 = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row2).toMatchObject({ status: "CLOSED", resolution: "SOURCE_CORRECTION" });
    expect((await auditCua(kn.disputeId)).map((x) => x.action)).toEqual(["CREATE", "ASSIGN", "DECIDE", "CLOSE"]);
    // đóng hai lần ⇒ đồ thị chặn
    expect((await loiCua(() => dongKhieuNaiDoiNguon(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW }))).ma).toBe("CHUYEN_TRANG_THAI_SAI");
  });

  it("[NHH-DSP-05j] chỉ khiếu nại 'sửa nguồn' mới đóng bằng tay; khiếu nại từ chối / điều chỉnh tiền hệ thống đã đóng (đóng lại ⇒ đồ thị chặn)", async () => {
    const { k, bc, cua } = await dungCa("dsp05j");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const hr = await dungHR("dsp05j");
    await nhanVaQuyet(bc, hr, kn.disputeId, { loai: "TU_CHOI", lyDo: "Không có căn cứ trong hồ sơ thoả thuận" });
    expect((await loiCua(() => dongKhieuNaiDoiNguon(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW }))).ma).toBe("CHUYEN_TRANG_THAI_SAI");
  });

  // ── HAI CẤP DUYỆT (hướng B+C, 16/10/2026) ─────────────────────────────────────────────────────
  //   [DXD-07] đạt ngưỡng cấu hình ⇒ CHO_CAP_HAI: sổ KHÔNG đổi, khiếu nại ở UNDER_REVIEW, đề xuất APPROVED_L1 mang ngưỡng đã chụp; nhận lại / quyết lại bị chặn; cấp 2 phải KHÁC cấp 1 và KHÁC người khiếu nại
//   [DXD-08] vượt CẬN tiền của giao dịch (|điều chỉnh| > hoa hồng đã ghi) dù DƯỚI ngưỡng ⇒ cấp hai (không im lặng cho qua)
//   [DXD-09] số ròng đổi giữa hai bước ⇒ STALE, không ghi; khiếu nại còn UNDER_REVIEW và quyết lại được
//   [DXD-10] cấp 2 TỪ CHỐI ⇒ REJECTED, khiếu nại còn UNDER_REVIEW; chỉ mục "một yêu cầu mở" nhả ra, quyết lại được
//   [DXD-11] ngưỡng hỏng ⇒ cấp hai dù 1 đồng; ngưỡng lớn + số nhỏ + trong cận ⇒ MỘT người, đề xuất vào thẳng POSTED/SINGLE (đối chứng dương)
//   [DXD-12] TÍCH LUỸ (17.1): chuỗi khiếu nại nhỏ — từng cái dưới ngưỡng, cái làm TỔNG đạt ngưỡng phải đòi cấp hai (hai cái đầu = đối chứng dương: một người)
//   [DXD-13] tích luỹ đếm đề xuất ĐÃ GHI / ĐANG MỞ (kể cả của người khác trên cùng ô), KHÔNG đếm đề xuất đã bị TỪ CHỐI (đối chứng dương)
//   [DXD-14] cận neo vào hoa hồng GỐC engine tính: điều chỉnh đã ghi KHÔNG nâng cận — cái làm tổng vượt hoa hồng gốc ⇒ VUOT_CAN dù số ròng nay đã lớn hơn
  const datNguong = (v: unknown) =>
    db.$executeRaw`INSERT INTO "SystemSetting" ("key","valueJson","updatedAt") VALUES ('hoaHong.nguongDuyetHaiCap', ${JSON.stringify(v)}::jsonb, now()) ON CONFLICT ("key") DO UPDATE SET "valueJson" = EXCLUDED."valueJson"`;
  const xoaNguong = () => db.systemSetting.deleteMany({ where: { key: "hoaHong.nguongDuyetHaiCap" } });
  async function caHaiCap(ten: string) {
    const c = await dungCa(ten);
    const kn = await taoDong(await nguoiCua(c.k.sale), c.cua("SALE").id);
    const hr1 = await dungHR(`${ten}a`);
    const hr2 = await dungHR(`${ten}b`);
    return { ...c, kn, hr1, hr2, dem: () => db.commissionTransaction.count({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } }) };
  }
  const dxCua = (disputeId: string) => db.commissionAdjustmentRequest.findFirstOrThrow({ where: { disputeId }, orderBy: { createdAt: "desc" } });

  it("[DXD-07] đạt ngưỡng ⇒ CHO_CAP_HAI: sổ chưa đổi, khiếu nại UNDER_REVIEW, đề xuất APPROVED_L1 mang ngưỡng đã chụp; cấp 2 ≠ cấp 1 ≠ người khiếu nại; duyệt cấp 2 ⇒ ghi ĐÚNG MỘT dòng và đóng", async () => {
    // Cấy: bỏ nhánh SECOND ở duyetTien (luôn ghi ngay) ⇒ dòng ghi trước cấp hai ⇒ đỏ.
    const { k, bc, kn, hr1, hr2, dem, cua } = await caHaiCap("dxd07");
    await datNguong(1_000);
    try {
      const kq = await nhanVaQuyet(bc, hr1, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 });
      expect(kq).toMatchObject({ loai: "CHO_CAP_HAI", soTien: 50_000 });
      expect(await dem()).toBe(0);
      expect(await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).toMatchObject({ status: "UNDER_REVIEW", resolution: null, decidedAt: null, closedAt: null, resolutionEntryId: null });
      const dx = await dxCua(kn.disputeId);
      expect(dx).toMatchObject({
        origin: "DISPUTE",
        status: "APPROVED_L1",
        governance: "SECOND_APPROVAL_REQUIRED",
        thresholdSnapshot: 1_000,
        requestedById: k.sale.id,
        approver1Id: hr1.userId,
        approver2Id: null,
        absTotal: 50_000,
        paymentId: cua("SALE").paymentId,
        calcSlotId: cua("SALE").calcSlotId,
      });
      expect((dx.goi as { key: string; chenh: number; rong: number }[])[0]).toMatchObject({ key: `SALE|USER|${k.sale.id}`, chenh: 50_000, rong: cua("SALE").amount });
      // trong lúc chờ: không nhận lại / quyết lại
      expect((await loiCua(() => nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr2, now: NOW }))).ma).toBe("DANG_CHO_CAP_HAI");
      expect((await loiCua(() => quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr1, dauVao: { loai: "TU_CHOI", lyDo: "Quyết lại khi đang chờ cấp hai" } }))).ma).toBe("DANG_CHO_CAP_HAI");
      // tách nhiệm: cấp 2 không thể là người cấp 1, người khiếu nại, hay người không giữ quyền
      expect((await loiCua(() => duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: hr1, lyDo: "Cấp 1 tự duyệt cấp 2 của chính mình" }))).ma).toBe("KHONG_DUOC_DUYET");
      const nguoiSale = await nguoiCua(k.sale);
      expect((await loiCua(() => duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: nguoiSale, lyDo: "Người khiếu nại tự duyệt khiếu nại" }))).ma).toBe("KHONG_CO_QUYEN");
      // đề xuất thuộc nguồn gốc KHÁC với cái action đã gác quyền theo ⇒ coi như không tồn tại
      expect((await loiCua(() => duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: hr2, lyDo: "Khai sai nguồn gốc để lấy khoá quyền khác" }))).ma).toBe("KHONG_TIM_THAY_DE_XUAT");
      expect(await dem()).toBe(0);

      const ok = await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: hr2, lyDo: "Cấp hai đã soát lại và đồng ý điều chỉnh" });
      expect(ok).toMatchObject({ loai: "DA_GHI", cap: 2, tong: 50_000 });
      expect(await dem()).toBe(1);
      expect(await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).toMatchObject({ status: "CLOSED", resolution: "MONEY_ADJUSTMENT", decidedById: hr1.userId });
      expect(await dxCua(kn.disputeId)).toMatchObject({ status: "POSTED", approver1Id: hr1.userId, approver2Id: hr2.userId });
      const dong = await db.commissionTransaction.findFirstOrThrow({ where: { entryKind: "DISPUTE_ADJUSTMENT", refEventId: kn.disputeId } });
      expect((await dxCua(kn.disputeId)).postedEntryIds).toEqual([dong.id]);
      expect(dong).toMatchObject({ amount: 50_000, roleCode: "SALE", beneficiaryUserId: k.sale.id });
    } finally {
      await xoaNguong();
    }
  });

  it("[DXD-08] |điều chỉnh| vượt hoa hồng đã ghi cho giao dịch ⇒ cấp hai dù DƯỚI ngưỡng mặc định (VUOT_CAN) — không im lặng cho qua", async () => {
    const { bc, kn, hr1, dem } = await caHaiCap("dxd08");
    await xoaNguong();
    const kq = await nhanVaQuyet(bc, hr1, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 4_000_000 });
    expect(kq.loai).toBe("CHO_CAP_HAI");
    expect(await dem()).toBe(0);
    const dx = await dxCua(kn.disputeId);
    expect(dx.thresholdSnapshot).toBe(10_000_000);
    expect((dx.governanceWhy as { lyDo: { ma: string }[] }).lyDo.map((l) => l.ma)).toEqual(["VUOT_CAN"]);
    expect(dx.boundSnapshot).toBe(800_000); // Σ ròng dương của ô: 400k + 100k + 200k + 100k
  });

  it("[DXD-09] số ròng đổi giữa hai bước (có khoản hoàn) ⇒ STALE: không ghi, khiếu nại còn UNDER_REVIEW và quyết lại được", async () => {
    const { k, bc, pay, kn, hr1, hr2, dem } = await caHaiCap("dxd09");
    await datNguong(1_000);
    try {
      expect((await nhanVaQuyet(bc, hr1, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 })).loai).toBe("CHO_CAP_HAI");
      const hoan = await hoanTien(k, pay, { soTien: 2_000_000, ngay: D("2026-11-05") });
      await quetKhoan(db, bc, hoan); // Sale bị đảo 80.000 ⇒ số ròng 320.000 ≠ 400.000 người cấp 1 đã thấy
      const dx = await dxCua(kn.disputeId);
      const r = await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: hr2, lyDo: "Cấp hai duyệt trên số đã cũ" });
      expect(r.loai).toBe("LOI_THOI");
      expect(await dem()).toBe(0);
      expect(await db.commissionAdjustmentRequest.findUniqueOrThrow({ where: { id: dx.id } })).toMatchObject({ status: "STALE" });
      expect((await db.commissionAdjustmentRequest.findUniqueOrThrow({ where: { id: dx.id } })).closeReason).toMatch(/Số ròng/);
      expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("UNDER_REVIEW");
      // quyết lại được (đề xuất cũ đã STALE ⇒ chỉ mục "một yêu cầu mở" nhả)
      expect((await quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr1, dauVao: { loai: "TU_CHOI", lyDo: "Số đã đổi, từ chối khiếu nại này" } })).loai).toBe("DA_TU_CHOI");
    } finally {
      await xoaNguong();
    }
  });

  it("[DXD-10] cấp 2 TỪ CHỐI ⇒ đề xuất REJECTED, khiếu nại còn UNDER_REVIEW, người cấp 1 quyết lại được (lần này dưới ngưỡng ⇒ một người)", async () => {
    const { bc, kn, hr1, hr2, dem } = await caHaiCap("dxd10");
    await datNguong(1_000);
    try {
      expect((await nhanVaQuyet(bc, hr1, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 })).loai).toBe("CHO_CAP_HAI");
      const dx = await dxCua(kn.disputeId);
      expect((await loiCua(() => tuChoiDeXuat(db, bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: hr1, lyDo: "Cấp 1 tự từ chối đề xuất của mình" }))).ma).toBe("KHONG_DUOC_DUYET");
      expect(await tuChoiDeXuat(db, bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: hr2, lyDo: "Số tiền chưa có căn cứ, từ chối cấp hai" })).toMatchObject({ loai: "DA_TU_CHOI" });
      expect(await db.commissionAdjustmentRequest.findUniqueOrThrow({ where: { id: dx.id } })).toMatchObject({ status: "REJECTED", rejectedById: hr2.userId });
      expect(await dem()).toBe(0);
      expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } })).status).toBe("UNDER_REVIEW");
      await xoaNguong();
      expect(await quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: hr1, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 20_000 } })).toMatchObject({ loai: "DA_DUYET_TIEN", soTien: 20_000 });
      expect(await dem()).toBe(1);
    } finally {
      await xoaNguong();
    }
  });

  it("[DXD-11] ngưỡng HỎNG ⇒ cấp hai dù 1 đồng; đối chứng dương: ngưỡng lớn + số nhỏ + trong cận ⇒ MỘT người, đề xuất vào thẳng POSTED/SINGLE_APPROVAL mang ngưỡng đã chụp", async () => {
    const a = await caHaiCap("dxd11a");
    await datNguong("mười triệu");
    try {
      expect((await nhanVaQuyet(a.bc, a.hr1, a.kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 1 })).loai).toBe("CHO_CAP_HAI");
      const dx = await dxCua(a.kn.disputeId);
      expect(dx).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", thresholdSnapshot: null });
      expect((dx.governanceWhy as { lyDo: { ma: string }[] }).lyDo.map((l) => l.ma)).toEqual(["NGUONG_KHONG_DOC_DUOC"]);
    } finally {
      await xoaNguong();
    }
    const b = await caHaiCap("dxd11b");
    await datNguong(1_000_000_000);
    try {
      expect((await nhanVaQuyet(b.bc, b.hr1, b.kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 })).loai).toBe("DA_DUYET_TIEN");
      expect(await dxCua(b.kn.disputeId)).toMatchObject({ status: "POSTED", governance: "SINGLE_APPROVAL", thresholdSnapshot: 1_000_000_000, approver1Id: b.hr1.userId, approver2Id: null });
      expect(await b.dem()).toBe(1);
    } finally {
      await xoaNguong();
    }
  });

  // ── TÍCH LUỸ (vá sau gộp, 08 §17.x mục 1) ───────────────────────────────────────────────────────────────

  /** MỘT khiếu nại tiền mới trên dòng `dong` của `nguoiKn`; `hr` nhận + quyết `soTien`. Trả khiếu nại, kết quả và đề xuất sinh ra. */
  async function khieuNaiTien(c: Awaited<ReturnType<typeof dungCa>>, nguoiKn: { id: string; name?: string | null }, dongId: string, hr: NguoiKhieuNai, soTien: number) {
    const kn = await taoDong(await nguoiCua(nguoiKn), dongId);
    const kq = await nhanVaQuyet(c.bc, hr, kn.disputeId, { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien });
    return { kn, kq, dx: await dxCua(kn.disputeId) };
  }
  const maLyDo = (dx: { governanceWhy: unknown }) => (dx.governanceWhy as { lyDo: { ma: string }[] }).lyDo.map((l) => l.ma);
  const tichLuyCua = (dx: { governanceWhy: unknown }) => (dx.governanceWhy as { tichLuy: number }).tichLuy;

  it("[DXD-12] CHUỖI khiếu nại nhỏ: từng cái dưới ngưỡng nhưng cái làm TỔNG tích luỹ đạt ngưỡng phải đòi cấp hai; hai cái đầu là đối chứng dương (một người)", async () => {
    // Cấy 1: `tichLuy` luôn 0 trong `docNenQuanTri` ⇒ khiếu nại thứ ba cũng "một người" ⇒ đỏ. Cấy 2: tính cả REJECTED/STALE ⇒ [DXD-13].
    const c = await dungCa("dxd12");
    const hr = await dungHR("dxd12");
    const dongSale = c.cua("SALE").id;
    await datNguong(1_000);
    try {
      const l1 = await khieuNaiTien(c, c.k.sale, dongSale, hr, 400);
      expect(l1.kq.loai).toBe("DA_DUYET_TIEN");
      expect(l1.dx).toMatchObject({ governance: "SINGLE_APPROVAL", status: "POSTED", absTotal: 400 });
      expect(tichLuyCua(l1.dx)).toBe(0);
      const l2 = await khieuNaiTien(c, c.k.sale, dongSale, hr, 400);
      expect(l2.kq.loai).toBe("DA_DUYET_TIEN"); // 400 + 400 = 800 < 1000: vẫn một người
      expect(tichLuyCua(l2.dx)).toBe(400);
      const l3 = await khieuNaiTien(c, c.k.sale, dongSale, hr, 400);
      expect(l3.kq.loai).toBe("CHO_CAP_HAI"); // 800 + 400 = 1200 ≥ 1000: một mình 400 < 1000 nhưng TỔNG thì không
      expect(l3.dx).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", status: "APPROVED_L1", absTotal: 400, thresholdSnapshot: 1_000 });
      expect(maLyDo(l3.dx)).toEqual(["TU_NGUONG"]);
      expect(tichLuyCua(l3.dx)).toBe(800);
      // sổ chỉ có hai dòng điều chỉnh: cái thứ ba CHƯA ghi (chờ cấp hai)
      expect(await db.commissionTransaction.count({ where: { calcSlotId: c.cua("SALE").calcSlotId, entryKind: "DISPUTE_ADJUSTMENT" } })).toBe(2);
    } finally {
      await xoaNguong();
    }
  });

  it("[DXD-13] tích luỹ đếm đề xuất ĐANG MỞ (kể cả của người khác trên cùng ô) và đã ghi; đề xuất bị TỪ CHỐI KHÔNG đếm", async () => {
    // Cấy: đếm cả REJECTED ⇒ khiếu nại cuối bị đẩy lên cấp hai oan ⇒ đỏ. Cấy: bỏ PENDING/APPROVED_L1 khỏi tập đếm ⇒ B không bị đẩy lên cấp hai ⇒ đỏ.
    const c = await dungCa("dxd13");
    const hr1 = await dungHR("dxd13a");
    const hr2 = await dungHR("dxd13b");
    const dongQlcs = c.dong.find((d) => d.beneficiaryUserId === c.k.qlcs.id)!;
    await datNguong(100_000);
    try {
      const a = await khieuNaiTien(c, c.k.sale, c.cua("SALE").id, hr1, 150_000);
      expect(a.kq.loai).toBe("CHO_CAP_HAI"); // một mình đã ≥ ngưỡng
      // B: người KHÁC, cùng ô, một mình 50.000 < ngưỡng — nhưng A đang mở (150.000) ⇒ 200.000 ≥ 100.000
      const b = await khieuNaiTien(c, c.k.qlcs, dongQlcs.id, hr1, 50_000);
      expect(b.kq.loai).toBe("CHO_CAP_HAI");
      expect(maLyDo(b.dx)).toEqual(["TU_NGUONG"]);
      expect(tichLuyCua(b.dx)).toBe(150_000);
      // cấp hai từ chối CẢ HAI ⇒ không đề xuất nào còn mở hay đã ghi
      for (const dx of [a.dx, b.dx]) {
        expect(await tuChoiDeXuat(db, c.bc, { requestId: dx.id, nguonGoc: "DISPUTE", nguoi: hr2, lyDo: "Số tiền chưa có căn cứ, từ chối cấp hai" })).toMatchObject({ loai: "DA_TU_CHOI" });
      }
      // đối chứng dương: người cấp 1 quyết lại khiếu nại của A với 50.000 — nếu REJECTED còn được đếm (300.000) thì vẫn cấp hai, đúng thì MỘT người
      const lai = await quyetDinhKhieuNai(db, c.bc, { disputeId: a.kn.disputeId, nguoi: hr1, dauVao: { loai: "DUYET_TIEN", lyDo: LY_DO_QD, soTien: 50_000 } });
      expect(lai).toMatchObject({ loai: "DA_DUYET_TIEN", soTien: 50_000 });
      const dxLai = await dxCua(a.kn.disputeId);
      expect(dxLai).toMatchObject({ governance: "SINGLE_APPROVAL", status: "POSTED" });
      expect(tichLuyCua(dxLai)).toBe(0);
    } finally {
      await xoaNguong();
    }
  });

  it("[DXD-14] cận neo vào hoa hồng GỐC engine tính: điều chỉnh đã ghi KHÔNG nâng cận — cái làm tổng vượt hoa hồng gốc ⇒ VUOT_CAN dù số ròng nay đã lớn hơn", async () => {
    // Cấy: cận tính từ số ròng (mọi dòng, gồm cả điều chỉnh) ⇒ cận 1,3 triệu ≥ 900.000 ⇒ khiếu nại thứ hai "một người" ⇒ đỏ.
    const c = await dungCa("dxd14");
    const hr = await dungHR("dxd14");
    await xoaNguong(); // ngưỡng mặc định 10 triệu: tách riêng vế CẬN khỏi vế NGƯỠNG
    const l1 = await khieuNaiTien(c, c.k.sale, c.cua("SALE").id, hr, 500_000);
    expect(l1.kq.loai).toBe("DA_DUYET_TIEN"); // 500.000 ≤ hoa hồng gốc 800.000
    expect(l1.dx.boundSnapshot).toBe(800_000);
    const l2 = await khieuNaiTien(c, c.k.sale, c.cua("SALE").id, hr, 400_000);
    expect(l2.kq.loai).toBe("CHO_CAP_HAI"); // 500.000 + 400.000 = 900.000 > 800.000
    expect(maLyDo(l2.dx)).toEqual(["VUOT_CAN"]);
    expect(l2.dx.boundSnapshot).toBe(800_000); // vẫn 800.000, KHÔNG phải 1.300.000 (số ròng của ô sau điều chỉnh)
    expect(tichLuyCua(l2.dx)).toBe(500_000);
    // đối chứng dương: 300.000 (800.000 = đúng bằng cận) vẫn một người
    const c2 = await dungCa("dxd14b");
    const hr2 = await dungHR("dxd14b");
    expect((await khieuNaiTien(c2, c2.k.sale, c2.cua("SALE").id, hr2, 500_000)).kq.loai).toBe("DA_DUYET_TIEN");
    expect((await khieuNaiTien(c2, c2.k.sale, c2.cua("SALE").id, hr2, 300_000)).kq.loai).toBe("DA_DUYET_TIEN");
  });

  // ── BẤT BIẾN ─────────────────────────────────────────────────────────────────────────────────

  it("[NHH-DSP-04] nội dung đã gửi BẤT BIẾN và khiếu nại KHÔNG xoá được — kể cả khi đi vòng qua service bằng SQL/Prisma trực tiếp (trigger DB)", async () => {
    const { k, cua } = await dungCa("dsp04");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    await expect(db.commissionDispute.update({ where: { id: kn.disputeId }, data: { reason: "Sửa lại lý do sau khi gửi cho đẹp hơn" } })).rejects.toThrow(/bất biến/);
    await expect(db.commissionDispute.update({ where: { id: kn.disputeId }, data: { evidence: [{ ghiChu: "bằng chứng đã bị thay đổi sau khi gửi" }] } })).rejects.toThrow(/bất biến/);
    await expect(db.commissionDispute.update({ where: { id: kn.disputeId }, data: { raisedByUserId: k.qlcs.id } })).rejects.toThrow();
    await expect(db.commissionDispute.delete({ where: { id: kn.disputeId } })).rejects.toThrow(/không bao giờ bị xoá/);
    await expect(db.$executeRaw`DELETE FROM "CommissionDispute" WHERE "id" = ${kn.disputeId}`).rejects.toThrow(/không bao giờ bị xoá/);
    const row = await db.commissionDispute.findUniqueOrThrow({ where: { id: kn.disputeId } });
    expect(row.reason).toBe(LY_DO);
    expect(row.evidence).toEqual(BANG_CHUNG);
  });

  it("[NHH-DSP-07] MỌI bước có AuditLog cùng module 'hoa-hong': tạo (người khiếu nại) · nhận (HR) · giao lại (HR) · quyết (HR, có lý do) · đóng (hệ thống)", async () => {
    const { k, bc, cua } = await dungCa("dsp07");
    const kn = await taoDong(await nguoiCua(k.sale), cua("SALE").id);
    const a = await dungHR("dsp07-a");
    const b = await dungHR("dsp07-b");
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: a, now: NOW });
    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: a, nguoiNhanId: b.userId, now: NOW });
    await quyetDinhKhieuNai(db, bc, { disputeId: kn.disputeId, nguoi: b, dauVao: { loai: "TU_CHOI", lyDo: "Không đủ căn cứ để điều chỉnh" } });
    const log = await auditCua(kn.disputeId);
    expect(log.map((x) => [x.action, x.actorId])).toEqual([
      ["CREATE", k.sale.id],
      ["ASSIGN", a.userId],
      ["REASSIGN", a.userId],
      ["DECIDE", b.userId],
      ["CLOSE", null],
    ]);
    expect(new Set(log.map((x) => x.module))).toEqual(new Set(["hoa-hong"]));
    expect(log.find((x) => x.action === "DECIDE")!.reason).toBe("Không đủ căn cứ để điều chỉnh");
  });
});
