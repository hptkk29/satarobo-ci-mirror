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
  input: { lessonId: string; userId: string },
  ttlGiay = VE_TTL_GIAY,
  now = Date.now(),
): string {
  const payload: VeMedia = {
    lessonId: input.lessonId,
    userId: input.userId,
    exp: now + ttlGiay * 1000,
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
