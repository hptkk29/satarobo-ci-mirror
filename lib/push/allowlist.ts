// lib/push/allowlist.ts — loại thông báo nào ĐƯỢC đẩy Web Push. Web Push Đợt 4.
//
// THUẦN: không DB, không mạng, không `server-only`. Đường đọc cấu hình thật nằm ở
// `lib/push/cau-hinh-allowlist.ts` — file này chỉ giữ LUẬT KHỚP và giá trị mặc định.
//
// ── VÌ SAO LÀ DANH SÁCH TRẮNG, KHÔNG PHẢI DANH SÁCH ĐEN ────────────────────────────────
// Chuông nhân sự có ~55 tiền tố `dedupeKey` đang chạy thật và mỗi đợt lại thêm. Nếu mặc định
// là GỬI thì mọi loại thông báo mới ra đời sẽ tự động rung điện thoại của người ta mà không ai
// quyết định điều đó — người thêm một `notifyStaff` cho việc nội bộ hoàn toàn không biết mình
// vừa bật một kênh đẩy. Cái giá của một đợt push rác không phải tiền: người dùng tắt quyền
// thông báo ở CẤP TRÌNH DUYỆT, và code không có cách nào xin lại — nút "Bật thông báo" từ đó
// chỉ hiện dòng "Bạn đã chặn thông báo".
//
// Hai loại đã đo thấy là mìn nếu mở bừa:
//  · `lead.nhap_lai:` nhét `now.getTime()` vào khoá (`lib/lead/assign-lead.ts`) ⇒ khách điền
//    form 10 lần là 10 mục chuông MỚI, không trần nào chặn — 10 lần rung máy.
//  · 4 nơi đang bật `reopen: true` (điểm danh sửa lần hai, v.v.) kéo bản đã đọc về chưa đọc
//    ⇒ mỗi lần sửa là một lần `canRung` ⇒ một lần đẩy.
// Allowlist tự vô hiệu hoá cả hai mà không phải sửa nơi gọi.
//
// ⚠️ BẬT THÊM MỘT LOẠI LÀ QUYẾT ĐỊNH VẬN HÀNH, không phải dọn code. Trước khi bật, trả lời
// được: loại này một ngày sinh bao nhiêu mục cho MỘT người, và người đó có cần biết trong vòng
// một phút không? Không trả lời được thì đừng bật.
//
// ── 13/09/2026 — DANH SÁCH CHUYỂN TỪ HẰNG SỐ SANG THAM SỐ VẬN HÀNH ────────────────────
// Trước đây danh sách là `const` ở ngay file này, nên mỗi lần đổi ý là một lần sửa mã + chờ
// deploy — và chẳng ai ngoài dev đổi được. Nay nó nằm ở `push.tienToDuocDay` (SystemSetting),
// sửa trên `/admin/cau-hinh-van-hanh` có lý do + nhật ký kiểm toán.
//
// Hằng dưới đây KHÔNG còn là "danh sách đang chạy" — nó là GIÁ TRỊ MẶC ĐỊNH khi chưa ai cấu
// hình gì (registry `default`). Đừng đọc nó để trả lời câu "hiện đang đẩy loại nào".

/**
 * Giá trị MẶC ĐỊNH của `push.tienToDuocDay` — đúng danh sách đã chạy trước 13/09/2026, nên DB
 * trống ở bất kỳ môi trường nào cũng ra hành vi cũ y hệt.
 *
 * `lead.moi:` — sale được chia một lead mới. Đây là loại duy nhất mà "chậm 30 phút" có giá
 * thật (khách đang so 3 trung tâm), và tần suất bị chặn sẵn: một lead sinh đúng một mục cho
 * đúng một người, `@@unique([userId, dedupeKey])` lo phần còn lại.
 *
 * `don.cho_duyet:` — THÊM 28/09/2026, chủ dự án chốt (*"gửi luôn đến điện thoại chứ, bấm
 * thông báo ở điện thoại thì nhảy đến đúng đơn cần duyệt luôn"*). Trả lời được hai câu hỏi
 * mà chú thích đầu file bắt trả lời trước khi bật thêm một loại:
 *  · **Một ngày sinh bao nhiêu mục cho MỘT người?** Đúng một mục cho mỗi đơn vướng cổng
 *    duyệt, `dedupeKey = don.cho_duyet:<orderId>` nên `@@unique([userId, dedupeKey])` chặn
 *    lặp. Không có `Date.now()` trong khoá (khác `lead.nhap_lai:` — mìn đã biết), và nơi
 *    gọi KHÔNG bật `reopen` nên sửa đơn lần hai không kéo mục về chưa đọc.
 *  · **Người đó có cần biết trong vòng một phút không?** Có: đơn đang chờ duyệt thì sale
 *    KHÔNG xuất được QR cho khách, tức khách đang ngồi đó mà không trả tiền được. Đây là
 *    loại "chậm 30 phút có giá thật" y như `lead.moi:`.
 *
 * `href` của mục là `/orders/<id>/duyet` (`lib/orders/tin-cho-duyet.ts`), và `duongChoThietBi`
 * trả nguyên đường ấy cho thiết bị đăng ký ở host admin ⇒ bấm trên điện thoại vào thẳng màn
 * duyệt của ĐÚNG đơn đó, không phải danh sách.
 */
export const TIEN_TO_MAC_DINH: readonly string[] = ["lead.moi:", "don.cho_duyet:"];

/**
 * Khoá này có được đẩy push không.
 *
 * ⚠️ `tienTo` KHÔNG CÓ GIÁ TRỊ MẶC ĐỊNH — cố ý, theo luật 7 của repo ("tham số có mặc định
 * nguy hiểm thì bỏ mặc định", và GỬI TIN nằm đúng trong danh sách đó). Nếu tham số này
 * optional thì một nơi gọi quên truyền sẽ lặng lẽ rơi về danh sách mặc định, tức là **bỏ qua
 * cấu hình người vận hành vừa đặt** mà không lỗi, không log, không test nào đỏ. Bắt buộc
 * truyền để `tsc` liệt kê ra đủ mọi nơi gọi — mắt thấy 2, trình biên dịch thấy hết.
 *
 * So bằng TIỀN TỐ chứ không bằng đoạn trước dấu `:` — cố ý trùng cách khoá của
 * `lib/notifications/catalog.ts`. Nếu tách bằng `split(":")[0]` thì `lead.moi` và
 * `lead.moi_gi_do` sẽ khác nhau ở catalog nhưng giống nhau ở đây: hai bảng cùng đọc một khoá
 * mà luật khớp lệch nhau là đúng loại lệch không ai nhìn thấy cho tới lúc gửi nhầm.
 */
export function duocDayPush(dedupeKey: string, tienTo: readonly string[]): boolean {
  if (!dedupeKey) return false;
  return tienTo.some((t) => !!t && dedupeKey.startsWith(t));
}
