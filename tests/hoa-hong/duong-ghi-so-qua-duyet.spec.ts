// @vitest-environment node
/**
 * [SEG-*] · [CRN-*] · [FEV-*] — TÁCH NHIỆM BA VAI, CRON KHÔNG GHI, SỰ KIỆN FAILED (08 §17.v4.Q mục 8, 9), trên Postgres THẬT.
 *
 *   [SEG-01] người giữ CẢ HAI khoá quyền (kế toán HO + nhân sự HO) mà chính là người ĐỔI NGUỒN: không duyệt cấp 1, không từ chối — trên đề xuất một người LẪN hai người; sổ không đổi
 *   [SEG-03] CÙNG hai ca trên đi qua LỚP ĐIỀU PHỐI mà Server Action gọi (`hanhDongDuyetDeXuat`): `{ ok: false }` kèm câu tiếng Việt, sổ không đổi; người thứ ba duyệt được (Server Action `duyetDeXuatAction` chỉ thêm `auth()` + `can()` + revalidate — phần đó cần phiên nên KHÔNG chạy ở đây)
 *   [SEG-02] người giữ cả hai khoá làm cấp 1 ⇒ KHÔNG làm được cấp 2 (cũng không từ chối ở cấp 2); người khác làm cấp 2 ghi sổ; ba vai (đề xuất · cấp 1 · cấp 2) là BA NGƯỜI KHÁC NHAU trong DB
 *   [CRN-01] hai cron hoa hồng (quét kỳ · đối soát nền) chạy trước/sau khi sự kiện đổi nguồn được xử lý: 0 dòng SOURCE_CORRECTION / INPUT_CORRECTION / DISPUTE_ADJUSTMENT mới, 0 đề xuất mới, đề xuất vẫn PENDING
 *   [FEV-01] sự kiện đổi nguồn FAILED + đề xuất POSTED lập sau đó bằng đường backfill (audit:…): "Áp dụng" chênh lệch về sau KHÔNG còn bị khoá vĩnh viễn (trước: HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET mãi)
 *   [FEV-02] ĐỐI CHỨNG ÂM: đề xuất POSTED CŨ (của lần đổi nguồn trước) KHÔNG mở khoá cho lần đổi nguồn MỚI bị FAILED — "Áp dụng" vẫn bị từ chối
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/hoa-hong/khieu-nai-gui-thong-bao", () => ({ baoKhieuNaiMoi: vi.fn(), baoKetQuaKhieuNai: vi.fn() }));
// Lớp điều phối tự dựng bối cảnh quét từ MỌI chính sách đang ACTIVE trong DB; các kịch bản của spec này (và của spec khác đã chạy trước trên cùng DB) mỗi cái một chính sách riêng, nên bối cảnh
// "mọi chính sách" làm số tính lại lúc duyệt khác gói đã duyệt (STALE). Test dùng bối cảnh LỌC theo kịch bản (`boiCanh(k, …)`) như mọi spec khác — cổng engine bật/tắt có ca riêng ở khieu-nai-hanh-dong.spec.ts.
const bcHienTai = vi.hoisted(() => ({ v: null as unknown }));
vi.mock("@/lib/hoa-hong/boi-canh", async (goc) => ({ ...(await goc<typeof import("@/lib/hoa-hong/boi-canh")>()), dungBoiCanhQuet: async () => ({ loai: "BAT", bc: bcHienTai.v }) }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import type { Actor } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { duyetDeXuat, tuChoiDeXuat, type NguoiDuyetDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { hanhDongDuyetDeXuat } from "../../lib/hoa-hong/khieu-nai-hanh-dong";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { doiSoatNen, quetKy } from "../../lib/hoa-hong/quet-ky";
import { KHOA_DUYET_DE_XUAT } from "../../lib/hoa-hong/quan-tri-dieu-chinh";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { capKhoaGhiNguon, damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, donViHoiSo, dungBe, dungKichBan, ganNguon, ganVai, nguoiKyHo, themChinhSachNhom, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[SEG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
const CO_SAU: KiemQuyen = async (action) => action === "sources:override-after-payment";
const actorCoSo = (userId: string, centerId: string) =>
  capKhoaGhiNguon(({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor);

describe.skipIf(!RUN_DB_TESTS)("[SEG] tách nhiệm ba vai · cron không ghi · sự kiện FAILED", () => {
  const cuaToi: KichBan[] = [];
  let NGUOI: Awaited<ReturnType<typeof nguoiKyHo>>;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
  }, 120_000);
  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  /** Một người dùng giữ CẢ HAI khoá duyệt (nhân sự HO: `commission_disputes:review` · kế toán HO: `commission_periods:manage`). */
  async function nguoiHaiKhoa(ten: string): Promise<NguoiDuyetDeXuat> {
    const u = await seedUser({ email: `${ten}-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: ten, phone: null });
    const ho = await donViHoiSo();
    await ganVai(u.id, ho, "HO_ACCOUNTANT");
    await ganVai(u.id, ho, "HO_HR");
    const quyen = await actorCua(u.id);
    // nếu hai khoá không cùng có thì ca này không chứng minh gì (luật 11: đo cái cần đo)
    expect(can(quyen, KHOA_DUYET_DE_XUAT.DISPUTE)).toBe(true);
    expect(can(quyen, KHOA_DUYET_DE_XUAT.SOURCE_CHANGE)).toBe(true);
    return { userId: u.id, ten, quyen };
  }

  /** Lead PAID_ADS, MỘT khoản thu 10tr, rồi ĐỔI NGUỒN sang PARENT_REFERRAL 1% (người đổi = `nguoiDoi`). */
  async function dungSuKien(ten: string) {
    const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS");
    const bc = await boiCanh(k, NOW);
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const nguoiDoi = await seedUser({ email: `${k.ma}-doi-nguon@ci.test`, role: "SALES_CSM", name: `${k.ma}-doi-nguon`, phone: null });
    const doiNguon = async (groupId: string, parentUserId: string | null) => {
      const kq = await doiNguonLead({
        actor: actorCoSo(nguoiDoi.id, k.centerId),
        actorName: "Người đổi",
        kiemQuyen: CO_SAU,
        leadId: k.lead!.id,
        groupId,
        thamChieu: { employeeId: null, parentUserId, studentId: null, affiliateId: null },
        giaiTrinh: null,
        lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
        bayGio: NOW,
      });
      expect(kq).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
      const evs = await db.domainEvent.findMany({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${k.lead!.id}:` } }, orderBy: { createdAt: "desc" } });
      return evs[0]!;
    };
    const ev = await doiNguon(nhom.PARENT_REFERRAL, ph.id);
    return { k, bc, goc, ev, nhom, ph, nguoiDoi: nguoiDoi.id, doiNguon };
  }
  const dxCua = (paymentId: string) => db.commissionAdjustmentRequest.findFirstOrThrow({ where: { paymentId, origin: "SOURCE_CHANGE" }, orderBy: { createdAt: "desc" } });
  const demDieuChinh = (paymentId: string) => db.commissionTransaction.count({ where: { entryKind: { in: ["INPUT_CORRECTION", "SOURCE_CORRECTION", "DISPUTE_ADJUSTMENT"] }, calcSlot: { paymentId } } });

  it("[SEG-01] người giữ CẢ HAI khoá mà chính là người ĐỔI NGUỒN: không duyệt cấp 1, không từ chối — kể cả đề xuất hai người; sổ không đổi; đối chứng: người khác duyệt được", async () => {
    // Cấy: bỏ `requestedById` khỏi `lyDoKhongDuocDuyet` ⇒ cả hai ca duyệt/từ chối lọt ⇒ đỏ.
    const tc = await nguoiHaiKhoa("seg01-tc");
    const { k, bc, goc, ev } = await dungSuKien("seg01");
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: tc.userId });
    const dx = await dxCua(goc);
    expect(dx).toMatchObject({ requestedById: tc.userId, governance: "SINGLE_APPROVAL", status: "PENDING" });
    await expect(duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: tc, lyDo: "Tự duyệt đề xuất do chính mình đổi nguồn" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
    await expect(tuChoiDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: tc, lyDo: "Tự từ chối đề xuất do chính mình đổi nguồn" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
    expect(await demDieuChinh(goc)).toBe(0);
    expect((await dxCua(goc)).status).toBe("PENDING");
    // đối chứng dương: người KHÁC cùng khoá duyệt được
    expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Người khác đối chiếu và đồng ý điều chỉnh" })).toMatchObject({ loai: "DA_GHI" });
  });

  it("[SEG-02] người giữ cả hai khoá làm cấp 1 ⇒ KHÔNG làm được cấp 2 (cũng không từ chối ở cấp 2); người thứ ba cấp 2 ghi sổ; DB có BA người khác nhau cho ba vai", async () => {
    // Cấy: bỏ nhánh `c.cap === 2 && c.nguoiDuyetId === c.approver1Id` ⇒ cùng người cấp 1 và cấp 2 ⇒ đỏ (DB khac_nguoi_chk là lưới dưới cùng).
    await db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: 50_000 }, create: { key: KHOA_NGUONG, valueJson: 50_000 } });
    try {
      const tc = await nguoiHaiKhoa("seg02-tc");
      const { k, bc, goc, ev, nguoiDoi } = await dungSuKien("seg02");
      await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
      const dx = await dxCua(goc);
      expect(dx).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", status: "PENDING", requestedById: nguoiDoi });
      expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: tc, lyDo: "Cấp 1 đã đối chiếu nguồn mới" })).toMatchObject({ loai: "DA_DUYET_CAP_1" });
      await expect(duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: tc, lyDo: "Cấp 1 tự duyệt cấp 2 của chính mình" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
      await expect(tuChoiDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: tc, lyDo: "Cấp 1 tự từ chối ở cấp 2 của chính mình" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
      expect(await demDieuChinh(goc)).toBe(0);
      expect((await dxCua(goc)).status).toBe("APPROVED_L1");
      expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Cấp 2 đồng ý ghi điều chỉnh vào sổ" })).toMatchObject({ loai: "DA_GHI", cap: 2 });
      const xong = await dxCua(goc);
      expect(xong).toMatchObject({ status: "POSTED", requestedById: nguoiDoi, approver1Id: tc.userId, approver2Id: NGUOI.userId });
      expect(new Set([xong.requestedById, xong.approver1Id, xong.approver2Id]).size).toBe(3);
    } finally {
      await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
    }
  });

  it("[SEG-03] qua LỚP ĐIỀU PHỐI của Server Action: người giữ cả hai khoá bị chặn ở mọi vai trùng (đề xuất · cấp 1 · cấp 2 · từ chối), sổ không đổi; người thứ ba duyệt được", async () => {
    // Cấy: bỏ cổng `lyDoKhongDuocDuyet` khỏi `docDeXuLy` ở service duyệt ⇒ lớp điều phối trả ok:true ⇒ đỏ.
    await db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: 50_000 }, create: { key: KHOA_NGUONG, valueJson: 50_000 } });
    try {
      const tc = await nguoiHaiKhoa("seg03-tc");
      const nguoiTc = { id: tc.userId, ten: tc.ten };
      const { k, bc, goc, ev } = await dungSuKien("seg03");
      bcHienTai.v = bc;
      // (1) tc LÀ NGƯỜI ĐỔI NGUỒN (người đề xuất): không duyệt, không từ chối
      await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: tc.userId });
      const dx = await dxCua(goc);
      expect(dx).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", status: "PENDING", requestedById: tc.userId });
      for (const tuChoi of [false, true]) {
        const r = await hanhDongDuyetDeXuat({ actor: tc.quyen, nguoi: nguoiTc, requestId: dx.id, nguonGoc: "SOURCE_CHANGE", lyDo: "Người đổi nguồn tự xử lý đề xuất của mình", tuChoi, now: NOW });
        expect(r.ok, `tuChoi=${tuChoi}`).toBe(false);
        expect(r.ok ? "" : r.chung, `tuChoi=${tuChoi}`).toMatch(/người đề xuất/);
      }
      expect(await demDieuChinh(goc)).toBe(0);
      expect((await dxCua(goc)).status).toBe("PENDING");
      // (2) đề xuất khác: tc làm cấp 1 được, rồi KHÔNG làm cấp 2 / không từ chối ở cấp 2 qua cùng lớp điều phối
      const sk2 = await dungSuKien("seg03b");
      bcHienTai.v = sk2.bc;
      await apDungDoiNguonSauThu(db, sk2.bc, { leadId: sk2.k.lead!.id, refEventId: sk2.ev.id, requestedById: sk2.nguoiDoi });
      const dx2 = await dxCua(sk2.goc);
      const l1 = await hanhDongDuyetDeXuat({ actor: tc.quyen, nguoi: nguoiTc, requestId: dx2.id, nguonGoc: "SOURCE_CHANGE", lyDo: "Cấp 1 đã đối chiếu nguồn mới", tuChoi: false, now: NOW });
      expect(l1).toMatchObject({ ok: true, ketQua: { loai: "DA_DUYET_CAP_1" } });
      for (const tuChoi of [false, true]) {
        const r = await hanhDongDuyetDeXuat({ actor: tc.quyen, nguoi: nguoiTc, requestId: dx2.id, nguonGoc: "SOURCE_CHANGE", lyDo: "Cấp 1 tự xử lý tiếp cấp 2 của mình", tuChoi, now: NOW });
        expect(r.ok, `cấp 2 tuChoi=${tuChoi}`).toBe(false);
        expect(r.ok ? "" : r.chung, `cấp 2 tuChoi=${tuChoi}`).toMatch(/cấp 1/);
      }
      expect(await demDieuChinh(sk2.goc)).toBe(0);
      // đối chứng dương: người thứ ba cấp 2 ⇒ ghi sổ
      const l2 = await hanhDongDuyetDeXuat({ actor: NGUOI.quyen, nguoi: { id: NGUOI.userId, ten: NGUOI.ten }, requestId: dx2.id, nguonGoc: "SOURCE_CHANGE", lyDo: "Cấp 2 đồng ý ghi điều chỉnh vào sổ", tuChoi: false, now: NOW });
      expect(l2).toMatchObject({ ok: true, ketQua: { loai: "DA_GHI", cap: 2 } });
      expect(await demDieuChinh(sk2.goc)).toBe(1);
    } finally {
      await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
    }
  });

  it("[CRN-01] cron quét kỳ + đối soát nền chạy khi sự kiện đổi nguồn CHƯA xử lý rồi khi đề xuất đang PENDING: 0 dòng điều chỉnh mới, 0 đề xuất mới, đề xuất vẫn PENDING", async () => {
    // Cấy: cho `quetKy` truyền `cheDo: DOI_NGUON_CO_QUYEN` (hoặc DE_XUAT…) ⇒ đỏ.
    const { k, bc, goc, ev, nguoiDoi } = await dungSuKien("crn01");
    const chayCron = async () => {
      await quetKy(db, bc, { thang: "2026-10", centerId: k.centerId, soThangDoiSoat: 3 });
      await doiSoatNen(db, bc, { soThang: 3, gioiHan: 1000 });
    };
    // (1) sự kiện chưa được xử lý ⇒ cron chỉ DỰNG hàng chờ INPUT_DRIFT, không ghi gì
    await chayCron();
    expect(await demDieuChinh(goc)).toBe(0);
    expect(await db.commissionAdjustmentRequest.count({ where: { paymentId: goc } })).toBe(0);
    // (2) consumer lập đề xuất ⇒ cron lại chạy: không ghi, không lập thêm, không đóng đề xuất
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
    const dx = await dxCua(goc);
    await chayCron();
    await chayCron();
    expect(await demDieuChinh(goc)).toBe(0);
    expect(await db.commissionAdjustmentRequest.count({ where: { paymentId: goc } })).toBe(1);
    expect((await dxCua(goc))).toMatchObject({ id: dx.id, status: "PENDING" });
    // đối chứng dương: cũng chính các dòng sổ ĐÃ CÓ của khoản (ORIGINAL) vẫn nguyên — cron không xoá, không sửa
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: goc }, entryKind: "ORIGINAL" } })).toBeGreaterThan(0);
  });

  /** Chênh lệch KHÔNG do sự kiện đổi nguồn: người giới thiệu (attribution) đổi sang người khác thẳng ở DB ⇒ INPUT_DRIFT thường có phần "do nguồn" (vai acquisition). */
  async function troiNguoiGioiThieu(k: KichBan, bc: Awaited<ReturnType<typeof boiCanh>>, goc: string, ten: string) {
    const ph2 = await seedUser({ email: `${k.ma}-${ten}@ci.test`, role: "PARENT", name: `${k.ma}-${ten}`, phone: null });
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { referrerParentUserId: ph2.id } });
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "TROI" });
    return db.commissionHold.findFirstOrThrow({ where: { paymentId: goc, code: "INPUT_DRIFT", status: "OPEN" } });
  }

  it("[FEV-01] sự kiện đổi nguồn FAILED + đề xuất POSTED lập sau đó bằng đường backfill (audit:…) ⇒ 'Áp dụng' chênh lệch về sau KHÔNG còn bị khoá vĩnh viễn; trước khi có đề xuất POSTED thì VẪN bị chặn", async () => {
    // Cấy: bỏ nhánh `e.status === "FAILED" && … POSTED …` ở `suKienDoiNguonChuaXong` ⇒ 'Áp dụng' sau backfill vẫn bị chặn ⇒ đỏ.
    const { k, bc, goc, ev, nguoiDoi } = await dungSuKien("fev01");
    await db.domainEvent.update({ where: { id: ev.id }, data: { status: "FAILED", lastError: "handler hết lượt retry (ca test)" } });
    // chưa có đề xuất POSTED nào: sự kiện FAILED vẫn chặn (không mở cửa cho 'Áp dụng' khi tiền đổi nguồn CHƯA qua duyệt)
    const hang0 = await troiNguoiGioiThieu(k, bc, goc, "ph2");
    await expect(giaiHangCho(db, bc, { holdId: hang0.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng khi sự kiện FAILED mà chưa có đề xuất", nguoi: NGUOI })).rejects.toMatchObject({ ma: "HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET" });
    expect(await demDieuChinh(goc)).toBe(0);
    // đường backfill (script): đề xuất mang refEventId `audit:<id>` — KHÔNG khớp id của sự kiện — rồi duyệt ghi sổ
    expect((await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: "audit:fev01", requestedById: nguoiDoi })).theoKetQua).toEqual({ DE_XUAT: 1 });
    expect(await duyetDeXuat(db, bc, { requestId: (await dxCua(goc)).id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Duyệt đề xuất lập bằng backfill thay cho sự kiện FAILED" })).toMatchObject({ loai: "DA_GHI" });
    expect((await dxCua(goc)).refEventId).toBe("audit:fev01");
    // chênh lệch VỀ SAU (không do sự kiện nào): trước vá bị khoá vĩnh viễn, nay áp dụng được như thường
    const hang1 = await troiNguoiGioiThieu(k, bc, goc, "ph3");
    expect(await giaiHangCho(db, bc, { holdId: hang1.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng chênh lệch về sau, sự kiện FAILED đã giải bằng backfill", nguoi: NGUOI })).toMatchObject({ loai: "DA_AP_DUNG" });
  });

  it("[FEV-02] ĐỐI CHỨNG ÂM: đề xuất POSTED CŨ (của lần đổi nguồn trước) không mở khoá cho lần đổi nguồn MỚI bị FAILED — 'Áp dụng' vẫn bị từ chối, sổ không đổi", async () => {
    // Cấy: bỏ ràng buộc `createdAt >= e.createdAt` (mọi đề xuất POSTED đều giải sự kiện FAILED) ⇒ 'Áp dụng' lọt ⇒ đỏ.
    const { k, bc, goc, ev, nhom, doiNguon, nguoiDoi } = await dungSuKien("fev02");
    // lần 1: sự kiện được xử lý bình thường, đề xuất POSTED
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
    expect(await duyetDeXuat(db, bc, { requestId: (await dxCua(goc)).id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Duyệt đề xuất của lần đổi nguồn thứ nhất" })).toMatchObject({ loai: "DA_GHI" });
    await db.domainEvent.update({ where: { id: ev.id }, data: { status: "DONE", processedAt: new Date() } });
    // lần 2: người giới thiệu đổi sang phụ huynh khác — sự kiện MỚI, handler hỏng ⇒ FAILED, không ai lập đề xuất
    const ph2 = await seedUser({ email: `${k.ma}-ph2@ci.test`, role: "PARENT", name: `${k.ma}-ph2`, phone: null });
    const ev2 = await doiNguon(nhom.PARENT_REFERRAL, ph2.id);
    expect(ev2.id).not.toBe(ev.id);
    await db.domainEvent.update({ where: { id: ev2.id }, data: { status: "FAILED", lastError: "handler hết lượt retry (ca test)" } });
    expect(await quetKhoan(db, bc, goc)).toMatchObject({ loai: "TROI" });
    const hang = await db.commissionHold.findFirstOrThrow({ where: { paymentId: goc, code: "INPUT_DRIFT", status: "OPEN" } });
    const truoc = await demDieuChinh(goc);
    await expect(giaiHangCho(db, bc, { holdId: hang.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng khi lần đổi nguồn thứ hai FAILED", nguoi: NGUOI })).rejects.toMatchObject({ ma: "HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET" });
    expect(await demDieuChinh(goc)).toBe(truoc);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hang.id } })).status).toBe("OPEN");
  });
});
