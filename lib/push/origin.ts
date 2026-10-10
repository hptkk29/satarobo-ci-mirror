// Suy ORIGIN của request phía server — Web Push Đợt 3.
//
// THUẦN (nhận sẵn một `Headers`) để test được mà không cần `next/headers`: repo KHÔNG có tiền lệ
// nào `vi.mock("next/headers")` — grep toàn bộ test ra 0 kết quả — nên nhét `headers()` thẳng vào
// hàm này là biến nó thành thứ không ai kiểm được. Server Action chỉ việc gọi `originTuHeaders(await headers())`.
//
// ⚠️ VÌ SAO KHÔNG NHẬN ORIGIN TỪ CLIENT: cột `WebPushSubscription.origin` dùng để trả lời
// "người này bật thông báo ở host nào". Client tự khai thì cột đó thành lời kể chứ không còn là
// số đo — và một client bịa origin có thể làm sổ đăng ký nói sai về phạm vi của cả kênh.

/**
 * Kiểm HÌNH DẠNG host — KHÔNG phải danh sách trắng. Cố ý: thêm một host mới (CS3, một site
 * nội bộ khác) không được phép đòi sửa file này. Việc chặn theo danh sách host là chuyện của
 * `proxy.ts`/`decideRoute`, ở đây chỉ cần chắc chuỗi không nhồi được đường dẫn hay tham số.
 *
 * Hệ quả phải biết: IPv6 dạng `[::1]` KHÔNG khớp (có dấu ngoặc) nên bị loại — chấp nhận được,
 * vì không nhân viên nào đăng nhập qua địa chỉ IPv6 trần.
 */
const HOST_HOP_LE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Dựng `https://host` từ header của request.
 *
 * Ưu tiên `x-forwarded-host` (Vercel đặt khi đi qua proxy) rồi mới tới `host`. Cả hai có thể là
 * DANH SÁCH ngăn bởi dấu phẩy khi đi qua nhiều tầng — lấy phần TỬ ĐẦU, vì đó là host mà trình
 * duyệt thật sự gõ; lấy cả chuỗi thì cột `origin` mang một giá trị không mở được.
 *
 * Trả `null` khi không dựng nổi — nơi gọi tự quyết, đừng bịa một origin mặc định: một origin sai
 * còn tệ hơn một ô trống, vì nó trông như số đo.
 */
export function originTuHeaders(h: { get(name: string): string | null }): string | null {
  const thoHost = h.get("x-forwarded-host") ?? h.get("host");
  if (!thoHost) return null;
  const host = thoHost.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!host || !HOST_HOP_LE.test(host)) return null;

  const thoProto = h.get("x-forwarded-proto");
  const proto = (thoProto?.split(",")[0]?.trim().toLowerCase() ?? "") || suyProtoTuHost(host);
  if (proto !== "http" && proto !== "https") return null;

  return `${proto}://${host}`;
}

/**
 * Không có `x-forwarded-proto` thì đoán theo host: chỉ localhost mới được `http`.
 *
 * Mặc định `https` là fail-safe đúng chiều — Web Push đòi ngữ cảnh bảo mật, nên một origin `http`
 * cho host thật chắc chắn là sai, còn `https` cho localhost thì sẽ không khớp và lộ ra ngay.
 */
function suyProtoTuHost(host: string): string {
  const ten = host.split(":")[0] ?? "";
  return ten === "localhost" || ten === "127.0.0.1" ? "http" : "https";
}
