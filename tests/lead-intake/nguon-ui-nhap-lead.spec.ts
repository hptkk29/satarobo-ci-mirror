// @vitest-environment node
/**
 * PR7 — Ô CHỌN NGUỒN của form nhập lead (06 §5.6): `createInternalLeadAction` chạy ĐẦU–CUỐI trên Postgres LOCAL, quyền RBAC v2 thật.
 *
 *   [NHH-UI-NL-01]  `loadNguonChoFormNhap`: master tắt ⇒ null; không cơ sở nào ép ⇒ null; ép MỘT cơ sở ⇒ đúng cờ từng cơ sở + 8 nguồn
 *   [NHH-UI-NL-02]  cơ sở ÉP CHỌN mà phiếu thiếu `nguonChon` ⇒ máy chủ CHẶN (không tạo lead); cơ sở KHÔNG ép ⇒ hành vi cũ y nguyên
 *   [NHH-UI-NL-03]  chọn nhóm không cần người ⇒ lead + quy nguồn đúng nhóm (luật CHON_NGUON, MANUAL); `Lead.source` là kênh kỹ thuật
 *   [NHH-UI-NL-04]  chọn nhân sự ⇒ nhóm SUY TỪ VAI (không phải nhóm bấm), người ghi đúng cột
 *   [NHH-UI-NL-05]  lựa chọn KHÔNG HỢP LỆ (thiếu người · người đã nghỉ · người lạc loại · id ma · giải trình ngắn · nhóm ngừng) ⇒ KHÔNG tạo lead
 *   [NHH-UI-NL-06]  cờ master TẮT ⇒ `nguonChon` gửi bừa bị bỏ qua: lead vẫn tạo, 0 quy nguồn (hành vi cũ)
 *   [NHH-UI-NL-07]  trùng SĐT với lead còn sống ⇒ KHÔNG đổi nguồn gốc (D3), chỉ ghi touchpoint kèm nhóm người nhập bấm
 *   [NHH-UI-NL-08]  `epChonNguonChoMaCoSo`: cờ THEO CƠ SỞ (cơ sở khác không ép), phiếu chưa chọn cơ sở dùng cờ toàn hệ
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NUIN_` / SĐT cố định. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.8" }),
}));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { seedOrg, seedRoles } from "../e2e/_helpers/seed";
import { createInternalLeadAction } from "../../lib/lead/intake/quick-form-action";
import { epChonNguonChoMaCoSo, loadNguonChoFormNhap } from "../../lib/nguon/nguon-cho-form-nhap";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon, datEpChonNguonCoSo, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NUIN_";
const CASE = 90_000;
const SDT = { a: "0906100001", b: "0906100002", c: "0906100003", d: "0906100004", e: "0906100005", f: "0906100006", g: "0906100007", h: "0906100008" } as const;
const TAT_CA_SDT = Object.values(SDT);
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: TAT_CA_SDT.flatMap(bienThe) } }] },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.leadRotationTurn.deleteMany({});
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NUINAFF" } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  await db.centerSetting.deleteMany({ where: { key: "nguon.epChonNguon" } });
}

async function dungSale(): Promise<void> {
  const email = `${P}sale@example.test`;
  const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const u = await db.user.create({
    data: { name: `${P}Sale`, email, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, isActive: true },
    select: { id: true },
  });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuin", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  SESS.current = { user: { id: u.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, name: `${P}Sale`, email } };
}

describe.skipIf(!RUN)("PR7 — ô chọn nguồn của form nhập lead, đầu–cuối", () => {
  let nhom: IdNhom;
  let ouCs1 = "";
  const truocRbac = process.env.RBAC_V2_ENABLED;

  const theoSdt = (s: string) =>
    db.lead.findFirst({
      where: { phone: { in: bienThe(s) }, deletedAt: null },
      select: {
        id: true,
        source: true,
        attribution: { include: { group: { select: { code: true } } } },
        touchpoints: { orderBy: { occurredAt: "asc" } },
      },
    });

  /** Phiếu của cơ sở CS1 (ép chọn) — ghi đè được từng trường. */
  const phieu = (sdt: string, nguonChon: unknown, over: Record<string, unknown> = {}) => ({
    parentName: `${P}Phụ huynh ${sdt.slice(-2)}`,
    phone: sdt,
    centerCode: "CS1",
    children: [],
    nguonChon,
    ...over,
  });
  const chon = (groupId: string, o: Record<string, unknown> = {}) => ({
    groupId,
    employeeId: null,
    parentUserId: null,
    studentId: null,
    affiliateId: null,
    giaiTrinh: null,
    ...o,
  });
  const dungNv = async (hau: string, status: "ACTIVE" | "RESIGNED" = "ACTIVE") => {
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    return db.employee.create({
      data: { employeeCode: `${P}NV${hau}`, fullName: `${P}Nhân viên ${hau}`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: cs1.id, status, isActive: status === "ACTIVE" },
      select: { id: true },
    });
  };

  // Dữ liệu NỀN (cơ sở · cây đơn vị · vai) tự dựng, idempotent (upsert, không xoá): bộ này KHÔNG mượn trạng thái mà `test:chat-db` để lại
  // (luật 18 — chạy riêng nó trên DB trắng phải xanh).
  beforeAll(async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    ouCs1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await datEpChonNguonCoSo(ouCs1, true); // CS1 ép chọn; CS2 chưa
    await dungSale();
  }, CASE);

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await don();
    await db.$disconnect();
  }, 180_000);

  it("[NHH-UI-NL-01] loadNguonChoFormNhap: master TẮT ⇒ null; bật mà KHÔNG cơ sở nào ép ⇒ null; ép CS1 ⇒ đúng cờ từng cơ sở + 8 nguồn chọn được", async () => {
    const co = [{ code: "CS1" }, { code: "CS2" }];
    await datCoNguon({});
    expect(await loadNguonChoFormNhap(co, new Date("2026-11-20T03:00:00.000Z"))).toBeNull();
    await datCoNguon(CO_NGUON_DAY_DU);
    await datEpChonNguonCoSo(ouCs1, null);
    expect(await loadNguonChoFormNhap(co, new Date("2026-11-20T03:00:00.000Z"))).toBeNull();
    await datEpChonNguonCoSo(ouCs1, true);
    const r = await loadNguonChoFormNhap(co, new Date("2026-11-20T03:00:00.000Z"));
    expect(r).not.toBeNull();
    expect(r!.epTheoCoSo).toEqual({ CS1: true, CS2: false });
    expect(r!.epMacDinh).toBe(false);
    expect(r!.danhMuc).toHaveLength(8);
    expect(r!.danhMuc.map((g) => g.code)).not.toContain("UNKNOWN");
  }, CASE);

  it("[NHH-UI-NL-02] cơ sở ÉP CHỌN: phiếu thiếu `nguonChon` ⇒ máy chủ CHẶN, KHÔNG tạo lead; cơ sở KHÔNG ép (CS2) + nhãn gõ tự do ⇒ hành vi cũ", async () => {
    const thieu = await createInternalLeadAction(phieu(SDT.a, null));
    expect(thieu.ok).toBe(false);
    expect(thieu.error).toMatch(/bắt buộc chọn nguồn/);
    expect(await theoSdt(SDT.a)).toBeNull();
    // đối chứng dương: cùng phiếu có nguồn ⇒ tạo được
    expect((await createInternalLeadAction(phieu(SDT.a, chon(nhom.WALK_IN)))).ok).toBe(true);
    expect(await theoSdt(SDT.a)).not.toBeNull();
    // CS2 không ép ⇒ ô gõ tự do như cũ: nhãn người gõ đi vào Lead.source
    const cu = await createInternalLeadAction(phieu(SDT.b, null, { centerCode: "CS2", source: "Facebook Ads" }));
    expect(cu.ok, cu.error).toBe(true);
    expect((await theoSdt(SDT.b))!.source).toBe("Facebook Ads");
  }, CASE);

  it("[NHH-UI-NL-03] nhóm KHÔNG cần người ⇒ lead + quy nguồn đúng nhóm, luật CHON_NGUON, MANUAL; `Lead.source` là kênh kỹ thuật (không còn nhãn gõ tay)", async () => {
    const r = await createInternalLeadAction(phieu(SDT.a, chon(nhom.PAID_ADS)));
    expect(r.ok, r.error).toBe(true);
    const l = (await theoSdt(SDT.a))!;
    expect(l.source).toBe("sale-form-app");
    expect(l.attribution!.group.code).toBe("PAID_ADS");
    expect(l.attribution).toMatchObject({ matchedRule: "CHON_NGUON", identificationMethod: "MANUAL", referrerKind: null, referrerMissing: false });
    // nhóm 'Khác' + giải trình đã trim
    const k = await createInternalLeadAction(phieu(SDT.b, chon(nhom.OTHER, { giaiTrinh: "  khách đến từ hội thảo STEM  " })));
    expect(k.ok, k.error).toBe(true);
    expect((await theoSdt(SDT.b))!.attribution).toMatchObject({ otherSourceNote: "khách đến từ hội thảo STEM" });
  }, CASE);

  it("[NHH-UI-NL-04] chọn nhân sự ⇒ nhóm GHI là nhóm nhân sự giới thiệu (người là giáo viên vẫn vậy — vai chỉ là snapshot); người ghi đúng cột; phụ huynh ⇒ cột học viên", async () => {
    const e = await dungNv("1");
    const u = await db.user.create({ data: { name: `${P}gv`, email: `${P}gv@example.test`, role: "TEACHER", roles: ["TEACHER"], isActive: true, employeeId: e.id }, select: { id: true } });
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const role = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuin", effectiveFrom: new Date(Date.now() - 3_600_000) } });

    const r = await createInternalLeadAction(phieu(SDT.a, chon(nhom.EMPLOYEE_REFERRAL, { employeeId: e.id })));
    expect(r.ok, r.error).toBe(true);
    const l = (await theoSdt(SDT.a))!;
    expect(l.attribution!.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(l.attribution).toMatchObject({ referrerKind: "EMPLOYEE", referrerEmployeeId: e.id, referrerMissing: false, matchedRule: "CHON_NGUON" });

    const hs = await db.student.create({ data: { name: `${P}Bé`, parentName: "PH", centerId: (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id }, select: { id: true } });
    const ph = await createInternalLeadAction(phieu(SDT.b, chon(nhom.PARENT_REFERRAL, { studentId: hs.id })));
    expect(ph.ok, ph.error).toBe(true);
    expect((await theoSdt(SDT.b))!.attribution).toMatchObject({ referrerKind: "PARENT", referrerStudentId: hs.id });
    expect((await theoSdt(SDT.b))!.attribution!.group.code).toBe("PARENT_REFERRAL");
  }, CASE);

  it("[NHH-UI-NL-05] lựa chọn KHÔNG HỢP LỆ ⇒ báo lỗi đúng câu và KHÔNG tạo lead (khách không được rơi UNKNOWN âm thầm)", async () => {
    const nghi = await dungNv("2", "RESIGNED");
    const ok = await dungNv("3");
    const ca: [string, unknown, RegExp][] = [
      ["nguồn cần nhân sự mà không chọn ai", chon(nhom.EMPLOYEE_REFERRAL), /cần chọn nhân sự giới thiệu/],
      ["nhân sự đã nghỉ", chon(nhom.EMPLOYEE_REFERRAL, { employeeId: nghi.id }), /không còn làm việc/],
      ["nhân sự không tồn tại (id ma)", chon(nhom.EMPLOYEE_REFERRAL, { employeeId: "khong-co-nguoi-nay" }), /không còn làm việc hoặc không tồn tại/],
      ["người lạc loại: đối tác ở nguồn nhân sự", chon(nhom.EMPLOYEE_REFERRAL, { affiliateId: "xx" }), /cần chọn nhân sự giới thiệu/],
      ["học viên giả ở nguồn phụ huynh (id ma — FK Restrict)", chon(nhom.PARENT_REFERRAL, { studentId: "khong-co-hv" }), /Phụ huynh giới thiệu không tồn tại/],
      ["nguồn 'Khác' thiếu giải trình", chon(nhom.OTHER, { giaiTrinh: "ngắn" }), /giải trình/],
      ["nguồn không có người mà gửi kèm người", chon(nhom.PAID_ADS, { employeeId: ok.id }), /không có người giới thiệu/],
      ["id nhóm không có thật", chon("khong-co-nhom"), /không còn dùng được/],
      ["UNKNOWN (hệ thống gán, không phải lựa chọn)", chon((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "UNKNOWN" }, select: { id: true } })).id), /không còn dùng được/],
    ];
    for (const [i, [ten, nc, re]] of ca.entries()) {
      const sdt = i < 4 ? Object.values(SDT)[i]! : Object.values(SDT)[(i % 4) + 4]!;
      const r = await createInternalLeadAction(phieu(sdt, nc));
      expect(r.ok, ten).toBe(false);
      expect(r.error, ten).toMatch(re);
      expect(await theoSdt(sdt), `${ten} — không được tạo lead`).toBeNull();
    }
    // nhóm đã NGỪNG
    await db.leadSourceGroup.update({ where: { id: nhom.WALK_IN }, data: { status: "INACTIVE" } });
    try {
      const r = await createInternalLeadAction(phieu(SDT.a, chon(nhom.WALK_IN)));
      expect(r.ok).toBe(false);
      expect(await theoSdt(SDT.a)).toBeNull();
    } finally {
      await db.leadSourceGroup.update({ where: { id: nhom.WALK_IN }, data: { status: "ACTIVE" } });
    }
  }, CASE);

  it("[NHH-UI-NL-05b] người được chọn ĐÃ XOÁ MỀM / đã tắt ⇒ chặn như người không tồn tại (học viên · user phụ huynh · đối tác); đối tác ĐANG BẬT (đối chứng dương) ⇒ tạo được", async () => {
    // Cấy bỏ `deletedAt: null` (học viên / user) hoặc `isActive: true` (đối tác) ở thu-thap-tin-hieu: lead gắn vào một người không còn được hưởng.
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const hsXoa = await db.student.create({ data: { name: `${P}Bé đã xoá`, parentName: "PH", centerId: cs1.id, deletedAt: new Date() }, select: { id: true } });
    const phXoa = await db.user.create({
      data: { name: `${P}ph-xoa`, email: `${P}ph-xoa@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true, deletedAt: new Date() },
      select: { id: true },
    });
    const tat = await db.affiliate.create({ data: { code: "NUINAFF01", name: `${P}Đối tác tắt`, isActive: false }, select: { id: true } });
    const bat = await db.affiliate.create({ data: { code: "NUINAFF02", name: `${P}Đối tác bật`, isActive: true }, select: { id: true } });
    const ca: [string, unknown, RegExp][] = [
      ["học viên đã xoá mềm", chon(nhom.PARENT_REFERRAL, { studentId: hsXoa.id }), /Phụ huynh giới thiệu không tồn tại/],
      ["user phụ huynh đã xoá mềm", chon(nhom.PARENT_REFERRAL, { parentUserId: phXoa.id }), /Phụ huynh giới thiệu không tồn tại/],
      ["đối tác đã tắt", chon(nhom.PARTNER, { affiliateId: tat.id }), /Đối tác giới thiệu không tồn tại hoặc đã tắt/],
    ];
    for (const [i, [ten, nc, re]] of ca.entries()) {
      const sdt = [SDT.a, SDT.b, SDT.c][i]!;
      const r = await createInternalLeadAction(phieu(sdt, nc));
      expect(r.ok, ten).toBe(false);
      expect(r.error, ten).toMatch(re);
      expect(await theoSdt(sdt), `${ten} — không được tạo lead`).toBeNull();
    }
    const ok = await createInternalLeadAction(phieu(SDT.d, chon(nhom.PARTNER, { affiliateId: bat.id })));
    expect(ok.ok, ok.error).toBe(true);
    expect((await theoSdt(SDT.d))!.attribution).toMatchObject({ referrerKind: "AFFILIATE", referrerAffiliateId: bat.id, matchedRule: "CHON_NGUON" });
  }, CASE);

  it("[NHH-UI-NL-09] nhân sự được chọn có SĐT TRÙNG SĐT KHÁCH ⇒ lead vẫn tạo nhưng attribution mang cảnh báo NGUOI_GT_LA_KHACH; SĐT khác ⇒ không cảnh báo (đối chứng dương)", async () => {
    // Cấy bỏ `if (ns && sdtNguoiGt === null) sdtNguoiGt = ns.phone` ở thu-thap-tin-hieu: chọn CHÍNH MÌNH làm người giới thiệu qua ô chọn nguồn không để lại dấu.
    const trung = await dungNv("9");
    await db.employee.update({ where: { id: trung.id }, data: { phone: SDT.a } });
    const khac = await dungNv("8");
    await db.employee.update({ where: { id: khac.id }, data: { phone: "0906199999" } });
    const r = await createInternalLeadAction(phieu(SDT.a, chon(nhom.EMPLOYEE_REFERRAL, { employeeId: trung.id })));
    expect(r.ok, r.error).toBe(true);
    const l = (await theoSdt(SDT.a))!;
    expect(l.attribution!.canhBao).toContain("NGUOI_GT_LA_KHACH");
    expect(l.attribution!.referrerEmployeeId).toBe(trung.id);
    const r2 = await createInternalLeadAction(phieu(SDT.b, chon(nhom.EMPLOYEE_REFERRAL, { employeeId: khac.id })));
    expect(r2.ok, r2.error).toBe(true);
    expect((await theoSdt(SDT.b))!.attribution!.canhBao).not.toContain("NGUOI_GT_LA_KHACH");
  }, CASE);

  it("[NHH-UI-NL-06] cờ master TẮT ⇒ `nguonChon` gửi bừa bị BỎ QUA: lead vẫn tạo, 0 quy nguồn, không chặn (hành vi cũ)", async () => {
    await datCoNguon({});
    const r = await createInternalLeadAction(phieu(SDT.a, chon("id-bat-ky"), { source: "Facebook Ads" }));
    expect(r.ok, r.error).toBe(true);
    const l = (await theoSdt(SDT.a))!;
    expect(l.source).toBe("Facebook Ads");
    expect(l.attribution).toBeNull();
    expect(await db.leadTouchpoint.count({ where: { leadId: l.id } })).toBe(0);
  }, CASE);

  it("[NHH-UI-NL-07] trùng SĐT với lead còn sống ⇒ KHÔNG đổi nguồn gốc (D3 first-claim); chỉ thêm touchpoint kèm nhóm người nhập bấm", async () => {
    expect((await createInternalLeadAction(phieu(SDT.a, chon(nhom.PAID_ADS)))).ok).toBe(true);
    const goc = (await theoSdt(SDT.a))!;
    const lai = await createInternalLeadAction(phieu(SDT.a, chon(nhom.WALK_IN)));
    expect(lai.ok, lai.error).toBe(true);
    expect(lai.duplicate).toBe(true);
    const sau = (await theoSdt(SDT.a))!;
    expect(sau.id).toBe(goc.id);
    expect(sau.attribution!.group.code).toBe("PAID_ADS"); // KHÔNG bị đè
    expect(sau.attribution!.updatedAt.getTime()).toBe(goc.attribution!.updatedAt.getTime());
    const tp = sau.touchpoints.find((t) => t.kind === "NHAP_LAI" || t.kind === "THEM_CON");
    expect(tp).toBeTruthy();
    expect((tp!.signals as { nhomChonId?: string }).nhomChonId).toBe(nhom.WALK_IN);
  }, CASE);

  it("[NHH-UI-NL-08] `epChonNguonChoMaCoSo`: cờ THEO CƠ SỞ (CS2 không ép), phiếu chưa chọn cơ sở dùng cờ TOÀN HỆ; master tắt ⇒ false", async () => {
    expect(await epChonNguonChoMaCoSo("CS1")).toBe(true);
    expect(await epChonNguonChoMaCoSo("CS2")).toBe(false);
    expect(await epChonNguonChoMaCoSo(null)).toBe(false);
    expect(await epChonNguonChoMaCoSo("")).toBe(false);
    expect(await epChonNguonChoMaCoSo("MA-LA")).toBe(false);
    await datCoNguon(CO_NGUON_DAY_DU, { "nguon.epChonNguon": true }); // toàn hệ BẬT
    await datEpChonNguonCoSo(ouCs1, true);
    expect(await epChonNguonChoMaCoSo(null)).toBe(true);
    expect(await epChonNguonChoMaCoSo("")).toBe(true);
    await datCoNguon({}, { "nguon.epChonNguon": true });
    expect(await epChonNguonChoMaCoSo("CS1")).toBe(false); // master tắt thắng
  }, CASE);
});
