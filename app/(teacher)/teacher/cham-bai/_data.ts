// app/(teacher)/teacher/cham-bai/_data.ts — loader server dùng chung cho trang
// "Bài tập & kiểm tra" (3 tab), route /teacher/kho-bai-tap và tab Bài tập của Class
// Hub (parity 18/08). Server-only: deserialize câu hỏi thành ContentQuestion rồi
// truyền plain data xuống client.
//
// "Kho của tôi" = createdById === ownerId; "Thư viện admin" = phần còn lại, lọc theo
// khoá GV phụ trách (đề không gắn khoá hiện với mọi người — giữ hành vi cũ).
import type { Prisma } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { deserializeQuestionRow } from "@/lib/assignments/question-content-db";
import {
  assignmentWindow,
  assignmentWindowLabel,
  formatVnShort,
  realDueAt,
  toVnDateTimeInput,
  type AssignmentWindowInput,
  type AssignmentWindowState,
} from "@/lib/lms/assignment-window";
import type { KhoCourseOption, KhoTemplate } from "../kho-bai-tap/_types";

const dateFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

const sessionFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

type Sdb = ReturnType<typeof scopedDb>;

// ── Cửa nộp bài cho MÀN GV (25/08) ──────────────────────────────────────────
// Dựng ở ĐÂY (server) chứ không ở component, vì hai bảng bài tập — trang
// /teacher/cham-bai và tab Bài tập của Class Hub — phải nói y hệt nhau, và vì mọi
// chuỗi giờ phải theo ĐỒNG HỒ VN: client tự đổi thì máy đặt lệch múi giờ sẽ gửi lên
// một mốc khác cái GV nhìn thấy (server đọc chuỗi datetime-local là +07:00).

const MS_NGAY = 86_400_000;
/** Cửa nộp bù gợi ý sẵn khi GV bấm mở — GV sửa lại được. */
const NGAY_GIA_HAN_MAC_DINH = 3;

/** Dữ liệu cột "Trạng thái" + "Hạn nộp" + dialog gia hạn của MỘT dòng bài tập. */
export interface AssignmentWindowView {
  state: AssignmentWindowState;
  /** Nhãn pill đã kèm mốc giờ: "Nộp trễ đến 23/08 23:59". */
  label: string;
  /** Hạn nộp gốc "dd/MM/yyyy"; null = không đặt hạn (gồm cả bài seed để epoch 1970). */
  dueText: string | null;
  /** Mốc nộp bù ĐANG mở ("23/08 23:59"); null = không có cửa gia hạn nào đang chạy. */
  lateUntilText: string | null;
  /** Lý do GV ghi khi mở cửa nộp bù (hiện lại trong dialog). */
  lateReason: string | null;
  /** Bài đã đóng hoặc đang mở nộp bù → cho hiện nút gia hạn. */
  canExtend: boolean;
  /** Prefill ô `datetime-local` ("YYYY-MM-DDTHH:mm" giờ VN). */
  suggestedInput: string;
  /** Chặn dưới của ô `datetime-local` — luôn sau cả `now` lẫn hạn nộp gốc. */
  minInput: string;
}

/**
 * Suy trạng thái hiển thị của 1 bài tập tại thời điểm render.
 *
 * ⚠️ Ảnh chụp tại LÚC RENDER: trang mở sẵn qua mốc hạn sẽ hiện nhãn cũ cho tới lần tải
 * lại. Chấp nhận được vì cổng nộp bài của PH tự hỏi lại `assignmentWindow()` mỗi lần
 * nộp — nhãn cũ không bao giờ mở được cửa nộp thật.
 */
export function buildAssignmentWindowView(
  a: AssignmentWindowInput & { lateReason?: string | null },
  now: Date = new Date(),
): AssignmentWindowView {
  const w = assignmentWindow(a, now);
  // Đi qua ĐÚNG bộ lọc epoch 1970 của assignmentWindow (không gõ lại `Date.UTC(2000,…)`
  // ở đây): in "01/01/1970" ở cột Hạn nộp là bug cũ của màn này, và một bản sao bộ lọc
  // là một chỗ nữa để nó quay lại.
  const hanGoc = realDueAt(a.dueAt);
  const dueText = hanGoc ? dateFmt.format(hanGoc) : null;

  const sanNhoNhat = Math.max(now.getTime(), hanGoc?.getTime() ?? 0) + 60_000;
  const goiY =
    w.state === "late-open" && a.lateUntil
      ? a.lateUntil
      : new Date(Math.max(now.getTime() + NGAY_GIA_HAN_MAC_DINH * MS_NGAY, sanNhoNhat));

  return {
    state: w.state,
    label: assignmentWindowLabel(w),
    dueText,
    lateUntilText: w.state === "late-open" && w.until ? formatVnShort(w.until) : null,
    // Chỉ trả lý do khi cửa gia hạn CÒN chạy: lý do của lần gia hạn đã hết hạn mà hiện
    // lại trong ô "vì sao mở" là mời GV bấm Lưu với lý do của lần trước.
    lateReason: w.state === "late-open" ? (a.lateReason ?? null) : null,
    canExtend: w.state === "closed" || w.state === "late-open",
    suggestedInput: toVnDateTimeInput(goiY),
    minInput: toVnDateTimeInput(new Date(sanNhoNhat)),
  };
}

/** Lớp GV có thể giao bài (kèm khoá + sĩ số cho dialog Giao bài). */
export interface AssignClassOption {
  id: string;
  name: string;
  courseId: string | null;
  courseName: string | null;
  studentCount: number;
}

/** Buổi học sắp tới của lớp — gắn bài vào buổi (không bắt buộc). */
export interface AssignSessionOption {
  id: string;
  classId: string;
  /** "dd/MM · chủ đề" — đã format server để client hiển thị thẳng. */
  label: string;
}

export interface TeacherAssignData {
  classes: AssignClassOption[];
  sessions: AssignSessionOption[];
  courses: KhoCourseOption[];
  /** Đề GV tự soạn (đầy đủ câu hỏi — dùng cho preview + sửa). */
  mine: KhoTemplate[];
  /** Thư viện admin/Đào tạo cho các khoá GV phụ trách (đọc-only với GV). */
  library: KhoTemplate[];
}

const TEMPLATE_SELECT = {
  id: true,
  title: true,
  description: true,
  kind: true,
  totalPoints: true,
  createdAt: true,
  createdById: true,
  curriculum: {
    select: { courseId: true, course: { select: { name: true } } },
  },
  templateQuestions: {
    orderBy: { order: "asc" as const },
    select: {
      question: {
        select: {
          id: true,
          type: true,
          text: true,
          correctAnswer: true,
          meta: true,
          choices: {
            orderBy: { order: "asc" as const },
            select: { order: true, text: true, isCorrect: true },
          },
        },
      },
    },
  },
} as const;

type TemplateRow = Prisma.AssignmentTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

function toKhoTemplate(t: TemplateRow): KhoTemplate {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    kind: t.kind,
    courseId: t.curriculum?.courseId ?? null,
    courseName: t.curriculum?.course?.name ?? null,
    totalPoints: t.totalPoints,
    questionCount: t.templateQuestions.length,
    createdAt: dateFmt.format(t.createdAt),
    questions: t.templateQuestions.map((tq) => deserializeQuestionRow(tq.question)),
  };
}

/**
 * Tải toàn bộ dữ liệu cho trang Bài tập & kiểm tra + dialog Giao bài.
 * `lockClassId` (từ Class Hub) khoá danh sách lớp về đúng 1 lớp.
 */
export async function loadTeacherAssignData(
  sdb: Sdb,
  opts: {
    ownerId: string;
    classIds: string[];
    lockClassId?: string | null;
  },
): Promise<TeacherAssignData> {
  const { ownerId, classIds } = opts;
  const visibleClassIds =
    opts.lockClassId && classIds.includes(opts.lockClassId)
      ? [opts.lockClassId]
      : classIds;

  // GV chưa có lớp: vẫn thấy KHO CỦA MÌNH (soạn trước), chỉ trống lớp/buổi/thư viện.
  const [classRows, sessionRows, mineRows, libraryRows] = await Promise.all([
    visibleClassIds.length
      ? sdb.class.findMany({
          where: { id: { in: visibleClassIds } },
          select: {
            id: true,
            name: true,
            courseId: true,
            course: { select: { name: true } },
            // Dialog "Giao bài" giữ "dang-hoc" — đây là sĩ số để chọn lớp giao bài
            // MỚI, không phải mẫu số của bài đã giao.
            _count: {
              select: { enrollments: { where: rosterWhere("dang-hoc") } },
            },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    // Buổi từ 7 ngày trước tới tương lai (giao bài cho buổi vừa dạy vẫn tiện).
    visibleClassIds.length
      ? sdb.classSession.findMany({
          where: {
            classId: { in: visibleClassIds },
            status: { not: "CANCELLED" },
            date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true, classId: true, date: true, topic: true },
          orderBy: { date: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
    // 2 truy vấn tách pool: kho CỦA MÌNH không bao giờ bị đề người khác chiếm chỗ
    // trong giới hạn take (kho đầy vẫn hiện đủ đề của GV).
    sdb.assignmentTemplate.findMany({
      where: { createdById: ownerId },
      select: TEMPLATE_SELECT,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    sdb.assignmentTemplate.findMany({
      // createdById null (mẫu hệ thống/không dấu vết) vẫn thuộc thư viện —
      // `not` của Prisma loại null nên phải OR tường minh.
      where: {
        OR: [{ createdById: null }, { createdById: { not: ownerId } }],
      },
      select: TEMPLATE_SELECT,
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  // Khoá của các lớp GV phụ trách — nguồn cho ô "Khoá học" khi soạn đề + lọc thư viện.
  const courseById = new Map<string, string>();
  for (const c of classRows) {
    if (c.courseId && c.course) courseById.set(c.courseId, c.course.name);
  }

  const mine: KhoTemplate[] = mineRows.map(toKhoTemplate);
  // Thư viện: chỉ mẫu thuộc khoá GV phụ trách (mẫu không gắn khoá hiện với mọi người).
  const library: KhoTemplate[] = libraryRows
    .map(toKhoTemplate)
    .filter((t) => t.courseId === null || courseById.has(t.courseId));

  return {
    classes: classRows.map((c) => ({
      id: c.id,
      name: c.name,
      courseId: c.courseId,
      courseName: c.course?.name ?? null,
      studentCount: c._count.enrollments,
    })),
    sessions: sessionRows.map((s) => ({
      id: s.id,
      classId: s.classId,
      label: `${sessionFmt.format(s.date)} · ${s.topic?.trim() || "Buổi học"}`,
    })),
    courses: [...courseById.entries()].map(([id, name]) => ({ id, name })),
    mine,
    library,
  };
}
