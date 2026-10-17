// lib/eval/aggregate.ts — R7-16: tổng hợp kết quả 1 đợt (AC4/AC6).
//
// PURE aggregateAnswers: avg sao + phân bố option + list text — KHÔNG kèm danh tính HV
// (an toàn để GV xem ẩn danh — AC4). DB-backed aggregateRound dùng lại bởi R7-17.
import { db } from "@/lib/db";
import { parseOptions, type QuestionType } from "@/lib/eval/forms";

export type AnswerRow = {
  questionId: string;
  valueNumber: number | null;
  valueOptions: unknown; // Json — string[]
  valueText: string | null;
};

export type QuestionMeta = {
  id: string;
  type: QuestionType;
  label: string;
  options: unknown; // Json — string[]
  order: number;
  groupLabel?: string | null;
};

export type QuestionAggregate =
  | {
      questionId: string;
      label: string;
      groupLabel: string | null;
      type: "STAR_RATING";
      count: number;
      avg: number | null;
      distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    }
  | {
      questionId: string;
      label: string;
      groupLabel: string | null;
      type: "RADIO" | "CHECKBOX";
      count: number;
      optionCounts: { option: string; count: number }[];
    }
  | {
      questionId: string;
      label: string;
      groupLabel: string | null;
      type: "TEXTBOX";
      count: number;
      texts: string[];
    }
  | {
      questionId: string;
      label: string;
      groupLabel: string | null;
      type: "PHOTO";
      count: number;
      photos: string[];
    };

export type RoundAggregate = {
  responseCount: number;
  questions: QuestionAggregate[];
};

/**
 * PURE — tổng hợp đáp án theo từng câu. ĐẦU VÀO chỉ là answers (không danh tính)
 * nên kết quả luôn an toàn để hiển thị ẩn danh cho GV.
 */
export function aggregateAnswers(
  questions: QuestionMeta[],
  answers: AnswerRow[],
  responseCount: number,
): RoundAggregate {
  const byQ = new Map<string, AnswerRow[]>();
  for (const a of answers) {
    const arr = byQ.get(a.questionId) ?? [];
    arr.push(a);
    byQ.set(a.questionId, arr);
  }

  const ordered = [...questions].sort((x, y) => x.order - y.order);
  const out: QuestionAggregate[] = ordered.map((q) => {
    const rows = byQ.get(q.id) ?? [];
    const groupLabel = q.groupLabel ?? null;
    if (q.type === "STAR_RATING") {
      const nums = rows.map((r) => r.valueNumber).filter((n): n is number => n != null);
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
      for (const n of nums) {
        if (n >= 1 && n <= 5) distribution[n as 1 | 2 | 3 | 4 | 5] += 1;
      }
      const avg = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
      return {
        questionId: q.id,
        label: q.label,
        groupLabel,
        type: "STAR_RATING",
        count: nums.length,
        avg: avg == null ? null : Math.round(avg * 100) / 100,
        distribution,
      };
    }
    if (q.type === "RADIO" || q.type === "CHECKBOX") {
      const counts = new Map<string, number>();
      for (const opt of parseOptions(q.options)) counts.set(opt, 0);
      let answered = 0;
      for (const r of rows) {
        const picked = parseOptions(r.valueOptions);
        if (picked.length) answered += 1;
        for (const p of picked) counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      return {
        questionId: q.id,
        label: q.label,
        groupLabel,
        type: q.type,
        count: answered,
        optionCounts: [...counts.entries()].map(([option, count]) => ({ option, count })),
      };
    }
    if (q.type === "PHOTO") {
      // Gom mọi URL ảnh đã nộp (valueOptions) — hiển thị thumbnail tổng hợp.
      const photos = rows.flatMap((r) => parseOptions(r.valueOptions));
      return { questionId: q.id, label: q.label, groupLabel, type: "PHOTO", count: photos.length, photos };
    }
    // TEXTBOX
    const texts = rows
      .map((r) => (r.valueText ?? "").trim())
      .filter((t) => t.length > 0);
    return { questionId: q.id, label: q.label, groupLabel, type: "TEXTBOX", count: texts.length, texts };
  });

  return { responseCount, questions: out };
}

// ─── DB-backed ──────────────────────────────────────────────────────────────

/**
 * Tổng hợp 1 đợt — ẩn danh (AC4/AC6). teacherId tùy chọn: TEACHER_EVAL lọc theo GV
 * (để GV chỉ thấy tổng hợp về CHÍNH MÌNH). Dùng lại bởi báo cáo R7-17.
 */
export async function aggregateRound(
  roundId: string,
  opts?: { teacherId?: string },
): Promise<RoundAggregate> {
  const round = await db.evaluationRound.findUnique({
    where: { id: roundId },
    select: { form: { select: { questions: { orderBy: { order: "asc" } } } } },
  });
  const questions: QuestionMeta[] = (round?.form.questions ?? []).map((q) => ({
    id: q.id,
    type: q.type as QuestionType,
    label: q.label,
    options: q.options,
    order: q.order,
    groupLabel: q.groupLabel,
  }));

  const responses = await db.evalResponse.findMany({
    where: { roundId, ...(opts?.teacherId ? { teacherId: opts.teacherId } : {}) },
    select: {
      answers: {
        select: { questionId: true, valueNumber: true, valueOptions: true, valueText: true },
      },
    },
  });

  const answers: AnswerRow[] = responses.flatMap((r) => r.answers);
  return aggregateAnswers(questions, answers, responses.length);
}

/**
 * Chi tiết 1 đợt (AC4 — chỉ evaluations:view-detail). Kèm danh tính người trả lời.
 */
export async function getRoundDetail(roundId: string) {
  return db.evalResponse.findMany({
    where: { roundId },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      submittedAt: true,
      enrollmentId: true,
      teacherId: true,
      parentUserId: true,
      studentId: true,
      answers: {
        select: { questionId: true, valueNumber: true, valueOptions: true, valueText: true },
      },
    },
  });
}
