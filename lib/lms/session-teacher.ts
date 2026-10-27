// lib/lms/session-teacher.ts — GIÁO VIÊN PHỤ TRÁCH của một buổi học. MỘT thứ tự duy nhất.
//
// Chốt kỹ thuật 24/08/2026 (OQ-5):
//
//     substituteTeacherId  ??  actualTeacherId  ??  class.teacherId
//
// tức "người THẬT SỰ đứng lớp buổi đó" — dạy thay đã lên kế hoạch thắng người chốt buổi,
// người chốt buổi thắng giáo viên chính của lớp.
//
// ⚠️ VÌ SAO PHẢI CÓ FILE NÀY: đo ngày 24/08 thấy repo trả lời cùng một câu hỏi theo BỐN
// thứ tự khác nhau —
//   • `lib/lms/schedule-conflict.ts:109`      substitute ?? actual ?? class   ← bản chốt
//   • `lib/students/birthday-notify.ts:102`   substitute ?? actual ?? class
//   • `lib/lms/session-teacher-notify.ts:120` actual ?? substitute ?? class
//   • `lib/_handlers/r7-lifecycle.ts:62` và
//     `app/(admin)/admin/bao-cao/hieu-suat-gv/page.tsx:285`  actual ?? class  ← bỏ dạy thay
// Người dùng MỚI (E-01) mà tự viết lại thì repo có thứ tự thứ NĂM, và cột "giáo viên phụ
// trách" của dashboard sẽ chỉ khác báo cáo hiệu suất GV ở đúng những buổi có dạy thay —
// loại lệch không ai phát hiện bằng mắt.
//
// ⚠️ File này CỐ Ý không chuyển 4 chỗ cũ sang dùng nó: đổi `hieu-suat-gv` là số công/số
// buổi của giáo viên nhảy, phải báo trước — đó là ticket riêng, không gánh trong E-01.
//
// PURE (không DB, không "use server") — dùng được ở RSC, client và test.

/** Vì sao buổi này quy về giáo viên đó — để UI giải thích được, không chỉ hiện tên. */
export type SessionTeacherSource =
  | "SUBSTITUTE" // có dạy thay cho buổi này
  | "ACTUAL" // người thực tế đứng lớp (ghi khi chốt buổi)
  | "CLASS" // giáo viên chính của lớp
  | "NONE"; // lớp chưa phân công ai

/**
 * Phần của một buổi mà helper cần. Nhận CẢ hai hình dạng vì hai đường nạp khác nhau:
 * truy vấn có `include: { class: { select: { teacherId } } }` thì dùng `class`, còn chỗ
 * đã dẹt sẵn thì truyền `classTeacherId`.
 */
export type SessionTeacherRef = {
  substituteTeacherId?: string | null;
  actualTeacherId?: string | null;
  /** Dạng dẹt — ưu tiên hơn `class.teacherId` khi cả hai cùng có. */
  classTeacherId?: string | null;
  class?: { teacherId?: string | null } | null;
};

/**
 * Chuỗi rỗng / toàn khoảng trắng KHÔNG phải là "đã phân công".
 *
 * `??` chỉ bắt `null`/`undefined`, nên một `substituteTeacherId = ""` (form gửi lên ô
 * trống) sẽ THẮNG giáo viên chính của lớp và cột GV hiện trống — không lỗi, không dấu
 * vết, chỉ là một ô trắng mà người đọc tưởng là "chưa phân công".
 */
function pick(id: string | null | undefined): string | null {
  const t = id?.trim();
  return t && t.length > 0 ? t : null;
}

/** Giáo viên phụ trách + lý do. Không tra được ai → `{ teacherId: null, source: "NONE" }`. */
export function resolveSessionTeacher(s: SessionTeacherRef): {
  teacherId: string | null;
  source: SessionTeacherSource;
} {
  const substitute = pick(s.substituteTeacherId);
  if (substitute) return { teacherId: substitute, source: "SUBSTITUTE" };

  const actual = pick(s.actualTeacherId);
  if (actual) return { teacherId: actual, source: "ACTUAL" };

  const classTeacher = pick(s.classTeacherId) ?? pick(s.class?.teacherId);
  if (classTeacher) return { teacherId: classTeacher, source: "CLASS" };

  return { teacherId: null, source: "NONE" };
}

/** Lối tắt khi chỉ cần id (cùng thứ tự — đừng viết `a ?? b ?? c` tại chỗ). */
export function resolveSessionTeacherId(s: SessionTeacherRef): string | null {
  return resolveSessionTeacher(s).teacherId;
}
