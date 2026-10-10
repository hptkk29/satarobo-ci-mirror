// TỔNG chưa đọc của hệ chat MỚI — nguồn số cho badge "Tin nhắn" trên thanh điều hướng
// của CẢ BA site (admin, site giáo viên, portal phụ huynh).
//
// Vì sao nằm ở `lib/chat/` chứ không phải trong route group `(portal)`: badge của admin
// và site GV cũng cần đúng con số này; import chéo route group vừa sai ranh giới vừa
// kéo theo cả cây phụ thuộc của portal.
//
// Thay `countUnreadForParent` (`lib/conversation/service.ts`) của hệ `ConversationMessage`
// cũ: tab tin nhắn nay đọc hệ `Conversation/Message`, để badge chạy nguồn cũ thì con số
// trên nav và nội dung trong tab là hai thế giới khác nhau. Hệ cũ vẫn còn nguyên trong
// repo (chốt Q3 — thay ở route, không xoá code).
//
// Dùng lại `listConversationsForUser` thay vì viết SQL đếm riêng: chỉ có MỘT định nghĩa
// "hội thoại của tôi" cho cả badge lẫn màn danh sách — hai định nghĩa là hai con số lệch
// nhau. Nó cũng đã lọc sẵn `leftAt IS NULL` và BR-04 (ARCHIVED > 90 ngày biến mất khỏi
// danh sách của PH), nên badge không bao giờ đếm một hội thoại mà người dùng không mở được.
//
// `withPreview: false` — badge chỉ cần con số, không cần dòng tin cuối. Bỏ được hẳn truy
// vấn `DISTINCT ON` quét Message của tới 500 hội thoại rồi bị vứt đi. Đường này chạy ở
// layout của cả 3 site VÀ ở mỗi lượt `GET /api/chat/unread` (nhiều lượt/phút khi lớp đang
// nhắn), nên phần lãng phí đó không nhỏ.
//
// `limit: MAX` — badge phải đếm ĐỦ. Mặc định 100 sẽ làm quản lý cơ sở có hơn 100 nhóm lớp
// bị đếm thiếu, và đếm thiếu thì không ai phát hiện được bằng mắt.
//
// ⚠️ `listConversationsForUser` đọc bằng `db` TRẦN, KHÔNG scopedDb (luật E-bis #5 — dẫn
// xuất thành viên là thao tác mức hệ thống). Đừng bọc scopedDb ở đây: GV dạy chéo cơ sở
// sẽ mất sạch hội thoại một cách im lặng.

import { listConversationsForUser, MAX_CONVERSATION_LIMIT } from "@/lib/chat/queries";

export async function countChatUnreadForUser(userId: string): Promise<number> {
  const list = await listConversationsForUser(userId, {
    limit: MAX_CONVERSATION_LIMIT,
    withPreview: false,
  });
  return list.reduce((sum, c) => sum + c.unreadCount, 0);
}
