import { db } from "@/lib/db";
import { withMakeupException } from "@/lib/db-scope";
import { publishEvent } from "@/lib/events/publish";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { trongLop } from "@/lib/bao-luu/roster";
import {
  detectConflictsForExistingSession,
  conflictMessage,
} from "@/lib/lms/schedule-conflict";
import type { Actor } from "@/lib/auth/actor";
import { LoiDong, taoDongHocBu, thuHoiDongKhiCoMat } from "@/lib/hoc-bu/dong-service";

// =============================================================================
// Cụm B1 / R7-08 — MakeupNeed service: tạo nhu cầu bù, gợi ý buổi bù LIÊN CƠ SỞ,
// xếp + hoàn tất. Đọc chéo cơ sở đi qua withMakeupException(actor) (whitelist hẹp);
// mọi query khác vẫn cách ly cơ sở (AC6). QĐ-O2: liên cơ sở mặc định, ưu tiên CS nhà.
// =============================================================================

/** Mốc đầu ngày (so date buổi học theo NGÀY, bỏ giờ). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayKey(d: Date): number {
  return startOfDay(d).getTime();
}

/**
 * Tạo (idempotent) MakeupNeed PENDING từ 1 buổi đã lỡ. T05: BỌC MỎNG quanh `taoDongHocBu` (`lib/hoc-bu/dong-service.ts`) trong giao dịch riêng
 * — luật tạo/hồi sinh nằm ở đó. Đường điểm danh thật KHÔNG còn gọi hàm này: chúng gọi `dongBoDongSauDiemDanh` TRONG giao dịch lưu điểm danh
 * (dòng sinh ra nguyên tử với điểm danh). Giữ lại vì test cũ (R7) và `[MKN-*]` dùng; gỡ ở T16.
 */
export async function createMakeupNeed(params: {
  studentId: string;
  missedSessionId: string;
  createdById?: string | null;
  note?: string | null;
  /** Cho phép HỒI SINH dòng CANCELLED không `waivedAt` — chỉ khi đây là chuyển trạng thái THẬT. Xem `taoDongHocBu`. */
  reviveCancelled?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string; boQuaVi?: "BAO_LUU" }> {
  try {
    const r = await db.$transaction((tx) =>
      taoDongHocBu(tx, {
        studentId: params.studentId,
        missedSessionId: params.missedSessionId,
        nguon: "ABSENCE",
        createdById: params.createdById ?? null,
        note: params.note ?? null,
        hoiSinh: params.reviveCancelled === true,
      }),
    );
    // Bảo lưu theo quy chế (BR-09): buổi nằm trong khoảng bảo lưu "không tính vắng, không trừ hạn mức bù" ⇒ KHÔNG sinh nhu cầu. Luật nằm ở MỘT cửa
    // (`taoDongHocBu`) nên đường điểm danh thật cũng được che; ở đây chỉ báo lại cho người gọi: ok (không phải lỗi), không có id.
    if (r.ket === "BO_QUA_BAO_LUU") return { ok: true, boQuaVi: "BAO_LUU" };
    return { ok: true, id: r.id };
  } catch (e) {
    if (e instanceof LoiDong && e.ma === "BUOI_KHONG_TON_TAI") return { ok: false, error: e.message };
    throw e;
  }
}

export type MakeupSuggestion = {
  sessionId: string;
  classId: string;
  className: string;
  date: string;
  lessonOrder: number | null;
  lessonTitle: string | null;
  // R7-08 — cơ sở của lớp đích + cờ ưu tiên CS nhà.
  centerId: string | null;
  isHomeCenter: boolean;
  capacityLeft: number;
};

/**
 * R7-08 — Gợi ý buổi bù theo 6 tiêu chí:
 *  (1) cùng khoá của lớp lỡ · (2) lesson PHÙ HỢP (order ≤ buổi đã lỡ, không vượt
 *  tiến độ) · (3) chưa diễn ra (date ≥ hôm nay) · (4) còn sức chứa (capacityOk) ·
 *  (5) không trùng lịch HV (notConflict) · (6) LIÊN CƠ SỞ (qua exception whitelist).
 * Sort: [isHomeCenter desc, date asc] — cơ sở nhà trước, rồi lịch gần nhất.
 * Tắt `makeup.crossCenterEnabled` → quay về lọc cùng cơ sở (1 dòng filter).
 */
export async function suggestMakeupSessions(
  makeupNeedId: string,
  actor: Actor,
  /** Mốc "bây giờ" — mặc định đồng hồ thật; test truyền mốc cố định (luật 19). */
  now: Date = new Date(),
): Promise<MakeupSuggestion[]> {
  // Exception client: Class/ClassSession/Lesson/MakeupNeed đọc chéo cơ sở; phần
  // còn lại VẪN cách ly. Đọc need (HS của CS nhà) cũng đi qua client này.
  const xdb = withMakeupException(actor);

  const need = await xdb.makeupNeed.findUnique({
    where: { id: makeupNeedId },
    select: {
      studentId: true,
      classId: true,
      centerId: true,
      missedLessonId: true,
      class: { select: { courseId: true } },
      student: { select: { centerId: true } },
    },
  });
  if (!need) return [];

  const homeCenterId = need.student?.centerId ?? need.centerId ?? null;
  const crossEnabled = await getSetting("makeup.crossCenterEnabled").catch(() => true);

  // Lesson order của buổi đã lỡ (mốc trần — không cho học vượt).
  let missedOrder: number | null = null;
  if (need.missedLessonId) {
    const l = await xdb.lesson.findUnique({ where: { id: need.missedLessonId }, select: { order: true } });
    missedOrder = l?.order ?? null;
  }

  const today = startOfDay(now);

  const sessions = await xdb.classSession.findMany({
    where: {
      date: { gte: today },
      class: {
        courseId: need.class.courseId,
        deletedAt: null,
        // Tắt liên cơ sở → CHỈ cơ sở nhà (revert 1 dòng — QĐ-O2 §7).
        ...(crossEnabled || !homeCenterId ? {} : { centerId: homeCenterId }),
      },
      // Cùng lesson đã lỡ là lý tưởng; thiếu lessonId vẫn liệt kê (GV tự chọn).
      ...(need.missedLessonId ? { lessonId: need.missedLessonId } : {}),
    },
    select: {
      id: true,
      date: true,
      classId: true,
      class: { select: { name: true, centerId: true, maxStudents: true } },
      lesson: { select: { order: true, title: true } },
    },
    orderBy: { date: "asc" },
    take: 50,
  });

  // (4) capacityOk — đếm sĩ số active của các lớp ứng viên. Học bù LIÊN CƠ SỞ: lớp
  // ứng viên có thể ở cơ sở KHÁC actor. Enrollment nay ∈ SCOPED_MODELS (FL3-02) và
  // KHÔNG nằm trong MAKEUP_EXCEPTION (cố ý cách ly) → `xdb` sẽ lọc centerId IN [actor]
  // → đếm sĩ số lớp chéo cơ sở = 0 → lớp đầy lọt qua (over-book). Dùng `db` trần (chỉ
  // COUNT sĩ số, không lộ PII) — đồng nhất với scheduleMakeup (re-check qua tx trần).
  //
  // BẢO LƯU (BR-13, no-roster #5): `ENROLLMENT_ACTIVE_STATUS_LIST` cố ý gồm `PAUSED`, nhưng bé có hồ sơ bảo lưu ĐỜI MỚI đang hiệu lực
  // không ngồi ghế nào — đếm họ là báo "lớp đầy" oan và từ chối một bé khác cần bù. `trongLop(…, now)` là MỘT định nghĩa của
  // "đang thuộc lớp" (lib/bao-luu/roster.ts); PAUSED dán tay / đường cũ / hồ sơ chưa duyệt vẫn được đếm như hôm nay.
  const candidateClassIds = [...new Set(sessions.map((s) => s.classId))];
  const enrollCounts = new Map<string, number>();
  if (candidateClassIds.length > 0) {
    const grouped = await db.enrollment.groupBy({
      by: ["classId"],
      where: trongLop({ classId: { in: candidateClassIds }, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, now),
      _count: { _all: true },
    });
    for (const g of grouped) enrollCounts.set(g.classId, g._count._all);
  }

  // (5) notConflict — ngày HV đã có buổi học (lớp đang theo) → loại ứng viên trùng ngày.
  // Lớp của HV có thể ở cơ sở khác → đọc enrollment qua `db` trần (lý do như (4));
  // ClassSession ở dưới giữ `xdb` (ClassSession ∈ MAKEUP_EXCEPTION → đã nới cross-center).
  const myEnroll = await db.enrollment.findMany({
    // Lớp bé ĐANG THEO để soát trùng ngày: lớp mà bé đang bảo lưu (hồ sơ đã duyệt) không phải lớp bé đi học — không chặn ngày của nó.
    where: trongLop({ studentId: need.studentId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, now),
    select: { classId: true },
  });
  const myClassIds = myEnroll.map((e) => e.classId);
  const busyDays = new Set<number>();
  if (myClassIds.length > 0) {
    const mySessions = await xdb.classSession.findMany({
      where: { classId: { in: myClassIds }, date: { gte: today } },
      select: { date: true },
    });
    for (const s of mySessions) busyDays.add(dayKey(s.date));
  }

  return sessions
    .filter((s) => {
      // (2) không vượt tiến độ.
      if (missedOrder != null && (s.lesson?.order ?? 0) > missedOrder) return false;
      // (4) còn chỗ.
      const left = (s.class.maxStudents ?? 0) - (enrollCounts.get(s.classId) ?? 0);
      if (left <= 0) return false;
      // (5) không trùng lịch HV.
      if (busyDays.has(dayKey(s.date))) return false;
      return true;
    })
    .map((s) => ({
      sessionId: s.id,
      classId: s.classId,
      className: s.class.name,
      date: s.date.toISOString(),
      lessonOrder: s.lesson?.order ?? null,
      lessonTitle: s.lesson?.title ?? null,
      centerId: s.class.centerId ?? null,
      isHomeCenter: homeCenterId != null && s.class.centerId === homeCenterId,
      capacityLeft: (s.class.maxStudents ?? 0) - (enrollCounts.get(s.classId) ?? 0),
    }))
    // Sort: cơ sở nhà trước → lịch gần nhất (AC2).
    .sort((a, b) => {
      if (a.isHomeCenter !== b.isHomeCenter) return a.isHomeCenter ? -1 : 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
}

/**
 * R7-08 — Xếp buổi bù → SCHEDULED. Re-check sức chứa TRONG transaction (chống
 * giành chỗ cuối). Bù CHÉO cơ sở → ghi AuditLog MAKEUP_CROSS_CENTER.
 *
 * T4.1 — soát trùng PHÒNG/GV của BUỔI ĐÍCH và trả về `warning` (KHÔNG chặn): buổi
 * đích thuộc lớp khác và đã tồn tại, nên trùng ở đây là dấu hiệu buổi đó sắp phải
 * dời — người xếp cần biết trước khi hẹn phụ huynh.
 */
export async function scheduleMakeup(params: {
  makeupNeedId: string;
  makeupSessionId: string;
  scheduledById?: string | null;
  scheduledByName?: string | null;
  actor: Actor;
  /** Lý do/đối chiếu — dùng làm reason audit (= requestId của yêu cầu PH). */
  requestId?: string | null;
  /** Mốc "bây giờ" cho phép đếm sĩ số theo bảo lưu — mặc định đồng hồ thật; test truyền mốc cố định (luật 19). */
  now?: Date;
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const now = params.now ?? new Date();
  const xdb = withMakeupException(params.actor);

  const need = await xdb.makeupNeed.findUnique({
    where: { id: params.makeupNeedId },
    select: {
      status: true,
      studentId: true,
      centerId: true,
      student: { select: { centerId: true } },
    },
  });
  if (!need) return { ok: false, error: "Không tìm thấy nhu cầu bù" };
  if (need.status === "COMPLETED") return { ok: false, error: "Đã hoàn tất bù" };

  const sess = await xdb.classSession.findUnique({
    where: { id: params.makeupSessionId },
    select: { classId: true, class: { select: { centerId: true, maxStudents: true } } },
  });
  if (!sess) return { ok: false, error: "Buổi bù không tồn tại" };

  const fromCenterId = need.student?.centerId ?? need.centerId ?? null;
  const toCenterId = sess.class.centerId ?? null;
  const maxStudents = sess.class.maxStudents ?? 0;

  // Re-check sức chứa + đổi trạng thái trong 1 transaction (edge case: 2 PH giành
  // chỗ cuối → người sau fail lịch sự). Sĩ số = enrollment active + makeup đã xếp.
  try {
    await db.$transaction(async (tx) => {
      // R7-08-C8 — KHÓA theo buổi bù: advisory xact-lock serial-hoá mọi scheduler cùng
      // makeupSessionId. READ COMMITTED + count→update KHÔNG atomic (phantom: 2 request
      // cùng đếm N-1 → cùng PASS → quá chỗ). Lock này giải tuần tự → count phản ánh
      // commit của request trước. Tự nhả khi tx kết thúc. Key bigint từ hashtext(sessionId).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.makeupSessionId})::bigint)`;

      const [enrolled, scheduled] = await Promise.all([
        // Bé đang bảo lưu theo quy chế không chiếm ghế (xem chú thích ở `suggestMakeupSessions`).
        tx.enrollment.count({
          where: trongLop({ classId: sess.classId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, now),
        }),
        tx.makeupNeed.count({
          where: {
            makeupSessionId: params.makeupSessionId,
            status: "SCHEDULED",
            id: { not: params.makeupNeedId },
          },
        }),
      ]);
      if (maxStudents > 0 && enrolled + scheduled >= maxStudents) {
        throw new Error("FULL");
      }
      await tx.makeupNeed.update({
        where: { id: params.makeupNeedId },
        data: {
          status: "SCHEDULED",
          makeupSessionId: params.makeupSessionId,
          scheduledById: params.scheduledById ?? null,
        },
      });

      // R7-17 — báo PH/HV lịch bù đã xác nhận. Ghi CÙNG tx → rollback nghiệp vụ
      // (re-check sức chứa fail) thì không có event (atomic).
      await publishEvent(
        "makeup.confirmed",
        {
          makeupNeedId: params.makeupNeedId,
          studentId: need.studentId,
          makeupSessionId: params.makeupSessionId,
        },
        { tx, dedupeKey: `makeup.confirmed:${params.makeupNeedId}` },
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === "FULL") {
      return { ok: false, error: "Buổi bù đã đầy chỗ — vui lòng chọn buổi khác" };
    }
    console.error("[scheduleMakeup]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không xếp được buổi bù" };
  }

  // T4.1 — cảnh báo (không chặn) nếu buổi đích đang trùng phòng/GV với lớp khác.
  // Best-effort: lỗi soát trùng không làm hỏng việc xếp bù đã commit.
  const conflict = await detectConflictsForExistingSession(params.makeupSessionId).catch(
    () => null,
  );
  const warning = conflict ? conflictMessage(conflict) : null;

  // Bù CHÉO cơ sở → audit đủ trường (AC3). reason = requestId.
  if (fromCenterId && toCenterId && fromCenterId !== toCenterId) {
    await writeAudit({
      actor: { id: params.scheduledById ?? null, name: params.scheduledByName ?? "system" },
      module: "makeup",
      entityType: "MakeupNeed",
      entityId: params.makeupNeedId,
      action: "MAKEUP_CROSS_CENTER",
      newValues: {
        studentId: need.studentId,
        fromCenterId,
        toCenterId,
        sessionId: params.makeupSessionId,
        approvedById: params.scheduledById ?? null,
      },
      reason: params.requestId ?? params.makeupNeedId,
      orgUnitId: null,
    }).catch((e) => console.error("[scheduleMakeup] audit", e));
  }

  return { ok: true, ...(warning ? { warning } : {}) };
}

/** Hoàn tất bù → COMPLETED + đồng bộ Attendance.makeupStatus=MADE_UP (đếm số buổi đúng). */
export async function completeMakeup(makeupNeedId: string): Promise<{ ok: boolean; error?: string }> {
  const need = await db.makeupNeed.findUnique({
    where: { id: makeupNeedId },
    select: { studentId: true, missedSessionId: true, makeupSessionId: true, status: true },
  });
  if (!need) return { ok: false, error: "Không tìm thấy nhu cầu bù" };
  if (need.status === "CANCELLED") return { ok: false, error: "Nhu cầu đã huỷ" };

  await db.$transaction(async (tx) => {
    await tx.makeupNeed.update({
      where: { id: makeupNeedId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    // Đồng bộ trạng thái bù trên Attendance của buổi đã lỡ → MADE_UP.
    await tx.attendance.updateMany({
      where: { studentId: need.studentId, sessionId: need.missedSessionId },
      data: { makeupStatus: "MADE_UP", makeupSessionId: need.makeupSessionId },
    });
  });
  return { ok: true };
}

/** Huỷ nhu cầu bù. */
export async function cancelMakeup(makeupNeedId: string): Promise<{ ok: boolean }> {
  await db.makeupNeed.update({ where: { id: makeupNeedId }, data: { status: "CANCELLED" } }).catch(() => {});
  return { ok: true };
}

/**
 * Sửa điểm danh vắng → CÓ MẶT (PRESENT/LATE): thu hồi nhu cầu bù PENDING còn treo của (HV, buổi đã lỡ). T05: bọc mỏng quanh
 * `thuHoiDongKhiCoMat` — chỉ PENDING (đã SCHEDULED/COMPLETED giữ nguyên), không có dòng thì không làm gì.
 */
export async function cancelPendingMakeupNeed(params: {
  studentId: string;
  missedSessionId: string;
}): Promise<{ cancelled: number }> {
  const n = await db.$transaction((tx) => thuHoiDongKhiCoMat(tx, params));
  return { cancelled: n };
}
