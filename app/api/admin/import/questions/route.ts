import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  QuestionTypeEnum,
  QuestionDifficultyEnum,
} from "@/lib/validators/question";
import { checkPermission } from "@/lib/auth/check-permission";

function parseBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES" || s === "Y" || s === "ĐÚNG";
  }
  return false;
}

const optionalString = z
  .union([z.string(), z.null(), z.number()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  });

const tagsFromCsv = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (!v) return [];
    return Array.from(
      new Set(
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    );
  });

// FL1-03 — điểm/câu (>= 0) và thời gian/câu (giây, >= 1). Trống → null.
const optionalNonNegFloat = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === ""))
      return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "points phải là số >= 0" });
      return z.NEVER;
    }
    return n;
  });

const optionalPosInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === ""))
      return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "giá trị phải là số nguyên >= 1",
      });
      return z.NEVER;
    }
    return n;
  });

const RowSchema = z.object({
  questionCode: optionalString,
  // FL1-03 — khung chương trình: courseSlug (unique) + curriculumVersion (đi cùng).
  courseSlug: optionalString,
  curriculumVersion: optionalPosInt,
  points: optionalNonNegFloat,
  timeLimitSec: optionalPosInt,
  type: z
    .union([QuestionTypeEnum, z.literal(""), z.null()])
    .transform((v, ctx) => {
      if (v === "" || v === null || v === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Thiếu type",
        });
        return z.NEVER;
      }
      return v;
    }),
  text: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().min(1, "Thiếu đề bài")),
  difficulty: z
    .union([QuestionDifficultyEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? "MEDIUM" : v))
    .pipe(QuestionDifficultyEnum),
  tags: tagsFromCsv,
  correctAnswer: optionalString,
  choice1: optionalString,
  choice1_correct: z.unknown().optional().transform((v) => parseBoolean(v)),
  choice2: optionalString,
  choice2_correct: z.unknown().optional().transform((v) => parseBoolean(v)),
  choice3: optionalString,
  choice3_correct: z.unknown().optional().transform((v) => parseBoolean(v)),
  choice4: optionalString,
  choice4_correct: z.unknown().optional().transform((v) => parseBoolean(v)),
  explanation: optionalString,
  isPublic: z
    .unknown()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return true;
      return parseBoolean(v);
    }),
  notes: optionalString,
});

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("questions:author"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = (body as { rows?: unknown[] })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Không có dữ liệu" }, { status: 400 });
  }
  if (rows.length > 5000) {
    return NextResponse.json({ error: "Quá 5000 rows" }, { status: 400 });
  }

  // Cách ly cơ sở: Question/Course/Curriculum là catalog GLOBAL (không center-scope),
  // User exempt → sdb pass-through, hành vi y nguyên.
  const sdb = scopedDb(await resolveActor(session.user.id));

  // Resolve current user's Employee id once (authorId targets Employee).
  let authorEmployeeId: string | null = null;
  if (session.user.id) {
    try {
      const u = await sdb.user.findUnique({
        where: { id: session.user.id },
        select: { employeeId: true },
      });
      authorEmployeeId = u?.employeeId ?? null;
    } catch {
      authorEmployeeId = null;
    }
  }

  // FL1-03 — preload maps để gắn câu hỏi vào khung CT: Course.slug → id và
  // (courseId, version) → curriculumId. Tránh N query trong vòng lặp.
  const [courses, curricula] = await Promise.all([
    sdb.course.findMany({ select: { id: true, slug: true } }),
    sdb.curriculum.findMany({ select: { id: true, courseId: true, version: true } }),
  ]);
  const courseBySlug = new Map(courses.map((c) => [c.slug.toLowerCase(), c.id]));
  const curriculumByKey = new Map(
    curricula.map((c) => [`${c.courseId}::${c.version}`, c.id]),
  );

  type Parsed = z.infer<typeof RowSchema>;
  type ValidRow = {
    data: Parsed;
    choices: { order: number; text: string; isCorrect: boolean }[];
    curriculumId: string | null;
    courseId: string | null;
  };

  const errors: ImportError[] = [];
  const validRows: ValidRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const r = RowSchema.safeParse(rows[i]);
    if (!r.success) {
      errors.push({
        row: rowNo,
        error: r.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      });
      continue;
    }
    const d = r.data;

    // Build choices from choice1..choice4 (skip empties).
    const rawChoices: { text: string | null; correct: boolean }[] = [
      { text: d.choice1, correct: d.choice1_correct },
      { text: d.choice2, correct: d.choice2_correct },
      { text: d.choice3, correct: d.choice3_correct },
      { text: d.choice4, correct: d.choice4_correct },
    ];
    const choices: ValidRow["choices"] = [];
    for (const c of rawChoices) {
      if (c.text) {
        choices.push({ order: choices.length + 1, text: c.text, isCorrect: c.correct });
      }
    }

    // Type-specific validation
    if (d.type === "MULTIPLE_CHOICE" || d.type === "TRUE_FALSE") {
      if (choices.length < 2) {
        errors.push({
          row: rowNo,
          error: `${d.type} cần ít nhất 2 choices (điền choice1, choice2)`,
        });
        continue;
      }
      if (d.type === "TRUE_FALSE" && choices.length !== 2) {
        errors.push({
          row: rowNo,
          error: "TRUE_FALSE cần đúng 2 choices (Đúng / Sai); xoá choice3, choice4",
        });
        continue;
      }
      const correctCount = choices.filter((c) => c.isCorrect).length;
      if (correctCount === 0) {
        errors.push({
          row: rowNo,
          error: `${d.type} cần ít nhất 1 choice có isCorrect=TRUE`,
        });
        continue;
      }
      if (d.type === "TRUE_FALSE" && correctCount !== 1) {
        errors.push({
          row: rowNo,
          error: "TRUE_FALSE cần đúng 1 choice có isCorrect=TRUE",
        });
        continue;
      }
    } else if (d.type === "SHORT_ANSWER") {
      if (!d.correctAnswer) {
        errors.push({
          row: rowNo,
          error: "SHORT_ANSWER cần correctAnswer",
        });
        continue;
      }
    }
    // ESSAY / CODE: no extra validation

    // FL1-03 — gắn khung chương trình (tuỳ chọn). courseSlug → courseId;
    // kèm curriculumVersion → curriculumId (yêu cầu courseSlug để định danh khung).
    let curriculumId: string | null = null;
    let courseId: string | null = null;
    if (d.courseSlug) {
      const cid = courseBySlug.get(d.courseSlug.toLowerCase());
      if (!cid) {
        errors.push({ row: rowNo, error: `courseSlug "${d.courseSlug}" không tồn tại` });
        continue;
      }
      courseId = cid;
      if (d.curriculumVersion != null) {
        const curId = curriculumByKey.get(`${cid}::${d.curriculumVersion}`);
        if (!curId) {
          errors.push({
            row: rowNo,
            error: `Không tìm thấy khung CT v${d.curriculumVersion} cho courseSlug "${d.courseSlug}"`,
          });
          continue;
        }
        curriculumId = curId;
      }
    } else if (d.curriculumVersion != null) {
      errors.push({
        row: rowNo,
        error: "curriculumVersion cần đi kèm courseSlug",
      });
      continue;
    }

    validRows.push({ data: d, choices, curriculumId, courseId });
  }

  if (validRows.length === 0) {
    return NextResponse.json({ success: 0, errors });
  }

  let success = 0;
  try {
    await sdb.$transaction(async (tx) => {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        const baseData = {
          type: r.data.type,
          text: r.data.text,
          difficulty: r.data.difficulty,
          tags: r.data.tags,
          curriculumId: r.curriculumId,
          courseId: r.courseId,
          points: r.data.points,
          timeLimitSec: r.data.timeLimitSec,
          correctAnswer:
            r.data.type === "MULTIPLE_CHOICE" || r.data.type === "TRUE_FALSE"
              ? null
              : r.data.correctAnswer,
          explanation: r.data.explanation,
          isPublic: r.data.isPublic,
          notes: r.data.notes,
          authorId: authorEmployeeId,
        };

        try {
          let questionId: string;
          if (r.data.questionCode) {
            const upserted = await tx.question.upsert({
              where: { questionCode: r.data.questionCode },
              create: { ...baseData, questionCode: r.data.questionCode },
              update: baseData,
              select: { id: true },
            });
            questionId = upserted.id;
            await tx.choice.deleteMany({ where: { questionId } });
          } else {
            const created = await tx.question.create({
              data: baseData,
              select: { id: true },
            });
            questionId = created.id;
          }

          if (r.choices.length > 0) {
            await tx.choice.createMany({
              data: r.choices.map((c) => ({ questionId, ...c })),
            });
          }
          success++;
        } catch (err) {
          throw new Error(
            `Row ${i + 2}${
              r.data.questionCode ? ` (code=${r.data.questionCode})` : ""
            }: ${err instanceof Error ? err.message : "Unknown"}`,
            { cause: err },
          );
        }
      }
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: 0,
        errors: [
          ...errors,
          {
            row: 0,
            error: `Transaction failed: ${err instanceof Error ? err.message : "Unknown"}`,
          },
        ],
      },
      { status: 500 },
    );
  }

  revalidatePath("/admin/questions");
  return NextResponse.json({ success, errors });
}
