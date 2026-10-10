// lib/cham-cong/brief-db.ts — gom dữ liệu cho tin nhắc lịch NGÀY MAI rồi gửi in-app (notifyStaff).
// Chạy từ cron /api/cron/shift-brief. Idempotent theo (người, ngày) nhờ dedupeKey shift.brief:<u>:<ymd>.
// Cố ý dùng `db` trần: cron chạy không có actor; phạm vi là "mọi người có ca ngày mai".
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { getSetting } from "@/lib/settings/service";
import { vnAddDays, vnDateOnly, vnParts, vnWeekday } from "@/lib/time/vn";
import { buildBrief, dateLabelVi, type BriefAssignment, type BriefNote } from "./brief";
import type { ShiftSegment } from "./catalog";
import { HO_CENTER_ID } from "./home-center";

export type BriefRunResult = { skipped?: string; date?: string; recipients: number; sent: number; suppressed: number };

function placeLabel(placeMode: string, centerName: string | null, code: string): string {
  if (placeMode === "OFFSITE") return "công tác ngoài";
  if (placeMode === "ANYWHERE") return "linh động";
  if (placeMode === "ANY_CENTER") return code === "HC" ? "theo phân công" : "cơ sở bất kỳ";
  return centerName ?? "cơ sở";
}

/**
 * Gửi tin cho ngày mai (giờ VN). `force` bỏ qua kiểm tra giờ gửi (setting shift.briefNoteHourVN).
 * Trả về số người nhận / đã gửi / bị ẩn.
 */
export async function runShiftBrief(opts: { now?: Date; force?: boolean } = {}): Promise<BriefRunResult> {
  const now = opts.now ?? new Date();
  const hour = await getSetting("shift.briefNoteHourVN");
  if (!opts.force && vnParts(now).hour !== hour) return { skipped: `chưa tới giờ gửi (${hour}:00 VN)`, recipients: 0, sent: 0, suppressed: 0 };
  const tomorrow = vnDateOnly(vnAddDays(now, 1));
  const ymd = tomorrow.toISOString().slice(0, 10);
  const wd = vnWeekday(vnAddDays(now, 1));
  const earlyArrival = await getSetting("shift.earlyArrivalMinutes");

  const [assignments, notes, holidays, centers] = await Promise.all([
    db.shiftAssignment.findMany({
      where: { workDate: tomorrow, status: "ACTIVE" },
      select: { userId: true, centerId: true, templateCode: true, segments: true, placeMode: true, isLeave: true, template: { select: { name: true, kind: true } } },
    }),
    db.shiftBriefNote.findMany({ where: { isActive: true, OR: [{ weekday: wd, date: null }, { date: tomorrow }] } }),
    db.holiday.findMany({ where: { date: { lte: tomorrow }, OR: [{ endDate: null, date: tomorrow }, { endDate: { gte: tomorrow } }] }, select: { name: true, centerId: true, briefMode: true, briefText: true } }),
    db.center.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  // Người có pattern ở khối nào thì nhận việc cố định của khối đó (kể cả ngày không có ca).
  const patternUsers = await db.shiftWeeklyPattern.findMany({ where: { effectiveTo: null }, select: { userId: true, centerId: true, section: true }, distinct: ["userId", "centerId"] });
  const unitsOfUser = new Map<string, Set<string>>();
  for (const p of patternUsers) {
    const s = unitsOfUser.get(p.userId) ?? new Set<string>();
    s.add(p.centerId);
    unitsOfUser.set(p.userId, s);
  }
  const sectionOfUser = new Map(patternUsers.map((p) => [p.userId, p.section]));
  for (const a of assignments) {
    const s = unitsOfUser.get(a.userId) ?? new Set<string>();
    s.add(a.centerId);
    unitsOfUser.set(a.userId, s);
  }
  const users = await db.user.findMany({ where: { id: { in: [...unitsOfUser.keys()] }, isActive: true, deletedAt: null }, select: { id: true, name: true } });

  let sent = 0;
  let suppressed = 0;
  for (const u of users) {
    const a = assignments.find((x) => x.userId === u.id) ?? null;
    const units = unitsOfUser.get(u.id) ?? new Set<string>();
    const myNotes: BriefNote[] = notes
      .filter((n) => units.has(n.centerId) && (n.audience === "ALL" || n.audience === sectionOfUser.get(u.id)))
      .map((n) => ({ mode: n.mode, text: n.text }));
    const hol = holidays.find((h) => h.centerId === null || units.has(h.centerId) || (a && h.centerId === a.centerId)) ?? null;
    const assignment: BriefAssignment | null = a
      ? {
          templateCode: a.templateCode,
          templateName: a.template.name,
          segments: ((a.segments as ShiftSegment[] | null) ?? []).map((s) => ({ start: s.start, end: s.end, kind: s.kind })),
          placeLabel: placeLabel(a.placeMode, a.centerId === HO_CENTER_ID ? null : (centerName.get(a.centerId) ?? null), a.templateCode),
          isOff: a.template.kind === "OFF",
          isLeave: a.isLeave,
        }
      : null;
    const brief = buildBrief({
      dateLabel: dateLabelVi(tomorrow),
      personName: u.name ?? "",
      assignment,
      notes: myNotes,
      holiday: hol ? { name: hol.name, briefMode: hol.briefMode, briefText: hol.briefText } : null,
      earlyArrivalMinutes: earlyArrival,
    });
    if (!brief.send) {
      suppressed += 1;
      continue;
    }
    const n = await notifyStaff({ userIds: [u.id], dedupeKey: `shift.brief:${u.id}:${ymd}`, title: brief.title, body: brief.body, href: "/cham-cong/lich-ca", expiresAt: new Date(tomorrow.getTime() + 36 * 3_600_000) });
    sent += n;
  }
  return { date: ymd, recipients: users.length, sent, suppressed };
}
