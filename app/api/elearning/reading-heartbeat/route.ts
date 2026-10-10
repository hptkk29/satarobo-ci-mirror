import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { ok, fail } from "@/lib/api/response";
import { ghiNhipDoc } from "@/lib/elearning/reading-progress";

/**
 * EL-04 — NHỊP ĐỌC. Route Handler, KHÔNG phải Server Action.
 *
 * ─── Hai lý do, cả hai đều cứng ──────────────────────────────────────────────
 *  1. `runAction` (`lib/actions/factory.ts`) ghi `writeAudit` VÔ ĐIỀU KIỆN sau
 *     mọi mutation thành công. Nhịp 15 giây × mỗi người đang học ⇒ bảng audit
 *     ngập nhật ký "đã đọc thêm 15 giây", và những dòng audit THẬT SỰ cần đọc
 *     (cấp chứng nhận, gia hạn, thu hồi) chìm trong đó.
 *  2. `navigator.sendBeacon` là cách DUY NHẤT gửi được nhịp cuối lúc rời trang —
 *     trình duyệt huỷ mọi `fetch` đang bay khi unload. Mà `sendBeacon` POST tới
 *     một URL, nó không gọi được Server Action.
 *
 * `markLessonRead` (đặt `verifiedAt`) thì NGƯỢC LẠI — đi qua action factory, vì
 * đó là một dòng chứng từ và ĐÁNG được audit.
 *
 * ⚠️ Route này chịu luật ESLint `elearning/no-bare-next-response`: mọi phản hồi
 * phải qua envelope `lib/api/response.ts`, không `NextResponse.json` trần.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  enrollmentId: z.string().min(1),
  lessonId: z.string().min(1),
  readSeconds: z.coerce.number().int().min(0),
  scrollMaxPct: z.coerce.number().int().min(0).max(100),
  seq: z.coerce.number().int().min(0),
});

/** Mã lỗi → mã HTTP. Mặc định 400; ba mã có ý nghĩa riêng. */
const HTTP: Record<string, number> = {
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  // Quá hạn là XUNG ĐỘT TRẠNG THÁI, không phải dữ liệu sai: client gửi đúng, chỉ
  // là thời điểm không còn hợp lệ. 409 để nhánh xử lý ở client tách được hai ca.
  OVERDUE_LOCKED: 409,
  REVOKED: 409,
  POLICY_NOT_ACCEPTED: 403,
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }

  // `sendBeacon` gửi Blob/text chứ không luôn set Content-Type JSON ⇒ đọc text
  // rồi tự parse. Dùng `req.json()` thẳng sẽ ném với đúng nhịp cuối lúc rời trang
  // — tức mất chính cái nhịp mà `sendBeacon` sinh ra để cứu.
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return fail("VALIDATION", "Nội dung gửi lên không hợp lệ");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", {
      field: issue?.path[0] ? String(issue.path[0]) : undefined,
    });
  }

  const actor = await resolveActor(session.user.id);
  const kq = await ghiNhipDoc({
    actor,
    ...parsed.data,
    now: new Date(),
  });

  if (!kq.ok) {
    return fail(kq.code, kq.message, { status: HTTP[kq.code] ?? 400 });
  }
  return ok({ snapshot: kq.snapshot, done: kq.done });
}
