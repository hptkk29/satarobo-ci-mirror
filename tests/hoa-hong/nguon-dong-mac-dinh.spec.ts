// @vitest-environment node
/**
 * [MD-*] — CHÍNH SÁCH MẶC ĐỊNH THEO NGUỒN, đo bằng TIỀN (Postgres THẬT; seed + guardrail + engine + sổ đều THẬT).
 * Quyết định chủ dự án 09/10/2026 (xác nhận): «Marketing 1% CHỈ trả cho nguồn quảng cáo; các nguồn khác không trả Marketing». Hiện thực bằng DỮ LIỆU:
 * tám chính sách NHÁP (`lapKeHoachSeedV1`), mỗi cái một dòng `EXCLUDE MARKETING`; PAID_ADS thêm `SOURCE_OWNER` 1%; hai nguồn referral thêm 2%.
 * Ca này lấy NGUYÊN rule từ kế hoạch seed, tạo + KÍCH HOẠT bằng service/guardrail thật (không chèn rule ACTIVE tay), rồi trả tiền và đọc sổ.
 *
 * Mọi con số là NEW 10.000.000 đ học phí ròng. Bộ chung = Sale 4 · Sale Admin 1 · QLCS 2 · Marketing 1 · GV Trial 1 = 9% (kịch bản có GV Trial thật — thiếu GV thì chỉ 8%).
 *
 *   [MDN-01] WALK_IN (cờ commissionEnabled TẮT) ⇒ 8% — Marketing KHÔNG trả; nguồn admin tạo chưa có chính sách ⇒ vẫn 9% (đối chứng dương)
 *   [MDN-02] CENTER_ORGANIC · EVENT · PARTNER · OTHER ⇒ 8% mỗi nguồn
 *   [MDN-03] PAID_ADS (chủ nguồn ĐÃ khai lúc ghi nhận) ⇒ 9%, 1% Marketing về CHỦ NGUỒN, không về người phụ trách Marketing của cơ sở; trước khi kích hoạt vẫn đường cũ; ngoài cửa sổ ghi công ⇒ 8%
 *   [MDN-04] PAID_ADS (chủ nguồn CHƯA khai lúc ghi nhận) ⇒ phần SOURCE_OWNER vào hàng chờ NGUON_CHUA_CO_NGUOI_PHU_TRACH, KHÔNG rơi về Marketing cơ sở
 *   [MDN-05] PARENT_REFERRAL kích hoạt đủ ⇒ VUOT_TRAN chỉ đường (trần là việc của admin); đặt trần đủ ⇒ kích hoạt được, tổng = 10%, Marketing loại
 *   [MDN-06] EMPLOYEE_REFERRAL tương tự [MDN-05]
 *   [MDN-07] UNKNOWN: có nhóm không trả Marketing ⇒ Marketing của UNKNOWN = 0; chưa có ⇒ vẫn trả (đối chứng dương)
 *   [MDN-08] THỬ TÍNH thật (`thuTinhPhienBan` → mo-phong-db) hiểu dòng EXCLUDE ở nguồn cờ tắt: nháp WALK_IN ⇒ chênh −1% và KHÔNG vi phạm trần; nháp EMPLOYEE_REFERRAL ⇒ vi phạm trần (đối chứng dương)
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng, chạy được MỘT MÌNH trên DB trống đã migrate + seed vai. LUẬT 19: ngày tuyệt đối.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { thuTinhPhienBan } from "../../lib/hoa-hong/mo-phong-hanh-dong";
import { lapKeHoachSeedV1 } from "../../lib/hoa-hong/ke-hoach-seed-v1";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, ganNguon, ganVai, lamNhanVien, nguoiKyHo, themGvTrial, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { baoDamNguoiPhuTrach, chiTietChanKichHoat, chinhSachNguonQuaService, datTranHoaHong, donNguoiPhuTrach, ghiNguonQuaDuongThat, lamSachChinhSach, suaNguon, themLead, thuKichHoat, trangThaiPhienBan, taoNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[MD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-dyn-md";
const NOW = D("2027-02-20");
const NGAY_THU = D("2026-11-20"); // ngày thứ 50 kể từ ATTRIBUTED — TRONG cửa sổ 90 ngày
const NGAY_NGOAI_CUA_SO = D("2027-01-10"); // ngày thứ 101 — NGOÀI cửa sổ
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
let stamp = 0;

async function kb(tien: string) {
  const k = await dungKichBan(tien); // bộ chung SEED_V1 (Sale 4 · Sale Admin 1 · QLCS 2 · Marketing 1 · GV Trial 1)
  cuaToi.push(k);
  return k;
}

/** Rule của nguồn lấy NGUYÊN từ kế hoạch seed thật (không gõ tay tỉ lệ nào trong ca này). */
const ruleSeed = (maNhom: string) => lapKeHoachSeedV1().chinhSach.find((c) => c.maNhom === maNhom)!.rules;

const nhomId = async (code: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;

/** Tạo + KÍCH HOẠT chính sách mặc định của một nguồn qua service/guardrail thật; trả danh sách mã chặn (rỗng = ACTIVE). */
async function kichHoatMacDinh(k: KichBan, maNhom: string) {
  const cs = await chinhSachNguonQuaService(k, { hau: maNhom.toLowerCase().replace(/_/g, ""), sourceGroupId: await nhomId(maNhom), rules: [...ruleSeed(maNhom)] });
  return { cs, chan: await thuKichHoat(cs.versionId) };
}

/** Người + nhân sự có tài khoản. */
async function nhanSuCoTaiKhoan(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  return { userId: u.id, employeeId: await lamNhanVien(u.id, `${k.ma}-${hau}`) };
}

/** Một khoản NEW 10.000.000 đ KÈM GV Trial thật (đủ 5 vai của bộ chung) → quét bằng engine thật. */
async function thanhToan(k: KichBan, ten: string, ngay: Date = NGAY_THU) {
  const gv = await seedUser({ email: `${k.ma}-gv-${ten}@ci.test`, role: "TEACHER", name: `${k.ma}-gv-${ten}`, phone: null });
  const leadChildId = await themGvTrial(k, gv.id, ten);
  const bc = await boiCanh(k, NOW);
  const khoan = await tienVe(k, await dungBe(k, ten, { tongTien: 10_000_000, leadChildId }), { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  const dong = await dongSoCuaKhoan(khoan);
  return { khoan, gv, dong, tom: tomTat(dong) };
}

/** Bốn vai KHÔNG phụ thuộc nguồn (Sale 4 · Sale Admin 1 · QLCS 2 · GV Trial 1 = 8%) — phần còn lại tuỳ nguồn. */
const bonVai = (k: KichBan, gvId: string) => ({
  [`SALE:${k.sale.id}`]: 400_000,
  [`SALE_ADMIN:${k.saleAdmin.id}`]: 100_000,
  [`CENTER_MANAGER:${k.qlcs.id}`]: 200_000,
  [`TRIAL_TEACHER:${gvId}`]: 100_000,
});
const tong = (tom: Record<string, number>) => Object.values(tom).reduce((s, x) => s + x, 0);
const khongCoVai = (tom: Record<string, number>, vai: string) => Object.keys(tom).some((x) => x.startsWith(`${vai}:`));

const nguonChon = (groupId: string) => ({ nguonChon: { groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } });
const quangCao = { adId: "ad-1", campaignId: "cp-1", adsetId: null, campaignName: "Camp", formId: null, fbclid: null, gclid: null };

describe.skipIf(!RUN_DB_TESTS)("[MD] chính sách mặc định theo nguồn — số tiền", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db); // 8 nguồn mặc định + UNKNOWN (luật 18: không mượn danh mục do bộ trước để lại)
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "MARKETING", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
  }, 120_000);

  // Cờ `nguon.*`, trần và chủ PAID_ADS là trạng thái TOÀN HỆ: ca nào đổi thì ca sau không được thừa hưởng (luật 18).
  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
    await datTranHoaHong(null);
  });

  afterAll(async () => {
    await datTranHoaHong(null);
    await donKichBan(cuaToi); // cắt sổ cái (FK Restrict sang LeadAttribution) trước khi xoá quy nguồn
    // lead PHỤ do `themLead` dựng (parentName = «<mã kịch bản>-<hậu tố>») không nằm trong `cuaToi`: quy nguồn của chúng trỏ vào nhóm GỐC (PAID_ADS, EVENT…) nên nếu để lại thì bộ
    // lead-intake chạy SAU trên cùng DB không xoá được danh mục (FK Restrict) — luật 18, đo 09/10: [NHH-SRC-07d-loi]/[07e-loi] đỏ vì đúng lý do này.
    const leadPhu = (await db.lead.findMany({ where: { OR: cuaToi.map((k) => ({ parentName: { startsWith: k.ma } })) }, select: { id: true } })).map((l) => l.id);
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: leadPhu } } });
    await db.leadAttribution.deleteMany({ where: { leadId: { in: leadPhu } } });
    await donNguoiPhuTrach(NHAN);
    await db.leadSourceGroup.updateMany({ where: { code: "PAID_ADS" }, data: { ownerEmployeeId: null } });
    const nhomDyn = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "DYN_" } }, select: { id: true } })).map((g) => g.id);
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhomDyn } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhomDyn } }, { originalGroupId: { in: nhomDyn } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DYN_" } } });
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: NHAN } } });
    // lead PHỤ (`themLead`) không nằm trong `cuaToi` ⇒ dọn quy nguồn trỏ tới học viên của ca (FK Restrict) trước khi xoá học viên
    const hvCa = (await db.student.findMany({ where: { name: { startsWith: "fx-dyn-md" } }, select: { id: true } })).map((s) => s.id);
    const attrCa = (await db.leadAttribution.findMany({ where: { referrerStudentId: { in: hvCa } }, select: { id: true, leadId: true } }));
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: attrCa.map((a) => a.leadId) } } });
    await db.leadAttribution.deleteMany({ where: { id: { in: attrCa.map((a) => a.id) } } });
    await db.student.deleteMany({ where: { id: { in: hvCa } } });
    await datMocCutover(null);
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[MDN-01] WALK_IN (nguồn cờ commissionEnabled TẮT) ⇒ 8%: dòng EXCLUDE CHẠY dù nguồn không «tham gia hoa hồng», Marketing KHÔNG trả, bốn vai kia nguyên vẹn; nguồn admin tạo chưa có chính sách ⇒ vẫn 9% (đối chứng dương)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m01");
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" } })).commissionEnabled, "tiền đề: WALK_IN cờ TẮT, không thì ca này không đo miễn EXCLUDE").toBe(false);
    const { cs, chan } = await kichHoatMacDinh(k, "WALK_IN");
    expect(chan).toEqual([]); // guardrail không đòi nguồn «tham gia hoa hồng» cho dòng loại trừ
    expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");

    await ganNguon(k, "WALK_IN", { attributedAt: ATTRIBUTED });
    const a = await thanhToan(k, "a");
    expect(a.tom).toEqual(bonVai(k, a.gv.id));
    expect(tong(a.tom)).toBe(800_000);
    expect(khongCoVai(a.tom, "MARKETING")).toBe(false);
    expect(await db.commissionHold.count({ where: { paymentId: a.khoan } })).toBe(0); // loại trừ là «không trả», không phải «treo»

    // đối chứng dương: nguồn do admin tạo, KHÔNG có chính sách riêng ⇒ Marketing vẫn theo mức chung
    stamp += 1;
    const moi = await taoNguon({
      nguoi: admin,
      vao: {
        code: `DYN_M1_${Date.now().toString(36).toUpperCase()}${stamp}`,
        name: "DYN M1",
        description: null,
        sourceType: "OTHER",
        referrerRequirement: "NONE",
        requiresNote: false,
        selectable: true,
        sortOrder: 400,
        trangThai: "ACTIVE",
        attributionWindowDays: null,
        commissionEnabled: false,
        ownerOrgUnitId: null,
        ownerEmployeeId: null,
        effectiveFrom: null,
        effectiveTo: null,
      },
    });
    if (!moi.ok) throw new Error(`taoNguon: ${moi.truong}: ${moi.loi}`);
    const k2 = await themLead(k, "moi");
    await ghiNguonQuaDuongThat(k2, nguonChon(moi.id), ATTRIBUTED, k2.lead!.id);
    const b = await thanhToan(k2, "b", D("2026-11-21"));
    expect(b.tom).toEqual({ ...bonVai(k, b.gv.id), [`MARKETING:${k.qc.id}`]: 100_000 });
    expect(tong(b.tom)).toBe(900_000);
  });

  it("[MDN-02] CENTER_ORGANIC · EVENT · PARTNER · OTHER (mỗi nguồn một chính sách mặc định, kích hoạt qua guardrail thật) ⇒ 8% mỗi nguồn, Marketing không trả", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m02");
    for (const ma of ["CENTER_ORGANIC", "EVENT", "PARTNER", "OTHER"]) {
      const { chan } = await kichHoatMacDinh(k, ma);
      expect(chan, ma).toEqual([]);
    }
    let i = 0;
    for (const ma of ["CENTER_ORGANIC", "EVENT", "PARTNER", "OTHER"]) {
      i += 1;
      const ki = i === 1 ? k : await themLead(k, `n${i}`);
      await ganNguon(ki, ma, { attributedAt: ATTRIBUTED });
      const r = await thanhToan(ki, `n${i}`, D(`2026-11-${20 + i}`));
      expect(r.tom, ma).toEqual(bonVai(k, r.gv.id));
      expect(tong(r.tom), ma).toBe(800_000);
    }
  });

  it("[MDN-03] PAID_ADS có CHỦ NGUỒN lúc ghi nhận ⇒ 9%: 1% Marketing về CHỦ NGUỒN, KHÔNG về người phụ trách Marketing của cơ sở; trước khi kích hoạt vẫn đường cũ; NEW ngoài cửa sổ ghi công ⇒ 8% (vai chủ nguồn chịu cửa sổ)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m03");
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    const nhom = await nhomId("PAID_ADS");
    try {
      const sua = await suaNguon({ nguoi: admin, id: nhom, updatedAtDaThay: (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhom } })).updatedAt, vao: { ownerEmployeeId: chu.employeeId }, lyDo: "khai chủ nguồn quảng cáo cho ca nghiệm thu" });
      expect(sua, JSON.stringify(sua)).toMatchObject({ ok: true });
      const quang = { duongVao: "facebook", conversionEntry: "facebook", quangCao } as const;
      await ghiNguonQuaDuongThat(k, quang, ATTRIBUTED);
      const k2 = await themLead(k, "b");
      await ghiNguonQuaDuongThat(k2, quang, ATTRIBUTED, k2.lead!.id);
      const k3 = await themLead(k, "c");
      await ghiNguonQuaDuongThat(k3, quang, ATTRIBUTED, k3.lead!.id);
      expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id }, include: { group: { select: { code: true } } } })).group.code).toBe("PAID_ADS");

      // TRƯỚC khi kích hoạt chính sách mặc định: đường cũ (người phụ trách Marketing của cơ sở nhận 1%, không ai là chủ nguồn)
      const truoc = await thanhToan(k, "a");
      expect(truoc.tom).toEqual({ ...bonVai(k, truoc.gv.id), [`MARKETING:${k.qc.id}`]: 100_000 });

      const { cs, chan } = await kichHoatMacDinh(k, "PAID_ADS");
      expect(chan, "chủ nguồn đã khai ⇒ guardrail qua").toEqual([]);
      expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");

      const sau = await thanhToan(k2, "b", D("2026-11-21"));
      expect(sau.tom).toEqual({ ...bonVai(k, sau.gv.id), [`SOURCE_OWNER:${chu.userId}`]: 100_000 });
      expect(tong(sau.tom)).toBe(900_000);
      expect(khongCoVai(sau.tom, "MARKETING"), "người phụ trách Marketing của cơ sở KHÔNG được trả thêm").toBe(false);
      expect(sau.dong.find((d) => d.roleCode === "SOURCE_OWNER")).toMatchObject({ beneficiaryUserId: chu.userId, sourceGroupCode: "PAID_ADS" });

      // NGOÀI cửa sổ ghi công (ngày thứ 101): SOURCE_OWNER là vai acquisition nên rụng, Marketing cơ sở vẫn bị loại ⇒ 8%. ĐÂY LÀ HỆ QUẢ PHẢI BIẾT: trước đây 1% Marketing không chịu cửa sổ.
      const ngoai = await thanhToan(k3, "c", NGAY_NGOAI_CUA_SO);
      expect(ngoai.tom).toEqual(bonVai(k, ngoai.gv.id));
      expect(tong(ngoai.tom)).toBe(800_000);
    } finally {
      await lamSachChinhSach();
      await db.leadSourceGroup.update({ where: { id: nhom }, data: { ownerEmployeeId: null } });
    }
  });

  it("[MDN-04] PAID_ADS CHƯA có chủ nguồn lúc ghi nhận ⇒ phần SOURCE_OWNER vào hàng chờ NGUON_CHUA_CO_NGUOI_PHU_TRACH; Marketing cơ sở KHÔNG nhận thay (không rơi về mức chung)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m04");
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    const nhom = await nhomId("PAID_ADS");
    try {
      // (1) ghi nhận KHI nguồn chưa có chủ — bản chụp lưu «chưa có chủ»; (2) khai chủ SAU; (3) kích hoạt qua guardrail (qua được vì nguồn nay có chủ); (4) trả tiền
      await ghiNguonQuaDuongThat(k, { duongVao: "facebook", conversionEntry: "facebook", quangCao }, ATTRIBUTED);
      expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhom } })).ownerEmployeeId).toBeNull();
      const cs0 = await chinhSachNguonQuaService(k, { hau: "paidads", sourceGroupId: nhom, rules: [...ruleSeed("PAID_ADS")] });
      // đối chứng: chưa khai chủ thì guardrail CHẶN (hai tầng bảo vệ: cổng kích hoạt, rồi hàng chờ nếu chủ bị bỏ đi sau đó)
      expect((await chiTietChanKichHoat(cs0.versionId)).map((x) => x.ma)).toContain("NGUON_CHUA_CO_NGUOI_PHU_TRACH");
      expect(await trangThaiPhienBan(cs0.versionId)).toBe("DRAFT");
      const sua = await suaNguon({ nguoi: admin, id: nhom, updatedAtDaThay: (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhom } })).updatedAt, vao: { ownerEmployeeId: chu.employeeId }, lyDo: "khai chủ nguồn SAU khi lead đã ghi nhận" });
      expect(sua, JSON.stringify(sua)).toMatchObject({ ok: true });
      expect(await thuKichHoat(cs0.versionId)).toEqual([]);
      expect(await trangThaiPhienBan(cs0.versionId)).toBe("ACTIVE");

      const r = await thanhToan(k, "a");
      expect(r.tom).toEqual(bonVai(k, r.gv.id)); // 8%: không SOURCE_OWNER, KHÔNG MARKETING
      expect(khongCoVai(r.tom, "MARKETING")).toBe(false);
      expect(khongCoVai(r.tom, "SOURCE_OWNER")).toBe(false);
      const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: r.khoan } });
      expect(hold.detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });
    } finally {
      await lamSachChinhSach();
      await db.leadSourceGroup.update({ where: { id: nhom }, data: { ownerEmployeeId: null } });
    }
  });

  it("[MDN-05] PARENT_REFERRAL kích hoạt đủ ⇒ VUOT_TRAN CHỈ ĐƯỜNG (tổng · trần · chênh · liên kết) ở trần hiện hành; admin đặt trần đủ ⇒ kích hoạt được, tổng = 10%, Sale phụ trách PH nhận 2%, Marketing loại", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m05");
    const nv = (ten: string) => seedUser({ email: `${k.ma}-${ten}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${ten}`, phone: null });
    const [saleX, ph] = await Promise.all([nv("x"), seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph`, phone: null })]);
    const leadGoc = await db.lead.create({
      data: { parentName: `${k.ma}-goc`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "DA_DANG_KY", convertedById: saleX.id, centerId: k.centerId, createdAt: D("2026-09-01") },
    });
    const hv = await db.student.create({ data: { id: `${k.ma}-hvph`, name: `fx-dyn-md Bé PH ${k.ma}`, centerId: k.centerId, parentUserId: ph.id, leadId: leadGoc.id } });
    const a = await ghiNguonQuaDuongThat(k, { phuHuynhGioiThieu: { parentUserId: ph.id, studentId: hv.id } }, ATTRIBUTED);
    expect(a.group.code).toBe("PARENT_REFERRAL");
    expect(a.referrerSaleUserId).toBe(saleX.id);

    const cs = await chinhSachNguonQuaService(k, { hau: "ph", sourceGroupId: await nhomId("PARENT_REFERRAL"), rules: [...ruleSeed("PARENT_REFERRAL")] });
    // trần hiện hành 9%: chặn đúng MỘT mã, và nói số: tổng cao nhất 10% · trần 9% · vượt 1 điểm · có liên kết tới Cấu hình vận hành
    const chan = await chiTietChanKichHoat(cs.versionId);
    expect(chan.map((x) => x.ma)).toEqual(["VUOT_TRAN"]);
    expect(chan[0]!.huongXuLy).toMatchObject({ tongPhanTram: "10", tranPhanTram: "9", chenhLechPhanTram: "1", coTheNangTran: true, duongDan: { href: "/cau-hinh-van-hanh?tab=khach-hang" } });
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT");
    const khiChan = await thanhToan(k, "a");
    expect(khongCoVai(khiChan.tom, "REFERRER_PARENT_SALE"), "chưa kích hoạt ⇒ không dòng thu hút").toBe(false);
    expect(khiChan.tom[`MARKETING:${k.qc.id}`], "chưa kích hoạt ⇒ Marketing theo đường cũ").toBe(100_000);

    try {
      await datTranHoaHong(0.1);
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");
      const k2 = await themLead(k, "b");
      await ghiNguonQuaDuongThat(k2, { phuHuynhGioiThieu: { parentUserId: ph.id, studentId: hv.id } }, ATTRIBUTED, k2.lead!.id);
      const r = await thanhToan(k2, "b", D("2026-11-21"));
      expect(r.tom).toEqual({ ...bonVai(k, r.gv.id), [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });
      expect(tong(r.tom)).toBe(1_000_000);
      expect(khongCoVai(r.tom, "MARKETING")).toBe(false);
    } finally {
      await datTranHoaHong(null);
    }
  });

  it("[MDN-06] EMPLOYEE_REFERRAL kích hoạt đủ ⇒ VUOT_TRAN ở trần hiện hành; trần đủ ⇒ tổng = 10%, nhân sự giới thiệu nhận 2%, Marketing loại", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m06");
    const e = await nhanSuCoTaiKhoan(k, "e");
    await ganVai(e.userId, k.ouId, "CENTER_SALES_CSM");
    const a = await ghiNguonQuaDuongThat(k, { nhanSuGioiThieuEmployeeId: e.employeeId }, ATTRIBUTED);
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    const cs = await chinhSachNguonQuaService(k, { hau: "nv", sourceGroupId: await nhomId("EMPLOYEE_REFERRAL"), rules: [...ruleSeed("EMPLOYEE_REFERRAL")] });
    expect(await thuKichHoat(cs.versionId)).toEqual(["VUOT_TRAN"]);
    try {
      await datTranHoaHong(0.1);
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      const r = await thanhToan(k, "a");
      expect(r.tom).toEqual({ ...bonVai(k, r.gv.id), [`REFERRER_EMPLOYEE:${e.userId}`]: 200_000 });
      expect(tong(r.tom)).toBe(1_000_000);
      expect(khongCoVai(r.tom, "MARKETING")).toBe(false);
    } finally {
      await datTranHoaHong(null);
    }
  });

  it("[MDN-07] UNKNOWN = mức THẤP NHẤT giữa các nhóm: khi có nhóm không trả Marketing ⇒ Marketing của UNKNOWN = 0 (bốn vai kia nguyên vẹn); trước đó vẫn trả (đối chứng dương)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("m07"); // lead KHÔNG có quy nguồn ⇒ UNKNOWN
    const truoc = await thanhToan(k, "a");
    expect(truoc.tom).toEqual({ ...bonVai(k, truoc.gv.id), [`MARKETING:${k.qc.id}`]: 100_000 });

    const { chan } = await kichHoatMacDinh(k, "WALK_IN");
    expect(chan).toEqual([]);
    const sau = await thanhToan(k, "b", D("2026-11-21"));
    expect(sau.tom).toEqual(bonVai(k, sau.gv.id));
    expect(khongCoVai(sau.tom, "MARKETING")).toBe(false);
  });

  it("[MDN-08] THỬ TÍNH thật (nháp chưa kích hoạt): dòng EXCLUDE ở nguồn cờ TẮT được tính — nháp WALK_IN làm hoa hồng giảm đúng 1% (−100.000 đ trên 10 triệu) và KHÔNG vi phạm trần; nháp EMPLOYEE_REFERRAL vi phạm trần và bị chặn nguyên (đối chứng dương)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const nguoi = await nguoiKyHo();
    // Thử tính đọc TOÀN tập chính sách ACTIVE của DB (không lọc theo kịch bản như `boiCanh`): mọi phép thử phải dùng CÙNG một kịch bản (một bộ chung ACTIVE), không thì hai bộ GLOBAL cùng hạng ⇒ CHONG_LAN.
    const thu = async (k: KichBan, versionId: string, tuNgay: string, denNgay: string) => {
      const r = await thuTinhPhienBan({ actor: nguoi.quyen, now: D("2026-12-31"), versionId, tuNgay, denNgay, orgUnitId: k.ouId });
      expect(r.ok, r.ok ? "" : r.chung).toBe(true);
      if (!r.ok) throw new Error(r.chung);
      return r.ketQua;
    };

    // WALK_IN (cờ TẮT): khoản không có GV Trial ⇒ hiện hành Sale 4 + Admin 1 + QLCS 2 + Marketing 1 = 8% = 800.000; nháp loại Marketing ⇒ 700.000
    const k = await kb("m08");
    await ganNguon(k, "WALK_IN", { attributedAt: ATTRIBUTED });
    const wi = await chinhSachNguonQuaService(k, { hau: "wi", sourceGroupId: await nhomId("WALK_IN"), rules: [...ruleSeed("WALK_IN")] });
    expect(await trangThaiPhienBan(wi.versionId)).toBe("DRAFT");
    await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-11-10") });
    const a = await thu(k, wi.versionId, "2026-11-01", "2026-11-30");
    expect(a.soKhoanTinhDuoc).toBeGreaterThanOrEqual(1);
    expect(a.hoaHong.hienTai).toBe(800_000);
    expect(a.hoaHong.deXuat).toBe(700_000);
    expect(a.hoaHong.chenh).toBe(-100_000);
    expect(a.tran.deXuat.soKhoan).toBe(0);
    expect(await trangThaiPhienBan(wi.versionId)).toBe("DRAFT"); // thử tính không kích hoạt, không ghi sổ

    // đối chứng dương: nháp EMPLOYEE_REFERRAL cộng 2% (Marketing loại) ⇒ 10% cấu hình > trần 9% ⇒ vi phạm, khoản bị chặn nguyên (đề xuất = 0)
    const k2 = await themLead(k, "nv"); // cùng cơ sở, cùng bộ chung ACTIVE — lead khác
    const e = await nhanSuCoTaiKhoan(k, "e");
    await ganVai(e.userId, k.ouId, "CENTER_SALES_CSM");
    await ghiNguonQuaDuongThat(k2, { nhanSuGioiThieuEmployeeId: e.employeeId }, ATTRIBUTED);
    const nv = await chinhSachNguonQuaService(k2, { hau: "nv", sourceGroupId: await nhomId("EMPLOYEE_REFERRAL"), rules: [...ruleSeed("EMPLOYEE_REFERRAL")] });
    await tienVe(k2, await dungBe(k2, "b", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-12-10") });
    const b = await thu(k, nv.versionId, "2026-12-01", "2026-12-31");
    expect(b.tran.deXuat.soKhoan).toBeGreaterThanOrEqual(1);
    expect(b.hoaHong.deXuat).toBe(0);
  });
});
