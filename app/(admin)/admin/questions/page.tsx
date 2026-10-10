import Link from "next/link";
import { FileSpreadsheet, HelpCircle, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { QuestionType, QuestionDifficulty } from "@prisma/client";
import { buildQuestionWhere } from "@/lib/questions/filter";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

const TYPE_INFO: Record<QuestionType, { label: string; color: string }> = {
  MULTIPLE_CHOICE: { label: "Trắc nghiệm", color: "bg-state-info-soft text-state-info-ink" },
  TRUE_FALSE: { label: "Đúng/Sai", color: "bg-state-success-soft text-state-success-ink" },
  SHORT_ANSWER: { label: "Trả lời ngắn", color: "bg-state-warning-soft text-state-warning-ink" },
  ESSAY: { label: "Tự luận", color: "bg-primary-soft text-primary" },
  CODE: { label: "Lập trình", color: "bg-muted text-foreground" },
  // Parity site GV 18/08 — 3 loại soạn ở kho GV / thư viện mẫu (payload ở Question.meta).
  FILL_BLANK: { label: "Điền chỗ trống", color: "bg-state-info-soft text-state-info-ink" },
  MATCHING: { label: "Ghép cặp", color: "bg-state-success-soft text-state-success-ink" },
  ORDERING: { label: "Sắp xếp", color: "bg-state-warning-soft text-state-warning-ink" },
};

const DIFFICULTY_INFO: Record<QuestionDifficulty, { label: string; color: string }> = {
  EASY: { label: "Dễ", color: "bg-state-success-soft text-state-success-ink" },
  MEDIUM: { label: "TB", color: "bg-state-warning-soft text-state-warning-ink" },
  HARD: { label: "Khó", color: "bg-primary-soft text-primary" },
  EXPERT: { label: "Chuyên gia", color: "bg-state-danger-soft text-state-danger-ink" },
};

const VALID_TYPES = Object.values(QuestionType);
const VALID_DIFFICULTIES = Object.values(QuestionDifficulty);

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    type?: string;
    difficulty?: string;
    curriculumId?: string;
    lessonId?: string;
    tag?: string;
  }>;
}

export default async function QuestionsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("questions:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const typeFilter =
    sp.type && VALID_TYPES.includes(sp.type as QuestionType)
      ? (sp.type as QuestionType)
      : undefined;
  const difficultyFilter =
    sp.difficulty &&
    VALID_DIFFICULTIES.includes(sp.difficulty as QuestionDifficulty)
      ? (sp.difficulty as QuestionDifficulty)
      : undefined;
  const curriculumFilter = sp.curriculumId?.trim() || undefined;
  const lessonFilter = sp.lessonId?.trim() || undefined;
  const tagFilter = sp.tag?.trim() || undefined;

  const where = buildQuestionWhere({
    q,
    type: typeFilter,
    difficulty: difficultyFilter,
    curriculumId: curriculumFilter,
    lessonId: lessonFilter,
    tag: tagFilter,
  });

  // Nhóm 01 L1 — Question/Lesson/Curriculum = ngân hàng câu hỏi + giáo trình
  // toàn cục (không center-scope), scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [questions, lessons, curriculums] = await Promise.all([
    sdb.question.findMany({
      where,
      include: {
        lesson: {
          select: {
            order: true,
            title: true,
            curriculum: { select: { name: true } },
          },
        },
        curriculum: { select: { name: true, course: { select: { name: true } } } },
        author: { select: { fullName: true } },
        _count: { select: { choices: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    sdb.lesson.findMany({
      where: { curriculum: { isActive: true } },
      include: { curriculum: { select: { name: true } } },
      orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
      take: 500,
    }),
    sdb.curriculum.findMany({
      where: { isActive: true },
      include: { course: { select: { name: true } } },
      orderBy: [{ courseId: "asc" }, { version: "desc" }],
      take: 300,
    }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <HelpCircle className="h-6 w-6 text-primary" />
            Ngân hàng câu hỏi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {questions.length > 0
              ? `${questions.length} câu hỏi`
              : "Chưa có câu hỏi nào"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/questions/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Thêm câu hỏi
          </Link>
          <NutXuat ma="cau-hoi" />
          <Link
            href="/questions/import"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Thêm bằng template
          </Link>
        </div>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm nội dung / mã câu hỏi..."
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi loại</option>
          {Object.entries(TYPE_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="difficulty"
          defaultValue={difficultyFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi độ khó</option>
          {Object.entries(DIFFICULTY_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="curriculumId"
          defaultValue={curriculumFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi khung CT</option>
          {curriculums.map((c) => (
            <option key={c.id} value={c.id}>
              {c.course.name} — {c.name} (v{c.version})
            </option>
          ))}
        </select>
        <select
          name="lessonId"
          defaultValue={lessonFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi bài học</option>
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.curriculum.name} — Bài {l.order}: {l.title}
            </option>
          ))}
        </select>
        <input
          name="tag"
          defaultValue={tagFilter}
          placeholder="Tag (vd: loop)"
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:col-span-2 lg:col-span-4"
        >
          Áp dụng bộ lọc
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Loại
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Độ khó
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Câu hỏi
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Bài học
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tags
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Soạn
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {questions.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có câu hỏi nào khớp bộ lọc.{" "}
                    <Link
                      href="/questions/new"
                      className="text-primary hover:underline"
                    >
                      Tạo mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                questions.map((q) => {
                  const typeInfo = TYPE_INFO[q.type];
                  const diffInfo = DIFFICULTY_INFO[q.difficulty];
                  return (
                    <tr key={q.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeInfo.color}`}
                        >
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${diffInfo.color}`}
                        >
                          {diffInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 max-w-md">
                        <div className="text-sm text-foreground line-clamp-2">
                          {q.text}
                        </div>
                        {q.questionCode && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {q.questionCode}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[180px]">
                        {q.lesson ? (
                          <>
                            <div className="font-medium">
                              {q.lesson.curriculum.name}
                            </div>
                            <div className="text-muted-foreground">
                              Bài {q.lesson.order}: {q.lesson.title}
                            </div>
                          </>
                        ) : q.curriculum ? (
                          <>
                            <div className="font-medium">
                              {q.curriculum.course.name}
                            </div>
                            <div className="text-muted-foreground">
                              {q.curriculum.name}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {q.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                          {q.tags.length > 4 && (
                            <span className="text-xs text-muted-foreground">
                              +{q.tags.length - 4}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {q.author?.fullName ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/questions/${q.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                        >
                          Sửa
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
