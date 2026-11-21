// @vitest-environment node
/**
 * [SDN-01..SDN-07] — ĐỔI NGUỒN KHI KHOẢN THU ĐANG TẠM RỜI THỰC THU mà SỔ HOA HỒNG ĐÃ TỒN TẠI (rà độc lập 20/10/2026, góc «Tích hợp tài chính»). Postgres THẬT.
 *
 * Lỗ đo được: cổng «đã có thực thu» của đổi nguồn đếm `WHERE_THUC_THU` — khoản bị kế toán TỪ CHỐI (hàng chờ `PAYMENT_WITHDRAWN` mở, tiền hoa hồng vẫn nằm trong sổ) không còn được đếm ⇒ lead bị coi là
 * «chưa thu»: người chỉ có `leads:overwrite` (KHÔNG cần `sources:override-after-payment`) đổi được nguồn, KHÔNG có DomainEvent `nguon.da-doi-sau-thanh-toan`, KHÔNG có đề xuất. Kế toán xác nhận lại khoản ⇒
 * lượt quét sinh INPUT_DRIFT mang phần chênh do nguồn (A −, B +) và cổng «đổi nguồn chưa qua duyệt» của `giaiHangCho` không thấy gì để chặn ⇒ MỘT người giữ `commission_periods:manage` «Áp dụng» chuyển tiền
 * A → B: bỏ qua quyền riêng, ngưỡng hai cấp và tách nhiệm.
 *
 * Luật sau vá: «đã có đầu vào tài chính» = có thực thu HOẶC đã có sổ hoa hồng (ô tính / dòng sổ) của lead (`lib/nguon/dau-vao-tai-chinh.ts`) — MỘT chỗ hỏi, năm nơi dùng (cổng quyền, nút, thẻ ghi, sự kiện,
 * gộp lead, ghi nguồn Affiliate). Đổi nguồn thuộc loại này đi đường «sau thu»; consumer KHÔNG được báo DONE khi còn khoản tạm rút mà nó không đánh giá được (ném ⇒ dispatcher thử lại / FAILED ⇒ cổng «Áp dụng» giữ).
 *
 * LUẬT 18: mỗi ca tự dựng hiện trường, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối. Chạy: `pnpm test:hoa-hong-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import type { Actor } from "../../lib/auth/actor";
import { onNguonDaDoiSauThanhToan } from "../../lib/hoa-hong/_handlers/doi-nguon-sau-thu";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { gopLead } from "../../lib/lead/gop-lead";
import { docChoGanNguon } from "../../lib/nguon/doc-gan-nguon";
import { ghiNguonKhiDuyetReferral } from "../../lib/nguon/ghi-nguon-affiliate-duyet";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { capKhoaGhiNguon, damBaoDanhMucGoc, theGhiChoTest } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, ganNguon, huyChinhSach, nguoiKyHo, themChinhSachNhom, tienVe, tuChoi, type KichBan } from "./_kich-ban";
import { dungChuoi, SN } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[SDN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const SU_KIEN = "nguon.da-doi-sau-thanh-toan";
const CO_TRUOC: KiemQuyen = async (action) => action === "leads:overwrite";
const CO_SAU: KiemQuyen = async (action) => action === "sources:override-after-payment";
const actorCoSo = (userId: string, centerId: string) =>
  capKhoaGhiNguon(({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor);

describe.skipIf(!RUN_DB_TESTS)("[SDN] đổi nguồn khi khoản thu tạm rời thực thu mà sổ hoa hồng đã tồn tại", () => {
  const cuaToi: KichBan[] = [];
  let NGUOI: Awaited<ReturnType<typeof nguoiKyHo>>;

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

  /** Lead PAID_ADS (+ chính sách PARENT_REFERRAL REFERRER_PARENT 1%); `soKhoan` khoản thu 10tr đã quét (Sale 4% ⇒ 400.000). */
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
  type X = Awaited<ReturnType<typeof dung>>;

  /** Kế toán TỪ CHỐI khoản đã có hoa hồng ⇒ lượt quét dựng hàng chờ PAYMENT_WITHDRAWN (tiền vẫn nằm trong sổ). */
  async function tuChoiKhoan(x: X) {
    await tuChoi(x.k, x.goc);
    expect(await quetKhoan(db, x.bc, x.goc)).toMatchObject({ loai: "RUT_TIEN" });
    expect(await db.payment.count({ where: { id: x.goc, accountantStatus: "CONFIRMED", deletedAt: null } }), "đối chứng: khoản KHÔNG còn thuộc thực thu").toBe(0);
    expect(await db.commissionTransaction.count({ where: { paymentId: x.goc } }), "đối chứng: sổ hoa hồng VẪN còn dòng của khoản").toBeGreaterThan(0);
  }
  const doiSangPhGioiThieu = (x: X, nguoiDoi: string, kiemQuyen: KiemQuyen) =>
    doiNguonLead({
      actor: actorCoSo(nguoiDoi, x.k.centerId),
      actorName: "Người đổi",
      kiemQuyen,
      leadId: x.k.lead!.id,
      groupId: x.nhom.PARENT_REFERRAL,
      thamChieu: { employeeId: null, parentUserId: x.ph.id, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
      bayGio: NOW,
    });
  const nhomHienTai = async (x: X) => (await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.k.lead!.id }, select: { groupId: true } })).groupId;
  const suKienCua = (x: X) => db.domainEvent.findMany({ where: { type: SU_KIEN, payloadJson: { path: ["leadId"], equals: x.k.lead!.id } }, orderBy: { createdAt: "asc" } });

  it("[SDN-01] khoản bị TỪ CHỐI nhưng sổ còn tiền: người chỉ có `leads:overwrite` KHÔNG đổi được nguồn (cần quyền đổi-sau-thu), nguồn nguyên, 0 sự kiện; đối chứng dương: người có `sources:override-after-payment` đổi được qua đường SAU THU + MỘT sự kiện", async () => {
    const x = await dung("sdn01");
    await tuChoiKhoan(x);
    const truoc = await nhomHienTai(x);
    const nguoiThuong = await seedUser({ email: `${x.k.ma}-doi-thuong@ci.test`, role: "SALES_CSM", name: "doi-thuong", phone: null });
    const bi = await doiSangPhGioiThieu(x, nguoiThuong.id, CO_TRUOC);
    expect(bi).toMatchObject({ ok: false, truong: "quyen" });
    expect(await nhomHienTai(x), "nguồn KHÔNG đổi").toBe(truoc);
    expect(await suKienCua(x)).toHaveLength(0);

    const nguoiSau = await seedUser({ email: `${x.k.ma}-doi-sau@ci.test`, role: "ACCOUNTANT", name: "doi-sau", phone: null });
    const ok = await doiSangPhGioiThieu(x, nguoiSau.id, CO_SAU);
    expect(ok).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU", canDieuChinh: true });
    expect(await nhomHienTai(x)).toBe(x.nhom.PARENT_REFERRAL);
    const evs = await suKienCua(x);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payloadJson).toMatchObject({ leadId: x.k.lead!.id, tuNhom: "PAID_ADS", denNhom: "PARENT_REFERRAL", actorId: nguoiSau.id, canDieuChinh: true });
  });

  it("[SDN-02] ĐỐI CHỨNG DƯƠNG: lead CHƯA có thu và CHƯA có sổ ⇒ người chỉ có `leads:overwrite` đổi TRỰC TIẾP như cũ (không sự kiện, không cần quyền sau thu)", async () => {
    const x = await dung("sdn02", 0);
    const nguoiThuong = await seedUser({ email: `${x.k.ma}-doi-thuong@ci.test`, role: "SALES_CSM", name: "doi-thuong", phone: null });
    expect(await doiSangPhGioiThieu(x, nguoiThuong.id, CO_TRUOC)).toMatchObject({ ok: true, action: "DOI_NGUON", canDieuChinh: false });
    expect(await nhomHienTai(x)).toBe(x.nhom.PARENT_REFERRAL);
    expect(await suKienCua(x)).toHaveLength(0);
  });

  it("[SDN-03] ĐỐI CHỨNG DƯƠNG 2: khoản bị từ chối TRƯỚC KHI có sổ (chưa từng được quét) ⇒ chưa có đầu vào tài chính ⇒ đổi trực tiếp như cũ", async () => {
    const k = await dungKichBan("sdn03", { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS", { attributedAt: D("2026-10-01") });
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12"), xacNhan: false }); // ghi nhận, CHƯA xác nhận ⇒ không thực thu, không sổ
    expect(await db.commissionCalcSlot.count({ where: { payment: { order: { leadId: k.lead!.id } } } })).toBe(0);
    const x = { k, ph, nhom } as unknown as X;
    const nguoiThuong = await seedUser({ email: `${k.ma}-doi-thuong@ci.test`, role: "SALES_CSM", name: "doi-thuong", phone: null });
    expect(await doiSangPhGioiThieu(x, nguoiThuong.id, CO_TRUOC)).toMatchObject({ ok: true, action: "DOI_NGUON" });
    expect(await suKienCua(x)).toHaveLength(0);
  });

  it("[SDN-04] NÚT nói đúng điều cổng sẽ làm (luật 12): khoản tạm rời thực thu mà sổ còn ⇒ `docChoGanNguon` báo CẦN quyền đổi-sau-thu cho người chỉ có `leads:overwrite`; lead chưa có sổ ⇒ cho đổi", async () => {
    const x = await dung("sdn04");
    const y = await dung("sdn04b", 0);
    await tuChoiKhoan(x);
    const nguoi = await seedUser({ email: `${x.k.ma}-xem@ci.test`, role: "SALES_CSM", name: "xem", phone: null });
    const cho = async (z: X) =>
      docChoGanNguon({ actor: actorCoSo(nguoi.id, z.k.centerId), leadId: z.k.lead!.id, kiemQuyen: CO_TRUOC, canViewPii: false, cuaSoNgay: 30, now: NOW });
    expect((await cho(x))?.quyen).toMatchObject({ ok: false });
    expect((await cho(y))?.quyen).toMatchObject({ ok: true });
  });

  it("[SDN-05] ĐẦU-CUỐI: đổi nguồn lúc khoản đang tạm rút → consumer KHÔNG báo DONE (ném) → khoản được xác nhận lại → «Áp dụng» INPUT_DRIFT bị CHẶN (đổi nguồn chưa qua duyệt), 0 dòng; consumer chạy lại khi khoản đã thực thu ⇒ LẬP đề xuất", async () => {
    const x = await dung("sdn05");
    const batEngine = (v: boolean) => db.systemSetting.upsert({ where: { key: "hoaHong.engineBat" }, update: { valueJson: v }, create: { key: "hoaHong.engineBat", valueJson: v } });
    // consumer dựng bối cảnh bằng `dungBoiCanhQuet` (mọi chính sách ACTIVE) ⇒ huỷ chính sách của kịch bản khác để không chồng lấn (khuôn [NHH-COM-18c]).
    for (const o of cuaToi) if (o !== x.k) await huyChinhSach([o.chinhSach.policyCode, ...o.chinhSachThem]);
    await tuChoiKhoan(x);
    const nguoiSau = await seedUser({ email: `${x.k.ma}-doi-sau@ci.test`, role: "ACCOUNTANT", name: "doi-sau", phone: null });
    expect(await doiSangPhGioiThieu(x, nguoiSau.id, CO_SAU)).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const [ev] = await suKienCua(x);
    expect(ev, "phải có sự kiện đổi nguồn sau thu").toBeDefined();
    const payload = ev!.payloadJson as Record<string, unknown>;
    try {
      await batEngine(true);
      // (1) khoản còn tạm rút, sổ còn tiền ⇒ consumer không đánh giá được ⇒ ném (dispatcher thử lại), KHÔNG lập đề xuất, KHÔNG báo xong.
      await expect(onNguonDaDoiSauThanhToan({ id: ev!.id, type: ev!.type, payload })).rejects.toMatchObject({ ma: "DOI_NGUON_KHOAN_TAM_RUT" });
      expect(await db.commissionAdjustmentRequest.count({ where: { paymentId: x.goc, origin: "SOURCE_CHANGE" } })).toBe(0);
      expect((await db.domainEvent.findUniqueOrThrow({ where: { id: ev!.id } })).status, "không ai đánh dấu DONE").not.toBe("DONE");

      // (2) khoản được xác nhận lại ⇒ lượt quét sinh INPUT_DRIFT (có phần do nguồn) ⇒ MỘT người «Áp dụng» PHẢI bị chặn vì đổi nguồn chưa qua duyệt.
      await db.payment.update({ where: { id: x.goc }, data: { accountantStatus: "CONFIRMED" } });
      await quetKhoan(db, x.bc, x.goc);
      const drift = await db.commissionHold.findFirstOrThrow({ where: { code: "INPUT_DRIFT", paymentId: x.goc, status: "OPEN" } });
      const dongTruoc = await db.commissionTransaction.count({ where: { paymentId: x.goc } });
      await expect(giaiHangCho(db, x.bc, { holdId: drift.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng chênh lệch sau khi xác nhận lại khoản", nguoi: NGUOI })).rejects.toMatchObject({ ma: "HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET" });
      expect(await db.commissionTransaction.count({ where: { paymentId: x.goc } }), "0 dòng sổ mới").toBe(dongTruoc);

      // (3) đối chứng dương: dispatcher thử lại khi khoản ĐÃ thực thu ⇒ consumer đánh giá được ⇒ LẬP đề xuất chờ duyệt (đường duyệt có tách nhiệm).
      await onNguonDaDoiSauThanhToan({ id: ev!.id, type: ev!.type, payload });
      expect(await db.commissionAdjustmentRequest.count({ where: { paymentId: x.goc, origin: "SOURCE_CHANGE", status: "PENDING" } })).toBe(1);
    } finally {
      await db.systemSetting.deleteMany({ where: { key: "hoaHong.engineBat" } });
    }
  });

  it("[SDN-06] GỘP LEAD: lead chính chỉ còn SỔ (khoản tạm rút) mà lượt gộp đổi nguồn của nó ⇒ VẪN phát sự kiện đổi-nguồn-sau-thu (cùng cổng với đổi thường)", async () => {
    const x = await dung("sdn06");
    await tuChoiKhoan(x);
    const phu = await db.lead.create({ data: { parentName: `${x.k.ma}-phu`, phone: x.k.lead!.phone, status: "DA_DANG_KY", convertedById: x.k.sale.id, adminId: x.k.saleAdmin.id, centerId: x.k.centerId } });
    await ganNguon({ ...x.k, lead: phu }, "PARENT_REFERRAL", { phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    const nguoiGop = await seedUser({ email: `${x.k.ma}-gop@ci.test`, role: "ACCOUNTANT", name: "gop", phone: null });
    const kq = await gopLead(db, { phuId: phu.id, chinhId: x.k.lead!.id, apply: true, actorName: "Hệ thống (gộp lead)", actorUserId: nguoiGop.id });
    expect(kq.nguon.cach).toBe("PHU_THANG");
    const evs = await suKienCua(x);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payloadJson).toMatchObject({ nguon: "GOP_LEAD", actorId: nguoiGop.id, tuNhom: "PAID_ADS", denNhom: "PARENT_REFERRAL" });
  });

  it("[SDN-07] ĐỐI CHỨNG DƯƠNG của gộp: lead chính CHƯA có thu và CHƯA có sổ ⇒ gộp đổi nguồn KHÔNG phát sự kiện (như cũ)", async () => {
    const x = await dung("sdn07", 0);
    const phu = await db.lead.create({ data: { parentName: `${x.k.ma}-phu`, phone: x.k.lead!.phone, status: "DA_DANG_KY", convertedById: x.k.sale.id, adminId: x.k.saleAdmin.id, centerId: x.k.centerId } });
    await ganNguon({ ...x.k, lead: phu }, "PARENT_REFERRAL", { phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    const nguoiGop = await seedUser({ email: `${x.k.ma}-gop@ci.test`, role: "ACCOUNTANT", name: "gop", phone: null });
    const kq = await gopLead(db, { phuId: phu.id, chinhId: x.k.lead!.id, apply: true, actorName: "Hệ thống (gộp lead)", actorUserId: nguoiGop.id });
    expect(kq.nguon.cach).toBe("PHU_THANG");
    expect(await suKienCua(x)).toHaveLength(0);
  });

  it("[SDN-08] GHI NGUỒN AFFILIATE khi duyệt referral: lead còn ở nhóm «chờ» và CHỈ còn sổ (khoản tạm rút) ⇒ TỪ CHỐI NHOM_CHO_DA_CO_THU, nguồn nguyên; đối chứng dương: lead chưa có thu / chưa có sổ ⇒ ghi được (DE_NHOM_CHO)", async () => {
    const ghi = (x: { k: KichBan }, ch: Awaited<ReturnType<typeof dungChuoi>>) =>
      db.$transaction((tx) =>
        ghiNguonKhiDuyetReferral(tx, {
          leadId: x.k.lead!.id,
          the: theGhiChoTest(x.k.lead!.id, x.k.centerId),
          partyId: ch.doiTac.id,
          campaignCode: ch.campaign.code,
          groupId: ch.nhomId,
          snapshot: { ...SN, affiliateCode: ch.doiTac.code, campaignCode: ch.campaign.code },
          referralId: `ref-${ch.h}`,
          lyDo: "Duyệt tay referral — đối chiếu với đối tác",
          actor: { id: null, name: "Người duyệt" },
          bayGio: NOW,
        }),
      );
    const veNhomCho = (leadId: string) => db.$executeRaw`UPDATE "LeadAttribution" SET "groupId" = (SELECT "id" FROM "LeadSourceGroup" WHERE "code" = 'UNKNOWN') WHERE "leadId" = ${leadId}`;
    // (a) chỉ còn SỔ: khoản bị từ chối sau khi đã có hoa hồng.
    const x = await dung("sdn08a");
    await veNhomCho(x.k.lead!.id);
    await tuChoiKhoan(x);
    const chA = await dungChuoi();
    expect(await ghi(x, chA)).toMatchObject({ ok: false, ma: "NHOM_CHO_DA_CO_THU" });
    expect(await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.k.lead!.id }, select: { referrerKind: true } })).toMatchObject({ referrerKind: null });
    // (b) đối chứng dương: chưa có thu, chưa có sổ ⇒ qua cổng và ghi được.
    const y = await dung("sdn08b", 0);
    await veNhomCho(y.k.lead!.id);
    const chB = await dungChuoi();
    expect(await ghi(y, chB)).toMatchObject({ ok: true, nhanh: "DE_NHOM_CHO" });
    expect(await db.leadAttribution.findUniqueOrThrow({ where: { leadId: y.k.lead!.id }, select: { referrerKind: true } })).toMatchObject({ referrerKind: "AFFILIATE" });
  });

  it("[SDN-09] GỘP LEAD: lead PHỤ chỉ còn SỔ (khoản tạm rút), chính giữ nguồn ⇒ VẪN phát sự kiện (phụ mang theo tiền sang lead chính); đối chứng dương: phụ chưa có thu / chưa có sổ ⇒ không phát", async () => {
    const gopVoiChinhGiuNguon = async (x: X) => {
      // lead CHÍNH: cùng SĐT, PARENT_REFERRAL từ SỚM hơn ⇒ thắng first-claim, giữ nguồn của mình.
      const chinh = await db.lead.create({ data: { parentName: `${x.k.ma}-chinh`, phone: x.k.lead!.phone, status: "DA_DANG_KY", convertedById: x.k.sale.id, adminId: x.k.saleAdmin.id, centerId: x.k.centerId } });
      await ganNguon({ ...x.k, lead: chinh }, "PARENT_REFERRAL", { phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
      const nguoiGop = await seedUser({ email: `${x.k.ma}-gop@ci.test`, role: "ACCOUNTANT", name: "gop", phone: null });
      const kq = await gopLead(db, { phuId: x.k.lead!.id, chinhId: chinh.id, apply: true, actorName: "Hệ thống (gộp lead)", actorUserId: nguoiGop.id });
      const evs = await db.domainEvent.findMany({ where: { type: SU_KIEN, payloadJson: { path: ["leadId"], equals: chinh.id } } });
      return { kq, evs, nguoiGop };
    };
    const x = await dung("sdn09a");
    await tuChoiKhoan(x);
    const a = await gopVoiChinhGiuNguon(x);
    expect(a.kq.nguon.cach, "đối chứng: chính GIỮ nguồn — chỉ vế «phụ mang tiền» mới đủ để phát").not.toBe("PHU_THANG");
    expect(a.evs).toHaveLength(1);
    expect(a.evs[0]!.payloadJson).toMatchObject({ nguon: "GOP_LEAD", actorId: a.nguoiGop.id });
    const y = await dung("sdn09b", 0);
    const b = await gopVoiChinhGiuNguon(y);
    expect(b.evs).toHaveLength(0);
  });

  it("[SDN-10] NGƯỜI KHÔNG GIỮ KHOÁ NGUỒN NÀO: lead chỉ còn SỔ ⇒ lời từ chối nói đúng nguyên nhân (hoa hồng tính trên khoản tạm rút), lead chưa có sổ ⇒ câu chung cũ; cả hai đều KHÔNG đổi nguồn", async () => {
    const KHONG_QUYEN: KiemQuyen = async () => false;
    const x = await dung("sdn10a");
    await tuChoiKhoan(x);
    const y = await dung("sdn10b", 0);
    const nguoi = await seedUser({ email: `${x.k.ma}-khong-quyen@ci.test`, role: "SALES_CSM", name: "khong-quyen", phone: null });
    const a = await doiSangPhGioiThieu(x, nguoi.id, KHONG_QUYEN);
    expect(a).toMatchObject({ ok: false, truong: "quyen" });
    if (!a.ok) expect(a.loi).toContain("hoa hồng");
    const b = await doiSangPhGioiThieu(y, nguoi.id, KHONG_QUYEN);
    expect(b).toMatchObject({ ok: false, truong: "quyen" });
    if (!b.ok) expect(b.loi).not.toContain("hoa hồng");
    expect(await nhomHienTai(x)).not.toBe(x.nhom.PARENT_REFERRAL);
    expect(await nhomHienTai(y)).not.toBe(y.nhom.PARENT_REFERRAL);
  });
});
