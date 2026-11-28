import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import { isEvalV2Enabled } from "@/lib/flags";
import { docCacDotDanhGia } from "@/lib/eval/danh-gia-gv-hoc-sinh";
import { TeacherEvalForm } from "./eval-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Đánh giá giáo viên | Sata Robo",
  robots: { index: false },
};

export default async function DanhGiaGvPage() {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  if (!isEvalV2Enabled()) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-neutral-900">
          Đánh giá giáo viên
        </h1>
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Tính năng đang được chuẩn bị. Vui lòng quay lại sau nhé!
        </p>
      </div>
    );
  }

  // V8.20: lõi dùng chung với app di động.
  const blocks = await docCacDotDanhGia(pdb, studentId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">
          Đánh giá giáo viên
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Em hãy chấm sao và góp ý cho thầy/cô đang dạy mình nhé!
        </p>
      </div>

      {blocks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Hiện không có đợt đánh giá nào cần làm. Cảm ơn em!
        </p>
      ) : (
        blocks.map((b) => (
          <section key={b.roundId} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
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
