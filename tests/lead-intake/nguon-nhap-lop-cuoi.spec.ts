// @vitest-environment node
/**
 * LANE C1 «NGUỒN Ở LỚP NHẬP» — các hành vi CUỐI của ô «Nguồn khách hàng» / Excel / API công khai, chạy ĐÚNG hàm thật trên Postgres LOCAL.
 * Phần đã có bộ khác khoá (`nguon-ui-nhap-lead` NHH-UI-NL-*, `nguon-excel-ma-nv` EMNV/MNR) thì KHÔNG chép lại — bảng ánh xạ ở
 * `docs/source-commission/closeout/final-source-entry.md`.
 *
 *   [SRC-ENT-01]  phiếu chọn nguồn NGOÀI KHOẢNG HIỆU LỰC / không `selectable` / DRAFT / ARCHIVED ⇒ máy chủ từ chối, 0 lead; đối chứng dương: cùng nguồn
 *                 trong khoảng hiệu lực ⇒ tạo được. Ô chọn (`loadNguonChoFormNhap`) cũng không hiện đúng những nguồn đó.
 *   [SRC-ENT-02]  nguồn TUỲ BIẾN yêu cầu nhân sự / phụ huynh / đối tác ⇒ máy chủ bắt chọn người (thiếu · lạc loại ⇒ từ chối), đúng người ⇒ tạo + ghi đúng cột.
 *   [SRC-ENT-03]  NGUỒN · NGƯỜI GIỚI THIỆU · SALE PHỤ TRÁCH độc lập — đường form: người giới thiệu là Sale CÙNG cơ sở, CÓ trong pool chia lead, nhưng KHÔNG thành chủ lead.
 *   [SRC-ENT-04]  API công khai `POST /api/leads`: payload thù địch (nhãn nguồn khớp tên nguồn, `nguonChon`, người giới thiệu, `assignedToId`) KHÔNG đổi nguồn / người giới thiệu / chủ lead;
 *                 `?ref=` của đối tác gắn tài khoản Sale KHÔNG biến người đó thành chủ lead.
 *   [SRC-ENT-04b] (C1b · F2) `/api/leads`: `source` có TRẦN độ dài + cắt khoảng trắng — vượt trần ⇒ 400, 0 lead; đúng trần ⇒ tạo; giá trị lưu là giá trị ĐÃ chuẩn hoá.
 *   [SRC-ENT-05b] (C1b · F3) Excel D: cột Sale hợp lệ nhưng dòng THIẾU CƠ SỞ ⇒ KHÔNG bỏ im lặng: SUCCESS_WITH_REVIEW + cảnh báo + `review[]` mã `SALE_BO_QUA_THIEU_CO_SO`; đối chứng dương: có cơ sở ⇒ ghi đúng Sale, không cảnh báo.
 *   [SRC-ENT-17]  đường `sale-form` công khai CŨ (mã NV trên phiếu = người giới thiệu): mặc định bị khoá đăng nhập (401, 0 lead); có phiên thì mã lấy từ PHIÊN, mã người khác gõ trên phiếu KHÔNG thành người giới thiệu / chủ lead.
 *   [SRC-ENT-05]  đường Excel (D): cột Sale phụ trách = A, cột Mã NV giới thiệu = B (Sale CÙNG cơ sở, trong pool, ÍT lượt hơn A) ⇒ chủ lead = A, người giới thiệu = B.
 *                (Dòng PHẢI có cơ sở: dòng không cơ sở đi `autoAssignNewLead`, đường đó KHÔNG nhận chủ chỉ định — ghi ở doc closeout, mục «còn lại».)
 *   [SRC-ENT-06]  Excel: nhãn hợp lệ = SUCCESS · nhãn LẠ = SUCCESS_WITH_REVIEW (UNKNOWN + NHAN_NGUON_LA, hàng chờ) · cơ sở ép + nhãn lạ = ERROR · SĐT đã có = SKIPPED.
 *   [SRC-ENT-07]  Excel: mã NV sai = SUCCESS_WITH_REVIEW (INVALID_EMPLOYEE_REFERRER_CODE, thiếu người, không hoa hồng giới thiệu) · «Khác» = OTHER + giải trình ≥10 ký tự · đối chứng mã đúng = SUCCESS.
 *   [SRC-ENT-08]  Excel: nguồn tuỳ biến đang hoạt động = SUCCESS · nguồn tuỳ biến / nguồn gốc đã TẮT = fail-closed UNKNOWN + hàng chờ · nhãn trùng TÊN nguồn tuỳ biến vẫn là nhãn lạ.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `SRCE_` + SĐT cố định. LUẬT 18: mỗi ca tự dựng hiện trường. LUẬT 19: ngày TUYỆT ĐỐI (2020 / 2099), không đọc đồng hồ để dựng khoảng hiệu lực.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.7" }),
}));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));
// `/api/leads` đi qua lớp thời gian chung (chờ ≥ 700 ms/lượt) — bộ này kiểm NGUỒN chứ không kiểm thời gian (ca riêng: `leads-api-dong-deu.spec.ts`).
vi.mock("@/lib/security/dong-deu-thoi-gian", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/dong-deu-thoi-gian")>()),
  phuThuocThoiGianThat: () => ({ now: () => new Date(), cho: async () => {}, nhieuMs: () => 0 }),
}));

import { NextRequest } from "next/server";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { createInternalLeadAction } from "../../lib/lead/intake/quick-form-action";
import { loadNguonChoFormNhap } from "../../lib/nguon/nguon-cho-form-nhap";
import { whereHangCho } from "../../lib/nguon/doc-hang-cho";
import { POST as leadsPost } from "../../app/api/leads/route";
import { POST as importPost } from "../../app/api/admin/import/leads/route";
import { POST as saleFormPost } from "../../app/api/public/lead-intake/sale-form/route";
import { LEAD_IMPORT_CENTER_HEADER, LEAD_IMPORT_SALE_HEADER } from "../../lib/lead/import";
import { NGUON_CONG_KHAI_TOI_DA } from "../../lib/validators/lead";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "SRCE_";
const CASE = 90_000;
/** Mốc cố định cho `loadNguonChoFormNhap` — nằm GIỮA 2020 và 2099 nên các nguồn có khoảng hiệu lực kiểm bằng ngày tuyệt đối. */
const MOC = new Date("2026-11-20T03:00:00.000Z");

const SDT = {
  a: "0907200001", b: "0907200002", c: "0907200003", d: "0907200004", e: "0907200005", f: "0907200006", g: "0907200007", h: "0907200008",
  i: "0907200009", j: "0907200010", k: "0907200011", l: "0907200012",
} as const;
const TAT_CA_SDT = Object.values(SDT);
const bienThe = (s: string) => [s, `84${s.slice(1)}`];
const RATE_LIMIT_KEY = "public.leadRateLimitMax";
/** Dấu của dòng sổ lượt «tạm dừng» do chính bộ này đặt (để dọn đúng dòng của mình). */
const TAM_DUNG = "srce-test-tam-dung";
/** Dòng sổ lượt CÓ SẴN (của bộ khác) mà bộ này đã đặt tạm dừng — khôi phục NGUYÊN TRẠNG khi dọn; dòng do bộ này tạo mới thì xoá. */
const SO_LUOT_DA_SUA: { id: string; isActive: boolean; pausedReason: string | null; pausedAt: Date | null }[] = [];
const SO_LUOT_MOI: string[] = [];

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: TAT_CA_SDT.flatMap(bienThe) } }] },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  // trả sổ lượt của bộ khác về ĐÚNG trạng thái cũ (không để mất `turns` / trạng thái của ai), rồi xoá dòng do chính bộ này tạo
  for (const d of SO_LUOT_DA_SUA.splice(0)) await db.leadRotationTurn.updateMany({ where: { id: d.id }, data: { isActive: d.isActive, pausedReason: d.pausedReason, pausedAt: d.pausedAt } });
  await db.leadRotationTurn.deleteMany({ where: { OR: [{ userId: { in: uids } }, { id: { in: SO_LUOT_MOI.splice(0) } }] } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "SRCEAFF" } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "SRCE_" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  await db.systemSetting.deleteMany({ where: { key: RATE_LIMIT_KEY } });
  await db.centerSetting.deleteMany({ where: { key: "nguon.epChonNguon" } });
}

const jsonReq = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const phieu = (sdt: string, nguonChon: unknown, over: Record<string, unknown> = {}) => ({
  parentName: `${P}Phụ huynh ${sdt.slice(-2)}`,
  phone: sdt,
  centerCode: "CS1",
  children: [],
  nguonChon,
  ...over,
});
const chon = (groupId: string, o: Record<string, unknown> = {}) => ({
  groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null, ...o,
});

const theoSdt = (s: string) =>
  db.lead.findFirst({
    where: { phone: { in: bienThe(s) }, deletedAt: null },
    select: { id: true, source: true, assignedToId: true, affiliateId: true, attribution: { include: { group: { select: { code: true } } } } },
  });

type NguoiDung = { id: string; employeeId: string | null; email: string };

/** Tài khoản Sale CS1 ĐÚNG như người nhận lead thật: User (roles ∋ SALES_CSM, centerId = CS1) + vai tại CS1 + (tuỳ chọn) hồ sơ nhân sự. */
async function dungSale(hau: string, o: { coNhanSu?: boolean; turns?: number } = {}): Promise<NguoiDung> {
  const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  let employeeId: string | null = null;
  if (o.coNhanSu) {
    const e = await db.employee.create({
      data: { employeeCode: `${P}NV${hau}`, fullName: `${P}Nhân viên ${hau}`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: cs1.id, status: "ACTIVE", isActive: true },
      select: { id: true },
    });
    employeeId = e.id;
  }
  const email = `${P}sale${hau}@example.test`;
  const u = await db.user.create({
    data: { name: `${P}Sale ${hau}`, email, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, isActive: true, employeeId },
    select: { id: true },
  });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "srce", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  if (o.turns !== undefined) {
    await db.leadRotationTurn.create({ data: { orgUnitId: ou.id, userId: u.id, turns: o.turns, seedTurns: 0, isActive: true } });
  }
  return { id: u.id, employeeId, email };
}

/**
 * Cô lập pool chia lead của CS1 chỉ còn người của bộ này: Sale «lạc» do bộ khác để lại (CI dùng chung DB giữa các bộ) bị đặt TẠM DỪNG trong sổ lượt — không xoá dữ liệu của ai.
 * Không có bước này, «chủ lead = A» có thể đúng/sai theo thứ tự chạy bộ (luật 18).
 */
async function coLapPoolCs1(): Promise<void> {
  const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const lac = await db.user.findMany({
    where: { centerId: cs1.id, roles: { has: "SALES_CSM" }, isActive: true, deletedAt: null, email: { not: { startsWith: P } } },
    select: { id: true },
  });
  for (const u of lac) {
    const co = await db.leadRotationTurn.findUnique({ where: { orgUnitId_userId: { orgUnitId: ou.id, userId: u.id } }, select: { id: true, isActive: true, pausedReason: true, pausedAt: true } });
    if (!co) {
      const moi = await db.leadRotationTurn.create({ data: { orgUnitId: ou.id, userId: u.id, turns: 0, seedTurns: 0, isActive: false, pausedReason: TAM_DUNG, pausedAt: new Date() }, select: { id: true } });
      SO_LUOT_MOI.push(moi.id);
    } else if (co.isActive) {
      SO_LUOT_DA_SUA.push(co);
      await db.leadRotationTurn.update({ where: { id: co.id }, data: { isActive: false, pausedReason: TAM_DUNG, pausedAt: new Date() } });
    }
  }
}

function phienSale(u: NguoiDung, ten: string) {
  SESS.current = { user: { id: u.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: null, name: ten, email: u.email } };
}
async function phienAdmin(): Promise<void> {
  const email = `${P}admin@example.test`;
  const u = await db.user.create({ data: { name: `${P}ADMIN`, email, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"], centerId: null, isActive: true }, select: { id: true } });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "HO" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "srce", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  SESS.current = { user: { id: u.id, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"], centerId: null, name: `${P}ADMIN`, email } };
}

async function taoNguon(code: string, o: Record<string, unknown> = {}): Promise<string> {
  const g = await db.leadSourceGroup.create({
    data: { code, name: `Nguồn thử ${code}`, requiresNote: false, selectable: true, status: "ACTIVE", referrerRequirement: "NONE", sortOrder: 90, ...o },
    select: { id: true },
  });
  return g.id;
}

describe.skipIf(!RUN)("LANE C1 — nguồn ở lớp nhập: khoảng hiệu lực · yêu cầu người · độc lập Sale owner · API công khai · Excel", () => {
  let nhom: IdNhom;
  const truocRbac = process.env.RBAC_V2_ENABLED;
  const truocYeuCauDangNhap = process.env.LEAD_INTAKE_REQUIRE_AUTH;

  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM", "SUPER_ADMIN"] });
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon({ ...CO_NGUON_DAY_DU, affiliate: true });
    await db.systemSetting.create({ data: { key: RATE_LIMIT_KEY, valueJson: 100 } });
    clearSettingsCache();
    SESS.current = null;
  }, CASE);

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    if (truocYeuCauDangNhap === undefined) delete process.env.LEAD_INTAKE_REQUIRE_AUTH;
    else process.env.LEAD_INTAKE_REQUIRE_AUTH = truocYeuCauDangNhap;
    await don();
    await db.$disconnect();
  }, 180_000);

  it("[SRC-ENT-01] nguồn NGOÀI khoảng hiệu lực / không selectable / DRAFT / ARCHIVED ⇒ máy chủ từ chối + 0 lead + ô chọn không hiện; đối chứng dương: nguồn trong khoảng hiệu lực ⇒ tạo được", async () => {
    const sale = await dungSale("A");
    phienSale(sale, `${P}Sale A`);
    const hetHan = await taoNguon("SRCE_HET_HAN", { effectiveTo: new Date("2020-01-01T00:00:00.000Z") });
    const chuaToi = await taoNguon("SRCE_CHUA_TOI", { effectiveFrom: new Date("2099-01-01T00:00:00.000Z") });
    const khongChon = await taoNguon("SRCE_KHONG_CHON", { selectable: false });
    const nhap = await taoNguon("SRCE_NHAP", { status: "DRAFT" });
    const luuTru = await taoNguon("SRCE_LUU_TRU", { status: "ARCHIVED" });
    const trong = await taoNguon("SRCE_TRONG_HAN", { effectiveFrom: new Date("2020-01-01T00:00:00.000Z"), effectiveTo: new Date("2099-01-01T00:00:00.000Z") });

    const ca: [string, string][] = [["hết hạn", hetHan], ["chưa tới hạn", chuaToi], ["selectable=false", khongChon], ["DRAFT", nhap], ["ARCHIVED", luuTru]];
    const sdt = [SDT.a, SDT.b, SDT.c, SDT.d, SDT.e];
    for (const [i, [ten, id]] of ca.entries()) {
      const r = await createInternalLeadAction(phieu(sdt[i]!, chon(id)));
      expect(r.ok, ten).toBe(false);
      expect(r.error, ten).toMatch(/không còn dùng được/);
      expect(await theoSdt(sdt[i]!), `${ten} — không được tạo lead`).toBeNull();
    }
    // đối chứng dương: cùng loại nguồn, nằm TRONG khoảng hiệu lực
    const ok = await createInternalLeadAction(phieu(SDT.f, chon(trong)));
    expect(ok.ok, ok.error).toBe(true);
    expect((await theoSdt(SDT.f))!.attribution!.group.code).toBe("SRCE_TRONG_HAN");

    // ô chọn: đúng tập nguồn trên server chấp nhận
    const dm = (await loadNguonChoFormNhap([{ code: "CS1" }], MOC))!.danhMuc.map((g) => g.code);
    expect(dm).toContain("SRCE_TRONG_HAN");
    for (const c of ["SRCE_HET_HAN", "SRCE_CHUA_TOI", "SRCE_KHONG_CHON", "SRCE_NHAP", "SRCE_LUU_TRU", "UNKNOWN"]) expect(dm, c).not.toContain(c);
  }, CASE);

  it("[SRC-ENT-02] nguồn TUỲ BIẾN yêu cầu nhân sự / phụ huynh / đối tác ⇒ máy chủ bắt chọn người; thiếu hoặc lạc loại ⇒ từ chối; đúng người ⇒ tạo + ghi đúng cột", async () => {
    const sale = await dungSale("A");
    phienSale(sale, `${P}Sale A`);
    const ns = await taoNguon("SRCE_NS", { referrerRequirement: "EMPLOYEE" });
    const ph = await taoNguon("SRCE_PH", { referrerRequirement: "PARENT" });
    const dt = await taoNguon("SRCE_DT", { referrerRequirement: "AFFILIATE_ORG" });
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const nv = await db.employee.create({ data: { employeeCode: `${P}NV1`, fullName: `${P}NV 1`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: cs1.id, status: "ACTIVE", isActive: true }, select: { id: true } });
    const hs = await db.student.create({ data: { name: `${P}Bé`, parentName: "PH", centerId: cs1.id }, select: { id: true } });
    const aff = await db.affiliate.create({ data: { code: "SRCEAFF1", name: `${P}Đối tác`, isActive: true }, select: { id: true } });

    const bi: [string, unknown, RegExp][] = [
      ["nhân sự: thiếu người", chon(ns), /cần chọn nhân sự giới thiệu/],
      ["nhân sự: đưa đối tác", chon(ns, { affiliateId: aff.id }), /cần chọn nhân sự giới thiệu/],
      ["phụ huynh: thiếu người", chon(ph), /cần chọn phụ huynh giới thiệu/],
      ["phụ huynh: đưa nhân sự", chon(ph, { employeeId: nv.id }), /cần chọn phụ huynh giới thiệu/],
      ["đối tác: thiếu người", chon(dt), /cần chọn đối tác giới thiệu/],
      ["đối tác: đưa học viên", chon(dt, { studentId: hs.id }), /cần chọn đối tác giới thiệu/],
    ];
    const sdt = [SDT.a, SDT.b, SDT.c, SDT.d, SDT.e, SDT.f];
    for (const [i, [ten, nc, re]] of bi.entries()) {
      const r = await createInternalLeadAction(phieu(sdt[i]!, nc));
      expect(r.ok, ten).toBe(false);
      expect(r.error, ten).toMatch(re);
      expect(await theoSdt(sdt[i]!), `${ten} — không được tạo lead`).toBeNull();
    }
    // đối chứng dương: đúng người ở từng nguồn
    expect((await createInternalLeadAction(phieu(SDT.g, chon(ns, { employeeId: nv.id })))).ok).toBe(true);
    expect((await createInternalLeadAction(phieu(SDT.h, chon(ph, { studentId: hs.id })))).ok).toBe(true);
    expect((await createInternalLeadAction(phieu(SDT.i, chon(dt, { affiliateId: aff.id })))).ok).toBe(true);
    expect((await theoSdt(SDT.g))!.attribution).toMatchObject({ referrerKind: "EMPLOYEE", referrerEmployeeId: nv.id });
    expect((await theoSdt(SDT.g))!.attribution!.group.code).toBe("SRCE_NS");
    expect((await theoSdt(SDT.h))!.attribution).toMatchObject({ referrerKind: "PARENT", referrerStudentId: hs.id });
    expect((await theoSdt(SDT.i))!.attribution).toMatchObject({ referrerKind: "AFFILIATE", referrerAffiliateId: aff.id });
  }, CASE);

  it("[SRC-ENT-03] đường FORM: người giới thiệu (Sale CÙNG cơ sở, CÓ trong pool) KHÔNG thành chủ lead — cả khi người nhập là Sale (giữ phiếu của mình) lẫn khi Hội sở nhập (vòng chia chọn)", async () => {
    const ns = await taoNguon("SRCE_NS", { referrerRequirement: "EMPLOYEE" });
    const a = await dungSale("A", { coNhanSu: true, turns: 0 });
    const b = await dungSale("B", { coNhanSu: true, turns: 5 });
    await coLapPoolCs1();
    // đối chứng cấu hình: B THẬT SỰ nằm trong pool CS1 (nếu không, «chủ lead ≠ B» đúng vì lý do sai)
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const { layPoolDangBat } = await import("../../lib/lead/pool");
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    expect((await layPoolDangBat(ou.id, cs1.id)).map((m) => m.userId).sort()).toEqual([a.id, b.id].sort());

    // (1) người nhập = Sale A, chọn B làm người giới thiệu
    phienSale(a, `${P}Sale A`);
    const r1 = await createInternalLeadAction(phieu(SDT.a, chon(ns, { employeeId: b.employeeId })));
    expect(r1.ok, r1.error).toBe(true);
    const l1 = (await theoSdt(SDT.a))!;
    expect(l1.attribution).toMatchObject({ referrerKind: "EMPLOYEE", referrerEmployeeId: b.employeeId });
    expect(l1.assignedToId).toBe(a.id);

    // (2) người nhập = Hội sở (không phải Sale) ⇒ vòng chia chọn người ÍT LƯỢT nhất = A; B (người giới thiệu, nhiều lượt hơn) KHÔNG được chọn
    SESS.current = null;
    await phienAdmin();
    const r2 = await createInternalLeadAction(phieu(SDT.b, chon(ns, { employeeId: b.employeeId })));
    expect(r2.ok, r2.error).toBe(true);
    const l2 = (await theoSdt(SDT.b))!;
    expect(l2.attribution).toMatchObject({ referrerKind: "EMPLOYEE", referrerEmployeeId: b.employeeId });
    expect(l2.assignedToId).toBe(a.id);
    expect(l2.assignedToId).not.toBe(b.id);
  }, CASE);

  it("[SRC-ENT-04] API công khai /api/leads: payload thù địch KHÔNG đổi nguồn / người giới thiệu / chủ lead; ?ref= của đối tác gắn tài khoản Sale KHÔNG biến người đó thành chủ lead", async () => {
    const a = await dungSale("A", { coNhanSu: true, turns: 0 });
    const b = await dungSale("B", { coNhanSu: true, turns: 5 });
    await coLapPoolCs1();
    const gv = await db.user.create({ data: { name: `${P}GV`, email: `${P}gv@example.test`, role: "TEACHER", roles: ["TEACHER"], isActive: true }, select: { id: true } });
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const body = (phone: string, over: Record<string, unknown> = {}) => ({
      parentName: `${P}Khách web`, phone, source: "lien-he", eventId: `evt-${phone}-${Math.random().toString(36).slice(2, 10)}`,
      dongYChinhSachBaoMat: true, consentMarketing: false, timeOnPage: 30, centerCode: "CS1", ...over,
    });

    // (1) thù địch: nhãn `source` = tên một nguồn có người (phụ huynh giới thiệu) + mọi khoá nguồn/người/chủ mà client có thể nghĩ ra
    const r1 = await leadsPost(jsonReq("/api/leads", body(SDT.a, {
      source: "Nguồn từ phụ huynh giới thiệu",
      nguonChon: chon(nhom.PARENT_REFERRAL, { studentId: "hv-gia" }),
      groupId: nhom.EMPLOYEE_REFERRAL,
      nhanKhai: "Nguồn từ nhân sự giới thiệu",
      maNvNguoiNhap: "SRCE_NVA",
      nhanSuGioiThieuEmployeeId: b.employeeId,
      referrerEmployeeId: b.employeeId,
      assignedToId: gv.id,
    })));
    expect(r1.status).toBe(200);
    const l1 = (await theoSdt(SDT.a))!;
    expect(l1.attribution!.group.code).toBe("PAID_ADS"); // đường 'web' mặc định (D11)
    expect(l1.attribution).toMatchObject({ matchedRule: "DUONG_VAO_MAC_DINH", referrerKind: null, referrerEmployeeId: null, referrerMissing: false });
    expect(l1.assignedToId).not.toBe(gv.id);

    // (2) ?ref= của đối tác có tài khoản Sale B (nhiều lượt) ⇒ chủ lead vẫn do vòng chia chọn (A, ít lượt nhất), không phải B
    const aff = await db.affiliate.create({ data: { code: "SRCEAFF2", name: `${P}Đối tác`, isActive: true, userId: b.id, centerId: cs1.id }, select: { id: true } });
    const r2 = await leadsPost(jsonReq("/api/leads", body(SDT.b, { ref: "srceaff2" })));
    expect(r2.status).toBe(200);
    const l2 = (await theoSdt(SDT.b))!;
    expect(l2.affiliateId).toBe(aff.id); // đối chứng dương: mã ?ref= ĐÃ được ghi nhận
    expect(l2.assignedToId).toBe(a.id);
    expect(l2.assignedToId).not.toBe(b.id);
  }, CASE);

  it("[SRC-ENT-05] đường Excel (D): cột Sale phụ trách = A, cột Mã NV giới thiệu = B (Sale CÙNG cơ sở, trong pool) ⇒ chủ lead = A, người giới thiệu = B", async () => {
    // B ÍT lượt hơn A: nếu cột Sale phụ trách bị bỏ qua (hoặc đọc nhầm sang cột mã NV), vòng chia sẽ chọn B ⇒ «chủ lead = A» chỉ đúng khi cột Sale được tôn trọng.
    const a = await dungSale("A", { coNhanSu: true, turns: 5 });
    const b = await dungSale("B", { coNhanSu: true, turns: 0 });
    await coLapPoolCs1();
    await phienAdmin();
    const res = await importPost(jsonReq("/api/admin/import/leads", {
      rows: [{ "Tên phụ huynh": `${P}Excel`, SĐT: SDT.a, [LEAD_IMPORT_CENTER_HEADER]: "CS1", [LEAD_IMPORT_SALE_HEADER]: a.email, "Mã NV giới thiệu": `${P}NVB` }],
    }));
    const j = (await res.json()) as { success: number; errors: unknown[] };
    expect(j.success, JSON.stringify(j)).toBe(1);
    const l = (await theoSdt(SDT.a))!;
    expect(l.assignedToId).toBe(a.id);
    expect(l.attribution).toMatchObject({ referrerKind: "EMPLOYEE", referrerEmployeeId: b.employeeId });
    expect(l.assignedToId).not.toBe(b.id);
  }, CASE);

  it("[SRC-ENT-04b] (F2) /api/leads: `source` vượt trần ⇒ 400 + 0 lead; đúng trần ⇒ tạo; khoảng trắng hai đầu bị cắt trước khi lưu", async () => {
    const body = (phone: string, source: string) => ({
      parentName: `${P}Khách web`, phone, source, eventId: `evt-${phone}-${Math.random().toString(36).slice(2, 10)}`,
      dongYChinhSachBaoMat: true, consentMarketing: false, timeOnPage: 30, centerCode: "CS1",
    });
    const qua = await leadsPost(jsonReq("/api/leads", body(SDT.a, "a".repeat(NGUON_CONG_KHAI_TOI_DA + 1))));
    expect(qua.status).toBe(400);
    expect(await theoSdt(SDT.a), "vượt trần ⇒ KHÔNG tạo lead").toBeNull();
    const dungTran = "b".repeat(NGUON_CONG_KHAI_TOI_DA);
    expect((await leadsPost(jsonReq("/api/leads", body(SDT.b, dungTran)))).status).toBe(200);
    expect((await theoSdt(SDT.b))!.source, "đúng trần ⇒ lưu nguyên").toBe(dungTran);
    expect((await leadsPost(jsonReq("/api/leads", body(SDT.c, "  lien-he  ")))).status).toBe(200);
    expect((await theoSdt(SDT.c))!.source, "đã chuẩn hoá (cắt khoảng trắng)").toBe("lien-he");
  }, CASE);

  it("[SRC-ENT-05b] (F3) Excel D: cột Sale hợp lệ + dòng THIẾU cơ sở ⇒ nói ra (SUCCESS_WITH_REVIEW + cảnh báo + review[] mã riêng); lead GỘP cũng cảnh báo; đối chứng dương: dòng CÓ cơ sở ⇒ ghi đúng Sale, không cảnh báo", async () => {
    const a = await dungSale("A", { coNhanSu: true, turns: 5 });
    await dungSale("B", { coNhanSu: true, turns: 0 });
    await coLapPoolCs1();
    await phienAdmin();
    type Kq = { success: number; successWithReview?: number; skipped?: number; errors: unknown[]; warnings?: { row: number; error: string }[]; review?: { row: number; code: string; message: string }[] };
    const goi = async (rows: unknown[]) => (await (await importPost(jsonReq("/api/admin/import/leads", { rows }))).json()) as Kq;
    // Nguồn «Ads» ⇒ quy nguồn sạch (không hàng chờ): nhờ vậy SUCCESS_WITH_REVIEW ở dòng thiếu cơ sở chỉ có thể do F3.
    const dongSale = (sdt: string, coSo: boolean) => ({ "Tên phụ huynh": `${P}Excel`, SĐT: sdt, Nguồn: "Ads", ...(coSo ? { [LEAD_IMPORT_CENTER_HEADER]: "CS1" } : {}), [LEAD_IMPORT_SALE_HEADER]: a.email });
    const f3 = (k: Kq) => (k.warnings ?? []).filter((w) => /KHÔNG được áp dụng/.test(w.error) && /Sale phụ trách/.test(w.error));

    // (1) thiếu cơ sở ⇒ bị bỏ CÓ BÁO
    const thieu = await goi([dongSale(SDT.d, false)]);
    expect(thieu, JSON.stringify(thieu)).toMatchObject({ success: 1, successWithReview: 1, errors: [] });
    expect(f3(thieu)).toHaveLength(1);
    expect(f3(thieu)[0]!.error).toContain(a.email);
    expect(thieu.review).toEqual([expect.objectContaining({ code: "SALE_BO_QUA_THIEU_CO_SO", row: f3(thieu)[0]!.row })]);

    // (2) lead GỘP vào lead có sẵn chưa có cơ sở ⇒ cũng báo (không bỏ im lặng)
    // (lead tạo ở (1) đã được `autoAssignNewLead` GÁN cơ sở nên không còn thiếu cơ sở — dựng thẳng một lead CHƯA có cơ sở)
    await db.lead.create({ data: { parentName: `${P}Có sẵn`, phone: SDT.f, source: "Website", status: "MOI", centerId: null, lastInboundAt: new Date("2026-10-01T00:00:00.000Z") } });
    const gop = await goi([dongSale(SDT.f, false)]);
    expect(gop).toMatchObject({ success: 0, skipped: 1 });
    expect(f3(gop)).toHaveLength(1);

    // (3) đối chứng dương: CÓ cơ sở ⇒ chủ lead = A (đúng Sale đã ghi), SUCCESS, không cảnh báo F3
    const co = await goi([dongSale(SDT.e, true)]);
    expect(co, JSON.stringify(co)).toMatchObject({ success: 1, successWithReview: 0, errors: [] });
    expect(f3(co)).toEqual([]);
    expect((await theoSdt(SDT.e))!.assignedToId).toBe(a.id);
  }, CASE);

  it("[SRC-ENT-17] sale-form công khai CŨ: mặc định khoá đăng nhập (401, 0 lead); có phiên thì mã NV lấy từ PHIÊN — mã Sale B gõ trên phiếu KHÔNG thành người giới thiệu cũng KHÔNG thành chủ lead", async () => {
    const a = await dungSale("A", { coNhanSu: true, turns: 5 });
    const b = await dungSale("B", { coNhanSu: true, turns: 0 });
    await coLapPoolCs1();
    delete process.env.LEAD_INTAKE_REQUIRE_AUTH; // mặc định của mã = BẬT (khoá)
    const phieuForm = (sdt: string) =>
      new NextRequest("http://localhost/api/public/lead-intake/sale-form", {
        method: "POST",
        body: new URLSearchParams({ CustomField15: sdt, CustomField25: `${P}Khách SF`, LastName: `${P}Bé SF`, CustomField26: `${P}NVB` }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

    // (1) ẩn danh + mã B ⇒ bị khoá TRƯỚC khi đọc body: 0 lead
    SESS.current = null;
    const an = await saleFormPost(phieuForm(SDT.a));
    expect(an.status).toBe(401);
    expect(await theoSdt(SDT.a)).toBeNull();

    // (2) có phiên của Sale A, phiếu ghi mã B ⇒ phiên thắng: người giới thiệu / chủ lead đều KHÔNG phải B
    phienSale(a, `${P}Sale A`);
    const co = await saleFormPost(phieuForm(SDT.b));
    expect(co.status).toBe(303);
    const l = (await theoSdt(SDT.b))!;
    expect(l, "đối chứng: phiếu có phiên được tạo").not.toBeNull();
    expect(l.attribution!.referrerEmployeeId).not.toBe(b.employeeId);
    expect(l.attribution!.referrerEmployeeId).toBe(a.employeeId); // D12: người nhập (đã đăng nhập) là người giới thiệu — hành vi có sẵn, không phải coupling với B
    expect(l.assignedToId).not.toBe(b.id);
  }, CASE);

  // ── Excel (D): ma trận bốn trạng thái × sáu tình huống nguồn. Đo thật rồi mới khẳng định (không đoán). ──
  type KqD = { success: number; errors: { row: number; error: string }[]; successWithReview?: number; skipped?: number };
  const dongD = (sdt: string, o: { nguon?: string; ma?: string; coSo?: string } = {}) => ({
    "Tên phụ huynh": `${P}Excel`,
    SĐT: sdt,
    ...(o.nguon !== undefined ? { Nguồn: o.nguon } : {}),
    ...(o.ma !== undefined ? { "Mã NV giới thiệu": o.ma } : {}),
    ...(o.coSo ? { "Cơ sở (mã CS, để trống)": o.coSo } : {}),
  });
  const goiD = async (rows: unknown[]) => (await (await importPost(jsonReq("/api/admin/import/leads", { rows }))).json()) as KqD;
  const attrCua = async (sdt: string) => {
    const l = await theoSdt(sdt);
    if (!l) return null;
    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: l.id }, include: { group: { select: { code: true } } } });
    return { leadId: l.id, a, xemTay: ((a.signals as { xemTay?: string[] } | null)?.xemTay ?? []) as string[] };
  };
  const trongHangCho = async (leadId: string) => (await db.lead.count({ where: { id: leadId, ...whereHangCho(null, null) } })) === 1;
  const dungNvGt = async (hau: string) => {
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    return db.employee.create({
      data: { employeeCode: `${P}NV${hau}`, fullName: `${P}NV ${hau}`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: cs1.id, status: "ACTIVE", isActive: true },
      select: { id: true },
    });
  };

  it("[SRC-ENT-06] Excel: nhãn hợp lệ = SUCCESS (0 chờ duyệt, đúng nguồn) · nhãn LẠ = SUCCESS_WITH_REVIEW (UNKNOWN + NHAN_NGUON_LA, nằm hàng chờ) · cơ sở ép chọn + nhãn lạ = ERROR (0 lead) · SĐT đã có = SKIPPED", async () => {
    await phienAdmin();
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });

    const ok = await goiD([dongD(SDT.a, { nguon: "Ads" })]);
    expect(ok).toMatchObject({ success: 1, successWithReview: 0, skipped: 0, errors: [] });
    const a1 = (await attrCua(SDT.a))!;
    expect(a1.a.group.code).toBe("PAID_ADS");
    expect(await trongHangCho(a1.leadId)).toBe(false);

    const la = await goiD([dongD(SDT.b, { nguon: "Hội thảo STEM tháng 10" })]);
    expect(la).toMatchObject({ success: 1, successWithReview: 1, errors: [] });
    const a2 = (await attrCua(SDT.b))!;
    expect(a2.a.group.code).toBe("UNKNOWN");
    expect(a2.xemTay).toContain("NHAN_NGUON_LA");
    expect(await trongHangCho(a2.leadId)).toBe(true);

    await db.centerSetting.deleteMany({ where: { orgUnitId: ou.id, key: "nguon.epChonNguon" } });
    await db.centerSetting.create({ data: { orgUnitId: ou.id, key: "nguon.epChonNguon", valueJson: true } });
    clearSettingsCache();
    const chan = await goiD([dongD(SDT.c, { nguon: "Hội thảo STEM tháng 10", coSo: "CS1" })]);
    expect(chan.success).toBe(0);
    expect(chan.errors).toHaveLength(1);
    expect(await theoSdt(SDT.c)).toBeNull();

    const lai = await goiD([dongD(SDT.a, { nguon: "Ads" })]);
    expect(lai).toMatchObject({ success: 0, skipped: 1, successWithReview: 0 });
  }, CASE);

  it("[SRC-ENT-07] Excel: mã NV giới thiệu SAI ⇒ lead VẪN tạo, nhóm nhân sự + THIẾU NGƯỜI + `INVALID_EMPLOYEE_REFERRER_CODE` + nằm hàng chờ (= SUCCESS_WITH_REVIEW), KHÔNG người giới thiệu; nhãn «Khác» ⇒ OTHER có giải trình ≥10 ký tự do hệ thống sinh + hàng chờ; đối chứng dương: mã ĐÚNG ⇒ SUCCESS", async () => {
    const nv = await dungNvGt("B");
    await phienAdmin();
    const j = await goiD([dongD(SDT.a, { ma: `${P}NV_KHONG_CO` }), dongD(SDT.b, { ma: `${P}NVB` }), dongD(SDT.c, { nguon: "Khác" })]);
    expect(j).toMatchObject({ success: 3, successWithReview: 2, errors: [] });

    const sai = (await attrCua(SDT.a))!;
    expect(sai.a).toMatchObject({ matchedRule: "NV_GIOI_THIEU_SAI", referrerMissing: true, referrerEmployeeId: null, referrerKind: null });
    expect(sai.a.group.code).toBe("EMPLOYEE_REFERRAL"); // nhóm nhân sự mặc định, chờ người duyệt bổ sung — không hoa hồng giới thiệu (người = null)
    expect(sai.xemTay).toContain("INVALID_EMPLOYEE_REFERRER_CODE");
    expect(await trongHangCho(sai.leadId)).toBe(true);

    const dung = (await attrCua(SDT.b))!;
    expect(dung.a).toMatchObject({ referrerEmployeeId: nv.id, referrerMissing: false, referrerKind: "EMPLOYEE" });
    expect(dung.xemTay).not.toContain("INVALID_EMPLOYEE_REFERRER_CODE");
    expect(await trongHangCho(dung.leadId)).toBe(false);

    const khac = (await attrCua(SDT.c))!;
    expect(khac.a.group.code).toBe("OTHER");
    expect((khac.a.otherSourceNote ?? "").trim().length).toBeGreaterThanOrEqual(10); // CHECK `LeadAttribution_giai_trinh_chk` — OTHER không bao giờ thiếu giải trình
    expect(khac.xemTay).toContain("NHAN_CHOT_THEO_PHIEU");
    expect(await trongHangCho(khac.leadId)).toBe(true);
  }, CASE);

  it("[SRC-ENT-08] Excel: nguồn TUỲ BIẾN đang hoạt động (đích «nhân sự giới thiệu» do cấu hình) ⇒ SUCCESS; tắt nó ⇒ FAIL-CLOSED UNKNOWN + hàng chờ; nhãn trùng TÊN nguồn tuỳ biến vẫn là nhãn LẠ (không khớp theo tên); nguồn gốc bị TẮT ⇒ UNKNOWN + hàng chờ, không ghi vào nguồn đã tắt", async () => {
    const nv = await dungNvGt("B");
    await phienAdmin();
    await taoNguon("SRCE_NS", { referrerRequirement: "EMPLOYEE", name: "Nguồn tuỳ biến NS" });
    await db.systemSetting.create({ data: { key: "nguon.nhomNhanSuMacDinh", valueJson: "SRCE_NS" } });
    clearSettingsCache();

    // đang hoạt động ⇒ ghi vào nguồn tuỳ biến, đúng người, không chờ duyệt
    expect(await goiD([dongD(SDT.a, { ma: `${P}NVB` })])).toMatchObject({ success: 1, successWithReview: 0, errors: [] });
    const cus = (await attrCua(SDT.a))!;
    expect(cus.a.group.code).toBe("SRCE_NS");
    expect(cus.a).toMatchObject({ matchedRule: "NV_GIOI_THIEU", referrerEmployeeId: nv.id, referrerMissing: false });
    expect(await trongHangCho(cus.leadId)).toBe(false);

    // nhãn Excel trùng TÊN nguồn tuỳ biến ⇒ vẫn nhãn lạ (fail-closed, không đoán theo tên)
    expect(await goiD([dongD(SDT.b, { nguon: "Nguồn tuỳ biến NS" })])).toMatchObject({ success: 1, successWithReview: 1 });
    const ten = (await attrCua(SDT.b))!;
    expect(ten.a.group.code).toBe("UNKNOWN");
    expect(ten.xemTay).toContain("NHAN_NGUON_LA");

    // nguồn tuỳ biến bị TẮT ⇒ không ghi vào nguồn đã tắt: UNKNOWN + hàng chờ
    await db.leadSourceGroup.update({ where: { code: "SRCE_NS" }, data: { status: "INACTIVE" } });
    clearSettingsCache();
    expect(await goiD([dongD(SDT.c, { ma: `${P}NVB` })])).toMatchObject({ success: 1, successWithReview: 1 });
    const tat = (await attrCua(SDT.c))!;
    expect(tat.a.group.code).toBe("UNKNOWN");
    expect(await trongHangCho(tat.leadId)).toBe(true);

    // nguồn GỐC (PAID_ADS) bị tắt ⇒ nhãn «Ads» không ghi vào nguồn đã tắt; bật lại ⇒ ghi bình thường (đối chứng)
    await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { status: "INACTIVE" } });
    expect(await goiD([dongD(SDT.d, { nguon: "Ads" })])).toMatchObject({ success: 1, successWithReview: 1 });
    const goc = (await attrCua(SDT.d))!;
    expect(goc.a.group.code).toBe("UNKNOWN");
    expect(await trongHangCho(goc.leadId)).toBe(true);
    await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { status: "ACTIVE" } });
    expect(await goiD([dongD(SDT.e, { nguon: "Ads" })])).toMatchObject({ success: 1, successWithReview: 0 });
    expect((await attrCua(SDT.e))!.a.group.code).toBe("PAID_ADS");

    // nguồn gốc HẾT HIỆU LỰC (khoảng hiệu lực, ngày tuyệt đối 2020) cũng KHÔNG nhận lead mới: cùng kết quả như nguồn tắt
    await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { effectiveTo: new Date("2020-01-01T00:00:00.000Z") } });
    expect(await goiD([dongD(SDT.f, { nguon: "Ads" })])).toMatchObject({ success: 1, successWithReview: 1 });
    const hetHan = (await attrCua(SDT.f))!;
    expect(hetHan.a.group.code).toBe("UNKNOWN");
    expect(await trongHangCho(hetHan.leadId)).toBe(true);
  }, CASE);
});
