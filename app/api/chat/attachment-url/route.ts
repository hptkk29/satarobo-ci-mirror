import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can, isParentOnly } from "@/lib/auth/permissions";
import { ChatAttachmentError, getChatAttachmentReadUrl } from "@/lib/chat/attachments";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * US-11 bước 3 của F-FILE — đổi `MessageAttachment.id` lấy signed GET URL hạn
 * 5 phút (AC2). Client tự gọi lại khi ảnh hết hạn.
 *
 * `Cache-Control: no-store` là BẮT BUỘC: response chứa URL đã ký; để CDN/proxy
 * hay bfcache giữ lại thì URL còn sống sau khi người xin đã bị gỡ khỏi nhóm
 * hoặc tin đã bị gỡ — đúng thứ TS-14.3/14.4 đòi phải chặn.
 */
function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  }

  // Cổng VAI (thô) — cổng THẬT là participant guard trong getChatAttachmentReadUrl.
  if (!can(session.user, "chat:read")) {
    return fail("FORBIDDEN", "Không có quyền", 403);
  }

  // US-16 AC2 — phụ huynh CHƯA đồng ý quy định thì server KHÔNG trả nội dung, và ẢNH
  // ĐÍNH KÈM LÀ NỘI DUNG. Thiếu chốt này thì cổng chính sách chỉ chặn được đường HTML:
  // link `/api/chat/attachment-url?id=…` nằm sẵn trong lịch sử trình duyệt / bundle client
  // của phụ huynh đã dùng chat trước khi `CHAT_POLICY_VERSION` được nâng.
  // Chỉ áp cho tài khoản THUẦN phụ huynh (giáo viên/quản lý không bao giờ thấy màn chính
  // sách). Lỗi đọc DB → coi như CHƯA đồng ý (fail-closed) vì đây là cổng nội dung.
  if (isParentOnly(session.user)) {
    const accepted = await hasAcceptedChatPolicy(session.user.id).catch(() => false);
    if (!accepted) {
      return fail(
        "CHAT_POLICY_REQUIRED",
        "Vui lòng đồng ý quy định sử dụng tin nhắn trước khi xem ảnh.",
        403,
      );
    }
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return fail("INVALID_INPUT", "Thiếu tham số id", 400);
  }

  try {
    const r = await getChatAttachmentReadUrl(id, session.user.id);
    return NextResponse.json(
      {
        ok: true,
        data: {
          id,
          url: r.url,
          fileName: r.fileName,
          mimeType: r.mimeType,
          expiresIn: r.expiresIn,
          expiresAt: r.expiresAt.toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof ChatAttachmentError) {
      if (e.code === "STORAGE_NOT_CONFIGURED") {
        console.error("[chat/attachment-url] thiếu env R2");
      }
      return fail(e.code, e.message, e.status);
    }
    console.error("[chat/attachment-url]", e);
    return fail("INTERNAL_ERROR", "Không lấy được ảnh. Thử lại.", 500);
  }
}
