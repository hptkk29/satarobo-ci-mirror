import "server-only";
import { db } from "@/lib/db";

// Portal v2 — danh sách khảo sát trung tâm/cơ sở cho phụ huynh (giống SataUI).
// Nguồn: Survey (isActive) khớp cơ sở của con; trạng thái "đã làm" theo từng con.

export type SurveyQuestionItem = {
  id: string;
  text: string;
  type: "NPS" | "RATING" | "TEXT";
};

export type SurveyCard = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  minutes: number;
  done: boolean;
  /** ISO createdAt của Survey — feed thông báo dùng làm mốc thời gian (khỏi query lại bảng Survey). */
  createdAt: string;
  /** Câu hỏi thật của survey (theo order) — form phải render ĐỦ, không hardcode 1 câu NPS. */
  questions: SurveyQuestionItem[];
};

function categoryOf(title: string): string {
  const t = title.toLowerCase();
  if (/giảng dạy|giáo trình|đào tạo|bài giảng|chương trình/.test(t)) return "Đào tạo";
  if (/cơ sở|phòng lab|vật chất|thiết bị|không gian/.test(t)) return "Cơ sở vật chất";
  if (/dịch vụ|chăm sóc|hỗ trợ|đón tiếp|tư vấn/.test(t)) return "Dịch vụ";
  return "Khảo sát";
}

export async function getCenterSurveys(
  studentId: string,
  // withQuestions=false: bỏ join surveyQuestion khi caller chỉ cần đếm/liệt kê
  // (notification-feed) — khỏi kéo full text câu hỏi từ DB. Lúc đó questions=[]
  // và minutes rơi về mức sàn 2 (feed không dùng minutes).
  opts: { withQuestions?: boolean } = {},
): Promise<{ cards: SurveyCard[]; todoCount: number }> {
  const withQuestions = opts.withQuestions ?? true;
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { centerId: true, preferredCenterId: true },
  });
  const centerIds = [student?.centerId, student?.preferredCenterId].filter((x): x is string => !!x);

  const where = {
    isActive: true,
    OR: [{ centerId: null }, ...(centerIds.length ? [{ centerId: { in: centerIds } }] : [])],
  };
  // desc (khớp trang v1): survey MỚI luôn lọt cửa sổ take 20 — asc sẽ giữ 20 bản
  // CŨ nhất và ẩn vĩnh viễn survey mới khi cơ sở tích lũy >20 survey active.
  const surveys = withQuestions
    ? await db.survey.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          description: true,
          createdAt: true,
          questions: { orderBy: { order: "asc" }, select: { id: true, text: true, type: true } },
        },
      })
    : (
        await db.survey.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, title: true, description: true, createdAt: true },
        })
      ).map((s) => ({ ...s, questions: [] as SurveyQuestionItem[] }));

  const answered = new Set(
    (
      await db.surveyResponse.findMany({
        where: { studentId, surveyId: { in: surveys.map((s) => s.id) } },
        select: { surveyId: true },
      })
    ).map((r) => r.surveyId),
  );

  const cards: SurveyCard[] = surveys.map((s) => ({
    id: s.id,
    category: categoryOf(s.title),
    title: s.title,
    description: s.description,
    minutes: Math.max(2, Math.ceil(s.questions.length / 3)),
    done: answered.has(s.id),
    createdAt: s.createdAt.toISOString(),
    questions: s.questions,
  }));

  return { cards, todoCount: cards.filter((c) => !c.done).length };
}
