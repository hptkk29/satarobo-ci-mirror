// lib/crm/marketing-metrics.ts — R1-08: chỉ số funnel + CPL/CPA/ROAS + CR (SR.QD.217).
// THUẦN, chia-0 an toàn (C8.2/C8.4). Dữ liệu count do tầng query cung cấp.
import { computeCpl, computeCpa } from "@/lib/crm/cost-allocation";

export type FunnelCounts = {
  l1: number; // hội thoại / lead L1
  l2: number; // đạt L2 (qualifiedAt)
  l3: number; // chốt L3 (converted)
  spend: number;
  revenue: number;
};

export type FunnelMetrics = {
  cpl: number;
  cpa: number;
  roas: number;
  crL1L2: number; // tỉ lệ chuyển L1→L2
  crL2L3: number;
};

const ratio = (num: number, denom: number): number => (denom > 0 ? num / denom : 0);

/** Tính CPL/CPA/ROAS + CR từ count funnel (C8.2/C8.4). THUẦN. */
export function computeFunnelMetrics(c: FunnelCounts): FunnelMetrics {
  return {
    cpl: computeCpl(c.spend, c.l2),
    cpa: computeCpa(c.spend, c.l3),
    roas: ratio(c.revenue, c.spend),
    crL1L2: ratio(c.l2, c.l1),
    crL2L3: ratio(c.l3, c.l2),
  };
}
