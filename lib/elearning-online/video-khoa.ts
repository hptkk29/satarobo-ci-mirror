/**
 * E-LEARNING ONLINE — VIDEO DÙNG CHUNG BUCKET R2 HIỆN CÓ (V10.0, Q4: KHÔNG tạo bucket mới, KHÔNG đụng video giáo trình Sata 3–7).
 * Bucket đó còn chứa video giáo trình/SCORM (Offline) và các tệp riêng tư của Online (bài nộp, phôi chứng nhận). Vì vậy một khoá media của Online
 * CHỈ được phép nằm dưới vùng `online/video/` — danh sách TRẮNG, không phải danh sách đen: nếu không, người soạn khoá có thể gắn `mediaRef` trỏ vào
 * video giáo trình, tệp bài nộp của học viên khác (`online/sp/…`) hay phôi chứng nhận (`online/cn/…`) rồi nhờ lớp phát video "phục vụ hộ" (confused deputy).
 *
 * HÀM THUẦN. Kiểm ở HAI đầu: lúc LƯU `mediaRef` (`noi-dung.ts`) và lúc khoá RỜI DB sang lớp phát video (`ve-media.ts`), nên dòng cũ/ghi tay vẫn không lọt ra.
 * Việc phát thật (vé phát có thời hạn từ R2, ngăn truy cập trực tiếp vào đối tượng, CDN/cache) là hạ tầng — BLOCKED_INFRA, bàn giao A (xem V10-IMPLEMENTATION-STATUS).
 */

export const VUNG_VIDEO_ONLINE = "online/video/";
const DOAN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DUOI = /\.(mp4|webm|mov)$/;

export function laKhoaVideoOnlineHopLe(ref: unknown): ref is string {
  if (typeof ref !== "string" || ref.length > 300 || !ref.startsWith(VUNG_VIDEO_ONLINE)) return false;
  const doan = ref.slice(VUNG_VIDEO_ONLINE.length).split("/");
  return doan.length >= 2 && doan.every((d) => DOAN.test(d) && d !== "." && d !== ".." && !d.includes("..")) && DUOI.test(doan[doan.length - 1]!);
}

/** Quy ước đặt khoá: `online/video/<khoá>/<bài>/<mã video>.<đuôi>` (mã video do hệ tải lên cấp). */
export const khoaVideoOnline = (courseId: string, lessonStableId: string, mediaId: string, ext: "mp4" | "webm" | "mov" = "mp4") => `${VUNG_VIDEO_ONLINE}${courseId}/${lessonStableId}/${mediaId}.${ext}`;
