// @vitest-environment node
/**
 * [NHH-H-PERM-*] — MA TRẬN QUYỀN (vai × Server Action) của tab Chính sách + tab Nguồn, chạy THẬT: session giả CHỈ ở `auth()`, còn `assertPermission` /
 * `checkPermission` → `can()` v2 → `resolveActor` → `UserOrgRole` → `RoleDef` đều đọc POSTGRES (cờ `RBAC_V2_ENABLED=true` như prod).
 *
 * Vì sao cần, khi đã có `_actions.test.ts` + `nguon-actions` ca riêng: các ca cũ kiểm TỪNG action với một–hai vai (mock `assertPermission`, hoặc Sale/QLCS
 * + Marketing). Chưa ca nào hỏi «với MỌI vai, action X cho qua đúng những người ma trận 05 §1.3 nói, và những người còn lại bị chặn mà KHÔNG ghi gì, KHÔNG
 * lộ id có tồn tại hay không». Lớp lỗi này câm: một vai bị cấp thừa `activate` không làm ca nào đỏ, chỉ làm một người soạn tự kích hoạt chính sách của mình.
 *
 * Quy tắc mỗi ca:
 *   · MA TRẬN GÕ TAY (không suy từ `ROLE_SEED`) — đổi ai-được-gì thì sửa ở đây VÀ ở 05 §1.3 cùng lúc;
 *   · mỗi action quét ĐỦ danh sách vai: vai được ⇒ thao tác thành công VÀ có hiệu ứng thật trong DB (đối chứng dương); vai không được ⇒ `ok:false`,
 *     câu NÊU khoá quyền, DB KHÔNG đổi, và kết quả cho id THẬT == kết quả cho id KHÔNG TỒN TẠI (không lộ tồn tại);
 *   · «chặn ở đầu hàm»: deny xảy ra TRƯỚC khi chạm DB (cùng kết quả dù id có thật hay không là bằng chứng).
 *
 * Chạy: `pnpm test:hoa-hong-db`. Mỗi ca tự dựng người dùng + hiện trường (luật 18); ngày TUYỆT ĐỐI (luật 19) — riêng `kichHoatAction` đọc đồng hồ thật nên
 * dùng văn bản có hiệu lực 23/03/2026 (đã qua ở mọi lần chạy).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
// Kho công khai R2 giả: `luuNhap` đòi url tệp đính kèm = <gốc công khai>/<key>.
vi.mock("@/lib/storage/r2-client", () => ({ getR2PublicUrl: () => "https://cdn.fx.test" }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { formRong, type FormChinhSach } from "../../lib/hoa-hong/chinh-sach-form";
import { luuNhap } from "../../lib/hoa-hong/chinh-sach-hanh-dong";
import { taoChinhSachFx } from "./_kich-ban";
import { huyNhapAction, kichHoatAction, kiemHangRaoAction, luuNhapAction } from "../../app/(admin)/admin/nguon-hoa-hong/chinh-sach/_actions";
import { doiTrangThaiNguonAction, luuPageMappingAction, suaNguonAction, taoNguonAction } from "../../app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { doiNguonLeadAction, moGanNguonAction, timNguoiGioiThieuAction } from "../../app/(admin)/admin/leads/nguon-actions";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, type IdNhom } from "../lead-intake/_nguon-fixture";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";

if (!RUN_DB_TESTS) console.warn(`[NHH-H-PERM] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-hperm-";
const GOC_KHO = "https://cdn.fx.test";
const KEY_PAGE = "nguon.bangNguonTheoPage";
const KEY_ENGINE = "hoaHong.engineBat";

/** Đặt cờ engine hoa hồng (cờ gác tab Chính sách). Chuỗi khoá THÔ có chủ đích: lưới [NHH-FLG-11b] cấm ở lib/app/components, KHÔNG cấm ở tests. */
async function datEngine(bat: boolean | null): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: KEY_ENGINE } });
  if (bat !== null) await db.systemSetting.create({ data: { key: KEY_ENGINE, valueJson: bat } });
  clearSettingsCache();
}

// ── Vai ───────────────────────────────────────────────────────────────────────────────────────────

type Vai = { roleDef: string; roleEnum: string; donVi: "HO" | "CS1" | "CS2" | null };
/** `roleEnum` chỉ để thoả cột `User.role` (NOT NULL): với `RBAC_V2_ENABLED=true` quyền đọc từ `UserOrgRole`, KHÔNG đọc cột này. */
const VAI = {
  SUPER_ADMIN: { roleDef: "SUPER_ADMIN", roleEnum: "SUPER_ADMIN", donVi: "HO" },
  GIAM_DOC: { roleDef: "GIAM_DOC", roleEnum: "HR", donVi: "HO" },
  HO_ACCOUNTANT: { roleDef: "HO_ACCOUNTANT", roleEnum: "ACCOUNTANT", donVi: "HO" },
  HO_HR: { roleDef: "HO_HR", roleEnum: "HR", donVi: "HO" },
  HO_MARKETING: { roleDef: "HO_MARKETING", roleEnum: "MARKETING", donVi: "HO" },
  HO_SALE: { roleDef: "HO_SALE", roleEnum: "SALES_CSM", donVi: "HO" },
  CENTER_MANAGER: { roleDef: "CENTER_MANAGER", roleEnum: "CENTER_MANAGER", donVi: "CS1" },
  CENTER_SALES_CSM: { roleDef: "CENTER_SALES_CSM", roleEnum: "SALES_CSM", donVi: "CS1" },
  CENTER_ACCOUNTANT: { roleDef: "CENTER_ACCOUNTANT", roleEnum: "ACCOUNTANT", donVi: "CS1" },
  TRAINING: { roleDef: "TRAINING", roleEnum: "TRAINING", donVi: "CS1" },
  TEACHER: { roleDef: "TEACHER", roleEnum: "TEACHER", donVi: "CS1" },
  /** Vai QUAN HỆ: không đứng ở đâu trong cây, quyền nạp thẳng từ RoleDef theo `User.roles`. */
  PARENT: { roleDef: "PARENT", roleEnum: "PARENT", donVi: null },
} satisfies Record<string, Vai>;
type TenVai = keyof typeof VAI;
const TAT_CA_VAI = Object.keys(VAI) as TenVai[];

/** MA TRẬN GÕ TAY — 05 §1.3 (+ `leads:create` có sẵn cho ô chọn người). Khoá = action, giá trị = những vai ĐƯỢC. */
const DUOC = {
  luuNhap: ["SUPER_ADMIN", "HO_HR"], //                                       commission_policies:manage
  huyNhap: ["SUPER_ADMIN", "HO_HR"], //                                       commission_policies:manage
  kichHoat: ["SUPER_ADMIN", "GIAM_DOC"], //                                   commission_policies:activate (HO_HR soạn được nhưng KHÔNG kích hoạt được)
  kiemHangRao: ["SUPER_ADMIN", "GIAM_DOC", "HO_ACCOUNTANT", "HO_HR", "HO_MARKETING", "CENTER_MANAGER"], // commission_policies:view
  luuPage: ["SUPER_ADMIN", "HO_MARKETING"], //                                sources:manage
  taoNguon: ["SUPER_ADMIN", "HO_MARKETING"], //                               sources:manage (SPEC nguồn động §4 — ghi danh mục nguồn)
  suaNguon: ["SUPER_ADMIN", "HO_MARKETING"], //                               sources:manage
  doiTrangThaiNguon: ["SUPER_ADMIN", "HO_MARKETING"], //                      sources:manage
  moGanNguon: ["SUPER_ADMIN", "GIAM_DOC", "HO_ACCOUNTANT", "HO_MARKETING", "CENTER_MANAGER"], // sources:view
  timNguoi: ["SUPER_ADMIN", "HO_MARKETING", "HO_SALE", "CENTER_MANAGER", "CENTER_SALES_CSM"], // 1 trong: leads:create · leads:overwrite · sources:override-after-payment · sources:manage
  doiNguon: ["SUPER_ADMIN", "CENTER_MANAGER"], //                             leads:overwrite (kèm đối tượng lead)
  doiNguonSauThu: ["SUPER_ADMIN"], //                                         sources:override-after-payment
} as const satisfies Record<string, readonly TenVai[]>;

// ── Hiện trường ───────────────────────────────────────────────────────────────────────────────────

async function don(): Promise<void> {
  const cs = await db.commissionPolicy.findMany({ where: { policyCode: { startsWith: P } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.commissionRule.deleteMany({ where: { version: { policyId: { in: ids } } } });
  await db.commissionPolicyVersion.deleteMany({ where: { policyId: { in: ids } } });
  await db.commissionPolicy.deleteMany({ where: { id: { in: ids } } });
  await db.regulationDocument.deleteMany({ where: { documentCode: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorName: { startsWith: P } }, { reason: { startsWith: "fx-hperm" } }] } });

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
  await db.facebookPageMapping.deleteMany({ where: { pageId: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "FXHPERM_" } } });
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const uid = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uid } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: uid } } });
  await db.user.deleteMany({ where: { id: { in: uid } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

/** Dựng người dùng THẬT mang đúng MỘT vai, đặt làm phiên hiện tại. Trả `userId`. */
async function dangNhapLa(
  ten: TenVai,
  tuyChon: { effectiveTo?: Date | null; effectiveFrom?: Date; status?: "ACTIVE" | "SUSPENDED" | "EXPIRED"; khongGanVai?: boolean } = {},
): Promise<string> {
  const v: Vai = VAI[ten];
  const email = `${P}${ten.toLowerCase()}@example.test`;
  const centerId = v.donVi === null || v.donVi === "HO" ? null : (await db.center.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } })).id;
  const cu = await db.user.findMany({ where: { email }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: cu.map((x) => x.id) } } });
  await db.user.deleteMany({ where: { email } });
  const u = await db.user.create({
    data: { name: `${P}${ten}`, email, role: v.roleEnum as never, roles: [v.roleEnum as never], centerId, isActive: true },
    select: { id: true },
  });
  if (v.donVi !== null && tuyChon.khongGanVai !== true) {
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } });
    const role = await db.roleDef.findUniqueOrThrow({ where: { code: v.roleDef }, select: { id: true } });
    // lùi 1 giờ: đồng hồ DB có thể đi TRƯỚC Node (luật 19 — fixture phải rộng hơn độ lệch).
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "fx-hperm", effectiveFrom: tuyChon.effectiveFrom ?? new Date(Date.now() - 3_600_000), effectiveTo: tuyChon.effectiveTo ?? null, status: tuyChon.status ?? "ACTIVE" } });
  }
  SESS.current = { user: { id: u.id, role: v.roleEnum, roles: [v.roleEnum], centerId, name: `${P}${ten}`, email } };
  return u.id;
}

let seq = 0;
const ma = () => `${P}${Date.now().toString(36)}-${(seq += 1)}`;

/** Form HỢP LỆ đủ để kích hoạt: một vai SALE 4%, văn bản mới CÓ TỆP, hiệu lực đúng ngày thứ 15 làm việc sau công bố. */
const formDu = (code = ma()): FormChinhSach => ({
  ...formRong(),
  policyCode: code,
  name: "Ma trận quyền fixture",
  loaiGd: ["NEW"],
  vai: ["SALE"],
  o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" } },
  vanBan: {
    kieu: "moi",
    documentCode: ma(),
    title: "Quy định fixture",
    issuedOn: "2026-02-20",
    publishedOn: "2026-03-02",
    effectiveOn: "2026-03-23",
    approvedByName: "Hồ Đắc Phúc",
    tep: { key: "uploads/documents/2026-10/fx-ab12cd34.pdf", ten: "fx.pdf", url: `${GOC_KHO}/uploads/documents/2026-10/fx-ab12cd34.pdf` },
  },
  hieuLucTu: "2026-03-23",
  hieuLucDen: "",
  lyDo: "fx-hperm SR.QD.fixture",
});

/** Một bản nháp thật, do SUPER_ADMIN (actor THẬT từ DB) soạn bằng hàm lưu của lib — không qua action, để không phụ thuộc cái đang kiểm. */
async function nhapMau(chuSoHuuOrgUnitId: string | null = null): Promise<{ versionId: string; policyId: string; updatedAt: string; code: string }> {
  const truoc = SESS.current;
  const adminId = await dangNhapLa("SUPER_ADMIN");
  const actor = await resolveActorUncached(adminId);
  const form = { ...formDu(), chuSoHuuOrgUnitId };
  const r = await luuNhap({ actor, nguoi: { userId: adminId, ten: `${P}fixture` }, now: new Date("2026-10-08T03:00:00.000Z"), vao: { form, policyId: null, versionId: null, updatedAtDaThay: null } });
  SESS.current = truoc;
  if (!r.ok) throw new Error(`nhapMau: ${r.chung ?? JSON.stringify(r.loi)}`);
  return { versionId: r.versionId, policyId: r.policyId, updatedAt: r.updatedAt, code: form.policyCode };
}

const trangThai = async (versionId: string) => (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true } })).status;
const demChinhSach = () => db.commissionPolicy.count({ where: { policyCode: { startsWith: P } } });
const demVanBan = () => db.regulationDocument.count({ where: { documentCode: { startsWith: P } } });
const demAuditChinhSach = () => db.auditLog.count({ where: { entityType: { in: ["CommissionPolicy", "CommissionPolicyVersion", "RegulationDocument"] }, actorName: { startsWith: P } } });

describe.skipIf(!RUN_DB_TESTS)("[NHH-H-PERM] ma trận quyền vai × Server Action — Postgres thật, RBAC v2 thật", () => {
  let nhom: IdNhom;
  let cs1 = "";
  let cs2 = "";
  const truocRbac = process.env.RBAC_V2_ENABLED;

  async function dungLead(centerId: string, ten = "Lead"): Promise<string> {
    const l = await db.lead.create({
      data: { parentName: `${P}${ten}`, phone: `0907${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, status: "MOI", centerId, source: "nhap-tay" },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: nhom.PAID_ADS,
        originalGroupId: nhom.PAID_ADS,
        identificationMethod: "SYSTEM_DEFAULT",
        matchedRule: "DUONG_VAO_MAC_DINH",
        reasonText: "ca test",
        attributedAt: new Date("2026-08-01T00:00:00.000Z"),
        signals: { duongVao: "nhap-tay" },
      },
    });
    return l.id;
  }
  async function dungDonDaThu(leadId: string): Promise<void> {
    const o = await db.order.create({
      data: { code: `ORD-HPERM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId },
      select: { id: true },
    });
    await db.payment.create({ data: { orderId: o.id, amount: 1_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: "CONFIRMED" } });
  }
  const nhomCua = async (leadId: string) => (await db.leadAttribution.findUniqueOrThrow({ where: { leadId }, include: { group: { select: { code: true } } } })).group.code;
  const demAuditLead = (leadId: string) => db.auditLog.count({ where: { entityType: "Lead", entityId: leadId, module: "nguon-hoa-hong" } });

  beforeAll(async () => {
    assertTestDb();
    // Tự dựng tổ chức + vai (luật 18): bộ này chạy được một mình trên DB trống đã migrate.
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: Object.values(VAI).map((v) => v.roleDef) });
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
    await datEngine(true);
    SESS.current = null;
  });

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await don();
    await datEngine(null);
    await db.$disconnect();
  }, 120_000);

  it("[NHH-H-PERM-00] tự kiểm: ma trận gõ tay chỉ nêu vai CÓ trong danh sách; mỗi action có cả vai được lẫn vai không được (không ca nào chỉ có một phía)", async () => {
    for (const [action, ds] of Object.entries(DUOC)) {
      for (const v of ds) expect(TAT_CA_VAI, `${action}: ${v}`).toContain(v);
      expect(ds.length, action).toBeGreaterThan(0);
      expect(ds.length, action).toBeLessThan(TAT_CA_VAI.length);
    }
    // Mọi RoleDef mà ma trận nhắc đều CÓ trong DB (thiếu vai ⇒ ca "deny" xanh vì lý do sai: người dùng không có vai nào).
    const co = new Set((await db.roleDef.findMany({ where: { code: { in: Object.values(VAI).map((v) => v.roleDef) } }, select: { code: true } })).map((r) => r.code));
    expect([...co].sort()).toEqual(Object.values(VAI).map((v) => v.roleDef).sort());
  });

  // ═════ TAB CHÍNH SÁCH ═════════════════════════════════════════════════════════════════════════

  it("[NHH-H-PERM-01] luuNhapAction (commission_policies:manage): SUPER_ADMIN + HO_HR tạo được bản nháp thật; mọi vai khác bị chặn, 0 chính sách / 0 văn bản / 0 audit mới", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      await dangNhapLa(ten);
      const truocCs = await demChinhSach();
      const truocVb = await demVanBan();
      const truocAudit = await demAuditChinhSach();
      const form = formDu();
      const r = await luuNhapAction({ form, policyId: null, versionId: null, updatedAtDaThay: null });
      if ((DUOC.luuNhap as readonly TenVai[]).includes(ten)) {
        expect(r, `${ten} phải tạo được`).toMatchObject({ ok: true });
        expect(await demChinhSach(), ten).toBe(truocCs + 1);
        expect((await db.commissionPolicy.findUniqueOrThrow({ where: { policyCode: form.policyCode } })).policyCode).toBe(form.policyCode);
      } else {
        expect(r, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect((r as { chung: string }).chung, ten).toContain("commission_policies:manage");
        expect(await demChinhSach(), `${ten}: không được tạo chính sách`).toBe(truocCs);
        expect(await demVanBan(), `${ten}: không được tạo văn bản`).toBe(truocVb);
        expect(await demAuditChinhSach(), `${ten}: không được ghi audit`).toBe(truocAudit);
      }
    }
  });

  it("[NHH-H-PERM-02] huyNhapAction (commission_policies:manage): SUPER_ADMIN + HO_HR huỷ được nháp; vai khác bị chặn, nháp VẪN DRAFT; id thật == id không tồn tại (không lộ tồn tại)", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      const mau = await nhapMau();
      await dangNhapLa(ten);
      if ((DUOC.huyNhap as readonly TenVai[]).includes(ten)) {
        const r = await huyNhapAction({ versionId: mau.versionId, lyDo: "fx-hperm huỷ nháp thử quyền" });
        expect(r, `${ten} phải huỷ được`).toMatchObject({ ok: true });
        expect(await trangThai(mau.versionId), ten).toBe("CANCELLED");
      } else {
        const that = await huyNhapAction({ versionId: mau.versionId, lyDo: "fx-hperm huỷ nháp thử quyền" });
        const gia = await huyNhapAction({ versionId: "khong-co-ban-nhap-nay", lyDo: "fx-hperm huỷ nháp thử quyền" });
        expect(that, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect((that as { chung: string }).chung, ten).toContain("commission_policies:manage");
        expect(that, `${ten}: id thật phải cho CÙNG kết quả với id không tồn tại`).toEqual(gia);
        expect(await trangThai(mau.versionId), `${ten}: nháp không được đổi`).toBe("DRAFT");
      }
    }
  });

  it("[NHH-H-PERM-03] kichHoatAction (commission_policies:activate): CHỈ SUPER_ADMIN + GIAM_DOC; HO_HR (soạn được) KHÔNG kích hoạt được; vai khác bị chặn, nháp VẪN DRAFT", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      const mau = await nhapMau();
      await dangNhapLa(ten);
      const vao = { versionId: mau.versionId, xacNhanLyDo: "fx-hperm kích hoạt thử quyền", updatedAtDaThay: mau.updatedAt };
      if ((DUOC.kichHoat as readonly TenVai[]).includes(ten)) {
        const r = await kichHoatAction(vao);
        expect(r, `${ten} phải kích hoạt được`).toMatchObject({ ok: true });
        expect(await trangThai(mau.versionId), ten).toBe("ACTIVE");
      } else {
        const that = await kichHoatAction(vao);
        const gia = await kichHoatAction({ ...vao, versionId: "khong-co-ban-nhap-nay" });
        expect(that, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect((that as { chung: string }).chung, ten).toContain("commission_policies:activate");
        expect(that, `${ten}: id thật phải cho CÙNG kết quả với id không tồn tại`).toEqual(gia);
        expect(await trangThai(mau.versionId), `${ten}: nháp không được đổi`).toBe("DRAFT");
      }
    }
  });

  it("[NHH-H-PERM-04] kiemHangRaoAction (commission_policies:view): 6 vai xem được; vai khác bị chặn và KHÔNG nhận hàng rào của nháp; id thật == id không tồn tại", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      const mau = await nhapMau(); // nháp của HỘI SỞ: chính sách Hội sở hiện ra ở mọi cơ sở (NULL_IS_GLOBAL) — HD-08/HD-21
      await dangNhapLa(ten);
      const that = await kiemHangRaoAction(mau.versionId);
      if ((DUOC.kiemHangRao as readonly TenVai[]).includes(ten)) {
        expect(that, `${ten} phải xem được`).toMatchObject({ ok: true });
      } else {
        const gia = await kiemHangRaoAction("khong-co-ban-nhap-nay");
        expect(that, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect((that as { chung: string }).chung, ten).toContain("commission_policies:view");
        expect(that, `${ten}: id thật phải cho CÙNG kết quả với id không tồn tại`).toEqual(gia);
        expect(that, `${ten}: không được lộ hàng rào`).not.toHaveProperty("hangRao");
      }
    }
  });

  it("[NHH-H-PERM-04b] có quyền xem ≠ thấy mọi nháp: nháp thuộc CS2 — QLCS CS1 (có commission_policies:view) nhận CÙNG câu với id không tồn tại; Kế toán HO thấy (đối chứng dương)", async () => {
    const cs2Ou = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    const mau = await nhapMau(cs2Ou);
    await dangNhapLa("HO_ACCOUNTANT");
    expect(await kiemHangRaoAction(mau.versionId), "HO thấy nháp CS2").toMatchObject({ ok: true });
    await dangNhapLa("CENTER_MANAGER");
    const that = await kiemHangRaoAction(mau.versionId);
    const gia = await kiemHangRaoAction("khong-co-ban-nhap-nay");
    expect(that).toMatchObject({ ok: false });
    expect(that, "id thật của cơ sở khác phải cho CÙNG kết quả với id không tồn tại").toEqual(gia);
    expect(JSON.stringify(that), "không phải câu thiếu quyền (QLCS CÓ quyền xem)").not.toContain("commission_policies:view");
    // Huỷ / kích hoạt cũng không chạm được nháp CS2 dù có quyền hành động ở cơ sở khác: HO_HR có manage nhưng đây là bài của HD-09; ở đây chỉ canh cổng quyền ĐỨNG TRƯỚC.
  });

  // ═════ TAB NGUỒN ══════════════════════════════════════════════════════════════════════════════

  it("[NHH-H-PERM-05] luuPageMappingAction (sources:manage): SUPER_ADMIN + HO_MARKETING lưu được; vai khác bị chặn (field 'quyen'), bảng nguồn-theo-Page KHÔNG đổi", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      const pageId = `${P}page-${ten.toLowerCase()}`;
      await db.facebookPageMapping.create({ data: { pageId, pageName: `${P}Page ${ten}`, scopeType: "HO", centerId: null, isActive: true } });
      await dangNhapLa(ten);
      const r = await luuPageMappingAction({ pageId, groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" });
      const bang = ((await db.systemSetting.findUnique({ where: { key: KEY_PAGE } }))?.valueJson ?? {}) as Record<string, unknown>;
      if ((DUOC.luuPage as readonly TenVai[]).includes(ten)) {
        expect(r, `${ten} phải lưu được`).toMatchObject({ ok: true });
        expect(bang[pageId], ten).toEqual({ groupCode: "PAID_ADS" });
      } else {
        expect(r, `${ten} phải bị chặn`).toMatchObject({ ok: false, field: "quyen" });
        expect((r as { error: string }).error, ten).toContain("sources:manage");
        expect(bang[pageId], `${ten}: bảng không được đổi`).toBeUndefined();
      }
    }
  });

  const TAO_NGUON_MAU = {
    name: "Nguồn ma trận",
    description: null,
    sourceType: "MARKETING",
    referrerRequirement: "NONE",
    requiresNote: false,
    selectable: true,
    sortOrder: 300,
    trangThai: "ACTIVE",
    attributionWindowDays: null,
    commissionEnabled: false,
    ownerOrgUnitId: null,
    ownerEmployeeId: null,
    effectiveFrom: null,
    effectiveTo: null,
  } as const;

  it("[NHH-H-PERM-05b] taoNguonAction / suaNguonAction / doiTrangThaiNguonAction (sources:manage): SUPER_ADMIN + HO_MARKETING GHI được (có hiệu ứng thật trong DB + audit); vai khác bị chặn (field 'quyen'), DB và audit KHÔNG đổi; id thật == id không tồn tại", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      const mau = await db.leadSourceGroup.create({ data: { code: `FXHPERM_M_${ten}`, name: `Mẫu ${ten}`, sortOrder: 400, status: "ACTIVE", sourceType: "MARKETING" } });
      await dangNhapLa(ten);
      const code = `FXHPERM_T_${ten}`;
      const demNhom = () => db.leadSourceGroup.count({ where: { code: { startsWith: "FXHPERM_" } } });
      const demAuditNguon = () => db.auditLog.count({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: P } } });
      const truoc = { nhom: await demNhom(), audit: await demAuditNguon() };

      const tao = await taoNguonAction({ vao: { ...TAO_NGUON_MAU, code } });
      const sua = await suaNguonAction({ id: mau.id, updatedAtDaThay: mau.updatedAt.toISOString(), vao: { name: "Đã sửa" }, lyDo: null });
      const doiThat = await doiTrangThaiNguonAction({ id: mau.id, updatedAtDaThay: (sua.ok ? sua.updatedAt : mau.updatedAt.toISOString()), den: "INACTIVE", lyDo: "fx-hperm ngừng thử quyền" });
      const suaGia = await suaNguonAction({ id: "khong-co-nguon-nay", updatedAtDaThay: mau.updatedAt.toISOString(), vao: { name: "Đã sửa" }, lyDo: null });
      const doiGia = await doiTrangThaiNguonAction({ id: "khong-co-nguon-nay", updatedAtDaThay: mau.updatedAt.toISOString(), den: "INACTIVE", lyDo: "fx-hperm ngừng thử quyền" });
      const hang = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: mau.id } });

      if ((DUOC.taoNguon as readonly TenVai[]).includes(ten)) {
        expect(tao, `${ten} phải tạo được`).toMatchObject({ ok: true, code });
        expect(sua, `${ten} phải sửa được`).toMatchObject({ ok: true, doi: true });
        expect(doiThat, `${ten} phải đổi trạng thái được`).toMatchObject({ ok: true, den: "INACTIVE" });
        expect(hang).toMatchObject({ name: "Đã sửa", status: "INACTIVE" });
        expect(await db.leadSourceGroup.count({ where: { code } })).toBe(1);
        expect(await demNhom(), ten).toBe(truoc.nhom + 1);
        expect(await demAuditNguon(), `${ten}: tạo + sửa + ngừng = 3 audit`).toBe(truoc.audit + 3);
        // người có quyền nhận lỗi RIÊNG của id không có (khác lỗi quyền) — đối chứng cho nhánh từ chối bên dưới
        expect(suaGia).toMatchObject({ ok: false, field: "khongTimThay" });
        expect(doiGia).toMatchObject({ ok: false, field: "khongTimThay" });
      } else {
        for (const [tenAc, r] of Object.entries({ tao, sua, doiThat })) {
          expect(r, `${ten}: ${tenAc} phải bị chặn`).toMatchObject({ ok: false, field: "quyen" });
          expect((r as { error: string }).error, `${ten}: ${tenAc}`).toContain("sources:manage");
        }
        expect(await db.leadSourceGroup.count({ where: { code } }), `${ten}: không được tạo nguồn`).toBe(0);
        expect(hang).toMatchObject({ name: `Mẫu ${ten}`, status: "ACTIVE" });
        expect(await demNhom()).toBe(truoc.nhom);
        expect(await demAuditNguon(), `${ten}: không được ghi audit`).toBe(truoc.audit);
        // không lộ tồn tại: id thật == id giả
        expect(JSON.stringify(suaGia)).toBe(JSON.stringify(await suaNguonAction({ id: mau.id, updatedAtDaThay: mau.updatedAt.toISOString(), vao: { name: "Đã sửa" }, lyDo: null })));
        expect(JSON.stringify(doiGia)).toBe(JSON.stringify(await doiTrangThaiNguonAction({ id: mau.id, updatedAtDaThay: mau.updatedAt.toISOString(), den: "INACTIVE", lyDo: "fx-hperm ngừng thử quyền" })));
      }
    }
  });

  it("[NHH-H-PERM-05d] đổi người nhận tiền (cửa sổ · chủ nguồn · tham gia hoa hồng) của nguồn ĐANG DÍNH TIỀN: sources:manage KHÔNG đủ — cần thêm commission_policies:activate (SUPER_ADMIN có, HO_MARKETING không); đổi tên và nguồn chưa dính tiền thì chỉ cần sources:manage", async () => {
    // Cấy: action truyền `coQuyenKichHoat: true` cứng ⇒ HO_MARKETING đổi được cửa sổ của nguồn đang chạy chính sách (đỏ). Cấy: cổng bỏ vế chính sách ACTIVE ⇒ nguồn dính tiền lọt (đỏ).
    await don();
    await datCoNguon(CO_NGUON_DAY_DU);
    const mau = { sortOrder: 400, status: "ACTIVE" as const, sourceType: "MARKETING" as const, commissionEnabled: true };
    const dinh = await db.leadSourceGroup.create({ data: { code: "FXHPERM_G_DINH", name: "Nguồn dính tiền", ...mau } });
    const trong = await db.leadSourceGroup.create({ data: { code: "FXHPERM_G_TRONG", name: "Nguồn chưa dính tiền", ...mau } });
    await taoChinhSachFx(`${P}gate`, [{ vai: "MARKETING", rate: 0.01 }], 1, undefined, "2026-03-20T17:00:00.000Z", { loai: "SOURCE_GROUP", sourceGroupId: dinh.id });
    const moi = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt.toISOString();
    const sua = async (id: string, vao: Record<string, unknown>) => suaNguonAction({ id, updatedAtDaThay: await moi(id), vao, lyDo: "fx-hperm đổi thử quyền kích hoạt" });
    const demAudit = () => db.auditLog.count({ where: { entityType: "LeadSourceGroup", reason: { startsWith: "fx-hperm" } } });

    await dangNhapLa("HO_MARKETING");
    const a0 = await demAudit();
    const chan = await sua(dinh.id, { attributionWindowDays: 30 });
    expect(chan, "cửa sổ").toMatchObject({ ok: false, field: "quyen" });
    expect((chan as { error: string }).error).toContain("commission_policies:activate");
    // W2 (R1-M1): TẮT «tham gia hoa hồng» khi chính sách riêng có dòng THU HÚT bị chặn TUYỆT ĐỐI (kể cả SUPER_ADMIN) — cổng này đứng TRƯỚC cổng quyền nên nói thẳng việc cần làm, không bảo đi xin quyền
    const tat = await sua(dinh.id, { commissionEnabled: false });
    expect(tat, "tắt cờ").toMatchObject({ ok: false, field: "commissionEnabled" });
    expect((tat as { error: string }).error).toContain("thu hút");
    // …còn chính sách chỉ gồm dòng EXCLUDE thì tắt được về mặt luật ⇒ lúc đó mới là chuyện QUYỀN
    const chiLoaiTru = await db.leadSourceGroup.create({ data: { code: "FXHPERM_G_LOAITRU", name: "Nguồn chỉ có dòng loại trừ", ...mau } });
    await taoChinhSachFx(`${P}gate-lt`, [{ vai: "MARKETING", kieu: "EXCLUDE" }], 1, undefined, "2026-03-20T17:00:00.000Z", { loai: "SOURCE_GROUP", sourceGroupId: chiLoaiTru.id });
    expect(await sua(chiLoaiTru.id, { commissionEnabled: false }), "EXCLUDE-only + thiếu quyền").toMatchObject({ ok: false, field: "quyen" });
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: dinh.id } })).toMatchObject({ attributionWindowDays: null, commissionEnabled: true });
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: chiLoaiTru.id } })).toMatchObject({ commissionEnabled: true });
    expect(await demAudit(), "bị chặn ⇒ 0 audit").toBe(a0);

    // đối chứng dương 1: CÙNG người, CÙNG nguồn dính tiền, đổi TÊN ⇒ qua (sources:manage đủ)
    expect(await sua(dinh.id, { name: "Nguồn dính tiền (đổi tên)" })).toMatchObject({ ok: true, doi: true });
    // đối chứng dương 2: CÙNG người, nguồn CHƯA dính tiền, đổi cửa sổ ⇒ qua
    expect(await sua(trong.id, { attributionWindowDays: 30 })).toMatchObject({ ok: true, doi: true });

    // đối chứng dương 3: người có quyền kích hoạt đổi cửa sổ nguồn dính tiền ⇒ qua + audit ghi cũ→mới
    await dangNhapLa("SUPER_ADMIN");
    expect(await sua(dinh.id, { attributionWindowDays: 30 })).toMatchObject({ ok: true, doi: true });
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "LeadSourceGroup", entityId: dinh.id, action: "NGUON_DOI_CUA_SO" } });
    expect(a.oldValues).toMatchObject({ attributionWindowDays: null });
    expect(a.newValues).toMatchObject({ attributionWindowDays: 30 });
  });

  it("[NHH-H-PERM-05c] cờ nguồn TẮT ⇒ ba action ghi danh mục đóng dù ĐỦ QUYỀN, không ghi gì; KHÔNG phiên ⇒ cũng đóng; bật lại + có phiên ⇒ cùng lời gọi thành công (đối chứng dương)", async () => {
    const mau = await db.leadSourceGroup.create({ data: { code: "FXHPERM_CO", name: "Mẫu cờ", sortOrder: 400, status: "ACTIVE", sourceType: "MARKETING" } });
    const lanGoi = async () => ({
      tao: await taoNguonAction({ vao: { ...TAO_NGUON_MAU, code: "FXHPERM_CO_MOI" } }),
      sua: await suaNguonAction({ id: mau.id, updatedAtDaThay: mau.updatedAt.toISOString(), vao: { name: "Sửa khi cờ" }, lyDo: null }),
      doi: await doiTrangThaiNguonAction({ id: mau.id, updatedAtDaThay: mau.updatedAt.toISOString(), den: "INACTIVE", lyDo: "fx-hperm ngừng khi cờ" }),
    });
    const nguyenTrang = async () => {
      expect(await db.leadSourceGroup.count({ where: { code: "FXHPERM_CO_MOI" } })).toBe(0);
      expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: mau.id } })).toMatchObject({ name: "Mẫu cờ", status: "ACTIVE" });
    };
    await dangNhapLa("SUPER_ADMIN");
    await datCoNguon({});
    for (const [ten, r] of Object.entries(await lanGoi())) {
      expect(r, `${ten} khi cờ tắt`).toMatchObject({ ok: false });
      expect(JSON.stringify(r), ten).toMatch(/chưa được bật/);
    }
    await nguyenTrang();

    await datCoNguon(CO_NGUON_DAY_DU);
    SESS.current = null;
    for (const [ten, r] of Object.entries(await lanGoi())) expect(r, `${ten} khi chưa đăng nhập`).toMatchObject({ ok: false });
    await nguyenTrang();

    await dangNhapLa("SUPER_ADMIN");
    const ok = await lanGoi();
    expect(ok.tao).toMatchObject({ ok: true });
    expect(ok.sua).toMatchObject({ ok: true, doi: true });
    expect(ok.doi, "sau khi sửa tên, updatedAt đã đổi nên bản cũ bị từ chối — đúng khoá lạc quan").toMatchObject({ ok: false, field: "vuaDoi" });
  });

  it("[NHH-H-PERM-06] moGanNguonAction (sources:view): 5 vai mở được Sheet của lead trong tầm nhìn; vai khác bị chặn, KHÔNG nhận dữ liệu lead; id thật == id không tồn tại", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      const leadId = await dungLead(cs1);
      await dangNhapLa(ten);
      const that = await moGanNguonAction({ leadId });
      if ((DUOC.moGanNguon as readonly TenVai[]).includes(ten)) {
        expect(that, `${ten} phải mở được`).toMatchObject({ ok: true });
      } else {
        const gia = await moGanNguonAction({ leadId: "khong-co-lead-nay" });
        expect(that, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect((that as { error: string }).error, ten).toContain("sources:view");
        expect(that, `${ten}: id thật phải cho CÙNG kết quả với id không tồn tại`).toEqual(gia);
        expect(that, `${ten}: không được lộ dữ liệu lead`).not.toHaveProperty("du");
      }
    }
  });

  it("[NHH-H-PERM-07] timNguoiGioiThieuAction (một trong 4 khoá ghi nguồn): 5 vai tra được; vai khác bị chặn, KHÔNG nhận kết quả tìm", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      await dangNhapLa(ten);
      const r = await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "fx" });
      if ((DUOC.timNguoi as readonly TenVai[]).includes(ten)) {
        expect(r, `${ten} phải tra được`).toMatchObject({ ok: true });
      } else {
        expect(r, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect((r as { error: string }).error, ten).toBe("Không có quyền chọn nguồn lead.");
        expect(r, `${ten}: không được lộ kết quả`).not.toHaveProperty("ketQua");
      }
    }
  });

  it("[NHH-H-PERM-08] doiNguonLeadAction (leads:overwrite, THEO TỪNG LEAD): SUPER_ADMIN + QLCS đúng cơ sở đổi được; vai khác bị chặn (field 'quyen'), nhóm nguồn + audit KHÔNG đổi", async () => {
    for (const ten of TAT_CA_VAI) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      const leadId = await dungLead(cs1);
      await dangNhapLa(ten);
      const r = await doiNguonLeadAction({ leadId, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi nguồn thử quyền" });
      if ((DUOC.doiNguon as readonly TenVai[]).includes(ten)) {
        expect(r, `${ten} phải đổi được`).toMatchObject({ ok: true });
        expect(await nhomCua(leadId), ten).toBe("WALK_IN");
        expect(await demAuditLead(leadId), ten).toBe(1);
      } else {
        expect(r, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect(await nhomCua(leadId), `${ten}: nhóm không được đổi`).toBe("PAID_ADS");
        expect(await demAuditLead(leadId), `${ten}: không được ghi audit`).toBe(0);
      }
    }
  });

  it("[NHH-H-PERM-09] đổi nguồn lead ĐÃ THU TIỀN (sources:override-after-payment): CHỈ SUPER_ADMIN; QLCS có leads:overwrite KHÔNG đủ; nhóm + audit không đổi", async () => {
    for (const ten of ["SUPER_ADMIN", "CENTER_MANAGER", "HO_MARKETING", "GIAM_DOC"] as const) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      const leadId = await dungLead(cs1);
      await dungDonDaThu(leadId);
      await dangNhapLa(ten);
      const r = await doiNguonLeadAction({ leadId, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi nguồn sau thu tiền" });
      if ((DUOC.doiNguonSauThu as readonly TenVai[]).includes(ten)) {
        expect(r, `${ten} phải đổi được`).toMatchObject({ ok: true, canDieuChinh: true });
        expect(await nhomCua(leadId), ten).toBe("WALK_IN");
      } else {
        expect(r, `${ten} phải bị chặn`).toMatchObject({ ok: false });
        expect(await nhomCua(leadId), `${ten}: nhóm không được đổi`).toBe("PAID_ADS");
        expect(await demAuditLead(leadId), `${ten}: không được ghi audit`).toBe(0);
      }
    }
  });

  it("[NHH-H-PERM-10] cách ly cơ sở khi GHI: QLCS CS1 đổi nguồn lead CS2 ⇒ CÙNG câu với lead không tồn tại, 0 audit, nhóm không đổi; đối chứng dương: lead CS1 của chính họ đổi được", async () => {
    await dangNhapLa("CENTER_MANAGER");
    const cs2Id = await dungLead(cs2, "CS2");
    const cs1Id = await dungLead(cs1, "CS1");
    const khac = await doiNguonLeadAction({ leadId: cs2Id, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi lead cơ sở khác" });
    const gia = await doiNguonLeadAction({ leadId: "khong-co-lead-nay", groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi lead cơ sở khác" });
    expect(khac).toEqual(gia);
    expect(khac).toMatchObject({ ok: false, field: "lead" });
    expect(await nhomCua(cs2Id)).toBe("PAID_ADS");
    expect(await demAuditLead(cs2Id)).toBe(0);
    // Đọc cũng vậy: Sheet của lead CS2 cùng câu với lead không tồn tại.
    expect(await moGanNguonAction({ leadId: cs2Id })).toEqual(await moGanNguonAction({ leadId: "khong-co-lead-nay" }));
    // Đối chứng dương.
    expect(await doiNguonLeadAction({ leadId: cs1Id, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi lead cơ sở mình" })).toMatchObject({ ok: true });
    expect(await nhomCua(cs1Id)).toBe("WALK_IN");
  });

  // ═════ THU HỒI / HẾT HẠN ═════════════════════════════════════════════════════════════════════

  it("[NHH-H-PERM-12] vai bị THU HỒI không còn quyền: hết hạn (effectiveTo đã qua), tạm ngưng, chưa tới hạn, và không gán vai nào ⇒ chặn cả action soạn lẫn action đọc; đối chứng dương: cùng người, vai còn hiệu lực ⇒ qua", async () => {
    const MOT_NGAY = 86_400_000;
    const kichBan: { ten: string; opts: Parameters<typeof dangNhapLa>[1]; duoc: boolean }[] = [
      { ten: "còn hiệu lực (đối chứng dương)", opts: {}, duoc: true },
      { ten: "hết hạn hôm qua", opts: { effectiveFrom: new Date(Date.now() - 3 * MOT_NGAY), effectiveTo: new Date(Date.now() - MOT_NGAY) }, duoc: false },
      { ten: "tạm ngưng (SUSPENDED)", opts: { status: "SUSPENDED" }, duoc: false },
      { ten: "đã kết thúc (EXPIRED)", opts: { status: "EXPIRED" }, duoc: false },
      { ten: "chưa tới ngày hiệu lực", opts: { effectiveFrom: new Date(Date.now() + 2 * MOT_NGAY) }, duoc: false },
      { ten: "không gán vai nào", opts: { khongGanVai: true }, duoc: false },
    ];
    for (const k of kichBan) {
      await don();
      await datCoNguon(CO_NGUON_DAY_DU);
      await dangNhapLa("HO_HR", k.opts);
      const truocCs = await demChinhSach();
      const soan = await luuNhapAction({ form: formDu(), policyId: null, versionId: null, updatedAtDaThay: null });
      const doc = await kiemHangRaoAction("khong-co-ban-nhap-nay");
      if (k.duoc) {
        expect(soan, k.ten).toMatchObject({ ok: true });
        expect(await demChinhSach(), k.ten).toBe(truocCs + 1);
        expect(JSON.stringify(doc), k.ten).not.toContain("commission_policies:view");
      } else {
        expect(soan, k.ten).toMatchObject({ ok: false });
        expect((soan as { chung: string }).chung, k.ten).toContain("commission_policies:manage");
        expect(await demChinhSach(), `${k.ten}: không được tạo`).toBe(truocCs);
        expect((doc as { chung: string }).chung, k.ten).toContain("commission_policies:view");
      }
    }
  });

  // ═════ CỜ TÍNH NĂNG ═══════════════════════════════════════════════════════════════════════════

  it("[NHH-H-PERM-13] cờ TẮT ⇒ đường ghi đóng dù ĐỦ QUYỀN: engine tắt thì 4 action Chính sách từ chối (màn đã 404), nguồn tắt thì 4 action Nguồn từ chối; không ghi gì; bật lại ⇒ cùng lời gọi thành công (đối chứng dương)", async () => {
    const mau = await nhapMau(); // nhapMau đăng nhập lại SUPER_ADMIN (tạo người dùng mới) — gọi TRƯỚC khi đặt phiên của ca
    await dangNhapLa("SUPER_ADMIN");
    const leadId = await dungLead(cs1);
    const pageId = `${P}page-co`;
    await db.facebookPageMapping.create({ data: { pageId, pageName: `${P}Page co`, scopeType: "HO", centerId: null, isActive: true } });
    const truocCs = await demChinhSach();

    // — engine TẮT (nguồn BẬT): 4 action Chính sách đóng, 4 action Nguồn vẫn chạy.
    await datEngine(false);
    const form = formDu();
    const tat = {
      luuNhap: await luuNhapAction({ form, policyId: null, versionId: null, updatedAtDaThay: null }),
      kiemHangRao: await kiemHangRaoAction(mau.versionId),
      kichHoat: await kichHoatAction({ versionId: mau.versionId, xacNhanLyDo: "fx-hperm", updatedAtDaThay: mau.updatedAt }),
      huy: await huyNhapAction({ versionId: mau.versionId, lyDo: "fx-hperm huỷ khi cờ tắt" }),
    };
    for (const [ten, r] of Object.entries(tat)) {
      expect(r, ten).toMatchObject({ ok: false });
      expect((r as { chung: string }).chung, ten).toMatch(/chưa được bật/);
    }
    expect(await demChinhSach(), "cờ tắt không được tạo chính sách").toBe(truocCs);
    expect(await trangThai(mau.versionId), "cờ tắt không được kích hoạt/huỷ").toBe("DRAFT");
    expect(await moGanNguonAction({ leadId }), "cờ engine tắt KHÔNG đóng tab Nguồn").toMatchObject({ ok: true });

    // — nguồn TẮT (engine BẬT): 4 action Nguồn đóng, chính sách vẫn chạy.
    await datEngine(true);
    await datCoNguon({});
    const nguonTat = {
      moGan: await moGanNguonAction({ leadId }),
      tim: await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "fx" }),
      doi: await doiNguonLeadAction({ leadId, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi nguồn khi cờ tắt" }),
      page: await luuPageMappingAction({ pageId, groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" }),
    };
    for (const [ten, r] of Object.entries(nguonTat)) {
      expect(r, ten).toMatchObject({ ok: false });
      expect(JSON.stringify(r), ten).toMatch(/chưa được bật/);
    }
    expect(await nhomCua(leadId), "cờ nguồn tắt không được đổi nguồn").toBe("PAID_ADS");
    expect(await huyNhapAction({ versionId: mau.versionId, lyDo: "fx-hperm huỷ khi engine bật" }), "cờ nguồn tắt KHÔNG đóng tab Chính sách").toMatchObject({ ok: true });

    // — bật lại: cùng lời gọi thành công.
    await datCoNguon(CO_NGUON_DAY_DU);
    expect(await doiNguonLeadAction({ leadId, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi nguồn khi đã bật" })).toMatchObject({ ok: true });
    expect(await luuNhapAction({ form, policyId: null, versionId: null, updatedAtDaThay: null })).toMatchObject({ ok: true });
  });

  // ═════ CHƯA ĐĂNG NHẬP ═════════════════════════════════════════════════════════════════════════

  it("[NHH-H-PERM-11] KHÔNG phiên ⇒ cả 8 action từ chối và KHÔNG ghi gì (đối chứng dương: cùng lời gọi, có phiên đúng vai ⇒ thành công)", async () => {
    const mau = await nhapMau();
    const leadId = await dungLead(cs1);
    const pageId = `${P}page-anon`;
    await db.facebookPageMapping.create({ data: { pageId, pageName: `${P}Page anon`, scopeType: "HO", centerId: null, isActive: true } });
    const truocCs = await demChinhSach();

    SESS.current = null;
    const kq = {
      luuNhap: await luuNhapAction({ form: formDu(), policyId: null, versionId: null, updatedAtDaThay: null }),
      huy: await huyNhapAction({ versionId: mau.versionId, lyDo: "fx-hperm huỷ khi chưa đăng nhập" }),
      kichHoat: await kichHoatAction({ versionId: mau.versionId, xacNhanLyDo: "fx-hperm", updatedAtDaThay: mau.updatedAt }),
      kiemHangRao: await kiemHangRaoAction(mau.versionId),
      luuPage: await luuPageMappingAction({ pageId, groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" }),
      moGan: await moGanNguonAction({ leadId }),
      tim: await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "fx" }),
      doiNguon: await doiNguonLeadAction({ leadId, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi nguồn khi chưa đăng nhập" }),
    };
    for (const [ten, r] of Object.entries(kq)) expect(r, ten).toMatchObject({ ok: false });
    expect(await demChinhSach(), "không được tạo chính sách").toBe(truocCs);
    expect(await trangThai(mau.versionId)).toBe("DRAFT");
    expect(await nhomCua(leadId)).toBe("PAID_ADS");
    expect(((await db.systemSetting.findUnique({ where: { key: KEY_PAGE } }))?.valueJson ?? {}) as Record<string, unknown>).not.toHaveProperty(pageId);

    // Đối chứng dương: SUPER_ADMIN, cùng lời gọi ⇒ thành công (vậy các từ chối trên là do thiếu PHIÊN, không do lời gọi hỏng).
    await dangNhapLa("SUPER_ADMIN");
    expect(await huyNhapAction({ versionId: mau.versionId, lyDo: "fx-hperm huỷ khi đã đăng nhập" })).toMatchObject({ ok: true });
    expect(await doiNguonLeadAction({ leadId, groupId: nhom.WALK_IN, lyDo: "fx-hperm đổi nguồn khi đã đăng nhập" })).toMatchObject({ ok: true });
    expect(await luuPageMappingAction({ pageId, groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toMatchObject({ ok: true });
  });
});
