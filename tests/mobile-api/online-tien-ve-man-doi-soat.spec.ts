import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// Phiên giả lập (đổi được từng ca); `checkPermission` + `resolveActor` + `scopedDb` đi ĐƯỜNG THẬT trên Postgres (RoleDef/UserOrgRole thật) — không giả lập quyền, không chép lại câu tra.
let phien: { user: { id: string; name: string; email: string; role: string; roles: string[]; centerId: string | null } } | null = null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import ManDoiSoat from "@/app/(admin)/admin/bien-dong-so-du/page";
import { BankTxnClient, type BankTxnItem } from "@/app/(admin)/admin/bien-dong-so-du/_components/bank-txn-client";
import { db } from "@/lib/db";
import { allocateToOrder, ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

/**
 * [MDS-DB] «Người có quyền THẤY được tiền về trên đơn Online đã huỷ» — đo bằng CHÍNH trang `/admin/bien-dong-so-du` (gọi server component, đọc props nó đưa cho bảng giao dịch
 * ở tab «Cần xử lý»), không dựng lại câu tra của màn. Chạy CẢ RBAC v1 lẫn v2.
 *   [MDS-01] Kế toán Hội sở + Quản trị tối cao: thấy CẢ giao dịch về ĐUA lẫn về SAU, đủ số tiền · tham chiếu · tài khoản nhận · ghi chú nêu đơn
 *   [MDS-02] SỐ ĐO (không phải quyết định mới): kế toán CƠ SỞ cũng thấy — `BankTransaction` thuộc NULL_IS_GLOBAL, đơn Online không có cơ sở
 *   [MDS-03] không có quyền `payments:*` (giáo viên cơ sở) ⇒ trang đá đi, không đọc được gì
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && laTenDbLaDbTest(TEN_DB);

const NS = "mdstest-";
const MA_DON = "INV-ONL-MDS-0001";
const KHOA = "SRINVONLMDS0001D0";
const TIEN = 500_000;
const TAI_KHOAN = "0011004123456";
const REF_DUA = `${NS}dua`;
const REF_SAU = `${NS}sau`;
const ids: Record<string, string> = {};
const vaiPhien: Record<string, { role: string; centerId: string | null }> = {};

async function don() {
  const orders = await db.order.findMany({ where: { code: MA_DON }, select: { id: true } });
  const oid = orders.map((o) => o.id);
  const gd = (await db.bankTransaction.findMany({ where: { providerTxnId: { startsWith: NS } }, select: { id: true } })).map((g) => g.id);
  await db.creditBalance.deleteMany({ where: { OR: [{ orderId: { in: oid } }, { bankTransactionId: { in: gd } }] } });
  await db.paymentAllocation.deleteMany({ where: { bankTransactionId: { in: gd } } });
  await db.payment.deleteMany({ where: { orderId: { in: oid } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
  await db.bankTransaction.deleteMany({ where: { id: { in: gd } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
  await db.order.deleteMany({ where: { id: { in: oid } } });
  const uids = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

/** Tìm props của `BankTxnClient` trong cây phần tử trang trả về. */
function propsBangGiaoDich(nut: ReactNode): { items: BankTxnItem[] } | null {
  if (Array.isArray(nut)) {
    for (const c of nut) {
      const kq = propsBangGiaoDich(c);
      if (kq) return kq;
    }
    return null;
  }
  if (!isValidElement(nut)) return null;
  if (nut.type === BankTxnClient) return nut.props as { items: BankTxnItem[] };
  return propsBangGiaoDich((nut.props as { children?: ReactNode }).children);
}

async function canXuLy(k: string) {
  const v = vaiPhien[k]!;
  phien = { user: { id: ids[k]!, name: `${NS}${k}`, email: `${NS}${k}@ci.test`, role: v.role, roles: [v.role], centerId: v.centerId } };
  const trang = await ManDoiSoat({ searchParams: Promise.resolve({ status: "unmatched" }) });
  const p = propsBangGiaoDich(trang);
  if (!p) throw new Error("không thấy bảng giao dịch trong trang");
  return p.items.filter((i) => i.providerTxnId.startsWith(NS));
}

describe.skipIf(!RUN)("[MDS-DB] màn đối soát thấy tiền về trên đơn Online đã huỷ — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await don();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    const ouCs1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    const cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    const nguoi: Array<[string, string, string | null, Array<[string, string]>]> = [
      ["admin", "SUPER_ADMIN", null, [["SUPER_ADMIN", goc]]],
      ["ktHo", "ACCOUNTANT", null, [["HO_ACCOUNTANT", goc]]],
      ["ktCs", "ACCOUNTANT", cs1, [["CENTER_ACCOUNTANT", ouCs1]]],
      ["gvCs", "TEACHER", cs1, [["TEACHER", ouCs1]]],
    ];
    for (const [k, role, centerId] of nguoi) {
      vaiPhien[k] = { role, centerId };
      ids[k] = (await seedUser({ email: `${NS}${k}@ci.test`, name: `${NS}${k}`, role: role as never, centerId })).id;
    }
    for (const [k, , , vais] of nguoi) {
      for (const [code, orgUnitId] of vais) {
        const roleId = (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
        await db.userOrgRole.create({ data: { userId: ids[k]!, orgUnitId, roleId, grantedById: ids.admin! } });
      }
    }

    const o = await db.order.create({ data: { code: MA_DON, type: "ONLINE", status: "CANCELLED", customerName: `${NS}PH`, customerPhone: "", totalAmount: TIEN, centerId: null }, select: { id: true, code: true, centerId: true, orgUnitId: true, studentId: true, leadId: true } });
    const phieu = await db.paymentRequest.create({ data: { orderId: o.id, installmentNo: 0, amountDue: TIEN, status: "VOID", sortOrder: 0, matchKey: KHOA, centerId: null }, select: { id: true } });

    // ĐUA: tra đích đã xong khi đơn còn sống, phần rót chạy sau khi huỷ commit.
    const gd = await db.bankTransaction.create({ data: { provider: "SEPAY", providerTxnId: REF_DUA, amount: TIEN, transferredAt: new Date(), accountNumber: TAI_KHOAN, referenceCode: REF_DUA, content: `${KHOA} HOC PHI`, rawPayload: {} } });
    await allocateToOrder({ bankTransactionId: gd.id, order: { ...o, status: "PENDING_PAYMENT", student: null }, amount: TIEN, provider: "SEPAY", providerTxnId: REF_DUA, target: { paymentRequestId: phieu.id, orderId: o.id, via: "matchKey" }, data: { reference: REF_DUA, amount: TIEN } });
    // SAU: cả đường webhook.
    await ingestPayosWebhook({ reference: REF_SAU, description: `${KHOA} HOC PHI`, amount: TIEN, accountNumber: TAI_KHOAN }, "SEPAY");
  }, 120_000);

  afterAll(async () => {
    phien = null;
    delete process.env.RBAC_V2_ENABLED;
    await don();
  }, 60_000);

  for (const v2 of [false, true]) {
    describe(`RBAC ${v2 ? "v2" : "v1"}`, () => {
      beforeAll(() => {
        process.env.RBAC_V2_ENABLED = v2 ? "true" : "false";
      });

      for (const k of ["ktHo", "admin"]) {
        it(`[MDS-01 ${k}] thấy cả hai giao dịch ở «Cần xử lý», đủ dấu truy nguồn`, async () => {
          const ds = await canXuLy(k);
          expect(ds.map((i) => i.providerTxnId).sort()).toEqual([REF_DUA, REF_SAU].sort());
          for (const i of ds) {
            expect(i).toMatchObject({ status: "UNMATCHED", amount: TIEN, referenceCode: i.providerTxnId, accountNumber: TAI_KHOAN, content: `${KHOA} HOC PHI`, allocations: [] });
            expect(i.unmatchedNote).toContain(MA_DON);
          }
        }, 30_000);
      }

      it("[MDS-02] số đo: kế toán cơ sở cũng thấy (giao dịch không thuộc cơ sở nào)", async () => {
        expect((await canXuLy("ktCs")).map((i) => i.providerTxnId).sort()).toEqual([REF_DUA, REF_SAU].sort());
      }, 30_000);

      it("[MDS-03] giáo viên cơ sở không vào được trang", async () => {
        await expect(canXuLy("gvCs")).rejects.toThrow(/NEXT_REDIRECT/);
      }, 30_000);
    });
  }
});
