// lib/hoc-bu/phieu-co-noi-dung.ts — "phiếu nhận xét MỘT bài học bù có NỘI DUNG chưa" (THUẦN, không DB, không react-pdf).
// Tách khỏi `phieu-muc-pdf.ts` để nơi chỉ cần ĐẾM (tuân thủ buổi dạy, P5c) không kéo theo trình dựng PDF. Cùng luật với `ghiDanhGiaMuc`.

/** Phiếu có NỘI DUNG khi có chữ hoặc đã chấm bảng năng lực. */
export const phieuCoNoiDung = (m: { teacherEvaluation: string | null; evaluationRubric: unknown }): boolean =>
  (m.teacherEvaluation ?? "").trim().length > 0 || (m.evaluationRubric !== null && m.evaluationRubric !== undefined);
