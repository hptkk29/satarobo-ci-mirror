/**
 * `phoneKey` lưu trong bảng Disc* = HMAC-SHA256 của SĐT chuẩn hoá — KHÔNG sha256 trần (SĐT di động VN chỉ
 * ~10⁹ giá trị, vét cạn trong giây) và KHÔNG SĐT thô (quyết định D2). Miền băm riêng `disc-phone-v1`.
 *
 * ── Khoá băm ("pepper") — N9 ────────────────────────────────────────────────────────────────────────────────
 * `layKhoaDisc()` trả khoá dùng cho MỌI HMAC của DISC (phoneKey · mã nhận · payloadHash · ipKey):
 *   1. `DISC_PEPPER` (env, ≥32 ký tự) nếu đã đặt — vòng đời RIÊNG, tách khỏi secret ký OTP/JWT/vé SCORM. Phiên bản "v1".
 *      (Đổi sang pepper mới = đổi `DISC_PEPPER_VERSION` và làm đợt di trú/tra-hai-khoá riêng; xem 03-data-model §Pepper.)
 *   2. Chưa đặt ⇒ rơi về `getSigningSecret()` (NEXTAUTH_SECRET/AUTH_SECRET). Phiên bản "ns0". ⚠️ Khi đó ĐỔI NEXTAUTH_SECRET
 *      làm mọi bài chưa nhận mất khả năng nhận/xoá-theo-yêu-cầu/đếm trần (fail-closed, KHÔNG báo lỗi). Đặt DISC_PEPPER
 *      TRƯỚC khi nhận dữ liệu thật. Không bao giờ log giá trị khoá.
 * `DISC_PEPPER` được đặt SAU khi đã có bài ⇒ các bài cũ ("ns0") không khớp phoneKey mới: chúng chỉ còn cron hết hạn dọn.
 * Cột `DiscSubmission.pepperVersion` ghi phiên bản đã dùng để đợt di trú biết dòng nào cần xử lý.
 *
 * SĐT thô CHỈ được đi vào: lead (qua `ingestLead`) và OTP. Hàm này nhận SĐT bất kỳ dạng, trả null nếu
 * không phải di động VN hợp lệ.
 */
import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";
import { canonicalPhone } from "@/lib/phone";
import { ipChoRateLimit, laProductionThat } from "@/lib/security/client-ip";
import { getSigningSecret } from "@/lib/security/signing-key";

type Env = Record<string, string | undefined>;

export const DO_DAI_TOI_THIEU_PEPPER = 32;
/** Nhãn phiên bản khi dùng secret ký chung (chưa có DISC_PEPPER). */
export const PEPPER_PHIEN_BAN_DUNG_CHUNG = "ns0";

/**
 * Khoá băm DISC. Ném nếu `DISC_PEPPER` có đặt nhưng yếu (<32 ký tự) — thà lỗi to còn hơn băm bằng khoá yếu mà im lặng.
 *
 * S-08: khi cờ `DISC_ENABLED=true` VÀ là production thật (`laProductionThat`: VERCEL_ENV=production, hoặc NODE_ENV=production
 * và không có CI) mà THIẾU `DISC_PEPPER` ⇒ NÉM, không rơi về secret ký chung (xoay NEXTAUTH_SECRET sẽ âm thầm làm mọi bài chờ
 * mất khả năng nhận/xoá — vi phạm cam kết quyền xoá). Chỉ chạy khi DÙNG khoá (lúc xử lý request), không chạy lúc `next build`
 * hay lúc import; dev/test/CI không bị ảnh hưởng.
 */
export function layKhoaDisc(env: Env = process.env): string {
  const p = env.DISC_PEPPER;
  if (p !== undefined && p !== "") {
    if (p.length < DO_DAI_TOI_THIEU_PEPPER) throw new Error(`DISC_PEPPER phải dài ≥ ${DO_DAI_TOI_THIEU_PEPPER} ký tự`);
    return p;
  }
  if (env.DISC_ENABLED === "true" && laProductionThat(env)) {
    throw new Error("DISC_PEPPER chưa được đặt: DISC đang bật ở production thì bắt buộc có pepper riêng (≥32 ký tự)");
  }
  return getSigningSecret();
}

/** Phiên bản của khoá mà `layKhoaDisc` đang trả: "v1" (hoặc `DISC_PEPPER_VERSION`) khi có pepper riêng, "ns0" khi dùng chung. */
export function phienBanPepper(env: Env = process.env): string {
  const p = env.DISC_PEPPER;
  if (p === undefined || p === "") return PEPPER_PHIEN_BAN_DUNG_CHUNG;
  const v = env.DISC_PEPPER_VERSION;
  return v && /^[A-Za-z0-9_-]{1,16}$/.test(v) ? v : "v1";
}

export function phoneKeyTuSdtChuan(sdtChuan: string, khoa: string): string {
  return createHmac("sha256", khoa).update(`disc-phone-v1:${sdtChuan}`).digest("hex");
}

export function phoneKeyCuaSdt(sdt: unknown, khoa: () => string = layKhoaDisc): string | null {
  const chuan = canonicalPhone(sdt);
  return chuan ? phoneKeyTuSdtChuan(chuan, khoa()) : null;
}

/** HMAC của IP người gõ (miền `disc-ip-v1`) — IP thô không bao giờ vào bảng/khoá đếm. */
export function ipKeyTuIp(ip: string, khoa: string): string {
  return createHmac("sha256", khoa).update(`disc-ip-v1:${ip}`).digest("hex");
}

/**
 * S-04 — khoá giới hạn theo IP: IPv6 gộp về /64 (một máy/một nhà thường được cấp nguyên một /64, tức 2^64 "địa chỉ" khác nhau
 * để xoay vòng qua trần theo IP); IPv4 giữ nguyên; IPv4-mapped (`::ffff:a.b.c.d`) quy về IPv4; chuỗi không phải IP (vd "unknown")
 * giữ nguyên. THUẦN. Mọi route DISC dùng `ipDiscChoGioiHan` (bên dưới), không tự gọi `ipChoRateLimit`.
 */
export function gopIpChoGioiHan(ip: string): string {
  const goc = ip.trim().split("%")[0]!.replace(/^\[|\]$/g, "");
  if (!isIPv6(goc)) return ip.trim();
  let nhom: number[];
  let chuoi = goc.toLowerCase();
  // Đuôi IPv4 nhúng (::ffff:1.2.3.4, ::1.2.3.4) → hai nhóm hex.
  const v4 = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(chuoi);
  if (v4) {
    const o = [v4[2], v4[3], v4[4], v4[5]].map(Number);
    if (o.some((x) => x > 255)) return ip.trim();
    chuoi = `${v4[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const [dau, cuoi, thua] = chuoi.split("::");
  if (thua !== undefined) return ip.trim();
  const tach = (x: string | undefined) => (x ? x.split(":") : []);
  const d = tach(dau);
  const c = cuoi === undefined ? [] : tach(cuoi);
  if (cuoi === undefined) {
    if (d.length !== 8) return ip.trim();
    nhom = d.map((h) => parseInt(h, 16));
  } else {
    const thieu = 8 - d.length - c.length;
    if (thieu < 0) return ip.trim();
    nhom = [...d, ...Array<string>(thieu).fill("0"), ...c].map((h) => parseInt(h, 16));
  }
  if (nhom.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffff)) return ip.trim();
  // IPv4-mapped ::ffff:a.b.c.d
  if (nhom.slice(0, 5).every((x) => x === 0) && nhom[5] === 0xffff) {
    return `${nhom[6]! >> 8}.${nhom[6]! & 255}.${nhom[7]! >> 8}.${nhom[7]! & 255}`;
  }
  return `v6/64:${nhom.slice(0, 4).map((x) => x.toString(16)).join(":")}`;
}

/** IP dùng làm khoá chặn tần suất cho MỌI route DISC (`bo-de` · `luu` · `tai` · `xoa`): `ipChoRateLimit` rồi gộp IPv6 về /64. */
export function ipDiscChoGioiHan(headers: Parameters<typeof ipChoRateLimit>[0]): string {
  return gopIpChoGioiHan(ipChoRateLimit(headers));
}
