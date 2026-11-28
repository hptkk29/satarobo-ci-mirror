import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phiên giả lập (đổi được từng ca); `checkPermission` + `resolveActor` đi ĐƯỜNG THẬT trên Postgres (RoleDef/UserOrgRole thật) — không giả lập quyền.
let phien: { user: { id: string; name: string; email: string; role: string; roles: string[]; grants: { action: string; grant: "ALLOW" }[] } } | null = null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { GET as dsGet } from "@/app/api/admin/online-fulfillment/route";
import { POST as thuLaiPost } from "@/app/api/admin/online-fulfillment/[id]/retry/route";
import { POST as chuyenPost } from "@/app/api/admin/online-fulfillment/[id]/transition/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

/**
 * [VHQ-DB] CỔNG QUYỀN ADMIN API GIAO HÀNG ONLINE — RoleDef/UserOrgRole thật, chạy CẢ RBAC v1 (cờ tắt) lẫn v2 (cờ bật).
 *   Hai khoá CHUYÊN BIỆT, tách nhau: `online_fulfillment:view-pii` (đọc danh sách + PII người nhận) · `online_fulfillment:update` (đổi trạng thái, thử lại).
 *   KHÔNG vai nào trong seed được cấp sẵn ⇒ ngoài Quản trị tối cao, chỉ người được GÁN RÕ (khoá giữ ở tầm toàn hệ + cấp Hội sở) mới vào được.
 *   [VHQ-01] đối chứng DƯƠNG: Quản trị tối cao (UserOrgRole tại Hội sở) ⇒ đọc được PII + chuyển được
 *   [VHQ-02] mọi vai SẴN CÓ khác ⇒ 403 cả ba route, không đổi dòng, không nhật ký (gồm Kế toán Hội sở, vai giữ `inventory:*`, tổ hợp QLCS@HO + Kế toán@HO mà cổng cũ cho GHI,
 *            và Quản trị tối cao chỉ ghi ở `User.role` mà không có `UserOrgRole`)
 *   [VHQ-03] gán RÕ khoá ĐỌC (grant riêng + vai Hội sở) ⇒ đọc được, KHÔNG ghi được · [VHQ-04] gán RÕ khoá GHI ⇒ ghi được, KHÔNG đọc được PII
 *   [VHQ-05] (chỉ v2) gán qua RoleDef neo Hội sở: tách đọc/ghi y như trên · [VHQ-06] cùng RoleDef đó neo ở CƠ SỞ, hoặc kèm một vai Hội sở khác ⇒ 403
 *   [VHQ-07] grant riêng KHÔNG neo Hội sở ⇒ 403 · [VHQ-08] chưa đăng nhập ⇒ 401
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "vhqtest-";
const SDT_NHAN = "0905999111";
const ids: Record<string, string> = {};
const vaiPhien: Record<string, string> = {};
const grantPhien: Record<string, string[]> = {};
const dangNhapLa = (k: string) => {
  const role = vaiPhien[k]!;
  phien = { user: { id: ids[k]!, name: `${NS}${k}`, email: `${NS}${k}@ci.test`, role, roles: [role], grants: (grantPhien[k] ?? []).map((action) => ({ action, grant: "ALLOW" as const })) } };
};
/** Tên khoá viết LITERAL ở đây (không import hằng từ mã) để bộ này đỏ nếu mã đổi tên khoá mà quên thủ tục. */
const K_DOC = "online_fulfillment:view-pii";
const K_GHI = "online_fulfillment:update";
/** RoleDef CHỈ của bộ test (DB cục bộ) — đối chứng dương cho đường gán qua vai ở v2. Seed thật không có vai nào giữ hai khoá. */
const VAI_TEST = { VHQTEST_KHO_DOC: K_DOC, VHQTEST_KHO_GHI: K_GHI } as const;
const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) as never });

async function don() {
  const orders = await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } });
  const oid = orders.map((o) => o.id);
  const items = (await db.orderItem.findMany({ where: { orderId: { in: oid } }, select: { id: true } })).map((i) => i.id);
  const fids = (await db.orderItemFulfillment.findMany({ where: { orderItemId: { in: items } }, select: { id: true } })).map((f) => f.id);
  await db.auditLog.deleteMany({ where: { module: "online-fulfillment", entityId: { in: fids } } });
  await db.orderItemFulfillment.deleteMany({ where: { orderItemId: { in: items } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
  await db.order.deleteMany({ where: { id: { in: oid } } });
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.userPermissionGrant.deleteMany({ where: { userId: { in: uids } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  const vt = (await db.roleDef.findMany({ where: { code: { in: Object.keys(VAI_TEST) } }, select: { id: true } })).map((r) => r.id);
  await db.userOrgRole.deleteMany({ where: { roleId: { in: vt } } });
  await db.rolePermission.deleteMany({ where: { roleId: { in: vt } } });
  await db.roleDef.deleteMany({ where: { id: { in: vt } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[VHQ-DB] cổng quyền Admin API giao hàng Online — RBAC v1 + v2, Postgres thật", () => {
  let fid = "";

  beforeAll(async () => {
    assertTestDb();
    await don();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    const ouCs1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    const cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;

    for (const [code, action] of Object.entries(VAI_TEST)) {
      const r = await db.roleDef.create({ data: { code, name: code }, select: { id: true } });
      await db.rolePermission.create({ data: { roleId: r.id, action, scopeType: "GLOBAL" } });
    }

    // [khoá, vai v1 trên phiên, danh sách (RoleDef, nơi neo), grant riêng]
    const nguoi: Array<[string, string, Array<[string, string]>, string[]?]> = [
      ["admin", "SUPER_ADMIN", [["SUPER_ADMIN", goc]]],
      ["ktHo", "ACCOUNTANT", [["HO_ACCOUNTANT", goc]]],
      ["gvCs", "TEACHER", [["TEACHER", ouCs1]]],
      ["gvHo", "TEACHER", [["TEACHER", goc]]],
      ["qlCs", "CENTER_MANAGER", [["CENTER_MANAGER", ouCs1]]],
      ["qlHo", "CENTER_MANAGER", [["CENTER_MANAGER", goc]]],
      ["qlKtHo", "CENTER_MANAGER", [["CENTER_MANAGER", goc], ["HO_ACCOUNTANT", goc]]],
      ["gvKiem", "TEACHER", [["TEACHER", ouCs1], ["HO_SALE", goc]]],
      ["ktCs", "ACCOUNTANT", [["CENTER_ACCOUNTANT", ouCs1]]],
      ["adminCu", "SUPER_ADMIN", []],
      ["khoLech", "ACCOUNTANT", [["HO_ACCOUNTANT", ouCs1], ["HO_SALE", goc]]],
      ["gvGrantCu", "TEACHER", [["TEACHER", goc]], ["inventory:view", "inventory:movement", "inventory:audit"]],
      ["grantDoc", "SALES_CSM", [["HO_SALE", goc]], [K_DOC]],
      ["grantGhi", "SALES_CSM", [["HO_SALE", goc]], [K_GHI]],
      ["grantKhongHo", "TEACHER", [["TEACHER", ouCs1]], [K_DOC, K_GHI]],
      ["vaiDocHo", "SALES_CSM", [["VHQTEST_KHO_DOC", goc]]],
      ["vaiGhiHo", "SALES_CSM", [["VHQTEST_KHO_GHI", goc]]],
      ["vaiCoSo", "SALES_CSM", [["VHQTEST_KHO_DOC", ouCs1], ["VHQTEST_KHO_GHI", ouCs1]]],
      ["vaiCoSoKiem", "SALES_CSM", [["VHQTEST_KHO_DOC", ouCs1], ["VHQTEST_KHO_GHI", ouCs1], ["HO_SALE", goc]]],
    ];
    for (const [k, role, vais] of nguoi) {
      vaiPhien[k] = role;
      ids[k] = (await seedUser({ email: `${NS}${k.toLowerCase()}@ci.test`, name: `${NS}${k}`, role: role as never, centerId: vais.some(([, o]) => o === ouCs1) ? cs1 : null })).id;
    }
    for (const [k, , vais, grant] of nguoi) {
      grantPhien[k] = grant ?? [];
      for (const [code, orgUnitId] of vais) {
        const roleId = (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
        await db.userOrgRole.create({ data: { userId: ids[k]!, orgUnitId, roleId, grantedById: ids.admin! } });
      }
      for (const action of grant ?? []) await db.userPermissionGrant.create({ data: { userId: ids[k]!, action, grant: "ALLOW", grantedBy: ids.admin! } });
    }

    const sp = await db.product.upsert({
      where: { sku: `${NS}sp` },
      update: {},
      create: { sku: `${NS}sp`, name: `${NS}Bộ học cụ`, category: "KIT_ROBOT", status: "ACTIVE", salePrice: 100_000, stockOnHand: 5 } as never,
      select: { id: true },
    });
    const don1 = await db.order.create({
      data: { code: `${NS}DH1`, type: "ONLINE", status: "CONFIRMED", customerName: `${NS}PH`, customerPhone: SDT_NHAN, centerId: null, subtotal: 100_000, totalAmount: 100_000, shippingAddress: { hoTen: "Người Nhận Kín", soDienThoai: SDT_NHAN, soNhaDuong: "12 Đường Riêng", phuongXa: "Hải Châu 1", tinhThanh: "Đà Nẵng" } },
      select: { id: true },
    });
    const it1 = await db.orderItem.create({ data: { orderId: don1.id, type: "PRODUCT", productId: sp.id, itemName: `${NS}Bộ học cụ`, quantity: 1, unitPrice: 100_000, totalPrice: 100_000 }, select: { id: true } });
    fid = (await db.orderItemFulfillment.create({ data: { orderItemId: it1.id, status: "PAID", paidAt: new Date() }, select: { id: true } })).id;
  }, 120_000);

  afterAll(async () => {
    phien = null;
    delete process.env.RBAC_V2_ENABLED;
    await don();
    await db.product.deleteMany({ where: { sku: `${NS}sp` } });
  });
  beforeEach(async () => {
    phien = null;
    await db.orderItemFulfillment.update({ where: { id: fid }, data: { status: "PAID", packedAt: null } });
    await db.auditLog.deleteMany({ where: { module: "online-fulfillment", entityId: fid } });
  });

  const doc = async () => {
    const r = await dsGet(req("GET", "/api/admin/online-fulfillment?status=PAID&take=100"));
    return { status: r.status, than: await r.text() };
  };
  const chuyen = () => chuyenPost(req("POST", "/x", { tu: "PAID", den: "PACKING" }), ctxId(fid));
  const thuLai = () => thuLaiPost(req("POST", "/x", {}), ctxId(fid));
  const trangThai = async () => (await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: fid }, select: { status: true } })).status;
  const nhatKy = () => db.auditLog.count({ where: { module: "online-fulfillment", entityId: fid } });

  /** Bị chặn hẳn: 403 cả ba route, thân không mang PII, dòng giao hàng không đổi, không nhật ký. */
  const biChanHet = async (k: string) => {
    dangNhapLa(k);
    const d = await doc();
    expect({ ai: k, doc: d.status }).toEqual({ ai: k, doc: 403 });
    expect(d.than).not.toContain(SDT_NHAN);
    expect(d.than).not.toContain("Người Nhận Kín");
    expect({ ai: k, chuyen: (await chuyen()).status, thuLai: (await thuLai()).status }).toEqual({ ai: k, chuyen: 403, thuLai: 403 });
    expect(await trangThai()).toBe("PAID");
    expect(await nhatKy()).toBe(0);
  };

  describe.each([
    ["RBAC v1 (cờ tắt)", false],
    ["RBAC v2 (cờ bật)", true],
  ])("%s", (_ten, co) => {
    beforeAll(() => {
      if (co) process.env.RBAC_V2_ENABLED = "true";
      else delete process.env.RBAC_V2_ENABLED;
    });

    /** Đọc được (200 + thấy người nhận) nhưng KHÔNG ghi được. */
    const chiDoc = async (k: string) => {
      dangNhapLa(k);
      const d = await doc();
      expect({ ai: k, doc: d.status }).toEqual({ ai: k, doc: 200 });
      expect(d.than).toContain(SDT_NHAN);
      expect({ ai: k, chuyen: (await chuyen()).status, thuLai: (await thuLai()).status }).toEqual({ ai: k, chuyen: 403, thuLai: 403 });
      expect(await trangThai()).toBe("PAID");
      expect(await nhatKy()).toBe(0);
    };
    /** Ghi được nhưng KHÔNG đọc được PII; thân phản hồi ghi cũng không mang PII. */
    const chiGhi = async (k: string) => {
      dangNhapLa(k);
      const d = await doc();
      expect({ ai: k, doc: d.status }).toEqual({ ai: k, doc: 403 });
      expect(d.than).not.toContain(SDT_NHAN);
      const c = await chuyen();
      const t = await c.text();
      expect({ ai: k, chuyen: c.status }).toEqual({ ai: k, chuyen: 200 });
      expect(t).not.toContain(SDT_NHAN);
      expect(t).not.toContain("Người Nhận Kín");
      expect(await trangThai()).toBe("PACKING");
      // retry trên dòng không NEEDS_STAFF: qua cổng, bị từ chối ở tầng nghiệp vụ
      expect((await thuLai()).status).toBe(409);
    };

    it("[VHQ-01] Quản trị tối cao: đọc được người nhận và chuyển được trạng thái (đối chứng dương)", async () => {
      dangNhapLa("admin");
      const d = await doc();
      expect(d.status).toBe(200);
      expect(d.than).toContain(SDT_NHAN);
      expect((await chuyen()).status).toBe(200);
      expect(await trangThai()).toBe("PACKING");
      expect((await thuLai()).status).toBe(409);
    });

    it.each(["ktHo", "gvCs", "gvHo", "qlCs", "qlHo", "qlKtHo", "gvKiem", "ktCs", "adminCu", "khoLech", "gvGrantCu"])("[VHQ-02] vai sẵn có «%s» ⇒ 403 cả ba route", async (k) => {
      await biChanHet(k);
    });

    it("[VHQ-03] gán rõ khoá ĐỌC (grant riêng + vai Hội sở) ⇒ đọc được, không ghi được", async () => {
      await chiDoc("grantDoc");
    });

    it("[VHQ-04] gán rõ khoá GHI (grant riêng + vai Hội sở) ⇒ ghi được, không đọc được PII", async () => {
      await chiGhi("grantGhi");
    });

    if (co) it("[VHQ-05] (v2) RoleDef mang khoá ĐỌC neo Hội sở ⇒ chỉ đọc", async () => {
      await chiDoc("vaiDocHo");
    });

    if (co) it("[VHQ-05b] (v2) RoleDef mang khoá GHI neo Hội sở ⇒ chỉ ghi", async () => {
      await chiGhi("vaiGhiHo");
    });

    it.each(["vaiCoSo", "vaiCoSoKiem"])("[VHQ-06] khoá kho giữ ở CƠ SỞ «%s» (kể cả kèm vai Hội sở khác) ⇒ 403 cả ba route", async (k) => {
      await biChanHet(k);
    });

    it("[VHQ-07] grant riêng nhưng không neo Hội sở ⇒ 403 cả ba route", async () => {
      await biChanHet("grantKhongHo");
    });

    it("[VHQ-08] chưa đăng nhập ⇒ 401 cả ba route", async () => {
      expect([(await doc()).status, (await chuyen()).status, (await thuLai()).status]).toEqual([401, 401, 401]);
      expect(await trangThai()).toBe("PAID");
    });
  });
});
