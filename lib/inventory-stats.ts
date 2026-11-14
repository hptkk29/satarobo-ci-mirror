import { db } from "@/lib/db";

export type LowStockSeverity = "CRITICAL" | "WARNING";

export interface CenterStats {
  centerId: string;
  centerName: string;
  distinctItems: number; // items with quantity > 0
  totalValue: number;
  lowStockItems: number;
  lastActivity: Date | null;
}

export interface LowStockAlert {
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  centerId: string;
  centerName: string;
  quantity: number;
  threshold: number;
  severity: LowStockSeverity;
}

export interface InventoryStats {
  totalItems: number;
  totalStockValue: number;
  totalBalances: number; // (item × center) entries with qty > 0
  lowStockCount: number;
  recentMovements: number; // last 7 days
  centers: CenterStats[];
  lowStockAlerts: LowStockAlert[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function getInventoryStats(): Promise<InventoryStats> {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

  const [totalItems, balances, recentMovements] = await Promise.all([
    db.inventoryItem.count({ where: { isActive: true } }),
    db.stockBalance.findMany({
      include: {
        item: {
          select: {
            id: true,
            itemCode: true,
            name: true,
            unit: true,
            pricePerUnit: true,
            defaultMinThreshold: true,
            isActive: true,
          },
        },
        center: { select: { id: true, name: true, isActive: true } },
      },
    }),
    db.stockMovement.count({
      where: { performedAt: { gte: sevenDaysAgo } },
    }),
  ]);

  // Only consider balances belonging to active items + active centers.
  const activeBalances = balances.filter(
    (b) => b.item.isActive && b.center.isActive,
  );

  let totalStockValue = 0;
  for (const b of activeBalances) {
    if (b.item.pricePerUnit && b.quantity > 0) {
      totalStockValue += b.quantity * b.item.pricePerUnit;
    }
  }

  const totalBalances = activeBalances.filter((b) => b.quantity > 0).length;

  const lowStockBalances = activeBalances.filter((b) => {
    const threshold = b.minThreshold ?? b.item.defaultMinThreshold;
    return b.quantity < threshold;
  });

  // Per-center aggregation
  const centerMap = new Map<string, CenterStats>();
  for (const b of activeBalances) {
    let entry = centerMap.get(b.centerId);
    if (!entry) {
      entry = {
        centerId: b.centerId,
        centerName: b.center.name,
        distinctItems: 0,
        totalValue: 0,
        lowStockItems: 0,
        lastActivity: null,
      };
      centerMap.set(b.centerId, entry);
    }
    if (b.quantity > 0) entry.distinctItems += 1;
    if (b.item.pricePerUnit) {
      entry.totalValue += b.quantity * b.item.pricePerUnit;
    }
    const threshold = b.minThreshold ?? b.item.defaultMinThreshold;
    if (b.quantity < threshold) entry.lowStockItems += 1;

    const last = pickLater(b.lastReceiptAt, b.lastIssueAt);
    if (last && (!entry.lastActivity || last > entry.lastActivity)) {
      entry.lastActivity = last;
    }
  }
  const centers = Array.from(centerMap.values()).sort(
    (a, b) => b.totalValue - a.totalValue,
  );

  const lowStockAlerts: LowStockAlert[] = lowStockBalances
    .map((b) => {
      const threshold = b.minThreshold ?? b.item.defaultMinThreshold;
      return {
        itemId: b.item.id,
        itemCode: b.item.itemCode,
        itemName: b.item.name,
        unit: b.item.unit,
        centerId: b.centerId,
        centerName: b.center.name,
        quantity: b.quantity,
        threshold,
        severity: (b.quantity === 0 ? "CRITICAL" : "WARNING") as LowStockSeverity,
      };
    })
    .sort((a, b) => {
      // CRITICAL first
      if (a.severity !== b.severity) {
        return a.severity === "CRITICAL" ? -1 : 1;
      }
      // Then by quantity ascending (most-empty first)
      if (a.quantity !== b.quantity) return a.quantity - b.quantity;
      // Tie-break by itemCode for stable ordering
      return a.itemCode.localeCompare(b.itemCode);
    });

  return {
    totalItems,
    totalStockValue,
    totalBalances,
    lowStockCount: lowStockBalances.length,
    recentMovements,
    centers,
    lowStockAlerts,
  };
}

function pickLater(a: Date | null, b: Date | null): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}
