import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { getSigningSecret } from "@/lib/security/signing-key";

/**
 * EL-10 — VÉ PHÁT MEDIA đào tạo, ký HMAC, hạn ngắn.
 *
 * Vé buộc theo `lessonId + userId + exp`, nên đường phát xác quyền từng lượt xin
 * mà không phải tra lại quyền — chống IDOR và tự hết hiệu lực.
 *
 * ⚠️ Tiền tố chuỗi ký là `"elmedia:"`, KHÁC `"scorm:"` của `lib/scorm/ticket.ts`.
 * Dùng chung tiền tố nghĩa là một vé SCORM hợp lệ cũng mở được video đào tạo và
 * ngược lại — hai hệ có luật cấp vé khác nhau, và lỗ hổng đó sẽ không ai thấy vì
 * cả hai đường đều "hoạt động bình thường".
 *
 * ⚠️ Vé gắn `lessonId`, không gắn KHOÁ TỆP. Người có vé chỉ mở được media của
 * đúng bài đó; gắn theo khoá tệp thì mỗi tệp một vé và trình phát phải xin lại
 * vé cho phụ đề, cho âm thanh — nhiều đường hơn, nhiều chỗ sai hơn.
 */

export type VeMedia = {
  lessonId: string;
  userId: string;
  /** Hết hạn, epoch ms. */
  exp: number;
  /**
   * Thời điểm PHÁT vé, epoch ms, đồng hồ SERVER. Là mốc sớm nhất mà việc xem có thể bắt đầu: vé chỉ có sau khi trang
   * học dựng xong, nên ngân sách thời gian thật (`video-time-budget.ts`) không bao giờ cấp tín dụng cho khoảng
   * TRƯỚC mốc này — đó là thứ làm "video 19 giây hoàn thành trong 1 giây sau khi mở trang" bất khả.
   * Tuỳ chọn: vé phát trước bản này không có; dùng `thoiDiemPhatVe` để đọc (rơi về `exp − VE_TTL_GIAY`).
   */
  iat?: number;
  /**
   * PHIÊN BẢN NỘI DUNG của bài lúc phát vé (`TrnLesson.mediaRevision`). Nhịp xem mang vé của phiên bản cũ bị từ chối
   * (`NOI_DUNG_DA_DOI`) — không thì nhịp của video cũ ghi vào tiến độ của video mới. Vé phát trước bản này không có:
   * `revCuaVe` coi là 1, đúng với MỌI bài trước khi có phiên bản.
   */
  rev?: number;
};

/** Hạn mặc định. Dài hơn vé SCORM vì một video bài học dài tới 15 phút. */
export const VE_TTL_GIAY = 30 * 60;

function ky(body: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(`elmedia:${body}`)
    .digest("base64url");
}

/**
 * @param now Mốc phát vé, epoch ms. Có tham số này để ĐỐI XỨNG với `kiemVeMedia`:
 *   thiếu nó thì test phải ký bằng đồng hồ thật rồi kiểm bằng mốc giả, và vé xanh
 *   hay đỏ tuỳ giờ chạy CI — một loại đỏ chập chờn không ai lần ra.
 */
export function kyVeMedia(
  input: { lessonId: string; userId: string; rev?: number },
  ttlGiay = VE_TTL_GIAY,
  now = Date.now(),
): string {
  const payload: VeMedia = {
    lessonId: input.lessonId,
    userId: input.userId,
    exp: now + ttlGiay * 1000,
    iat: now,
    ...(input.rev !== undefined ? { rev: input.rev } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${ky(body)}`;
}

export function kiemVeMedia(
  token: string | null | undefined,
  now = Date.now(),
): { ok: boolean; ve?: VeMedia } {
  if (!token || typeof token !== "string") return { ok: false };
  const phan = token.split(".");
  if (phan.length !== 2) return { ok: false };
  const [body, sig] = phan;

  const mong = ky(body!);
  const a = Buffer.from(sig!);
  const b = Buffer.from(mong);
  // So sánh hằng thời gian: so bằng `===` để lộ độ dài tiền tố trùng qua thời
  // gian phản hồi, và đó là đủ để dò ra chữ ký.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };

  let ve: VeMedia;
  try {
    ve = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as VeMedia;
  } catch {
    return { ok: false };
  }
  if (typeof ve.exp !== "number" || ve.exp < now) return { ok: false };
  if (!ve.lessonId || !ve.userId) return { ok: false };
  return { ok: true, ve };
}

/** Phiên bản nội dung ghi trong vé; vé cũ (không có `rev`) = 1. */
export function revCuaVe(ve: VeMedia): number {
  return typeof ve.rev === "number" && Number.isInteger(ve.rev) && ve.rev >= 1 ? ve.rev : 1;
}

/**
 * Mốc phát vé (epoch ms). Vé cũ chưa mang `iat` thì suy ngược từ `exp` theo hạn mặc định — mốc SỚM HƠN thật nên
 * chỉ có thể làm ngân sách rộng hơn tới giới hạn `CUA_SO_GIAY` của nó, không bao giờ rộng hơn thế.
 * Kẹp trên `now`: vé không thể phát từ tương lai, và đồng hồ hai máy chủ lệch nhau vài trăm ms không được biến
 * thành ngân sách âm của người xem trung thực.
 */
export function thoiDiemPhatVe(ve: VeMedia, now: number): number {
  const goc = typeof ve.iat === "number" && Number.isFinite(ve.iat) ? ve.iat : ve.exp - VE_TTL_GIAY * 1000;
  return Math.min(goc, now);
}

/**
 * Khoá tệp có thuộc bài này không.
 *
 * ⚠️ Hàng rào cuối của đường phát: khoá đến từ URL, nên không kiểm là ai có vé
 * của bài A cũng đọc được tệp của bài B chỉ bằng cách đổi đường dẫn.
 */
export function khoaThuocBai(khoa: string, lessonId: string): boolean {
  if (!khoa || !lessonId) return false;
  // Chặn đi lùi thư mục trước khi so tiền tố — `elearning/master/A/../B/x.mp4`
  // có tiền tố đúng nhưng trỏ sang bài khác.
  if (khoa.includes("..") || khoa.includes("//")) return false;
  return (
    khoa.startsWith(`elearning/master/${lessonId}/`) ||
    khoa.startsWith(`elearning/caption/${lessonId}/`) ||
    khoa.startsWith(`elearning/audio/${lessonId}/`)
  );
}
