/**
 * FL2-03 — Bàn giao lead: chặn cơ sở/sale đích TRÙNG nguồn. AC theo BA #07 US-LEAD-3.
 *
 * ⚠️ SPEC PHÁC (không nằm trong CI run mặc định của lane) — assert runnable cho validator
 * thuần; luồng UI transfer-dialog để fixme khi dựng fixture (lead + 2 sale + 2 cơ sở).
 */
import { test, expect } from "@playwright/test";
import { validateTransferTarget } from "../../../lib/crm/transfer-validate";

test.describe("[FL2-03] Validate bàn giao đích ≠ nguồn", () => {
  // AC — cơ sở/sale đích = nguồn → chặn + lỗi rõ (code EN, message VI).
  test("[FL2-03-T1] sale đích = nguồn → SAME_SALE", async () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs1",
      toSaleId: "saleA",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("SAME_SALE");
      expect(r.error.message).toMatch(/[À-ỹ]/); // có dấu tiếng Việt
    }
  });

  test("[FL2-03-T2] không đổi cơ sở + không chọn sale → NO_CHANGE", async () => {
    const r = validateTransferTarget({
      fromCenterId: "cs1",
      fromSaleId: "saleA",
      toCenterId: "cs1",
      toSaleId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NO_CHANGE");
  });

  test("[FL2-03-T3] đổi cơ sở HOẶC đổi sale → cho phép", async () => {
    expect(
      validateTransferTarget({ fromCenterId: "cs1", fromSaleId: "saleA", toCenterId: "cs2", toSaleId: null }).ok,
    ).toBe(true);
    expect(
      validateTransferTarget({ fromCenterId: "cs1", fromSaleId: "saleA", toCenterId: "cs1", toSaleId: "saleB" }).ok,
    ).toBe(true);
  });

  // AC — luồng UI: transfer-dialog chặn submit khi đích trùng nguồn; server cũng validate.
  test.fixme("[FL2-03-T4] UI transfer-dialog chặn đích trùng nguồn", async () => {
    // TODO(fixture): seed lead@cs1 sale A; mở dialog; chọn sale A / cùng cơ sở → toast chặn.
  });
});
