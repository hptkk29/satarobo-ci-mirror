// lib/push/payload.ts — dựng gói tin gửi vào máy nhân viên. Web Push Đợt 4.
//
// THUẦN: không DB, không mạng. Test không cần dựng gì.
//
// ── HỢP ĐỒNG VỚI SERVICE WORKER ────────────────────────────────────────────────────────
// `public/sw.js` (`bocPayload`) đọc ĐÚNG bốn khoá: `title` · `body` · `url` · `tag`. Khoá lạ
// bị bỏ qua im lặng, thiếu khoá thì rơi về mặc định ("Sata Robo" / "Bạn có thông báo mới." / "/").
// Thêm khoá ở đây mà quên sửa `sw.js` = tốn băng thông cho dữ liệu không ai đọc; đổi TÊN khoá ở
// đây mà quên sửa `sw.js` = mọi thông báo hiện chữ mặc định, và triệu chứng đó trông y hệt
// "payload rỗng" nên rất dễ đi tìm nhầm chỗ.
//
// ── VÌ SAO KHÔNG NHÉT GÌ THÊM ─────────────────────────────────────────────────────────
// Nội dung lấy NGUYÊN từ `StaffNotification`, đã qua `cheSdt()` ở đường ghi. TUYỆT ĐỐI không
// thêm số điện thoại, nguồn lead, tên cơ sở, số tiền — thông báo đẩy hiện trên MÀN HÌNH KHOÁ,
// tức nó là kênh duy nhất trong hệ thống mà dữ liệu bay ra ngoài phiên đăng nhập: máy để trên
// bàn, ai đi ngang cũng đọc được, và không có `can()` nào gác được chuyện đó.

import { teacherHref } from "@/lib/teacher/notification-href";

/** Bốn khoá `sw.js` đọc. Không thêm khoá nào mà không sửa `public/sw.js` trước. */
export interface GoiTinPush {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Trần kích thước payload, tính theo BYTE UTF-8 của chuỗi JSON.
 *
 * ĐO THẬT trên `web-push@3.6.7` (mã hoá `aes128gcm`, bản rõ 0 / 1000 / 3993 byte): phần đội
 * thêm là HẰNG ĐỊNH 103 byte (16 salt + 4 rs + 1 idlen + 65 keyid + 16 thẻ xác thực + 1 dấu
 * phân cách). Trần sau mã hoá là 4096 ⇒ bản rõ dùng được đúng **3993**.
 *
 * ⚠️ ĐẾM BYTE, KHÔNG ĐẾM KÝ TỰ. Tiêu đề tiếng Việt có dấu là 3 byte/ký tự UTF-8, nên `.length`
 * của chuỗi JS ở đây là số đo SAI LOẠI — hụt tới gần ba lần. Repo đã dính đúng bẫy này một lần
 * và ghi lại ở `lib/push/subscription.ts` (trần độ dài endpoint).
 *
 * Gói `web-push` KHÔNG kiểm kích thước (đã đọc `encryption-helper.js` và `web-push-lib.js`: không
 * có dòng nào). Nó mã hoá bất kể to nhỏ và push service mới trả 413 — mà 413 là lỗi CHẾT (không
 * thử lại được), tức mất hẳn thông báo. Cổng phải nằm ở đây.
 */
export const TRAN_PAYLOAD_BYTE = 3993;

function soByte(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Cắt chuỗi về đúng `tran` BYTE (không cắt giữa một ký tự nhiều byte), thêm dấu "…". */
function catTheoByte(s: string, tran: number): string {
  if (soByte(s) <= tran) return s;
  // `Buffer.slice` có thể cắt đứt đôi một ký tự đa byte → chuỗi ra có ký tự thay thế "�".
  // Bỏ ký tự hỏng ở đuôi thay vì để nó hiện trên màn hình khoá của người dùng.
  let cat = Buffer.from(s, "utf8").subarray(0, Math.max(0, tran - 3)).toString("utf8");
  cat = cat.replace(/�+$/, "");
  return `${cat.trimEnd()}…`;
}

/** Host `giaovien.*` — kiểm theo tiền tố nhãn miền, giống `nhanHost` ở `lib/push/ui-state.ts`. */
function laHostGiaoVien(origin: string): boolean {
  const h = origin.replace(/^https?:\/\//, "").split(":")[0]?.toLowerCase() ?? "";
  return h.startsWith("giaovien.");
}

/**
 * Đường mở khi người dùng bấm thông báo, TÍNH THEO TỪNG THIẾT BỊ.
 *
 * `StaffNotification.href` viết theo đường ADMIN clean-URL (không tiền tố `/admin`). Service
 * worker mở đường đó TRÊN CHÍNH ORIGIN đã đăng ký, nên cùng một thông báo phải ra hai đường
 * khác nhau tuỳ máy đó bật ở host nào — đây là lý do payload dựng theo thiết bị chứ không
 * dựng một lần cho cả dòng outbox.
 *
 * Trên host giáo viên: đi qua `teacherHref` (đúng hàm mà chuông trong ứng dụng đang dùng), và
 * đường nào GV không có màn thì trả `/teacher` chứ không trả đường admin — mở đường admin từ
 * máy GV là bị `decideRoute` đá ngược về giaovien, ra một vòng nhảy khó hiểu.
 */
export function duongChoThietBi(href: string | null | undefined, origin: string): string {
  const h = href?.trim() || "/";
  if (!laHostGiaoVien(origin)) return h;
  return teacherHref(h) ?? "/teacher";
}

/**
 * Dựng gói tin cho MỘT thiết bị và bảo đảm không vượt trần.
 *
 * `tag` = `dedupeKey`: hai lần đẩy cùng một việc thì thông báo sau ĐÈ thông báo trước trên máy
 * thay vì xếp chồng — đúng nghĩa của `dedupeKey`. Cố ý KHÔNG dùng một tag chung ("sata"): thế
 * thì "lead mới" sẽ nuốt mất "khách nhập lại", hai việc khác nhau.
 */
export function dungGoiTin(params: {
  title: string;
  body: string;
  href: string | null | undefined;
  dedupeKey: string;
  origin: string;
}): { goiTin: GoiTinPush; chuoi: string; daCat: boolean } {
  const url = duongChoThietBi(params.href, params.origin);
  const tag = params.dedupeKey;

  const dung = (title: string, body: string): { g: GoiTinPush; s: string } => {
    const g: GoiTinPush = { title, body, url, tag };
    return { g, s: JSON.stringify(g) };
  };

  let { g, s } = dung(params.title, params.body);
  if (soByte(s) <= TRAN_PAYLOAD_BYTE) return { goiTin: g, chuoi: s, daCat: false };

  // Cắt NỘI DUNG trước: tiêu đề là thứ người dùng đọc trên màn hình khoá để quyết có mở hay
  // không, mất tiêu đề là mất luôn tác dụng của cả thông báo.
  const thuaBody = soByte(s) - TRAN_PAYLOAD_BYTE;
  ({ g, s } = dung(params.title, catTheoByte(params.body, Math.max(0, soByte(params.body) - thuaBody))));
  if (soByte(s) <= TRAN_PAYLOAD_BYTE) return { goiTin: g, chuoi: s, daCat: true };

  // Vẫn vượt ⇒ chính tiêu đề (hoặc url/tag) mới là thứ dài. Cắt tiêu đề nốt.
  const thuaTitle = soByte(s) - TRAN_PAYLOAD_BYTE;
  ({ g, s } = dung(catTheoByte(params.title, Math.max(1, soByte(params.title) - thuaTitle)), g.body));
  if (soByte(s) <= TRAN_PAYLOAD_BYTE) return { goiTin: g, chuoi: s, daCat: true };

  // Không thể xảy ra với dữ liệu thật (`dedupeKey` dài nhất đang chạy ~60 ký tự, `href` ~80),
  // nhưng nếu xảy ra thì thứ duy nhất KHÔNG được cắt là `url` và `tag`: cắt `url` là bấm vào
  // thông báo đi lạc, cắt `tag` là mất chống trùng. Bỏ chữ, giữ đường — thông báo vẫn hiện
  // (bằng câu mặc định của `sw.js`) và vẫn bấm được, thay vì ăn 413 rồi mất hẳn.
  ({ g, s } = dung("Sata Robo", ""));
  return { goiTin: g, chuoi: s, daCat: true };
}
