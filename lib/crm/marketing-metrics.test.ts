// R1-08 — CPL/CPA/ROAS + CR (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { computeFunnelMetrics } from "@/lib/crm/marketing-metrics";

describe("[R1-08] computeFunnelMetrics", () => {
  it("[R1-08-C8.2/C8.4] CPL/CPA/ROAS + CR đúng", () => {
    const m = computeFunnelMetrics({ l1: 100, l2: 50, l3: 20, spend: 1_000_000, revenue: 5_000_000 });
    expect(m.cpl).toBe(20_000); // 1tr/50
    expect(m.cpa).toBe(50_000); // 1tr/20
    expect(m.roas).toBe(5); // 5tr/1tr
    expect(m.crL1L2).toBe(0.5); // 50/100
    expect(m.crL2L3).toBe(0.4); // 20/50
  });

  it("chia 0 an toàn (spend=0, l1=0...)", () => {
    const m = computeFunnelMetrics({ l1: 0, l2: 0, l3: 0, spend: 0, revenue: 0 });
    expect(m).toEqual({ cpl: 0, cpa: 0, roas: 0, crL1L2: 0, crL2L3: 0 });
  });
});
