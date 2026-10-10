// lib/lms/curriculum.ts — R7-10
// Service nghiệp vụ khung chương trình: resize N buổi (an toàn) + trạng thái buổi
// + khóa/mở khóa + soft-archive. KHÔNG xử lý auth ở đây (gate trong Server Action);
// service được viết "thuần" để test trực tiếp (Vitest C5 — optimistic lock).
import { Prisma } from "@prisma/client";
import type { LessonStatus, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

// Service nhận PrismaClient (cần $transaction) — actions truyền `db`, test truyền `db`.
type RootClient = PrismaClient;

/** Lỗi optimistic-lock: bản ghi đã bị người khác đổi → client phải reload. */
export class CurriculumConflictError extends Error {
  constructor(message = "Dữ liệu đã thay đổi, hãy tải lại trang") {
    super(message);
    this.name = "CurriculumConflictError";
  }
}

export type ArchiveCandidate = {
  id: string;
  order: number;
  title: string;
  status: LessonStatus;
  version: number;
  examCount: number;
  assignmentCount: number;
  documentCount: number;
  /** Có liên kết Exam/Assignment/Document (≈ SCORM) → cần confirm khi loại. */
  hasLinks: boolean;
  /** Đang được sử dụng (IN_USE) → chặn archive, phải gỡ khỏi sử dụng trước. */
  isInUse: boolean;
};

export type ResizePlan = {
  curriculumId: string;
  current: number;
  target: number;
  mode: "noop" | "increase" | "decrease";
  /** Số buổi sẽ tạo mới (khi tăng). */
  toCreateCount: number;
  /** Buổi sẽ loại (khi giảm) — buổi order cao nhất bị cắt trước. */
  toArchive: ArchiveCandidate[];
  /** Buổi IN_USE trong danh sách loại → KHÔNG cho archive. */
  blocked: ArchiveCandidate[];
  /** Cần xác nhận tường minh (có buổi gắn exam/assignment/document). */
  needsConfirm: boolean;
};

export type ResizeResult =
  | { ok: true; created: number; archived: number; plan: ResizePlan }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID" | "NEEDS_CONFIRM" | "BLOCKED_IN_USE" | "CONFLICT";
      message: string;
      plan?: ResizePlan;
    };

const ACTIVE = { archivedAt: null } as const;

/** Đọc trạng thái hiện tại + dựng kế hoạch resize (read-only — dùng cho modal). */
export async function planResize(
  curriculumId: string,
  targetN: number,
  client: RootClient = db,
): Promise<ResizePlan> {
  const lessons = await client.lesson.findMany({
    where: { curriculumId, ...ACTIVE },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      status: true,
      version: true,
      _count: { select: { exams: true, assignments: true, documents: true } },
    },
  });

  const current = lessons.length;
  const target = Math.trunc(targetN);

  let mode: ResizePlan["mode"] = "noop";
  if (target > current) mode = "increase";
  else if (target < current) mode = "decrease";

  const toArchive: ArchiveCandidate[] =
    mode === "decrease"
      ? lessons
          .slice()
          .sort((a, b) => b.order - a.order) // order cao nhất bị cắt trước
          .slice(0, current - target)
          .map((l) => {
            const examCount = l._count.exams;
            const assignmentCount = l._count.assignments;
            const documentCount = l._count.documents;
            return {
              id: l.id,
              order: l.order,
              title: l.title,
              status: l.status,
              version: l.version,
              examCount,
              assignmentCount,
              documentCount,
              hasLinks: examCount + assignmentCount + documentCount > 0,
              isInUse: l.status === "IN_USE",
            };
          })
      : [];

  const blocked = toArchive.filter((c) => c.isInUse);

  return {
    curriculumId,
    current,
    target,
    mode,
    toCreateCount: mode === "increase" ? target - current : 0,
    toArchive,
    blocked,
    needsConfirm: toArchive.some((c) => c.hasLinks),
  };
}

/**
 * Resize số buổi của một giáo trình.
 * - Tăng: append Lesson mới (status=INCOMPLETE), giữ nguyên buổi cũ.
 * - Giảm: soft-archive (archivedAt) buổi order cao nhất — KHÔNG xóa cứng,
 *   buổi archive vẫn đọc được, link Exam/Assignment/Document còn nguyên.
 * - Giảm có buổi gắn link → cần `confirm: true`.
 * - Giảm có buổi IN_USE → chặn (BLOCKED_IN_USE).
 * - Optimistic lock: truyền `expectedVersions` (theo lúc xem) → nếu version DB
 *   đã đổi (người khác resize song song) → CONFLICT (1 thắng, 1 báo reload).
 */
export async function resizeCurriculum(opts: {
  curriculumId: string;
  targetN: number;
  confirm?: boolean;
  expectedVersions?: Record<string, number>;
  client?: RootClient;
}): Promise<ResizeResult> {
  const client = opts.client ?? db;
  const target = Math.trunc(opts.targetN);
  if (!Number.isFinite(target) || target < 1) {
    return { ok: false, code: "INVALID", message: "Số buổi phải là số nguyên ≥ 1" };
  }

  const curriculum = await client.curriculum.findUnique({
    where: { id: opts.curriculumId },
    select: { id: true },
  });
  if (!curriculum) return { ok: false, code: "NOT_FOUND", message: "Giáo trình không tồn tại" };

  const plan = await planResize(opts.curriculumId, target, client);

  if (plan.mode === "noop") {
    return { ok: true, created: 0, archived: 0, plan };
  }

  if (plan.mode === "increase") {
    try {
      const created = await client.$transaction(async (tx) => {
        const agg = await tx.lesson.aggregate({
          where: { curriculumId: opts.curriculumId },
          _max: { order: true },
        });
        let next = (agg._max.order ?? 0) + 1;
        const n = plan.toCreateCount;
        for (let i = 0; i < n; i++) {
          await tx.lesson.create({
            data: {
              curriculumId: opts.curriculumId,
              order: next,
              title: `Buổi ${next}`,
              status: "INCOMPLETE",
            },
          });
          next++;
        }
        return n;
      });
      return { ok: true, created, archived: 0, plan };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { ok: false, code: "CONFLICT", message: "Có người vừa thêm buổi, hãy tải lại trang", plan };
      }
      throw err;
    }
  }

  // mode === "decrease"
  if (plan.blocked.length > 0) {
    return {
      ok: false,
      code: "BLOCKED_IN_USE",
      message: `Buổi ${plan.blocked
        .map((c) => c.order)
        .join(", ")} đang được sử dụng — hãy gỡ khỏi sử dụng trước khi loại.`,
      plan,
    };
  }
  if (plan.needsConfirm && !opts.confirm) {
    return { ok: false, code: "NEEDS_CONFIRM", message: "Cần xác nhận: có buổi gắn bài tập/đề thi/tài liệu", plan };
  }

  try {
    const archived = await client.$transaction(async (tx) => {
      let count = 0;
      for (const c of plan.toArchive) {
        const expected = opts.expectedVersions?.[c.id];
        const r = await tx.lesson.updateMany({
          where: {
            id: c.id,
            archivedAt: null,
            ...(expected !== undefined ? { version: expected } : {}),
          },
          data: { archivedAt: new Date(), version: { increment: 1 } },
        });
        // 0 dòng = đã bị người khác archive/đổi version (optimistic lock).
        if (r.count !== 1) throw new CurriculumConflictError();
        count++;
      }
      return count;
    });
    return { ok: true, created: 0, archived, plan };
  } catch (err) {
    if (err instanceof CurriculumConflictError) {
      return { ok: false, code: "CONFLICT", message: err.message, plan };
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Trạng thái buổi + khóa/mở khóa
// ──────────────────────────────────────────────────────────────────────────

/** LOCKED → chặn mọi sửa nội dung (chỉ Đào tạo unlock được). */
export function isLessonLocked(status: LessonStatus): boolean {
  return status === "LOCKED";
}

/** Đổi trạng thái buổi. LOCKED → ghi lockedAt/lockedById; rời LOCKED → xóa. */
export async function setLessonStatus(
  args: { lessonId: string; status: LessonStatus; actorId: string | null; client?: RootClient },
): Promise<{ id: string; status: LessonStatus }> {
  const client = args.client ?? db;
  const locking = args.status === "LOCKED";
  const updated = await client.lesson.update({
    where: { id: args.lessonId },
    data: {
      status: args.status,
      lockedAt: locking ? new Date() : null,
      lockedById: locking ? args.actorId : null,
      version: { increment: 1 },
    },
    select: { id: true, status: true },
  });
  return updated;
}

/** Soft-archive 1 buổi. Chặn nếu IN_USE (phải gỡ khỏi sử dụng trước). */
export async function archiveLesson(
  args: { lessonId: string; client?: RootClient },
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "IN_USE" | "ALREADY"; message: string }> {
  const client = args.client ?? db;
  const lesson = await client.lesson.findUnique({
    where: { id: args.lessonId },
    select: { id: true, status: true, archivedAt: true },
  });
  if (!lesson) return { ok: false, code: "NOT_FOUND", message: "Bài học không tồn tại" };
  if (lesson.archivedAt) return { ok: false, code: "ALREADY", message: "Bài học đã được lưu trữ" };
  if (lesson.status === "IN_USE") {
    return { ok: false, code: "IN_USE", message: "Buổi đang được sử dụng — gỡ khỏi sử dụng trước khi lưu trữ" };
  }
  await client.lesson.update({
    where: { id: args.lessonId },
    data: { archivedAt: new Date(), version: { increment: 1 } },
  });
  return { ok: true };
}

/** Khôi phục buổi đã archive (reversible — R7-10 §7). */
export async function unarchiveLesson(
  args: { lessonId: string; client?: RootClient },
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND"; message: string }> {
  const client = args.client ?? db;
  const lesson = await client.lesson.findUnique({
    where: { id: args.lessonId },
    select: { id: true },
  });
  if (!lesson) return { ok: false, code: "NOT_FOUND", message: "Bài học không tồn tại" };
  await client.lesson.update({
    where: { id: args.lessonId },
    data: { archivedAt: null, version: { increment: 1 } },
  });
  return { ok: true };
}

export const LESSON_STATUS_LABEL: Record<LessonStatus, string> = {
  INCOMPLETE: "Chưa hoàn thiện",
  COMPLETE: "Hoàn thiện",
  IN_USE: "Đang sử dụng",
  NEEDS_UPDATE: "Cần cập nhật",
  LOCKED: "Đã khóa",
};
