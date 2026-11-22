"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { questionSchema, type QuestionInput } from "@/lib/validators/question";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

// Nhóm 01 L1 — Question/Choice/Curriculum = ngân hàng câu hỏi + giáo trình toàn
// cục (không center-scope), scopedDb pass-through; ownership theo authorId giữ nguyên.
async function requireRole(): Promise<
  | { ok: true; userId: string; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("questions:author"))) {
    return { ok: false, error: "Không có quyền quản lý câu hỏi" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, userId: session.user.id ?? "", sdb: scopedDb(actor) };
}

// LMS-4 / W1-4 — GV chỉ sửa/xóa câu hỏi của chính mình; người có
// `training:manage` (SUPER_ADMIN / CENTER_MANAGER) thì sửa/xóa được mọi câu.
// Lưu ý: Question.authorId trỏ tới Employee.id, nên so với employeeId của actor.
async function assertAuthorOrManager(
  sdb: Sdb,
  questionAuthorId: string | null,
  userId: string,
): Promise<Result> {
  if (await checkPermission("training:manage")) return { ok: true };
  const myEmployeeId = await resolveAuthorEmployeeId(sdb, userId);
  if (questionAuthorId && myEmployeeId && questionAuthorId === myEmployeeId) {
    return { ok: true };
  }
  return { ok: false, error: "Chỉ tác giả mới sửa/xóa câu hỏi này" };
}

async function resolveAuthorEmployeeId(sdb: Sdb, userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const user = await sdb.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    return user?.employeeId ?? null;
  } catch {
    return null;
  }
}

/**
 * LMS-4 — chỉ tác giả (authorId == employee của tôi) hoặc người có `training:manage`
 * (SUPER_ADMIN/CENTER_MANAGER) mới sửa/xoá được câu hỏi.
 */
async function assertCanMutateQuestion(
  sdb: Sdb,
  userId: string,
  questionId: string,
): Promise<Result> {
  if (await checkPermission("training:manage")) return { ok: true };
  const q = await sdb.question.findUnique({
    where: { id: questionId },
    select: { authorId: true },
  });
  if (!q) return { ok: false, error: "Câu hỏi không tồn tại" };
  const myEmp = await resolveAuthorEmployeeId(sdb, userId);
  if (q.authorId && myEmp && q.authorId === myEmp) return { ok: true };
  return {
    ok: false,
    error: "Chỉ tác giả hoặc quản lý đào tạo mới sửa/xoá được câu hỏi này",
  };
}

// Normalize choices so the order numbers are dense (1..N) regardless of UI gaps.
function normalizeChoices(input: QuestionInput["choices"]) {
  return input.map((c, i) => ({
    order: i + 1,
    text: c.text,
    isCorrect: c.isCorrect,
    imageUrl: c.imageUrl,
  }));
}

// FL1-03 — courseId là field suy ra: ưu tiên khung CT đã chọn (authoritative).
// Tránh lệch khi FE gửi courseId không khớp curriculum.
async function resolveCourseId(
  sdb: Sdb,
  curriculumId: string | null,
  fallbackCourseId: string | null,
): Promise<string | null> {
  if (!curriculumId) return fallbackCourseId;
  const cur = await sdb.curriculum.findUnique({
    where: { id: curriculumId },
    select: { courseId: true },
  });
  return cur?.courseId ?? fallbackCourseId;
}

export async function createQuestion(
  input: QuestionInput,
): Promise<Result<{ questionId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  if (data.questionCode) {
    const dup = await gate.sdb.question.findUnique({
      where: { questionCode: data.questionCode },
      select: { id: true },
    });
    if (dup) return { ok: false, error: `Mã câu hỏi "${data.questionCode}" đã tồn tại` };
  }

  const authorEmployeeId = await resolveAuthorEmployeeId(gate.sdb, gate.userId);
  const courseId = await resolveCourseId(gate.sdb, data.curriculumId, data.courseId);
  const choices =
    data.type === "MULTIPLE_CHOICE" || data.type === "TRUE_FALSE"
      ? normalizeChoices(data.choices)
      : [];

  try {
    const q = await gate.sdb.$transaction(async (tx) => {
      const created = await tx.question.create({
        data: {
          questionCode: data.questionCode,
          type: data.type,
          text: data.text,
          explanation: data.explanation,
          imageUrl: data.imageUrl,
          difficulty: data.difficulty,
          tags: data.tags,
          curriculumId: data.curriculumId,
          courseId,
          points: data.points,
          timeLimitSec: data.timeLimitSec,
          lessonId: data.lessonId,
          correctAnswer:
            data.type === "MULTIPLE_CHOICE" || data.type === "TRUE_FALSE"
              ? null
              : data.correctAnswer,
          isPublic: data.isPublic,
          notes: data.notes,
          authorId: authorEmployeeId,
        },
        select: { id: true },
      });

      if (choices.length > 0) {
        await tx.choice.createMany({
          data: choices.map((c) => ({ questionId: created.id, ...c })),
        });
      }

      return created;
    });

    revalidatePath("/questions");
    return { ok: true, data: { questionId: q.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createQuestionAndRedirect(input: QuestionInput) {
  const res = await createQuestion(input);
  if (!res.ok) return res;
  redirect(`/questions/${res.data!.questionId}/edit`);
}

export async function updateQuestion(
  id: string,
  input: QuestionInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;
  const own = await assertCanMutateQuestion(gate.sdb, gate.userId, id);
  if (!own.ok) return own;

  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.question.findUnique({
    where: { id },
    select: { questionCode: true, authorId: true },
  });
  if (!current) return { ok: false, error: "Câu hỏi không tồn tại" };

  const authz = await assertAuthorOrManager(gate.sdb, current.authorId, gate.userId);
  if (!authz.ok) return authz;

  if (data.questionCode && data.questionCode !== current.questionCode) {
    const dup = await gate.sdb.question.findUnique({
      where: { questionCode: data.questionCode },
      select: { id: true },
    });
    if (dup && dup.id !== id) {
      return { ok: false, error: `Mã câu hỏi "${data.questionCode}" đã tồn tại` };
    }
  }

  const courseId = await resolveCourseId(gate.sdb, data.curriculumId, data.courseId);
  const choices =
    data.type === "MULTIPLE_CHOICE" || data.type === "TRUE_FALSE"
      ? normalizeChoices(data.choices)
      : [];

  try {
    await gate.sdb.$transaction(async (tx) => {
      // Replace choices: delete-then-recreate is simpler than diffing.
      await tx.choice.deleteMany({ where: { questionId: id } });
      await tx.question.update({
        where: { id },
        data: {
          questionCode: data.questionCode,
          type: data.type,
          text: data.text,
          explanation: data.explanation,
          imageUrl: data.imageUrl,
          difficulty: data.difficulty,
          tags: data.tags,
          curriculumId: data.curriculumId,
          courseId,
          points: data.points,
          timeLimitSec: data.timeLimitSec,
          lessonId: data.lessonId,
          correctAnswer:
            data.type === "MULTIPLE_CHOICE" || data.type === "TRUE_FALSE"
              ? null
              : data.correctAnswer,
          isPublic: data.isPublic,
          notes: data.notes,
        },
      });
      if (choices.length > 0) {
        await tx.choice.createMany({
          data: choices.map((c) => ({ questionId: id, ...c })),
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/questions");
  revalidatePath(`/questions/${id}/edit`);
  return { ok: true };
}

export async function deleteQuestion(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;
  const own = await assertCanMutateQuestion(gate.sdb, gate.userId, id);
  if (!own.ok) return own;

  const current = await gate.sdb.question.findUnique({
    where: { id },
    select: { authorId: true },
  });
  if (!current) return { ok: false, error: "Câu hỏi không tồn tại" };

  const authz = await assertAuthorOrManager(gate.sdb, current.authorId, gate.userId);
  if (!authz.ok) return authz;

  try {
    await gate.sdb.question.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/questions");
  return { ok: true };
}

export async function deleteQuestionAndRedirect(id: string): Promise<Result> {
  const res = await deleteQuestion(id);
  if (!res.ok) return res;
  redirect("/questions");
}
