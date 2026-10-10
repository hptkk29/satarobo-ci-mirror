// Hợp đồng dữ liệu của một đăng ký Web Push do TRÌNH DUYỆT cấp.
//
// ⚠️ CHỈ CHẠY PHÍA NODE — dùng `Buffer` (qua `giaiBase64Url`). Next 16 KHÔNG polyfill `Buffer`
// cho bundle client, nên import file này từ một Client Component sẽ ném
// `ReferenceError: Buffer is not defined` ngay lúc nạp: trang trắng, và server không thấy lỗi gì.
// Màn bật thông báo ở Đợt 3 gửi thẳng `PushSubscription.toJSON()` lên Server Action; việc kiểm
// làm ở server, không làm ở trình duyệt.
//
// ⚠️ PHẠM VI CỦA FILE NÀY: nó chỉ gác phần trình duyệt gửi lên (`PushSubscription.toJSON()`).
// Hai cột còn lại của bảng KHÔNG nằm ở đây và KHÔNG BAO GIỜ được nhận từ client:
//   · `userId` — lấy từ phiên đăng nhập phía server. Nhận từ client là cho phép bất kỳ ai
//     gắn thiết bị của mình vào tài khoản người khác rồi đọc trộm mọi thông báo của họ.
//   · `origin` — suy từ request phía server. Client tự khai origin thì cột đó thành lời kể,
//     không còn là số đo.
//
// ⚠️ LUẬT CHO ĐỢT 3: đường ghi chỉ được dùng `parsed.data`, TUYỆT ĐỐI không dùng dữ liệu thô.
// Schema này là `z.object` thường (chế độ STRIP, không `.strict()`) — nó *bỏ* khoá lạ chứ không
// *từ chối* chúng. Ghi từ input thô là mọi khoá lạ đi thẳng vào `db.webPushSubscription.upsert`.
// Cố ý không `.strict()`: trình duyệt thêm trường mới vào `toJSON()` là chuyện bình thường, và
// `.strict()` sẽ biến việc đó thành "toàn bộ nhân viên đột nhiên không đăng ký được".

import { z } from "zod";
import { giaiBase64Url } from "./vapid";

/**
 * Trần độ dài `endpoint`, tính bằng BYTE.
 *
 * Cột là TEXT nên Postgres không chặn, NHƯNG nó có UNIQUE INDEX kiểu btree, và btree từ chối khoá
 * quá ~2704 **byte**. Phải đếm byte chứ không đếm ký tự: `.max()` của Zod đếm code unit UTF-16,
 * nên một endpoint 2015 ký tự nhiều byte (vd chữ có dấu) nặng 4015 byte vẫn lọt qua rồi ném
 * Postgres 54000 `index row size exceeds btree version 4 maximum` ở tận môi trường thật.
 *
 * Đo endpoint thật: Chrome/FCM ~200 ký tự, Mozilla ~180, WNS ~230. 2048 byte còn dư gấp mười.
 */
export const DO_DAI_ENDPOINT_TOI_DA = 2048;

/** Bí mật xác thực (RFC 8291 §3.2) — đúng 16 byte. */
const DO_DAI_AUTH_BYTE = 16;
/** Khoá công khai của trình duyệt — điểm P-256 không nén, 65 byte. */
const DO_DAI_P256DH_BYTE = 65;

function laBase64UrlDung(soByte: number) {
  return (s: string) => {
    const buf = giaiBase64Url(s);
    return buf !== null && buf.length === soByte;
  };
}

/** IPv4 dạng số chấm số. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Host của endpoint có an toàn để server tự phát request tới không.
 *
 * ⚠️ ĐÂY MỚI LÀ CHỖ CHỐNG SSRF — kiểm `https:` thì KHÔNG. `https` chỉ nói về giao thức, không nói
 * gì về ĐÍCH: `https://169.254.169.254/latest/meta-data/` và `https://10.0.0.5/x` đều là https
 * hợp lệ. Engine gửi ở Đợt 4 sẽ tự POST vào endpoint này từ runtime Vercel **kèm header VAPID
 * thật**, rồi ghi mã trả về vào `WebPushSubscription.lastErrorCode` — tức kẻ tấn công có cả kênh
 * đọc kết quả. Không có cổng này thì bảng đăng ký thành bàn đạp SSRF có phản hồi.
 *
 * Đây là DANH SÁCH CHẶN, không phải danh sách cho phép: loại IP literal và host một nhãn
 * (`localhost`, `metadata`, tên máy nội bộ). Chọn chặn thay vì cho phép vì mọi push service thật
 * đều có tên miền nhiều nhãn, nên cổng này KHÔNG có dương tính giả — trong khi một allowlist
 * cứng sẽ âm thầm giết trình duyệt ta chưa liệt kê (Samsung Internet, một host autopush khác của
 * Mozilla, một endpoint mới của Apple).
 *
 * ⚠️ CHƯA LÀM, để Đợt 3/4 quyết sau khi đo thiết bị thật: allowlist DƯƠNG theo host push service
 * (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`,
 * `*.notify.windows.com`). Đó mới là cổng chặt nhất; cổng dưới đây là mức sàn.
 */
/**
 * Endpoint đã LƯU có còn an toàn để POST vào không — cổng SSRF của ĐƯỜNG GỬI (Đợt 4).
 *
 * Vì sao phải kiểm LẠI dù đường ghi đã kiểm: cổng ở `endpointSchema` chỉ chạy lúc ĐĂNG KÝ.
 * Engine gửi đọc chuỗi từ DB rồi tự POST vào đó **kèm header VAPID thật**, và ghi mã trả về
 * vào `lastErrorCode` — tức nếu một dòng xấu lọt vào bảng (ghi bằng SQL tay, khôi phục từ bản
 * sao lưu cũ hơn cổng này, hay một bản vá tương lai nới lỏng schema) thì kẻ đặt nó có cả một
 * kênh quét cổng nội bộ CÓ PHẢN HỒI. Chú thích ở `endpointSchema` đã nêu trước nguy cơ này.
 *
 * Rẻ (một `new URL`), chạy đúng một lần cho mỗi thiết bị mỗi lượt gửi. Đừng tin cột trong DB.
 */
export function endpointConAnToan(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return u.protocol === "https:" && laHostAnToan(u);
}

function laHostAnToan(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  if (host.length === 0) return false;
  // IPv6 tới đây ở dạng `[::1]`; IPv4 ở dạng số chấm số. Cả hai đều là địa chỉ trần ⇒ loại.
  if (host.startsWith("[") || IPV4.test(host)) return false;
  // Host một nhãn: localhost, metadata, tên máy nội bộ. Push service thật luôn nhiều nhãn.
  if (!host.includes(".")) return false;
  return true;
}

/**
 * Endpoint: URL https tuyệt đối, host an toàn, đã CHUẨN HOÁ, dưới trần byte.
 *
 * Vì sao phải chuẩn hoá (`new URL(s).href`): cột `endpoint` là `@unique` và đường ghi Đợt 3 là
 * UPSERT theo chính nó. `https://FCM.googleapis.com/x` và `https://fcm.googleapis.com/x ` (thừa
 * một dấu cách cuối) là hai chuỗi khác nhau nhưng CÙNG một thiết bị thật ⇒ không chuẩn hoá thì
 * ra HAI dòng, và engine Đợt 4 lấy thiết bị theo `userId + status` sẽ bắn hai lần vào cùng một
 * máy. Gửi đôi là đúng thứ khiến người dùng tắt quyền thông báo ở cấp trình duyệt.
 *
 * Thứ tự có chủ đích: kiểm hình dạng ⇒ chuẩn hoá ⇒ mới đo độ dài, vì cái được LƯU là bản đã
 * chuẩn hoá, và đó mới là chuỗi mà btree phải gánh.
 */
const endpointSchema = z
  .string()
  .min(1, "Thiếu endpoint")
  .refine((s) => {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return false;
    }
    return u.protocol === "https:" && laHostAnToan(u);
  }, "Endpoint phải là URL https tuyệt đối trỏ tới một tên miền công khai")
  .transform((s) => new URL(s).href)
  .refine(
    (s) => Buffer.byteLength(s, "utf8") <= DO_DAI_ENDPOINT_TOI_DA,
    `Endpoint nặng quá ${DO_DAI_ENDPOINT_TOI_DA} byte`,
  );

export const webPushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z
      .string()
      .refine(laBase64UrlDung(DO_DAI_P256DH_BYTE), "p256dh phải là base64url của 65 byte"),
    auth: z.string().refine(laBase64UrlDung(DO_DAI_AUTH_BYTE), "auth phải là base64url của 16 byte"),
  }),
  /** Trình duyệt gửi kèm; ta không lưu. Khai ra để đọc hiểu — schema STRIP nên không khai cũng qua. */
  expirationTime: z.number().nullable().optional(),
});

export type WebPushSubscriptionInput = z.infer<typeof webPushSubscriptionSchema>;
