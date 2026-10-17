// Chuyển khoá công khai VAPID sang định dạng trình duyệt cần — Web Push Đợt 3.
//
// ⚠️ FILE NÀY CHẠY Ở TRÌNH DUYỆT. Cố ý KHÔNG dùng `Buffer` và KHÔNG import từ
// `lib/push/vapid.ts` hay `lib/push/subscription.ts` — hai file đó là NODE-ONLY (dùng `Buffer`,
// mà Next 16 không polyfill cho bundle client). Import nhầm là `ReferenceError` ngay lúc nạp
// module: trang trắng, và server không thấy lỗi gì.
//
// Vì thế ở đây có một bản kiểm hình dạng SONG SONG với `laKhoaCongKhaiVapidHopLe` của `vapid.ts`.
// Trùng lặp là CÓ CHỦ ĐÍCH và được test khoá hai đầu: một bản cho Node, một bản cho trình duyệt.

/** Điểm P-256 không nén: 1 byte tiền tố + 32 byte X + 32 byte Y. */
export const DO_DAI_KHOA_BYTE = 65;
const TIEN_TO_DIEM_KHONG_NEN = 0x04;

/**
 * base64url (87 ký tự) → `Uint8Array` (65 byte), cho `pushManager.subscribe({ applicationServerKey })`.
 *
 * Ném khi chuỗi hỏng — gọi trong try/catch. Thà ném ở đây còn hơn để `subscribe()` ném một
 * `DOMException` không nói gì về nguyên nhân.
 *
 * `87 % 4 = 3` nên phải đệm đúng MỘT dấu `=`; thiếu bước đệm thì `atob` ném "String contains an
 * invalid character" và triệu chứng trông như "khoá sai" trong khi khoá vẫn đúng.
 */
export function khoaVapidSangBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const dem = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const b64 = (base64Url + dem).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Dựng từ một `ArrayBuffer` TƯỜNG MINH, không phải `new Uint8Array(length)`: từ TS 5.7
  // `Uint8Array` mang tham số kiểu buffer, và bản suy ra mặc định là `ArrayBufferLike` —
  // `pushManager.subscribe({ applicationServerKey })` chỉ nhận `ArrayBuffer`, nên bản kia
  // không gán được và tsc đỏ ngay tại chỗ gọi chứ không phải ở đây.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Khoá có đúng hình dạng để đưa cho trình duyệt không.
 *
 * Kiểm TRƯỚC khi gọi `subscribe`: biến `NEXT_PUBLIC_VAPID_PUBLIC_KEY` được nhúng lúc build, nên
 * một giá trị rỗng/sai (vd đặt nhầm biến Sensitive trên Vercel) sẽ tới đây dưới dạng chuỗi rỗng
 * hoặc `undefined` — bắt tại đây thì màn hình nói được "chưa cấu hình khoá", bắt ở `subscribe`
 * thì chỉ có một lỗi trình duyệt vô nghĩa.
 */
export function laKhoaVapidHopLeOClient(base64Url: string | undefined | null): boolean {
  if (!base64Url) return false;
  let bytes: Uint8Array;
  try {
    bytes = khoaVapidSangBytes(base64Url);
  } catch {
    return false;
  }
  return bytes.length === DO_DAI_KHOA_BYTE && bytes[0] === TIEN_TO_DIEM_KHONG_NEN;
}

/**
 * Băm endpoint Ở TRÌNH DUYỆT — bản song song của `bamEndpoint` trong `lib/push/ket-qua.ts`.
 *
 * ── VÌ SAO CẦN ────────────────────────────────────────────────────────────────────────────
 * Màn "Thiết bị nhận thông báo" phải đánh dấu được dòng nào là MÁY NÀY. Trước Đợt 5 nó so
 * `tb.endpoint === endpointCuaMayNay`, mà muốn so được thì server phải gửi endpoint ĐẦY ĐỦ
 * của MỌI thiết bị xuống HTML — và chính việc đó biến lỗ "chiếm đăng ký" từ lý thuyết thành
 * khả thi (endpoint đọc được ngay trong mã trang). Nay server chỉ gửi BĂM, client tự băm
 * endpoint của mình rồi so — vẫn chính xác tuyệt đối, mà không có chuỗi nào gửi lại được.
 *
 * ⚠️ PHẢI KHỚP TỪNG BYTE với `bamEndpoint` phía Node (sha256, hex, 16 ký tự đầu). Lệch một
 * byte là màn hình không bao giờ nhận ra máy đang dùng, và triệu chứng ("không thấy nhãn máy
 * này") trông y hệt "chưa đăng ký" — người dùng sẽ bấm bật lại lần nữa. Có test so hai bản.
 *
 * `crypto.subtle` chỉ tồn tại trong secure context (https / localhost) — đúng điều kiện mà
 * Web Push vốn đã đòi, nên không có ca "trang chạy được mà hàm này không". Vẫn trả `null` thay
 * vì ném: mất nhãn "máy này" là khuyết điểm hiển thị, không phải lý do làm vỡ cả màn hình.
 */
export async function bamEndpointOClient(endpoint: string): Promise<string | null> {
  if (!endpoint || typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(endpoint);
    const bam = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(bam)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return null;
  }
}
