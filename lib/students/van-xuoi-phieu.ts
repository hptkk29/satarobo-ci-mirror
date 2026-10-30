// lib/students/van-xuoi-phieu.ts — văn xuôi của một phiếu nhận xét buổi, để thẻ ở hồ sơ học viên hiện ĐÚNG chữ giáo viên viết.
//
// THUẦN (không DB, không React). Một cách hiểu phiếu cho cả hai dạng dữ liệu của `StudentSessionFeedback`
// (đi qua `evalNotesProse`, đúng như PDF): "Đánh giá chung" (phiếu từ 21/08) → 4 mục Kiến thức/Kỹ năng/Thái độ/Đề xuất
// (phiếu cũ) → `comment` (phiếu lưu qua /teacher/nhan-xet chỉ có chữ + sao).
import { evalNotesProse, type EvalNotes } from "@/lib/lms/session-eval-rubric";

/** Rỗng khi phiếu chỉ chấm mức (không có lời nhận xét). */
export function vanXuoiPhieu(p: { notes: EvalNotes | null; comment: string | null }): string {
  const prose = evalNotesProse(p.notes);
  if (prose?.kind === "overall") return prose.text;
  if (prose?.kind === "legacy") return prose.rows.map((r) => `${r.label}: ${r.text}`).join("\n");
  return (p.comment ?? "").trim();
}
