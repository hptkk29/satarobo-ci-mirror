// lib/eval/session-eval-photo-gate.ts — F-04 cho ẢNH ĐÍNH TRONG PHIẾU ĐÁNH GIÁ BUỔI HỌC.
//
// Bối cảnh: repo có HAI kênh ảnh đi tới phụ huynh, không phải một.
//   • Kênh 1 — ClassSessionMedia (ảnh lớp): GV đăng → PENDING → QLCS duyệt → APPROVED
//     → /portal/hinh-anh. Cổng duyệt nằm ở `status`.
//   • Kênh 2 — câu hỏi loại PHOTO trong phiếu SESSION_EVAL: GV tải ảnh ngay trong phiếu,
//     URL nằm ở EvalAnswer.valueOptions. Kênh này KHÔNG có bản ghi ClassSessionMedia nào,
//     nên trước bản vá nó đi thẳng ra /portal/nhan-xet: bấm Lưu phiếu là phụ huynh xem
//     được, không ai duyệt. F-04 ("chỉ media ĐÃ DUYỆT mới tới được phụ huynh") nói về cả
//     hai kênh; đặc tả chỉ mô tả kênh 1 vì kênh 2 chưa ai để ý.
//
// Cách chặn đã chọn: ĐƯA ẢNH PHIẾU VÀO ĐÚNG HÀNG DUYỆT SẴN CÓ (không dựng hàng thứ hai).
// Lúc lưu phiếu, mỗi URL ảnh được ghi một bản sao ClassSessionMedia (PENDING, hoặc
// APPROVED nếu người điền có quyền media:approve — khớp uploadClassMedia) TRONG CÙNG
// transaction với phiếu. Cổng phụ huynh chỉ trả ảnh nào có bản ghi APPROVED.
//
// ⚠️ ĐIỀU KHOẢN CHUYỂN TIẾP (cố ý, đọc kỹ trước khi "dọn"): ảnh KHÔNG có bản ghi nào
// trong hàng duyệt thì VẪN HIỆN. Đó là ảnh lưu trước bản vá — phụ huynh đang xem chúng,
// bật cổng cứng là chúng biến mất khỏi cổng phụ huynh ngay trong lần deploy. Vì bản sao
// được ghi cùng transaction với phiếu, "không có bản ghi" không thể là ảnh mới.
// Muốn đóng nốt điều khoản này thì backfill ảnh cũ thành bản ghi trong hàng duyệt rồi
// đổi mặc định — việc đó cần chủ dự án quyết (xem bàn giao).
//
// File THUẦN: không Prisma, không server-only. Phần chạm DB là dây nối mỏng ở
// session-eval.ts (ghi) và session-eval-portal.ts (đọc).
import type { QuestionType } from "@/lib/eval/schema";

/** Chỉ cần id + type — nhận cả QuestionDef lẫn metadata câu hỏi của portal. */
export type PhotoQuestionLike = { id: string; type: QuestionType };

/** Chỉ cần questionId + valueOptions — nhận cả SubmittedAnswer lẫn NormalizedAnswer. */
export type PhotoAnswerLike = { questionId: string; valueOptions?: string[] | null };

/** Trạng thái bản ghi trong hàng duyệt (khớp Prisma enum MediaStatus). */
export type MirrorRow = { fileUrl: string; status: "PENDING" | "APPROVED" | "REJECTED" | "DRAFT" };

/**
 * PURE — gom URL ảnh của các câu loại PHOTO trong một lượt lưu phiếu, khử trùng, giữ
 * thứ tự xuất hiện.
 *
 * ⚠️ Phải lọc theo TYPE của câu hỏi, không phải "câu nào có valueOptions": RADIO và
 * CHECKBOX cũng lưu đáp án vào valueOptions, nhặt bừa là đưa chuỗi "Tích cực" vào hàng
 * duyệt ảnh.
 */
export function collectEvalPhotoUrls(
  questions: ReadonlyArray<PhotoQuestionLike>,
  answers: ReadonlyArray<PhotoAnswerLike>,
): string[] {
  const photoQuestionIds = new Set(
    questions.filter((q) => q.type === "PHOTO").map((q) => q.id),
  );
  if (photoQuestionIds.size === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of answers) {
    if (!photoQuestionIds.has(a.questionId)) continue; // câu đã xoá / không phải ảnh
    for (const raw of a.valueOptions ?? []) {
      const url = typeof raw === "string" ? raw.trim() : "";
      if (url.length === 0 || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * PURE — tập URL KHÔNG được trả cho phụ huynh: có mặt trong hàng duyệt nhưng chưa bản
 * ghi nào APPROVED (PENDING/REJECTED/DRAFT đều chặn).
 *
 * URL không xuất hiện trong `rows` thì KHÔNG nằm trong tập chặn — xem điều khoản chuyển
 * tiếp ở đầu file.
 */
export function blockedEvalPhotoUrls(rows: ReadonlyArray<MirrorRow>): Set<string> {
  const approved = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.fileUrl);
    if (r.status === "APPROVED") approved.add(r.fileUrl);
  }
  const blocked = new Set<string>();
  for (const url of seen) if (!approved.has(url)) blocked.add(url);
  return blocked;
}

/** Đáp án đã render của portal — chỉ cần type + photos để lọc. */
export type GateableAnswer = { type: QuestionType; photos: string[] | null };

/**
 * PURE — bỏ ảnh bị chặn khỏi danh sách đáp án đã render. Câu PHOTO không còn ảnh nào
 * thì bỏ hẳn khỏi phiếu, để cổng phụ huynh không hiện một ô "Ảnh dự án" trống rỗng
 * (phụ huynh sẽ hỏi ảnh đâu, và câu trả lời "đang chờ duyệt" không nên rò ra ngoài).
 */
export function applyEvalPhotoGate<T extends GateableAnswer>(
  answers: ReadonlyArray<T>,
  blocked: ReadonlySet<string>,
): T[] {
  if (blocked.size === 0) return [...answers];
  const out: T[] = [];
  for (const a of answers) {
    if (a.type !== "PHOTO") {
      out.push(a);
      continue;
    }
    const kept = (a.photos ?? []).filter((u) => !blocked.has(u));
    if (kept.length === 0) continue;
    out.push({ ...a, photos: kept });
  }
  return out;
}
