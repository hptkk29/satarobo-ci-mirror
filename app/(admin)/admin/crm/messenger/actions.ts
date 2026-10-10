"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { guiTraLoiMessenger } from "@/lib/crm/messenger-send";
import type { KetQuaTraLoiUI } from "@/lib/crm/messenger-reply-result";

// R1-03 — reply 1 hội thoại. Chặn IDOR qua scopedDb.
//
// ─── S-2b (27/08/2026) — NAY GỬI THẬT ────────────────────────────────────────
// Bản trước ghi một dòng `MessengerMessage` hướng OUT rồi trả `{ ok: true }` trong khi
// kho KHÔNG có lời gọi nào ra Meta Send API: người trực tin là đã trả lời, khách không
// nhận gì. S-2a (25/08) chặn cứng đường này để thôi nói dối; nay đường thật đã có
// (`lib/crm/messenger-send.ts`) nên chốt chặn được gỡ.
//
// Kết quả trả về CÓ BA nhánh, không phải hai — `daGuiThat` là thứ phân biệt "đã gửi"
// với "đã ghi sổ nhưng khách KHÔNG nhận" (chế độ mô phỏng). Giao diện phải đọc cờ đó,
// đừng suy từ `ok` (chính chỗ đó đẻ ra cái toast "Đã gửi" sai suốt mấy tháng).
export async function replyAction(conversationId: string, text: string): Promise<KetQuaTraLoiUI> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // RBAC gate: gửi tin = tương tác lead → cần quyền sửa lead (không chỉ đăng nhập).
  if (!(await checkPermission("leads:edit"))) return { ok: false, error: "Không có quyền" };

  const noiDung = text?.trim() ?? "";
  if (!noiDung) return { ok: false, error: "Nội dung trống" };

  const actor = await resolveActor(session.user.id);
  // Chỉ reply hội thoại trong phạm vi cơ sở của actor.
  const conv = await scopedDb(actor).messengerConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) return { ok: false, error: "Không có quyền với hội thoại này" };

  let kq: Awaited<ReturnType<typeof guiTraLoiMessenger>>;
  try {
    kq = await guiTraLoiMessenger({
      conversationId,
      text: noiDung,
      sentByUserId: session.user.id,
    });
  } catch (err) {
    // Hỏng ngoài dự tính (DB rớt giữa chừng, lỗi lập trình) không được vọt lên thành
    // màn lỗi 500 câm ở hộp thư — người trực cần biết tin CHƯA đi để còn gọi điện.
    console.error("[messenger reply] hỏng ngoài dự tính:", err);
    return {
      ok: false,
      error: "Hệ thống gặp lỗi khi gửi. Tin CHƯA tới khách — thử lại hoặc liên hệ kỹ thuật.",
    };
  }

  if (!kq.ok) return { ok: false, error: kq.loi };

  revalidatePath("/admin/crm/messenger");
  return kq.daGuiThat
    ? { ok: true, daGuiThat: true }
    : { ok: true, daGuiThat: false, canhBao: kq.canhBao };
}
