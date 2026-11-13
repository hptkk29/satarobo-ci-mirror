// R1-12 — buildCommissionExportRows (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { buildCommissionExportRows, COMMISSION_EXPORT_COLUMNS } from "@/lib/crm/commission-export";

describe("[R1-12] buildCommissionExportRows", () => {
  it("[R1-12-C12.1] header + dòng + tổng đúng cấu trúc", () => {
    const rows = buildCommissionExportRows(
      [
        { recipientId: "u1", tier: "SALE", amount: 400_000 },
        { recipientId: "u2", tier: "QL_TT", amount: 200_000 },
        { recipientId: "u1", tier: "SALE", amount: -100_000, isClawback: true },
      ],
      { u1: "Nguyễn A", u2: "Trần B" },
    );
    expect(rows[0]).toEqual([...COMMISSION_EXPORT_COLUMNS]);
    expect(rows[1]).toEqual(["Nguyễn A", "Sale", "400.000", ""]);
    expect(rows[3]?.[3]).toBe("Có"); // clawback
    // dòng tổng = 400000+200000-100000 = 500000
    expect(rows[rows.length - 1]).toEqual(["TỔNG", "", "500.000", ""]);
  });

  it("tên thiếu → dùng id", () => {
    const rows = buildCommissionExportRows([{ recipientId: "x", tier: "QC", amount: 100 }]);
    expect(rows[1]?.[0]).toBe("x");
  });
});
