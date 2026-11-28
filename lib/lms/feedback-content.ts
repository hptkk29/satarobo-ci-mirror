// lib/lms/feedback-content.ts — "phiếu nhận xét buổi này có nội dung gì không?"
//
// Một chỗ duy nhất trả lời câu đó, vì repo có HAI đường ghi vào cùng bảng
// StudentSessionFeedback và mỗi đường điền một nhóm cột khác nhau:
//   • saveSessionEvalCore  → projectName + notes (4 mục văn xuôi) + rubric (9 tiêu chí)
//     (StudentEvalDialog ở /teacher/lop)
//   • saveSessionFeedbackCore → comment + rating (sao)
//     (/teacher/nhan-xet và editor ở /admin/sessions/[id])
//
// Mỗi màn tự viết điều kiện riêng là cách sinh ra bug 19/08: route PDF chỉ chấp nhận
// notes/rubric nên phiếu comment+sao — phiếu THẬT, phụ huynh vẫn đọc trên portal — bị
// trả 404 "Chưa có phiếu nhận xét", trong khi nút "Xem phiếu" vẫn được bày ra.

export type FeedbackContentFields = {
  notes?: unknown;
  rubric?: unknown;
  comment?: string | null;
  rating?: number | null;
};

/**
 * true nếu phiếu có ÍT NHẤT một nội dung (văn xuôi 4 mục, rubric, comment, hoặc sao).
 * Là type predicate để chỗ gọi khỏi phải kiểm `!= null` lần nữa sau khi đã hỏi hàm này.
 */
export function feedbackHasContent<T extends FeedbackContentFields>(
  fb: T | null | undefined,
): fb is T {
  if (!fb) return false;
  return (
    fb.notes != null ||
    fb.rubric != null ||
    !!fb.comment?.trim() ||
    fb.rating != null
  );
}

/**
 * true khi một dòng người dùng vừa nhập là RỖNG (không chữ, không sao) — tức thao tác
 * "xoá nhận xét", chứ không phải "lưu nhận xét".
 *
 * ⚠️ Phải xét CẢ SAO. Bản trước 19/08 chỉ xét chữ nên giáo viên chấm sao mà không gõ gì
 * thì: chưa có phiếu → số sao bị bỏ im lặng (vẫn báo "Đã lưu"); đã có phiếu → bị hiểu là
 * lệnh xoá và phiếu cũ bị gỡ/xoá. Cả hai đều là mất dữ liệu không báo.
 */
export function isBlankFeedbackInput(comment: string, rating: number | null): boolean {
  return comment.trim().length === 0 && rating == null;
}
