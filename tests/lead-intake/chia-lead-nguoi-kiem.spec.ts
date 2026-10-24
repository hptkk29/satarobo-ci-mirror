// @vitest-environment node
/**
 * [CLN-*] — «QUẢN LÝ CHIA LEAD» + ghi chú lead cho NGƯỜI KIÊM HAI VAI, chạy ĐÚNG handler thật trên Postgres LOCAL
 * (rà độc lập 20/10/2026, M1 + L1 — họ «NHÌN THẤY ≠ ĐƯỢC GHI»).
 *
 * Người kiêm = CENTER_MANAGER@CS1 (giữ `lead_pool:manage`, `leads:overwrite` ở CS1) + CENTER_SALES_CSM@CS2 (chỉ thấy CS2). `visibleCenterIds` của họ = [CS1, CS2]:
 *   · M1 — Server Action `tatNhanLeadAction({centerId: CS2})` từng qua cổng; route xuất + lịch sử kéo được sổ chia CS2 (và `?co_so=` ĐÈ danh sách cơ sở được phép);
 *   · L1 — `updateLeadNote` ĐÈ ghi chú lead CS2 (đúng ra chỉ được nối thêm).
 * Mỗi ca «bị chặn» có ĐỐI CHỨNG DƯƠNG (luật 11): cùng người làm việc đó ở CS1 ⇒ được; vai ALL (SUPER_ADMIN neo HO) ⇒ được ở CS2; QLCS thuần CS1 vẫn quản CS1.
 *
 *   [CLN-00] fixture thật sự tái hiện lỗi gốc (kiêm «thấy» CS2 nhưng không giữ `lead_pool:manage` ở CS2)
 *   [CLN-01] 3 action GHI pool: kiêm bị chặn ở CS2 (DB không đổi), được ở CS1; QLCS thuần bị chặn ở CS2; SUPER_ADMIN được ở CS2
 *   [CLN-02] route xuất sổ chia: tầm nhìn = CS1; `?co_so=CS2` ⇒ 400 (kiêm VÀ QLCS thuần — lỗi spread đè); SUPER_ADMIN thấy cả hai
 *   [CLN-03] route xuất che SĐT khi bị DENY cấp trường `phone` của `leads:view-pii`; không bị ⇒ SĐT thật
 *   [CLN-04] `updateLeadNote`: kiêm đè ghi chú lead CS2 ⇒ chỉ NỐI THÊM; lead CS1 ⇒ đè được; SUPER_ADMIN đè được lead CS2
 *   (đối chứng dương KHÔNG phải SUPER_ADMIN: HO_MARKETING neo HO giữ `leads:rotation-view` với `centerScope: "ALL"` — đường `tamNhinCuaKhoa` nhánh "ALL", khác nhánh bypass của SUPER_ADMIN; ở CLN-00/05/06)
 *   [CLN-05] trang «Quản lý chia lead» (gọi thẳng RSC): `?co_so=CS2` của người kiêm QLCS@CS1 + Kế toán@CS2 rơi về CS1; SUPER_ADMIN chọn được CS2;
 *            Sale@CS2 (giữ `leads:rotation-view` — khoá thứ HAI gác trang, S-5) vẫn mở được sổ CS2 của chính cơ sở mình: theo ĐÚNG khoá gác trang
 *   [CLN-06] trang lịch sử pool: như trên, `?co_so=CS2` KHÔNG hiện sự kiện của CS2 cho người không giữ khoá nào ở CS2 (lỗi spread đè `id`)
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `CHIALEAD_`. ⚠️ LUẬT 18: mỗi ca tự dựng dữ liệu của mình trong `beforeEach`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string; tokenVersion: number } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: () => {},
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.9" }),
}));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { coQuyenTaiCoSo, tamNhinCuaKhoa } from "../../lib/auth/quyen-tai-co-so";
import { KHOA_TRANG_CHIA_LEAD } from "../../lib/lead/pham-vi-so-chia";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { GET as xuatSoChia } from "../../app/api/admin/crm/so-chia-lead-export/route";
import { batNhanLeadAction, themSaleVaoPoolAction, tatNhanLeadAction } from "../../app/(admin)/admin/quan-ly-chia-lead/_actions";
import { updateLeadNote } from "../../app/(admin)/admin/leads/actions";
import QuanLyChiaLeadPage from "../../app/(admin)/admin/quan-ly-chia-lead/page";
import LichSuPoolPage from "../../app/(admin)/admin/quan-ly-chia-lead/lich-su/page";
import { orgUnitIdCuaCoSo } from "../../lib/lead/pool";
import { damBaoToChuc } from "./_nguon-fixture";
import { syncPermissionRegistry } from "../../prisma/seed-permission-registry";

const RUN = RUN_DB_TESTS;
const P = "CHIALEAD_";
const CASE = 90_000;
const SDT = { cs1: "0903555001", cs2: "0903555002" } as const;

/** `Vai` = mã `RoleDef` (RBAC v2, quyền thật); `VaiCu` = enum `Role` của `User.role/roles` (v1 + phiên). Hai không gian KHÁC tên: `CENTER_SALES_CSM` ↔ `SALES_CSM`. */
type Vai = "CENTER_MANAGER" | "CENTER_SALES_CSM" | "CENTER_ACCOUNTANT" | "HO_MARKETING" | "SUPER_ADMIN";
type VaiCu = "CENTER_MANAGER" | "SALES_CSM" | "ACCOUNTANT" | "MARKETING" | "SUPER_ADMIN";
type NguoiDung = { id: string; email: string };

async function xoaNguoiDung(): Promise<void> {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.leadAssignmentPoolEvent.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: ids } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: Object.values(SDT) } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadAssignmentLog.deleteMany({ where: { leadId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await xoaNguoiDung();
  const cmRole = await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } });
  if (cmRole) await db.permissionGrant.deleteMany({ where: { subjectType: "ROLE", subjectId: cmRole.id, permissionKey: "leads:view-pii" } });
}

/** Tạo user + gắn vai theo (đơn vị, vai) — quyền THẬT của actor (RBAC v2) đến từ UserOrgRole, không phải User.role. */
async function dungNguoi(ten: string, role: VaiCu, roles: VaiCu[], gan: ReadonlyArray<readonly [string, Vai]>, coSoChinh: string | null): Promise<NguoiDung> {
  const email = `${P}${ten}@example.test`;
  const u = await db.user.create({
    data: { name: `${P}${ten}`, email, role, roles, centerId: coSoChinh, isActive: true },
    select: { id: true },
  });
  for (const [donVi, maVai] of gan) {
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: donVi }, select: { id: true } });
    const rd = await db.roleDef.findUniqueOrThrow({ where: { code: maVai }, select: { id: true } });
    // `effectiveFrom` lùi 1 giờ: đồng hồ DB đi trước Node ~1 ms nên mặc định `now()` có thể chưa hiệu lực (luật 19).
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: rd.id, grantedById: "chialead", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  }
  return { id: u.id, email };
}

function phien(u: NguoiDung, role: VaiCu, roles: VaiCu[], centerId: string | null): void {
  SESS.current = { user: { id: u.id, role, roles, centerId, name: `${P}${u.email}`, email: u.email, tokenVersion: 0 } };
}

/** Đi qua cây React element do RSC trả về (KHÔNG render): gom mọi chuỗi chữ + mọi prop `centerId` của các thành phần con. */
function thuThap(node: unknown, ra: { chuoi: string[]; centerId: Set<string> }): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    ra.chuoi.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) thuThap(n, ra);
    return;
  }
  if (typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return;
    if (typeof props.centerId === "string") ra.centerId.add(props.centerId);
    for (const v of Object.values(props)) thuThap(v, ra);
  }
}
async function docTrang(trang: (a: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<unknown>, sp: Record<string, string | undefined>) {
  const ra = { chuoi: [] as string[], centerId: new Set<string>() };
  thuThap(await trang({ searchParams: Promise.resolve(sp) }), ra);
  return ra;
}

describe.skipIf(!RUN)("Quản lý chia lead + ghi chú lead — người KIÊM hai vai (Postgres thật)", () => {
  let cs1 = "";
  let cs2 = "";
  let ou1 = "";
  let ou2 = "";
  let kiem: NguoiDung;
  let hoMkt: NguoiDung; // HO_MARKETING neo HO: không phải SUPER_ADMIN nhưng `leads:rotation-view` có centerScope "ALL" — người neo HO phải vẫn thấy mọi cơ sở
  let kiemKt: NguoiDung; // QLCS@CS1 + Kế toán@CS2: «thấy» CS2 nhưng KHÔNG giữ khoá nào gác trang (lead_pool:manage · leads:rotation-view) ở CS2
  let qlcs1: NguoiDung;
  let admin: NguoiDung;
  let sale1: NguoiDung;
  let sale2: NguoiDung;
  let leadCs1 = "";
  let leadCs2 = "";

  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_MANAGER", "CENTER_SALES_CSM", "CENTER_ACCOUNTANT", "HO_MARKETING", "SUPER_ADMIN"] });
    await syncPermissionRegistry(db); // FK PermissionGrant.permissionKey → registry (ca [CLN-03])
  }, 120_000);

  beforeEach(async () => {
    await don();
    SESS.current = null;
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    ou1 = (await orgUnitIdCuaCoSo(cs1))!;
    ou2 = (await orgUnitIdCuaCoSo(cs2))!;
    kiem = await dungNguoi("kiem", "CENTER_MANAGER", ["CENTER_MANAGER", "SALES_CSM"], [["CS1", "CENTER_MANAGER"], ["CS2", "CENTER_SALES_CSM"]], cs1);
    hoMkt = await dungNguoi("homkt", "MARKETING", ["MARKETING"], [["HO", "HO_MARKETING"]], null);
    kiemKt = await dungNguoi("kiemkt", "CENTER_MANAGER", ["CENTER_MANAGER", "ACCOUNTANT"], [["CS1", "CENTER_MANAGER"], ["CS2", "CENTER_ACCOUNTANT"]], cs1);
    qlcs1 = await dungNguoi("qlcs1", "CENTER_MANAGER", ["CENTER_MANAGER"], [["CS1", "CENTER_MANAGER"]], cs1);
    admin = await dungNguoi("admin", "SUPER_ADMIN", ["SUPER_ADMIN"], [["HO", "SUPER_ADMIN"]], null);
    sale1 = await dungNguoi("sale1", "SALES_CSM", ["SALES_CSM"], [["CS1", "CENTER_SALES_CSM"]], cs1);
    sale2 = await dungNguoi("sale2", "SALES_CSM", ["SALES_CSM"], [["CS2", "CENTER_SALES_CSM"]], cs2);
    const l1 = await db.lead.create({ data: { parentName: `${P}PH_CS1`, phone: SDT.cs1, status: "MOI", source: "Website", centerId: cs1, note: "Ghi chú gốc CS1" }, select: { id: true } });
    const l2 = await db.lead.create({ data: { parentName: `${P}PH_CS2`, phone: SDT.cs2, status: "MOI", source: "Website", centerId: cs2, note: "Ghi chú gốc CS2" }, select: { id: true } });
    leadCs1 = l1.id;
    leadCs2 = l2.id;
    await db.leadAssignmentLog.create({ data: { leadId: leadCs1, orgUnitId: ou1, assignedToId: sale1.id, createdById: admin.id, source: "MANAGER", consumedTurn: false } });
    await db.leadAssignmentLog.create({ data: { leadId: leadCs2, orgUnitId: ou2, assignedToId: sale2.id, createdById: admin.id, source: "MANAGER", consumedTurn: false } });
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  const dongPool = (orgUnitId: string, userId: string) => db.leadRotationTurn.findUnique({ where: { orgUnitId_userId: { orgUnitId, userId } }, select: { isActive: true } });
  const suKien = (orgUnitId: string) => db.leadAssignmentPoolEvent.count({ where: { orgUnitId, userId: { in: [sale1.id, sale2.id] } } });
  const phienKiem = () => phien(kiem, "CENTER_MANAGER", ["CENTER_MANAGER", "SALES_CSM"], cs1);
  const phienHoMkt = () => phien(hoMkt, "MARKETING", ["MARKETING"], null);
  const phienKiemKt = () => phien(kiemKt, "CENTER_MANAGER", ["CENTER_MANAGER", "ACCOUNTANT"], cs1);

  /** Chỉ các dòng của bộ này (tên PH có tiền tố `P`): bộ `test:lead-intake` chạy chung một DB và các tệp khác để lại dòng sổ chia không dọn (luật 18). */
  async function docXlsx(res: Response): Promise<(string | number)[][]> {
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    return XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets["SoChiaLead"], { header: 1 }).slice(1).filter((r) => String(r[1] ?? "").startsWith(P));
  }
  const req = (qs = "") => new NextRequest(`http://localhost/api/admin/crm/so-chia-lead-export${qs}`);

  it("[CLN-00] fixture tái hiện lỗi gốc: kiêm «THẤY» CS2 (visibleCenterIds) nhưng KHÔNG giữ `lead_pool:manage` ở CS2; đối chứng: giữ ở CS1; SUPER_ADMIN giữ ở mọi cơ sở", async () => {
    const a = await resolveActorUncached(kiem.id);
    expect(a.visibleCenterIds).toContain(cs2); // nếu không thấy CS2 thì mọi ca dưới xanh vì lý do sai
    expect(a.visibleCenterIds).toContain(cs1);
    expect(coQuyenTaiCoSo(a, "lead_pool:manage", cs2)).toBe(false);
    expect(coQuyenTaiCoSo(a, "lead_pool:manage", cs1)).toBe(true);
    const ad = await resolveActorUncached(admin.id);
    expect(coQuyenTaiCoSo(ad, "lead_pool:manage", cs2)).toBe(true);
    const ho = await resolveActorUncached(hoMkt.id);
    expect(tamNhinCuaKhoa(ho, ...KHOA_TRANG_CHIA_LEAD)).toBe("ALL"); // người neo HO (không phải SUPER_ADMIN) vẫn thấy mọi cơ sở qua centerScope "ALL"
    expect(ho.isSuperAdmin).toBe(false);
    const kt = await resolveActorUncached(kiemKt.id);
    expect(kt.visibleCenterIds).toContain(cs2); // kiêm Kế toán cũng «thấy» CS2 — nhưng không giữ khoá gác trang nào ở đó
    expect(tamNhinCuaKhoa(kt, ...KHOA_TRANG_CHIA_LEAD)).toEqual([cs1]);
    expect(tamNhinCuaKhoa(a, ...KHOA_TRANG_CHIA_LEAD)).toEqual(expect.arrayContaining([cs1, cs2])); // Sale@CS2 giữ rotation-view ở CS2
  }, CASE);

  it("[CLN-01a] kiêm tắt/bật/thêm người của CS2 ⇒ TỪ CHỐI, DB KHÔNG đổi; ĐỐI CHỨNG DƯƠNG: cùng người, cùng thao tác ở CS1 ⇒ ghi thật", async () => {
    // Cấy: `gac` về `actor.visibleCenterIds.includes(centerId)` ⇒ ba lời gọi CS2 dưới đây trả ok:true và ghi vào pool CS2 (đỏ).
    phienKiem();
    const chan = "Cơ sở này không thuộc phạm vi của bạn";
    expect(await tatNhanLeadAction({ centerId: cs2, userId: sale2.id, reason: "thử" })).toEqual({ ok: false, error: chan });
    expect(await themSaleVaoPoolAction({ centerId: cs2, userId: sale2.id })).toEqual({ ok: false, error: chan });
    expect(await batNhanLeadAction({ centerId: cs2, userId: sale2.id })).toEqual({ ok: false, error: chan });
    expect(await dongPool(ou2, sale2.id)).toBeNull();
    expect(await suKien(ou2)).toBe(0);

    expect(await tatNhanLeadAction({ centerId: cs1, userId: sale1.id, reason: "nghỉ phép" })).toEqual({ ok: true });
    expect((await dongPool(ou1, sale1.id))?.isActive).toBe(false);
    expect(await suKien(ou1)).toBe(1);
  }, CASE);

  it("[CLN-01b] QLCS thuần CS1 vẫn quản CS1 và bị chặn ở CS2; SUPER_ADMIN (neo HO) ghi được CS2 — không chặn quá tay", async () => {
    phien(qlcs1, "CENTER_MANAGER", ["CENTER_MANAGER"], cs1);
    expect((await tatNhanLeadAction({ centerId: cs1, userId: sale1.id, reason: "nghỉ" })).ok).toBe(true);
    expect((await tatNhanLeadAction({ centerId: cs2, userId: sale2.id, reason: "thử" })).ok).toBe(false);
    expect(await dongPool(ou2, sale2.id)).toBeNull();

    phien(admin, "SUPER_ADMIN", ["SUPER_ADMIN"], null);
    expect((await tatNhanLeadAction({ centerId: cs2, userId: sale2.id, reason: "quản trị tắt" })).ok).toBe(true);
    expect((await dongPool(ou2, sale2.id))?.isActive).toBe(false);
  }, CASE);

  it("[CLN-02] route xuất sổ chia: kiêm chỉ kéo được sổ CS1 — `?co_so=CS2` ⇒ 400; QLCS thuần cũng vậy (lỗi spread đè `id`); SUPER_ADMIN thấy cả hai và lọc được từng cơ sở", async () => {
    // Cấy: `locCoSoTheoTamNhin(tam, q.get("co_so"))` → `{ ...(co_so ? { id: co_so } : {}) }` (spread đè) ⇒ hai ca 400 dưới đây thành 200 (đỏ); cấy: tầm nhìn về `visibleCenterIds` ⇒ ca kiêm không co_so thấy cả CS2 (đỏ).
    phienKiem();
    const khongCoSo = await xuatSoChia(req());
    expect(khongCoSo.status).toBe(200);
    const dong = await docXlsx(khongCoSo);
    expect(dong.map((r) => r[1])).toEqual([`${P}PH_CS1`]); // chỉ CS1; không có dòng của CS2
    const ngoai = await xuatSoChia(req(`?co_so=${cs2}`));
    expect(ngoai.status).toBe(400);
    expect(((await ngoai.json()) as { error: string }).error).toBe("Không có cơ sở nào trong phạm vi");
    expect((await xuatSoChia(req(`?co_so=${cs1}`))).status).toBe(200); // đối chứng dương: chọn đúng cơ sở của mình

    phien(qlcs1, "CENTER_MANAGER", ["CENTER_MANAGER"], cs1);
    expect((await xuatSoChia(req(`?co_so=${cs2}`))).status).toBe(400); // lỗi spread: cơ sở khác lọt qua dù QLCS thuần
    expect((await xuatSoChia(req())).status).toBe(200);

    phien(admin, "SUPER_ADMIN", ["SUPER_ADMIN"], null);
    const tatCa = await docXlsx(await xuatSoChia(req()));
    expect(tatCa.map((r) => r[1]).sort()).toEqual([`${P}PH_CS1`, `${P}PH_CS2`]);
    const chiCs2 = await docXlsx(await xuatSoChia(req(`?co_so=${cs2}`)));
    expect(chiCs2.map((r) => r[1])).toEqual([`${P}PH_CS2`]);
  }, CASE);

  it("[CLN-03] route xuất che SĐT ở SERVER khi `leads:view-pii` bị DENY cấp trường `phone`; không bị ⇒ SĐT thật (đối chứng dương)", async () => {
    // Cấy: bỏ `anPiiSoChia` (ghi `rows` thô) ⇒ ca che SĐT đỏ; cấy: `xemSdt: xemPii` (bỏ mặt nạ trường) ⇒ ca che SĐT đỏ.
    phienKiem();
    const dongCs1 = (dong: (string | number)[][]) => dong.find((r) => r[1] === `${P}PH_CS1`)!; // tìm theo tên, không theo vị trí dòng
    const thuong = await docXlsx(await xuatSoChia(req()));
    expect(String(dongCs1(thuong)[2])).toContain(SDT.cs1.slice(1)); // đối chứng: bình thường thấy SĐT thật

    const cm = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_MANAGER" }, select: { id: true } });
    await db.permissionGrant.create({ data: { subjectType: "ROLE", subjectId: cm.id, permissionKey: "leads:view-pii", effect: "DENY", dataScope: "ALL", fieldMask: ["phone"] } });
    const che = await xuatSoChia(req());
    expect(che.status).toBe(200);
    const dong = await docXlsx(che);
    expect(String(dongCs1(dong)[2])).not.toContain(SDT.cs1.slice(1)); // SĐT đã bị che
    expect(dongCs1(dong)[1]).toBe(`${P}PH_CS1`); // DENY riêng trường phone — tên PH không bị che
  }, CASE);

  it("[CLN-04] `updateLeadNote`: kiêm đè ghi chú lead CS2 ⇒ chỉ NỐI THÊM (ghi chú cũ còn nguyên); ĐỐI CHỨNG DƯƠNG: lead CS1 ⇒ đè được; SUPER_ADMIN đè được lead CS2", async () => {
    // Cấy: bỏ `&& coQuyenTaiCoSo(actor, 'leads:overwrite', before.centerId)` ở `duocDe` ⇒ ca CS2 của kiêm đè mất ghi chú cũ (đỏ).
    const note = (id: string) => db.lead.findUniqueOrThrow({ where: { id }, select: { note: true } }).then((l) => l.note ?? "");

    phienKiem();
    expect((await updateLeadNote(leadCs2, "Viết đè hoàn toàn")).ok).toBe(true);
    const sau2 = await note(leadCs2);
    expect(sau2).toContain("Ghi chú gốc CS2"); // KHÔNG bị đè: phần cũ còn
    expect(sau2).toContain("Viết đè hoàn toàn"); // phần mới được nối xuống dưới

    expect((await updateLeadNote(leadCs1, "Viết đè hoàn toàn")).ok).toBe(true);
    const sau1 = await note(leadCs1);
    expect(sau1).toContain("Viết đè hoàn toàn");
    expect(sau1).not.toContain("Ghi chú gốc CS1"); // người giữ overwrite ở CS1 đè được lead CS1

    phien(admin, "SUPER_ADMIN", ["SUPER_ADMIN"], null);
    expect((await updateLeadNote(leadCs2, "Quản trị viết lại")).ok).toBe(true);
    const sauAd = await note(leadCs2);
    expect(sauAd).toContain("Quản trị viết lại");
    expect(sauAd).not.toContain("Ghi chú gốc CS2"); // vai ALL đè được ở CS2
  }, CASE);

  it("[CLN-05] trang «Quản lý chia lead»: QLCS@CS1 kiêm Kế toán@CS2 gõ `?co_so=CS2` ⇒ KHÔNG chọn được CS2 (rơi về CS1); ĐỐI CHỨNG DƯƠNG: chọn được CS1; SUPER_ADMIN chọn được CS2; Sale@CS2 (giữ rotation-view) chọn được CS2", async () => {
    // Cấy: PAGE dùng `actor.visibleCenterIds` thay `tamNhinCuaKhoa` ⇒ danh sách cơ sở có CS2, trang chọn CS2 cho kiêm Kế toán (đỏ).
    phienKiemKt();
    expect([...(await docTrang(QuanLyChiaLeadPage, { co_so: cs2 })).centerId]).toEqual([cs1]);
    expect([...(await docTrang(QuanLyChiaLeadPage, { co_so: cs1 })).centerId]).toEqual([cs1]);
    phien(admin, "SUPER_ADMIN", ["SUPER_ADMIN"], null);
    expect([...(await docTrang(QuanLyChiaLeadPage, { co_so: cs2 })).centerId]).toEqual([cs2]);
    phienKiem(); // theo ĐÚNG khoá gác trang: rotation-view ở CS2 cho phép MỞ sổ CS2 (ghi vẫn bị chặn — CLN-01a)
    expect([...(await docTrang(QuanLyChiaLeadPage, { co_so: cs2 })).centerId]).toEqual([cs2]);
    phienHoMkt(); // đối chứng dương KHÔNG phải SUPER_ADMIN: người neo HO (centerScope "ALL") vẫn chọn được mọi cơ sở
    expect([...(await docTrang(QuanLyChiaLeadPage, { co_so: cs2 })).centerId]).toEqual([cs2]);
    expect([...(await docTrang(QuanLyChiaLeadPage, { co_so: cs1 })).centerId]).toEqual([cs1]);
  }, CASE);

  it("[CLN-06] trang lịch sử pool: QLCS@CS1 kiêm Kế toán@CS2 gõ `?co_so=CS2` ⇒ KHÔNG thấy sự kiện của CS2 (lỗi spread đè `id`); không `co_so` ⇒ chỉ CS1; ĐỐI CHỨNG DƯƠNG: SUPER_ADMIN thấy CS2", async () => {
    // Cấy: trong LICH_SU spread thêm `...(sp.co_so ? { id: sp.co_so } : {})` sau `locCoSoTheoTamNhin` ⇒ kiêm Kế toán thấy `lydo-cs2` (đỏ).
    phien(admin, "SUPER_ADMIN", ["SUPER_ADMIN"], null);
    expect((await tatNhanLeadAction({ centerId: cs1, userId: sale1.id, reason: "lydo-cs1" })).ok).toBe(true);
    expect((await tatNhanLeadAction({ centerId: cs2, userId: sale2.id, reason: "lydo-cs2" })).ok).toBe(true);

    phienKiemKt();
    const cs2Kiem = (await docTrang(LichSuPoolPage, { co_so: cs2 })).chuoi;
    expect(cs2Kiem).not.toContain("lydo-cs2");
    const moiKiem = (await docTrang(LichSuPoolPage, {})).chuoi;
    expect(moiKiem).toContain("lydo-cs1"); // đối chứng: vẫn thấy lịch sử cơ sở mình quản
    expect(moiKiem).not.toContain("lydo-cs2");

    phien(admin, "SUPER_ADMIN", ["SUPER_ADMIN"], null);
    expect((await docTrang(LichSuPoolPage, { co_so: cs2 })).chuoi).toContain("lydo-cs2");
    phienHoMkt(); // đối chứng dương KHÔNG phải SUPER_ADMIN: HO_MARKETING (centerScope "ALL") thấy cả hai cơ sở
    const hoTatCa = (await docTrang(LichSuPoolPage, {})).chuoi;
    expect(hoTatCa).toContain("lydo-cs1");
    expect(hoTatCa).toContain("lydo-cs2");
  }, CASE);
});
