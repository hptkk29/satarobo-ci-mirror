/**
 * Seed demo cho PARITY BÀI TẬP + TÀI LIỆU site GV (18/08) — DEV/test, KHÔNG prod.
 *   pnpm tsx prisma/seed-parity-baitap.ts
 *
 * Additive + idempotent (mã `SEED-PAR-*`, findFirst-trước-create) — chạy lại an toàn,
 * KHÔNG sửa/xoá dữ liệu có sẵn. Seed cho tài khoản GV test `giaovien.test@satarobo.vn`:
 *   1. KHO CỦA TÔI: 3 đề GV tự soạn (1 đề đủ 8 loại câu hỏi, 1 kiểm tra, 1 bài tập).
 *   2. THƯ VIỆN ADMIN: 3 mẫu trung tâm (2 số hoá + 1 chưa số hoá) gắn khung CT khoá GV dạy.
 *   3. BÀI ĐÃ GIAO: 2-3 bài PUBLISHED ở lớp GV phụ trách (bài tập có hạn nộp + gắn buổi;
 *      kiểm tra có khung giờ mở/đóng) + vài bản nộp SUBMITTED để chấm thử.
 *   4. TÀI LIỆU: Document giáo án (PDF) + phiếu bài tập (WORKSHEET) cho các buổi của
 *      khung CT ACTIVE — file mẫu public để trình xem /teacher/tai-lieu/xem mở được.
 *
 * Câu hỏi serialize đúng quy ước parity (Question.meta) qua serializeContentQuestion —
 * cùng đường lưu với dialog Tạo bài tập.
 */
import fs from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  serializeContentQuestion,
  type SerializedQuestion,
} from "../lib/assignments/question-content-db";
import type { ContentQuestion } from "../lib/assignments/question-content";

// tsx không tự nạp .env; ưu tiên DIRECT_URL (:5432) — pooler :6543 hay lỗi pgbouncer
// prepared-statement khi seed (xem .claude/rules/prisma-db.md).
function resolveDbUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  const pick = (k: string) =>
    env.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
  const url = pick("DIRECT_URL") ?? pick("DATABASE_URL");
  if (!url) throw new Error("Không đọc được DIRECT_URL/DATABASE_URL từ .env");
  return url;
}

const db = new PrismaClient({ datasources: { db: { url: resolveDbUrl() } } });

const TEACHER_EMAIL = "giaovien.test@satarobo.vn";
const ADMIN_EMAIL = "admin.local@satarobo.vn";

/** Trạng thái enrollment "đang thuộc lớp" — khớp lib/enrollment-status.ts. */
const ACTIVE_ENROLLMENT = ["ACTIVE", "CONFIRMED", "STUDYING", "PAUSED"] as const;

// File PDF mẫu public (content-type application/pdf, nhúng iframe được).
const PDF_GIAO_AN = "https://pdfobject.com/pdf/sample.pdf";
const PDF_PHIEU_BT = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

/** Date tại giờ VN: hôm nay + `plusDays`, đặt hh:mm. */
function vnDate(plusDays: number, hh: number, mm: number): Date {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const d = new Date(
    `${today}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`,
  );
  d.setDate(d.getDate() + plusDays);
  return d;
}

let qSeq = 0;
const qid = () => `seedpar_q_${(qSeq++).toString(36)}`;

/* ------------------------- Bộ câu hỏi demo (8 loại) ------------------------ */

const Q_TONG_HOP: ContentQuestion[] = [
  {
    id: qid(),
    type: "single",
    question: "Bộ phận nào giúp robot nhận biết vật cản phía trước?",
    options: ["Cảm biến siêu âm", "Động cơ servo", "Còi buzzer", "Đèn LED"],
    correctIndex: 0,
  },
  {
    id: qid(),
    type: "multiple",
    question: "Chọn CÁC thiết bị đầu ra (output) của robot:",
    options: ["Động cơ", "Đèn LED", "Cảm biến ánh sáng", "Còi buzzer"],
    correctIndices: [0, 1, 3],
  },
  {
    id: qid(),
    type: "boolean",
    question: "Khối lặp 'forever' chạy lặp lại mãi cho tới khi tắt chương trình.",
    correct: true,
  },
  {
    id: qid(),
    type: "fill",
    question: "Robot dùng ______ để đo khoảng cách và ______ để di chuyển.",
    answers: ["cảm biến siêu âm", "động cơ"],
  },
  {
    id: qid(),
    type: "short",
    question: "Nêu tên một ngôn ngữ lập trình kéo thả em đã học.",
    sampleAnswer: "Scratch (hoặc Blockly)",
  },
  {
    id: qid(),
    type: "essay",
    question: "Trình bày các bước lắp ráp và kiểm tra một robot tránh vật cản.",
    sampleAnswer:
      "Lắp khung xe → gắn cảm biến siêu âm → nối động cơ → nạp chương trình → chạy thử → hiệu chỉnh khoảng cách dừng.",
  },
  {
    id: qid(),
    type: "matching",
    question: "Ghép mỗi linh kiện với đúng chức năng của nó.",
    pairs: [
      { left: "Cảm biến siêu âm", right: "Đo khoảng cách" },
      { left: "Động cơ servo", right: "Điều khiển góc quay" },
      { left: "Cảm biến ánh sáng", right: "Nhận biết sáng / tối" },
    ],
  },
  {
    id: qid(),
    type: "ordering",
    question: "Sắp xếp các bước làm một dự án robot theo đúng thứ tự.",
    items: [
      "Phân tích yêu cầu",
      "Lắp ráp mô hình",
      "Lập trình điều khiển",
      "Chạy thử & hiệu chỉnh",
    ],
  },
];

const Q_KIEM_TRA_15P: ContentQuestion[] = [
  {
    id: qid(),
    type: "single",
    question: "Cảm biến siêu âm đo khoảng cách bằng cách nào?",
    options: [
      "Phát sóng âm và đo thời gian dội lại",
      "Chụp ảnh vật cản",
      "Đo nhiệt độ môi trường",
      "Phát tia laser",
    ],
    correctIndex: 0,
  },
  {
    id: qid(),
    type: "single",
    question: "Muốn robot rẽ trái tại chỗ, hai bánh xe phải quay thế nào?",
    options: [
      "Bánh trái lùi, bánh phải tiến",
      "Hai bánh cùng tiến",
      "Hai bánh cùng lùi",
      "Bánh trái tiến, bánh phải dừng",
    ],
    correctIndex: 0,
  },
  {
    id: qid(),
    type: "boolean",
    question: "Câu lệnh điều kiện 'nếu... thì...' giúp robot tự ra quyết định.",
    correct: true,
  },
  {
    id: qid(),
    type: "multiple",
    question: "Chọn CÁC trường hợp nên dùng vòng lặp:",
    options: [
      "Nhấp nháy đèn LED 10 lần",
      "Đọc cảm biến liên tục",
      "Đặt tên chương trình",
      "Robot dò đường theo vạch",
    ],
    correctIndices: [0, 1, 3],
  },
];

const Q_GHEP_CAP: ContentQuestion[] = [
  {
    id: qid(),
    type: "matching",
    question: "Ghép khối lệnh với tác dụng của nó.",
    pairs: [
      { left: "repeat 10", right: "Lặp lại 10 lần" },
      { left: "wait 1s", right: "Chờ 1 giây" },
      { left: "if... then", right: "Rẽ nhánh theo điều kiện" },
    ],
  },
  {
    id: qid(),
    type: "ordering",
    question: "Sắp xếp thứ tự nạp chương trình vào robot.",
    items: ["Kết nối cáp/bluetooth", "Chọn chương trình", "Bấm nạp", "Ngắt kết nối và chạy thử"],
  },
  {
    id: qid(),
    type: "fill",
    question: "Trước khi chạy thử, em phải kiểm tra ______ của pin.",
    answers: ["mức năng lượng"],
  },
];

const Q_ADMIN_ON_CHUONG: ContentQuestion[] = [
  {
    id: qid(),
    type: "single",
    question: "Đơn vị đo khoảng cách cảm biến siêu âm trả về thường là gì?",
    options: ["Xăng-ti-mét", "Ki-lô-gam", "Độ C", "Giây"],
    correctIndex: 0,
  },
  {
    id: qid(),
    type: "boolean",
    question: "Robot có thể vừa đi thẳng vừa đọc cảm biến trong cùng một vòng lặp.",
    correct: true,
  },
  {
    id: qid(),
    type: "fill",
    question: "Chương trình điều khiển robot được nạp qua ______ hoặc bluetooth.",
    answers: ["cáp USB"],
  },
  {
    id: qid(),
    type: "short",
    question: "Kể tên một tình huống robot cần dừng khẩn cấp.",
    sampleAnswer: "Sắp va vào vật cản / rơi khỏi mép bàn.",
  },
  {
    id: qid(),
    type: "essay",
    question: "Mô tả cách em kiểm tra robot dò vạch hoạt động đúng.",
    sampleAnswer: "Đặt robot lên sa bàn có vạch đen, quan sát bám vạch qua 2 khúc cua, ghi lại chỗ lệch.",
  },
];

const Q_ADMIN_CUOI_CHUONG: ContentQuestion[] = [
  {
    id: qid(),
    type: "single",
    question: "Khối nào dùng để robot phát âm thanh?",
    options: ["Buzzer/Sound", "Motor", "Wait", "Variable"],
    correctIndex: 0,
  },
  {
    id: qid(),
    type: "multiple",
    question: "Chọn CÁC cảm biến đã học trong chương:",
    options: ["Siêu âm", "Ánh sáng", "Chạm", "GPS"],
    correctIndices: [0, 1, 2],
  },
  {
    id: qid(),
    type: "boolean",
    question: "Biến (variable) dùng để lưu giá trị thay đổi trong lúc chạy.",
    correct: true,
  },
  {
    id: qid(),
    type: "ordering",
    question: "Sắp xếp quy trình xử lý khi robot gặp vật cản.",
    items: ["Đọc cảm biến", "So sánh với ngưỡng", "Dừng động cơ", "Rẽ hướng khác"],
  },
];

/* --------------------------------- Helpers -------------------------------- */

type Tx = Prisma.TransactionClient;

async function createQuestionsWithLinks(
  tx: Tx,
  templateId: string,
  questions: SerializedQuestion[],
  authorId: string | null,
): Promise<void> {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const created = await tx.question.create({
      data: {
        type: q.type,
        text: q.text,
        correctAnswer: q.correctAnswer,
        meta: q.meta,
        isPublic: false,
        authorId,
        ...(q.choices.length > 0
          ? {
              choices: {
                create: q.choices.map((c) => ({
                  order: c.order,
                  text: c.text,
                  isCorrect: c.isCorrect,
                })),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    await tx.assignmentTemplateQuestion.create({
      data: { templateId, questionId: created.id, order: i },
    });
  }
}

async function ensureTemplate(opts: {
  title: string;
  description: string;
  kind: "HOMEWORK" | "CLASSWORK";
  curriculumId: string | null;
  createdById: string;
  authorId: string | null;
  questions: ContentQuestion[];
}): Promise<{ id: string; created: boolean }> {
  const existing = await db.assignmentTemplate.findFirst({
    where: { title: opts.title, createdById: opts.createdById },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const serialized = opts.questions.map(serializeContentQuestion);
  const id = await db.$transaction(async (tx) => {
    const tpl = await tx.assignmentTemplate.create({
      data: {
        title: opts.title,
        description: opts.description,
        kind: opts.kind,
        curriculumId: opts.curriculumId,
        totalPoints: 10,
        allowText: true,
        allowFile: true,
        createdById: opts.createdById,
      },
      select: { id: true },
    });
    await createQuestionsWithLinks(tx, tpl.id, serialized, opts.authorId);
    return tpl.id;
  });
  return { id, created: true };
}

async function ensureAssignment(opts: {
  templateId: string;
  classId: string;
  createdById: string | null; // FK Employee
  timing:
    | { kind: "HOMEWORK"; dueAt: Date; classSessionId: string | null }
    | { kind: "CLASSWORK"; openAt: Date; closeAt: Date };
  /** Đánh dấu N bản nộp đầu roster là ĐÃ NỘP (chỉ khi đang NOT_SUBMITTED). */
  submitCount?: number;
}): Promise<"created" | "skipped"> {
  const dup = await db.assignment.findFirst({
    where: { classId: opts.classId, templateId: opts.templateId },
    select: { id: true },
  });
  if (dup) return "skipped";

  const template = await db.assignmentTemplate.findUnique({
    where: { id: opts.templateId },
    select: {
      id: true,
      title: true,
      description: true,
      instructions: true,
      kind: true,
      lessonId: true,
      totalPoints: true,
      allowText: true,
      allowFile: true,
      templateQuestions: {
        orderBy: { order: "asc" },
        select: {
          question: {
            select: {
              type: true,
              text: true,
              correctAnswer: true,
              meta: true,
              choices: {
                orderBy: { order: "asc" },
                select: { order: true, text: true, isCorrect: true },
              },
            },
          },
        },
      },
    },
  });
  if (!template) throw new Error(`Thiếu template ${opts.templateId}`);

  const roster = await db.enrollment.findMany({
    where: { classId: opts.classId, status: { in: [...ACTIVE_ENROLLMENT] } },
    select: { studentId: true },
    orderBy: { studentId: "asc" },
  });

  await db.$transaction(async (tx) => {
    const created = await tx.assignment.create({
      data: {
        title: template.title,
        description: template.description,
        instructions: template.instructions,
        kind: template.kind,
        classId: opts.classId,
        lessonId: template.lessonId,
        templateId: template.id,
        totalPoints: template.totalPoints,
        allowText: template.allowText,
        allowFile: template.allowFile,
        status: "PUBLISHED",
        createdById: opts.createdById,
        ...(opts.timing.kind === "HOMEWORK"
          ? { dueAt: opts.timing.dueAt, classSessionId: opts.timing.classSessionId }
          : {
              openAt: opts.timing.openAt,
              closeAt: opts.timing.closeAt,
              dueAt: opts.timing.closeAt, // 2-phase: màn cũ đọc dueAt
            }),
      },
      select: { id: true },
    });

    // Clone câu hỏi (kèm meta) — cùng semantics assignTemplateAction.
    for (const { question: q } of template.templateQuestions) {
      await tx.question.create({
        data: {
          type: q.type,
          text: q.text,
          correctAnswer: q.correctAnswer,
          meta: (q.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          isPublic: false,
          assignmentId: created.id,
          choices: {
            create: q.choices.map((c) => ({
              order: c.order,
              text: c.text,
              isCorrect: c.isCorrect,
            })),
          },
        },
      });
    }

    if (roster.length > 0) {
      await tx.assignmentSubmission.createMany({
        data: roster.map((e) => ({
          assignmentId: created.id,
          studentId: e.studentId,
          status: "NOT_SUBMITTED" as const,
        })),
        skipDuplicates: true,
      });
      // Vài bản nộp mẫu để chấm thử — CHỈ đổi bản đang NOT_SUBMITTED.
      const n = Math.min(opts.submitCount ?? 0, roster.length);
      for (let i = 0; i < n; i++) {
        await tx.assignmentSubmission.updateMany({
          where: {
            assignmentId: created.id,
            studentId: roster[i]!.studentId,
            status: "NOT_SUBMITTED",
          },
          data: {
            status: "SUBMITTED",
            submittedAt: vnDate(0, 8, 30 + i),
            textAnswer:
              "Em đã hoàn thành bài trên lớp, phần lắp ráp làm cùng nhóm; em nộp thêm mô tả các bước ở đây ạ.",
          },
        });
      }
    }
  });
  return "created";
}

/* ---------------------------------- Main ----------------------------------- */

async function main() {
  const teacher = await db.user.findUnique({
    where: { email: TEACHER_EMAIL },
    select: { id: true, employeeId: true },
  });
  if (!teacher) throw new Error(`Thiếu tài khoản GV ${TEACHER_EMAIL} — chạy seed-test-teacher trước.`);
  const ownerId = teacher.employeeId ?? teacher.id;

  const admin = await db.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, employeeId: true },
  });
  const adminCreatedBy = admin?.employeeId ?? admin?.id ?? "SEED-PAR-ADMIN";
  const adminAuthorId = admin?.employeeId ?? null;

  // Lớp GV phụ trách (khớp resolveActor: teacherId/assistantId = User.id).
  const classes = await db.class.findMany({
    where: {
      deletedAt: null,
      OR: [{ teacherId: teacher.id }, { assistantId: teacher.id }],
    },
    select: { id: true, name: true, courseId: true, course: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  if (classes.length === 0) throw new Error("GV test chưa được gán lớp nào.");

  const courseIds = [...new Set(classes.map((c) => c.courseId).filter((x): x is string => !!x))];
  const curriculumByCourse = new Map<string, string>();
  for (const courseId of courseIds) {
    const cur = await db.curriculum.findFirst({
      where: { courseId, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (cur) curriculumByCourse.set(courseId, cur.id);
  }

  const course1 = courseIds[0] ?? null;
  const course2 = courseIds[1] ?? null;
  const cur1 = course1 ? (curriculumByCourse.get(course1) ?? null) : null;
  const cur2 = course2 ? (curriculumByCourse.get(course2) ?? null) : null;

  console.log(
    `GV ${TEACHER_EMAIL}: ${classes.length} lớp, ${courseIds.length} khoá (curriculum ACTIVE: ${curriculumByCourse.size}).`,
  );

  // ── 1) Kho của tôi ──────────────────────────────────────────────────────────
  const tplTongHop = await ensureTemplate({
    title: "Ôn tập tổng hợp — đủ 8 dạng câu hỏi",
    description: "Đề demo trộn đủ 8 loại: trắc nghiệm 1/nhiều đáp án, Đúng/Sai, điền khuyết, trả lời ngắn, tự luận, ghép cặp, sắp xếp.",
    kind: "HOMEWORK",
    curriculumId: cur1,
    createdById: ownerId,
    authorId: teacher.employeeId ?? null,
    questions: Q_TONG_HOP,
  });
  const tplKiemTra = await ensureTemplate({
    title: "Kiểm tra 15 phút — Cảm biến & vòng lặp",
    description: "4 câu chấm tự động cho bài kiểm tra nhanh đầu giờ.",
    kind: "CLASSWORK",
    curriculumId: cur1,
    createdById: ownerId,
    authorId: teacher.employeeId ?? null,
    questions: Q_KIEM_TRA_15P,
  });
  const tplGhepCap = await ensureTemplate({
    title: "Bài về nhà — Khối lệnh & quy trình nạp",
    description: "Ghép cặp khối lệnh, sắp xếp quy trình nạp chương trình.",
    kind: "HOMEWORK",
    curriculumId: cur2 ?? null, // khoá 2 nếu có, không thì dùng chung mọi khoá
    createdById: ownerId,
    authorId: teacher.employeeId ?? null,
    questions: Q_GHEP_CAP,
  });

  // ── 2) Thư viện admin ───────────────────────────────────────────────────────
  const admOnChuong = await ensureTemplate({
    title: "Mẫu trung tâm — Ôn chương: Chuyển động robot",
    description: "Mẫu Đào tạo cài sẵn (đã số hoá 5 câu) — GV chọn để giao nhanh.",
    kind: "HOMEWORK",
    curriculumId: cur1,
    createdById: adminCreatedBy,
    authorId: adminAuthorId,
    questions: Q_ADMIN_ON_CHUONG,
  });
  const admCuoiChuong = await ensureTemplate({
    title: "Mẫu trung tâm — Kiểm tra cuối chương (45 phút)",
    description: "Bài kiểm tra cuối chương, 4 câu chấm tự động.",
    kind: "CLASSWORK",
    curriculumId: cur1,
    createdById: adminCreatedBy,
    authorId: adminAuthorId,
    questions: Q_ADMIN_CUOI_CHUONG,
  });
  const admDuAn = await ensureTemplate({
    title: "Mẫu trung tâm — Dự án: Robot phục vụ thư viện (chưa số hoá)",
    description:
      "Học viên làm việc nhóm 2-3 bạn: thiết kế robot vận chuyển sách giữa các kệ. Đề chi tiết phát trên lớp — mẫu này chưa số hoá câu hỏi, GV vẫn giao được cho lớp.",
    kind: "HOMEWORK",
    curriculumId: cur1,
    createdById: adminCreatedBy,
    authorId: adminAuthorId,
    questions: [],
  });

  console.log(
    `Templates: kho ${[tplTongHop, tplKiemTra, tplGhepCap].filter((t) => t.created).length}/3 mới · thư viện ${[admOnChuong, admCuoiChuong, admDuAn].filter((t) => t.created).length}/3 mới.`,
  );

  // ── 3) Bài đã giao ─────────────────────────────────────────────────────────
  const class1 = classes[0]!;
  const class2 = classes[1] ?? null;

  // Buổi gắn bài: ưu tiên buổi sắp tới của lớp, không có thì buổi gần nhất đã qua.
  const upcoming = await db.classSession.findFirst({
    where: { classId: class1.id, status: { not: "CANCELLED" }, date: { gte: new Date() } },
    orderBy: { date: "asc" },
    select: { id: true },
  });
  const recent =
    upcoming ??
    (await db.classSession.findFirst({
      where: { classId: class1.id, status: { not: "CANCELLED" } },
      orderBy: { date: "desc" },
      select: { id: true },
    }));

  const a1 = await ensureAssignment({
    templateId: tplTongHop.id,
    classId: class1.id,
    createdById: teacher.employeeId ?? null,
    timing: { kind: "HOMEWORK", dueAt: vnDate(7, 23, 59), classSessionId: recent?.id ?? null },
    submitCount: 2,
  });
  const a2 = await ensureAssignment({
    templateId: admCuoiChuong.id,
    classId: class1.id,
    createdById: teacher.employeeId ?? null,
    timing: { kind: "CLASSWORK", openAt: vnDate(1, 19, 0), closeAt: vnDate(1, 19, 45) },
  });
  let a3 = "skipped";
  if (class2) {
    a3 = await ensureAssignment({
      templateId: tplKiemTra.id,
      classId: class2.id,
      createdById: teacher.employeeId ?? null,
      timing: { kind: "CLASSWORK", openAt: vnDate(3, 18, 0), closeAt: vnDate(3, 18, 45) },
    });
  }
  console.log(`Bài đã giao: ${class1.name} [${a1}, ${a2}]${class2 ? ` · ${class2.name} [${a3}]` : ""}.`);

  // ── 4) Tài liệu theo buổi (Document) ───────────────────────────────────────
  let docCount = 0;
  for (const courseId of courseIds) {
    const curId = curriculumByCourse.get(courseId);
    if (!curId) continue;
    const lessons = await db.lesson.findMany({
      where: { curriculumId: curId, archivedAt: null },
      orderBy: { order: "asc" },
      select: { id: true, order: true, title: true },
      take: 16,
    });
    const tail = courseId.slice(-6);
    for (const l of lessons) {
      await db.document.upsert({
        where: { documentCode: `SEED-PAR-${tail}-GA-${l.order}` },
        update: {},
        create: {
          documentCode: `SEED-PAR-${tail}-GA-${l.order}`,
          title: `Giáo án — Bài ${l.order}: ${l.title}`,
          description: "Giáo án PDF demo (seed parity 18/08).",
          type: "PDF",
          fileUrl: PDF_GIAO_AN,
          fileName: `giao-an-buoi-${l.order}.pdf`,
          fileSize: 18_810,
          mimeType: "application/pdf",
          lessonId: l.id,
          uploadedById: adminAuthorId,
          tags: ["seed-parity"],
        },
      });
      docCount++;
      // Phiếu bài tập cho ~nửa số buổi (buổi lẻ) — để bảng có ô trống tự nhiên.
      if (l.order % 2 === 1) {
        await db.document.upsert({
          where: { documentCode: `SEED-PAR-${tail}-BT-${l.order}` },
          update: {},
          create: {
            documentCode: `SEED-PAR-${tail}-BT-${l.order}`,
            title: `Phiếu bài tập — Bài ${l.order}`,
            description: "Phiếu bài tập về nhà demo (seed parity 18/08).",
            type: "WORKSHEET",
            fileUrl: PDF_PHIEU_BT,
            fileName: `phieu-bai-tap-buoi-${l.order}.pdf`,
            fileSize: 13_264,
            mimeType: "application/pdf",
            lessonId: l.id,
            uploadedById: adminAuthorId,
            tags: ["seed-parity"],
          },
        });
        docCount++;
      }
    }
  }
  console.log(`Tài liệu: upsert ${docCount} Document (giáo án + phiếu bài tập).`);
}

main()
  .then(() => {
    console.log("✅ seed-parity-baitap xong.");
  })
  .catch((e) => {
    console.error("❌ seed-parity-baitap lỗi:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
