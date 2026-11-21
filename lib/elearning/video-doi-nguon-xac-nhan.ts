import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getSigningSecret } from "@/lib/security/signing-key";
import { nhanDangNguon, type NguonBai } from "@/lib/elearning/video-doi-nguon-rule";

/**
 * XÁC NHẬN ĐỔI NGUỒN BÀI VIDEO — chữ ký gắn với NỘI DUNG và TẬP NGƯỜI HỌC bị ảnh hưởng (chống TOCTOU).
 *
 * ── Vì sao không còn cờ boolean ────────────────────────────────────────────────────────────────────────────
 * `xacNhanTacDong: true` chỉ nói "người soạn bấm đồng ý". Nó không nói đồng ý VỚI CÁI GÌ. Giữa lúc hộp xác nhận hiện số
 * liệu và lúc bấm Lưu, thêm người học bắt đầu xem (hoặc ai đó xong bài, hoặc nguồn mới khác với nguồn đã xem trước) thì cờ
 * vẫn `true` và việc đặt lại tiến độ rơi lên những người mà người soạn CHƯA TỪNG được hỏi.
 *
 * Nay xác nhận là một chuỗi ký (HMAC, khoá `getSigningSecret`) mang:
 *   · bài, người xác nhận, phiên bản nội dung lúc xem trước (`rev`);
 *   · băm NGUỒN MỚI (nhận dạng nguồn + thời lượng) — xem trước video A rồi lưu video B ⇒ không khớp;
 *   · băm TẬP TÁC ĐỘNG (`bamTapTacDong`) — ai bị ảnh hưởng và ở trạng thái nào lúc xem trước.
 * Server KIỂM LẠI trong giao dịch, SAU khoá dòng bài, trên tập tác động tính lại tại đó. Khác một chữ ⇒ từ chối và đòi xem
 * trước + xác nhận lại. Chuỗi không thể làm giả (không biết khoá), không dùng được cho người khác, bài khác, nguồn khác.
 *
 * ── Cái gì có trong tập tác động ─────────────────────────────────────────────────────────────────────────────
 * Với mỗi hàng tiến độ ở phiên bản hiện tại: mã ghi danh + lớp (đang học / đã kết thúc) + ba trạng thái (chưa xem / xong /
 * đang xem). KHÔNG có `coveredSec` hay mốc thời gian: chúng đổi từng nhịp, đưa vào là người đang xem làm xác nhận hỏng sau
 * 15 giây — ta hỏi "AI bị ảnh hưởng", không hỏi "đã xem được bao nhiêu giây".
 *
 * Module THUẦN: không DB, không `server-only` (test + form cùng đọc kiểu dữ liệu).
 */

export const XAC_NHAN_TTL_MS = 15 * 60 * 1000;

export type NoiDungXacNhan = {
  lessonId: string;
  userId: string;
  /** `TrnLesson.mediaRevision` lúc xem trước. */
  rev: number;
  /** `bamNguonMoi`. */
  nguon: string;
  /** `bamTapTacDong`. */
  dau: string;
};

type Payload = NoiDungXacNhan & { v: 1; exp: number };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Băm NGUỒN MỚI: nhận dạng nguồn (mã YouTube / khoá tệp) + thời lượng. Không lộ ra ngoài (chỉ nằm trong chuỗi ký). */
export function bamNguonMoi(moi: NguonBai): string {
  return sha256(`${nhanDangNguon(moi) ?? "-"}|${moi.durationSec ?? "-"}`);
}

export type DongTacDong = {
  enrollmentId: string;
  /** H = lượt đang học (bị đặt lại) · B = lượt đã kết thúc (đóng băng). */
  lop: "H" | "B";
  /** N = hàng chưa xem · D = DONE · I = đang xem. */
  tienDo: "N" | "D" | "I";
};

/** Băm TẬP TÁC ĐỘNG: sắp theo mã ghi danh để thứ tự câu tra không làm đổi dấu; thêm số câu hỏi chèn. */
export function bamTapTacDong(dong: readonly DongTacDong[], soCauHoiChen: number): string {
  const xep = [...dong].sort((a, b) => (a.enrollmentId < b.enrollmentId ? -1 : a.enrollmentId > b.enrollmentId ? 1 : 0));
  return sha256(`${xep.map((d) => `${d.enrollmentId}:${d.lop}${d.tienDo}`).join(",")}|cue:${soCauHoiChen}`);
}

function ky(body: string): string {
  return createHmac("sha256", getSigningSecret()).update(`elxn:${body}`).digest("base64url");
}

export function kyXacNhan(nd: NoiDungXacNhan, now = Date.now(), ttlMs = XAC_NHAN_TTL_MS): string {
  const payload: Payload = { v: 1, ...nd, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${ky(body)}`;
}

export type LyDoXacNhanSai =
  | "THIEU"
  | "HONG"
  | "HET_HAN"
  | "KHAC_NGUOI"
  | "KHAC_BAI"
  | "KHAC_PHIEN_BAN"
  | "KHAC_NGUON"
  | "TAC_DONG_DA_DOI";

export type KetQuaKiemXacNhan = { ok: true } | { ok: false; ly: LyDoXacNhanSai };

/**
 * Kiểm xác nhận với NỘI DUNG HIỆN TẠI (tính lại trong giao dịch). Thứ tự: chữ ký → hạn → người → bài → phiên bản → nguồn →
 * tập tác động. Chỉ `TAC_DONG_DA_DOI` nghĩa là "mọi thứ khác đúng nhưng người bị ảnh hưởng đã khác" — form xử lý riêng
 * (xem trước lại, không báo lỗi chung chung).
 */
export function kiemXacNhan(
  token: string | null | undefined,
  hienTai: NoiDungXacNhan,
  now = Date.now(),
): KetQuaKiemXacNhan {
  if (!token || typeof token !== "string") return { ok: false, ly: "THIEU" };
  const cham = token.indexOf(".");
  if (cham <= 0 || cham === token.length - 1) return { ok: false, ly: "HONG" };
  const body = token.slice(0, cham);
  const chuKy = Buffer.from(token.slice(cham + 1));
  const mong = Buffer.from(ky(body));
  if (chuKy.length !== mong.length || !timingSafeEqual(chuKy, mong)) return { ok: false, ly: "HONG" };

  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, ly: "HONG" };
  }
  if (p?.v !== 1 || typeof p.exp !== "number") return { ok: false, ly: "HONG" };
  if (now > p.exp) return { ok: false, ly: "HET_HAN" };
  if (p.userId !== hienTai.userId) return { ok: false, ly: "KHAC_NGUOI" };
  if (p.lessonId !== hienTai.lessonId) return { ok: false, ly: "KHAC_BAI" };
  if (p.rev !== hienTai.rev) return { ok: false, ly: "KHAC_PHIEN_BAN" };
  if (p.nguon !== hienTai.nguon) return { ok: false, ly: "KHAC_NGUON" };
  if (p.dau !== hienTai.dau) return { ok: false, ly: "TAC_DONG_DA_DOI" };
  return { ok: true };
}
