"use server";

// US-16 AC2 — phụ huynh bấm "Đồng ý" ở màn chính sách trước khi vào chat.
//
// ⚠️ Luật E-bis #1: file "use server" CHỈ được export async function. Không export type,
// không export hằng — nội dung + version chính sách nằm ở `lib/chat/policy.ts`.
//
// KHÔNG đi `defineAction`/`can()`: đây là hành vi tự-phục-vụ trên chính tài khoản đang
// đăng nhập (giống `setMediaConsentAction` ở /portal/ho-so-con). Không có action nào trong
// `lib/auth/permissions.ts` mô tả "đồng ý điều khoản", và mượn `chat:read` sẽ hỏng trên
// prod: dưới RBAC v2 `chat:read` seed scope CENTER/ASSIGNED nên gọi KHÔNG target luôn trả
// false (lib/auth/can.ts) — xanh ở local, chặn sạch phụ huynh trên prod.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { recordChatPolicyAcceptance } from "@/lib/chat/policy";

export async function acceptChatPolicyAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  await recordChatPolicyAcceptance(session.user.id);

  // "layout" vì cổng chặn nằm ở layout của segment — revalidate mỗi page thì layout vẫn
  // dựng lại màn chính sách và người bấm đồng ý xong bị đá về đúng chỗ cũ.
  revalidatePath("/portal/tin-nhan", "layout");
  return { ok: true };
}
