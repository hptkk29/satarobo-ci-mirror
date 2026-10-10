// R2-03 — formatInvoiceCode (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { formatInvoiceCode } from "@/lib/finance/invoice-code";

describe("[R2-03] formatInvoiceCode (C3.1)", () => {
  it("INV-<CS>-<YYYY>-#### (pad 4)", () => {
    expect(formatInvoiceCode("CS1", 2026, 1)).toBe("INV-CS1-2026-0001");
    expect(formatInvoiceCode("CS2", 2026, 42)).toBe("INV-CS2-2026-0042");
    expect(formatInvoiceCode("CS1", 2026, 12345)).toBe("INV-CS1-2026-12345");
  });
});
