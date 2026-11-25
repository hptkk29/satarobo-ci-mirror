// Khoá VAPID (RFC 8292) — sinh cặp khoá + kiểm hình dạng.
//
// THUẦN: chỉ `node:crypto`, không DB, không mạng, không secret nằm trong file. Test bằng
// Vitest không cần gì thêm.
//
// ⚠️ CHỈ CHẠY PHÍA NODE — dùng `node:crypto` và `Buffer`. Next 16 KHÔNG polyfill hai thứ đó cho
// bundle client, nên import file này (hoặc `./subscription`, vốn dùng `giaiBase64Url`) từ một
// Client Component sẽ ném `ReferenceError` ngay lúc nạp: trang trắng, server không thấy lỗi gì.
//
// ⚠️ CỐ Ý KHÔNG `import "server-only"`: file này được `scripts/tao-khoa-vapid.ts` gọi dưới
// `tsx` (ngoài Next), mà gói `server-only` ném lỗi ngay lúc nạp module ở môi trường đó.
// An toàn vì file KHÔNG chứa và KHÔNG đọc khoá riêng — nó chỉ sinh và kiểm hình dạng.
//
// VÌ SAO KHÔNG THÊM GÓI `web-push` Ở ĐỢT 1: đã đo trong worktree này (Node v25.9.0) —
// `generateKeyPairSync("ec", { namedCurve: "prime256v1" })` cộng vài dòng ghép byte là ra
// đúng khuôn Web Push. Thêm dependency chỉ để sinh một cặp khoá chạy một lần là đổi
// lockfile lấy không gì cả. Việc ký JWT VAPID lúc GỬI là chuyện của đợt sau, quyết riêng
// ở đó (repo đã có sẵn `jose`).

import { createECDH, createHash, generateKeyPairSync } from "node:crypto";

/** Khoá công khai P-256 dạng điểm không nén: 1 byte tiền tố + 32 byte X + 32 byte Y. */
export const DO_DAI_KHOA_CONG_KHAI_BYTE = 65;
/** Khoá riêng P-256: đúng 32 byte. */
export const DO_DAI_KHOA_RIENG_BYTE = 32;
/** Tiền tố của điểm EC KHÔNG NÉN. Push service từ chối điểm nén. */
const TIEN_TO_DIEM_KHONG_NEN = 0x04;

/** base64url: chữ, số, `-`, `_`, KHÔNG có `=` đệm, KHÔNG có `+` `/`. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface CapKhoaVapid {
  /** Dán vào `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. 87 ký tự base64url. */
  publicKey: string;
  /** Dán vào `VAPID_PRIVATE_KEY`. 43 ký tự base64url. TUYỆT ĐỐI không ghi ra file trong repo. */
  privateKey: string;
}

/**
 * Đệm trái về đúng `soByte`.
 *
 * Bắt buộc, không phải phòng xa: JWK theo RFC 7518 §6.2.1.2 yêu cầu toạ độ dài đúng kích
 * thước trường (32 byte với P-256), nhưng nếu một bản Node nào đó cắt số 0 đứng đầu thì
 * chuỗi ghép ra sẽ ngắn 1–2 byte và push service trả 400 ở tận môi trường thật — lỗi
 * hiếm theo xác suất (~1/256 mỗi toạ độ) nên gần như chắc chắn lọt qua mọi lần thử tay.
 */
function demTrai(buf: Buffer, soByte: number): Buffer {
  if (buf.length === soByte) return buf;
  if (buf.length > soByte) throw new Error(`Toạ độ dài ${buf.length} byte, quá ${soByte}`);
  return Buffer.concat([Buffer.alloc(soByte - buf.length, 0), buf]);
}

/** Sinh một cặp khoá VAPID mới. Chạy một lần cho mỗi môi trường. */
export function taoCapKhoaVapid(): CapKhoaVapid {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  const jwkCong = publicKey.export({ format: "jwk" }) as { x?: string; y?: string };
  const jwkRieng = privateKey.export({ format: "jwk" }) as { d?: string };

  if (!jwkCong.x || !jwkCong.y || !jwkRieng.d) {
    throw new Error("Node không trả đủ toạ độ JWK cho khoá P-256");
  }

  const x = demTrai(Buffer.from(jwkCong.x, "base64url"), 32);
  const y = demTrai(Buffer.from(jwkCong.y, "base64url"), 32);
  const d = demTrai(Buffer.from(jwkRieng.d, "base64url"), DO_DAI_KHOA_RIENG_BYTE);

  const diem = Buffer.concat([Buffer.from([TIEN_TO_DIEM_KHONG_NEN]), x, y]);

  return { publicKey: diem.toString("base64url"), privateKey: d.toString("base64url") };
}

/** Giải base64url về Buffer, trả null nếu chuỗi không đúng bảng chữ cái. */
export function giaiBase64Url(s: string): Buffer | null {
  if (!s || !BASE64URL.test(s)) return null;
  const buf = Buffer.from(s, "base64url");
  // Buffer.from KHÔNG ném khi gặp ký tự lạ — nó bỏ qua im lặng. Đối chiếu ngược là cách
  // duy nhất biết chuỗi vào có thật sự là base64url hay không.
  return buf.toString("base64url") === s ? buf : null;
}

/** Khoá công khai có đúng hình dạng để đưa cho trình duyệt làm `applicationServerKey` không. */
export function laKhoaCongKhaiVapidHopLe(s: string): boolean {
  const buf = giaiBase64Url(s);
  return (
    buf !== null && buf.length === DO_DAI_KHOA_CONG_KHAI_BYTE && buf[0] === TIEN_TO_DIEM_KHONG_NEN
  );
}

/** Khoá riêng có đúng hình dạng để ký JWT VAPID không. */
export function laKhoaRiengVapidHopLe(s: string): boolean {
  const buf = giaiBase64Url(s);
  return buf !== null && buf.length === DO_DAI_KHOA_RIENG_BYTE;
}

/**
 * Suy khoá CÔNG KHAI từ khoá RIÊNG. Trả null nếu khoá riêng không hợp lệ.
 *
 * ── VÌ SAO CẦN, VÀ VÌ SAO NÓ KHÔNG THỪA ───────────────────────────────────────────────
 * Hai nửa của cặp khoá VAPID có HAI VÒNG ĐỜI KHÁC NHAU, và đó không phải lựa chọn của ta:
 *  · `VAPID_PRIVATE_KEY` là biến RUNTIME — đổi trên Vercel là lượt gọi kế đã thấy giá trị mới;
 *  · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` bị Next thay bằng CHUỖI LITERAL lúc BUILD, cho cả bundle
 *    server chứ không riêng client (`define-env.js` spread `nextPublicEnv` không phân biệt
 *    client/node-server). Đổi biến này mà không deploy lại thì server vẫn ký bằng giá trị cũ.
 *
 * Hệ quả: người vận hành xoay khoá bằng cách sửa hai biến rồi KHÔNG deploy — thao tác trông
 * hoàn toàn hợp lý — sẽ có khoá riêng MỚI ghép với khoá công khai CŨ. Push service kiểm đúng
 * cặp đó và trả 403 `VapidPkHashMismatch` cho MỌI thiết bị. Với luật của engine, 403 là CHẾT
 * ngay lượt đầu ⇒ toàn bộ hàng đợi chuyển `DEAD` trong vài phút, không một thông báo nào tới
 * ai, và triệu chứng duy nhất là im lặng.
 *
 * So khoá suy ra với khoá đã khai biến ca đó từ "im lặng" thành một dòng lỗi nói thẳng.
 *
 * Dùng `createECDH` chứ không import JWK: Node đòi đủ `x`,`y`,`d` mới nhập được khoá riêng EC
 * theo JWK, tức phải đã biết khoá công khai — đúng thứ đang cần suy ra.
 */
export function khoaCongKhaiTuKhoaRieng(privateKey: string): string | null {
  const d = giaiBase64Url(privateKey);
  if (!d || d.length !== DO_DAI_KHOA_RIENG_BYTE) return null;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(d);
    // Mặc định của `getPublicKey()` là điểm KHÔNG NÉN (tiền tố 0x04) — đúng khuôn Web Push.
    return ecdh.getPublicKey().toString("base64url");
  } catch {
    // Khoá riêng đúng độ dài nhưng nằm ngoài miền hợp lệ của đường cong.
    return null;
  }
}

/**
 * `VAPID_SUBJECT` phải là `mailto:` hoặc `https:` (RFC 8292 §2.1) — push service dùng nó
 * để liên hệ khi hạ tầng của ta gây sự cố. Trả về chuỗi đã chuẩn hoá, hoặc null nếu sai.
 *
 * Đặt một địa chỉ KHÔNG ai đọc cũng tệ ngang đặt sai: ngày Google bóp kênh, thư cảnh báo
 * đi vào hư không và triệu chứng duy nhất ta thấy là push im lặng.
 */
/**
 * Nhãn phiên bản khoá, SUY TỪ CHÍNH KHOÁ đang chạy — 8 ký tự hex đầu của SHA-256 khoá công khai.
 *
 * Vì sao không để người vận hành tự tăng "v1" → "v2": cột `WebPushSubscription.vapidKeyId` được
 * biện minh là "ngày xoay khoá mới phân biệt được KHOÁ ĐỔI với NGƯỜI DÙNG GỠ QUYỀN". Nếu giá trị
 * phụ thuộc trí nhớ thì đúng ngày cần nó nhất, nó sẽ nói dối: người vận hành xoay khoá trên
 * Vercel (đúng thao tác được hướng dẫn) mà không ai sửa code ⇒ mọi dòng cũ VÀ mọi dòng mới đều
 * mang "v1", 403 VapidPkHashMismatch nổ hàng loạt và cột này không phân biệt được gì. Không
 * test/lint nào bắt được ca đó.
 *
 * Suy từ khoá thì xoay khoá là nhãn TỰ đổi, không cần ai nhớ gì. Đợt 3 gọi hàm này lúc ghi đăng ký.
 *
 * Không phải bí mật: đây là băm của khoá CÔNG KHAI, và chỉ lấy 8 ký tự đầu — đủ phân biệt các
 * lần xoay khoá, không đủ để dựng lại gì.
 */
export function vapidKeyIdTuKhoa(publicKey: string): string {
  return createHash("sha256").update(publicKey, "utf8").digest("hex").slice(0, 8);
}

export function chuanHoaVapidSubject(s: string): string | null {
  const v = s.trim();
  if (v.startsWith("mailto:")) return v.length > "mailto:".length ? v : null;
  if (v.startsWith("https://")) return v.length > "https://".length ? v : null;
  return null;
}
