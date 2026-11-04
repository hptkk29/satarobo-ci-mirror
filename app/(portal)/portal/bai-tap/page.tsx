import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireActiveStudent } from "@/lib/portal/session";
import {
  getStudentAssignments,
  getParentHomeworkSummary,
  getPortalView,
} from "@/lib/portal/learning";
import { ViewToggle } from "./_components/view-toggle";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bài tập | Sata Robo" };

const STATUS: Record<string, { label: string; cls: string }> = {
  NOT_SUBMITTED: { label: "Chưa nộp", cls: "bg-neutral-100 text-neutral-600" },
  ASSIGNED: { label: "Chưa làm", cls: "bg-neutral-100 text-neutral-600" },
  SUBMITTED: { label: "Đã nộp", cls: "bg-blue-100 text-blue-700" },
  LATE: { label: "Nộp trễ", cls: "bg-amber-100 text-amber-700" },
  GRADED: { label: "Đã chấm", cls: "bg-emerald-100 text-emerald-700" },
  MISSED: { label: "Quá hạn", cls: "bg-red-100 text-red-700" },
};

export default async function BaiTapPage() {
  const { studentId } = await requireActiveStudent();
  const view = await getPortalView();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-neutral-900">Bài tập</h1>
        <ViewToggle current={view} />
      </div>

      {view === "student" ? (
        <StudentView studentId={studentId} />
      ) : (
        <ParentView studentId={studentId} />
      )}
    </div>
  );
}

// ── TẦNG PHỤ HUYNH — chỉ tổng quan, không nội dung câu hỏi ────────────────────
async function ParentView({ studentId }: { studentId: string }) {
  // 05/08 — trước đây tầng này CHỈ đếm bài kiểm tra: con vừa được giao bài về nhà mà
  // phụ huynh vẫn thấy "0 Đã giao · chưa được giao bài kiểm tra nào" ⇒ kết luận sai
  // là chưa có bài. Gộp cả bài tập trên lớp/về nhà vào con số và liệt kê bên dưới.
  const [hw, assignments] = await Promise.all([
    getParentHomeworkSummary(studentId),
    getStudentAssignments(studentId),
  ]);
  const btDaNop = assignments.filter(
    (a) => a.status !== "NOT_SUBMITTED",
  ).length;
  const btDaCham = assignments.filter((a) => a.status === "GRADED").length;
  const tongGiao = hw.assigned + assignments.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Đã giao" value={tongGiao} />
        <Stat label="Đã làm" value={`${hw.done + btDaNop}/${tongGiao}`} />
        <Stat label="Đã chấm" value={hw.graded + btDaCham} />
      </div>

      {assignments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
            Bài tập trên lớp / về nhà ({assignments.length})
          </h2>
          <ul className="space-y-2">
            {assignments.map((a) => {
              const st = STATUS[a.status] ?? STATUS.NOT_SUBMITTED;
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">{a.title}</p>
                    <p className="text-xs text-neutral-600">
                      {a.className}
                      {a.dueAt && ` · Hạn ${formatDateVN(a.dueAt)}`}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
                  >
                    {st.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
        Bài kiểm tra ({hw.items.length})
      </h2>
      {hw.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Con chưa được giao bài kiểm tra nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {hw.items.map((it) => {
            const st = STATUS[it.status] ?? STATUS.ASSIGNED;
            return (
              <li
                key={it.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900">{it.examTitle}</p>
                  <p className="text-xs text-neutral-600">
                    {it.className}
                    {it.dueAt && ` · Hạn ${formatDateVN(it.dueAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hw.showScore && it.summaryScore !== null && (
                    <span className="text-sm font-bold text-neutral-800">
                      {it.summaryScore}
                      {it.totalPoints !== null && `/${it.totalPoints}`}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
                  >
                    {st.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-neutral-600">
        Phụ huynh chỉ xem tiến độ và trạng thái. Để con làm bài, chuyển sang chế
        độ &quot;Học viên&quot;.
      </p>
    </div>
  );
}

// ── TẦNG HỌC VIÊN — danh sách bài để vào làm ─────────────────────────────────
async function StudentView({ studentId }: { studentId: string }) {
  // Tái dùng aggregate để liệt kê bài; link sang trang làm bài (chi tiết có nội dung).
  const hw = await getParentHomeworkSummary(studentId);
  const assignments = await getStudentAssignments(studentId);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
          Bài kiểm tra được giao
        </h2>
        {hw.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Chưa có bài kiểm tra nào được giao.
          </p>
        ) : (
          <ul className="space-y-2">
            {hw.items.map((it) => {
              const st = STATUS[it.status] ?? STATUS.ASSIGNED;
              return (
                <li key={it.id}>
                  <Link
                    href={`/portal/bai-tap/lam-bai/${it.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900">
                        {it.examTitle}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {it.className}
                        {it.dueAt && ` · Hạn ${formatDateVN(it.dueAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
                      >
                        {st.label}
                      </span>
                      <ChevronRight className="h-4 w-4 text-neutral-300" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
          Bài tập trên lớp / về nhà
        </h2>
        {assignments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Chưa có bài tập nào được giao.
          </p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => {
              const st = STATUS[a.status] ?? STATUS.NOT_SUBMITTED;
              return (
                <li key={a.id}>
                  <Link
                    href={`/portal/bai-tap/${a.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-neutral-900">
                        {a.title}
                        {a.kind === "HOMEWORK" && (
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                            Về nhà
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {a.className}
                        {a.dueAt && ` · Hạn ${formatDateVN(a.dueAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.status === "GRADED" && a.score !== null && (
                        <span className="text-sm font-bold text-neutral-800">
                          {a.score}/{a.totalPoints}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
                      >
                        {st.label}
                      </span>
                      <ChevronRight className="h-4 w-4 text-neutral-300" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center">
      <p className="text-2xl font-bold text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-600">{label}</p>
    </div>
  );
}
