// lib/assignments/question-content.ts — "đầu bài trộn nhiều loại câu hỏi" (parity site GV 18/08).
//
// Nguồn sự thật cho 8 loại câu hỏi soạn đề, port 1:1 từ satarobo-ui-giaovien
// (src/types + src/lib/assignment-questions.ts). Thuần TS, KHÔNG import zod/prisma
// — dùng được cả client (editor/preview) lẫn server. Ánh xạ sang bảng Question
// nằm ở question-content-db.ts (server-only).

/**
 * Loại câu hỏi trong một đầu bài. Một đầu bài có thể trộn nhiều loại.
 * - `single`   : trắc nghiệm chọn 1 đáp án đúng
 * - `multiple` : trắc nghiệm chọn nhiều đáp án đúng
 * - `boolean`  : Đúng / Sai
 * - `fill`     : điền vào chỗ trống (mỗi ô một đáp án)
 * - `short`    : trả lời ngắn (chấm tay)
 * - `essay`    : tự luận (chấm tay)
 * - `matching` : ghép cặp trái ↔ phải
 * - `ordering` : sắp xếp các mục theo đúng thứ tự
 * - `video`    : học viên trả lời bằng MỘT VIDEO (chấm tay; không giới hạn độ dài — chủ dự án 12/11/2026)
 */
export type ContentQuestionType =
  | "single"
  | "multiple"
  | "boolean"
  | "fill"
  | "short"
  | "essay"
  | "matching"
  | "ordering"
  | "video";

interface BaseQuestion {
  id: string;
  type: ContentQuestionType;
  /** Nội dung / đề của câu hỏi. */
  question: string;
}

/** Chọn 1 đáp án đúng. `correctIndex` trỏ vào `options`. */
export interface SingleChoiceQuestion extends BaseQuestion {
  type: "single";
  options: string[];
  correctIndex: number;
}

/** Chọn nhiều đáp án đúng. `correctIndices` là tập chỉ số đúng trong `options`. */
export interface MultipleChoiceQuestion extends BaseQuestion {
  type: "multiple";
  options: string[];
  correctIndices: number[];
}

/** Đúng / Sai. `correct === true` nghĩa là mệnh đề đúng. */
export interface BooleanQuestion extends BaseQuestion {
  type: "boolean";
  correct: boolean;
}

/**
 * Điền vào chỗ trống. Đề dùng dấu `______` cho mỗi chỗ trống; `answers` là đáp
 * án đúng cho từng chỗ trống theo thứ tự xuất hiện.
 */
export interface FillBlankQuestion extends BaseQuestion {
  type: "fill";
  answers: string[];
}

/** Trả lời ngắn - giáo viên chấm tay. `sampleAnswer` là đáp án gợi ý. */
export interface ShortAnswerQuestion extends BaseQuestion {
  type: "short";
  sampleAnswer?: string;
}

/** Tự luận - giáo viên chấm tay. `question` chính là đề bài. */
export interface EssayQuestion extends BaseQuestion {
  type: "essay";
  sampleAnswer?: string;
}

/** Ghép cặp. Đáp án đúng: `pairs[i].left` ↔ `pairs[i].right`. */
export interface MatchingQuestion extends BaseQuestion {
  type: "matching";
  pairs: { left: string; right: string }[];
}

/** Sắp xếp thứ tự. `items` đã ở đúng thứ tự cần đạt. */
export interface OrderingQuestion extends BaseQuestion {
  type: "ordering";
  items: string[];
}

/**
 * Nộp video — đáp án của câu là một video học viên quay/tải lên; thầy cô xem và chấm tay.
 * KHÔNG có độ dài tối thiểu/tối đa (chủ dự án 12/11/2026). `question` là đề bài ("Quay video giới thiệu robot của em").
 */
export interface VideoQuestion extends BaseQuestion {
  type: "video";
}

export type ContentQuestion =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | BooleanQuestion
  | FillBlankQuestion
  | ShortAnswerQuestion
  | EssayQuestion
  | MatchingQuestion
  | OrderingQuestion
  | VideoQuestion;

/**
 * Metadata mô tả từng loại câu hỏi: nhãn tiếng Việt, gợi ý ngắn và ví dụ. Dùng
 * chung cho ô chọn loại câu hỏi ở dialog tạo bài và các nhãn hiển thị.
 */
export const QUESTION_TYPE_META: Record<
  ContentQuestionType,
  { label: string; hint: string; example: string }
> = {
  single: {
    label: "Chọn 1 đáp án",
    hint: "Trắc nghiệm một đáp án đúng",
    example: "A, B, C, D — chọn 1",
  },
  multiple: {
    label: "Chọn nhiều đáp án",
    hint: "Trắc nghiệm nhiều đáp án đúng",
    example: "Chọn A và C",
  },
  boolean: {
    label: "Đúng / Sai",
    hint: "Một mệnh đề, chọn Đúng hoặc Sai",
    example: "Java là ngôn ngữ lập trình. → Đúng",
  },
  fill: {
    label: "Điền vào chỗ trống",
    hint: "Dùng ______ cho mỗi chỗ cần điền",
    example: "HTML là viết tắt của ______",
  },
  short: {
    label: "Trả lời ngắn",
    hint: "Học viên gõ câu trả lời ngắn (chấm tay)",
    example: "AI là gì?",
  },
  essay: {
    label: "Tự luận",
    hint: "Học viên viết bài dài (chấm tay)",
    example: "Trình bày quy trình phát triển phần mềm",
  },
  matching: {
    label: "Ghép cặp",
    hint: "Ghép mỗi mục bên trái với một mục bên phải",
    example: "Ghép thuật ngữ với định nghĩa",
  },
  ordering: {
    label: "Sắp xếp thứ tự",
    hint: "Sắp các mục theo đúng trình tự",
    example: "Sắp xếp các bước lập trình",
  },
  video: {
    label: "Nộp video",
    hint: "Học viên quay hoặc tải video làm đáp án (chấm tay, không giới hạn độ dài)",
    example: "Quay video giới thiệu robot của em",
  },
};

/** Thứ tự hiển thị các loại trong ô chọn loại câu hỏi. */
export const QUESTION_TYPE_ORDER: ContentQuestionType[] = [
  "single",
  "multiple",
  "boolean",
  "fill",
  "short",
  "essay",
  "matching",
  "ordering",
  "video",
];

/** Các loại chấm được tự động. Còn lại (`short`, `essay`, `video`) giáo viên chấm tay. */
export function isAutoGraded(type: ContentQuestionType): boolean {
  return type !== "short" && type !== "essay" && type !== "video";
}

/**
 * Đầu bài có câu nộp video ⇒ bài giao ra BẮT BUỘC học viên đính kèm video (`Assignment.requireVideo`).
 * Nhận cả `ContentQuestion.type` ("video") lẫn `Question.type` ở DB ("VIDEO") — hai nơi gọi dùng hai dạng.
 */
export function coCauNopVideo(questions: readonly { type: string }[]): boolean {
  return questions.some((q) => q.type === "video" || q.type === "VIDEO");
}

/**
 * Ghép ĐỀ BÀI của các câu video vào phần hướng dẫn của bài giao.
 * Vì sao: cổng phụ huynh/học sinh KHÔNG bao giờ đọc bảng Question (luật tầng PH — lib/portal/learning.ts), nên đề của câu video
 * ("Quay video giới thiệu robot của em…") sẽ không tới được học viên nếu không đi theo `Assignment.instructions`.
 */
export function ghepDeBaiVideo(
  instructions: string | null | undefined,
  questions: readonly { type: string; text: string }[],
): string | null {
  const de = questions.filter((q) => q.type === "VIDEO" || q.type === "video").map((q) => q.text.trim()).filter(Boolean);
  const goc = instructions?.trim() || "";
  if (de.length === 0) return goc || null;
  const khoi = `Yêu cầu nộp video:\n${de.map((t) => `• ${t}`).join("\n")}`;
  return goc ? `${goc}\n\n${khoi}` : khoi;
}

/** Một câu hỏi rỗng theo loại, sẵn giá trị mặc định hợp lý để chỉnh tiếp. */
export function blankQuestion(type: ContentQuestionType, id: string): ContentQuestion {
  switch (type) {
    case "single":
      return { id, type, question: "", options: ["", "", "", ""], correctIndex: 0 };
    case "multiple":
      return { id, type, question: "", options: ["", "", "", ""], correctIndices: [] };
    case "boolean":
      return { id, type, question: "", correct: true };
    case "fill":
      return { id, type, question: "", answers: [""] };
    case "short":
      return { id, type, question: "", sampleAnswer: "" };
    case "essay":
      return { id, type, question: "", sampleAnswer: "" };
    case "matching":
      return {
        id,
        type,
        question: "",
        pairs: [
          { left: "", right: "" },
          { left: "", right: "" },
        ],
      };
    case "ordering":
      return { id, type, question: "", items: ["", ""] };
    case "video":
      return { id, type, question: "" };
  }
}

/** Số chỗ trống `______` trong đề của câu điền khuyết (tối thiểu 1). */
export function countBlanks(question: string): number {
  const matches = question.match(/_{2,}/g);
  return Math.max(1, matches?.length ?? 0);
}

/** Bản sao sâu vừa đủ để chỉnh sửa mà không đụng vào template gốc. */
export function cloneQuestion(q: ContentQuestion): ContentQuestion {
  switch (q.type) {
    case "single":
      return { ...q, options: [...q.options] };
    case "multiple":
      return { ...q, options: [...q.options], correctIndices: [...q.correctIndices] };
    case "fill":
      return { ...q, answers: [...q.answers] };
    case "matching":
      return { ...q, pairs: q.pairs.map((p) => ({ ...p })) };
    case "ordering":
      return { ...q, items: [...q.items] };
    default:
      return { ...q };
  }
}

/** Trần số đáp án/cặp/mục/chỗ trống mỗi câu — khớp zod server (question-content-db). */
export const MAX_OPTIONS = 10;
/** Trần số câu hỏi mỗi đầu bài — khớp zod server. */
export const MAX_QUESTIONS = 50;

/** Trả về thông báo lỗi nếu câu hỏi chưa hợp lệ, hoặc `null` nếu ổn. */
export function validateQuestion(q: ContentQuestion, n: number): string | null {
  if (!q.question.trim()) return `Câu ${n}: chưa nhập nội dung câu hỏi`;
  switch (q.type) {
    case "single": {
      const filled = q.options.filter((o) => o.trim());
      if (filled.length < 2) return `Câu ${n}: cần ít nhất 2 đáp án`;
      if (q.options.length > MAX_OPTIONS) return `Câu ${n}: tối đa ${MAX_OPTIONS} đáp án`;
      if (!q.options[q.correctIndex]?.trim()) return `Câu ${n}: đáp án đúng đang để trống`;
      return null;
    }
    case "multiple": {
      const filled = q.options.filter((o) => o.trim());
      if (filled.length < 2) return `Câu ${n}: cần ít nhất 2 đáp án`;
      if (q.options.length > MAX_OPTIONS) return `Câu ${n}: tối đa ${MAX_OPTIONS} đáp án`;
      const valid = q.correctIndices.filter((i) => q.options[i]?.trim());
      if (valid.length === 0) return `Câu ${n}: hãy đánh dấu ít nhất 1 đáp án đúng`;
      return null;
    }
    case "boolean":
      return null;
    case "fill": {
      const count = countBlanks(q.question);
      if (count > MAX_OPTIONS) return `Câu ${n}: tối đa ${MAX_OPTIONS} chỗ trống`;
      for (let i = 0; i < count; i++) {
        if (!q.answers[i]?.trim()) return `Câu ${n}: chỗ trống ${i + 1} chưa có đáp án`;
      }
      return null;
    }
    case "short":
    case "essay":
    case "video":
      return null;
    case "matching": {
      const filled = q.pairs.filter((p) => p.left.trim() && p.right.trim());
      if (filled.length < 2) return `Câu ${n}: cần ít nhất 2 cặp ghép hoàn chỉnh`;
      if (q.pairs.length > MAX_OPTIONS) return `Câu ${n}: tối đa ${MAX_OPTIONS} cặp ghép`;
      return null;
    }
    case "ordering": {
      const filled = q.items.filter((it) => it.trim());
      if (filled.length < 2) return `Câu ${n}: cần ít nhất 2 mục để sắp xếp`;
      if (q.items.length > MAX_OPTIONS) return `Câu ${n}: tối đa ${MAX_OPTIONS} mục`;
      return null;
    }
  }
}

/** Bỏ ô trống, chuẩn hoá lại chỉ số đáp án đúng trước khi lưu vào kho. */
export function cleanQuestion(q: ContentQuestion): ContentQuestion {
  const question = q.question.trim();
  switch (q.type) {
    case "single": {
      const keep = q.options
        .map((text, i) => ({ text: text.trim(), i }))
        .filter((o) => o.text);
      return {
        ...q,
        question,
        options: keep.map((o) => o.text),
        correctIndex: Math.max(0, keep.findIndex((o) => o.i === q.correctIndex)),
      };
    }
    case "multiple": {
      const keep = q.options
        .map((text, i) => ({ text: text.trim(), i }))
        .filter((o) => o.text);
      const correctIndices = keep
        .map((o, newIdx) => ({ newIdx, was: q.correctIndices.includes(o.i) }))
        .filter((x) => x.was)
        .map((x) => x.newIdx);
      return { ...q, question, options: keep.map((o) => o.text), correctIndices };
    }
    case "boolean":
      return { ...q, question };
    case "fill": {
      const count = countBlanks(question);
      return {
        ...q,
        question,
        answers: Array.from({ length: count }, (_, i) => (q.answers[i] ?? "").trim()),
      };
    }
    case "short":
    case "essay":
      return { ...q, question, sampleAnswer: q.sampleAnswer?.trim() || undefined };
    case "matching":
      return {
        ...q,
        question,
        pairs: q.pairs
          .map((p) => ({ left: p.left.trim(), right: p.right.trim() }))
          .filter((p) => p.left && p.right),
      };
    case "ordering":
      return {
        ...q,
        question,
        items: q.items.map((it) => it.trim()).filter(Boolean),
      };
    case "video":
      return { ...q, question };
  }
}

/** Tổng kết một đầu bài: bao nhiêu câu chấm tự động / chấm tay. */
export function autoGradeCounts(questions: readonly ContentQuestion[]): {
  autoCount: number;
  manualCount: number;
} {
  let autoCount = 0;
  for (const q of questions) if (isAutoGraded(q.type)) autoCount += 1;
  return { autoCount, manualCount: questions.length - autoCount };
}
