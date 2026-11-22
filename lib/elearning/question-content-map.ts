import type { ContentQuestion } from "@/lib/assignments/question-content";

/**
 * EL-14 — DỊCH nội dung câu hỏi sang KHUÔN DÙNG CHUNG.
 *
 * ⚠️ TỆP NÀY SINH RA TỪ MỘT LỖI CHẶN ĐỨNG CẢ CHUỖI.
 *
 * Kho câu hỏi ghi `TrnQuestion.contentJson` theo hình dạng của riêng nó —
 * `{ type: "SINGLE", choices: [{text, isCorrect}] }` — trong khi đường thi đọc cột
 * đó bằng `cueInlineSchema`, tức `contentQuestionSchema`: một union phân biệt theo
 * `type` VIẾT THƯỜNG, và đòi `id` · `question` · `options` · `correctIndex`.
 *
 * Không một câu nào parse được. Hệ quả kép, cả hai đều CÂM:
 *  · trang thi cho `luaChon: []` ⇒ người học thấy đề bài mà KHÔNG có nút nào để
 *    bấm — không cách nào trả lời;
 *  · đường chấm cho `cau = null` ⇒ mọi câu rơi vào nhánh "chuyển người chấm" ⇒ lượt
 *    đóng ở `PENDING_GRADE`, `passed` mãi `null`, bài không bao giờ xong, và người
 *    học đứng nguyên tại một bài nghĩa vụ có hạn chót cứng.
 *
 * Không gì bắt được: `contentJson` khai `Json` nên TypeScript không nối writer với
 * reader, và bộ test dựng fixture TAY theo khuôn reader — một tổ hợp DB không bao
 * giờ tạo ra được. Nên tệp này đi kèm một test chạy ĐẦU RA CỦA WRITER qua ĐÚNG
 * KHUÔN CỦA READER; đó là phép kiểm duy nhất bắt được lớp lỗi này.
 *
 * ⚠️ `TRUE_FALSE` dịch sang `single`, KHÔNG sang `boolean`. Khuôn `boolean` sinh mã
 * lựa chọn là chuỗi `"true"`/`"false"`, mà đường lưu câu trả lời chỉ nhận CHỈ SỐ —
 * nên câu Đúng/Sai sẽ không gửi được đáp án. Dịch sang `single` giữ mọi thứ theo
 * chỉ số, và cột `TrnQuestion.type` vẫn là `TRUE_FALSE` cho báo cáo.
 */

/** Loại DB (viết hoa) → loại khuôn chung (viết thường). */
export const LOAI_NOI_DUNG: Record<string, ContentQuestion["type"]> = {
  SINGLE: "single",
  TRUE_FALSE: "single",
  MULTIPLE: "multiple",
  SHORT_ANSWER: "short",
  ESSAY: "essay",
};

export type LuaChonNhap = { text: string; isCorrect: boolean };

/**
 * Dựng `contentJson` từ dữ liệu người soạn nhập.
 *
 * `id` sinh ở đây và ổn định theo `questionId` — khuôn chung đòi có `id`, và dùng
 * một giá trị ngẫu nhiên mỗi lần lưu là làm bản ghi đổi nội dung mà không đổi gì.
 */
export function dungNoiDungCauHoi(input: {
  questionId: string;
  type: string;
  stem: string;
  choices?: LuaChonNhap[];
}): ContentQuestion {
  const loai = LOAI_NOI_DUNG[input.type];
  const id = input.questionId;
  const question = input.stem;
  const ds = input.choices ?? [];
  const options = ds.map((c) => c.text);

  switch (loai) {
    case "multiple": {
      const dung = ds.map((c, i) => (c.isCorrect ? i : -1)).filter((i) => i >= 0);
      return { id, type: "multiple", question, options, correctIndices: dung };
    }
    case "short":
      return { id, type: "short", question };
    case "essay":
      return { id, type: "essay", question };
    case "single":
    default: {
      // Không ô nào được đánh dấu là dữ liệu đã hỏng từ tầng nhập (Zod của kho câu
      // hỏi chặn), nhưng đừng để nó thành `-1` — chỉ số âm là câu không ai trả lời
      // đúng được, im lặng.
      const i = ds.findIndex((c) => c.isCorrect);
      return { id, type: "single", question, options, correctIndex: i >= 0 ? i : 0 };
    }
  }
}

/**
 * Đọc ngược từ `contentJson` ra danh sách lựa chọn của trình soạn.
 *
 * Trình soạn làm việc với `{text, isCorrect}`; khuôn chung lưu `options` + chỉ số.
 * Hai chiều phải đi qua CÙNG một chỗ, nếu không chúng sẽ trôi khỏi nhau đúng như
 * lần này.
 */
export function docLuaChonTuNoiDung(raw: unknown): LuaChonNhap[] {
  if (!raw || typeof raw !== "object") return [];
  const q = raw as {
    type?: unknown;
    options?: unknown;
    correctIndex?: unknown;
    correctIndices?: unknown;
  };
  if (!Array.isArray(q.options)) return [];
  const dung = new Set<number>(
    Array.isArray(q.correctIndices)
      ? (q.correctIndices as unknown[]).map(Number).filter(Number.isInteger)
      : typeof q.correctIndex === "number"
        ? [q.correctIndex]
        : [],
  );
  return (q.options as unknown[]).map((t, i) => ({
    text: String(t),
    isCorrect: dung.has(i),
  }));
}
