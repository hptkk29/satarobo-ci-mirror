// lib/cham-cong/home-center.ts — resolveHomeCenter (Q-03): cơ sở "nhà" của một nhân sự.
//
// Nguồn: `Employee.centerId` (qua User.employeeId) → `User.centerId` → null. Null = Hội sở
// ("hoi-so" là bản ghi Center mồ côi, không OrgUnit nào trỏ tới — CLAUDE.md), tức người HO.
// Module chấm công KHÔNG đọc `session.user.centerId` (ảnh chụp JWT lúc login, không làm mới
// khi đổi đơn vị). Đọc `db` trần vì đây là tra cứu danh tính, không phải dữ liệu theo cơ sở.
import { db } from "@/lib/db";

export const HO_CENTER_ID = "hoi-so";

export type HomeCenter = {
  centerId: string; // "hoi-so" nếu HO
  centerCode: string; // "CS1" | "CS2" | "HO"
  isHo: boolean;
  employeeId: string | null;
  timesheetExempt: boolean;
};

export async function resolveHomeCenter(userId: string): Promise<HomeCenter> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      centerId: true,
      employeeId: true,
      employee: { select: { id: true, centerId: true, timesheetExempt: true, center: { select: { code: true } } } },
      center: { select: { code: true } },
    },
  });
  const employee = u?.employee ?? null;
  const centerId = employee?.centerId ?? u?.centerId ?? null;
  const code = employee?.center?.code ?? u?.center?.code ?? null;
  if (!centerId || centerId === HO_CENTER_ID || code === "HO") {
    return { centerId: HO_CENTER_ID, centerCode: "HO", isHo: true, employeeId: employee?.id ?? null, timesheetExempt: employee?.timesheetExempt ?? false };
  }
  return { centerId, centerCode: code ?? centerId, isHo: false, employeeId: employee?.id ?? null, timesheetExempt: employee?.timesheetExempt ?? false };
}

/** Bản đồ mã cơ sở vận hành → centerId/orgUnitId (đọc 1 lần cho mỗi lượt import/sinh lịch). */
export async function loadCenterMap(): Promise<import("./place").CenterMap> {
  const centers = await db.center.findMany({
    where: { isActive: true, code: { not: null } },
    select: { id: true, code: true },
  });
  const orgUnits = await db.orgUnit.findMany({
    where: { type: "CENTER", centerId: { in: centers.map((c) => c.id) } },
    select: { id: true, centerId: true },
  });
  const ouByCenter = new Map(orgUnits.map((o) => [o.centerId, o.id]));
  const byCode: import("./place").CenterMap["byCode"] = {};
  for (const c of centers) {
    if (!c.code || c.code === "HO") continue;
    byCode[c.code] = { centerId: c.id, orgUnitId: ouByCenter.get(c.id) ?? null };
  }
  return { byCode, hoCenterId: HO_CENTER_ID };
}
