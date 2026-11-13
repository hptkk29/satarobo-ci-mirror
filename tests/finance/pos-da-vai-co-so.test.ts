// tests/finance/pos-da-vai-co-so.test.ts — NGƯỜI ĐA VAI Ở HAI CƠ SỞ × các cổng của thu thẻ POS. Postgres THẬT, RBAC THẬT (RoleDef trong DB).
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// VÌ SAO CÓ TỆP NÀY [rà đối kháng bản ghép Việc 3 + Việc 4, 10/10/2026]. Mọi ca RBAC thật của thu thẻ POS dùng người ĐƠN VAI (một vai, một
// cơ sở); các ca action khác mock actor MỘT cơ sở. Không lưới nào canh người có vai ở HAI cơ sở — mà ở đó hai nửa của một cổng đọc hai nguồn khác nhau:
//   · `checkPermission("payments:pos-check")` gọi TRẦN (không target) — đúng nếu BẤT KỲ vai nào của người đó có quyền, ở BẤT KỲ cơ sở nào;
//   · `passesScope("Order", order, actor)` — tầm nhìn cơ sở theo TIỀN TỐ model là phép HỢP của mọi vai (`orders:`…).
// AND của hai vế KHÔNG cắt gì: `multi` = sale@CS1 + kế toán@CS2 qua cổng nửa đầu nhờ vai sale (CS1) và qua cổng nửa sau nhờ vai kế toán (CS2) ⇒ huỷ / kiểm tra
// / báo admin / tìm-gửi sai mã phiếu thẻ của đơn CS2, nơi họ CHỈ là kế toán — vai mà quyết định T16 cố ý KHÔNG cấp `payments:pos-check`.
// Cùng gốc ở cổng duyệt (`payments:manage`): `multi2` = kế toán@CS1 + sale@CS2 duyệt / từ chối yêu cầu của CS2, nơi họ chỉ là sale.
// Tiền lệ trong repo: `lib/finance/hoa-don/quyen.ts` (cùng bệnh, cùng thuốc — `actionCenterScope`).
//
// "Qua cổng" = KHÔNG bị `Không có quyền` / `Không tìm thấy đơn hàng`; id phiếu / yêu cầu cố ý không tồn tại nên người qua cổng nhận câu "Không tìm thấy phiếu POS" /
// "Không tìm thấy yêu cầu" — không ghi gì, không cần dựng phiếu thật. Mỗi ô có ĐỐI CHỨNG DƯƠNG (người đơn vai đúng cơ sở qua cổng) — luật 11.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { baoAdminPhieuPosAction, huyPhieuTheAction, kiemTraPhieuPosAction } from "@/app/(admin)/admin/orders/_actions";
import { guiSaiMaAction, timUngVienSaiMaAction } from "@/app/(admin)/admin/orders/_pos-sai-ma-actions";
import { duyetSaiMaAction, tuChoiSaiMaAction } from "@/app/(admin)/admin/bien-dong-so-du/_pos-sai-ma-actions";

if (!RUN_DB_TESTS) console.warn(`[DVC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-posdvc-";
const DON1 = `${P}don1`; // đơn của CS1
const DON2 = `${P}don2`; // đơn của CS2
const GIA_KHONG_CO = "khong-ton-tai";

type VaiGan = { vai: string; donVi: "HO" | "CS1" | "CS2" };
type Nguoi = "sale1" | "sale2" | "qlcs1" | "kt1" | "kt2" | "ktHo" | "multi" | "multi2";
const NGUOI: Record<Nguoi, { role: Role; vais: VaiGan[] }> = {
  sale1: { role: "SALES_CSM", vais: [{ vai: "CENTER_SALES_CSM", donVi: "CS1" }] },
  sale2: { role: "SALES_CSM", vais: [{ vai: "CENTER_SALES_CSM", donVi: "CS2" }] },
  qlcs1: { role: "CENTER_MANAGER", vais: [{ vai: "CENTER_MANAGER", donVi: "CS1" }] },
  kt1: { role: "ACCOUNTANT", vais: [{ vai: "CENTER_ACCOUNTANT", donVi: "CS1" }] },
  kt2: { role: "ACCOUNTANT", vais: [{ vai: "CENTER_ACCOUNTANT", donVi: "CS2" }] },
  ktHo: { role: "ACCOUNTANT", vais: [{ vai: "HO_ACCOUNTANT", donVi: "HO" }] },
  // sale@CS1 + kế toán@CS2
  multi: {
    role: "SALES_CSM",
    vais: [
      { vai: "CENTER_SALES_CSM", donVi: "CS1" },
      { vai: "CENTER_ACCOUNTANT", donVi: "CS2" },
    ],
  },
  // kế toán@CS1 + sale@CS2
  multi2: {
    role: "ACCOUNTANT",
    vais: [
      { vai: "CENTER_ACCOUNTANT", donVi: "CS1" },
      { vai: "CENTER_SALES_CSM", donVi: "CS2" },
    ],
  },
};
const DS = Object.keys(NGUOI) as Nguoi[];
const email = (n: Nguoi) => `${P}${n}@ci.test`;
const id = {} as Record<Nguoi, string>;
const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });
const chonCheDo = (v2: boolean) => {
  process.env.RBAC_V2_ENABLED = v2 ? "true" : "false";
};

const LOI_CONG = ["Chưa đăng nhập", "Không có quyền", "Không tìm thấy đơn hàng"];
type KQ = { ok: boolean; error?: string };
/** true = vượt cổng (quyền + phạm vi); false = bị chặn ở cổng. Lỗi nào khác cũng là "qua cổng" (id giả không tồn tại). */
const quaCong = (r: KQ) => !(r.ok === false && LOI_CONG.includes(r.error ?? ""));

type Cong = "pos-check" | "manage";
const GOI: Record<string, { cong: Cong; goi: (orderId: string) => Promise<KQ> }> = {
  huy: {
    cong: "pos-check",
    goi: (orderId) => huyPhieuTheAction({ orderId, intentId: GIA_KHONG_CO, lyDo: "MO_NHAM", xacNhanKhachChuaQuet: true }),
  },
  kiemTra: { cong: "pos-check", goi: (orderId) => kiemTraPhieuPosAction({ orderId, intentId: GIA_KHONG_CO }) },
  baoAdmin: { cong: "pos-check", goi: (orderId) => baoAdminPhieuPosAction({ orderId, intentId: GIA_KHONG_CO }) },
  timSaiMa: { cong: "pos-check", goi: (orderId) => timUngVienSaiMaAction({ orderId, intentId: GIA_KHONG_CO }) },
  guiSaiMa: { cong: "pos-check", goi: (orderId) => guiSaiMaAction({ orderId, intentId: GIA_KHONG_CO, bankTransactionId: GIA_KHONG_CO }) },
  duyet: { cong: "manage", goi: (orderId) => duyetSaiMaAction({ orderId, yeuCauId: GIA_KHONG_CO }) },
  tuChoi: { cong: "manage", goi: (orderId) => tuChoiSaiMaAction({ orderId, yeuCauId: GIA_KHONG_CO, lyDo: "Không phải giao dịch của khách" }) },
};

/**
 * Ma trận mong đợi ở v2 (PROD): [người][cổng] = [qua cổng ở đơn CS1, qua cổng ở đơn CS2].
 * `pos-check`: sale · quản lý cơ sở · kế toán HO. KHÔNG có: kế toán cơ sở (T16). `manage`: kế toán cơ sở · kế toán HO.
 */
const MA_TRAN: Record<Nguoi, Record<Cong, [boolean, boolean]>> = {
  sale1: { "pos-check": [true, false], manage: [false, false] },
  sale2: { "pos-check": [false, true], manage: [false, false] },
  qlcs1: { "pos-check": [true, false], manage: [false, false] },
  kt1: { "pos-check": [false, false], manage: [true, false] },
  kt2: { "pos-check": [false, false], manage: [false, true] },
  ktHo: { "pos-check": [true, true], manage: [true, true] },
  // sale@CS1 + kế toán@CS2: POS chỉ ở CS1 (nơi là sale), duyệt chỉ ở CS2 (nơi là kế toán).
  multi: { "pos-check": [true, false], manage: [false, true] },
  // kế toán@CS1 + sale@CS2: duyệt chỉ ở CS1, POS chỉ ở CS2.
  multi2: { "pos-check": [false, true], manage: [true, false] },
};

async function don() {
  await db.order.deleteMany({ where: { id: { in: [DON1, DON2] } } });
}
async function donNguoi() {
  const us = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const xs = us.map((u) => u.id);
  if (xs.length > 0) {
    await db.auditLog.deleteMany({ where: { actorId: { in: xs } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: xs } } });
    await db.user.deleteMany({ where: { id: { in: xs } } });
  }
}

describe.skipIf(!RUN_DB_TESTS)("[DVC] người đa vai ở hai cơ sở × cổng thu thẻ POS — RBAC thật", () => {
  const rbacGoc = process.env.RBAC_V2_ENABLED;
  let cs1 = "";
  let cs2 = "";

  beforeAll(async () => {
    assertTestDb();
    await donNguoi();
    await don();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seedUser({ email: email(n), name: `${P}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      for (const g of NGUOI[n].vais) {
        const [vai, dv] = await Promise.all([
          db.roleDef.findUniqueOrThrow({ where: { code: g.vai }, select: { id: true } }),
          db.orgUnit.findUniqueOrThrow({ where: { code: g.donVi }, select: { id: true } }),
        ]);
        // `effectiveFrom` TUYỆT ĐỐI (luật 19) — default của cột là `now()` của DB, không phụ thuộc đồng hồ test.
        await db.userOrgRole.create({
          data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
        });
      }
    }
    for (const [donId, cs, ma] of [
      [DON1, cs1, "ORD-269979-000701"],
      [DON2, cs2, "ORD-269979-000702"],
    ] as const) {
      await db.order.create({
        data: { id: donId, code: ma, type: "COURSE", status: "PENDING_PAYMENT", customerName: "Phụ huynh fixture DVC", customerPhone: "0399812401", totalAmount: 1_000_000, centerId: cs, createdById: id.sale1 },
      });
    }
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      await don();
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  /** Chạy MỌI action của một cổng cho một người ở cả hai đơn; trả "ai qua cổng" theo từng action để thông báo lỗi chỉ ra đúng action. */
  async function quet(n: Nguoi, cong: Cong): Promise<Record<string, [boolean, boolean]>> {
    h.session = phien(n);
    const ra: Record<string, [boolean, boolean]> = {};
    for (const [ten, g] of Object.entries(GOI)) {
      if (g.cong !== cong) continue;
      ra[ten] = [quaCong(await g.goi(DON1)), quaCong(await g.goi(DON2))];
    }
    return ra;
  }

  it("[DVC-01] v2 (PROD): ma trận người × cổng × cơ sở — mọi action của cổng `pos-check` (huỷ · kiểm tra · báo admin · tìm · gửi) cho đúng cơ sở người đó giữ vai CÓ quyền ấy", async () => {
    chonCheDo(true);
    for (const n of DS) {
      const mong = MA_TRAN[n]["pos-check"];
      const thuc = await quet(n, "pos-check");
      for (const [ten, kq] of Object.entries(thuc)) expect(kq, `${n} · ${ten} (đơn CS1, đơn CS2)`).toEqual(mong);
    }
  });

  it("[DVC-02] v2 (PROD): ma trận người × cổng × cơ sở — hai action của cổng `manage` (duyệt · từ chối yêu cầu sai mã)", async () => {
    chonCheDo(true);
    for (const n of DS) {
      const mong = MA_TRAN[n].manage;
      const thuc = await quet(n, "manage");
      for (const [ten, kq] of Object.entries(thuc)) expect(kq, `${n} · ${ten} (đơn CS1, đơn CS2)`).toEqual(mong);
    }
  });

  it("[DVC-03] ĐỐI CHỨNG DƯƠNG: người đơn vai đúng cơ sở vẫn qua cổng (luật 11 — ca vắng mặt không được xanh vì hỏng hoàn toàn)", async () => {
    chonCheDo(true);
    expect((await quet("sale1", "pos-check")).huy).toEqual([true, false]);
    expect((await quet("sale2", "pos-check")).huy).toEqual([false, true]);
    expect((await quet("ktHo", "pos-check")).huy).toEqual([true, true]);
    expect((await quet("kt1", "manage")).duyet).toEqual([true, false]);
    expect((await quet("kt2", "manage")).duyet).toEqual([false, true]);
  });

  it("[DVC-04] cửa vào của kẻ KHÔNG đăng nhập vẫn đóng ở cả hai cổng (không phụ thuộc phiên)", async () => {
    chonCheDo(true);
    h.session = null;
    for (const g of Object.values(GOI)) expect(await g.goi(DON1)).toEqual({ ok: false, error: "Chưa đăng nhập" });
  });

  it("[DVC-05] v1 (rollback / local): hành vi CŨ giữ nguyên — cổng thu hẹp theo cơ sở chỉ áp ở v2; người đơn vai đúng cơ sở vẫn qua, sale cơ sở khác vẫn bị chặn", async () => {
    chonCheDo(false);
    expect((await quet("sale1", "pos-check")).huy).toEqual([true, false]);
    expect((await quet("sale2", "pos-check")).huy).toEqual([false, true]);
    // v1 không có khái niệm quyền theo cơ sở của từng vai: KHÔNG thu hẹp ở đây là chủ ý (Nền Hệ thống luật 2: đường cũ không đổi hành vi).
    expect((await quet("multi", "pos-check")).huy[0], "multi ở CS1 (nơi là sale)").toBe(true);
  });
});
