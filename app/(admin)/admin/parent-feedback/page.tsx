import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Star } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { FeedbackReply } from "./_components/feedback-reply";
import { formatDateVN } from "@/lib/format/date";

export const metadata = { title: "Đánh giá phụ huynh | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminParentFeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("parent-feedback:view"))) redirect("/dashboard");

  // L8.1 — ParentFeedback.studentId là cột phẳng (KHÔNG có relation `student` trong
  // schema) → không thể lọc `where: { student: { centerId: ... } }`. Cách ly 2 bước:
  // lấy id HV trong tầm nhìn actor (qua scopedDb, tái dùng cổng cách ly chuẩn), rồi
  // lọc feedback theo studentId IN [...]. Feedback studentId=null (góp ý chung) chỉ
  // actor global mới thấy — tự rớt khỏi kết quả non-global.
  // Vá 24/07 — "global" theo per-model scope thay isHoLevel trần: chỉ khi actor thấy
  // Student scope ALL (SUPER_ADMIN / HO có quyền students:* toàn hệ thống). HO-role
  // khác chức năng (vd TRAINING@HO) đi nhánh cách ly 2 bước → chỉ feedback HV cơ sở
  // mình (sdb.student đã tự scope per-model), góp ý chung tự rớt theo rule hiện có.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const isGlobal = getModelVisibleCenterIds("Student", actor) === "ALL";

  let where: Prisma.ParentFeedbackWhereInput = {};
  if (!isGlobal) {
    const visibleStudents = await sdb.student.findMany({
      select: { id: true },
    });
    where = { studentId: { in: visibleStudents.map((s) => s.id) } };
  }

  // ParentFeedback ∉ SCOPED_MODELS → sdb pass-through; cách ly nằm ở `where` 2 bước trên.
  const [rows, agg] = await Promise.all([
    sdb.parentFeedback.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    sdb.parentFeedback.aggregate({ where, _avg: { rating: true }, _count: true }),
  ]);

  const avg = agg._avg.rating ? agg._avg.rating.toFixed(1) : "—";

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Đánh giá phụ huynh</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Phản hồi gửi từ portal hocvien.satarobo.vn.
          </p>
          {!isGlobal && (
            <p className="mt-1 text-xs text-muted-foreground">
              Chỉ hiển thị đánh giá của học viên thuộc cơ sở bạn quản lý. Góp ý chung
              (không gắn học viên) chỉ hiển thị cho Hội sở.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-2 text-center">
          <p className="flex items-center gap-1 text-2xl font-bold text-foreground">
            <Star className="h-5 w-5 fill-state-warning-ink text-state-warning-ink" /> {avg}
          </p>
          <p className="text-xs text-muted-foreground">{agg._count} đánh giá</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Chưa có đánh giá nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((f) => (
            <li key={f.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${ i < f.rating ? "fill-state-warning-ink text-state-warning-ink" : "text-muted-foreground" }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateVN(f.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {f.content}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {f.parentName ?? "Phụ huynh"}
                {f.studentName
                  ? ` · HV: ${f.studentName}`
                  : isGlobal
                    ? " · Góp ý chung (chỉ Hội sở thấy)"
                    : ""}
              </p>
              <FeedbackReply
                id={f.id}
                existing={f.adminResponse}
                respondedAt={f.respondedAt ? f.respondedAt.toISOString() : null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
