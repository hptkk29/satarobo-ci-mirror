import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api/response";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { kyUrlTaiVe } from "@/lib/elearning/submission-file";
import { khoaThuocLuotNop } from "@/lib/elearning/submission-file-rules";

/**
 * EL-15c — TẢI VỀ một tệp đính kèm của lượt nộp.
 *
 * ⚠️ Đường ĐỌC RIÊNG, không dùng lại vé phát của EL-10. Vé đó buộc
 * `ve.userId === session.user.id`, nên NGƯỜI CHẤM không mở nổi tệp của người khác —
 * mà đọc bài của người khác chính là việc của họ.
 *
 * Hai nhóm được đọc, và chỉ hai:
 *  · CHÍNH CHỦ của lượt nộp;
 *  · người có `elearning:exam:grade` (khoá đã dùng cho chấm bài tập).
 *
 * ⚠️ Lượt nộp đọc QUA `scopedDb` — cách ly cơ sở nằm ở chính lượt đọc đó. Không có
 * nó thì một người chấm ở CS1 tải được bài nộp của CS2, tức đọc dữ liệu nhân sự của
 * cơ sở khác.
 */

export const runtime = "nodejs";

/** Phong bì chuẩn EL-07/C23. */
const loi = (code: string, message: string, status = 400) =>
  fail(code, message, { status });

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return loi("UNAUTHENTICATED", "Chưa đăng nhập", 401);

  const submissionId = req.nextUrl.searchParams.get("luot") ?? "";
  const khoa = req.nextUrl.searchParams.get("khoa") ?? "";
  if (!submissionId || !khoa) return loi("VALIDATION", "Thiếu tham số");

  // ⚠️ So khoá với lượt nộp TRƯỚC khi chạm DB: khoá dạng
  // `elearning/bai-nop/A/../B/x.mp4` bắt đầu bằng tiền tố của A nhưng trỏ vào B.
  if (!khoaThuocLuotNop(khoa, submissionId)) {
    return loi("NOT_FOUND", "Không tìm thấy tệp", 404);
  }

  const actor = await resolveActor(session.user.id);
  const db = scopedDb(actor);
  const lan = await db.trnSubmission.findFirst({
    where: { id: submissionId },
    select: { id: true, userId: true },
  });
  if (!lan) return loi("NOT_FOUND", "Không tìm thấy lượt nộp", 404);

  const chinhChu = lan.userId === session.user.id;
  const nguoiCham = can(actor, "elearning:exam:grade");
  if (!chinhChu && !nguoiCham) {
    return loi("FORBIDDEN", "Không có quyền xem tệp này", 403);
  }

  // URL sống ngắn: hết hạn là hết đường tải, kể cả khi ai đó chép lại đường dẫn.
  const url = await kyUrlTaiVe(khoa, 300);
  return NextResponse.redirect(url);
}
