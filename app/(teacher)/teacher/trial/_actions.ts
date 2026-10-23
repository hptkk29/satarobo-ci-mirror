// app/(teacher)/teacher/trial/_actions.ts — Site GV (L6): lưu phiếu đánh giá Trial.
//
// Rubric thang 10.0 (lib/trial/rubric.ts — đổi từ 8.0 ngày 27/08/2026). BẢO MẬT:
//   (1) checkPermission("trials:feedback") — TEACHER có sẵn.
//   (2) getTeacherTrialRubricContext trả null nếu KHÔNG phải HV trải nghiệm của GV
//       (guard own-teacher qua trialClass.teacherId/assistantId/session.teacherId).
// Tổng điểm + xếp loại TÍNH LẠI Ở SERVER (không tin client). Điểm mỗi tiêu chí phải
// ∈ mức hợp lệ của rubric. KHÔNG import @/lib/db trần (ESLint) → scopedDb pass-through
// (TrialRubricEval ∉ SCOPED_MODELS; đã guard own-teacher). ⚠️ Câu 46: không chạm PH.
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { publishEvent } from "@/lib/events/publish";
import { getTeacherTrialRubricContext } from "@/lib/lms/teacher-schedule";
import {
  RUBRIC_CRITERION_IDS,
  allowedPoints,
  computeTotal,
  rankOf,
} from "@/lib/trial/rubric";

const schema = z.object({
  enrollmentId: z.string().min(1),
  /** GĐ4 — buổi được chấm. Bỏ trống = buổi đang xếp cho ca (hành vi cũ).
   * Helper kiểm buổi thuộc đúng lớp của ca nên giá trị này KHÔNG được tin thẳng. */
  sessionId: z.string().min(1).optional(),
  scores: z.record(z.string(), z.number()),
  generalComment: z.string().trim().max(4000).optional().nullable(),
  orientation: z.string().trim().max(4000).optional().nullable(),
});

type SaveResult =
  | { ok: true; totalScore: number; rank: string }
  | { ok: false; error: string };

export async function saveTrialRubricAction(input: {
  enrollmentId: string;
  sessionId?: string;
  scores: Record<string, number>;
  generalComment?: string | null;
  orientation?: string | null;
}): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const { enrollmentId, sessionId, scores } = parsed.data;

  if (!(await checkPermission("trials:feedback"))) {
    return { ok: false, error: "Không có quyền nhập phiếu Trial" };
  }

  // Guard sở hữu + CHỐT buổi được chấm (null nếu không phải HV của GV, hoặc `sessionId`
  // không thuộc lớp của ca). Từ đây chỉ dùng `ctx.trialClassSessionId` — KHÔNG dùng
  // `sessionId` thô của client.
  const ctx = await getTeacherTrialRubricContext(
    session.user.id,
    enrollmentId,
    sessionId,
  );
  if (!ctx)
    return {
      ok: false,
      error: "Học viên trải nghiệm không thuộc bạn phụ trách",
    };

  // Chuẩn hoá + validate điểm: mỗi tiêu chí lấy đúng 1 mức hợp lệ (thiếu = 0).
  const clean: Record<string, number> = {};
  for (const id of RUBRIC_CRITERION_IDS) {
    const v = scores[id];
    if (v == null) {
      clean[id] = 0;
      continue;
    }
    if (!allowedPoints(id).includes(v)) {
      return { ok: false, error: `Điểm tiêu chí "${id}" không hợp lệ` };
    }
    clean[id] = v;
  }
  const totalScore = computeTotal(clean); // TÍNH LẠI ở server
  const rank = rankOf(totalScore).label;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const evaluatedByName = session.user.name ?? session.user.email ?? null;

  // GĐ4 — mỗi BUỔI một phiếu. Trước GĐ4 upsert khoá theo `trialEnrollmentId` nên chấm
  // buổi 2 GHI ĐÈ IM LẶNG phiếu buổi 1 và dời luôn con trỏ buổi; phần đã mất trước
  // ngày này không khôi phục được, đây chỉ chặn mất thêm.
  //
  // Ca chưa gắn buổi (`trialClassSessionId` null) thì KHÔNG cho lưu: khoá kép cho phép
  // nhiều NULL nên lưu vào đó là đẻ phiếu trùng không ai gỡ được.
  if (!ctx.trialClassSessionId) {
    return {
      ok: false,
      error: "Chưa chọn buổi để chấm — chọn buổi ở đầu phiếu rồi lưu lại",
    };
  }

  try {
    await sdb.trialRubricEval.upsert({
      where: {
        trialEnrollmentId_trialClassSessionId: {
          trialEnrollmentId: enrollmentId,
          trialClassSessionId: ctx.trialClassSessionId,
        },
      },
      create: {
        trialEnrollmentId: enrollmentId,
        trialClassSessionId: ctx.trialClassSessionId,
        scores: clean,
        totalScore,
        rank,
        generalComment: parsed.data.generalComment?.trim() || null,
        orientation: parsed.data.orientation?.trim() || null,
        evaluatedById: session.user.id,
        evaluatedByName,
      },
      update: {
        trialClassSessionId: ctx.trialClassSessionId,
        scores: clean,
        totalScore,
        rank,
        generalComment: parsed.data.generalComment?.trim() || null,
        orientation: parsed.data.orientation?.trim() || null,
        evaluatedById: session.user.id,
        evaluatedByName,
      },
    });
  } catch (err) {
    console.error("[saveTrialRubricAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được phiếu" };
  }

  // 03/09 — BÁO SALE. Trước bản này chấm xong là HẾT: không sự kiện, không thông báo.
  // Sale phải tự đi tìm phiếu, mà cửa hay dùng (`/sale/trial`) lại chỉ nhìn buổi tương
  // lai trong khi phiếu bao giờ cũng thuộc buổi đã qua ⇒ phiếu chấm xong không ai biết
  // đường lấy. Handler: `lib/_handlers/trial-eval-notif.ts`.
  //
  // NGOÀI transaction (hàm này vốn không có tx) và nuốt lỗi: phiếu ĐÃ lưu rồi, chuông
  // hỏng không được biến thành "không lưu được phiếu" trước mắt giáo viên.
  try {
    await publishEvent(
      "trial.evaluated",
      {
        trialEnrollmentId: enrollmentId,
        trialClassSessionId: ctx.trialClassSessionId,
        totalScore,
        rank,
      },
      {
        // Chấm LẠI cùng một buổi không đáng một tin nữa — Sale biết là có phiếu rồi.
        // Buổi thứ hai của cùng một ca thì có: khóa mang cả hai vế.
        dedupeKey: `trial.evaluated:${enrollmentId}:${ctx.trialClassSessionId}`,
      },
    );
  } catch (err) {
    console.error("[saveTrialRubricAction] publish trial.evaluated", err);
  }

  revalidatePath("/trial");
  revalidatePath("/teacher/trial");
  return { ok: true, totalScore, rank };
}
