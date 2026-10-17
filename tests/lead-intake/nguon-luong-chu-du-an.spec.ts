// @vitest-environment node
/**
 * PR2 — BỐN LUỒNG NGHIỆP VỤ CỦA CHỦ DỰ ÁN, dưới dạng ca tích hợp ở TẦNG ATTRIBUTION (Postgres LOCAL thật).
 *
 *   [FLOW-B]  Phụ huynh HIỆN HỮU gửi phiếu cho con THỨ HAI ⇒ không đẻ lead mới; nguồn của khách hiện hữu GIỮ NGUYÊN;
 *             chỉ ghi touchpoint THEM_CON. (Phân loại NEW/RENEWAL khi tính tiền là việc của engine — 04, ngoài PR2.)
 *   [FLOW-C]  Cộng tác viên TRONG 90 ngày ⇒ còn hiệu lực ghi công (ngày thứ 90 gồm).
 *   [FLOW-D]  Cộng tác viên QUÁ 90 ngày ⇒ GIỮ nguồn (không đổi UNKNOWN, báo cáo nguồn không đổi) nhưng KHÔNG eligible.
 *   [FLOW-F]  Lead Facebook cũ, nhân viên giới thiệu ĐẾN SAU ⇒ nguồn gốc giữ nguyên; người giới thiệu chỉ vào được qua
 *             đổi nguồn có kiểm soát (lý do + quyền + audit) — không tự chiếm.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NFLOW_`. Ngày TUYỆT ĐỐI (luật 19). Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { ingestIntakeLead } from "../../lib/lead/intake/ingest";
import { ingestLead } from "../../lib/lead/ingest";
import type { MappedLead } from "../../lib/lead/intake/types";
import { KHONG_CO_TIN_HIEU_NGUON, type TinHieuNguonDauVao } from "../../lib/nguon/tin-hieu";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { conTrongCuaSoGhiCong } from "../../lib/nguon/cua-so-ghi-cong";
import { layCuaSoGhiCongNgay } from "../../lib/nguon/feature";
import { doiNguonLead } from "../../lib/nguon/doi-nguon-lead";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon, duLieuNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NFLOW_";
const CASE = 60_000;
const PHONE = { b: "0906000001", bMat: "0906000002", c: "0906000003", d: "0906000004", f: "0906000005" } as const;
const NGAY = 86_400_000;

const tinHieu = (over: Partial<TinHieuNguonDauVao> = {}): TinHieuNguonDauVao => ({ ...KHONG_CO_TIN_HIEU_NGUON, ...over });
const phieu = (over: Partial<MappedLead> = {}): MappedLead => ({
  parentName: `${P}PH`,
  phone: PHONE.b,
  email: null,
  centerHint: null,
  children: [],
  employeeCode: null,
  noteLines: [],
  externalId: null,
  consentMarketing: false,
  warnings: [],
  ...over,
});

function actorCoSo(userId: string, centerIds: string[]): Actor {
  return {
    userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [],
    visibleCenterIds: centerIds, visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as Actor;
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NFLOW" } } });
  await db.center.deleteMany({ where: { code: { startsWith: "NFLOW" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

describe.skipIf(!RUN)("PR2 — bốn luồng nghiệp vụ ở tầng attribution", () => {
  let nhom: IdNhom;
  let coSo = "";

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    coSo = (await db.center.create({ data: { code: "NFLOW1", name: "NFLOW 1", slug: "nflow-1", address: "a", city: "" } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 120_000);

  const doc = (id: string) =>
    db.lead.findUniqueOrThrow({
      where: { id },
      select: {
        attribution: { include: { group: { select: { code: true } }, originalGroup: { select: { code: true } } } },
        touchpoints: { orderBy: { occurredAt: "asc" } },
        children: { select: { fullName: true } },
      },
    });

  it("[FLOW-B] phụ huynh HIỆN HỮU gửi phiếu cho con THỨ HAI ⇒ không lead mới, nguồn khách hiện hữu GIỮ NGUYÊN, +1 touchpoint THEM_CON", async () => {
    const goc = await ingestLead({
      parentName: `${P}PH`,
      phone: PHONE.b,
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao, campaignId: "CP-KHACH-HIEN-HUU" } }),
    });
    await db.leadChild.create({ data: { leadId: goc.leadId!, fullName: "Bé An" } });
    await db.lead.update({ where: { id: goc.leadId! }, data: { status: "DA_DANG_KY" } });
    const truoc = await doc(goc.leadId!);

    const con2 = await ingestIntakeLead(
      phieu({ phone: PHONE.b, children: [{ fullName: "Bé Bình", gradeLevel: "Lớp 2" }] }),
      { source: "sale-form-app", centerId: coSo, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON },
    );
    expect(con2.ok).toBe(true);
    expect(con2.duplicate).toBe(true);
    expect(con2.childAdded).toBe(true);
    expect(con2.leadId).toBe(goc.leadId);
    expect(await db.lead.count({ where: { phone: { in: [PHONE.b, `84${PHONE.b.slice(1)}`] }, deletedAt: null } })).toBe(1);

    const sau = await doc(goc.leadId!);
    expect(sau.children.map((c) => c.fullName).sort()).toEqual(["Bé An", "Bé Bình"]);
    expect(sau.attribution!.group.code).toBe("PAID_ADS"); // nguồn của khách hiện hữu
    expect(sau.attribution!.groupId).toBe(truoc.attribution!.groupId);
    expect(sau.attribution!.matchedRule).toBe(truoc.attribution!.matchedRule);
    expect(sau.attribution!.attributedAt).toEqual(truoc.attribution!.attributedAt);
    expect(sau.touchpoints.map((t) => t.kind)).toEqual(["THEM_CON"]);
    // Đối chứng dương: phiếu LẠI KHÔNG có con mới ⇒ NHAP_LAI, không phải THEM_CON.
    await ingestIntakeLead(phieu({ phone: PHONE.b, children: [{ fullName: "Bé Bình" }] }), {
      source: "sale-form-app",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    expect((await doc(goc.leadId!)).touchpoints.map((t) => t.kind)).toEqual(["THEM_CON", "NHAP_LAI"]);
  }, CASE);

  it("[FLOW-B2] đối chứng: hồ sơ khách hiện hữu ĐÃ MẤT ⇒ lead MỚI cho con thứ hai, kế thừa nguồn của khách hiện hữu", async () => {
    const goc = await ingestLead({ parentName: `${P}PH`, phone: PHONE.bMat, source: "facebook", centerId: coSo, tinHieuNguon: tinHieu({ quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao, adId: "AD-HIEN-HUU" } }) });
    await db.lead.update({ where: { id: goc.leadId! }, data: { status: "DA_MAT" } });
    const moi = await ingestIntakeLead(phieu({ phone: PHONE.bMat, children: [{ fullName: "Bé Con Hai" }] }), {
      source: "sale-form-app",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    expect(moi.duplicate).toBe(false);
    expect(moi.leadId).not.toBe(goc.leadId);
    const a = (await doc(moi.leadId!)).attribution!;
    expect(a.inheritedFromLeadId).toBe(goc.leadId);
    expect(a.group.code).toBe("PAID_ADS");
    expect(a.matchedRule).toBe("KE_THUA_SDT");
  }, CASE);

  /** Một lead có attribution CTV (AFFILIATE) với mốc ghi nhận TUYỆT ĐỐI — luật 19, không đọc đồng hồ. */
  async function dungLeadCtv(phone: string, attributedAt: Date) {
    const aff = await db.affiliate.create({ data: { code: `NFLOW${phone.slice(-4)}`, name: `${P}ctv`, isActive: true }, select: { id: true } });
    const l = await db.lead.create({ data: { parentName: `${P}CTV`, phone, status: "MOI", centerId: coSo }, select: { id: true } });
    await db.$transaction(async (tx) => {
      await taoNguonBanDau(
        tx,
        l.id,
        duLieuNguon(nhom.PARTNER, {
          referrerKind: "AFFILIATE",
          referrerAffiliateId: aff.id,
          identificationMethod: "AFFILIATE",
          matchedRule: "MA_CTV",
          attributedAt,
        }),
        null,
      );
    });
    return l.id;
  }

  it("[FLOW-C] CTV TRONG 90 ngày: còn hiệu lực ghi công đến hết ngày thứ 90 (theo giờ VN), cửa sổ lấy từ cài đặt (mặc định 90)", async () => {
    const A = new Date("2026-07-01T03:00:00.000Z"); // 10:00 VN
    const lead = await dungLeadCtv(PHONE.c, A);
    const a = (await doc(lead)).attribution!;
    const ngay = await layCuaSoGhiCongNgay();
    expect(ngay).toBe(90);
    expect(conTrongCuaSoGhiCong(a.attributedAt, new Date(A.getTime() + 89 * NGAY), ngay)).toBe(true);
    expect(conTrongCuaSoGhiCong(a.attributedAt, new Date(A.getTime() + 90 * NGAY), ngay)).toBe(true); // ngày thứ 90 GỒM
    expect(a.referrerKind).toBe("AFFILIATE");
  }, CASE);

  it("[FLOW-D] CTV QUÁ 90 ngày: GIỮ nguồn (nhóm + người không đổi, KHÔNG thành UNKNOWN) nhưng KHÔNG eligible", async () => {
    const A = new Date("2026-07-01T03:00:00.000Z");
    const lead = await dungLeadCtv(PHONE.d, A);
    const truoc = (await doc(lead)).attribution!;
    const sau91 = new Date(A.getTime() + 91 * NGAY);
    expect(conTrongCuaSoGhiCong(truoc.attributedAt, sau91, await layCuaSoGhiCongNgay())).toBe(false); // không eligible
    // Quá hạn KHÔNG đổi gì trong DB: hàm chỉ trả boolean; attribution đọc lại y hệt.
    const doiLai = (await doc(lead)).attribution!;
    expect(doiLai.group.code).toBe("PARTNER");
    expect(doiLai.group.code).not.toBe("UNKNOWN");
    expect(doiLai.referrerAffiliateId).toBe(truoc.referrerAffiliateId);
    expect(doiLai.updatedAt).toEqual(truoc.updatedAt);
    // Đối chứng dương: chỉnh cửa sổ qua cài đặt ⇒ biên dời theo (không hằng cứng 90 trong mã).
    await datCoNguon(CO_NGUON_DAY_DU, { "nguon.cuaSoGhiCongNgay": 120 });
    expect(await layCuaSoGhiCongNgay()).toBe(120);
    expect(conTrongCuaSoGhiCong(truoc.attributedAt, sau91, 120)).toBe(true);
  }, CASE);

  it("[FLOW-F] lead Facebook cũ, NV giới thiệu ĐẾN SAU ⇒ nguồn gốc GIỮ NGUYÊN (chỉ touchpoint); đổi sang NV phải qua đổi nguồn có kiểm soát và nguồn GỐC vẫn là Facebook", async () => {
    const emp = await db.employee.create({
      data: { employeeCode: `${P}NV1`, fullName: `${P}NV`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: coSo, isActive: true },
      select: { id: true },
    });
    const fb = await ingestLead({
      parentName: `${P}PH`,
      phone: PHONE.f,
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao, adId: "AD-FB-CU", campaignId: "CP-FB-CU" } }),
    });
    const truoc = await doc(fb.leadId!);

    // NV giới thiệu đến SAU (picker) — chỉ GHI LẠI.
    const sau = await ingestIntakeLead(phieu({ phone: PHONE.f }), {
      source: "sale-form-app",
      centerId: coSo,
      tinHieuNguon: tinHieu({ nhanSuGioiThieuEmployeeId: emp.id }),
    });
    expect(sau.duplicate).toBe(true);
    const giuNguyen = await doc(fb.leadId!);
    expect(giuNguyen.attribution!.group.code).toBe("PAID_ADS");
    expect(giuNguyen.attribution!.matchedRule).toBe("QUANG_CAO");
    expect(giuNguyen.attribution!.referrerEmployeeId).toBeNull();
    expect(giuNguyen.attribution!.attributedAt).toEqual(truoc.attribution!.attributedAt);
    expect(giuNguyen.touchpoints).toHaveLength(1);
    expect(giuNguyen.touchpoints[0]!.signals).toMatchObject({ nguoiGioiThieu: { employeeId: emp.id } });

    // Đổi sang NV chỉ qua đường có kiểm soát — và nguồn GỐC (Facebook) vẫn được ghi lại bất biến.
    const r = await doiNguonLead({
      actor: actorCoSo("u-quan-ly", [coSo]),
      actorName: "Quản lý",
      kiemQuyen: async (a) => a === "leads:overwrite",
      leadId: fb.leadId!,
      // PR7 (D5 ở máy chủ): nhân sự này không có vai ⇒ nhóm GHI là nhóm nhân sự giới thiệu (EMPLOYEE_REFERRAL), dù client gửi nhóm nào.
      groupId: nhom.EMPLOYEE_REFERRAL,
      thamChieu: { employeeId: emp.id, parentUserId: null, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Khách xác nhận NV đã giới thiệu trước khi bấm quảng cáo",
      bayGio: new Date(),
    });
    expect(r.ok).toBe(true);
    const doi = (await doc(fb.leadId!)).attribution!;
    expect(doi.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(doi.originalGroup.code).toBe("PAID_ADS"); // nguồn gốc BẤT BIẾN
    expect(doi.attributedAt).toEqual(truoc.attribution!.attributedAt);
  }, CASE);
});
