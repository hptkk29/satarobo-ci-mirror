"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { LessonChangeStatus, LessonStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  archiveLesson,
  isLessonLocked,
  planResize,
  resizeCurriculum,
  setLessonStatus,
  unarchiveLesson,
  type ResizePlan,
} from "@/lib/lms/curriculum";
import {
  curriculumSchema,
  lessonSchema,
  type CurriculumInput,
  type LessonInput,
} from "@/lib/validators/curriculum";
import { planLessonMerge, pickLessonContent } from "@/lib/lms/curriculum-merge";
import { kiemPhuThuocHocBu } from "@/lib/hoc-bu/phu-thuoc";
import { chiaHocPhanTheoSo, tomTatHocPhan, TRAN_SO_HOC_PHAN } from "@/lib/lms/chia-hoc-phan";


type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// Nhóm 01 L1 — Curriculum/Lesson/LessonChangeRequest = giáo trình dùng chung toàn hệ
// thống (câu 74a) → scopedDb pass-through. Assignment (gắn/gỡ buổi) đi qua Class
// (scoped) → check tay class.centerId ∈ visibleCenterIds (Loại B), HO/SUPER bypass.
type GateOk = {
  ok: true;
  session: Session;
  actor: Actor;
  sdb: ReturnType<typeof scopedDb>;
};
type Gate = GateOk | { ok: false; error: string };

// Gate sửa giáo trình (curriculum:edit) — trả luôn session để ghi audit.
async function requireRole(): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("curriculum:edit"))) {
    return { ok: false, error: "Không có quyền quản lý giáo trình" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, session, actor, sdb: scopedDb(actor) };
}

// Gate Đào tạo (training:manage = SUPER_ADMIN/TRAINING) — dùng cho UNLOCK buổi
// LOCKED. ⚠️ GIỮ NGUYÊN cho nhánh mở khóa (KHÔNG đổi sang lesson-change:approve).
async function requireTraining(): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("training:manage"))) {
    return { ok: false, error: "Chỉ Đào tạo (quản lý cơ sở) mới có quyền này" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, session, actor, sdb: scopedDb(actor) };
}

// FL W0-NAV-2 (QĐ-T3b) — Gate DUYỆT đề xuất chỉnh bài (lesson-change:approve =
// SUPER_ADMIN/TRAINING/CENTER_MANAGER). TÁCH khỏi training:manage để CM duyệt
// được đề xuất nhưng KHÔNG mở khóa buổi/sửa giáo trình.
async function requireLessonChangeApprove(): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("lesson-change:approve"))) {
    return { ok: false, error: "Không có quyền duyệt đề xuất chỉnh bài" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, session, actor, sdb: scopedDb(actor) };
}

// ──────────────────────────────────────────────────────────────────────────
// Curriculum CRUD
// ──────────────────────────────────────────────────────────────────────────

/**
 * T5.2 — version ẩn: bản kế tiếp của khoá = max(version)+1 (khoá chưa có bản → 1).
 * Giữ @@unique([courseId, version]) nên vẫn phải sinh giá trị, chỉ là người dùng
 * không nhập nữa.
 */
async function nextCurriculumVersion(
  sdb: ReturnType<typeof scopedDb>,
  courseId: string,
): Promise<number> {
  const last = await sdb.curriculum.findFirst({
    where: { courseId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

export async function createCurriculum(
  input: CurriculumInput,
): Promise<Result<{ curriculumId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = curriculumSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // T5.2 — form không gửi version → tự tăng. (Client cũ còn gửi thì vẫn tôn trọng,
  // nhưng đụng bản đã có sẽ tự đẩy lên bản kế tiếp thay vì báo lỗi "v1 đã tồn tại".)
  let version = data.version ?? (await nextCurriculumVersion(gate.sdb, data.courseId));
  const dup = await gate.sdb.curriculum.findUnique({
    where: { courseId_version: { courseId: data.courseId, version } },
    select: { id: true },
  });
  if (dup) version = await nextCurriculumVersion(gate.sdb, data.courseId);

  try {
    const c = await gate.sdb.curriculum.create({
      data: { ...data, version },
      select: { id: true },
    });
    revalidatePath("/curriculums");
    return { ok: true, data: { curriculumId: c.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createCurriculumAndRedirect(input: CurriculumInput) {
  const res = await createCurriculum(input);
  if (!res.ok) return res;
  redirect(`/curriculums/${res.data!.curriculumId}/edit`);
}

export async function updateCurriculum(
  id: string,
  input: CurriculumInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = curriculumSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.curriculum.findUnique({
    where: { id },
    select: { courseId: true, version: true },
  });
  if (!current) return { ok: false, error: "Giáo trình không tồn tại" };

  // T5.2 — form không gửi version → GIỮ NGUYÊN bản hiện tại. Chỉ khi đổi sang khoá
  // khác mà bản đó đã có version trùng thì tự đẩy lên bản kế tiếp (không báo lỗi).
  let version = data.version ?? current.version;
  if (current.courseId !== data.courseId || current.version !== version) {
    const dup = await gate.sdb.curriculum.findUnique({
      where: { courseId_version: { courseId: data.courseId, version } },
      select: { id: true },
    });
    if (dup && dup.id !== id) {
      version = await nextCurriculumVersion(gate.sdb, data.courseId);
    }
  }

  try {
    await gate.sdb.curriculum.update({ where: { id }, data: { ...data, version } });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/curriculums");
  revalidatePath(`/curriculums/${id}/edit`);
  return { ok: true };
}

export async function deleteCurriculum(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const count = await gate.sdb.lesson.count({ where: { curriculumId: id } });
  if (count > 0) {
    return {
      ok: false,
      error: `Giáo trình có ${count} bài học. Hãy xoá tất cả bài trước.`,
    };
  }

  try {
    await gate.sdb.curriculum.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/curriculums");
  return { ok: true };
}

export async function deleteCurriculumAndRedirect(id: string): Promise<Result> {
  const res = await deleteCurriculum(id);
  if (!res.ok) return res;
  redirect("/curriculums");
}

// ──────────────────────────────────────────────────────────────────────────
// Lesson CRUD
// ──────────────────────────────────────────────────────────────────────────

export async function createLesson(input: LessonInput): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = lessonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const curriculum = await gate.sdb.curriculum.findUnique({
    where: { id: data.curriculumId },
    select: { id: true },
  });
  if (!curriculum) return { ok: false, error: "Giáo trình không tồn tại" };

  const dup = await gate.sdb.lesson.findUnique({
    where: {
      curriculumId_order: { curriculumId: data.curriculumId, order: data.order },
    },
    select: { id: true },
  });
  if (dup) return { ok: false, error: `Bài ${data.order} đã tồn tại` };

  try {
    await gate.sdb.lesson.create({ data });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/curriculums/${data.curriculumId}/edit`);
  return { ok: true };
}

export async function updateLesson(
  id: string,
  input: LessonInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = lessonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.lesson.findUnique({
    where: { id },
    select: { curriculumId: true, order: true, status: true, archivedAt: true },
  });
  if (!current) return { ok: false, error: "Bài học không tồn tại" };

  // R7-10 — buổi LOCKED chặn sửa nội dung (T4); buổi đã archive là đọc-only.
  if (isLessonLocked(current.status)) {
    return { ok: false, error: "Buổi đang KHÓA — yêu cầu Đào tạo mở khóa trước khi sửa" };
  }
  if (current.archivedAt) {
    return { ok: false, error: "Buổi đã lưu trữ (đọc-only) — khôi phục trước khi sửa" };
  }

  if (current.order !== data.order) {
    const dup = await gate.sdb.lesson.findUnique({
      where: {
        curriculumId_order: {
          curriculumId: data.curriculumId,
          order: data.order,
        },
      },
      select: { id: true },
    });
    if (dup && dup.id !== id) {
      return { ok: false, error: `Bài ${data.order} đã tồn tại` };
    }
  }

  try {
    await gate.sdb.lesson.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/curriculums/${data.curriculumId}/edit`);
  return { ok: true };
}

export async function deleteLesson(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const lesson = await gate.sdb.lesson.findUnique({
    where: { id },
    select: { curriculumId: true },
  });
  if (!lesson) return { ok: false, error: "Bài học không tồn tại" };

  // T14: bài mà học bù còn trỏ tới (bài vắng của dòng cần bù, bộ bài của case) KHÔNG xoá cứng — giữ bài, ngừng dùng.
  const chan = await kiemPhuThuocHocBu("BAI", [id]);
  if (chan) return { ok: false, error: chan };

  try {
    await gate.sdb.lesson.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/curriculums/${lesson.curriculumId}/edit`);
  return { ok: true };
}

// Reorder via 2-pass to avoid violating the unique (curriculumId, order)
// constraint mid-transaction.
export async function reorderLessons({
  curriculumId,
  lessonIds,
}: {
  curriculumId: string;
  lessonIds: string[];
}): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
    return { ok: false, error: "Danh sách bài học rỗng" };
  }

  // Verify all lessons belong to the curriculum to avoid foreign-curriculum tampering.
  const found = await gate.sdb.lesson.findMany({
    where: { id: { in: lessonIds }, curriculumId },
    select: { id: true },
  });
  if (found.length !== lessonIds.length) {
    return { ok: false, error: "Có bài học không thuộc giáo trình này" };
  }

  try {
    await gate.sdb.$transaction(async (tx) => {
      for (let i = 0; i < lessonIds.length; i++) {
        await tx.lesson.update({
          where: { id: lessonIds[i] },
          data: { order: -(i + 1) },
        });
      }
      for (let i = 0; i < lessonIds.length; i++) {
        await tx.lesson.update({
          where: { id: lessonIds[i] },
          data: { order: i + 1 },
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Reorder thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/curriculums/${curriculumId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// R7-10 — Resize N buổi (AC1/AC2/C5)
// ──────────────────────────────────────────────────────────────────────────

/** Xem trước kế hoạch resize (cho modal liệt kê buổi sẽ loại). Read-only. */
export async function previewResizeCurriculum(
  curriculumId: string,
  targetN: number,
): Promise<Result<ResizePlan>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;
  const plan = await planResize(curriculumId, targetN);
  return { ok: true, data: plan };
}

/**
 * Áp dụng resize. Tăng → append; giảm → soft-archive (cần confirm nếu có link,
 * chặn nếu IN_USE). expectedVersions để optimistic-lock (2 resize song song).
 */
export async function applyResizeCurriculum(input: {
  curriculumId: string;
  targetN: number;
  confirm?: boolean;
  expectedVersions?: Record<string, number>;
}): Promise<Result<{ created: number; archived: number }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const res = await resizeCurriculum({
    curriculumId: input.curriculumId,
    targetN: input.targetN,
    confirm: input.confirm,
    expectedVersions: input.expectedVersions,
  });
  if (!res.ok) return { ok: false, error: res.message };

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Curriculum",
    entityId: input.curriculumId,
    action: "RESIZE",
    newValues: {
      target: res.plan.target,
      previous: res.plan.current,
      created: res.created,
      archived: res.archived,
    },
  });

  revalidatePath(`/curriculums/${input.curriculumId}/edit`);
  return { ok: true, data: { created: res.created, archived: res.archived } };
}

// ──────────────────────────────────────────────────────────────────────────
// 08/08/2026 — GỘP BÀI TỪ GIÁO TRÌNH KHÁC
//
// Khoá Combo theo định nghĩa là khoá gộp (Sata 1 buổi 1–16 + Sata 2 buổi 17–32).
// Gõ tay 32 bài vừa lâu vừa lệch dần mỗi lần giáo trình gốc đổi.
//
// ⚠️ GHI ĐÈ TẠI CHỖ, giữ nguyên `Lesson.id`: lớp Combo đang chạy có
// `ClassSession.lessonId` / `ClassSessionPlan.lessonId` trỏ vào chính các bài này.
// Xoá-rồi-tạo-lại sẽ để lại con trỏ mồ côi ở học bạ / tiến độ / bài tập theo buổi.
// ──────────────────────────────────────────────────────────────────────────

/** Giáo trình chọn được làm NGUỒN (mọi giáo trình khác, kèm số bài còn hiệu lực). */
export async function listMergeSources(
  targetCurriculumId: string,
): Promise<Result<{ id: string; label: string; lessonCount: number }[]>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const rows = await gate.sdb.curriculum.findMany({
    where: { id: { not: targetCurriculumId } },
    orderBy: [{ course: { name: "asc" } }, { version: "desc" }],
    select: {
      id: true,
      name: true,
      version: true,
      course: { select: { name: true } },
      _count: { select: { lessons: { where: { archivedAt: null } } } },
    },
  });

  return {
    ok: true,
    data: rows.map((c) => ({
      id: c.id,
      label: `${c.course.name} — ${c.name} (v${c.version})`,
      lessonCount: c._count.lessons,
    })),
  };
}

const LESSON_CONTENT_SELECT = {
  id: true,
  order: true,
  title: true,
  description: true,
  content: true,
  duration: true,
  objectives: true,
  materials: true,
  notes: true,
  teacherGuide: true,
  expectedOutput: true,
  homeworkDefault: true,
  assessmentCriteria: true,
} as const;

/** Nạp nguồn + đích rồi dựng phương án. Dùng chung cho xem trước và áp dụng. */
async function buildMergePlan(
  sdb: ReturnType<typeof scopedDb>,
  input: { targetCurriculumId: string; sourceCurriculumId: string; startOrder: number },
) {
  if (input.sourceCurriculumId === input.targetCurriculumId) {
    return { ok: false as const, error: "Không thể gộp giáo trình vào chính nó" };
  }

  const [target, sources, targets] = await Promise.all([
    sdb.curriculum.findUnique({
      where: { id: input.targetCurriculumId },
      select: { id: true, name: true },
    }),
    sdb.lesson.findMany({
      where: { curriculumId: input.sourceCurriculumId, archivedAt: null },
      orderBy: { order: "asc" },
      select: LESSON_CONTENT_SELECT,
    }),
    sdb.lesson.findMany({
      where: { curriculumId: input.targetCurriculumId },
      orderBy: { order: "asc" },
      select: {
        id: true,
        order: true,
        title: true,
        status: true,
        archivedAt: true,
        _count: {
          select: { scormPackages: true, assignments: true, exams: true, documents: true },
        },
      },
    }),
  ]);
  if (!target) return { ok: false as const, error: "Giáo trình đích không tồn tại" };

  const plan = planLessonMerge({
    sources,
    targets: targets.map((t) => ({
      id: t.id,
      order: t.order,
      title: t.title,
      status: t.status as string,
      archivedAt: t.archivedAt,
      attachmentCount:
        t._count.scormPackages + t._count.assignments + t._count.exams + t._count.documents,
    })),
    startOrder: input.startOrder,
  });
  return { ok: true as const, plan, sources };
}

export interface MergePreviewRow {
  targetOrder: number;
  currentTitle: string;
  sourceTitle: string;
  action: "overwrite" | "create";
  note: string | null;
}

/** Xem trước gộp — THUẦN ĐỌC, không ghi gì. */
export async function previewMergeLessons(input: {
  targetCurriculumId: string;
  sourceCurriculumId: string;
  startOrder: number;
}): Promise<
  Result<{
    rows: MergePreviewRow[];
    errors: string[];
    warnings: string[];
    overwriteCount: number;
    createCount: number;
  }>
> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const built = await buildMergePlan(gate.sdb, input);
  if (!built.ok) return built;

  return {
    ok: true,
    data: {
      rows: built.plan.items.map((it) => ({
        targetOrder: it.targetOrder,
        currentTitle: it.currentTitle,
        sourceTitle: it.sourceTitle,
        action: it.action,
        note: it.blockedReason ?? it.warning,
      })),
      errors: built.plan.errors,
      warnings: built.plan.warnings,
      overwriteCount: built.plan.overwriteCount,
      createCount: built.plan.createCount,
    },
  };
}

/**
 * Áp dụng gộp: ghi đè NỘI DUNG bài đích tại chỗ (giữ `id`), tạo bài mới nếu vượt
 * quá số buổi hiện có. KHÔNG đụng trạng thái/khoá/lưu trữ và KHÔNG chép học liệu
 * (SCORM / bài tập / đề thi / tài liệu) — chúng là thực thể riêng gắn theo buổi.
 */
export async function applyMergeLessons(input: {
  targetCurriculumId: string;
  sourceCurriculumId: string;
  startOrder: number;
}): Promise<Result<{ overwritten: number; created: number }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const built = await buildMergePlan(gate.sdb, input);
  if (!built.ok) return built;
  if (built.plan.errors.length > 0) {
    return { ok: false, error: built.plan.errors.join(" ") };
  }
  if (built.plan.items.length === 0) {
    return { ok: false, error: "Không có bài nào để gộp" };
  }

  const byId = new Map(built.sources.map((s) => [s.id, s]));

  try {
    await gate.sdb.$transaction(async (tx) => {
      for (const it of built.plan.items) {
        const src = byId.get(it.sourceLessonId);
        if (!src) continue;
        const data = pickLessonContent(src);
        if (it.targetId) {
          await tx.lesson.update({
            where: { id: it.targetId },
            data: { ...data, version: { increment: 1 } },
          });
        } else {
          await tx.lesson.create({
            data: {
              ...data,
              curriculumId: input.targetCurriculumId,
              order: it.targetOrder,
            },
          });
        }
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Gộp thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Curriculum",
    entityId: input.targetCurriculumId,
    action: "MERGE_LESSONS",
    newValues: {
      sourceCurriculumId: input.sourceCurriculumId,
      startOrder: input.startOrder,
      overwritten: built.plan.overwriteCount,
      created: built.plan.createCount,
      titles: built.plan.items.map((it) => `${it.targetOrder}. ${it.sourceTitle}`),
    },
    reason: `Gộp ${built.plan.items.length} bài từ giáo trình khác vào buổi ${input.startOrder}+`,
  });

  revalidatePath(`/curriculums/${input.targetCurriculumId}/edit`);
  revalidatePath("/curriculums");
  return {
    ok: true,
    data: { overwritten: built.plan.overwriteCount, created: built.plan.createCount },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// R7-10 — Trạng thái buổi + khóa/mở khóa (AC3)
// ──────────────────────────────────────────────────────────────────────────

export async function setLessonStatusAction(input: {
  lessonId: string;
  status: LessonStatus;
}): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const sdb = scopedDb(await resolveActor(session.user.id));

  const current = await sdb.lesson.findUnique({
    where: { id: input.lessonId },
    select: { curriculumId: true, status: true },
  });
  if (!current) return { ok: false, error: "Bài học không tồn tại" };

  // Rời trạng thái LOCKED (mở khóa) chỉ Đào tạo. Các chuyển trạng thái khác:
  // curriculum:edit là đủ. Đặt LOCKED cũng cho curriculum:edit.
  const unlocking = isLessonLocked(current.status) && input.status !== "LOCKED";
  const gate = unlocking ? await requireTraining() : await requireRole();
  if (!gate.ok) return gate;

  const { actorId, actorName } = getAuditActor(gate.session);
  await setLessonStatus({ lessonId: input.lessonId, status: input.status, actorId });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Lesson",
    entityId: input.lessonId,
    action: unlocking ? "UNLOCK" : "STATUS_CHANGE",
    oldValues: { status: current.status },
    newValues: { status: input.status },
  });

  revalidatePath(`/curriculums/${current.curriculumId}/edit`);
  return { ok: true };
}

export async function archiveLessonAction(lessonId: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const current = await gate.sdb.lesson.findUnique({
    where: { id: lessonId },
    select: { curriculumId: true, status: true },
  });
  if (!current) return { ok: false, error: "Bài học không tồn tại" };

  const res = await archiveLesson({ lessonId });
  if (!res.ok) return { ok: false, error: res.message };

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Lesson",
    entityId: lessonId,
    action: "ARCHIVE",
  });

  revalidatePath(`/curriculums/${current.curriculumId}/edit`);
  return { ok: true };
}

export async function unarchiveLessonAction(lessonId: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const current = await gate.sdb.lesson.findUnique({
    where: { id: lessonId },
    select: { curriculumId: true },
  });
  if (!current) return { ok: false, error: "Bài học không tồn tại" };

  const res = await unarchiveLesson({ lessonId });
  if (!res.ok) return { ok: false, error: res.message };

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Lesson",
    entityId: lessonId,
    action: "UNARCHIVE",
  });

  revalidatePath(`/curriculums/${current.curriculumId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// R7-10 — LessonChangeRequest: GV gửi đề xuất → Đào tạo xử lý (AC4)
// ──────────────────────────────────────────────────────────────────────────

/** GV gửi đề xuất chỉnh sửa buổi (gate questions:author). */
export async function submitLessonChangeRequest(input: {
  lessonId: string;
  content: string;
}): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("questions:author"))) {
    return { ok: false, error: "Không có quyền gửi đề xuất" };
  }

  const content = input.content.trim();
  if (content.length < 5) {
    return { ok: false, error: "Nội dung đề xuất quá ngắn (≥ 5 ký tự)" };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const lesson = await sdb.lesson.findUnique({
    where: { id: input.lessonId },
    select: { id: true, curriculumId: true },
  });
  if (!lesson) return { ok: false, error: "Bài học không tồn tại" };

  const cr = await sdb.lessonChangeRequest.create({
    data: { lessonId: input.lessonId, requestedById: session.user.id, content },
    select: { id: true },
  });

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "LessonChangeRequest",
    entityId: cr.id,
    action: "CREATE",
    newValues: { lessonId: input.lessonId, content },
  });

  revalidatePath(`/curriculums/${lesson.curriculumId}/edit`);
  return { ok: true };
}

/**
 * Duyệt đề xuất: ACCEPTED/REJECTED + phản hồi.
 * FL W0-NAV-2 (QĐ-T3b) — gate đổi training:manage → lesson-change:approve
 * (SUPER_ADMIN/TRAINING/CENTER_MANAGER). Unlock buổi vẫn dùng training:manage.
 */
export async function handleLessonChangeRequest(input: {
  requestId: string;
  decision: Extract<LessonChangeStatus, "ACCEPTED" | "REJECTED">;
  response?: string;
}): Promise<Result> {
  const gate = await requireLessonChangeApprove();
  if (!gate.ok) return gate;

  if (input.decision !== "ACCEPTED" && input.decision !== "REJECTED") {
    return { ok: false, error: "Quyết định không hợp lệ" };
  }

  const cr = await gate.sdb.lessonChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, lesson: { select: { curriculumId: true } } },
  });
  if (!cr) return { ok: false, error: "Đề xuất không tồn tại" };
  if (cr.status !== "OPEN") {
    return { ok: false, error: "Đề xuất đã được xử lý" };
  }

  const { actorId, actorName } = getAuditActor(gate.session);
  await gate.sdb.lessonChangeRequest.update({
    where: { id: input.requestId },
    data: {
      status: input.decision,
      response: input.response?.trim() || null,
      handledById: actorId,
    },
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "LessonChangeRequest",
    entityId: input.requestId,
    action: input.decision,
    newValues: { response: input.response?.trim() || null },
  });

  revalidatePath(`/curriculums/${cr.lesson.curriculumId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// FL1-02 (US-LMS-1 AC2) — Gắn/gỡ Assignment SẴN CÓ vào buổi qua Assignment.lessonId
//   (KHÔNG xây AssignmentTemplate — đó là lane LMS-E). Chỉ liên kết bài tập đã
//   tồn tại; SCORM gắn-buổi tái dùng activateForLesson ở /admin/scorm.
// ──────────────────────────────────────────────────────────────────────────

/** Gắn 1 bài tập (đã có) vào buổi. Gate curriculum:edit. */
export async function attachAssignmentToLesson(input: {
  lessonId: string;
  assignmentId: string;
}): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const { lessonId, assignmentId } = input;
  if (!lessonId || !assignmentId) return { ok: false, error: "Thiếu tham số" };

  const lesson = await gate.sdb.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, curriculumId: true, curriculum: { select: { courseId: true } } },
  });
  if (!lesson) return { ok: false, error: "Bài học không tồn tại" };

  const assignment = await gate.sdb.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      lessonId: true,
      class: { select: { courseId: true, centerId: true } },
    },
  });
  if (!assignment) return { ok: false, error: "Bài tập không tồn tại" };
  // Loại B — Assignment không auto-scope; cách ly tay qua class.centerId
  // (HO/SUPER bypass). Chống IDOR gắn bài tập của lớp cơ sở khác.
  const isGlobal = gate.actor.isSuperAdmin || gate.actor.isHoLevel;
  if (
    !isGlobal &&
    (assignment.class.centerId == null ||
      !gate.actor.visibleCenterIds.includes(assignment.class.centerId))
  ) {
    return { ok: false, error: "Bài tập không tồn tại" };
  }
  if (assignment.lessonId && assignment.lessonId !== lessonId) {
    return { ok: false, error: "Bài tập đang gắn buổi khác — gỡ trước khi gắn lại" };
  }
  // Chỉ cho gắn bài tập cùng khoá học với giáo trình (tránh gắn nhầm chéo khoá).
  if (assignment.class.courseId !== lesson.curriculum.courseId) {
    return { ok: false, error: "Bài tập thuộc khoá học khác với giáo trình này" };
  }

  try {
    await gate.sdb.assignment.update({ where: { id: assignmentId }, data: { lessonId } });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Assignment",
    entityId: assignmentId,
    action: "UPDATE",
    newValues: { lessonId },
  });

  revalidatePath(`/curriculums/${lesson.curriculumId}/edit`);
  return { ok: true };
}

/** Gỡ bài tập khỏi buổi (Assignment.lessonId = null). Gate curriculum:edit. */
export async function detachAssignmentFromLesson(input: {
  assignmentId: string;
}): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  if (!input.assignmentId) return { ok: false, error: "Thiếu tham số" };

  const assignment = await gate.sdb.assignment.findUnique({
    where: { id: input.assignmentId },
    select: {
      id: true,
      lessonId: true,
      lesson: { select: { curriculumId: true } },
      class: { select: { centerId: true } },
    },
  });
  if (!assignment) return { ok: false, error: "Bài tập không tồn tại" };
  // Loại B — Assignment không auto-scope; cách ly tay qua class.centerId (HO/SUPER bypass).
  const isGlobal = gate.actor.isSuperAdmin || gate.actor.isHoLevel;
  if (
    !isGlobal &&
    (assignment.class.centerId == null ||
      !gate.actor.visibleCenterIds.includes(assignment.class.centerId))
  ) {
    return { ok: false, error: "Bài tập không tồn tại" };
  }
  if (!assignment.lessonId) return { ok: true }; // đã rời buổi — không làm gì.

  try {
    await gate.sdb.assignment.update({
      where: { id: input.assignmentId },
      data: { lessonId: null },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "curriculum",
    entityType: "Assignment",
    entityId: input.assignmentId,
    action: "UPDATE",
    oldValues: { lessonId: assignment.lessonId },
    newValues: { lessonId: null },
  });

  const curriculumId = assignment.lesson?.curriculumId;
  if (curriculumId) revalidatePath(`/curriculums/${curriculumId}/edit`);
  return { ok: true };
}

// ─── Học phần (29/09/2026) ─────────────────────────────────────────────────────
// Chia giáo trình thành học phần theo SỐ BUỔI RIÊNG của từng học phần — cách DUY NHẤT màn giáo
// trình gán `Lesson.moduleCode`. Học phần của KHOÁ đọc thẳng từ đây (trang khoá › Học bù, lượt bù,
// nhãn buổi), nên chia ở giáo trình là khoá tự khớp theo — không có bản sao thứ hai để lệch.
// Chỉ ĐỔI NHÃN học phần trên bài có sẵn: không tạo/xoá bài nào, nên không chạm buổi học của lớp,
// giáo án SCORM, bài tập hay nhận xét đang trỏ vào bài. Bài lưu trữ (archived) không chia.
export async function chiaHocPhanAction(input: { curriculumId: string; soBuoiMoiHp: number[] }): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;
  const p = z
    .object({
      curriculumId: z.string().min(1),
      soBuoiMoiHp: z.array(z.number().int().min(1).max(500)).max(TRAN_SO_HOC_PHAN),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Cấu trúc học phần không hợp lệ" };

  const cur = await gate.sdb.curriculum.findUnique({
    where: { id: p.data.curriculumId },
    select: { id: true, courseId: true, lessons: { where: { archivedAt: null }, select: { id: true, order: true, moduleCode: true } } },
  });
  if (!cur) return { ok: false, error: "Giáo trình không tồn tại" };

  const chia = chiaHocPhanTheoSo(cur.lessons.map((l) => l.order), p.data.soBuoiMoiHp);
  if (!chia.ok) return { ok: false, error: chia.lyDo };
  const idTheoThuTu = new Map(cur.lessons.map((l) => [l.order, l.id]));
  await gate.sdb.$transaction(async (tx) => {
    for (const g of chia.gan) {
      await tx.lesson.update({
        where: { id: idTheoThuTu.get(g.order)! },
        data: { moduleCode: g.moduleCode, moduleName: g.moduleName },
      });
    }
  });

  const { actorId, actorName } = getAuditActor(gate.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "lms",
    entityType: "Curriculum",
    entityId: cur.id,
    action: "UPDATE",
    oldValues: { hocPhan: tomTatHocPhan(cur.lessons).map((h) => `${h.moduleCode}:${h.soBai}`) },
    newValues: { hocPhan: p.data.soBuoiMoiHp.map((n, i) => `HP${i + 1}:${n}`) },
  });

  revalidatePath(`/curriculums/${cur.id}/edit`);
  revalidatePath(`/courses/${cur.courseId}`);
  revalidatePath("/hoc-bu");
  return { ok: true };
}
