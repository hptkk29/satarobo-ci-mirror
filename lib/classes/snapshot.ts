import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";

// =============================================================================
// R7-06 — Snapshot giáo trình vào lớp (curriculum-pin) + kế hoạch buổi (session-plan).
// Khi tạo lớp ta "ghim" 1 version giáo trình; ClassSessionPlan là bản sao kế hoạch
// buổi của RIÊNG lớp (cho phép chỉnh sửa cục bộ không ảnh hưởng giáo trình gốc).
// =============================================================================

/**
 * PURE — version giáo trình hiệu lực của 1 lớp.
 * Đã ghim (curriculumVersion != null) → dùng version ghim; chưa ghim (lớp cũ) →
 * fallback về version active hiện tại (hành vi cũ).
 */
export function resolveEffectiveCurriculumVersion(
  cls: { curriculumId: string | null; curriculumVersion: number | null },
  fallbackActiveVersion: number | null,
): number | null {
  if (cls.curriculumVersion != null) return cls.curriculumVersion;
  return fallbackActiveVersion;
}

/**
 * Tạo ClassSessionPlan cho lớp từ giáo trình đã ghim (1 plan / 1 lesson, theo thứ tự).
 * Idempotent: nếu lớp ĐÃ có plan → không làm gì (trả về số plan hiện có).
 *
 * ⚠️ **KHÔNG ghi `customTitle`** (08/09/2026). Trước đây dòng này chép `customTitle: l.title`
 * — và đó là gốc của sự cố "lệch tên bài" (`docs/dieu-tra-lech-bai-hoc.md`).
 *
 * `customTitle` là ô dành cho thứ NGƯỜI gõ (`updateSessionPlan` ở màn quản lý lộ trình).
 * Đổ giá trị máy vào đó tạo ra một **bản sao đông cứng** không bao giờ tự đồng bộ khi giáo
 * trình đổi tên bài. Đo prod 08/09 cho thấy hậu quả: **960/960 plan có `customTitle`, 0 dòng
 * NULL** — đường máy bịt kín ô của người; trong đó 582 là ô trống `"Buổi N"`, 345 chép đúng
 * y `Lesson.title` (thừa), 33 mang **tên giáo trình CŨ** và đang che tên đúng. Chỉ **2/960**
 * dòng có dấu vết người thật sửa.
 *
 * Bỏ đi không mất gì: `deriveSessionTitle` đã có `Lesson.title` làm nấc kế ngay sau
 * `customTitle`, nên nhãn vẫn ra đúng tên bài — mà nay là tên **hiện hành**, không phải ảnh
 * chụp lúc tạo lớp. Giáo vụ muốn đặt tên riêng cho một buổi thì vẫn gõ vào đúng ô đó như cũ.
 *
 * @returns số ClassSessionPlan của lớp sau khi chạy.
 */
export async function createSessionPlansForClass(opts: {
  classId: string;
  curriculumId: string;
  version: number;
}): Promise<number> {
  const { classId, curriculumId } = opts;

  const existing = await db.classSessionPlan.count({ where: { classId } });
  if (existing > 0) return existing;

  const curriculum = await db.curriculum.findUnique({
    where: { id: curriculumId },
    select: {
      lessons: {
        orderBy: { order: "asc" },
        // `title` KHÔNG còn cần: tên bài đọc thẳng từ `Lesson` lúc dựng nhãn.
        select: { id: true },
      },
    },
  });
  const lessons = curriculum?.lessons ?? [];
  if (lessons.length === 0) return 0;

  await db.classSessionPlan.createMany({
    data: lessons.map((l, i) => ({
      classId,
      seq: i + 1,
      lessonId: l.id,
      // customTitle để NULL — xem docblock. Ô này chỉ dành cho thứ người gõ.
      order: i,
    })),
  });
  return lessons.length;
}

/**
 * Đổi (adopt) lớp sang 1 version giáo trình khác. Buổi đã COMPLETED giữ nguyên
 * plan (không đụng lịch sử); các buổi CHƯA hoàn thành được re-map sang plan mới
 * sinh từ version mới. Ghi AuditLog (before/after + reason). reason BẮT BUỘC.
 */
export async function adoptCurriculumVersion(opts: {
  classId: string;
  version: number;
  reason: string;
  actorId: string | null;
  actorName: string;
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const { classId, version, reason, actorId, actorName } = opts;
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "Lý do (reason) là bắt buộc khi đổi version giáo trình" };
  }

  const cls = await db.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: {
      id: true,
      courseId: true,
      curriculumId: true,
      curriculumVersion: true,
      sessions: { select: { id: true, status: true, planId: true, date: true } },
    },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  const target = await db.curriculum.findFirst({
    where: { courseId: cls.courseId, version },
    select: {
      id: true,
      lessons: { orderBy: { order: "asc" }, select: { id: true, title: true } },
    },
  });
  if (!target) {
    return { ok: false, error: `Không tìm thấy giáo trình version ${version} cho khoá này` };
  }

  const completed = cls.sessions.filter((s) => s.status === "COMPLETED");
  const keptPlanIds = new Set(
    completed.map((s) => s.planId).filter((p): p is string => !!p),
  );
  const keptCount = keptPlanIds.size;
  // Buổi chưa hoàn thành → re-map theo thứ tự ngày.
  const futureSessions = cls.sessions
    .filter((s) => s.status !== "COMPLETED")
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const before = {
    curriculumId: cls.curriculumId,
    curriculumVersion: cls.curriculumVersion,
  };

  await db.$transaction(async (tx) => {
    // 1) Ghim version mới lên Class.
    await tx.class.update({
      where: { id: classId },
      data: { curriculumId: target.id, curriculumVersion: version },
    });

    // 2) Xoá các plan KHÔNG thuộc buổi đã COMPLETED (buổi future trỏ planId sẽ SetNull).
    await tx.classSessionPlan.deleteMany({
      where: { classId, id: { notIn: keptPlanIds.size > 0 ? [...keptPlanIds] : ["__none__"] } },
    });

    // 3) Sinh plan mới từ lessons CÒN LẠI của version mới (bỏ qua phần đã COMPLETED).
    const remaining = target.lessons.slice(keptCount);
    const created = [] as { id: string }[];
    for (let i = 0; i < remaining.length; i++) {
      const l = remaining[i]!;
      const p = await tx.classSessionPlan.create({
        data: {
          classId,
          seq: keptCount + i + 1,
          lessonId: l.id,
          customTitle: l.title,
          order: keptCount + i,
        },
        select: { id: true },
      });
      created.push(p);
    }

    // 4) Re-link các buổi chưa hoàn thành sang plan mới (theo thứ tự).
    for (let i = 0; i < futureSessions.length; i++) {
      const plan = created[i];
      await tx.classSession.update({
        where: { id: futureSessions[i]!.id },
        data: { planId: plan?.id ?? null, lessonId: remaining[i]?.id ?? null },
      });
    }

    // 5) Audit.
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "classes",
      entityType: "Class",
      entityId: classId,
      action: "ADOPT_CURRICULUM_VERSION",
      oldValues: before,
      newValues: { curriculumId: target.id, curriculumVersion: version },
      reason,
      tx,
    });
  });

  // R7-06 §6 (GAP-4): version mới ít buổi hơn số buổi còn lại → buổi dư bị bỏ trống
  // nội dung (planId/lessonId = null) → cảnh báo để xử lý tay.
  const remainingCount = Math.max(0, target.lessons.length - keptCount);
  if (remainingCount < futureSessions.length) {
    return {
      ok: true,
      warning: `Version mới có ít buổi hơn số buổi còn lại — ${futureSessions.length - remainingCount} buổi cuối chưa có nội dung, cần xử lý tay`,
    };
  }
  return { ok: true };
}
