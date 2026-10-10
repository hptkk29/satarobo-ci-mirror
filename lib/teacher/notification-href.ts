// lib/teacher/notification-href.ts — map href của StaffNotification (viết theo đường
// ADMIN clean-URL, KHÔNG tiền tố /admin) sang màn tương ứng của site GV.
//
// Vì sao cần: từ khi TEACHER_SITE_ENABLED bật (10/07), GV thuần bị route-policy 307
// đá khỏi host admin. Chuông thông báo site GV dùng chung API /api/admin/notifications/bell
// nên href trả về vẫn là đường admin — điều hướng thẳng là đẩy GV sang host admin
// rồi bị đá ngược (vòng lặp khó hiểu). Đường nào GV KHÔNG có màn → trả null: hiện
// nội dung thông báo dạng text thuần, không gắn link chết.
//
// Hai luật rút ra từ sự cố 19/08 (bấm thông báo mà KHÔNG đi đâu):
//
//  1. Trả về đường CÓ tiền tố `/teacher` — KHÔNG trả clean URL. Clean URL chỉ sống
//     trên host giaovien, mà tên nào trùng segment admin (`hoc-ba`, `don-tu`,
//     `tin-nhan`, và từ nay `lich`) bị decideRoute coi là "lạc khu" → đá về trang chủ
//     GV (`route-policy.ts` nhánh teacher host); còn trên localhost/preview clean URL
//     404 thẳng vì không có host nào rewrite hộ. `/teacher/*` chạy đúng ở CẢ HAI
//     (isTeacherPath → next). Đây cũng là lý do sidebar GV giữ tiền tố `/teacher`
//     (xem `_components/nav-config.ts`).
//
//  2. Site GV không có route động: mọi màn sâu điều hướng bằng searchParams. Id nằm
//     trong path bên admin phải ĐỔI THÀNH tham số — vứt đi thì bấm thông báo xong rơi
//     về danh sách trống, đúng cái lỗi đang vá.
//
// THUẦN (không import React/DB) để test được bằng Vitest.

/** Ghép đích + tham số suy từ path (đứng trước) + query gốc của href admin. */
function withParams(base: string, idParam: string | null, query?: string): string {
  const qs = [idParam, query].filter(Boolean).join("&");
  return qs ? `${base}?${qs}` : base;
}

export function teacherHref(href: string | null): string | null {
  if (!href) return null;
  const [path = "", query] = href.split("?");
  const seg = path.split("/").filter(Boolean);
  const head = seg[0] ?? "";
  // seg[1] = id của route động admin ("/classes/<id>/edit", "/report-cards/<id>").
  // Không lọc "id trông giống cuid không": producer không bao giờ gửi GV đường
  // literal như /classes/new, mà lọc nhầm thì id THẬT bị rơi im lặng — đúng lỗi
  // đang vá. Id bịa chỉ dẫn tới màn "Không phải lớp của bạn": hỏng thấy được.
  const id = seg[1] ? encodeURIComponent(seg[1]) : null;

  switch (head) {
    case "attendance":
      // ⚠️ /teacher/diem-danh là bảng gộp mọi buổi, KHÔNG đọc ?sessionId= — query
      // giữ lại để không mất dữ kiện, nhưng GV vẫn phải tự tìm buổi trong bảng.
      return withParams("/teacher/diem-danh", null, query);

    case "sessions":
      // Không đưa được về ĐÚNG buổi: /teacher/lop và /teacher/nhan-xet đều đòi
      // classId đi kèm sessionId, còn /teacher/lich không đọc sessionId. Đưa về
      // lịch dạy để GV tự thấy buổi — hơn là ném sang màn nuốt tham số im lặng.
      return withParams("/teacher/lich", null, query);

    case "lich":
      // Thông báo dạy thay + nhắc chốt buổi (lib/lms/session-teacher-notify.ts).
      return withParams("/teacher/lich", null, query);

    case "classes":
      // "/classes/<id>" và "/classes/<id>/edit" → Class Hub của lớp đó.
      return withParams("/teacher/lop", id ? `classId=${id}` : null, query);

    case "assignments":
      return withParams("/teacher/cham-bai", id ? `assignmentId=${id}` : null, query);

    case "report-cards":
      // Route admin là /report-cards/[enrollmentId] — cùng khoá với /teacher/hoc-ba.
      return withParams("/teacher/hoc-ba", id ? `enrollmentId=${id}` : null, query);

    case "hoan-thanh-khoa":
      // Cùng tham số ?classId= ở cả hai site nên query đi thẳng.
      return withParams("/teacher/hoan-thanh", null, query);

    case "tin-nhan":
      // Cùng tham số ?c=/?tab=/?ac= với màn admin (StaffChatWorkspace dùng chung).
      return withParams("/teacher/tin-nhan", null, query);

    case "don-tu":
      return withParams("/teacher/don-tu", null, query);

    // 07/10/2026 — ca DẠY BÙ. Admin `/hoc-bu/case/<id>` ⇒ site GV `/teacher/hoc-bu/<id>` (màn
    // chi tiết có route động, lọc theo `teacherId`). seg[1] là chữ "case", id nằm ở seg[2].
    // Không có id (danh sách, hoặc ca đã huỷ) ⇒ về danh sách ca bù của GV.
    case "hoc-bu": {
      const caseId = seg[1] === "case" && seg[2] ? encodeURIComponent(seg[2]) : null;
      return withParams(caseId ? `/teacher/hoc-bu/${caseId}` : "/teacher/hoc-bu", null, query);
    }

    case "cham-cong":
      // seg[1] ở đây là màn con của admin ("lich-ca"), KHÔNG phải id → bỏ.
      return withParams("/teacher/bang-cong", null, query);

    // GĐ6 — "lop-trial" là màn gộp mới. GIỮ hai case cũ: thông báo đã gửi trong quá
    // khứ vẫn nằm trong DB với href cũ, bỏ đi là chuông giáo viên trả null và thông
    // báo thành text chết.
    case "lop-trial":
    case "trials":
    case "trial-classes":
      // Id ở đường admin là lớp/ca trải nghiệm, còn /teacher/trial khoá theo
      // enrollmentId — khác loại, mang sang là sai. Về danh sách Trial.
      return withParams("/teacher/trial", null, query);

    default:
      return null;
  }
}
