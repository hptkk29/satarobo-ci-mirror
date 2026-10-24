import { Star } from "lucide-react";
import { requireActiveStudent } from "@/lib/portal/session";
import { getTeacherEvalBlocks } from "@/lib/portal/student-teacher-eval";
import { TeacherEvalForm } from "../../danh-gia-gv/eval-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Đánh giá giáo viên | Sata Robo",
  robots: { index: false },
};

function Hero() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-5 text-white sm:p-6">
      <Star className="pointer-events-none absolute -right-3 -top-3 size-28 rotate-12 text-white/10" />
      <div className="relative flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15 ring-4 ring-white/10">
          <Star className="size-6" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Đánh giá Thầy/Cô của em
          </h1>
          <p className="mt-0.5 text-xs font-medium text-white/80 sm:text-sm">
            Chọn khuôn mặt, số sao và gửi lời nhắn dễ thương cho Thầy/Cô nhé!
            Câu trả lời được giữ <b>bí mật (ẩn danh)</b>.
          </p>
        </div>
      </div>
    </div>
  );
}

// Cổng học sinh — Đánh giá giáo viên (SataUI). Dùng engine đánh giá hiện có (EVAL_V2);
// khi chưa mở đợt / tính năng tắt → trạng thái rỗng thân thiện.
export default async function StudentDanhGiaGvPage() {
  const { studentId } = await requireActiveStudent();
  const blocks = await getTeacherEvalBlocks(studentId);

  return (
    <div className="portal-v2 mx-auto w-full max-w-3xl space-y-6">
      <Hero />
      {blocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Hiện chưa có đợt đánh giá nào đang mở. Cảm ơn em! 🌟
        </div>
      ) : (
        blocks.map((b) => (
          <section key={b.roundId} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {b.name}
            </h2>
            {b.pairs.map((p) => (
              <TeacherEvalForm
                key={`${p.enrollmentId}|${p.teacherId}`}
                roundId={b.roundId}
                enrollmentId={p.enrollmentId}
                teacherId={p.teacherId}
                teacherName={p.teacherName}
                className={p.className}
                role={p.role}
                questions={b.questions}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
