// app/(teacher)/teacher/lich/_actions.ts — #06 (L6): thao tác trên buổi ở TRANG LỊCH DẠY.
//
// (A) completeSessionAction — nút "Hoàn tất buổi" (lifecycle v2, gate flag).
// (B) requestLessonChangeAction — "Đề xuất sửa giáo án" (LessonChangeRequest → Đào tạo duyệt).
//
// BẢO MẬT: mỗi action đầu hàm auth() → resolveActor → scopedDb(actorGiangDay(actor)) (cách ly cơ sở) →
// verify buổi THUỘC GV (chống IDOR) qua isSessionOwnedByTeacher. KHÔNG import @/lib/db trần
// (ESLint chặn app/(teacher)/**). ⚠️ Câu 46: KHÔNG đọc/gửi SĐT/email/contact PH.
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SessionStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  completeSession,
  type CompleteSessionResult,
} from "@/lib/lms/session-lifecycle";
import { isSessionOwnedByTeacher } from "@/lib/lms/session-ownership";
import { isSessionLifecycleV2Enabled } from "@/lib/flags";

type OwnedSession = {
  id: string;
  classId: string;
  centerId: string | null;
  status: SessionStatus;
  date: Date;
  lessonId: string | null;
  substituteTeacherId: string | null;
  actualTeacherId: string | null;
  class: { teacherId: string | null; name: string };
  // Buổi sinh từ kế hoạch (R7-06) có thể không set lessonId trực tiếp — bài giảng nằm ở plan.
  plan: { lessonId: string | null } | null;
};

type LoadResult =
  | {
      ok: true;
      session: OwnedSession;
      actor: Actor;
      userId: string;
      actorId: string | null;
      actorName: string;
    }
  | { ok: false; error: string };

/**
 * Nạp buổi + XÁC THỰC buổi thuộc GV đang đăng nhập. scopedDb.findUnique tự lọc IDOR
 * theo cơ sở (buổi ngoài cơ sở GV → null); rồi predicate ownership loại buổi lớp GV khác
 * trong CÙNG cơ sở. `centerId` được select vì passesScope đọc field này để lọc.
 */
async function loadOwnedSession(sessionId: string): Promise<LoadResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const userId = session.user.id;
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actorGiangDay(actor));

  const s = (await sdb.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      centerId: true,
      status: true,
      date: true,
      lessonId: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      class: { select: { teacherId: true, name: true } },
      plan: { select: { lessonId: true } },
    },
  })) as OwnedSession | null;

  // null = buổi không tồn tại HOẶC ngoài cơ sở GV (scopedDb ẩn) → không lộ khác biệt.
  if (!s) return { ok: false, error: "Buổi không thuộc bạn" };
  if (
    !isSessionOwnedByTeacher(s, {
      userId,
      assignedClassIds: actor.assignedClassIds,
    })
  ) {
    return { ok: false, error: "Buổi không thuộc bạn" };
  }

  const { actorId, actorName } = getAuditActor(session);
  return { ok: true, session: s, actor, userId, actorId, actorName };
}

// ─── (A) Hoàn tất buổi (lifecycle v2) ────────────────────────────────────────
const completeInputSchema = z.object({
  classComment: z
    .string()
    .trim()
    .max(2000, "Nhận xét tối đa 2000 ký tự")
    .optional(),
  confirmNoAttendance: z.boolean().optional(),
});

/**
 * GV chốt buổi mình dạy. Gate flag lifecycle v2 (OFF → chưa bật). Uỷ quyền toàn bộ
 * state-machine/tx/event cho completeSession (idempotent, thiếu điểm danh → needsConfirm).
 * Trả nguyên result để client xử lý needsConfirm (gọi lại confirmNoAttendance:true).
 */
export async function completeSessionAction(
  sessionId: string,
  input: { classComment?: string; confirmNoAttendance?: boolean },
): Promise<CompleteSessionResult> {
  if (!isSessionLifecycleV2Enabled()) {
    return { ok: false, error: "Tính năng chốt buổi chưa bật" };
  }

  const parsed = completeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  const loaded = await loadOwnedSession(sessionId);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const result = await completeSession({
    sessionId: loaded.session.id,
    actorId: loaded.actorId,
    actorName: loaded.actorName,
    actualTeacherId: loaded.userId, // GV đang đăng nhập là người thực dạy
    classComment: parsed.data.classComment ?? null,
    confirmNoAttendance: parsed.data.confirmNoAttendance ?? false,
    // DEFER — khớp nút chốt tay và đường tự đóng buổi. Màn này (sau cờ
    // SESSION_LIFECYCLE_V2, đang TẮT) không hỏi giáo viên về bài tập, nên để mặc định
    // "NOW" cũ là im lặng giao bài + gửi tin cho phụ huynh mà không ai chọn điều đó.
    assignMode: "DEFER",
    nguonChot: "TAY", // giáo viên bấm hoàn tất trên màn Lịch
    now: new Date(),
  });

  if (result.ok) {
    revalidatePath("/lich");
    revalidatePath("/teacher/lich");
  }
  return result;
}

// ─── (B) Đề xuất sửa giáo án ──────────────────────────────────────────────────
const lessonChangeSchema = z.object({
  content: z
    .string()
    .trim()
    .min(5, "Nội dung tối thiểu 5 ký tự")
    .max(2000, "Nội dung tối đa 2000 ký tự"),
});

/**
 * GV gửi đề xuất chỉnh bài giảng của buổi → tạo LessonChangeRequest OPEN. Route DUYỆT
 * đã có sẵn phía Đào tạo (admin) — action này chỉ tạo request. LessonChangeRequest không
 * có centerId (∉ SCOPED_MODELS) nhưng đã verify ownership qua buổi ở loadOwnedSession.
 */
export async function requestLessonChangeAction(
  sessionId: string,
  content: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = lessonChangeSchema.safeParse({ content });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  const loaded = await loadOwnedSession(sessionId);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  // Fallback plan.lessonId — cùng pattern lib/lms/assignment.ts (buổi sinh từ kế hoạch).
  const lessonId =
    loaded.session.lessonId ?? loaded.session.plan?.lessonId ?? null;
  if (lessonId == null) return { ok: false, error: "Buổi chưa gắn bài giảng" };

  // create KHÔNG bị scopedDb chặn (extension chỉ can thiệp read) — dùng sdb để tuân
  // quy ước "app/** đi qua scopedDb", không import db trần.
  const sdb = scopedDb(actorGiangDay(loaded.actor));
  const created = await sdb.lessonChangeRequest.create({
    data: {
      lessonId,
      requestedById: loaded.userId,
      content: parsed.data.content,
      status: "OPEN",
    },
    select: { id: true },
  });

  await writeAudit({
    actor: { id: loaded.actorId, name: loaded.actorName },
    module: "curriculum",
    entityType: "LessonChangeRequest",
    entityId: created.id,
    action: "CREATE",
    newValues: { lessonId, content: parsed.data.content },
  });

  revalidatePath("/lich");
  revalidatePath("/teacher/lich");
  return { ok: true };
}
