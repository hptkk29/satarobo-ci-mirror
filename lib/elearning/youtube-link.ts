/**
 * Bài VIDEO dùng LINK YOUTUBE — tách mã video từ một đường dẫn người soạn dán vào.
 *
 * Thuần (không import server) để dùng chung ở CẢ HAI phía: ô dán link ở trình soạn
 * (kiểm sớm, cho người soạn thấy ngay link sai) và server action (chốt thật). Server
 * LUÔN tự tách lại từ chuỗi người dùng gửi lên, không tin mã đã tách ở client.
 *
 * ⚠️ Chỉ nhận đúng các host của YouTube, so sánh NGUYÊN host. So bằng `endsWith`/
 * `includes` thì `youtube.com.evil.com` và `https://youtube.com@evil.com/...` đều lọt;
 * mã tách ra vẫn là 11 ký tự hợp lệ nên không lỗi nào báo, nhưng link người soạn thấy
 * lại dẫn đi chỗ khác.
 *
 * ⚠️ Mã video (11 ký tự) CHÍNH LÀ bí mật của một video "Không công khai": ai biết mã là
 * xem được. Vì thế mã không được ghi vào sổ audit hay log — chỉ ghi "có dùng YouTube".
 */

const HOST_YOUTUBE = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const HOST_RUT_GON = new Set(["youtu.be", "www.youtu.be"]);

const MA_VIDEO = /^[A-Za-z0-9_-]{11}$/;

/** Các đường `/<loai>/<ma>` mà YouTube dùng cho một video đơn lẻ. */
const LOAI_DUONG = new Set(["embed", "shorts", "live", "v"]);

/**
 * Trả mã 11 ký tự, hoặc `null` nếu không phải link một video YouTube.
 *
 * Cố ý KHÔNG nhận: link chỉ có danh sách phát (`?list=`), link kênh, và chuỗi 11 ký
 * tự trần (không có gì chứng minh đó là mã YouTube chứ không phải một từ bất kỳ).
 */
export function tachMaYoutube(dauVao: string): string | null {
  const s = dauVao.trim();
  if (!s || s.length > 500) return null;

  // Cho phép dán thiếu giao thức ("youtu.be/abc…", "www.youtube.com/watch?v=…").
  const coGiaoThuc = /^https?:\/\//i.test(s);
  if (!coGiaoThuc && /^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // javascript:, data:, ...
  let u: URL;
  try {
    u = new URL(coGiaoThuc ? s : `https://${s}`);
  } catch {
    return null;
  }
  // `user:pass@host` là cách quen thuộc để giấu host thật sau một cái tên giống YouTube.
  if (u.username || u.password) return null;

  const host = u.hostname.toLowerCase();
  const doan = u.pathname.split("/").filter(Boolean);

  let ma: string | undefined;
  if (HOST_RUT_GON.has(host)) {
    ma = doan[0];
  } else if (HOST_YOUTUBE.has(host)) {
    if (doan[0] === "watch") ma = u.searchParams.get("v") ?? undefined;
    else if (doan[0] && LOAI_DUONG.has(doan[0])) ma = doan[1];
  } else {
    return null;
  }

  return ma && MA_VIDEO.test(ma) ? ma : null;
}

/** Link xem chuẩn từ mã — để HIỆN cho người soạn, không dùng để phát. */
export function linkXemYoutube(ma: string): string {
  return `https://youtu.be/${ma}`;
}
