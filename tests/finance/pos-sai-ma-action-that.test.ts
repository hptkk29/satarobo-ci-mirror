// tests/finance/pos-sai-ma-action-that.test.ts — VIỆC 3: BỐN SERVER ACTION QUA CHUỖI THẬT. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// VÌ SAO CÓ TỆP NÀY. Các ca khác của Việc 3 đều cắt chuỗi ở một chỗ:
//   · `_pos-sai-ma-actions.test.ts` (hai tệp) MOCK `checkPermission` + `resolveActor` + lib — chỉ chứng minh hành động HỎI đúng khoá và gọi lib đúng một lần;
//   · `pos-hai-nut-sai-ma.test.ts` gọi thẳng `guiSaiMa` / `duyetSaiMa` / `tuChoiSaiMa` — bỏ qua phiên, quyền và phạm vi đơn;
//   · `pos-sai-ma-quyen.test.ts` chạy actor + `evaluatePermission` thật nhưng không chạm hành động nào.
// Không ca nào chạy CẢ chuỗi mà người dùng đi: phiên → `checkPermission` (RBAC v1 hoặc v2 THẬT) → `resolveActor` (RoleDef trong DB) →
// `scopedDb` + `passesScope` → lib → Postgres. Tệp này chỉ mock HAI thứ không có trong vitest: `@/lib/auth` (phiên next-auth) và
// `next/cache` (revalidatePath cần store của Next). Mọi thứ còn lại là mã thật.
//
// Chạy mỗi ca ở CẢ HAI chế độ RBAC: v2 (`RBAC_V2_ENABLED=true` — PROD) và v1 (mặc định ở local / CI). Hàm `isRbacV2Enabled()` đọc biến môi
// trường MỖI LẦN gọi nên đổi giữa các ca được.
//
// Đồng hồ ĐÓNG BĂNG (luật 19): các hành động gọi `new Date()` ⇒ `vi.useFakeTimers({ toFake: ["Date"] })` + `setSystemTime(GUI)`; fixture dùng mốc
// tuyệt đối. Chỉ giả `Date` — timer của Prisma/pool không bị đụng.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
// Chỉ thay `revalidatePath` / `revalidateTag` (cần store của Next). `unstable_cache` / `updateTag` GIỮ NGUYÊN: `safeCache` / `safeUpdateTag` tự rơi về
// "gọi thẳng, không cache" khi ngoài request context — và thay cả module là chuỗi nhập chết ở các bộ đọc cài đặt (`lib/settings/read-global.ts`).
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { nhapLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { xuLyKetQuaPos } from "@/lib/payments/pos/xu-ly-ket-qua";
import { guiSaiMaAction, timUngVienSaiMaAction } from "@/app/(admin)/admin/orders/_pos-sai-ma-actions";
import { duyetSaiMaAction, tuChoiSaiMaAction } from "@/app/(admin)/admin/bien-dong-so-du/_pos-sai-ma-actions";

if (!RUN_DB_TESTS) console.warn(`[HN3-ACT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-pos3a-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS3A";
const DON = `${P}don`;
const ITEM = `${P}item`;
const DOT = `${P}dot`;
const MAY1 = `${PFX}MAY01`;
const TIEN = 4_000_000;
const PHUT = 60_000;
const NOW = new Date("2026-10-06T10:00:00Z"); // mở phiếu thẻ
const KIEM = new Date(NOW.getTime() + 40 * PHUT); // sale bấm Kiểm tra ⇒ "Chưa thấy"
const GUI = new Date(NOW.getTime() + 45 * PHUT); // các hành động chạy ở mốc này (Date bị đóng băng)

type Nguoi = "sale1" | "sale2" | "qlcs1" | "kt1" | "kt2" | "ktHo";
const NGUOI: Record<Nguoi, { role: Role; vai: string; donVi: "HO" | "CS1" | "CS2" }> = {
  sale1: { role: "SALES_CSM", vai: "CENTER_SALES_CSM", donVi: "CS1" },
  sale2: { role: "SALES_CSM", vai: "CENTER_SALES_CSM", donVi: "CS2" },
  qlcs1: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS1" },
  kt1: { role: "ACCOUNTANT", vai: "CENTER_ACCOUNTANT", donVi: "CS1" },
  kt2: { role: "ACCOUNTANT", vai: "CENTER_ACCOUNTANT", donVi: "CS2" },
  ktHo: { role: "ACCOUNTANT", vai: "HO_ACCOUNTANT", donVi: "HO" },
};
const DS = Object.keys(NGUOI) as Nguoi[];
const email = (n: Nguoi) => `${P}${n}@ci.test`;
const id = {} as Record<Nguoi, string>;
let CS1 = "";

const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });
const chonCheDo = (v2: boolean) => {
  process.env.RBAC_V2_ENABLED = v2 ? "true" : "false";
};
const CHE_DO = [true, false] as const;
const ten = (v2: boolean) => (v2 ? "v2 (PROD)" : "v1 (mặc định local/CI)");

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
/** Gõ SAI đúng một ký tự (ký tự cuối) — không bao giờ qua checksum. */
const saiMotKyTu = (ma: string) => ma.slice(0, 4) + (ma[4] === "X" ? "Y" : "X");
// Ghi chú của ứng viên THỨ HAI: RỖNG. ⚠️ KHÔNG viết `saiMotKyTu(saiMotKyTu(ma))` — hàm đó đổi X↔Y nên áp HAI LẦN trả lại CHÍNH mã đúng khi ký tự cuối là X
// hoặc Y (7,41% mã hợp lệ — đo vét cạn 413.343 mã). Bản đầu làm đúng điều đó: giao dịch thứ hai khớp TỰ ĐỘNG lúc import, phiếu đóng, và lượt gửi báo
// "Phiếu gộp không còn mở" — ca đỏ ~14% số lần chạy (hai chế độ × 7,41%), xanh khi chạy lại. Ghi chú rỗng không thể trùng mã nào.
const HAI_UNG_VIEN_KHAC = () => "";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────
const LOC_BT = { providerTxnId: { startsWith: PFX } };

async function donDon() {
  const ids = { in: [DON] };
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], equals: DON } } });
  await db.posSaiMaYeuCau.deleteMany({ where: { intent: { paymentBill: { orderId: DON } } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: DON } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: DON } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: Object.values(id).filter(Boolean) } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: Object.values(id).filter(Boolean) } } });
  await db.emailLog.deleteMany({ where: { contextType: "Order", contextId: DON } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "Order", entityId: DON }, { actorId: { in: Object.values(id).filter(Boolean) } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { tenFile: `${P}fixture.xlsx` } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.creditBalance.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: ids.in[0]! } });
}

async function donNguoi() {
  const us = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const xs = us.map((u) => u.id);
  if (xs.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: xs } } });
    await db.user.deleteMany({ where: { id: { in: xs } } });
  }
}

async function dungDon() {
  await donDon();
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269979-000401",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture HN3-ACT",
      customerPhone: "0399812400",
      totalAmount: TIEN,
      centerId: CS1,
      createdById: id.sale1,
    },
  });
  await db.orderItem.create({ data: { id: ITEM, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Bé fixture HN3-ACT", quantity: 1, unitPrice: TIEN, totalPrice: TIEN } });
  await db.paymentRequest.create({ data: { id: DOT, orderId: DON, orderItemId: ITEM, centerId: CS1, installmentNo: 1, amountDue: TIEN, status: "PENDING", sortOrder: 1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
}

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TIEN,
    thoiGian: "2026-10-06T17:31:35+07:00",
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: "998877665544",
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: "QTT45XWQT",
    maThietBi: MAY1,
    soTheMasked: "411111******1234",
    loaiThe: "VISA",
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

async function nhapFile(dongs: DongPos[]) {
  const batch = await db.posImportBatch.create({ data: { tenFile: `${P}fixture.xlsx`, importedById: id.kt1, soLoTong: 1 } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: [], nguoiNhapId: id.kt1 });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1, trangThai: "XONG" } });
}

/**
 * Cảnh chuẩn: phiếu gộp + phiếu thẻ + "Chưa thấy" + N giao dịch gõ sai mã (cùng số tiền, cùng máy) đã vào hàng chờ qua file.
 * Giờ quẹt cách nhau MỘT phút để thứ tự ứng viên tất định.
 */
async function dungCanh(ghiChu: Array<(maDung: string) => string>) {
  const gSub = { id: id.sale1, name: "Fixture sale1" };
  const g = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT], actor: gSub });
  if (!g.ok) throw new Error(`fixture: không phát được phiếu gộp — ${g.error}`);
  const mayId = (await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: MAY1 } })).id;
  const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT, posTerminalId: mayId, actor: gSub, now: NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  await xuLyKetQuaPos({ intentId: r.phieu.intentId, ketQua: { kind: "NOT_FOUND" } satisfies PosCheckResult, triggeredBy: "SALE", now: KIEM, nguonDuLieu: "FAKE" });
  const bts: string[] = [];
  for (const [i, f] of ghiChu.entries()) {
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: f(g.ma), thoiGian: `2026-10-06T17:${String(31 + i).padStart(2, "0")}:35+07:00` })]);
    const bt = await db.bankTransaction.findUniqueOrThrow({ where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: m } }, select: { id: true } });
    bts.push(bt.id);
  }
  return { intentId: r.phieu.intentId, ma: g.ma, bts, billId: g.billId };
}

/** Ảnh chụp những thứ một hành động có thể đổi: tiền, phân bổ, yêu cầu, nhật ký, trạng thái giao dịch và phiếu thẻ. */
async function chup(intentId: string): Promise<string> {
  const [pay, alloc, yc, audit, bts, intent] = await Promise.all([
    db.payment.findMany({ where: { orderId: DON }, orderBy: { id: "asc" } }),
    db.paymentAllocation.findMany({ where: { paymentRequest: { orderId: DON } }, orderBy: { id: "asc" } }),
    db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { id: "asc" } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: { startsWith: "POS_SAI_MA_" } } }),
    db.bankTransaction.findMany({ where: LOC_BT, orderBy: { id: "asc" } }),
    db.posPaymentIntent.findUniqueOrThrow({ where: { id: intentId } }),
  ]);
  return JSON.stringify({ pay, alloc, yc, audit, bts, intent });
}

const soPayment = () => db.payment.count({ where: { orderId: DON } });
const ycCua = (intentId: string) => db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } });

// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-ACT] bốn server action qua phiên + RBAC + phạm vi + lib + Postgres THẬT — cả v2 (PROD) lẫn v1", () => {
  const rbacGoc = process.env.RBAC_V2_ENABLED;

  beforeAll(async () => {
    assertTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(GUI);
    await donNguoi();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seedUser({ email: email(n), name: `${P}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      const [vai, dv] = await Promise.all([
        db.roleDef.findUniqueOrThrow({ where: { code: NGUOI[n].vai }, select: { id: true } }),
        db.orgUnit.findUniqueOrThrow({ where: { code: NGUOI[n].donVi }, select: { id: true } }),
      ]);
      // `effectiveFrom` TUYỆT ĐỐI (luật 19): đồng hồ bị đóng băng ở GUI (06/10), còn default của cột là `now()` của DB (hôm chạy) — vai gán
      // "từ bây giờ" sẽ CHƯA có hiệu lực ở mốc GUI ⇒ `resolveActor` lọc mất ⇒ mọi quyền ra false. Lỗi dựng fixture, không phải lỗi quyền.
      await db.userOrgRole.create({
        data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
    }
  });

  beforeEach(async () => {
    h.session = null;
    vi.setSystemTime(GUI);
    await dungDon();
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      vi.useRealTimers();
      await donDon();
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  it("[HN3-ACT-01] SALE: tìm ứng viên → chọn → gửi ⇒ TỰ GHI NHẬN qua action THẬT: đúng 1 Payment, yêu cầu ĐÃ GHI, nhật ký mang đúng người bấm — ở cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await dungCanh([saiMotKyTu]);
      chonCheDo(v2);
      h.session = phien("sale1");
      const tim = await timUngVienSaiMaAction({ orderId: DON, intentId: c.intentId });
      expect(tim.ok, `${ten(v2)}: tìm`).toBe(true);
      if (!tim.ok) throw new Error("không tới được");
      expect(tim.ungVien, ten(v2)).toHaveLength(1);
      expect(tim.ungVien[0]!.xemTruoc.quyet, ten(v2)).toBe("TU_GHI_NHAN");

      const gui = await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: tim.ungVien[0]!.bankTransactionId });
      expect(gui, ten(v2)).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(), `${ten(v2)}: ĐÚNG MỘT Payment`).toBe(1);
      const yc = await ycCua(c.intentId);
      expect(yc, ten(v2)).toHaveLength(1);
      expect(yc[0], ten(v2)).toMatchObject({ kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", nguoiGuiId: id.sale1 });
      const au = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: { startsWith: "POS_SAI_MA_" } }, orderBy: { createdAt: "asc" } });
      expect(au.map((a) => a.action), ten(v2)).toEqual(["POS_SAI_MA_GUI", "POS_SAI_MA_GHI_NHAN"]);
      for (const a of au) expect(a.actorId, `${ten(v2)}: nhật ký ghi đúng người bấm`).toBe(id.sale1);
    }
  });

  it("[HN3-ACT-02] KẾ TOÁN CƠ SỞ không GỬI được ở v2 (PROD) — 'Không có quyền', 0 dòng đổi; ĐỐI CHỨNG DƯƠNG cùng cảnh: sale gửi được", async () => {
    chonCheDo(true);
    const c = await dungCanh([saiMotKyTu]);
    h.session = phien("kt1");
    const truoc = await chup(c.intentId);
    expect(await timUngVienSaiMaAction({ orderId: DON, intentId: c.intentId })).toEqual({ ok: false, error: "Không có quyền" });
    expect(await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! })).toEqual({ ok: false, error: "Không có quyền" });
    expect(await chup(c.intentId), "ảnh chụp y hệt").toBe(truoc);

    h.session = phien("sale1");
    expect(await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! }), "đối chứng dương").toMatchObject({ ok: true, kieu: "TU_GHI_NHAN" });
    expect(await soPayment()).toBe(1);
  });

  it("[HN3-ACT-03] SALE CƠ SỞ KHÁC không thấy đơn: tìm và gửi đều 'Không tìm thấy đơn hàng', 0 dòng đổi; ĐỐI CHỨNG DƯƠNG: sale đúng cơ sở gửi được — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await dungCanh([saiMotKyTu]);
      chonCheDo(v2);
      h.session = phien("sale2");
      const truoc = await chup(c.intentId);
      expect(await timUngVienSaiMaAction({ orderId: DON, intentId: c.intentId }), ten(v2)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! }), ten(v2)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(await chup(c.intentId), `${ten(v2)}: ảnh chụp y hệt`).toBe(truoc);

      h.session = phien("sale1");
      expect(await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! }), `${ten(v2)}: đối chứng dương`).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN" });
    }
  });

  it("[HN3-ACT-04] HAI ứng viên ⇒ CHỜ KẾ TOÁN; DUYỆT: sale · quản lý cơ sở · kế toán CƠ SỞ KHÁC đều bị chặn, 0 dòng đổi; kế toán đúng cơ sở duyệt được ⇒ đúng 1 Payment — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await dungCanh([saiMotKyTu, HAI_UNG_VIEN_KHAC]);
      chonCheDo(v2);
      h.session = phien("sale1");
      const gui = await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! });
      expect(gui, `${ten(v2)}: ${JSON.stringify(gui)}`).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      const yc = (await ycCua(c.intentId))[0]!;
      expect(await soPayment(), `${ten(v2)}: chưa ghi tiền`).toBe(0);

      const truoc = await chup(c.intentId);
      for (const [nguoi, mong] of [
        ["sale1", "Không có quyền"],
        ["qlcs1", "Không có quyền"],
        ["kt2", "Không tìm thấy đơn hàng"],
      ] as const) {
        h.session = phien(nguoi);
        expect(await duyetSaiMaAction({ orderId: DON, yeuCauId: yc.id }), `${ten(v2)}: ${nguoi}`).toEqual({ ok: false, error: mong });
        expect(await chup(c.intentId), `${ten(v2)}: ${nguoi} — ảnh chụp y hệt`).toBe(truoc);
      }

      h.session = phien("kt1");
      const duyet = await duyetSaiMaAction({ orderId: DON, yeuCauId: yc.id });
      expect(duyet, `${ten(v2)}: đối chứng dương`).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(), `${ten(v2)}: ĐÚNG MỘT Payment`).toBe(1);
      expect((await ycCua(c.intentId))[0], ten(v2)).toMatchObject({ trangThai: "DA_GHI_NHAN", nguoiQuyetId: id.kt1 });
      const au = await db.auditLog.findFirst({ where: { entityType: "Order", entityId: DON, action: "POS_SAI_MA_GHI_NHAN" } });
      expect(au?.actorId, `${ten(v2)}: nhật ký ghi đúng người duyệt`).toBe(id.kt1);
    }
  });

  it("[HN3-ACT-05] TỪ CHỐI: lý do ngắn bị chặn; sale không từ chối được; kế toán từ chối hợp lệ ⇒ giao dịch GIỮ UNMATCHED, phiếu thẻ về CHO_QUET, 0 Payment — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await dungCanh([saiMotKyTu, HAI_UNG_VIEN_KHAC]);
      chonCheDo(v2);
      h.session = phien("sale1");
      const gui = await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! });
      expect(gui, `${ten(v2)}: ${JSON.stringify(gui)}`).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN" });
      const yc = (await ycCua(c.intentId))[0]!;

      const truoc = await chup(c.intentId);
      expect(await tuChoiSaiMaAction({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách này" }), `${ten(v2)}: sale`).toEqual({
        ok: false,
        error: "Không có quyền",
      });
      h.session = phien("kt1");
      const ngan = await tuChoiSaiMaAction({ orderId: DON, yeuCauId: yc.id, lyDo: "abc" });
      expect(ngan.ok, `${ten(v2)}: lý do ngắn`).toBe(false);
      expect(await chup(c.intentId), `${ten(v2)}: ảnh chụp y hệt`).toBe(truoc);

      const tc = await tuChoiSaiMaAction({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách này" });
      expect(tc, `${ten(v2)}: đối chứng dương`).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      expect(await soPayment(), ten(v2)).toBe(0);
      const bt = await db.bankTransaction.findUniqueOrThrow({ where: { id: c.bts[0]! }, select: { status: true } });
      expect(bt.status, `${ten(v2)}: giao dịch giữ UNMATCHED`).toBe("UNMATCHED");
      const ph = await db.posPaymentIntent.findUniqueOrThrow({ where: { id: c.intentId }, select: { status: true, bankTransactionId: true } });
      expect(ph, ten(v2)).toMatchObject({ status: "CHO_QUET", bankTransactionId: null });
    }
  });

  it("[HN3-ACT-06] CHƯA ĐĂNG NHẬP: cả bốn action trả 'Chưa đăng nhập' và 0 dòng đổi — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await dungCanh([saiMotKyTu]);
      chonCheDo(v2);
      h.session = null;
      const truoc = await chup(c.intentId);
      const mong = { ok: false, error: "Chưa đăng nhập" };
      expect(await timUngVienSaiMaAction({ orderId: DON, intentId: c.intentId }), ten(v2)).toEqual(mong);
      expect(await guiSaiMaAction({ orderId: DON, intentId: c.intentId, bankTransactionId: c.bts[0]! }), ten(v2)).toEqual(mong);
      expect(await duyetSaiMaAction({ orderId: DON, yeuCauId: "khong-co" }), ten(v2)).toEqual(mong);
      expect(await tuChoiSaiMaAction({ orderId: DON, yeuCauId: "khong-co", lyDo: "Không có phiên đăng nhập" }), ten(v2)).toEqual(mong);
      expect(await chup(c.intentId), `${ten(v2)}: ảnh chụp y hệt`).toBe(truoc);
    }
  });
});
