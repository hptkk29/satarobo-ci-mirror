// lib/cham-cong/luoi-phan-ca-db.ts — dữ liệu LƯỚI PHÂN CA THÁNG của MỘT khối (người × ngày = mã ca).
//
// MỘT nguồn cho hai nơi: màn `/cham-cong/phan-ca` và tệp Excel
// `/api/admin/cham-cong/phan-ca/export`. Tách ra 07/10/2026 khi thêm nút xuất: tệp mà in lịch
// khác màn quản lý đang nhìn là lỗi không tự lộ ra — hai bên không bao giờ gặp nhau.
//
// Luật giữ nguyên từ màn (đừng sửa ở một bên):
//  · Người thuộc khối = có khung ca ĐANG MỞ ở khối HOẶC có ca ACTIVE trong tháng chịu công tại khối.
//  · Ô của ca chịu công ở khối KHÁC: in mã thật (ưu tiên ô của khối này trong `sourceCells`) và
//    gắn `foreignUnit` — trên màn là ô chỉ đọc.
//  · Ngày nghỉ tuần đọc `shift.weeklyOffDays` theo đơn vị; ngày lễ đọc `loadHolidayRanges`
//    (KHÔNG qua scopedDb — xem lib/cham-cong/holidays.ts).
import type { scopedDb } from "@/lib/db-scope";
import { holidayYmdSet, loadHolidayRanges } from "@/lib/cham-cong/holidays";
import { getSetting } from "@/lib/settings/service";
import { daysOfMonth } from "@/lib/cham-cong/generate";

export type LuoiNgay = {
  day: number;
  /** 0 = CN … 6 = T7 */
  wd: number;
  ymd: string;
  /** "05/10" */
  label: string;
  off: boolean;
  holiday: boolean;
  today: boolean;
};

export type LuoiO = { code: string; source: string; foreignUnit?: string };

export type LuoiHang = {
  userId: string;
  name: string;
  jobLabel: string | null;
  homeUnit: string;
  cells: Record<number, LuoiO>;
};

export type LuoiMaCa = {
  code: string;
  name: string;
  segments: unknown;
  defaultPlace: string;
  isLeave: boolean;
  dayCredit: number;
  soCapQuetKyVong: number;
};

export type LuoiPhanCa = {
  days: LuoiNgay[];
  rows: LuoiHang[];
  templates: LuoiMaCa[];
  /** Mã ca CÓ MẶT trong tháng (kể cả của khối khác) — để lọc chú giải giờ ca. */
  maDaDung: string[];
};

export async function loadLuoiPhanCa(input: {
  sdb: ReturnType<typeof scopedDb>;
  /** Center.id của khối (hoặc HO_CENTER_ID). */
  coSo: string;
  /** "YYYY-MM" */
  ky: string;
  orgUnitId: string | null;
  /** Mã đơn vị của khối đang xem (HO / CS1 / CS2) — dùng đọc `sourceCells`. */
  unitHere: string;
  /** Center.id → mã đơn vị (cho ô chịu công ở khối khác). */
  unitOf: (centerId: string) => string;
  /** "YYYY-MM-DD" giờ VN — tô cột hôm nay. */
  today: string;
}): Promise<LuoiPhanCa> {
  const { sdb, coSo, ky, orgUnitId, unitHere, unitOf, today } = input;
  const [y, m] = ky.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));

  const [patterns, assignments, weeklyOff] = await Promise.all([
    sdb.shiftWeeklyPattern.findMany({
      where: { centerId: coSo, effectiveTo: null },
      select: { userId: true, jobLabel: true, displayOrder: true },
    }),
    sdb.shiftAssignment.findMany({
      where: { workDate: { gte: from, lte: to }, status: "ACTIVE", centerId: coSo },
      select: { userId: true },
    }),
    getSetting("shift.weeklyOffDays", { orgUnitId }),
  ]);

  const userIds = [...new Set([...patterns.map((p) => p.userId), ...assignments.map((a) => a.userId)])];
  const [allAssign, users, templates, holidayRows] = await Promise.all([
    userIds.length
      ? sdb.shiftAssignment.findMany({
          where: { userId: { in: userIds }, workDate: { gte: from, lte: to }, status: "ACTIVE" },
          select: { userId: true, workDate: true, templateCode: true, source: true, centerId: true, sourceCells: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? sdb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    sdb.shiftTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true, segments: true, defaultPlace: true, isLeave: true, dayCredit: true, soCapQuetKyVong: true },
      orderBy: { displayOrder: "asc" },
    }),
    loadHolidayRanges(coSo, from, to),
  ]);

  const holidays = holidayYmdSet(holidayRows);
  const offSet = new Set(weeklyOff);
  const days: LuoiNgay[] = daysOfMonth(y, m).map((d) => {
    const ymd = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    return {
      day: d.getUTCDate(),
      wd,
      ymd,
      label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(m).padStart(2, "0")}`,
      off: offSet.has(wd),
      holiday: holidays.has(ymd),
      today: ymd === today,
    };
  });

  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const jobOf = new Map(patterns.map((p) => [p.userId, p.jobLabel]));
  const order = new Map(patterns.map((p) => [p.userId, p.displayOrder]));
  const byUser = new Map<string, typeof allAssign>();
  for (const a of allAssign) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const rows: LuoiHang[] = userIds
    .sort(
      (a, b) =>
        (order.get(a) ?? 999) - (order.get(b) ?? 999) ||
        (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "", "vi-VN"),
    )
    .map((userId) => {
      const cells: LuoiHang["cells"] = {};
      for (const a of byUser.get(userId) ?? []) {
        const day = a.workDate.getUTCDate();
        const sc = (a.sourceCells as Record<string, string> | null) ?? null;
        const own = a.centerId === coSo;
        cells[day] = {
          code: own ? a.templateCode : (sc?.[unitHere] ?? a.templateCode),
          source: a.source,
          foreignUnit: own ? undefined : unitOf(a.centerId),
        };
      }
      return { userId, name: nameOf.get(userId) ?? userId, jobLabel: jobOf.get(userId) ?? null, homeUnit: unitHere, cells };
    });

  return {
    days,
    rows,
    templates,
    maDaDung: allAssign.map((a) => a.templateCode),
  };
}
