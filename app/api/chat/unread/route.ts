import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { countChatUnreadForUser } from "@/lib/chat/unread";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TỔNG chưa đọc của CHÍNH người đang đăng nhập — badge "Tin nhắn" trên nav của cả 3 site
 * gọi lại đường này mỗi khi kênh `user:{id}` báo `conversation.bumped`.
 *
 * Vì sao là GET route chứ KHÔNG phải Server Action: Server Action đi qua bộ máy RSC, mỗi
 * lời gọi có nguy cơ kéo theo re-render tuyến đang mở — badge nhảy vài lần/phút mà lần
 * nào cũng render lại trang là tự bắn vào chân. Route handler `no-store` là đường phẳng,
 * không đụng Router Cache / Full Route Cache, và có tiền lệ ngay trong repo
 * (`/api/admin/notifications/bell`).
 *
 * ⚠️ `userId` LẤY TỪ PHIÊN, không bao giờ nhận từ query — nếu không thì đây là oracle
 * đếm hộ người khác. Con số đã lọc quyền sẵn trong `listConversationsForUser`
 * (`leftAt IS NULL` + BR-04), payload không mang bất kỳ thông tin nhận dạng nào (BR-30).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // Khoá theo userId (không phải IP: nhiều PH sau chung NAT); fail-soft (Upstash →
  // memory) như các route khác.
  //
  // Trần 150/phút chứ không phải 60: bộ gom cụm ở client là biến MỨC MODULE nên **mỗi tab
  // một bộ riêng**, trần 1 lượt/3s ⇒ 20 lượt/phút/tab. Nhân viên mở 4 tab admin (thói quen
  // rất thường) là chạm 80 và bắt đầu ăn 429 — mà lỗi đó bị client nuốt êm (giữ số cũ,
  // không báo gì), nên hiện tượng duy nhất người dùng thấy là badge đóng băng không rõ lý
  // do. 150 cho 7 tab thở thoải mái, và mỗi lượt nay chỉ còn MỘT câu SQL đếm.
  const rl = await rateLimit({
    key: `chat:unread:${session.user.id}`,
    max: 150,
    windowMs: 60_000,
  });
  if (!rl.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Thao tác quá nhanh — thử lại sau ít giây" },
      },
      { status: 429 },
    );
  }

  const total = await countChatUnreadForUser(session.user.id);
  return NextResponse.json({ total }, { headers: { "Cache-Control": "no-store" } });
}
