"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@/lib/auth/permissions";
import { getFreshGateUser } from "@/lib/auth/fresh-gate-user";
import { canStartSession, canCompleteSession } from "@/lib/sessions/status";
import { saveSessionFeedbackCore, saveSessionEvalCore } from "./_feedback-core";

type Result = { ok: true } | { ok: false; error: string };
type Sdb = ReturnType<typeof scopedDb>;

type ClassGate = {
  teacherId: string | null;
  assistantId: string | null;
  centerId: string | null;
};

/**
 * LMS-2/3 — quyền thao tác trên 1 buổi học của lớp: SUPER_ADMIN, CENTER_MANAGER
 * cùng cơ sở, hoặc GV chính/trợ giảng của lớp.
 * ⚠️ Gate này KHÔNG biết dạy thay/thực dạy (chỉ nhìn LỚP) — luồng NHẬN XÉT đã chuyển
 * sang `canManageSessionRecord` (./_feedback-core, ownership theo BUỔI). Giữ nguyên
 * cho các caller còn lại (attendance/assignments/exams/checklist + view page).
 */
export async function canManageSessionClass(
  user: { id: string; role: string; centerId: string | null },
  cls: ClassGate,
): Promise<boolean> {
  // 19/08 — vai + cơ sở đọc TỪ DB, không lấy từ JWT: gỡ vai trong DB phải có tác dụng
  // ngay, không đợi người dùng đăng xuất. Xem lib/auth/fresh-gate-user.ts.
  const fresh = await getFreshGateUser(user.id);
  const u = fresh ?? user;
  if (hasRole(u, "SUPER_ADMIN")) return true;
  if (hasRole(u, "CENTER_MANAGER")) return !!cls.centerId && cls.centerId === u.centerId;
  if (hasRole(u, "TEACHER")) return cls.teacherId === user.id || cls.assistantId === user.id;
  return false;
}


/**
 * Site GV — lưu PHIẾU nhận xét buổi học của MỘT học viên. Wrapper auth() mỏng —
 * logic thật (gate ownership + upsert + notify) ở ./_feedback-core (saveSessionEvalCore).
 */
export async function saveSessionEval(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const res = await saveSessionEvalCore(
    { id: session.user.id, role: session.user.role, centerId: session.user.centerId },
    input,
    { guiEmailPhuHuynh: true },
  );
  if (res.ok) {
    revalidatePath("/teacher/nhan-xet");
    revalidatePath("/teacher/lop");
  }
  return res;
}

/**
 * LMS-2 — lưu hàng loạt nhận xét từng HS cho 1 buổi. Wrapper auth() mỏng — logic
 * thật ở ./_feedback-core (saveSessionFeedbackCore): dòng rỗng chỉ xoá phiếu thuần
 * comment (phiếu rubric được GIỮ), email chỉ gửi khi comment đổi.
 */
export async function saveSessionFeedback(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const res = await saveSessionFeedbackCore(
    { id: session.user.id, role: session.user.role, centerId: session.user.centerId },
    input,
  );
  if (res.ok) {
    const sid =
      typeof input === "object" && input !== null
        ? (input as { sessionId?: unknown }).sessionId
        : undefined;
    if (typeof sid === "string" && sid) revalidatePath(`/sessions/${sid}`);
    revalidatePath("/teacher/nhan-xet");
  }
  return res;
}

// ── LMS-3 — checklist sau buổi ────────────────────────────────────────────

const PRESENT_STATUSES = ["PRESENT", "LATE"] as const;

async function loadSessionForGate(sessionId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  const sdb = scopedDb(await resolveActor(session.user.id));
  // ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này.
  const sess = await sdb.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      centerId: true,
      lessonId: true,
      status: true,
      class: { select: { id: true, teacherId: true, assistantId: true, centerId: true } },
    },
  });
  if (!sess) return { ok: false as const, error: "Buổi học không tồn tại" };
  const allowed = await canManageSessionClass(
    { id: session.user.id, role: session.user.role, centerId: session.user.centerId },
    sess.class,
  );
  if (!allowed) return { ok: false as const, error: "Không có quyền thao tác buổi học này" };
  return { ok: true as const, sess, sdb };
}

/** Tính 2 bước suy ra: điểm danh xong + đã nhận xét HS có mặt. */
// Attendance ∈ SCOPE_EXEMPT (chờ backfill PROD) + StudentSessionFeedback không scoped
// → sdb pass-through; cách ly đã chốt ở loadSessionForGate (buổi trong tầm nhìn).
async function deriveSteps(
  sdb: Sdb,
  sessionId: string,
): Promise<{ ckAttendance: boolean; ckFeedback: boolean }> {
  const [attCount, presentRows, feedbackRows] = await Promise.all([
    sdb.attendance.count({ where: { sessionId } }),
    sdb.attendance.findMany({
      where: { sessionId, status: { in: [...PRESENT_STATUSES] } },
      select: { studentId: true },
    }),
    sdb.studentSessionFeedback.findMany({
      where: { classSessionId: sessionId },
      select: { studentId: true },
    }),
  ]);
  const fbSet = new Set(feedbackRows.map((f) => f.studentId));
  const ckFeedback =
    presentRows.length === 0 ? false : presentRows.every((p) => fbSet.has(p.studentId));
  return { ckAttendance: attCount > 0, ckFeedback };
}

const checklistSchema = z.object({
  sessionId: z.string().min(1),
  ckClean: z.boolean(),
  ckEquipment: z.boolean(),
  ckKit: z.boolean(),
  ckLessonConfirmed: z.boolean(),
  ckMedia: z.boolean(),
  ckHomework: z.boolean(),
  ckIncident: z.boolean(),
  incidentNote: z.string().trim().max(3000).optional().or(z.literal("")),
  lessonNotes: z.string().trim().max(5000).optional().or(z.literal("")),
});

/** Lưu các bước thủ công + đồng bộ 2 bước suy ra. */
export async function updateSessionChecklist(input: unknown): Promise<Result> {
  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const gate = await loadSessionForGate(parsed.data.sessionId);
  if (!gate.ok) return gate;

  const derived = await deriveSteps(gate.sdb, parsed.data.sessionId);
  try {
    await gate.sdb.classSession.update({
      where: { id: parsed.data.sessionId },
      data: {
        ckClean: parsed.data.ckClean,
        ckEquipment: parsed.data.ckEquipment,
        ckKit: parsed.data.ckKit,
        ckLessonConfirmed: parsed.data.ckLessonConfirmed,
        ckMedia: parsed.data.ckMedia,
        ckHomework: parsed.data.ckHomework,
        ckIncident: parsed.data.ckIncident,
        incidentNote: parsed.data.incidentNote || null,
        lessonNotes: parsed.data.lessonNotes || null,
        ckAttendance: derived.ckAttendance,
        ckFeedback: derived.ckFeedback,
      },
    });
  } catch (err) {
    return { ok: false, error: `Lỗi lưu checklist: ${err instanceof Error ? err.message : "Unknown"}` };
  }
  revalidatePath(`/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

/** Bắt đầu buổi học. */
export async function startSession(sessionId: string): Promise<Result> {
  const gate = await loadSessionForGate(sessionId);
  if (!gate.ok) return gate;
  // FIX-H4 — chỉ bắt đầu được khi đang SCHEDULED. Mã lỗi INVALID_SESSION_STATE.
  if (!canStartSession(gate.sess.status)) {
    return { ok: false, error: "INVALID_SESSION_STATE" };
  }
  await gate.sdb.classSession.update({
    where: { id: sessionId },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

/** Hoàn tất buổi — chỉ khi (1) điểm danh, (2) xác nhận bài, (3) nhận xét đã xong. */
export async function completeSession(sessionId: string): Promise<Result> {
  const gate = await loadSessionForGate(sessionId);
  if (!gate.ok) return gate;
  // FIX-H4 — chỉ hoàn tất được khi đang IN_PROGRESS (chặn re-complete buổi đã xong/hủy).
  if (!canCompleteSession(gate.sess.status)) {
    return { ok: false, error: "INVALID_SESSION_STATE" };
  }

  const derived = await deriveSteps(gate.sdb, sessionId);
  const sess = await gate.sdb.classSession.findUnique({
    where: { id: sessionId },
    // ⚠️ kèm centerId — findUnique model scoped lọc hậu kỳ theo field này.
    select: { centerId: true, ckLessonConfirmed: true },
  });
  if (!derived.ckAttendance) return { ok: false, error: "Chưa điểm danh — không thể hoàn tất" };
  if (!sess?.ckLessonConfirmed) return { ok: false, error: "Chưa xác nhận bài đã dạy" };
  if (!derived.ckFeedback) {
    return { ok: false, error: "Chưa nhận xét đủ học sinh có mặt" };
  }

  await gate.sdb.classSession.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      ckAttendance: true,
      ckFeedback: true,
    },
  });
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
