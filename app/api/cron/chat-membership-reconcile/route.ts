import { withCron } from "@/lib/cron/handler";
import { reconcileConversationMembership } from "@/lib/chat/reconcile-membership";
import { reconcileDmConversations } from "@/lib/chat/dm";

export const dynamic = "force-dynamic";

// US-04 — Đối soát thành viên nhóm chat hằng đêm, 02:00 VN (vercel.json: 0 19 * * * UTC).
// Lưới cuối cho drift khi một luồng đổi dữ liệu lớp không đi qua sync (US-03):
// REMOVE tự thi hành (rò rỉ quyền không sống qua đêm), ADD chỉ log chờ người.
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch
// JSON có cấu trúc (API-18). Không auto-retry — đêm sau chạy lại là đủ (cron.md).
// Kill switch: xoá entry cron trên Vercel — hệ chạy tiếp, chỉ mất lưới đối soát.
// US-13 AC3 chạy ké cùng job: DM_TEACHER_PARENT còn ACTIVE mà cặp GV–PH đã hết quan hệ
// dạy học → ARCHIVED (đọc được, không gửi được). Chạy SAU phần nhóm lớp và tách try/catch
// riêng: DM hỏng không được xoá sổ kết quả đối soát nhóm lớp vừa làm xong.
export const GET = withCron("chat-membership-reconcile", async () => {
  const classes = await reconcileConversationMembership();
  let dm: Awaited<ReturnType<typeof reconcileDmConversations>> | { error: string };
  try {
    dm = await reconcileDmConversations();
  } catch (err) {
    console.error("[chat-reconcile] ERROR khi đối soát DM", err);
    dm = { error: "DM_RECONCILE_FAILED" };
  }
  return { ok: true, data: { ...classes, dm } };
});
