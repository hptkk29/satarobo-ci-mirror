// @vitest-environment node
/**
 * PR2 "NỐI DÂY INTAKE" — mọi Lead MỚI vào hệ thống đều có LeadAttribution đúng. Postgres LOCAL thật.
 *
 * Bộ này phủ ĐƯỜNG A (`ingestIntakeLead` + 5 caller) và các luật chung của resolver chạy trên DB:
 *
 *   [NHH-SRC-07a]   100% lead có attribution (webhook facebook mang metadata quảng cáo; sale-form theo mã NV)
 *   [NHH-SRC-07a-off] cờ master TẮT ⇒ 0 attribution, 0 touchpoint, lead + `Lead.source` như hôm nay (đối chứng dương cho 07a)
 *   [NHH-SRC-09]    lead CÒN SỐNG trùng SĐT ⇒ KHÔNG tạo lead; ghi touchpoint NHAP_LAI/REF_SAU; attribution cũ GIỮ NGUYÊN
 *   [NHH-SRC-10]    lead DA_MAT trùng SĐT ⇒ lead MỚI kế thừa bộ ba nguồn gốc (+ người giới thiệu) của bản gốc nhất
 *   [NHH-SRC-D3-KETHUA] / [NHH-SRC-D3-REF] chuỗi kế thừa luôn trỏ về GỐC, ref đến sau chỉ là touchpoint
 *   [NHH-SRC-08b]   hai giao dịch SONG SONG cùng claim một lead ⇒ đúng MỘT attribution; lượt sau thành touchpoint
 *   [NHH-SRC-22]    nhãn lạ: cơ sở CHƯA ép chọn ⇒ UNKNOWN + signals.nhanGoc, KHÔNG chặn; cơ sở ép chọn ⇒ chặn TRƯỚC khi tạo lead
 *   [NHH-SRC-14c]   ref hợp lệ trước PR11 ⇒ hàng chờ nguồn, không đoán loại
 *   [NHH-SRC-21c]   người nhập KHÔNG mất quyền: lỗi của quy nguồn không chặn lead (T4)
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. Dọn theo tiền tố `NDAY_` ở beforeAll VÀ afterAll.
 * ⚠️ LUẬT 18: mỗi ca tự dựng cờ + dữ liệu của mình (`dungHienTruong`), không mượn trạng thái ca trước.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { ingestIntakeLead } from "../../lib/lead/intake/ingest";
import { ingestLead } from "../../lib/lead/ingest";
import type { MappedLead } from "../../lib/lead/intake/types";
import { KHONG_CO_TIN_HIEU_NGUON, type TinHieuNguonDauVao } from "../../lib/nguon/tin-hieu";
import { chuanBiQuyNguon, ghiQuyNguonLeadMoi } from "../../lib/nguon/noi-day";
import {
  CO_NGUON_DAY_DU,
  damBaoDanhMucGoc,
  damBaoToChuc,
  datCoNguon,
  datEpChonNguonCoSo,
  type IdNhom,
} from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NDAY_";
const CASE = 60_000;

const PHONE = {
  fb: "0901000001",
  saleForm: "0901000002",
  off: "0901000003",
  dupSong: "0901000004",
  daMat: "0901000005",
  chuoi: "0901000006",
  lan: "0901000007",
  nhanLa: "0901000008",
  aff: "0901000009",
  loi: "0901000010",
  daMat2: "0901000011",
} as const;

const QC_TRONG = KHONG_CO_TIN_HIEU_NGUON.quangCao;

function tinHieu(over: Partial<TinHieuNguonDauVao> = {}): TinHieuNguonDauVao {
  return { ...KHONG_CO_TIN_HIEU_NGUON, ...over };
}

function phieu(over: Partial<MappedLead> = {}): MappedLead {
  return {
    parentName: `${P}Phụ huynh`,
    phone: PHONE.fb,
    email: null,
    centerHint: null,
    children: [],
    employeeCode: null,
    noteLines: [],
    externalId: null,
    consentMarketing: false,
    warnings: [],
    ...over,
  };
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo quy nguồn + touchpoint
  }
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  // Sổ lượt chia lead (`LeadRotationTurn`) là bảng KHÔNG có FK tới User và KHÔNG tự dọn: xoá user mà để lại dòng sổ thì `layPoolDangBat`
  // vẫn đưa user ma vào danh sách ứng viên, `autoAssignNewLead` chọn trúng nó và nổ `Lead_assignedToId_fkey` ở ca SAU (có thể là ca của
  // tệp khác). Đo được khi cấy lỗi (luật 18): thêm MỘT ca POST /api/leads vào đầu tệp làm lệch pha vòng chia và ca [09b] đỏ 3/3.
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NDAY" } } });
  await db.center.deleteMany({ where: { code: { startsWith: "NDAY" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

/** Một nhân viên Sale có tài khoản + vai CENTER_SALES_CSM tại CS1 (nguồn của `roleCodes` là UserOrgRole, không phải User.roles). */
async function dungSale(hau: string, centerId: string): Promise<{ employeeId: string; userId: string; code: string }> {
  const code = `${P}NV${hau}`;
  const emp = await db.employee.create({
    data: { employeeCode: code, fullName: `${P}Sale ${hau}`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId, isActive: true },
    select: { id: true },
  });
  const user = await db.user.create({
    data: { name: `${P}Sale ${hau}`, email: `${P}sale-${hau}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId, employeeId: emp.id, isActive: true },
    select: { id: true },
  });
  const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
  // `effectiveFrom` ĐỂ MẶC ĐỊNH = `now()` của Postgres, mà đồng hồ DB đi TRƯỚC `Date.now()` của Node tới ~1,3 ms (đo 400 lượt: 398 lượt DB nhanh hơn) —
  // gọi ngay sau khi cấp vai thì `effectiveFrom <= now` có thể SAI và vai chưa hiệu lực. Đo được: [NHH-SRC-16h] đỏ ngẫu nhiên ~3% (luật 19).
  await db.userOrgRole.create({ data: { userId: user.id, orgUnitId: cs1.id, roleId: role.id, grantedById: "ndayw", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  return { employeeId: emp.id, userId: user.id, code };
}

describe.skipIf(!RUN)("PR2 — nối dây đường A (ingestIntakeLead) + luật chung", () => {
  let nhom: IdNhom;
  let coSo = "";

  beforeAll(async () => {
    await don();
    // Tự dựng Center/OrgUnit + vai (luật 18) — `dungSale` gắn vai tại OrgUnit CS1, và ca kế thừa/Sale tra Center CS1.
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 180_000);

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    coSo = (await db.center.create({ data: { code: "NDAY1", name: "NDAY 1", slug: "nday-1", address: "a", city: "" } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  const attrCua = (leadId: string) =>
    db.lead.findUnique({
      where: { id: leadId },
      select: {
        source: true,
        attribution: { include: { group: { select: { code: true } }, originalGroup: { select: { code: true } } } },
        touchpoints: { orderBy: { occurredAt: "asc" } },
      },
    });

  it("[NHH-SRC-07a] webhook facebook mang ad_id/campaign/form ⇒ đúng 1 attribution QUANG_CAO, metadata nằm trong signals", async () => {
    const r = await ingestLead({
      parentName: `${P}Phụ huynh`,
      phone: PHONE.fb,
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ quangCao: { ...QC_TRONG, adId: "AD42", campaignId: "CP7", formId: "FORM9" }, pageId: null }),
    });
    expect(r.ok).toBe(true);
    const l = await attrCua(r.leadId!);
    expect(l!.attribution).not.toBeNull();
    expect(l!.attribution!.group.code).toBe("PAID_ADS");
    expect(l!.attribution!.matchedRule).toBe("QUANG_CAO");
    expect(l!.attribution!.identificationMethod).toBe("AD_FORM_CAMPAIGN");
    expect((l!.attribution!.signals as { quangCao: Record<string, string> }).quangCao).toEqual({
      adId: "AD42",
      campaignId: "CP7",
      formId: "FORM9",
    });
    expect(l!.attribution!.conversionEntry).toBe("facebook");
    expect(l!.source).toBe("facebook"); // Lead.source giữ làm ĐƯỜNG VÀO (D6)
    expect(l!.touchpoints).toHaveLength(0);
  }, CASE);

  it("[NHH-SRC-07a2] sale-form công khai mang mã NV của Sale ⇒ nhóm Sale, người giới thiệu = nhân viên đó (D12)", async () => {
    const sale = await dungSale("A", coSo);
    const r = await ingestIntakeLead(phieu({ phone: PHONE.saleForm, employeeCode: sale.code }), {
      source: "sale-form",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    expect(r.ok).toBe(true);
    const l = await attrCua(r.leadId!);
    expect(l!.attribution!.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(l!.attribution!.referrerKind).toBe("EMPLOYEE");
    expect(l!.attribution!.referrerEmployeeId).toBe(sale.employeeId);
    expect(l!.attribution!.referrerMissing).toBe(false);
    expect(l!.attribution!.matchedRule).toBe("KHAI_TAY");
  }, CASE);

  it("[NHH-SRC-07a3] sale-form-app (đường /nhap-khach-hang): NGƯỜI GÕ (phiên đăng nhập của một Sale, KHÔNG có mã NV) quyết nhóm ⇒ EMPLOYEE_REFERRAL VÀ được lưu làm referrerEmployeeId + vai + dấu vết (D12 giữ nguyên, chủ dự án chốt 09/10/2026) — để luôn biết ai nhập", async () => {
    // Cấy `nguoiNhapUserId: ctx.createdByUserId ?? null` → `null` ở ingest.ts: người gõ máy không bao giờ được giải ⇒ nhãn máy rơi về
    // UNKNOWN. Không ca nào khác đỏ vì mọi ca sale-form khác đi bằng mã NV hoặc không có người nhập.
    // Cấy 2: thêm lại cổng «người nhập = người giới thiệu ⇒ gỡ người» vào `hoanTat` ⇒ ca này đỏ (referrerEmployeeId null + referrerMissing).
    const sale = await dungSale("N", coSo);
    const r = await ingestIntakeLead(phieu({ phone: PHONE.saleForm }), {
      source: "sale-form-app",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
      createdByUserId: sale.userId,
    });
    expect(r.ok, r.error).toBe(true);
    const a = (await attrCua(r.leadId!))!.attribution!;
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerKind).toBe("EMPLOYEE");
    expect(a.referrerEmployeeId).toBe(sale.employeeId);
    expect(a.referrerMissing).toBe(false);
    expect(a.referrerRoleCode).toBe("SALE"); // snapshot vai lúc ghi (vai CENTER_SALES_CSM gắn ở `dungSale`)
    expect(a.canhBao).toEqual([]);
    const s = a.signals as { nguoiGioiThieu?: { employeeCode: string | null; roleCodes: string[] }; coXemTay?: boolean; xemTay?: string[] };
    expect(s.nguoiGioiThieu).toMatchObject({ employeeCode: sale.code, roleCodes: ["CENTER_SALES_CSM"] });
    expect(s.coXemTay).toBeUndefined();
    expect(s.xemTay).toBeUndefined();
    // Đối chứng âm: cùng phiếu KHÔNG có người nhập ⇒ không thể đoán nhóm Sale.
    const r2 = await ingestIntakeLead(phieu({ phone: PHONE.off }), { source: "sale-form-app", centerId: coSo, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON });
    expect((await attrCua(r2.leadId!))!.attribution!.group.code).not.toBe("EMPLOYEE_REFERRAL");
  }, CASE);

  it("[NHH-SRC-07a-off] cờ master TẮT ⇒ lead vẫn tạo, Lead.source như cũ, 0 attribution, 0 touchpoint (đối chứng dương cho 07a)", async () => {
    await datCoNguon({}); // không có dòng nào ⇒ mọi cờ về mặc định false
    const r = await ingestLead({
      parentName: `${P}Phụ huynh`,
      phone: PHONE.off,
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ quangCao: { ...QC_TRONG, adId: "AD42" } }),
    });
    expect(r.ok).toBe(true);
    const l = await attrCua(r.leadId!);
    expect(l!.source).toBe("facebook");
    expect(l!.attribution).toBeNull();
    expect(l!.touchpoints).toHaveLength(0);
    expect(await db.leadAttribution.count({ where: { lead: { parentName: { startsWith: P } } } })).toBe(0);
  }, CASE);

  it("[NHH-SRC-09] lead CÒN SỐNG trùng SĐT ⇒ KHÔNG tạo lead mới; ref đến sau thành touchpoint NHAP_LAI + REF_SAU, attribution cũ GIỮ NGUYÊN", async () => {
    const dau = await ingestLead({
      parentName: `${P}Phụ huynh`,
      phone: PHONE.dupSong,
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ quangCao: { ...QC_TRONG, campaignId: "CP1" } }),
    });
    const truoc = await attrCua(dau.leadId!);
    const sau = await ingestIntakeLead(phieu({ phone: PHONE.dupSong }), {
      source: "quatang",
      centerId: coSo,
      tinHieuNguon: tinHieu({ ref: "ABCDEF" }),
    });
    expect(sau.ok).toBe(true);
    expect(sau.duplicate).toBe(true);
    expect(sau.leadId).toBe(dau.leadId);
    expect(await db.lead.count({ where: { parentName: { startsWith: P }, phone: { in: [PHONE.dupSong, `84${PHONE.dupSong.slice(1)}`] } } })).toBe(1);
    const l = await attrCua(dau.leadId!);
    expect(l!.attribution!.groupId).toBe(truoc!.attribution!.groupId);
    expect(l!.attribution!.matchedRule).toBe("QUANG_CAO");
    expect(l!.attribution!.attributedAt).toEqual(truoc!.attribution!.attributedAt);
    expect(l!.touchpoints.map((t) => t.kind).sort()).toEqual(["NHAP_LAI", "REF_SAU"]);
  }, CASE);

  it("[NHH-SRC-09-off] đối chứng: cờ TẮT ⇒ nhánh trùng SĐT KHÔNG ghi touchpoint", async () => {
    const dau = await ingestLead({
      parentName: `${P}Phụ huynh`,
      phone: PHONE.dupSong,
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    await datCoNguon({});
    await ingestIntakeLead(phieu({ phone: PHONE.dupSong }), {
      source: "quatang",
      centerId: coSo,
      tinHieuNguon: tinHieu({ ref: "ABCDEF" }),
    });
    expect(await db.leadTouchpoint.count({ where: { leadId: dau.leadId! } })).toBe(0);
  }, CASE);

  it("[NHH-SRC-10][NHH-SRC-D3-KETHUA] lead DA_MAT trùng SĐT ⇒ lead MỚI kế thừa nguồn gốc + người giới thiệu của bản gốc; attributedAt = mốc bản gốc", async () => {
    const sale = await dungSale("B", coSo);
    const cu = await db.lead.create({
      data: { parentName: `${P}Cũ`, phone: PHONE.daMat, status: "DA_MAT", centerId: coSo, createdAt: new Date("2026-06-01T02:00:00.000Z") },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: {
        leadId: cu.id,
        groupId: nhom.EMPLOYEE_REFERRAL,
        originalGroupId: nhom.PARENT_REFERRAL,
        referrerKind: "EMPLOYEE",
        referrerEmployeeId: sale.employeeId,
        identificationMethod: "MANUAL",
        matchedRule: "KHAI_TAY",
        reasonText: "ca test",
        attributedAt: new Date("2026-06-01T02:00:00.000Z"),
      },
    });

    const moi = await ingestIntakeLead(phieu({ phone: PHONE.daMat }), {
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ ref: "NDAYREFX" }), // ref đến CÙNG lượt: KHÔNG chiếm nguồn
    });
    expect(moi.ok).toBe(true);
    expect(moi.duplicate).toBe(false);
    expect(moi.leadId).not.toBe(cu.id);
    const l = await attrCua(moi.leadId!);
    const a = l!.attribution!;
    expect(a.matchedRule).toBe("KE_THUA_SDT");
    expect(a.identificationMethod).toBe("EXISTING_LEAD");
    expect(a.inheritedFromLeadId).toBe(cu.id);
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.originalGroup.code).toBe("PARENT_REFERRAL");
    expect(a.attributedAt).toEqual(new Date("2026-06-01T02:00:00.000Z"));
    expect(a.referrerEmployeeId).toBe(sale.employeeId);
    // [NHH-SRC-D3-REF] ref đến cùng lượt ⇒ đúng 1 touchpoint REF_SAU, attribution KHÔNG đổi.
    expect(l!.touchpoints.map((t) => t.kind)).toEqual(["REF_SAU"]);
    expect((l!.touchpoints[0]!.signals as { ref: string }).ref).toBe("NDAYREFX");
  }, CASE);

  it("[NHH-SRC-D3-CHUOI] chuỗi kế thừa luôn trỏ về GỐC NHẤT, không qua bản trung gian", async () => {
    // Bản trung gian được INSERT TRƯỚC bản gốc ⇒ thứ tự dòng Postgres trả về (không orderBy) KHÁC thứ tự thời gian: cấy `chonGocKeThua(ds)`
    // → `ds[0]` chỉ đỏ khi fixture tách hai thứ đó (hai bản cùng `attributedAt`, gốc là bản không kế thừa).
    const giua = await db.lead.create({
      data: { parentName: `${P}Giữa`, phone: PHONE.chuoi, status: "DA_MAT", centerId: coSo },
      select: { id: true },
    });
    const goc = await db.lead.create({
      data: { parentName: `${P}Gốc`, phone: PHONE.chuoi, status: "DA_MAT", centerId: coSo },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: {
        leadId: goc.id, groupId: nhom.PAID_ADS, originalGroupId: nhom.PAID_ADS, identificationMethod: "MANUAL",
        matchedRule: "KHAI_TAY", reasonText: "gốc", attributedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    });
    await db.leadAttribution.create({
      data: {
        leadId: giua.id, groupId: nhom.PAID_ADS, originalGroupId: nhom.PAID_ADS, identificationMethod: "EXISTING_LEAD",
        matchedRule: "KE_THUA_SDT", reasonText: "giữa", inheritedFromLeadId: goc.id, attributedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    });
    const moi = await ingestIntakeLead(phieu({ phone: PHONE.chuoi }), { source: "facebook", centerId: coSo, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON });
    expect((await attrCua(moi.leadId!))!.attribution!.inheritedFromLeadId).toBe(goc.id);
  }, CASE);

  it("[NHH-SRC-08b] hai giao dịch SONG SONG cùng claim một lead ⇒ đúng MỘT attribution; lượt sau thành touchpoint (giờ DB quyết, không phải client)", async () => {
    const l = await db.lead.create({ data: { parentName: `${P}Đua`, phone: PHONE.lan, status: "MOI", centerId: coSo }, select: { id: true } });
    const dauVao = (ad: string) => ({
      bayGio: new Date(),
      duongVao: "facebook",
      conversionEntry: "facebook",
      nhanKhai: null,
      laNhapExcel: false,
      sdtKhach: PHONE.lan,
      maNvNguoiNhap: null,
      nguoiNhapUserId: null,
      nhanSuGioiThieuEmployeeId: null,
      phuHuynhGioiThieu: null,
      ref: null,
      refSau: [],
      quangCao: { ...QC_TRONG, adId: ad },
      utm: KHONG_CO_TIN_HIEU_NGUON.utm,
      pageId: null,
      orgUnitId: null,
      centerId: null,
    });
    const [a, b] = await Promise.all([chuanBiQuyNguon(db, [dauVao("ADX")]), chuanBiQuyNguon(db, [dauVao("ADY")])]);
    await Promise.all([
      db.$transaction((tx) => ghiQuyNguonLeadMoi(tx, l.id, a[0]!, null)),
      db.$transaction((tx) => ghiQuyNguonLeadMoi(tx, l.id, b[0]!, null)),
    ]);
    expect(await db.leadAttribution.count({ where: { leadId: l.id } })).toBe(1);
    const tp = await db.leadTouchpoint.findMany({ where: { leadId: l.id } });
    expect(tp.filter((t) => (t.signals as { thua?: boolean } | null)?.thua === true)).toHaveLength(1);
    // Đối chứng dương: lượt THẮNG mang đúng một trong hai ad.
    const att = await db.lead.findUnique({ where: { id: l.id }, select: { attribution: { select: { signals: true } } } });
    expect(["ADX", "ADY"]).toContain((att!.attribution!.signals as { quangCao: { adId: string } }).quangCao.adId);
  }, CASE);

  it("[NHH-SRC-22a] nhãn LẠ + cơ sở CHƯA ép chọn ⇒ lead tạo, attribution UNKNOWN + signals.nhanGoc + xem tay (KHÔNG chặn)", async () => {
    const r = await ingestIntakeLead(phieu({ phone: PHONE.nhanLa, leadSource: "Nguồn mới tinh" }), {
      source: "sale-form-app",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    expect(r.ok).toBe(true);
    const a = (await attrCua(r.leadId!))!.attribution!;
    expect(a.group.code).toBe("UNKNOWN");
    const s = a.signals as { nhanGoc: string; coXemTay: boolean; xemTay: string[] };
    expect(s.nhanGoc).toBe("Nguồn mới tinh");
    expect(s.coXemTay).toBe(true);
    expect(s.xemTay).toContain("NHAN_NGUON_LA");
  }, CASE);

  it("[NHH-SRC-22b] nhãn LẠ + cơ sở ĐÃ ép chọn ⇒ bị chặn TRƯỚC khi tạo lead (0 lead); cơ sở khác vẫn qua", async () => {
    // Cơ sở thật có OrgUnit để cờ override theo cơ sở có đối tượng.
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    const chan = await ingestIntakeLead(phieu({ phone: PHONE.nhanLa, leadSource: "Nguồn mới tinh" }), {
      source: "sale-form-app",
      centerId: cs1.id,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    expect(chan.ok).toBe(false);
    expect(chan.error).toMatch(/không có trong danh sách nguồn/);
    expect(await db.lead.count({ where: { parentName: { startsWith: P } } })).toBe(0);

    // Đối chứng dương: cùng nhãn lạ, cơ sở KHÔNG ép chọn ⇒ qua.
    const qua = await ingestIntakeLead(phieu({ phone: PHONE.nhanLa, leadSource: "Nguồn mới tinh" }), {
      source: "sale-form-app",
      centerId: coSo,
      tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
    });
    expect(qua.ok).toBe(true);
    await datEpChonNguonCoSo(ou.id, null);
  }, CASE);

  it("[NHH-SRC-22d] cơ sở ĐÃ ép chọn: chỉ nhãn LẠ bị chặn — lead HỢP LỆ (nhãn trong 28 nhãn, hoặc không nhãn + tín hiệu quảng cáo) vẫn tạo bình thường", async () => {
    // Cấy bỏ vế `xemTay.includes("NHAN_NGUON_LA")` ở `chanNhap`: cơ sở bật ép chọn sẽ chặn MỌI phiếu, kể cả phiếu hoàn toàn hợp lệ
    // — mất lead thật, và ca [22b] không bắt được vì nó chỉ đưa vào đúng một phiếu lạ.
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    try {
      const co = await ingestIntakeLead(phieu({ phone: PHONE.chuoi, leadSource: "Ads" }), {
        source: "sale-form-app",
        centerId: cs1.id,
        tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON,
      });
      expect(co.ok, co.error).toBe(true);
      expect((await attrCua(co.leadId!))!.attribution!.group.code).toBe("PAID_ADS");

      const khongNhan = await ingestIntakeLead(phieu({ phone: PHONE.lan }), {
        source: "facebook",
        centerId: cs1.id,
        tinHieuNguon: tinHieu({ quangCao: { ...QC_TRONG, adId: "AD-22D", campaignId: "CP-22D" } }),
      });
      expect(khongNhan.ok, khongNhan.error).toBe(true);
      expect((await attrCua(khongNhan.leadId!))!.attribution!.matchedRule).toBe("QUANG_CAO");
    } finally {
      await datEpChonNguonCoSo(ou.id, null);
    }
  }, CASE);

  it("[NHH-SRC-14c] ref HỢP LỆ trước PR11 ⇒ attribution UNKNOWN + xem tay AFF_CHUA_PHAN_LOAI, không đoán loại; ref chụp vào signals", async () => {
    const aff = await db.affiliate.create({ data: { code: "NDAYAFF1", name: `${P}aff`, isActive: true }, select: { id: true } });
    const r = await ingestIntakeLead(phieu({ phone: PHONE.aff }), {
      source: "facebook",
      centerId: coSo,
      tinHieuNguon: tinHieu({ ref: "ndayaff1" }),
    });
    const a = (await attrCua(r.leadId!))!.attribution!;
    expect(a.group.code).toBe("UNKNOWN");
    expect(a.matchedRule).toBe("AFF_CHUA_PHAN_LOAI");
    expect((a.signals as { ref: { affiliateId: string }; xemTay: string[] }).ref.affiliateId).toBe(aff.id);
    expect((a.signals as { xemTay: string[] }).xemTay).toEqual(["AFF_CHUA_PHAN_LOAI"]);
    // Đối chứng dương: ref SAI ⇒ về đường vào mặc định, không xem tay.
    await db.lead.deleteMany({ where: { id: r.leadId! } });
    const r2 = await ingestIntakeLead(phieu({ phone: PHONE.aff }), { source: "facebook", centerId: coSo, tinHieuNguon: tinHieu({ ref: "KHONGCO" }) });
    const a2 = (await attrCua(r2.leadId!))!.attribution!;
    expect(a2.group.code).toBe("PAID_ADS");
    expect((a2.signals as { coXemTay?: boolean }).coXemTay).toBeUndefined();
  }, CASE);

  it("[NHH-SRC-21c] T4: danh mục nguồn HỎNG (thiếu UNKNOWN) ⇒ lead VẪN tạo (đường máy không bao giờ bị chặn vì quy nguồn)", async () => {
    // Tách UNKNOWN ra khỏi danh mục bằng cách đổi code tạm — mô phỏng triển khai thiếu seed.
    await db.leadSourceGroup.update({ where: { code: "UNKNOWN" }, data: { code: "UNKNOWN_TAM" } });
    try {
      const r = await ingestLead({ parentName: `${P}Phụ huynh`, phone: PHONE.loi, source: "facebook", centerId: coSo, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON });
      expect(r.ok).toBe(true);
      expect((await attrCua(r.leadId!))!.attribution).toBeNull(); // chưa có quy nguồn — script di trú sẽ vét
    } finally {
      await db.leadSourceGroup.update({ where: { code: "UNKNOWN_TAM" }, data: { code: "UNKNOWN" } });
    }
  }, CASE);
});
