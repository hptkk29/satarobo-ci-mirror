import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { rateLimit } from "@/lib/rate-limit";
import {
  CHAT_IMAGE_RULES,
  ChatAttachmentError,
  createChatUploadTicket,
} from "@/lib/chat/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * US-11 bước 1 của F-FILE — cấp signed PUT URL để client upload ảnh thẳng lên R2.
 *
 * Trần cứng `.max(20)` chỉ để zod không phải parse mảng khổng lồ; ngưỡng nghiệp vụ
 * 5 ảnh/tin do `createChatUploadTicket` trả `TOO_MANY_FILES` (413) — mã lỗi đúng
 * F-FILE, không lẫn với 400 "body sai khuôn".
 */
const bodySchema = z.object({
  conversationId: z.string().min(1).max(64),
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(100),
        sizeBytes: z.number(),
        /** base64 của `CHAT_IMAGE_RULES.headBytes` byte đầu file — server sniff magic bytes. */
        headBase64: z.string().max(512),
      }),
    )
    .min(1)
    .max(20),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", 401);
  }

  // Cổng VAI (thô): ai được vào chat — Sale/HR/Kế toán… rụng ngay tại đây
  // (permissions.md: Sale P0 không có quyền chat nào). Cổng THẬT của quyền
  // đọc/gửi là participant-based, enforce trong createChatUploadTicket.
  if (!can(session.user, "chat:read")) {
    return fail("FORBIDDEN", "Không có quyền", 403);
  }

  // Ký URL = việc rẻ nhưng mở đường PUT nhiều GB lên R2 ⇒ phải có trần
  // (SEC-M08, như /api/portal/upload-url). Khoá theo userId chứ không theo IP:
  // nhiều PH chung NAT. 60/phút đủ cho 5 ảnh/tin × nhiều tin liên tiếp.
  const rl = await rateLimit({
    key: `chat:upload:${session.user.id}`,
    max: 60,
    windowMs: 60_000,
  });
  if (!rl.success) {
    return fail("RATE_LIMITED", "Thao tác quá nhanh — thử lại sau ít giây", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("INVALID_INPUT", "Body không phải JSON hợp lệ", 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      400,
    );
  }

  try {
    const { tickets, expiresAt } = await createChatUploadTicket({
      conversationId: parsed.data.conversationId,
      userId: session.user.id,
      files: parsed.data.files,
    });
    return NextResponse.json(
      {
        ok: true,
        data: {
          conversationId: parsed.data.conversationId,
          expiresAt: expiresAt.toISOString(),
          rules: {
            maxSizeBytes: CHAT_IMAGE_RULES.maxSizeBytes,
            maxFilesPerMessage: CHAT_IMAGE_RULES.maxFilesPerMessage,
            headBytes: CHAT_IMAGE_RULES.headBytes,
          },
          files: tickets,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof ChatAttachmentError) {
      if (e.code === "STORAGE_NOT_CONFIGURED") {
        console.error("[chat/upload-url] thiếu env R2");
      }
      return fail(e.code, e.message, e.status);
    }
    console.error("[chat/upload-url]", e);
    return fail("INTERNAL_ERROR", "Không tạo được link tải lên. Thử lại.", 500);
  }
}
