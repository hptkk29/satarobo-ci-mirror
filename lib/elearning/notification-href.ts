// lib/elearning/notification-href.ts — đổi href của thông báo sang đường chạy ĐƯỢC trên khu học tập nội bộ.
//
// Chuông thông báo dùng chung API với admin, nên href trong DB phần lớn viết theo đường ADMIN clean-URL
// ("/classes/…", "/don-tu"). Điều hướng thẳng trên host e-learning là bị route-policy đá về trang chủ — bấm mà
// không đi đâu (đúng lỗi 19/08 mà `lib/teacher/notification-href.ts` đã vá cho site GV). Cùng nguyên tắc:
//   • href thuộc khu học tập (`/elearning/…`, hoặc URL tuyệt đối của host e-learning) ⇒ giữ, đổi về dạng
//     có tiền tố `/elearning` (chạy đúng cả trên host thật lẫn localhost/preview);
//   • mọi thứ khác ⇒ `null`: bản chuông hiện chữ, KHÔNG gắn link chết.
//
// THUẦN — test được bằng Vitest.

const HOST_ELEARNING = "e-learning.satarobo.vn";

function coTienTo(p: string): string {
  if (p === "/" || p === "") return "/elearning";
  return p === "/elearning" || p.startsWith("/elearning/") ? p : `/elearning${p}`;
}

export function elearningHref(href: string | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      // Chỉ tin host e-learning; URL tuyệt đối tới host khác không phải của khu này.
      if (u.hostname !== HOST_ELEARNING) return null;
      return coTienTo(u.pathname) + u.search;
    } catch {
      return null;
    }
  }
  const [path = ""] = href.split("?");
  if (path === "/elearning" || path.startsWith("/elearning/")) return href;
  return null;
}
