// FL2-03 — unit cho validate bàn giao lead (chặn cơ sở/sale đích trùng nguồn).
import { describe, it, expect } from "vitest";
import { validateTransferRecipient, validateTransferTarget } from "@/lib/crm/transfer-validate";

describe("[FL2-03] validateTransferTarget", () => {
  it("đổi sang sale khác, cùng cơ sở → OK", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs1",
      toSaleId: "saleB",
    });
    expect(r.ok).toBe(true);
  });

  it("đổi cơ sở, để trống sale (chia theo chế độ) → OK", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs2",
      toSaleId: null,
    });
    expect(r.ok).toBe(true);
  });

  it("sale đích = sale nguồn → chặn SAME_SALE", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs1",
      toSaleId: "saleA",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SAME_SALE");
  });

  it("sale đích = sale nguồn dù đổi cơ sở → vẫn chặn SAME_SALE", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs2",
      toSaleId: "saleA",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SAME_SALE");
  });

  it("không đổi cơ sở, không chọn sale → chặn NO_CHANGE", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs1",
      toSaleId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NO_CHANGE");
  });

  it("toCenter rỗng (giữ nguyên) + không sale → NO_CHANGE", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: null,
      toCenterId: null,
      toSaleId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NO_CHANGE");
  });

  it("message lỗi là tiếng Việt", () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs1",
      toSaleId: "saleA",
    });
    if (!r.ok) expect(r.error.message).toMatch(/sale/i);
  });
});

describe("validateTransferRecipient — sale nhận khi chuyển lead", () => {
  const ok = { isActive: true, centerId: "cs2" };
  it("[TVR-01] sale còn làm + đúng cơ sở đích → qua", () => {
    expect(validateTransferRecipient({ sale: ok, toCenterId: "cs2" }).ok).toBe(true);
  });
  it("[TVR-02] sale đã nghỉ → chặn", () => {
    const r = validateTransferRecipient({ sale: { ...ok, isActive: false }, toCenterId: "cs2" });
    expect(r.ok ? null : r.error.code).toBe("RECIPIENT_INACTIVE");
  });
  it("[TVR-03] sale thuộc cơ sở KHÁC cơ sở đích → chặn (kể cả sale chưa gán cơ sở)", () => {
    const r = validateTransferRecipient({ sale: { ...ok, centerId: "cs1" }, toCenterId: "cs2" });
    expect(r.ok ? null : r.error.code).toBe("RECIPIENT_WRONG_CENTER");
    const r2 = validateTransferRecipient({ sale: { ...ok, centerId: null }, toCenterId: "cs2" });
    expect(r2.ok ? null : r2.error.code).toBe("RECIPIENT_WRONG_CENTER");
  });
  it("[TVR-04] không tìm thấy sale → chặn", () => {
    const r = validateTransferRecipient({ sale: null, toCenterId: "cs2" });
    expect(r.ok ? null : r.error.code).toBe("RECIPIENT_INVALID");
  });
});

// Lưới ghim dây nối: test thuần ở trên không biết `transferLead` có GỌI hàm hay không (action
// chạm DB). Gỡ lời gọi là lỗ cũ quay lại — chuyển cho sale đã nghỉ / sale cơ sở khác.
describe("[TVR-W1] transferLead kiểm sale nhận", () => {
  it("gọi validateTransferRecipient với sale đã select isActive + centerId, TRƯỚC khi ghi", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs
      .readFileSync(path.join(process.cwd(), "app/(admin)/admin/leads/actions.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const dau = src.indexOf("export async function transferLead(");
    const than = src.slice(dau, src.indexOf("\nexport ", dau + 10));
    expect(than).toContain("select: { id: true, isActive: true, centerId: true }");
    const goi = than.indexOf("validateTransferRecipient({ sale, toCenterId })");
    expect(goi).toBeGreaterThan(0);
    expect(goi).toBeLessThan(than.indexOf("db.$transaction("));
  });
});
