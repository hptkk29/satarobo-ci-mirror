import { kiemDeThi, type CauHoiGoc } from "./chuan-hoa";

/**
 * CỔNG XUẤT BẢN ĐỀ THI (web, dùng cho `updateExam` và `changeExamStatus`): đề CHƯA hợp lệ thì KHÔNG được chuyển sang PUBLISHED.
 * Mục tiêu (chỉ đạo 19/11): «chưa cho xuất bản đề chấm tự động khi chưa hỗ trợ đủ dạng trong đề» — một câu thiếu đáp án / `meta` sai hình sẽ bị chấm 0 âm thầm
 * ở mọi đường chấm, nên chặn từ lúc phát hành. `CODE` KHÔNG bị chặn ở đây (giáo viên chấm tay trên web; chỉ ứng dụng di động không phục vụ dạng này).
 */
export type HangCauDe = { id: string; points: number; question: { type: string; text: string; imageUrl: string | null; correctAnswer: string | null; meta: unknown; choices: { id: string; order: number; text: string; isCorrect: boolean; imageUrl: string | null }[] } };

export function thongBaoLoiXuatBan(cau: readonly HangCauDe[]): string | null {
  if (cau.length === 0) return "Đề chưa có câu hỏi — không thể xuất bản.";
  const goc: CauHoiGoc[] = cau.map((c) => ({ id: c.id, type: c.question.type, text: c.question.text, imageUrl: c.question.imageUrl, correctAnswer: c.question.correctAnswer, meta: c.question.meta, choices: c.question.choices, points: c.points }));
  const r = kiemDeThi(goc);
  const loi = r.loi.filter((x) => cau[x.thuTu - 1]?.question.type !== "CODE");
  if (loi.length === 0) return null;
  return `Đề có ${loi.length} câu chưa hợp lệ nên chưa thể xuất bản (sẽ bị chấm 0 âm thầm): ` + loi.slice(0, 3).map((x) => `câu ${x.thuTu} — ${x.loi}`).join("; ") + (loi.length > 3 ? "; …" : "");
}
