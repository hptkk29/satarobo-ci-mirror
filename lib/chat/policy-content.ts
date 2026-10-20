// lib/chat/policy-content.ts — US-16 AC2: NỘI DUNG quy định sử dụng chat + version.
//
// ⚠️ Vì sao tách khỏi `lib/chat/policy.ts`: màn chính sách là Client Component (có nút
// bấm), mà `policy.ts` import `@/lib/db` — để chung một file là kéo Prisma vào bundle
// client. File này KHÔNG được import bất cứ thứ gì chạm DB/`server-only`.
//
// Nội dung và `CHAT_POLICY_VERSION` phải đi CÙNG NHAU: sửa chữ mà quên tăng version là
// phụ huynh đã bấm đồng ý bản cũ nhưng sổ ghi là đã đồng ý bản mới.

/**
 * Tăng khi NỘI DUNG chính sách đổi ⇒ mọi phụ huynh phải bấm đồng ý lại; bản ghi cũ giữ
 * nguyên (bằng chứng "lúc đó họ đồng ý với bản nào"). Đặt dạng ngày phát hành cho dễ đối
 * chiếu với biên bản, KHÔNG dùng số thứ tự vô danh.
 */
export const CHAT_POLICY_VERSION = "2026-08-10";

export const CHAT_POLICY_TITLE = "Quy định sử dụng tin nhắn Sata Robo";

/**
 * Mỗi mục = 1 dòng trên màn hình. Viết theo ĐÚNG những gì hệ thống thực sự làm — không
 * hứa thêm (không có mã hoá đầu-cuối, không "chỉ mình bạn đọc được", không tự xoá theo
 * thời gian). Con số trong này neo vào hằng đang chạy trong code:
 *   • 15 phút thu hồi     → `RECALL_WINDOW_MINUTES` (lib/chat/moderation.ts)
 *   • ảnh hạn 5 phút      → `readUrlTtlSeconds: 300` (lib/chat/attachments.ts)
 *   • 90 ngày sau lưu trữ → `ARCHIVED_PARENT_READ_DAYS` (lib/chat/queries.ts)
 * Sửa hằng thì sửa câu chữ ở đây và TĂNG `CHAT_POLICY_VERSION`.
 */
export const CHAT_POLICY: readonly { heading: string; body: string }[] = [
  {
    heading: "Tin nhắn được lưu trên hệ thống của trung tâm",
    body: "Nội dung trao đổi và ảnh gửi trong nhóm lớp được lưu lại trên hệ thống của Sata Robo, không tự xoá sau một khoảng thời gian.",
  },
  {
    heading: "Nhóm lớp là kênh chung, không phải kênh riêng tư",
    body: "Giáo viên phụ trách lớp (gồm cả trợ giảng) và quản lý cơ sở đọc được toàn bộ nội dung trong nhóm lớp của con. Việc riêng, vui lòng nhắn riêng cho giáo viên.",
  },
  {
    heading: "Quản trị viên chỉ tra cứu khi có khiếu nại",
    body: "Khi cần xử lý khiếu nại hoặc sự cố, quản trị viên phải nhập lý do mới mở được nội dung, và mỗi lần mở đều được ghi vết trong nhật ký hệ thống.",
  },
  {
    heading: "Ảnh nằm ở kho riêng, không phát công khai",
    body: "Ảnh gửi trong chat lưu ở kho riêng; chỉ thành viên của nhóm mở được bằng đường dẫn tạm thời, hết hạn sau 5 phút. Ảnh thuộc tin đã gỡ thì không mở được nữa.",
  },
  {
    heading: "Tin đã gửi chỉ tự gỡ được trong 15 phút",
    body: "Sau 15 phút, chỉ giáo viên hoặc quản trị viên mới gỡ được tin trong nhóm. Tin đã gỡ không hiển thị nữa nhưng vẫn được lưu lại để phục vụ xử lý khiếu nại.",
  },
  {
    heading: "Nhóm lớp bám theo dữ liệu lớp học",
    body: "Bạn được thêm vào nhóm khi con vào lớp và rời nhóm khi con không còn học lớp đó. Lớp kết thúc thì nhóm chuyển sang chỉ đọc và không còn hiển thị sau 90 ngày.",
  },
];

/**
 * Câu chốt dưới danh sách. Là lời ĐỀ NGHỊ, không phải cam kết kỹ thuật — hệ thống không
 * chặn được người dùng gõ gì vào ô nhập, nên không viết thành "hệ thống sẽ chặn".
 */
export const CHAT_POLICY_FOOTER =
  "Vui lòng không gửi giấy tờ tuỳ thân, thông tin thẻ hoặc tài khoản ngân hàng qua tin nhắn. Học phí và hồ sơ đi theo kênh riêng của trung tâm.";
