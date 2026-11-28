import Link from "next/link";
import { ArrowLeft, CircleCheck, CircleX } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napKetQuaThi } from "@/lib/elearning/exam-result-view";
import { dongKetLuanLuot, lyDoChuaCoDapAn } from "@/lib/elearning/exam-result-pure";
import { EmptyState } from "@/components/admin/ui/states";

/**
 * XEM LẠI BÀI KIỂM TRA — kết quả lượt ĐÃ NỘP gần nhất của CHÍNH người thi.
 *
 * ⚠️ Đáp án đúng / lời giải / cờ đúng-sai chỉ có trong dữ liệu KHI chính sách của đề cho xem (`exam-result-view.ts` quyết ở tầng dữ liệu);
 * trang này chỉ vẽ cái được trả về, không tự ẩn/hiện. Lượt đang làm hoặc của người khác ⇒ cùng câu "không mở được".
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kết quả bài kiểm tra | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function KetQuaPage({ params }: { params: Promise<{ enrollmentId: string; lessonId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</main>;
  }
  const { enrollmentId, lessonId } = await params;
  const actor = await resolveActor(session.user.id);
  const db = scopedDb(actor);
  // Lượt học phải là CỦA người này và chưa thu hồi (cùng cổng với trang bài).
  const gd = await db.trnEnrollment.findFirst({
    where: { id: enrollmentId, userId: session.user.id, status: { not: "REVOKED" } },
    select: { id: true },
  });
  const kq = gd ? await napKetQuaThi(db, { enrollmentId, lessonId, userId: session.user.id }) : null;

  if (!kq) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          title="Chưa có kết quả để xem"
          description="Bạn chưa nộp lượt nào của bài kiểm tra này, hoặc đường dẫn không đúng."
          action={
            <Link
              href={`/elearning/hoc/${enrollmentId}`}
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Về đề cương khoá
            </Link>
          }
        />
      </div>
    );
  }

  const { luot } = kq;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <nav aria-label="Vị trí" className="text-sm">
        <Link
          href={`/elearning/hoc/${enrollmentId}/${lessonId}`}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-primary-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Bài kiểm tra
        </Link>
      </nav>

      <header className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground">
          {kq.tenDe} · lượt {luot.attemptNo}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{dongKetLuanLuot(luot, kq.maxScore)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Điểm đạt từ {kq.passScore}/{kq.maxScore}.</p>
        {luot.feedback ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{luot.feedback}</p> : null}
      </header>

      {kq.choPhepXemDapAn ? null : (
        <p role="note" className="rounded-xl border border-border bg-muted px-4 py-3 text-sm">
          {lyDoChuaCoDapAn(kq.chinhSachXemDapAn, kq.soLuotDaDung, kq.soLuotChoPhep)}
        </p>
      )}

      <ol aria-label="Các câu của bài" className="space-y-3">
        {kq.cacCau.map((c) => (
          <li key={c.thuTu} className="rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                Câu {c.thuTu} ({c.points} điểm)
              </p>
              {c.dung === true ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-state-success-ink">
                  <CircleCheck className="h-4 w-4" aria-hidden /> Đúng
                </span>
              ) : c.dung === false ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-state-danger-ink">
                  <CircleX className="h-4 w-4" aria-hidden /> Sai
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-base font-medium text-foreground">{c.stem}</p>
            <p className="mt-2 text-muted-foreground">
              Bạn chọn:{" "}
              <span className="text-foreground">
                {c.daChon.length > 0 ? c.daChon.join(", ") : c.textAnswer ? c.textAnswer : "chưa trả lời"}
              </span>
            </p>
            {c.dapAnDung ? (
              <p className="mt-1 text-muted-foreground">
                Đáp án đúng: <span className="font-medium text-foreground">{c.dapAnDung.join(", ")}</span>
              </p>
            ) : null}
            {c.goiY ? (
              <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-foreground">
                <span className="font-medium">Gợi ý: </span>
                {c.goiY}
              </p>
            ) : null}
            {c.giaiThich ? <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-foreground">{c.giaiThich}</p> : null}
          </li>
        ))}
      </ol>
    </main>
  );
}
