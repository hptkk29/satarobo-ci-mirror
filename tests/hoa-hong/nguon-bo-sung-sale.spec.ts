// @vitest-environment node
/**
 * [BSS-DB-*] — NÚT + ACTION «BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH» với RBAC v2 THẬT (Postgres): vai × trạng thái thu tiền × trạng thái nguồn.
 *
 * Luật 12: nút chỉ vẽ khi máy chủ SẼ nhận. Ca then chốt là [BSS-DB-04]: với CÙNG lead, CÙNG người, kết quả «nút» (`moGanNguonAction` → `boSungSale.kieu`)
 * và kết quả «bấm» (`boSungSalePhuHuynhAction`) phải khớp nhau từng trạng thái — nút ẩn ⇒ action từ chối; nút DUOC ⇒ action ghi thật.
 * Mỗi ca «KHÔNG thấy nút» đi kèm đối chứng dương (một vai kia thấy nút) — ca chỉ khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn (CLAUDE.md luật 11).
 *
 *   [BSS-DB-01] CHƯA thu: `leads:overwrite` ⇒ DUOC (SUPER_ADMIN · CENTER_MANAGER); vai chỉ xem/quản lý nguồn ⇒ THIEU_QUYEN kèm khoá `leads:overwrite`
 *   [BSS-DB-02] ĐÃ thu: chỉ `sources:override-after-payment` (SUPER_ADMIN) ⇒ DUOC; QLCS ⇒ THIEU_QUYEN kèm khoá `sources:override-after-payment`
 *   [BSS-DB-03] action theo ma trận: vai DUOC ghi thật (Sale + audit BO_SUNG_NGUOI); vai không ⇒ field `quyen`, 0 ghi
 *   [BSS-DB-04] nguồn ngừng: nút KHÔNG vẽ (NGUON_NGUNG, coTheMoLai theo sources:manage) VÀ action từ chối; mở lại ⇒ cả hai cùng đổi
 *   [BSS-DB-05] sau khi bổ sung: KHONG_CAN; bổ sung lần hai bị chặn (first-claim); nhân sự không có tài khoản / đã nghỉ ⇒ từ chối, 0 ghi
 *   [BSS-DB-06] cách ly cơ sở: QLCS CS1 với lead CS2 ⇒ «Lead không tồn tại», 0 ghi
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: tự dựng tổ chức + vai + danh mục, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { boSungSalePhuHuynhAction, moGanNguonAction } from "../../app/(admin)/admin/leads/nguon-actions";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, type IdNhom } from "../lead-intake/_nguon-fixture";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";

if (!RUN_DB_TESTS) console.warn(`[BSS-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-bss-";
const LY_DO = "fx-bss bổ sung Sale sau khi đối chiếu hồ sơ";

type Vai = { roleDef: string; roleEnum: string; donVi: "HO" | "CS1" | "CS2" };
const VAI = {
  SUPER_ADMIN: { roleDef: "SUPER_ADMIN", roleEnum: "SUPER_ADMIN", donVi: "HO" },
  GIAM_DOC: { roleDef: "GIAM_DOC", roleEnum: "HR", donVi: "HO" },
  HO_ACCOUNTANT: { roleDef: "HO_ACCOUNTANT", roleEnum: "ACCOUNTANT", donVi: "HO" },
  HO_MARKETING: { roleDef: "HO_MARKETING", roleEnum: "MARKETING", donVi: "HO" },
  CENTER_MANAGER: { roleDef: "CENTER_MANAGER", roleEnum: "CENTER_MANAGER", donVi: "CS1" },
} satisfies Record<string, Vai>;
type TenVai = keyof typeof VAI;
// Cả năm vai đều có `sources:view` ⇒ cùng mở được khối Nguồn; khác nhau ở khoá GHI (`leads:overwrite` · `sources:override-after-payment` · `sources:manage`).
const CO_QUYEN_GHI_TRUOC_THU: readonly TenVai[] = ["SUPER_ADMIN", "CENTER_MANAGER"]; // leads:overwrite
const CO_QUYEN_GHI_SAU_THU: readonly TenVai[] = ["SUPER_ADMIN"]; //                    sources:override-after-payment
const TAT_CA = Object.keys(VAI) as TenVai[];

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const lid = leads.map((l) => l.id);
  if (lid.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: lid } } });
    for (const id of lid) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${id}:` } } });
    const dons = await db.order.findMany({ where: { leadId: { in: lid } }, select: { id: true } });
    await db.payment.deleteMany({ where: { orderId: { in: dons.map((o) => o.id) } } });
    await db.order.deleteMany({ where: { leadId: { in: lid } } });
    await db.lead.deleteMany({ where: { id: { in: lid } } });
  }
  await db.auditLog.deleteMany({ where: { reason: { startsWith: "fx-bss" } } });
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const uid = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uid } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: uid } } });
  await db.user.deleteMany({ where: { id: { in: uid } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: "FXBSS" } } });
}

async function dangNhapLa(ten: TenVai): Promise<string> {
  const v: Vai = VAI[ten];
  const email = `${P}${ten.toLowerCase()}@example.test`;
  const centerId = v.donVi === "HO" ? null : (await db.center.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } })).id;
  const cu = await db.user.findMany({ where: { email }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: cu.map((x) => x.id) } } });
  await db.user.deleteMany({ where: { email } });
  const u = await db.user.create({ data: { name: `${P}${ten}`, email, role: v.roleEnum as never, roles: [v.roleEnum as never], centerId, isActive: true }, select: { id: true } });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: v.roleDef }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "fx-bss", effectiveFrom: new Date(Date.now() - 3_600_000), effectiveTo: null, status: "ACTIVE" } });
  SESS.current = { user: { id: u.id, role: v.roleEnum, roles: [v.roleEnum], centerId, name: `${P}${ten}`, email } };
  return u.id;
}

describe.skipIf(!RUN_DB_TESTS)("[BSS-DB] nút + action «Bổ sung Sale phụ trách phụ huynh» — vai × thu tiền × nguồn, RBAC v2 thật", () => {
  let nhom: IdNhom;
  let cs1 = "";
  let cs2 = "";
  let ph = "";
  let saleX = { userId: "", employeeId: "" };
  const truocRbac = process.env.RBAC_V2_ENABLED;

  async function nhanSu(hau: string, o: { coTaiKhoan?: boolean; status?: "ACTIVE" | "RESIGNED" } = {}): Promise<{ userId: string | null; employeeId: string }> {
    const e = await db.employee.create({
      data: { employeeCode: `FXBSS${hau}${Date.now().toString(36)}`.toUpperCase(), fullName: `${P}NV ${hau}`, jobTitle: "Nhân viên", department: "KINH_DOANH", status: o.status ?? "ACTIVE" },
      select: { id: true },
    });
    if (o.coTaiKhoan === false) return { userId: null, employeeId: e.id };
    const u = await db.user.create({
      data: { name: `${P}${hau}`, email: `${P}${hau.toLowerCase()}-${Date.now().toString(36)}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], employeeId: e.id, isActive: true },
      select: { id: true },
    });
    return { userId: u.id, employeeId: e.id };
  }

  /** Lead do PH giới thiệu, CHƯA có Sale phụ trách (đúng hình dạng sinh ra hold `THIEU_SALE_PHU_HUYNH`). */
  async function dungLead(centerId: string, o: { daThu?: boolean; ten?: string } = {}): Promise<string> {
    const l = await db.lead.create({
      data: { parentName: `${P}${o.ten ?? "Lead"}`, phone: `0907${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, status: "MOI", centerId, source: "nhap-tay" },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: nhom.PARENT_REFERRAL,
        originalGroupId: nhom.PARENT_REFERRAL,
        identificationMethod: "MANUAL",
        matchedRule: "KHAI_TAY",
        reasonText: "ca test",
        referrerKind: "PARENT",
        referrerParentUserId: ph,
        referrerSaleUserId: null,
        attributedAt: new Date("2026-08-01T00:00:00.000Z"),
        signals: { coXemTay: true, xemTay: ["THIEU_SALE_PH"] },
      },
    });
    if (o.daThu) {
      const don1 = await db.order.create({
        data: { code: `ORD-BSS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId: l.id },
        select: { id: true },
      });
      await db.payment.create({ data: { orderId: don1.id, amount: 1_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: "CONFIRMED" } });
    }
    return l.id;
  }

  const sale = (leadId: string) => db.leadAttribution.findUniqueOrThrow({ where: { leadId }, select: { referrerSaleUserId: true } }).then((a) => a.referrerSaleUserId);
  const demAudit = (leadId: string) => db.auditLog.count({ where: { entityType: "Lead", entityId: leadId, module: "nguon-hoa-hong" } });
  const bam = (leadId: string, saleEmployeeId = saleX.employeeId) => boSungSalePhuHuynhAction({ leadId, saleEmployeeId, lyDo: LY_DO });
  async function nut(leadId: string) {
    const r = await moGanNguonAction({ leadId });
    if (!r.ok) throw new Error(`moGanNguonAction: ${r.error}`);
    return r.du.boSungSale;
  }
  const datTrangThaiNguon = async (status: "ACTIVE" | "INACTIVE") => {
    await db.leadSourceGroup.update({ where: { id: nhom.PARENT_REFERRAL }, data: { status } });
  };

  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: Object.values(VAI).map((v) => v.roleDef) });
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
    clearSettingsCache();
    const phUser = await db.user.create({ data: { name: `${P}ph`, email: `${P}ph-${Date.now().toString(36)}@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    ph = phUser.id;
    const s = await nhanSu("SALEX");
    saleX = { userId: s.userId!, employeeId: s.employeeId };
    SESS.current = null;
  });

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await db.leadSourceGroup.update({ where: { id: nhom.PARENT_REFERRAL }, data: { status: "ACTIVE" } }).catch(() => {});
    await db.user.deleteMany({ where: { email: { startsWith: P } } }).catch(() => {});
    await don();
    await db.$disconnect();
  }, 120_000);

  it("[BSS-DB-01] CHƯA thu: `leads:overwrite` ⇒ DUOC; vai không có khoá ấy ⇒ THIEU_QUYEN nêu đúng khoá (đối chứng dương: hai vai kia thấy nút)", async () => {
    // Cấy: nút vẽ theo `sources:manage` thay vì `quyenDoiNguon` ⇒ HO_MARKETING thành DUOC (đỏ).
    const lead = await dungLead(cs1);
    const thay: Record<string, string> = {};
    for (const ten of TAT_CA) {
      await dangNhapLa(ten);
      const k = await nut(lead);
      thay[ten] = k.kieu;
      if (CO_QUYEN_GHI_TRUOC_THU.includes(ten)) expect(k, ten).toEqual({ kieu: "DUOC" });
      else expect(k, ten).toMatchObject({ kieu: "THIEU_QUYEN", thieu: ["leads:overwrite"] });
    }
    expect(Object.values(thay).filter((v) => v === "DUOC")).toHaveLength(CO_QUYEN_GHI_TRUOC_THU.length);
  });

  it("[BSS-DB-02] ĐÃ thu: chỉ `sources:override-after-payment` ⇒ DUOC; QLCS (có leads:overwrite) ⇒ THIEU_QUYEN nêu đúng khoá sau-thu", async () => {
    // Cấy: bỏ `daCoThucThu` khi dựng `quyen` ở `docChoGanNguon` ⇒ QLCS thành DUOC (đỏ).
    const lead = await dungLead(cs1, { daThu: true });
    for (const ten of TAT_CA) {
      await dangNhapLa(ten);
      const k = await nut(lead);
      if (CO_QUYEN_GHI_SAU_THU.includes(ten)) expect(k, ten).toEqual({ kieu: "DUOC" });
      else expect(k, ten).toMatchObject({ kieu: "THIEU_QUYEN", thieu: ["sources:override-after-payment"] });
    }
  });

  it("[BSS-DB-03] action theo ma trận: vai DUOC ghi thật (Sale + 1 audit); vai không ⇒ field `quyen`, Sale vẫn null, 0 audit", async () => {
    for (const ten of TAT_CA) {
      const lead = await dungLead(cs1, { ten: `ma-tran-${ten}` });
      await dangNhapLa(ten);
      const r = await bam(lead);
      if (CO_QUYEN_GHI_TRUOC_THU.includes(ten)) {
        expect(r, ten).toMatchObject({ ok: true });
        expect(await sale(lead), ten).toBe(saleX.userId);
        expect(await demAudit(lead), ten).toBe(1);
      } else {
        expect(r, ten).toMatchObject({ ok: false, field: "quyen" });
        expect(await sale(lead), ten).toBeNull();
        expect(await demAudit(lead), ten).toBe(0);
      }
    }
  });

  it("[BSS-DB-04] NÚT ⇔ BẤM trên nguồn ngừng: nút KHÔNG vẽ (NGUON_NGUNG) VÀ action từ chối; mở lại ⇒ nút DUOC VÀ action ghi", async () => {
    // Cấy: bỏ `nguonChonDuoc` khỏi `quyetDinhNutBoSungSale` ⇒ nút vẫn DUOC trên nguồn ngừng trong khi action từ chối (đỏ).
    const lead = await dungLead(cs1);
    await datTrangThaiNguon("INACTIVE");
    await dangNhapLa("SUPER_ADMIN");
    expect(await nut(lead)).toMatchObject({ kieu: "NGUON_NGUNG", maNguon: "PARENT_REFERRAL", lyDo: "TRANG_THAI", coTheMoLai: true });
    expect(await bam(lead)).toMatchObject({ ok: false, field: "nguon" });
    expect(await sale(lead)).toBeNull();
    expect(await demAudit(lead)).toBe(0);
    // QLCS: có leads:overwrite nhưng KHÔNG có sources:manage ⇒ vẫn NGUON_NGUNG, nhưng không mở lại được
    await dangNhapLa("CENTER_MANAGER");
    expect(await nut(lead)).toMatchObject({ coTheMoLai: false });
    // mở lại ⇒ cùng người, cùng lead: nút DUOC và bấm được
    await datTrangThaiNguon("ACTIVE");
    expect(await nut(lead)).toEqual({ kieu: "DUOC" });
    expect(await bam(lead)).toMatchObject({ ok: true });
    expect(await sale(lead)).toBe(saleX.userId);
  });

  it("[BSS-DB-05] sau khi bổ sung: KHONG_CAN; bổ sung lần hai bị chặn (first-claim); nhân sự KHÔNG có tài khoản / đã nghỉ ⇒ từ chối, 0 ghi", async () => {
    const lead = await dungLead(cs1);
    await dangNhapLa("SUPER_ADMIN");
    const khongTk = await nhanSu("KHONGTK", { coTaiKhoan: false });
    const nghi = await nhanSu("NGHI", { status: "RESIGNED" });
    // Cấy: bỏ nhánh `u?.id ?? KHONG_CO_TAI_KHOAN` (đưa employeeId thẳng làm userId) ⇒ vẫn từ chối nhưng sai câu — ca này khoá cả câu.
    for (const e of [khongTk.employeeId, nghi.employeeId]) {
      const r = await bam(lead, e);
      expect(r, e).toMatchObject({ ok: false, field: "thamChieu" });
      expect(r.ok === false && r.error).toContain("không còn làm việc hoặc không có hồ sơ nhân sự");
    }
    expect(await sale(lead)).toBeNull();
    expect(await demAudit(lead)).toBe(0);

    expect(await bam(lead)).toMatchObject({ ok: true });
    expect(await nut(lead)).toEqual({ kieu: "KHONG_CAN" });
    const khac = await nhanSu("KHAC");
    expect(await bam(lead, khac.employeeId)).toMatchObject({ ok: false, field: "thamChieu" });
    expect(await sale(lead)).toBe(saleX.userId);
    expect(await demAudit(lead)).toBe(1);
  });

  it("[BSS-DB-06] cách ly cơ sở: QLCS CS1 với lead CS2 ⇒ «Lead không tồn tại» (nút lẫn action), 0 ghi; đối chứng dương: lead CS1 của chính họ làm được", async () => {
    const leadCs2 = await dungLead(cs2, { ten: "cs2" });
    const leadCs1 = await dungLead(cs1, { ten: "cs1" });
    await dangNhapLa("CENTER_MANAGER");
    expect(await moGanNguonAction({ leadId: leadCs2 })).toEqual({ ok: false, error: "Lead không tồn tại." });
    expect(await bam(leadCs2)).toEqual({ ok: false, error: "Lead không tồn tại.", field: "lead" });
    expect(await sale(leadCs2)).toBeNull();
    expect(await demAudit(leadCs2)).toBe(0);
    expect(await nut(leadCs1)).toEqual({ kieu: "DUOC" });
    expect(await bam(leadCs1)).toMatchObject({ ok: true });
  });
});
