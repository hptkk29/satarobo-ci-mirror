// lib/classes/phases-service.ts — tầng DB cho "kế hoạch lịch học nhiều giai đoạn".
//
// Lõi tính toán thuần nằm ở `lib/classes/phases.ts` (test không cần Postgres). File này
// chỉ lo đọc/ghi và ghép nghiệp vụ.
//
// LUẬT NGHIỆP VỤ ĐÃ CHỐT (chủ dự án, 07/08/2026):
//   1. Buổi ĐÃ CÓ DỮ LIỆU (điểm danh / nhận xét / bài tập / ảnh / đã hoàn tất / đã huỷ)
//      thì GIỮ NGUYÊN NGÀY — dù nằm sau mốc áp dụng. Chỉ dời buổi còn trống.
//   2. Kế hoạch là NGUỒN SỰ THẬT của lịch; lớp chưa lập kế hoạch được nhìn như có đúng
//      1 giai đoạn mở suy từ lịch cũ ⇒ không cần backfill, lớp cũ chạy y như trước.
//   3. Đổi nhịp học thì GIỮ NGUYÊN TỔNG SỐ BUỔI — ngày bế giảng tự dịch theo.
//      ⇒ hàm dưới đây KHÔNG tạo và KHÔNG xoá buổi, chỉ đổi `date`.
//
// ⚠️ Không xoá-rồi-sinh-lại: `Attendance` và `StudentSessionFeedback` cascade theo
// `ClassSession`, và 9 bảng khác trỏ vào buổi bằng ref PHẲNG (không FK) nên xoá buổi để
// lại con trỏ mồ côi im lặng. Dời `date` là thao tác duy nhất an toàn.

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { expandHolidaySet } from "@/lib/classes/schedule";
import {
  assignPhasedDates,
  computePhasedSessionDates,
  legacyPhaseFromClass,
  legacyScheduleFromPhases,
  sortPhases,
  type SchedulePhase,
} from "@/lib/classes/phases";
import { vnStartOfDay, vnYmd } from "@/lib/time/vn";

type Tx = Prisma.TransactionClient;

/** Buổi bị KHOÁ (không được dời) và lý do hiển thị cho người dùng. */
export interface LockedReason {
  sessionId: string;
  reason: string;
}

export interface ReschedulePlanItem {
  id: string;
  topic: string | null;
  oldDate: Date;
  /** null = giữ nguyên (buổi khoá, hoặc buổi trước mốc áp dụng). */
  newDate: Date | null;
  /** Lý do giữ nguyên; null = buổi được dời. */
  keepReason: string | null;
}

export interface ReschedulePlan {
  items: ReschedulePlanItem[];
  /** Buổi thực sự đổi ngày (newDate khác oldDate). */
  changedCount: number;
  movedIds: string[];
  /** Ngày bế giảng mới = buổi muộn nhất sau khi dời (bỏ buổi đã huỷ). */
  newEndDate: Date | null;
}

const LOCKED_STATUS: Record<string, string> = {
  COMPLETED: "đã hoàn tất",
  IN_PROGRESS: "đang diễn ra",
  CANCELLED: "đã huỷ",
};

/**
 * Lịch hiệu lực của lớp dưới dạng dãy giai đoạn.
 *
 * Chưa có bản ghi giai đoạn nào → suy 1 giai đoạn mở từ lịch cũ (`scheduleDays` +
 * `ClassScheduleSlot` + giờ chung). `isDerived = true` để UI biết đây là bản gợi ý chưa
 * lưu, và để action biết mình đang chạy trên lớp chưa lập kế hoạch.
 */
export async function loadClassPhases(
  classId: string,
): Promise<{ phases: SchedulePhase[]; isDerived: boolean } | null> {
  const cls = await db.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: {
      scheduleDays: true,
      startTime: true,
      endTime: true,
      startDate: true,
      scheduleSlots: { select: { weekday: true, startTime: true, endTime: true } },
      schedulePhases: {
        orderBy: { effectiveFrom: "asc" },
        select: {
          id: true,
          effectiveFrom: true,
          effectiveTo: true,
          note: true,
          slots: {
            orderBy: { weekday: "asc" },
            select: { weekday: true, startTime: true, endTime: true },
          },
        },
      },
    },
  });
  if (!cls) return null;

  if (cls.schedulePhases.length > 0) {
    return {
      isDerived: false,
      phases: cls.schedulePhases.map((p) => ({
        id: p.id,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        note: p.note,
        slots: p.slots.map((s) => ({
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      })),
    };
  }

  const derived = legacyPhaseFromClass({
    scheduleDays: cls.scheduleDays,
    startTime: cls.startTime,
    endTime: cls.endTime,
    slots: cls.scheduleSlots,
    startDate: cls.startDate,
  });
  return { phases: derived ? [derived] : [], isDerived: true };
}

/**
 * GV/phòng + giờ chung của lớp — dữ liệu tối thiểu để soát trùng lô ngày mới.
 * Ở đây thay vì trong action vì `app/(admin)/**` bị ESLint chặn import `@/lib/db` trần.
 */
export async function loadClassConflictInfo(classId: string): Promise<{
  teacherId: string | null;
  roomId: string | null;
  startTime: string | null;
  endTime: string | null;
} | null> {
  return db.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { teacherId: true, roomId: true, startTime: true, endTime: true },
  });
}

/** Tập ngày nghỉ (cơ sở + toàn hệ thống) dạng "YYYY-MM-DD" lịch VN. */
export async function loadHolidayKeys(centerId: string | null): Promise<Set<string>> {
  const rows = await db.holiday.findMany({
    where: { OR: [{ centerId }, { centerId: null }] },
    select: { date: true, endDate: true },
  });
  return expandHolidaySet(rows);
}

/**
 * Buổi nào KHÔNG được dời, kèm lý do. Gom bằng 4 truy vấn `groupBy` thay vì n+1.
 *
 * Ngoài `status`, một buổi coi như đã dùng khi đã có điểm danh / nhận xét học viên /
 * bài tập đã giao / ảnh lớp — dời ngày những buổi này là ghi sai lịch sử (điểm danh
 * ngày 05/08 bỗng hiện thành 12/08).
 */
export async function findLockedSessions(
  sessionIds: string[],
  statusById: Map<string, string>,
): Promise<Map<string, string>> {
  const locked = new Map<string, string>();
  for (const [id, st] of statusById) {
    const label = LOCKED_STATUS[st];
    if (label) locked.set(id, label);
  }
  if (sessionIds.length === 0) return locked;

  const [att, feedback, homework, media] = await Promise.all([
    db.attendance.groupBy({
      by: ["sessionId"],
      where: { sessionId: { in: sessionIds } },
      _count: { _all: true },
    }),
    db.studentSessionFeedback.groupBy({
      by: ["classSessionId"],
      where: { classSessionId: { in: sessionIds } },
      _count: { _all: true },
    }),
    db.homeworkAssignment.groupBy({
      by: ["classSessionId"],
      where: { classSessionId: { in: sessionIds } },
      _count: { _all: true },
    }),
    db.classSessionMedia.groupBy({
      by: ["classSessionId"],
      where: { classSessionId: { in: sessionIds } },
      _count: { _all: true },
    }),
  ]);

  const add = (id: string | null, reason: string) => {
    if (!id) return;
    if (!locked.has(id)) locked.set(id, reason);
  };
  for (const r of att) add(r.sessionId, "đã điểm danh");
  for (const r of feedback) add(r.classSessionId, "đã có nhận xét");
  for (const r of homework) add(r.classSessionId, "đã giao bài tập");
  for (const r of media) add(r.classSessionId, "đã có ảnh lớp");
  return locked;
}

export interface PlanScheduleApplyInput {
  classId: string;
  /** Mốc áp dụng — 00:00 giờ VN (dựng bằng `parseVnYmd`, KHÔNG `new Date(chuỗi)`). */
  applyFrom: Date;
  /** Ghi đè kế hoạch đang lưu (dùng cho "xem trước" ngay trên form chưa lưu). */
  phasesOverride?: SchedulePhase[];
}

/**
 * Dựng phương án dời buổi kể từ `applyFrom`. THUẦN ĐỌC — không ghi gì.
 *
 * Thuật toán giữ ĐÚNG THỨ TỰ buổi: duyệt buổi theo ngày cũ tăng dần, giữ một con trỏ
 * "ngày sớm nhất được phép". Buổi khoá đẩy con trỏ qua ngày của nó; buổi dời được nhận
 * ngày ứng viên gần nhất ≥ con trỏ. Nếu chỉ lọc ngày trống mà không giữ con trỏ thì
 * buổi 12 có thể nhảy lên trước buổi 11 đang bị khoá ⇒ giáo trình chạy ngược.
 */
export async function planScheduleApply(
  input: PlanScheduleApplyInput,
): Promise<{ ok: true; plan: ReschedulePlan } | { ok: false; error: string }> {
  const cls = await db.class.findFirst({
    where: { id: input.classId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  const loaded = input.phasesOverride
    ? { phases: input.phasesOverride, isDerived: false }
    : await loadClassPhases(input.classId);
  if (!loaded) return { ok: false, error: "Lớp không tồn tại" };
  const phases = sortPhases(loaded.phases).filter((p) => p.slots.length > 0);
  if (phases.length === 0) {
    return {
      ok: false,
      error:
        "Lớp chưa có lịch học — khai Kế hoạch lịch học (tab Thông tin của lớp) trước.",
    };
  }

  const sessions = await db.classSession.findMany({
    where: { classId: input.classId },
    orderBy: { date: "asc" },
    select: { id: true, date: true, topic: true, status: true },
  });
  if (sessions.length === 0) {
    return { ok: false, error: "Lớp chưa có buổi học nào để áp lịch. Bấm “Sinh buổi học” trước." };
  }

  const fromKey = vnYmd(input.applyFrom);
  const affected = sessions.filter((s) => vnYmd(s.date) >= fromKey);
  if (affected.length === 0) {
    return { ok: false, error: `Không có buổi nào từ ngày ${fromKey} trở đi.` };
  }

  const lockedById = await findLockedSessions(
    affected.map((s) => s.id),
    new Map(affected.map((s) => [s.id, s.status as string])),
  );
  const movable = affected.filter((s) => !lockedById.has(s.id));
  if (movable.length === 0) {
    return {
      ok: false,
      error:
        "Mọi buổi từ ngày áp dụng trở đi đều đã có dữ liệu (điểm danh/nhận xét/bài tập) nên không dời được. Chọn ngày áp dụng muộn hơn.",
    };
  }

  const holidays = await loadHolidayKeys(cls.centerId);
  // Ngày đã bị buổi khoá chiếm — không xếp buổi mới vào (1 lớp không học 2 buổi/ngày).
  const blockedDays = new Set(
    affected.filter((s) => lockedById.has(s.id)).map((s) => vnYmd(s.date)),
  );

  // Dãy ứng viên phải phủ TỚI buổi khoá muộn nhất (các ứng viên rơi trước nó sẽ bị bỏ
  // qua ở bước ghép), rồi mới cần đủ chỗ cho số buổi dời được. Chốt bằng một hằng
  // (count + đệm) là dừng quá sớm ⇒ báo oan "kế hoạch không đủ chỗ" với lớp có buổi khoá
  // nằm xa mốc áp dụng (ca thật: lớp 40 buổi, buổi #30 khoá ở 27/02/2027).
  const lockedDates = affected.filter((s) => lockedById.has(s.id)).map((s) => s.date);
  const untilKey =
    lockedDates.length > 0
      ? vnYmd(lockedDates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b)))
      : null;
  const { dates: candidates } = computePhasedSessionDates({
    from: vnStartOfDay(input.applyFrom),
    count: movable.length + blockedDays.size + 8,
    phases,
    holidays,
    blockedDays,
    untilKey,
  });

  const assigned = assignPhasedDates({
    sessions: affected.map((s) => ({
      id: s.id,
      date: s.date,
      lockReason: lockedById.get(s.id) ?? null,
    })),
    from: input.applyFrom,
    candidates,
  });
  if (assigned.ranOut) {
    return {
      ok: false,
      error:
        "Kế hoạch lịch không đủ chỗ cho số buổi còn lại. Bỏ trống “đến ngày” của giai đoạn cuối (để mở) hoặc kéo dài giai đoạn cuối rồi thử lại.",
    };
  }

  const topicById = new Map(affected.map((s) => [s.id, s.topic]));
  const items: ReschedulePlanItem[] = assigned.items.map((a) => ({
    id: a.id,
    topic: topicById.get(a.id) ?? null,
    oldDate: a.oldDate,
    newDate: a.newDate,
    keepReason: a.keepReason,
  }));
  const movedIds = items
    .filter((it) => it.newDate !== null && it.newDate.getTime() !== it.oldDate.getTime())
    .map((it) => it.id);

  // Ngày bế giảng mới: buổi muộn nhất còn sống (kể cả buổi trước mốc áp dụng, và buổi
  // khoá giữ nguyên chỗ) — KHÔNG chỉ lấy buổi cuối trong lô dời.
  const liveDates: Date[] = [];
  for (const s of sessions) {
    if (s.status === "CANCELLED") continue;
    const it = items.find((i) => i.id === s.id);
    liveDates.push(it?.newDate ?? s.date);
  }
  liveDates.sort((a, b) => a.getTime() - b.getTime());
  const newEndDate = liveDates.length > 0 ? liveDates[liveDates.length - 1] : null;

  return {
    ok: true,
    plan: { items, changedCount: movedIds.length, movedIds, newEndDate },
  };
}

/**
 * Ghi kế hoạch (thay toàn bộ) + đồng bộ bản sao lịch cũ trên `Class`.
 * Gọi BÊN TRONG transaction của action — caller đã kiểm quyền và scope cơ sở.
 */
export async function persistPhases(
  tx: Tx,
  classId: string,
  phases: SchedulePhase[],
  now: Date,
): Promise<void> {
  await tx.classSchedulePhase.deleteMany({ where: { classId } });
  const sorted = sortPhases(phases);
  for (const [i, p] of sorted.entries()) {
    await tx.classSchedulePhase.create({
      data: {
        classId,
        order: i,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        note: p.note ?? null,
        slots: {
          create: p.slots.map((s) => ({
            weekday: s.weekday,
            startTime: s.startTime,
            endTime: s.endTime && s.endTime !== "" ? s.endTime : null,
          })),
        },
      },
    });
  }
  await syncLegacyScheduleFromPhases(tx, classId, sorted, now);
}

/**
 * Làm mới BẢN SAO lịch cũ cho MỌI lớp có kế hoạch, theo giai đoạn hiệu lực HÔM NAY.
 *
 * ⚠️ Vì sao bắt buộc phải có: bản sao được ghi lúc bấm Lưu kế hoạch, mà kế hoạch có
 * giai đoạn TƯƠNG LAI. Đúng 00:00 ngày giai đoạn 2 bắt đầu, lớp đổi nhịp thật nhưng bản
 * sao vẫn là của giai đoạn 1 — và không có thao tác nào của con người kích hoạt việc sửa.
 * Hệ quả nếu thiếu: site GV in sai giờ, bảng công đếm sai số buổi, dự phóng ngày bế
 * giảng ở portal sai, soát trùng phòng/GV so bằng khung giờ đã hết hiệu lực.
 *
 * Chạy hằng ngày qua Vercel Cron (`/api/cron/class-schedule-sync`). Idempotent: lớp nào
 * bản sao đã khớp thì bỏ qua, không ghi.
 */
export async function resyncLegacyScheduleForAllClasses(now = new Date()): Promise<{
  scanned: number;
  updated: number;
  classIds: string[];
}> {
  const rows = await db.class.findMany({
    where: { deletedAt: null, schedulePhases: { some: {} } },
    select: {
      id: true,
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

  const norm = (xs: { weekday: number; startTime: string; endTime: string | null }[]) =>
    [...xs]
      .sort((a, b) => a.weekday - b.weekday)
      .map((s) => `${s.weekday}|${s.startTime}|${s.endTime ?? ""}`)
      .join(";");

  const changed: string[] = [];
  for (const c of rows) {
    const phases: SchedulePhase[] = c.schedulePhases
      .map((p) => ({
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        slots: p.slots.map((s) => ({
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      }))
      .filter((p) => p.slots.length > 0);
    const want = legacyScheduleFromPhases(phases, now);
    if (!want) continue;

    const same =
      [...c.scheduleDays].sort((a, b) => a - b).join(",") ===
        [...want.scheduleDays].sort((a, b) => a - b).join(",") &&
      (c.startTime ?? null) === want.startTime &&
      (c.endTime ?? null) === want.endTime &&
      norm(c.scheduleSlots) === norm(want.slots);
    if (same) continue;

    await db.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Tx;
      await syncLegacyScheduleFromPhases(tx, c.id, phases, now);
    });
    changed.push(c.id);
  }

  return { scanned: rows.length, updated: changed.length, classIds: changed };
}

/**
 * Ghi BẢN SAO lịch cũ (`Class.scheduleDays/startTime/endTime` + `ClassScheduleSlot`) từ
 * giai đoạn đang hiệu lực.
 *
 * Vì sao không bỏ hẳn field cũ: ~40 chỗ đọc lịch kiểu cũ (site GV, PDF học bạ, soát
 * trùng phòng/GV, dự phóng ngày kết thúc ở portal). Đổi hết một lượt rủi ro hơn nhiều so
 * với giữ một bản sao luôn được đồng bộ. Đây là bước 2-phase, không phải nợ vô thời hạn.
 */
export async function syncLegacyScheduleFromPhases(
  tx: Tx,
  classId: string,
  phases: SchedulePhase[],
  now: Date,
): Promise<void> {
  const legacy = legacyScheduleFromPhases(phases, now);
  if (!legacy) return;

  await tx.class.update({
    where: { id: classId },
    data: {
      scheduleDays: legacy.scheduleDays,
      startTime: legacy.startTime,
      endTime: legacy.endTime,
    },
  });
  await tx.classScheduleSlot.deleteMany({ where: { classId } });
  if (legacy.slots.length > 0) {
    await tx.classScheduleSlot.createMany({
      data: legacy.slots.map((s) => ({
        classId,
        weekday: s.weekday,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    });
  }
}
