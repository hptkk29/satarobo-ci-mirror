import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phiên giả lập (đổi được từng ca); quyền + tầm nhìn đi ĐƯỜNG THẬT trên Postgres (RoleDef/UserOrgRole/UserPermissionGrant thật) — KHÔNG mock `resolveActor` hay `checkPermission`.
type PhienGia = { user: { id: string; name: string; email: string; role: string; roles: string[]; grants?: { action: string; grant: "ALLOW" | "DENY" }[] } };
let phien: PhienGia | null = null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { approveRefundAction, chiHoanTienAction, rejectRefundAction } from "@/app/(admin)/admin/hoan-tien/_actions";
import { refundPaymentAction } from "@/app/(admin)/admin/payments/_actions";
import { GET as adminDs } from "@/app/api/admin/online-refunds/route";
import { GET as adminCt } from "@/app/api/admin/online-refunds/[id]/route";
import { POST as adminDuyet } from "@/app/api/admin/online-refunds/[id]/approve/route";
import { POST as adminChi } from "@/app/api/admin/online-refunds/[id]/pay/route";
import { POST as adminTuChoi } from "@/app/api/admin/online-refunds/[id]/reject/route";
import { resolveActor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { dungHocMotCon } from "@/lib/finance/dung-hoc-con";
import * as hoanAdmin from "@/lib/finance/hoan-tien-online-admin";
import { listRefundRequests } from "@/lib/finance/refund";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

/**
 * [HTQ-DB] CỔNG QUYỀN HOÀN TIỀN ONLINE — RoleDef/UserOrgRole thật, chạy CẢ RBAC v1 (cờ tắt) lẫn v2 (cờ bật).
 *   Online không thuộc cơ sở ⇒ cần CHÍNH khoá `payments:confirm` ở TẦM TOÀN HỆ + cấp Hội sở (hoặc Quản trị tối cao có `UserOrgRole`).
 *   [HTQ-01] đối chứng DƯƠNG: Kế toán Hội sở · Quản trị tối cao — đọc, duyệt, từ chối, chi THẬT trên một yêu cầu thật
 *   [HTQ-02] BFLA: mọi người không đủ quyền ⇒ 403 cả NĂM route, thân không mang dữ liệu, yêu cầu + sổ tiền + nhật ký không đổi
 *   [HTQ-03] ba dạng kiêm nhiệm (review2 §4) + đa cơ sở — nằm trong bảng của [HTQ-02], mỗi người một ca riêng
 *   [HTQ-04] IDOR chéo kênh: id yêu cầu OFFLINE qua API Online ⇒ 404, không đổi gì; id lạ ⇒ 404
 *   [HTQ-05] chưa đăng nhập ⇒ 401 ở CẢ năm route
 *   [HTQ-06] grant riêng (`UserPermissionGrant` ALLOW): không neo Hội sở ⇒ 403; kèm vai Hội sở ⇒ được (grant riêng là toàn hệ theo thiết kế của `coQuyenToanHeThong`)
 *   [HTQ-K*] ĐƯỜNG KHÁC ngoài Admin API: màn `/admin/hoan-tien` (danh sách + ba Server Action), `refundPaymentAction`, «Dừng học»
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "htqtest-";
const LY_DO_KIN = "Lý do kín của phụ huynh HTQ 7731";
const BE_KIN = "Bé Kín HTQ 7731";
const GIA = 500_000;

type NoiNeo = "HO" | "CS1" | "CS2";
/** [khoá, `User.role`, `User.roles`, vai RoleDef + nơi neo, grant riêng] */
type Nguoi = { role: string; roles?: string[]; vai: Array<[string, NoiNeo]>; grant?: string[] };
const NGUOI: Record<string, Nguoi> = {
  admin: { role: "SUPER_ADMIN", vai: [["SUPER_ADMIN", "HO"]] },
  ktHo: { role: "ACCOUNTANT", vai: [["HO_ACCOUNTANT", "HO"]] },
  // ── bị chặn ──
  ktCs: { role: "ACCOUNTANT", vai: [["CENTER_ACCOUNTANT", "CS1"]] },
  saleHo: { role: "SALES_CSM", vai: [["HO_SALE", "HO"]] },
  gvCs: { role: "TEACHER", vai: [["TEACHER", "CS1"]] },
  /** review2 §4 — dạng v2: vai cơ sở giữ payments:confirm + một vai Hội sở KHÔNG giữ khoá đó */
  kiemSale: { role: "ACCOUNTANT", roles: ["ACCOUNTANT", "SALES_CSM"], vai: [["CENTER_ACCOUNTANT", "CS1"], ["HO_SALE", "HO"]] },
  /** review2 §4 — dạng v1: `User.roles` có ACCOUNTANT + một `UserOrgRole` bất kỳ neo Hội sở */
  v1Roles: { role: "ACCOUNTANT", vai: [["HO_SALE", "HO"]] },
  /** review2 §4 — dạng Quản trị tối cao CHỈ ở phiên/`User.role`, không `UserOrgRole` */
  saChiPhien: { role: "SUPER_ADMIN", vai: [] },
  /** đa cơ sở */
  ktHaiCoSo: { role: "ACCOUNTANT", vai: [["CENTER_ACCOUNTANT", "CS1"], ["CENTER_ACCOUNTANT", "CS2"]] },
  ktHaiCoSoKiem: { role: "ACCOUNTANT", vai: [["CENTER_ACCOUNTANT", "CS1"], ["CENTER_ACCOUNTANT", "CS2"], ["HO_SALE", "HO"]] },
  /** kiêm vai Hội sở có `orders:*` / `payments:*` ⇒ tầm nhìn Order/Payment thành «ALL» (đơn Online centerId NULL lọt vào các màn offline) */
  kiemQlHo: { role: "ACCOUNTANT", roles: ["ACCOUNTANT", "CENTER_MANAGER"], vai: [["CENTER_ACCOUNTANT", "CS1"], ["CENTER_MANAGER", "HO"]] },
  kiemCsmHo: { role: "ACCOUNTANT", roles: ["ACCOUNTANT", "SALES_CSM"], vai: [["CENTER_ACCOUNTANT", "CS1"], ["CENTER_SALES_CSM", "HO"]] },
  /** vai Kế toán Hội sở nhưng neo ở CƠ SỞ + một vai Hội sở khác */
  khoaLech: { role: "ACCOUNTANT", vai: [["HO_ACCOUNTANT", "CS1"], ["HO_SALE", "HO"]] },
  grantKhongHo: { role: "TEACHER", vai: [["TEACHER", "CS1"]], grant: ["payments:confirm"] },
  /** phụ huynh CHỦ ĐƠN gọi thẳng route admin */
  phuHuynh: { role: "PARENT", vai: [] },
  // ── đối chứng của grant riêng ──
  grantHo: { role: "SALES_CSM", vai: [["HO_SALE", "HO"]], grant: ["payments:confirm"] },
};
const BI_CHAN = ["ktCs", "saleHo", "gvCs", "kiemSale", "v1Roles", "saChiPhien", "ktHaiCoSo", "ktHaiCoSoKiem", "kiemQlHo", "kiemCsmHo", "khoaLech", "grantKhongHo", "phuHuynh"] as const;

const ids: Record<string, string> = {};
const dl = { yc: "", ycOff: "", don: "", donOff: "", dong: "", thu: "", thuOff: "", hv: "" };
const dangNhapLa = (k: string) => {
  const n = NGUOI[k]!;
  phien = { user: { id: ids[k]!, name: `${NS}${k}`, email: `${NS}${k}@ci.test`, role: n.role, roles: n.roles ?? [n.role], grants: (n.grant ?? []).map((action) => ({ action, grant: "ALLOW" as const })) } };
};
const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) as never });

/** Lượt hoàn THẬT phát `payment.refunded`: không dọn thì bộ dispatcher chạy sau (cùng DB) nhặt phải sự kiện lạ và đỏ giả. */
const donSuKien = async (orderIds: string[]) => {
  if (orderIds.length) await db.domainEvent.deleteMany({ where: { OR: orderIds.map((id) => ({ payloadJson: { path: ["orderId"], equals: id } })) } });
};

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const oid = (await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } })).map((o) => o.id);
  const items = (await db.orderItem.findMany({ where: { orderId: { in: oid } }, select: { id: true } })).map((i) => i.id);
  const pids = (await db.payment.findMany({ where: { orderId: { in: oid } }, select: { id: true } })).map((p) => p.id);
  const rids = (await db.refundRequest.findMany({ where: { orderItemId: { in: items } }, select: { id: true } })).map((r) => r.id);
  await donSuKien(oid);
  await db.auditLog.deleteMany({ where: { entityId: { in: [...oid, ...pids, ...rids] } } });
  await db.notification.deleteMany({ where: { dedupeKey: { in: rids.flatMap((r) => ["DA_DUYET", "TU_CHOI", "DA_HOAN"].map((t) => `online_refund:${r}:${t}`)) } } });
  await db.receipt.deleteMany({ where: { paymentId: { in: pids } } });
  await db.payment.deleteMany({ where: { orderId: { in: oid }, adjustmentOfId: { not: null } } });
  await db.payment.deleteMany({ where: { orderId: { in: oid } } });
  await db.refundRequest.deleteMany({ where: { id: { in: rids } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
  await db.order.deleteMany({ where: { id: { in: oid } } });
  await db.paymentMethod.deleteMany({ where: { code: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.userPermissionGrant.deleteMany({ where: { userId: { in: uids } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

/** Đặt lại hai yêu cầu về PENDING, xoá bút toán hoàn + nhật ký của chúng. */
async function datLai() {
  await db.payment.deleteMany({ where: { orderId: { in: [dl.don, dl.donOff] }, adjustmentOfId: { not: null } } });
  await db.refundRequest.updateMany({
    where: { id: { in: [dl.yc, dl.ycOff] } },
    data: { status: "PENDING", approvedAmount: null, approvedById: null, approvedAt: null, note: null, lyDoTuChoi: null, paidAt: null, paidById: null, paidMethod: null, maGiaoDichHoan: null, quyenDaThuHoiLuc: null, canXuLyQuyen: false },
  });
  await db.order.updateMany({ where: { id: dl.don }, data: { status: "CONFIRMED" } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [dl.yc, dl.ycOff] } } });
}

/** Ảnh chụp mọi thứ một lượt hoàn có thể đổi — so trước/sau để chứng minh «bị chặn = không đổi gì». */
async function anhChup() {
  const [yc, tien, nhatKy, soYc] = await Promise.all([
    db.refundRequest.findUniqueOrThrow({ where: { id: dl.yc }, select: { status: true, approvedAmount: true, approvedById: true, note: true, lyDoTuChoi: true, paidAt: true } }),
    db.payment.findMany({ where: { orderId: dl.don }, select: { amount: true, accountantStatus: true }, orderBy: { createdAt: "asc" } }),
    db.auditLog.count({ where: { entityId: dl.yc } }),
    db.refundRequest.count({ where: { orderItemId: dl.dong } }),
  ]);
  return { yc, tien, nhatKy, soYc };
}

describe.skipIf(!RUN)("[HTQ-DB] cổng quyền hoàn tiền Online — RBAC v1 + v2, Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await don();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    const ou: Record<NoiNeo, string> = {
      HO: goc,
      CS1: (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id,
      CS2: (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id,
    };
    const cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const [k, n] of Object.entries(NGUOI)) {
      ids[k] = (await seedUser({ email: `${NS}${k.toLowerCase()}@ci.test`, name: `${NS}${k}`, role: n.role as never, roles: (n.roles ?? [n.role]) as never, centerId: n.vai.some(([, o]) => o === "CS1") ? cs1 : null })).id;
    }
    for (const [k, n] of Object.entries(NGUOI)) {
      for (const [code, noi] of n.vai) {
        const roleId = (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
        await db.userOrgRole.create({ data: { userId: ids[k]!, orgUnitId: ou[noi], roleId, grantedById: ids.admin! } });
      }
      for (const action of n.grant ?? []) await db.userPermissionGrant.create({ data: { userId: ids[k]!, action, grant: "ALLOW", grantedBy: ids.admin! } });
    }

    dl.hv = (await db.student.create({ data: { id: `${NS}hv`, name: BE_KIN, parentUserId: ids.phuHuynh! } as never, select: { id: true } })).id;
    const taoDon = async (ma: string, o: { type: "ONLINE" | "COURSE"; centerId: string | null }) => {
      const don1 = await db.order.create({
        data: { code: `${NS}${ma}`, type: o.type, status: "CONFIRMED", customerName: `${NS}PH`, customerPhone: "0905777111", centerId: o.centerId, createdById: o.type === "ONLINE" ? ids.phuHuynh! : ids.ktCs!, subtotal: GIA, totalAmount: GIA } as never,
        select: { id: true },
      });
      const dong = await db.orderItem.create({
        data: { orderId: don1.id, type: o.type === "ONLINE" ? "ONLINE_COURSE" : "COURSE_PACKAGE", itemName: o.type === "ONLINE" ? "Khoá Online HTQ" : "Gói Offline HTQ", quantity: 1, unitPrice: GIA, totalPrice: GIA, studentId: o.type === "ONLINE" ? dl.hv : null, ...(o.type === "ONLINE" ? { onlineCourseId: `${NS}khoa` } : {}) } as never,
        select: { id: true },
      });
      const thu = await db.payment.create({
        data: { orderId: don1.id, amount: GIA, method: "BANK_TRANSFER", paidDate: new Date(), accountantStatus: "CONFIRMED", recordedById: ids.phuHuynh!, centerId: o.centerId },
        select: { id: true },
      });
      const yc = await db.refundRequest.create({
        data: { orderItemId: dong.id, trigger: "MANUAL", reason: o.type === "ONLINE" ? LY_DO_KIN : "Hoàn offline đối chứng", paidConfirmed: GIA, sessionsTotal: 0, sessionsLearned: 0, unitPrice: GIA, proposedAmount: o.type === "ONLINE" ? 0 : 100_000, status: "PENDING", requestedById: ids.phuHuynh!, kenh: o.type === "ONLINE" ? "ONLINE" : "OFFLINE", kenhYeuCau: o.type === "ONLINE" ? "PARENT" : null, centerId: o.centerId },
        select: { id: true },
      });
      return { don: don1.id, dong: dong.id, thu: thu.id, yc: yc.id };
    };
    const on = await taoDon("DH-ONL", { type: "ONLINE", centerId: null });
    const off = await taoDon("DH-OFF", { type: "COURSE", centerId: cs1 });
    Object.assign(dl, { don: on.don, dong: on.dong, thu: on.thu, yc: on.yc, donOff: off.don, thuOff: off.thu, ycOff: off.yc });
    await db.paymentMethod.create({ data: { code: `${NS}pm`, name: `${NS}Chuyển khoản`, type: "BANK_TRANSFER", isActive: true } });
  }, 180_000);

  afterAll(async () => {
    phien = null;
    delete process.env.RBAC_V2_ENABLED;
    await don();
  });
  beforeEach(async () => {
    phien = null;
    await datLai();
  });

  /**
   * Kết cục một Server Action: "OK" hoặc CÂU từ chối. CHỈ `NEXT_REDIRECT` (cổng quyền đá về trang) được coi là từ chối bằng ngoại lệ — mọi lỗi khác NÉM RA:
   * một `.catch` rộng từng biến `ReferenceError` của chính bản vá thành «đã chặn» (xanh giả).
   */
  const ketCuc = async (p: Promise<{ ok: boolean; error?: string }>): Promise<string> => {
    try {
      const r = await p;
      return r.ok ? "OK" : (r.error ?? "");
    } catch (e) {
      const x = e as { message?: string; digest?: string };
      if (`${x.digest ?? ""} ${x.message ?? ""}`.includes("NEXT_REDIRECT")) return "REDIRECT";
      throw e;
    }
  };
  /** Đúng MỘT trong các cách từ chối chủ ý: bị đá bởi cổng quyền · không có quyền · ngoài tầm nhìn · đơn Online đi đường riêng. */
  const TU_CHOI_CHU_Y = /^REDIRECT$|Không có quyền|Không tìm thấy|đơn Online/;

  /** năm route: danh sách · chi tiết · duyệt · từ chối · chi. Thân gom lại để kiểm không rò dữ liệu. */
  const namRoute = async (id: string) => {
    const rs = [
      await adminDs(req("GET", "/api/admin/online-refunds?soLuong=100")),
      await adminCt(req("GET", "/x"), ctxId(id)),
      await adminDuyet(req("POST", "/x", { soTienDuyet: 1000 }), ctxId(id)),
      await adminTuChoi(req("POST", "/x", { lyDo: "Không đủ điều kiện hoàn tiền" }), ctxId(id)),
      await adminChi(req("POST", "/x", { method: "BANK_TRANSFER" }), ctxId(id)),
    ];
    return { ma: rs.map((r) => r.status), than: (await Promise.all(rs.map((r) => r.text()))).join("\n") };
  };

  describe.each([
    ["RBAC v1 (cờ tắt)", false],
    ["RBAC v2 (cờ bật)", true],
  ])("%s", (_ten, co) => {
    beforeAll(() => {
      if (co) process.env.RBAC_V2_ENABLED = "true";
      else delete process.env.RBAC_V2_ENABLED;
    });

    it.each(["ktHo", "admin"])("[HTQ-01] %s: đọc, chi tiết, duyệt, chi THẬT (đối chứng dương)", async (k) => {
      dangNhapLa(k);
      const ds = await adminDs(req("GET", "/api/admin/online-refunds?soLuong=100"));
      expect(ds.status).toBe(200);
      expect(await ds.text()).toContain(LY_DO_KIN);
      const ct = await adminCt(req("GET", "/x"), ctxId(dl.yc));
      expect(ct.status).toBe(200);
      expect(await ct.text()).toContain(BE_KIN);
      expect((await adminDuyet(req("POST", "/x", { soTienDuyet: GIA }), ctxId(dl.yc))).status).toBe(200);
      expect((await adminChi(req("POST", "/x", { method: "BANK_TRANSFER" }), ctxId(dl.yc))).status).toBe(200);
      const sau = await anhChup();
      expect(sau.yc.status).toBe("PAID");
      expect(sau.tien.map((p) => p.amount)).toEqual([GIA, -GIA]);
    });

    it("[HTQ-01b] kế toán Hội sở từ chối được (đối chứng dương)", async () => {
      dangNhapLa("ktHo");
      expect((await adminTuChoi(req("POST", "/x", { lyDo: "Không đủ điều kiện hoàn tiền" }), ctxId(dl.yc))).status).toBe(200);
      expect((await anhChup()).yc.status).toBe("REJECTED");
    });

    it.each(BI_CHAN)("[HTQ-02] %s ⇒ 403 cả năm route, không rò dữ liệu, không đổi gì (PENDING)", async (k) => {
      dangNhapLa(k);
      const truoc = await anhChup();
      const r = await namRoute(dl.yc);
      expect({ ai: k, ma: r.ma }).toEqual({ ai: k, ma: [403, 403, 403, 403, 403] });
      expect(r.than).not.toContain(LY_DO_KIN);
      expect(r.than).not.toContain(BE_KIN);
      expect(await anhChup()).toEqual(truoc);
    });

    it.each(BI_CHAN)("[HTQ-02b] %s không CHI được yêu cầu đã duyệt", async (k) => {
      await db.refundRequest.update({ where: { id: dl.yc }, data: { status: "APPROVED", approvedAmount: GIA } });
      dangNhapLa(k);
      const truoc = await anhChup();
      expect((await adminChi(req("POST", "/x", { method: "BANK_TRANSFER" }), ctxId(dl.yc))).status).toBe(403);
      expect(await anhChup()).toEqual(truoc);
    });

    it("[HTQ-04] IDOR chéo kênh: yêu cầu OFFLINE / id lạ qua API Online ⇒ 404, yêu cầu offline không đổi", async () => {
      dangNhapLa("ktHo");
      for (const id of [dl.ycOff, "khong-ton-tai"]) {
        const r = await namRoute(id);
        expect(r.ma.slice(1)).toEqual([404, 404, 404, 404]);
      }
      expect((await db.refundRequest.findUniqueOrThrow({ where: { id: dl.ycOff } })).status).toBe("PENDING");
    });

    it("[HTQ-05] chưa đăng nhập ⇒ 401 cả năm route", async () => {
      expect((await namRoute(dl.yc)).ma).toEqual([401, 401, 401, 401, 401]);
    });

    it("[HTQ-06] grant riêng + vai Hội sở ⇒ được (đối chứng của grant không neo Hội sở ở [HTQ-02])", async () => {
      dangNhapLa("grantHo");
      expect((await adminCt(req("GET", "/x"), ctxId(dl.yc))).status).toBe(200);
    });

    // ───────────────────────── ĐƯỜNG KHÁC ngoài Admin API ─────────────────────────

    /** Những ai thấy dòng Online trên màn `/admin/hoan-tien` = đúng người qua cổng Admin API. */
    it.each(["kiemQlHo", "kiemCsmHo", "v1Roles", "kiemSale", "ktCs", "ktHo", "admin"])("[HTQ-K1] danh sách màn offline — %s", async (k) => {
      const actor = await resolveActor(ids[k]!);
      const duoc = hoanAdmin.duocQuanLyHoanOnline(actor);
      expect(duoc).toBe(k === "ktHo" || k === "admin");
      const rows = await listRefundRequests(scopedDb(actor) as never, { gomOnline: duoc });
      expect(rows.some((r) => r.id === dl.yc)).toBe(duoc);
      expect(rows.filter((r) => r.id === dl.yc).every((r) => r.laOnline)).toBe(true);
    });

    it.each(["kiemQlHo", "kiemCsmHo", "v1Roles", "ktHo", "admin"])("[HTQ-K2] approveRefundAction trên yêu cầu ONLINE — %s ⇒ từ chối, không đổi gì", async (k) => {
      dangNhapLa(k);
      const truoc = await anhChup();
      const cau = await ketCuc(approveRefundAction(dl.yc, GIA));
      expect({ ai: k, cau }).toEqual({ ai: k, cau: expect.stringMatching(TU_CHOI_CHU_Y) });
      expect(await anhChup()).toEqual(truoc);
    });

    it.each(["kiemQlHo", "kiemCsmHo", "v1Roles", "ktHo", "admin"])("[HTQ-K3] rejectRefundAction trên yêu cầu ONLINE — %s ⇒ từ chối, không đổi gì", async (k) => {
      dangNhapLa(k);
      const truoc = await anhChup();
      const cau = await ketCuc(rejectRefundAction(dl.yc, "Từ chối thử nghiệm đủ dài"));
      expect({ ai: k, cau }).toEqual({ ai: k, cau: expect.stringMatching(TU_CHOI_CHU_Y) });
      expect(await anhChup()).toEqual(truoc);
    });

    it.each(["kiemQlHo", "kiemCsmHo", "v1Roles", "ktHo", "admin"])("[HTQ-K4] chiHoanTienAction trên yêu cầu ONLINE đã duyệt — %s ⇒ từ chối, không có dòng tiền âm", async (k) => {
      await db.refundRequest.update({ where: { id: dl.yc }, data: { status: "APPROVED", approvedAmount: GIA } });
      dangNhapLa(k);
      const truoc = await anhChup();
      const cau = await ketCuc(chiHoanTienAction({ refundRequestId: dl.yc, method: `${NS}pm`, paidDate: "2026-11-20" }));
      expect({ ai: k, cau }).toEqual({ ai: k, cau: expect.stringMatching(TU_CHOI_CHU_Y) });
      expect(await anhChup()).toEqual(truoc);
    });

    it.each(["kiemCsmHo", "kiemQlHo", "v1Roles", "ktCs", "kiemSale"])("[HTQ-K5] refundPaymentAction trên khoản thu đơn ONLINE — %s ⇒ không ghi dòng hoàn", async (k) => {
      dangNhapLa(k);
      const truoc = await anhChup();
      const cau = await ketCuc(refundPaymentAction(dl.thu, "Hoàn thử nghiệm đủ dài"));
      expect({ ai: k, cau }).toEqual({ ai: k, cau: expect.stringMatching(TU_CHOI_CHU_Y) });
      expect(await anhChup()).toEqual(truoc);
    });

    it("[HTQ-K5b] refundPaymentAction trên đơn ONLINE — kế toán Hội sở GIỮ quyền (đối chứng dương)", async () => {
      dangNhapLa("ktHo");
      const r = await refundPaymentAction(dl.thu, "Hoàn thử nghiệm đủ dài");
      expect(r).toEqual({ ok: true });
      expect((await anhChup()).tien.map((p) => p.amount)).toEqual([GIA, -GIA]);
    });

    it("[HTQ-K6] đối chứng OFFLINE không đổi: kế toán cơ sở vẫn thấy + duyệt yêu cầu offline cơ sở mình và hoàn khoản thu offline", async () => {
      const actor = await resolveActor(ids.ktCs!);
      const rows = await listRefundRequests(scopedDb(actor) as never, { gomOnline: false });
      expect(rows.map((r) => r.id)).toContain(dl.ycOff);
      expect(rows.find((r) => r.id === dl.ycOff)?.laOnline).toBe(false);
      dangNhapLa("ktCs");
      expect(await approveRefundAction(dl.ycOff, 100_000)).toEqual({ ok: true });
      expect(await refundPaymentAction(dl.thuOff, "Hoàn offline đối chứng")).toEqual({ ok: true });
    });
  });

  it("[HTQ-K7] «Dừng học» không chạy trên đơn ONLINE ⇒ không sinh yêu cầu hoàn thứ hai ngoài luồng Online", async () => {
    // Tiền Online nằm ở mức đơn; đường «gắn khoản thu cho con» gắn được vào dòng ⇒ dựng đúng trạng thái đó, nếu không ca này xanh giả vì «không có gì để phân».
    await db.payment.update({ where: { id: dl.thu }, data: { orderItemId: dl.dong } });
    // đóng yêu cầu Online đang mở của dòng (nếu không, đường cũ dừng sớm ở cổng «đã có yêu cầu đang chờ»)
    await db.refundRequest.update({ where: { id: dl.yc }, data: { status: "REJECTED" } });
    try {
      const truoc = await anhChup();
      const r = await dungHocMotCon({ orderId: dl.don, orderItemId: dl.dong, lyDo: "PH_CHU_DONG", buoiCuoiId: null, ghiChu: null, phanDu: [{ kieu: "HOAN", soTien: GIA }], actor: { id: ids.ktHo!, name: "thử" }, now: new Date() });
      expect(r.ok ? "" : r.error).toMatch(/Online/);
      expect(r.ok).toBe(false);
      expect(await anhChup()).toEqual(truoc);
      expect((await db.orderItem.findUniqueOrThrow({ where: { id: dl.dong }, select: { status: true } })).status).not.toBe("STOPPED");
    } finally {
      await db.payment.update({ where: { id: dl.thu }, data: { orderItemId: null } });
    }
  });
});
