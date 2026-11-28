import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phiên giả lập (đổi được từng ca); quyền dùng ĐƯỜNG THẬT (RBAC v2 + RoleDef trên Postgres) — không giả lập checkPermission.
let phien: { user: { id: string; name: string; email: string; role: string; roles: string[] } } | null = null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { GET as cauHinhGet } from "@/app/api/admin/online-shipping/route";
import { POST as phuongThucPost } from "@/app/api/admin/online-shipping/methods/route";
import { PATCH as phuongThucPatch } from "@/app/api/admin/online-shipping/methods/[id]/route";
import { PUT as phiPut } from "@/app/api/admin/online-shipping/rates/route";
import { POST as khuVucPost } from "@/app/api/admin/online-shipping/zones/route";
import { PATCH as khuVucPatch } from "@/app/api/admin/online-shipping/zones/[id]/route";
import { db } from "@/lib/db";
import { tinhPhiGiao } from "@/lib/online-checkout/giao-hang";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

/**
 * [SHA] V8.43 — ADMIN API CẤU HÌNH GIAO HÀNG: RBAC v2 BẬT như PROD, Postgres thật.
 *   [SHA-01] Quản trị tối cao ⇒ đọc được cấu hình (đối chứng DƯƠNG); chưa đăng nhập ⇒ 401
 *   [SHA-02] kế toán Hội sở / QL cơ sở / Sale Hội sở ⇒ 403 ở CẢ 6 route, KHÔNG ghi gì (ca âm)
 *   [SHA-03] tạo khu vực → phương thức → phí ⇒ AuditLog trước/sau + lý do; phụ huynh tính phí đúng theo cấu hình VỪA đặt (đầu-cuối với `tinhPhiGiao`)
 *   [SHA-04] `version` lệch ⇒ 409 PHIEN_BAN_CU, không ghi; sửa đúng version ⇒ version+1
 *   [SHA-05] một tỉnh KHÔNG thuộc hai khu vực đang hoạt động (kể cả khác dấu/tiền tố «Thành phố»); khu vực tắt thì được; bật lại bị chặn
 *   [SHA-06] validate: lyDo ≥ 5 ký tự, khoá lạ ⇒ 400, mã sai dạng, phí âm / > trần, tỉnh lặp, mã trùng ⇒ 409
 *   [SHA-07] phí «chỉ vài khu vực»: không đặt phí ở khu vực X ⇒ phương thức NGOÀI VÙNG ở X; tắt phí/phương thức ⇒ không dùng được; đổi phí KHÔNG đổi đơn đã đặt
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "shatest-";
const MA = "T843A"; // tiền tố mã cấu hình của bộ này
const ids: Record<string, string> = {};
const dangNhapLa = (k: string, role: string) => {
  phien = { user: { id: ids[k]!, name: `${NS}${k}`, email: `${NS}${k}@ci.test`, role, roles: [role] } };
};
const req = (method: string, url: string, body?: unknown) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; field?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const LY = "Cập nhật theo chính sách vận chuyển tháng 11";

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.shippingRate.deleteMany({ where: { OR: [{ method: { code: { startsWith: MA } } }, { zone: { code: { startsWith: MA } } }] } });
  await db.shippingMethod.deleteMany({ where: { code: { startsWith: MA } } });
  await db.shippingZone.deleteMany({ where: { code: { startsWith: MA } } });
  await db.parentShippingAddress.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { module: "online-shipping" } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[SHA] Admin API cấu hình giao hàng — RBAC v2, Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const cs1Ou = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    const nguoi: Array<[string, string, string]> = [["admin", "SUPER_ADMIN", "SUPER_ADMIN"], ["ktHo", "ACCOUNTANT", "HO_ACCOUNTANT"], ["qlCs", "CENTER_MANAGER", "CENTER_MANAGER"], ["saleHo", "SALES_CSM", "HO_SALE"], ["ph", "PARENT", "PARENT"]];
    for (const [k, role] of nguoi) ids[k] = (await seedUser({ email: `${NS}${k}@ci.test`, name: `${NS}${k}`, role: role as never, centerId: k === "qlCs" ? cs1.id : null })).id;
    const vai = async (code: string) => (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    await db.userOrgRole.createMany({
      data: [
        { userId: ids.admin!, orgUnitId: goc, roleId: await vai("SUPER_ADMIN"), grantedById: ids.admin! },
        { userId: ids.ktHo!, orgUnitId: goc, roleId: await vai("HO_ACCOUNTANT"), grantedById: ids.admin! },
        { userId: ids.qlCs!, orgUnitId: cs1Ou, roleId: await vai("CENTER_MANAGER"), grantedById: ids.admin! },
        { userId: ids.saleHo!, orgUnitId: goc, roleId: await vai("HO_SALE"), grantedById: ids.admin! },
      ],
      skipDuplicates: true,
    });
  }, 120_000);
  afterAll(async () => {
    phien = null;
    delete process.env.RBAC_V2_ENABLED;
    await don();
  });
  beforeEach(() => {
    phien = null;
  });

  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) as never });
  const taoKhu = (b: Record<string, unknown>) => khuVucPost(req("POST", "/x", { name: "Khu", provinces: ["Đà Nẵng"], lyDo: LY, ...b }));
  const taoPt = (b: Record<string, unknown>) => phuongThucPost(req("POST", "/x", { name: "PT", lyDo: LY, ...b }));
  const datPhi = (b: Record<string, unknown>) => phiPut(req("PUT", "/x", { fee: 30_000, lyDo: LY, ...b }));
  const demAudit = () => db.auditLog.count({ where: { module: "online-shipping" } });

  it("[SHA-01] Quản trị tối cao đọc được; chưa đăng nhập ⇒ 401", async () => {
    expect((await cauHinhGet()).status).toBe(401);
    dangNhapLa("admin", "SUPER_ADMIN");
    const r = await json(await cauHinhGet());
    expect(r.ok).toBe(true);
    expect(r.data).toHaveProperty("khuVuc");
    expect(r.data).toHaveProperty("phuongThuc");
    expect(r.data).toHaveProperty("phi");
  });

  it("[SHA-02] kế toán HO / QL cơ sở / Sale HO / phụ huynh ⇒ 403 ở cả 6 route, KHÔNG ghi gì", async () => {
    const truoc = { zone: await db.shippingZone.count(), method: await db.shippingMethod.count(), rate: await db.shippingRate.count(), aud: await demAudit() };
    for (const [k, role] of [["ktHo", "ACCOUNTANT"], ["qlCs", "CENTER_MANAGER"], ["saleHo", "SALES_CSM"], ["ph", "PARENT"]] as const) {
      dangNhapLa(k, role);
      const st = [
        (await cauHinhGet()).status,
        (await taoKhu({ code: `${MA}_X`, name: "x" })).status,
        (await khuVucPatch(req("PATCH", "/x", { name: "x", version: 1, lyDo: LY }), idCtx("khong-co"))).status,
        (await taoPt({ code: `${MA}_P` })).status,
        (await phuongThucPatch(req("PATCH", "/x", { name: "x", version: 1, lyDo: LY }), idCtx("khong-co"))).status,
        (await datPhi({ methodCode: `${MA}_P`, zoneCode: `${MA}_X` })).status,
      ];
      expect(st, k).toEqual([403, 403, 403, 403, 403, 403]);
    }
    expect({ zone: await db.shippingZone.count(), method: await db.shippingMethod.count(), rate: await db.shippingRate.count(), aud: await demAudit() }).toEqual(truoc);
  });

  it("[SHA-03] tạo khu vực → phương thức → phí: audit trước/sau + lý do; phụ huynh tính phí đúng cấu hình vừa đặt", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    const z = await json(await taoKhu({ code: `${MA}_DN`, name: "Đà Nẵng", provinces: ["Đà Nẵng"] }));
    expect(z.ok, JSON.stringify(z.error)).toBe(true);
    const m = await json(await taoPt({ code: `${MA}_STD`, name: "Giao tiêu chuẩn", etaText: "2–4 ngày", sortOrder: 1 }));
    expect(m.ok, JSON.stringify(m.error)).toBe(true);
    const f = await phiPut(req("PUT", "/x", { methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: 35_000, freeAboveAmount: 2_000_000, lyDo: LY }));
    expect(f.status).toBe(201);
    const f2 = await phiPut(req("PUT", "/x", { methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: 40_000, freeAboveAmount: 2_000_000, lyDo: "Điều chỉnh phí lần hai" }));
    expect(f2.status).toBe(200);
    const au = await db.auditLog.findMany({ where: { module: "online-shipping", entityType: "ShippingRate" }, orderBy: { createdAt: "asc" } });
    expect(au.map((a) => a.action)).toEqual(["CREATE", "UPDATE"]);
    expect(au[1]!.oldValues).toMatchObject({ fee: 35_000 });
    expect(au[1]!.newValues).toMatchObject({ fee: 40_000, lyDo: "Điều chỉnh phí lần hai" });
    expect(au[1]!.actorId).toBe(ids.admin);
    // đầu-cuối: phụ huynh có địa chỉ ở Đà Nẵng ⇒ phí đọc từ cấu hình VỪA đặt
    await db.parentShippingAddress.create({ data: { parentUserId: ids.ph!, hoTen: "A", soDienThoai: "0905123456", tinhThanh: "Thành phố Đà Nẵng", phuongXa: "x", soNhaDuong: "1" } });
    expect(await tinhPhiGiao(db as never, { parentUserId: ids.ph!, phuongThuc: `${MA}_STD`, tamTinhHang: 500_000 })).toMatchObject({ ok: true, phi: 40_000 });
    expect(await tinhPhiGiao(db as never, { parentUserId: ids.ph!, phuongThuc: `${MA}_STD`, tamTinhHang: 2_000_000 })).toMatchObject({ ok: true, phi: 0 }); // miễn phí từ ngưỡng
  });

  it("[SHA-04] version lệch ⇒ 409 PHIEN_BAN_CU, không ghi; đúng version ⇒ +1", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    const cfg = (await json(await cauHinhGet())).data;
    const z = cfg.khuVuc.find((x: { code: string }) => x.code === `${MA}_DN`);
    const m = cfg.phuongThuc.find((x: { code: string }) => x.code === `${MA}_STD`);
    const a0 = await demAudit();
    const cu = await khuVucPatch(req("PATCH", "/x", { name: "Đà Nẵng mới", version: z.version + 5, lyDo: LY }), idCtx(z.id));
    expect([cu.status, (await json(cu)).error?.code]).toEqual([409, "PHIEN_BAN_CU"]);
    expect((await db.shippingZone.findUniqueOrThrow({ where: { id: z.id } })).name).toBe("Đà Nẵng");
    expect(await demAudit()).toBe(a0);
    const ok1 = await json(await khuVucPatch(req("PATCH", "/x", { name: "Đà Nẵng mới", version: z.version, lyDo: LY }), idCtx(z.id)));
    expect(ok1).toMatchObject({ ok: true, data: { version: z.version + 1 } });
    const au = await db.auditLog.findFirstOrThrow({ where: { module: "online-shipping", entityType: "ShippingZone", entityId: z.id, action: "UPDATE" } });
    expect(au.oldValues).toMatchObject({ name: "Đà Nẵng", version: z.version }); // audit giữ GIÁ TRỊ CŨ + lý do
    expect(au.newValues).toMatchObject({ name: "Đà Nẵng mới", lyDo: LY });
    const lai = await khuVucPatch(req("PATCH", "/x", { name: "Lại", version: z.version, lyDo: LY }), idCtx(z.id)); // dùng lại version cũ
    expect(lai.status).toBe(409);
    const pt = await phuongThucPatch(req("PATCH", "/x", { name: "Tiêu chuẩn+", version: m.version, lyDo: LY }), idCtx(m.id));
    expect(pt.status).toBe(200);
    expect((await phuongThucPatch(req("PATCH", "/x", { name: "x", version: m.version, lyDo: LY }), idCtx(m.id))).status).toBe(409);
    expect((await khuVucPatch(req("PATCH", "/x", { name: "x", version: 1, lyDo: LY }), idCtx("khong-co"))).status).toBe(404);
  });

  it("[SHA-05] một tỉnh KHÔNG thuộc hai khu vực đang hoạt động; khu vực tắt thì được; bật lại bị chặn", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    const trung = await taoKhu({ code: `${MA}_TRUNG`, name: "Trùng", provinces: ["da nang"] }); // khác dấu/hoa thường
    expect([trung.status, (await json(trung)).error?.code]).toEqual([409, "TINH_TRUNG_KHU_VUC"]);
    const tat = await json(await taoKhu({ code: `${MA}_TAT`, name: "Tắt", provinces: ["Đà Nẵng"], isActive: false }));
    expect(tat.ok, JSON.stringify(tat.error)).toBe(true);
    const cfg = (await json(await cauHinhGet())).data;
    const t = cfg.khuVuc.find((x: { code: string }) => x.code === `${MA}_TAT`);
    const bat = await khuVucPatch(req("PATCH", "/x", { isActive: true, version: t.version, lyDo: LY }), idCtx(t.id));
    expect([bat.status, (await json(bat)).error?.code]).toEqual([409, "TINH_TRUNG_KHU_VUC"]);
    // khu vực đã TẮT không chặn ai: tỉnh chỉ nằm ở khu đã tắt ⇒ khu đang hoạt động mới được lấy
    expect((await taoKhu({ code: `${MA}_TAT2`, name: "Tắt 2", provinces: ["Huế"], isActive: false })).status).toBe(201);
    expect((await taoKhu({ code: `${MA}_HUE`, name: "Huế", provinces: ["Huế"] })).status).toBe(201);
    // khu vực khác, tỉnh khác ⇒ được
    expect((await taoKhu({ code: `${MA}_HN`, name: "Hà Nội", provinces: ["Hà Nội", "Bắc Ninh"] })).status).toBe(201);
    // sửa danh sách tỉnh của khu đang hoạt động sang tỉnh đã có ở khu khác ⇒ chặn
    const hn = (await json(await cauHinhGet())).data.khuVuc.find((x: { code: string }) => x.code === `${MA}_HN`);
    const sua = await khuVucPatch(req("PATCH", "/x", { provinces: ["Hà Nội", "Thành phố Đà Nẵng"], version: hn.version, lyDo: LY }), idCtx(hn.id));
    expect([sua.status, (await json(sua)).error?.code]).toEqual([409, "TINH_TRUNG_KHU_VUC"]);
  });

  it("[SHA-06] validate: lý do ≥ 5, khoá lạ, mã sai dạng, phí âm/quá trần, tỉnh lặp, mã trùng", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    const a0 = await demAudit();
    const xau = [
      await taoKhu({ code: `${MA}_V1`, lyDo: "ngắn" }),
      await taoKhu({ code: `${MA}_V2`, hack: 1 }),
      await taoKhu({ code: "chu thuong", provinces: ["Huế"] }),
      await taoKhu({ code: `${MA}_V4`, provinces: [] }),
      await taoPt({ code: `${MA}_V5`, isActive: "yes" }),
      await datPhi({ methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: -1 }),
      await datPhi({ methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: 5_000_001 }),
      await datPhi({ methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: 1.5 }),
      await datPhi({ methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, freeAboveAmount: -5 }),
    ];
    expect(xau.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400]);
    const lap = await taoKhu({ code: `${MA}_V6`, provinces: ["Huế", "hue"] });
    expect([lap.status, (await json(lap)).error?.code]).toEqual([400, "TINH_TRUNG_TRONG_KHU_VUC"]);
    expect([(await taoKhu({ code: `${MA}_DN`, provinces: ["Cần Thơ"] })).status, (await taoPt({ code: `${MA}_STD` })).status]).toEqual([409, 409]);
    expect((await datPhi({ methodCode: `${MA}_KHONGCO`, zoneCode: `${MA}_DN` })).status).toBe(404);
    expect((await khuVucPost(new Request("http://localhost/x", { method: "POST", body: "không phải json" }))).status).toBe(400);
    expect(await demAudit()).toBe(a0); // không lỗi nào để lại dấu
    expect(await db.shippingZone.count({ where: { code: { in: [`${MA}_V1`, `${MA}_V2`, `${MA}_V4`, `${MA}_V6`] } } })).toBe(0);
  });

  it("[SHA-07] «chỉ vài khu vực»: không đặt phí ở khu vực X ⇒ NGOÀI VÙNG; tắt phí/phương thức ⇒ không dùng được; đổi phí KHÔNG đổi đơn đã đặt", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    expect((await taoPt({ code: `${MA}_EXP`, name: "Giao nhanh", sortOrder: 2 })).status).toBe(201);
    expect((await datPhi({ methodCode: `${MA}_EXP`, zoneCode: `${MA}_HN`, fee: 60_000 })).status).toBe(201); // chỉ Hà Nội
    // phụ huynh ở Đà Nẵng: giao nhanh KHÔNG có phí ở khu của họ
    const dn = await tinhPhiGiao(db as never, { parentUserId: ids.ph!, phuongThuc: `${MA}_EXP`, tamTinhHang: 100_000 });
    expect(dn).toMatchObject({ ok: false, ma: "PHUONG_THUC_GIAO_KHONG_HOP_LE" });
    // tắt phí tiêu chuẩn ở ĐN ⇒ không dùng được
    expect((await datPhi({ methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: 40_000, freeAboveAmount: 2_000_000, isActive: false })).status).toBe(200);
    expect(await tinhPhiGiao(db as never, { parentUserId: ids.ph!, phuongThuc: `${MA}_STD`, tamTinhHang: 100_000 })).toMatchObject({ ok: false });
    // bật lại + tắt PHƯƠNG THỨC ⇒ không dùng được
    expect((await datPhi({ methodCode: `${MA}_STD`, zoneCode: `${MA}_DN`, fee: 40_000, freeAboveAmount: 2_000_000, isActive: true })).status).toBe(200);
    expect(await tinhPhiGiao(db as never, { parentUserId: ids.ph!, phuongThuc: `${MA}_STD`, tamTinhHang: 100_000 })).toMatchObject({ ok: true, phi: 40_000 });
    const m = (await json(await cauHinhGet())).data.phuongThuc.find((x: { code: string }) => x.code === `${MA}_STD`);
    expect((await phuongThucPatch(req("PATCH", "/x", { isActive: false, version: m.version, lyDo: LY }), idCtx(m.id))).status).toBe(200);
    expect(await tinhPhiGiao(db as never, { parentUserId: ids.ph!, phuongThuc: `${MA}_STD`, tamTinhHang: 100_000 })).toMatchObject({ ok: false });
  });
});
