// [XNP-*] V8.19 — PROD đòi chỉ đích danh pháp nhân + nhập lại MST; `isPrimary` một mình không đủ. Db giả (không DB thật).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn(async () => undefined) }));

import { datCauHinhThuTien, KHOA_MO_PROD } from "./cau-hinh-thanh-toan";

const GOC = { id: "le-goc", taxCode: "0402301783", legalName: "CTY TEST" };
const PM = { id: "pm1", type: "BANK_TRANSFER", isActive: true, centerId: null, bankBin: "970436", bankAccountNumber: "123456789", bankAccountName: "CTY TEST" };
const tao = vi.fn(async () => ({ id: "cfg-moi" }));
const db = {
  paymentMethod: { findUnique: vi.fn(async () => PM) },
  legalEntity: { findFirst: vi.fn(async () => GOC) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ onlinePaymentConfig: { findFirst: async () => null, update: async () => ({}), create: tao } })),
} as never;
const actor = { id: "u1", name: "Admin", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };
const base = { actor, paymentMethodId: "pm1", mode: "PROD", reason: "Owner đã xác minh tài khoản", now: new Date() };

beforeEach(() => {
  process.env.ONLINE_PAYMENT_PROD_UNLOCK = KHOA_MO_PROD;
  tao.mockClear();
});
afterEach(() => {
  delete process.env.ONLINE_PAYMENT_PROD_UNLOCK;
});

describe("[XNP] PROD cần xác nhận pháp nhân", () => {
  it.each([
    ["[XNP-01] thiếu legalEntityId", {}],
    ["[XNP-02] có legalEntityId nhưng thiếu MST xác nhận", { legalEntityId: "le-goc" }],
    ["[XNP-03] MST gõ sai", { legalEntityId: "le-goc", xacNhanMaSoThue: "0402301784" }],
    ["[XNP-04] legalEntityId trỏ pháp nhân khác", { legalEntityId: "le-khac", xacNhanMaSoThue: "0402301783" }],
    ["[XNP-05] MST rỗng/ký tự lạ", { legalEntityId: "le-goc", xacNhanMaSoThue: "---" }],
  ])("%s ⇒ từ chối, không ghi cấu hình", async (_t, extra) => {
    const r = await datCauHinhThuTien(db, { ...base, ...extra });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.ma).toBe(extra && "legalEntityId" in extra && extra.legalEntityId === "le-khac" ? "PHAP_NHAN_KHONG_HOP_LE" : "PHAP_NHAN_CHUA_XAC_NHAN");
    expect(tao).not.toHaveBeenCalled();
  });
  it("[XNP-06] đúng id + đúng MST (chấp nhận dấu cách/gạch) ⇒ lưu", async () => {
    const r = await datCauHinhThuTien(db, { ...base, legalEntityId: "le-goc", xacNhanMaSoThue: " 0402-301 783 " });
    expect(r).toEqual({ ok: true, configId: "cfg-moi" });
  });
  it("[XNP-07] TEST không đòi xác nhận MST (dữ liệu giả, không QR thật)", async () => {
    const r = await datCauHinhThuTien(db, { ...base, mode: "TEST" });
    expect(r.ok).toBe(true);
  });
  it("[XNP-08] khoá PROD chưa mở ⇒ PROD_CHUA_MO trước mọi kiểm khác", async () => {
    delete process.env.ONLINE_PAYMENT_PROD_UNLOCK;
    const r = await datCauHinhThuTien(db, { ...base, legalEntityId: "le-goc", xacNhanMaSoThue: "0402301783" });
    expect(!r.ok && r.ma).toBe("PROD_CHUA_MO");
  });
  it("[XNP-09] không phải Quản trị tối cao ⇒ KHONG_CO_QUYEN", async () => {
    const r = await datCauHinhThuTien(db, { ...base, actor: { id: "u2", name: "KT", role: "ACCOUNTANT", roles: ["ACCOUNTANT"] }, legalEntityId: "le-goc", xacNhanMaSoThue: "0402301783" });
    expect(!r.ok && r.ma).toBe("KHONG_CO_QUYEN");
  });
});
