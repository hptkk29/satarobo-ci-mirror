// lib/lms/curriculum-merge.ts — GỘP BÀI TỪ GIÁO TRÌNH KHÁC (thuần, không đụng DB).
//
// VÌ SAO CÓ: khoá "Combo — Full Lộ Trình Luyện Thi" theo định nghĩa là khoá GỘP của
// Sata 1 (buổi 1–16) và Sata 2 (buổi 17–32). Trước đây phải gõ tay 32 bài, và mỗi lần
// giáo trình gốc đổi thì bản gộp lệch mà không ai biết. Trên prod 08/08/2026 giáo trình
// Combo đang là 32 ô trống "Buổi 1…32".
//
// LUẬT QUAN TRỌNG NHẤT — GHI ĐÈ TẠI CHỖ, KHÔNG XOÁ-RỒI-TẠO:
// `ClassSession.lessonId` và `ClassSessionPlan.lessonId` của các lớp Combo ĐANG CHẠY trỏ
// thẳng vào Lesson của giáo trình đích. Xoá bài rồi tạo lại sẽ để lại con trỏ mồ côi
// (học bạ, tiến độ, bài tập theo buổi đều đọc qua `lessonId`). Vì vậy bài đích giữ
// nguyên `id`, chỉ thay NỘI DUNG.

/** Các field NỘI DUNG được sao chép. Cố ý KHÔNG có status/lock/archive/version. */
export interface LessonContent {
  title: string;
  description: string | null;
  content: string | null;
  duration: number;
  objectives: string[];
  materials: string[];
  notes: string | null;
  teacherGuide: string | null;
  expectedOutput: string | null;
  homeworkDefault: string | null;
  assessmentCriteria: string | null;
}

export interface SourceLesson extends LessonContent {
  id: string;
  order: number;
}

/** Bài của giáo trình ĐÍCH — chỉ cần đủ để quyết định chặn / cảnh báo. */
export interface TargetLesson {
  id: string;
  order: number;
  title: string;
  status: string;
  archivedAt: Date | null;
  /** Đã gắn SCORM / bài tập / đề thi / tài liệu — ghi đè nội dung là lệch học liệu. */
  attachmentCount: number;
}

export interface MergePlanItem {
  targetOrder: number;
  /** null = sẽ TẠO bài mới ở vị trí này. */
  targetId: string | null;
  sourceLessonId: string;
  sourceTitle: string;
  /** Tiêu đề bài đích hiện tại (rỗng khi sẽ tạo mới). */
  currentTitle: string;
  action: "overwrite" | "create";
  /** Lý do KHÔNG cho gộp (chặn cả thao tác). */
  blockedReason: string | null;
  /** Cảnh báo, vẫn cho gộp. */
  warning: string | null;
}

export interface MergePlan {
  items: MergePlanItem[];
  errors: string[];
  warnings: string[];
  overwriteCount: number;
  createCount: number;
}

/** Ô trống do "Áp dụng số buổi" sinh ra: tiêu đề đúng dạng `Buổi N`, không có gì khác. */
export function isPlaceholderTitle(title: string, order: number): boolean {
  return title.trim() === `Buổi ${order}`;
}

export interface PlanLessonMergeInput {
  /** Bài của giáo trình nguồn, đã sắp theo `order` tăng dần. */
  sources: readonly SourceLesson[];
  /** Bài của giáo trình đích (kể cả bài đã lưu trữ), đã sắp theo `order`. */
  targets: readonly TargetLesson[];
  /** Buổi đích cho bài nguồn ĐẦU TIÊN (1-based). Combo: Sata1→1, Sata2→17. */
  startOrder: number;
}

/**
 * Dựng phương án gộp. THUẦN — không ghi gì, dùng chung cho "xem trước" và "áp dụng"
 * để hai bên không bao giờ lệch nhau.
 */
export function planLessonMerge(input: PlanLessonMergeInput): MergePlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items: MergePlanItem[] = [];

  const sources = [...input.sources].sort((a, b) => a.order - b.order);
  if (sources.length === 0) {
    return { items, errors: ["Giáo trình nguồn chưa có bài học nào."], warnings, overwriteCount: 0, createCount: 0 };
  }
  if (!Number.isInteger(input.startOrder) || input.startOrder < 1) {
    return { items, errors: ["Vị trí buổi bắt đầu phải là số nguyên ≥ 1."], warnings, overwriteCount: 0, createCount: 0 };
  }

  const byOrder = new Map(input.targets.map((t) => [t.order, t]));
  const maxTargetOrder = input.targets.reduce((m, t) => (t.order > m ? t.order : m), 0);
  if (input.startOrder > maxTargetOrder + 1) {
    errors.push(
      `Giáo trình đích đang có ${maxTargetOrder} buổi — không thể bắt đầu từ buổi ${input.startOrder} (sẽ để trống buổi ${maxTargetOrder + 1}–${input.startOrder - 1}).`,
    );
  }

  for (const [i, src] of sources.entries()) {
    const targetOrder = input.startOrder + i;
    const tgt = byOrder.get(targetOrder) ?? null;

    let blockedReason: string | null = null;
    let warning: string | null = null;
    if (tgt) {
      if (tgt.status === "LOCKED") {
        blockedReason = `Buổi ${targetOrder} đang KHÓA — Đào tạo phải mở khóa trước.`;
      } else if (tgt.archivedAt) {
        blockedReason = `Buổi ${targetOrder} đã lưu trữ (đọc-only) — khôi phục trước khi gộp.`;
      } else {
        const notes: string[] = [];
        if (!isPlaceholderTitle(tgt.title, tgt.order)) {
          notes.push(`đang có nội dung riêng ("${tgt.title}")`);
        }
        if (tgt.attachmentCount > 0) {
          notes.push(`đã gắn ${tgt.attachmentCount} học liệu/bài tập (giữ nguyên, không đổi theo)`);
        }
        if (notes.length > 0) warning = `Buổi ${targetOrder}: ${notes.join("; ")}.`;
      }
    }
    if (blockedReason) errors.push(blockedReason);
    if (warning) warnings.push(warning);

    items.push({
      targetOrder,
      targetId: tgt?.id ?? null,
      sourceLessonId: src.id,
      sourceTitle: src.title,
      currentTitle: tgt?.title ?? "",
      action: tgt ? "overwrite" : "create",
      blockedReason,
      warning,
    });
  }

  return {
    items,
    errors,
    warnings,
    overwriteCount: items.filter((it) => it.action === "overwrite").length,
    createCount: items.filter((it) => it.action === "create").length,
  };
}

/** Lấy đúng phần NỘI DUNG để ghi sang bài đích (bản sao, không mang id/order). */
export function pickLessonContent(src: LessonContent): LessonContent {
  return {
    title: src.title,
    description: src.description,
    content: src.content,
    duration: src.duration,
    objectives: [...src.objectives],
    materials: [...src.materials],
    notes: src.notes,
    teacherGuide: src.teacherGuide,
    expectedOutput: src.expectedOutput,
    homeworkDefault: src.homeworkDefault,
    assessmentCriteria: src.assessmentCriteria,
  };
}
