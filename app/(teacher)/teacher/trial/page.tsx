// app/(teacher)/teacher/trial/page.tsx — Site GV (L6): "Danh sách Trial".
//
// 2 mức qua searchParams (không route động):
//   (a) không tham số   → HV Trial nhóm theo NGÀY + khung giờ (own-rows GV).
//   (b) ?enrollmentId=… → phiếu rubric của một ca. Kèm `&sessionId=…` (GĐ4) để chọn
//                         BUỔI được chấm; bỏ trống = buổi đang xếp cho ca.
//
// Quyền: TEACHER có sẵn trials:view + trials:feedback (không đổi permissions).
// Data: own-rows theo teacherId qua lib/lms/teacher-schedule (db ở lib, không phải
// app/(teacher) — né ESLint chặn @/lib/db trần).
//
// ⚠️ ĐẢO "câu 46" (25/08, chủ dự án): bảng Trial NAY CÓ cột "Phụ huynh" — chỉ TÊN.
// SĐT/email phụ huynh vẫn không bao giờ ra khỏi server (xem ghi chú dài ở khối
// getTeacherTrialTable trong lib/lms/teacher-schedule.ts).
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ban } from "lucide-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  getTeacherTrialTable,
  getTeacherTrialRubricContext,
  type TrialTableRow,
} from "@/lib/lms/teacher-schedule";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";
import { TrialList, type TrialRowView } from "./_components/trial-list";
import { TrialEvalForm } from "./_components/trial-eval-form";
import { BackLink } from "../_components/ui/back-link";

export const metadata = { title: "Danh sách Trial | Giáo viên Sata Robo" };

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "từ ngày hiện tại đến hết 7 ngày tiếp theo" (chủ dự án 25/08). */
const TRIAL_WINDOW_DAYS = 7;

/** Mốc UTC 00:00 của NGÀY hôm nay theo giờ VN — khớp cột @db.Date của Trial. */
function vnTodayUtc(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()),
  );
}

// Nhãn ngày cho cột "Buổi" ("CN, 05/07"). @db.Date là UTC 00:00 của ngày lịch VN →
// format theo UTC mới ra đúng ngày. Format Ở ĐÂY (server) chứ không ở client: máy GV
// không chắc chạy +07, và render server ↔ hydrate client lệch nhau là vỡ hydration.
const dateShortFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function TeacherTrialPage({
  searchParams,
}: {
  searchParams: Promise<{ enrollmentId?: string; sessionId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate login + role TEACHER

  if (!(await checkPermission("trials:view"))) redirect("/");

  const { enrollmentId, sessionId } = await searchParams;

  // ── (b) Phiếu đánh giá rubric 1 HV trải nghiệm ──────────────────────────────
  if (enrollmentId) {
    const ctx = await getTeacherTrialRubricContext(
      session.user.id,
      enrollmentId,
      sessionId,
    );
    if (!ctx) return <NotYours />;

    // Buổi đang chấm quyết định CẢ biểu mẫu lẫn PDF — phải nói rõ trên URL, vì
    // `scheduledSessionId` của ca chỉ đổi khi dời lịch (xem ghi chú GĐ4 ở helper).
    const selected = ctx.trialClassSessionId;
    const pdfHref = selected
      ? `/teacher/trial/pdf/${ctx.enrollmentId}?sessionId=${selected}`
      : `/teacher/trial/pdf/${ctx.enrollmentId}`;

    return (
      <div className="space-y-4">
        <BackLink href="?" label="Danh sách Trial" />
        <PageHeader
          title="Phiếu đánh giá buổi thử"
          subtitle={ctx.trialClassName}
        />

        {ctx.sessions.length > 0 && (
          <section className="t-card px-5 py-4">
            <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Buổi được chấm
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mỗi buổi một phiếu riêng. Chọn buổi trước khi nhập điểm.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ctx.sessions.map((s) => {
                const active = s.id === selected;
                return (
                  <Link
                    key={s.id}
                    href={`?enrollmentId=${ctx.enrollmentId}&sessionId=${s.id}`}
                    // Chọn buổi = đổi tham số truy vấn TRÊN CHÍNH màn phiếu này, không
                    // phải sang trang khác → giữ nguyên vị trí cuộn (App Router mặc
                    // định kéo về đầu sau mỗi lần cập nhật router state).
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-primary bg-primary text-white"
                        : "border-border text-foreground hover:bg-muted",
                    )}
                  >
                    {s.label}
                    {s.isScheduled ? " · đang xếp" : ""}
                    {s.evaluated ? " ✓" : ""}
                  </Link>
                );
              })}
            </div>
            {!selected && (
              <p className="mt-3 text-xs text-state-warning-ink">
                Ca này chưa được xếp buổi — chọn một buổi ở trên trước khi lưu
                phiếu.
              </p>
            )}
          </section>
        )}

        <TrialEvalForm
          // `key` ép React dựng lại form khi đổi buổi: state điểm nằm trong
          // useState khởi tạo 1 lần, không có key thì bấm sang buổi khác vẫn
          // thấy điểm của buổi cũ.
          key={selected ?? "no-session"}
          enrollmentId={ctx.enrollmentId}
          sessionId={selected}
          studentName={ctx.studentName}
          courseName={ctx.courseName}
          existing={
            ctx.existing
              ? {
                  scores: ctx.existing.scores,
                  generalComment: ctx.existing.generalComment,
                  orientation: ctx.existing.orientation,
                }
              : null
          }
          /* 25/08 — bỏ nút "Xuất PDF" khỏi màn Trial của GV. */
          pdfHref={null}
        />
      </div>
    );
  }

  // ── (a) Hai bảng: "Các suất sắp Trial" (7 ngày tới) + "Đã Trial" ───────────
  const today = vnTodayUtc();
  const table = await getTeacherTrialTable(session.user.id, {
    today,
    days: TRIAL_WINDOW_DAYS,
  });

  /** "Hoàng Gia Bảo - 2016" — ghép ở SERVER để client không phải đụng ngày tháng. */
  function toView(r: TrialTableRow): TrialRowView {
    return {
      enrollmentId: r.enrollmentId,
      sessionId: r.sessionId,
      hocCaLop: r.hocCaLop,
      dateLabel: capitalize(dateShortFmt.format(r.date)),
      timeLabel: `${r.startTime}–${r.endTime}`,
      trialClassName: r.trialClassName,
      studentLabel: r.birthYear ? `${r.studentName} - ${r.birthYear}` : r.studentName,
      parentName: r.parentName,
      courseName: r.courseName,
      saleName: r.saleName,
      status: r.status,
      evaluated: r.evaluated,
    };
  }

  // 04/09 — mọi dòng nay ĐỀU có ngày giờ: ghi danh "học cả lớp" được suy buổi đại diện ở
  // server (`chonBuoiDaiDien`), suy không ra thì bỏ hẳn. Nên không còn khối "chưa xếp
  // buổi" nào, và cũng không còn dòng nào rơi nhầm xuống "Đã Trial" chỉ vì thiếu ngày.
  const upcoming = table.upcoming.map(toView);
  const done = table.done.map(toView);

  return (
    <div>
      <PageHeader
        title="Học viên Trial"
        subtitle={`Suất Trial trong ${TRIAL_WINDOW_DAYS} ngày tới và các suất đã học. Sau buổi, nhập phiếu đánh giá cho từng học viên.`}
      />

      <TrialList
        upcoming={upcoming}
        done={done}
        windowDays={TRIAL_WINDOW_DAYS}
      />
    </div>
  );
}

function NotYours() {
  return (
    <div className="space-y-4">
      <BackLink href="?" label="Danh sách Trial" />
      <EmptyState icon={Ban} title="Buổi Trial không thuộc bạn phụ trách." />
    </div>
  );
}
