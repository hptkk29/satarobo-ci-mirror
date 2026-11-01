// /duyet-media — CỔNG DUYỆT ẢNH/VIDEO của QLCS (BA MEDIA-REVIEW, 26/08/2026).
//
// Hai mức trên MỘT route, phân biệt bằng `?sessionId=` — cùng nếp với Class Hub của site
// giáo viên. Không tách 4 route riêng như BA phác (M1–M4): mỗi lần vào/ra một mức là một
// lượt tải trang, mà QLCS duyệt liên tục hàng chục lớp mỗi sáng.
//
//   (a) không tham số  → M1 + M2: cây NGÀY → LỚP còn phải xử lý
//   (b) ?sessionId=…   → M3 lưới media của buổi + M4 xem từng ảnh (lớp phủ, client)
//
// ⚠️ Cây dựng từ LỊCH HỌC chứ không từ kho ảnh — xem ghi chú dài ở lib/media-review/tree.ts.
import { redirect } from "next/navigation";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { getReviewTree } from "@/lib/media-review/tree";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import { ReviewTree } from "./_components/review-tree";
import { SessionMediaPanel, type ReviewMediaItem } from "./_components/session-media-panel";

export const metadata = { title: "Duyệt ảnh lớp học | Admin" };

export default async function DuyetMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Quyền DUYỆT chứ không phải quyền xem ảnh: đây là màn ra quyết định, không phải thư viện.
  if (!(await checkAnyPermission(PAGE_GATES["/duyet-media"]))) redirect("/dashboard");

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const { sessionId } = await searchParams;

  // ── (b) Lưới media của một buổi ────────────────────────────────────────────
  if (sessionId) {
    const ses = await sdb.classSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        classId: true,
        date: true,
        topic: true,
        plan: { select: { customTitle: true, order: true } },
        lesson: { select: { order: true, title: true, moduleCode: true } },
        class: { select: { name: true, classCode: true } },
      },
    });
    if (!ses) {
      return (
        <NotYours note="Buổi học không tồn tại hoặc không thuộc cơ sở của bạn." />
      );
    }

    const [rows, review, allOfClass] = await Promise.all([
      // Lấy cả REJECTED để QLCS thấy "thùng rác" của buổi và khôi phục được trong 7 ngày.
      sdb.mediaAsset.findMany({
        where: { classSessionId: ses.id, status: { in: ["PENDING", "APPROVED", "REJECTED"] } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          r2Key: true,
          thumbKey: true,
          status: true,
          durationSec: true,
          watchedRatio: true,
          uploadedByName: true,
        },
      }),
      sdb.sessionMediaReview.findUnique({
        where: { classSessionId: ses.id },
        select: { status: true, noMediaReason: true, decidedByName: true, deadlineAt: true },
      }),
      sdb.classSession.findMany({
        where: { classId: ses.classId },
        select: { id: true, classId: true, date: true },
      }),
    ]);

    // `resolveMediaUrl` chứ không `signedMediaUrl` trần: cờ MEDIA_SIGNED_URL quyết định
    // ký hay không, và nó fail-safe — ký hỏng thì trả URL gốc thay vì ném vỡ cả trang.
    // `r2Key` ở đây lưu nguyên fileUrl (cùng giá trị với dòng ClassSessionMedia song sinh),
    // đúng thứ hàm này nhận.
    const items: ReviewMediaItem[] = await Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        type: m.type,
        url: await resolveMediaUrl(m.r2Key),
        thumbUrl: m.thumbKey ? await resolveMediaUrl(m.thumbKey) : null,
        status: m.status,
        durationSec: m.durationSec,
        watchedRatio: m.watchedRatio,
        uploadedByName: m.uploadedByName,
      })),
    );

    const label =
      deriveSessionLabel({
        sessionNumber: buildSessionNumberMap(allOfClass).get(ses.id) ?? null,
        planTitle: ses.plan?.customTitle,
        planOrder: ses.plan?.order,
        lessonTitle: ses.lesson?.title,
        lessonOrder: ses.lesson?.order,
        moduleCode: ses.lesson?.moduleCode,
        topic: ses.topic,
      }) || "Buổi học";

    return (
      <SessionMediaPanel
        classSessionId={ses.id}
        className={ses.class?.name ?? "Lớp"}
        classCode={ses.class?.classCode ?? null}
        sessionLabel={label}
        items={items}
        reviewStatus={review?.status ?? "OPEN"}
        noMediaReason={review?.noMediaReason ?? null}
        decidedByName={review?.decidedByName ?? null}
      />
    );
  }

  // ── (a) Cây ngày → lớp ─────────────────────────────────────────────────────
  const tree = await getReviewTree(actor);
  return <ReviewTree days={tree} />;
}

function NotYours({ note }: { note: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center">
      <ImageIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{note}</p>
      <Link
        href="/duyet-media"
        className="mt-4 inline-block rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
      >
        Về danh sách chờ duyệt
      </Link>
    </div>
  );
}
