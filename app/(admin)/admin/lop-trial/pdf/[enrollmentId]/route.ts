// PDF phiếu đánh giá trải nghiệm — bản màn LỚP TRIAL (admin), 27/08/2026.
//
// Luồng: giáo viên chấm rubric ở site giáo viên → Sale mở lớp, thấy nút "Xuất PDF"
// ngay trên dòng điểm danh của em đã được chấm → in đưa phụ huynh.
//
// Vì sao có route thứ BA cho cùng một phiếu (site GV, site Sale, và đây): ba host khác
// nhau, mỗi host một cách gác. Nội dung phiếu vẫn dùng chung `trialEvalPdfResponse` nên
// ba cửa không trôi khác nhau — đó mới là chỗ phải chống trùng, không phải route.
//
// Gác giống bản site Sale: `trials:view` + cách ly cơ sở qua `scopedDb` trong
// `getSaleTrialRubricContext`. Đúng bộ điều kiện mà trang lớp đã dùng để mở màn, nên ai
// vào được lớp thì in được phiếu của chính học viên trong lớp đó.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSaleTrialRubricContext } from "@/lib/trial/sale-roster";
import { trialEvalPdfResponse } from "@/lib/pdf/trial-eval-response";
import { LOI_CHUA_DANH_GIA } from "../../_lib/phieu-danh-gia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (!(await checkPermission("trials:view"))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { enrollmentId } = await params;
  // ⚠️ BẮT BUỘC có `sessionId`. GĐ4 khoá phiếu theo cặp (ca, buổi) nên một ca có nhiều
  // phiếu; thiếu tham số thì route rơi về "phiếu mới nhất" và dòng buổi 1 in ra phiếu
  // buổi 2. Sai phiếu mà trông vẫn bình thường là loại lỗi không ai đi kiểm.
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu buổi học" }, { status: 400 });
  }

  const actor = await resolveActor(session.user.id);
  const ctx = await getSaleTrialRubricContext(actor, enrollmentId, sessionId);
  // `null` = không tồn tại HOẶC ngoài cơ sở của mình — cố ý không phân biệt.
  if (!ctx) {
    return NextResponse.json(
      { error: "Không tìm thấy học viên trải nghiệm" },
      { status: 404 },
    );
  }
  if (!ctx.existing) {
    return NextResponse.json({ error: LOI_CHUA_DANH_GIA }, { status: 404 });
  }

  return trialEvalPdfResponse({
    studentName: ctx.studentName,
    existing: {
      ...ctx.existing,
      scores: ctx.existing.scores as Record<string, number>,
    },
  });
}
