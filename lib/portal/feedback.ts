import "server-only";
import { db } from "@/lib/db";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import {
  parseFeedbackNotes,
  parseFeedbackRubric,
  type EvalNotes,
} from "@/lib/lms/session-eval-rubric";
import {
  meaningfulSessionTitle,
  resolveDisplayProjectName,
} from "@/lib/lms/session-project-name";

// Portal v2 — nhận xét buổi học (StudentSessionFeedback) của con đang chọn.

export type FeedbackItem = {
  id: string;
  order: number | null;
  title: string;
  dateISO: string;
  teacher: string | null;
  className: string | null;
  comment: string;
  rating: number | null;
  /** Tên dự án buổi (phiếu nhận xét mở rộng site GV) — null với nhận xét cũ. */
  projectName: string | null;
  /** 4 mục văn xuôi Kiến thức/Kỹ năng/Thái độ/Đề xuất — null nếu phiếu không có mục nào. */
  notes: EvalNotes | null;
  /** Rubric năng lực { criterionId: mức 1-5 } (lib/lms/session-eval-rubric) — chỉ giữ
   *  tiêu chí hợp lệ; null nếu phiếu không chấm rubric. */
  rubric: Record<string, number> | null;
};

// ─── PURE — parse Json phiếu mở rộng (test được, không DB) ───────────────────
// Hai hàm này ĐÃ CHUYỂN sang lib/lms/session-eval-rubric.ts (module thuần, không
// `server-only`/Prisma) để màn admin dùng lại mà không kéo Prisma vào. Re-export
// giữ nguyên đường import cũ của portal + feedback.test.ts.
export { parseFeedbackNotes, parseFeedbackRubric };

/**
 * Bảng tra "buổi thứ mấy" cho các lớp có phiếu nhận xét của con (lib/lms/session-order).
 *
 * Nằm ở lib/ và dùng `db` TRẦN có chủ đích: `ClassSession` ∈ SCOPED_MODELS nên
 * `scopedDb(actor).classSession` sẽ lọc theo `visibleCenterIds`, mà tài khoản PHỤ HUYNH
 * không đứng ở cơ sở nào (RELATIONSHIP_ROLE_CODES, centerScope null) ⇒ gọi qua scopedDb
 * là trả về rỗng và số buổi biến mất im lặng ở cổng phụ huynh.
 * Cách ly ở đây là OWNERSHIP: caller phải xác minh con qua `requireActiveStudent` rồi
 * truyền vào đúng những classId lấy từ phiếu CỦA CON — chỉ trả về id/ngày, không dữ liệu HV.
 */
export async function getSessionNumberMapForClasses(
  classIds: string[],
): Promise<Map<string, number>> {
  if (classIds.length === 0) return new Map();
  const rows = await db.classSession.findMany({
    where: { classId: { in: classIds } },
    select: { id: true, classId: true, date: true },
  });
  return buildSessionNumberMap(rows);
}

/**
 * @param limit LIMIT đẩy xuống DB (mặc định 20 — đủ cho trang Nhận xét, học viên
 * >50 feedback không phình payload). Feed thông báo chỉ cần 3 card/con →
 * truyền 3, KHÔNG kéo toàn bộ nhận xét về rồi slice.
 */
export async function getStudentFeedback(studentId: string, limit = 20): Promise<FeedbackItem[]> {
  const rows = await db.studentSessionFeedback.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      classSessionId: true,
      comment: true,
      rating: true,
      projectName: true,
      notes: true,
      rubric: true,
      createdById: true,
      classSession: {
        select: {
          classId: true,
          date: true,
          topic: true,
          plan: { select: { customTitle: true, order: true } },
          lesson: { select: { order: true, title: true, moduleCode: true } },
          class: { select: { classCode: true } },
        },
      },
    },
  });

  // 21/08 — SỐ BUỔI phải khớp thứ mà giáo viên và quản lý đang nhìn (lib/lms/session-order:
  // hạng theo ngày trong lớp). Trước đây portal in `lesson.order`, nên buổi chưa gắn giáo
  // án hiện dấu "•" và phụ huynh hỏi "buổi 7" thì không ai đối chiếu được với site GV.
  const classIds = [
    ...new Set(rows.map((r) => r.classSession?.classId).filter((x): x is string => !!x)),
  ];
  const teacherIds = [...new Set(rows.map((r) => r.createdById))];
  // Hai truy vấn phụ chạy SONG SONG — trang nhận xét nằm trên đường vào của cổng phụ
  // huynh, thêm một round-trip nối đuôi là cộng thẳng vào thời gian mở trang, nhân theo
  // số con của phụ huynh đó.
  const [sessionNumberOf, teachers] = await Promise.all([
    getSessionNumberMapForClasses(classIds),
    teacherIds.length
      ? db.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const tmap = new Map(teachers.map((t) => [t.id, t.name]));

  return rows.map((r) => {
    const les = r.classSession?.lesson;
    const no = sessionNumberOf.get(r.classSessionId) ?? les?.order ?? null;
    const lessonTitle = meaningfulSessionTitle(les?.title);
    return {
      id: r.id,
      order: no,
      // ⚠️ Chỉ ghép "Buổi N: …" khi CÓ tên bài. Buổi chưa gắn giáo án giữ nhãn "Buổi học"
      // như cũ: thẻ ở portal V2 in số buổi ở huy hiệu riêng rồi cắt tiền tố khỏi tiêu đề
      // (`replace(/^Buổi \d+: /)`), nên trả về "Buổi 7" trần sẽ thành tiêu đề trùng huy hiệu.
      //
      // 26/08 — tên bài phải qua `meaningfulSessionTitle` trước khi ghép. Giáo trình đặt
      // tên bài kèm sẵn số buổi ("Buổi 7 — Vòng lặp và điều kiện"), ghép thẳng là phụ
      // huynh đọc ra "Buổi 7: Buổi 7 — Vòng lặp và điều kiện".
      title: lessonTitle ? `Buổi ${no ?? les?.order}: ${lessonTitle}` : "Buổi học",
      dateISO: r.classSession?.date?.toISOString() ?? "",
      teacher: tmap.get(r.createdById) ?? null,
      className: r.classSession?.class?.classCode ?? null,
      // comment nay nullable (phiếu nhận xét buổi rubric-only) → coalesce cho portal PH.
      comment: r.comment ?? "",
      rating: r.rating,
      // 26/08 — tên dự án suy từ BUỔI, không đọc bản sao đông cứng trên phiếu: cùng
      // một buổi mà mỗi học viên lưu một "dự án" khác nhau (xem resolveDisplayProjectName).
      projectName: resolveDisplayProjectName(
        {
          sessionNumber: no,
          planTitle: r.classSession?.plan?.customTitle,
          planOrder: r.classSession?.plan?.order,
          lessonTitle: les?.title,
          lessonOrder: les?.order,
          moduleCode: les?.moduleCode,
          topic: r.classSession?.topic,
        },
        r.projectName,
      ),
      notes: parseFeedbackNotes(r.notes),
      rubric: parseFeedbackRubric(r.rubric),
    };
  });
}
