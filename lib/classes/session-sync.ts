// lib/classes/session-sync.ts — GIỮ dãy buổi học luôn khớp "ngày khai giảng + lịch học".
//
// SỰ CỐ GỐC (prod 08/08/2026, lớp `sata3.15h45-17h15.T7.CS1-201`):
// `ClassSession` chỉ được xếp MỘT LẦN, ở `approveClass` với `onlyIfEmpty: true`. Sau đó:
//   • `updateClass` sửa `startDate`/thứ/giờ → tính lại `endDate` nhưng KHÔNG đụng buổi;
//   • nút "Sinh buổi học" (`onlyIfEmpty`) trả `ok, generated: 0` — im lặng, không sửa được;
//   • "Áp dụng dời buổi" chỉ dời buổi TƯƠNG LAI, mốc `max(ngày mai, startDate)` ⇒ không thể
//     kéo dãy về ngày khai giảng nằm ở quá khứ.
// ⇒ Sửa ngày khai giảng xong là lịch lớp và buổi học lệch nhau vĩnh viễn, không ai biết.
//
// File này là ĐƯỜNG DUY NHẤT để "xếp lại buổi cho khớp lịch": dùng chung cho
// `updateClass` (tự động), nút sửa tay ở màn lớp, và script rà soát.
//
// LUẬT (kế thừa nguyên chốt của chủ dự án 07/08 cho Kế hoạch lịch học):
//   1. CHỈ đổi `date`. KHÔNG tạo, KHÔNG xoá buổi ⇒ tổng số buổi của khoá không đổi,
//      `Attendance`/`StudentSessionFeedback` (cascade) và 9 bảng trỏ buổi bằng ref phẳng
//      đều an toàn.
//   2. Buổi ĐÃ CÓ DỮ LIỆU (điểm danh / nhận xét / bài tập / ảnh / đã hoàn tất / đã huỷ)
//      GIỮ NGUYÊN NGÀY và chiếm chỗ ngày đó — không viết lại lịch sử.
//   3. Lớp chưa có buổi nào thì SINH mới theo `generateClassSessions`.

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { generateClassSessions } from "@/lib/classes/generate";
import {
  loadClassConflictInfo,
  loadClassPhases,
  loadHolidayKeys,
  planScheduleApply,
} from "@/lib/classes/phases-service";
import { legacyPhaseFromClass, slotForDate, type SchedulePhase } from "@/lib/classes/phases";
import { expandHolidaySet } from "@/lib/classes/schedule";
import { auditSessionSeries, type SessionSeriesAudit } from "@/lib/classes/session-audit";
import { detectBatchConflicts } from "@/lib/lms/schedule-conflict";
import { logClassAudit } from "@/lib/audit/log";
import { publishEvent } from "@/lib/events/publish";
import { formatDateVN } from "@/lib/format/date";
import { vnDateOnly, vnStartOfDay, vnYmd } from "@/lib/time/vn";

export interface ClassSessionAudit extends SessionSeriesAudit {
  classId: string;
  className: string;
  classStatus: string;
  /** Cần cho caller tự lọc cách ly cơ sở (bản rà soát toàn hệ thống đọc bằng `db` trần). */
  centerId: string | null;
  startDate: Date | null;
  sessionCount: number;
}

/** Soát 1 lớp: dãy buổi có khớp ngày khai giảng + lịch không. THUẦN ĐỌC. */
export async function auditClassSessions(classId: string): Promise<ClassSessionAudit | null> {
  const cls = await db.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, name: true, status: true, startDate: true, centerId: true },
  });
  if (!cls) return null;

  const [loaded, holidays, sessions] = await Promise.all([
    loadClassPhases(classId),
    loadHolidayKeys(cls.centerId),
    db.classSession.findMany({
      where: { classId },
      orderBy: { date: "asc" },
      select: { id: true, date: true, status: true },
    }),
  ]);

  const audit = auditSessionSeries({
    from: cls.startDate ? vnStartOfDay(cls.startDate) : null,
    phases: loaded?.phases ?? [],
    holidays,
    sessions,
    classStatus: cls.status,
  });

  return {
    ...audit,
    classId: cls.id,
    className: cls.name,
    classStatus: cls.status,
    centerId: cls.centerId,
    startDate: cls.startDate,
    sessionCount: sessions.length,
  };
}

/**
 * Soát TOÀN BỘ lớp trong 4 truy vấn (không n+1) — cho màn "Kiểm tra lịch buổi học".
 *
 * Chỉ trả lớp CÓ VẤN ĐỀ. Lớp đã huỷ không xét (buổi của lớp huỷ không cần khớp lịch).
 * ⚠️ Quy mô: nạp toàn bộ `ClassSession` của các lớp còn sống. Ở mức vài nghìn lớp cần
 * đổi sang quét theo trang — hiện tại (chục lớp) thì một lượt là đủ và đơn giản hơn.
 */
export async function auditAllClassSessions(): Promise<ClassSessionAudit[]> {
  const classes = await db.class.findMany({
    where: { deletedAt: null, status: { not: "CANCELLED" } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      centerId: true,
      scheduleDays: true,
      startTime: true,
      endTime: true,
      scheduleSlots: { select: { weekday: true, startTime: true, endTime: true } },
      schedulePhases: {
        orderBy: { effectiveFrom: "asc" },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          slots: { select: { weekday: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (classes.length === 0) return [];

  const [sessions, holidayRows] = await Promise.all([
    db.classSession.findMany({
      where: { classId: { in: classes.map((c) => c.id) } },
      orderBy: { date: "asc" },
      select: { id: true, classId: true, date: true, status: true },
    }),
    db.holiday.findMany({ select: { centerId: true, date: true, endDate: true } }),
  ]);

  const byClass = new Map<string, { id: string; date: Date; status: string }[]>();
  for (const s of sessions) {
    const arr = byClass.get(s.classId) ?? [];
    arr.push({ id: s.id, date: s.date, status: s.status });
    byClass.set(s.classId, arr);
  }
  // Ngày nghỉ hiệu lực của một cơ sở = nghỉ riêng cơ sở + nghỉ toàn hệ thống (centerId null).
  const holidayCache = new Map<string, Set<string>>();
  const holidaysFor = (centerId: string | null): Set<string> => {
    const key = centerId ?? "__global__";
    const hit = holidayCache.get(key);
    if (hit) return hit;
    const set = expandHolidaySet(
      holidayRows.filter((h) => h.centerId === null || h.centerId === centerId),
    );
    holidayCache.set(key, set);
    return set;
  };

  const out: ClassSessionAudit[] = [];
  for (const c of classes) {
    const phases: SchedulePhase[] =
      c.schedulePhases.length > 0
        ? c.schedulePhases.map((p) => ({
            effectiveFrom: p.effectiveFrom,
            effectiveTo: p.effectiveTo,
            slots: p.slots.map((s) => ({
              weekday: s.weekday,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          }))
        : (() => {
            const derived = legacyPhaseFromClass({
              scheduleDays: c.scheduleDays,
              startTime: c.startTime,
              endTime: c.endTime,
              slots: c.scheduleSlots,
              startDate: c.startDate,
            });
            return derived ? [derived] : [];
          })();

    const list = byClass.get(c.id) ?? [];
    const audit = auditSessionSeries({
      from: c.startDate ? vnStartOfDay(c.startDate) : null,
      phases,
      holidays: holidaysFor(c.centerId),
      sessions: list,
      classStatus: c.status,
    });
    if (audit.severity === "OK") continue;
    out.push({
      ...audit,
      classId: c.id,
      className: c.name,
      classStatus: c.status,
      centerId: c.centerId,
      startDate: c.startDate,
      sessionCount: list.length,
    });
  }

  // Nặng trước: neo sai / chưa có buổi phải nằm trên đầu.
  const rank: Record<string, number> = { ANCHOR_WRONG: 0, NO_SESSIONS: 1, DRIFT: 2, NO_SCHEDULE: 3 };
  return out.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

export interface ResyncInput {
  classId: string;
  /**
   * true  = xếp lại TỪ ĐẦU (mốc = sớm nhất giữa ngày khai giảng và buổi đầu hiện có).
   *         Dùng khi ngày khai giảng đổi — cả dãy phải neo lại.
   * false = chỉ xếp lại từ HÔM NAY trở đi, giữ nguyên quá khứ. Dùng khi chỉ đổi thứ/giờ.
   */
  wholeSeries: boolean;
  actor: { id: string | null; name: string };
  reason?: string;
}

export interface ResyncResult {
  ok: boolean;
  error?: string;
  warning?: string;
  /** Số buổi vừa SINH (lớp trước đó chưa có buổi nào). */
  generated?: number;
  /** Số buổi đổi ngày. */
  moved?: number;
  /** Số buổi giữ nguyên vì đã có dữ liệu. */
  kept?: number;
}

/**
 * Xếp lại buổi học cho khớp ngày khai giảng + lịch học.
 *
 * Lớp chưa có buổi → sinh mới. Lớp đã có buổi → dời `date` theo dãy chuẩn, giữ nguyên
 * buổi đã có dữ liệu. Trùng phòng/GV chỉ CẢNH BÁO (không chặn): chặn ở đây sẽ để lớp
 * ở trạng thái "lịch một đằng buổi một nẻo" — đúng cái lỗi đang phải vá.
 */
export async function resyncClassSessions(input: ResyncInput): Promise<ResyncResult> {
  const cls = await db.class.findFirst({
    where: { id: input.classId, deletedAt: null },
    select: { id: true, startDate: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  const first = await db.classSession.findFirst({
    where: { classId: input.classId },
    orderBy: { date: "asc" },
    select: { date: true },
  });

  // Chưa có buổi nào → sinh mới theo đúng đường cũ (có gắn lesson/plan, soát trùng).
  if (!first) {
    const gen = await generateClassSessions(input.classId, { onlyIfEmpty: true });
    if (!gen.ok) return { ok: false, error: gen.error ?? "Không sinh được buổi học" };
    return { ok: true, generated: gen.generated, ...(gen.warning ? { warning: gen.warning } : {}) };
  }

  const startDay = cls.startDate ? vnStartOfDay(cls.startDate) : null;
  const firstDay = vnStartOfDay(first.date);
  let applyFrom: Date;
  if (input.wholeSeries) {
    // Sớm nhất giữa hai mốc: đủ để MỌI buổi lọt vào lô xếp lại, kể cả khi ngày khai
    // giảng bị dời muộn hơn buổi đầu đang có.
    applyFrom = startDay && startDay.getTime() < firstDay.getTime() ? startDay : firstDay;
  } else {
    const today = vnStartOfDay(new Date());
    applyFrom = startDay && startDay.getTime() > today.getTime() ? startDay : today;
  }

  const planned = await planScheduleApply({ classId: input.classId, applyFrom });
  if (!planned.ok) return { ok: false, error: planned.error };

  const moves = planned.plan.items.filter(
    (it) => it.newDate !== null && it.newDate.getTime() !== it.oldDate.getTime(),
  );
  const kept = planned.plan.items.filter((it) => it.keepReason !== null).length;
  if (moves.length === 0) return { ok: true, moved: 0, kept };

  const warning = await conflictWarning(
    input.classId,
    moves.map((m) => m.newDate as Date),
  );

  try {
    await db.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      for (const it of moves) {
        await tx.classSession.update({
          where: { id: it.id },
          data: { date: it.newDate as Date },
        });
      }
      if (planned.plan.newEndDate) {
        // Cột NGÀY dùng quy ước nửa đêm UTC (trùng `z.coerce.date("YYYY-MM-DD")` của form).
        await tx.class.update({
          where: { id: input.classId },
          data: { endDate: vnDateOnly(planned.plan.newEndDate) },
        });
      }
      await logClassAudit({
        classId: input.classId,
        action: "UPDATE",
        actorId: input.actor.id,
        actorName: input.actor.name,
        oldValues: { sessions: moves.map((m) => ({ id: m.id, date: vnYmd(m.oldDate) })) },
        newValues: {
          applyFrom: vnYmd(applyFrom),
          sessions: moves.map((m) => ({ id: m.id, date: vnYmd(m.newDate as Date) })),
          keptCount: kept,
        },
        changedFields: ["sessions.date", "endDate"],
        reason: input.reason?.trim() || `Xếp lại buổi theo lịch từ ${vnYmd(applyFrom)}`,
        tx,
      });
      // 1 event cho cả lô — đừng bắn mỗi buổi 1 tin cho phụ huynh.
      await publishEvent(
        "class.session_changed",
        { classId: input.classId, change: "RESCHEDULED", count: moves.length },
        { tx },
      );
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi xếp lại buổi: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  return { ok: true, moved: moves.length, kept, ...(warning ? { warning } : {}) };
}

/**
 * Cảnh báo trùng phòng/GV cho lô ngày mới — best-effort, KHÔNG chặn.
 * Nhóm theo khung giờ THẬT của từng ngày (lớp nhiều ca / nhiều giai đoạn khác giờ).
 */
async function conflictWarning(classId: string, dates: Date[]): Promise<string | undefined> {
  if (dates.length === 0) return undefined;
  try {
    const [cls, loaded] = await Promise.all([
      loadClassConflictInfo(classId),
      loadClassPhases(classId),
    ]);
    if (!cls || (!cls.teacherId && !cls.roomId)) return undefined;
    const phases: SchedulePhase[] = loaded?.phases ?? [];

    const groups = new Map<string, { startTime: string; endTime: string | null; dates: Date[] }>();
    for (const d of dates) {
      const slot = slotForDate(phases, d);
      const startTime = slot?.startTime || cls.startTime || "";
      if (!startTime) continue;
      const endTime = slot?.endTime ?? cls.endTime ?? null;
      const key = `${startTime}|${endTime ?? ""}`;
      const g = groups.get(key) ?? { startTime, endTime, dates: [] };
      g.dates.push(d);
      groups.set(key, g);
    }

    const found: { date: Date; messages: string[] }[] = [];
    for (const g of groups.values()) {
      found.push(
        ...(await detectBatchConflicts({
          centerId: null, // GV có thể dạy 2 cơ sở → soát toàn hệ thống
          excludeClassId: classId,
          classStartTime: g.startTime,
          classEndTime: g.endTime,
          teacherId: cls.teacherId,
          roomId: cls.roomId,
          dates: g.dates,
        }).catch(() => [])),
      );
    }
    if (found.length === 0) return undefined;
    found.sort((a, b) => a.date.getTime() - b.date.getTime());
    const shown = found.slice(0, 3).map((c) => formatDateVN(c.date));
    const more = found.length > shown.length ? ` (+${found.length - shown.length} buổi nữa)` : "";
    const kinds = [...new Set(found.flatMap((c) => c.messages))].join("; ");
    return `Cảnh báo xếp lịch — ${kinds}. Ngày: ${shown.join(", ")}${more}.`;
  } catch {
    return undefined; // soát trùng hỏng không được chặn việc sửa lịch
  }
}
