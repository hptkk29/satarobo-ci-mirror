import { GraduationCap, Info, Download, CalendarCheck } from "lucide-react";
import { reportCardPeriodDisplay } from "@/lib/lms/report-card";
import type { ReportCardV2 } from "@/lib/portal/report-card-v2";
import { PageHero, HeroMetric } from "@/components/portal/page-header";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { HocBaPrintButton } from "@/components/portal/hoc-ba-print-button";

// dd/mm/yyyy theo giờ VN (server Vercel chạy UTC — tránh lệch 1 ngày).
function dmy(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

function Ring({ value }: { value: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const off = c - (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div className="relative grid size-24 shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className="size-24 -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="text-success"
        />
      </svg>
      <span className="absolute text-xl font-bold text-foreground">
        {value}%
      </span>
    </div>
  );
}

/** Nhãn mức đánh giá — cùng bảng với bản v1 (components/report-card/report-card-view). */
const MUC_DANH_GIA: Record<number, string> = {
  1: "Cần cố gắng",
  2: "Đạt",
  3: "Khá",
  4: "Tốt",
};

export function HocBaPageV2({
  kids,
  activeId,
  data,
}: {
  kids: { id: string; name: string }[];
  activeId: string | null;
  data: ReportCardV2 | null;
}) {
  // Bản tạm tính + lớp chưa có buổi học nào → KHÔNG hiển thị "Chuyên cần 0%"
  // (phụ huynh đọc như con vắng 100%, thực ra là chưa có dữ liệu).
  const noAttendanceData = data != null && !data.isOfficial && data.total === 0;
  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <ChildSwitcher kids={kids} activeId={activeId} />

      <PageHero
        icon={GraduationCap}
        overline="Cổng phụ huynh"
        title="Học bạ điện tử"
        subtitle="Kết quả học tập, chuyên cần và đánh giá năng lực theo từng kỳ."
        metric={
          data && !noAttendanceData ? (
            <HeroMetric label="Chuyên cần" value={`${data.rate}%`} />
          ) : undefined
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-info/25 bg-info/5 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-5 shrink-0 text-info" />
        <p>
          {data?.isOfficial
            ? "Học bạ đã được trung tâm phát hành. Đây là bản chính thức."
            : "Chỉ học bạ đã được trung tâm phát hành mới là bản chính thức. Bên dưới là bản tổng hợp tạm tính từ dữ liệu học tập hiện có."}
        </p>
      </div>

      {!data ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Chưa có dữ liệu học bạ cho học viên này.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <span className="rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">
                {data.periodLabel}
              </span>
            </div>
            <div className="flex gap-2">
              <HocBaPrintButton />
              {/* PDF: bản chính thức → snapshot đã phát hành; bản tạm tính → transcript live.
                  Cả 2 endpoint đều ownership-check qua requireActiveStudent. */}
              <a
                href={
                  data.reportCardId
                    ? `/api/portal/report-card/${data.reportCardId}`
                    : "/api/portal/transcript"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <Download className="size-4" /> Tải PDF
              </a>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 bg-neutral-900 px-6 py-5 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-white/60">
                  {data.isOfficial
                    ? "Học bạ chính thức"
                    : "Bản tổng hợp tạm tính"}
                </p>
                <p className="mt-1 text-lg font-bold">
                  Học bạ định kỳ {data.periodLabel.toLowerCase()}
                </p>
              </div>
              <GraduationCap className="size-10 shrink-0 text-primary" />
            </div>

            <div className="p-6">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Thông tin chung
              </h3>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <Row label="Học viên" value={data.studentName} />
                <Row label="Mã học viên" value={data.studentCode ?? "—"} />
                <Row label="Lớp" value={data.className ?? "—"} />
                <Row label="Khóa học" value={data.courseName ?? "—"} />
                <Row label="Giáo viên" value={data.teacher ?? "—"} />
                {/* Chỉ bản ĐÃ PHÁT HÀNH mới có ngày phát hành (bản tạm tính không có). */}
                {data.publishedDate ? (
                  <Row label="Ngày phát hành" value={dmy(data.publishedDate)} />
                ) : null}
              </dl>

              <div className="my-6 h-px bg-border" />

              <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <CalendarCheck className="size-4 text-success" /> Chuyên cần
              </h3>
              {noAttendanceData ? (
                <p className="rounded-2xl bg-muted/40 p-5 text-sm leading-relaxed text-muted-foreground">
                  Lớp chưa bắt đầu / chưa có dữ liệu chuyên cần — số liệu sẽ cập
                  nhật sau buổi học đầu tiên.
                </p>
              ) : (
                <div className="flex items-center gap-6 rounded-2xl bg-muted/40 p-5">
                  <Ring value={data.rate} />
                  <div className="grid flex-1 grid-cols-3 gap-4 text-center">
                    <Metric value={data.total} label="Tổng buổi" />
                    {/* Bản chính thức: done = buổi CÓ MẶT (snapshot); bản tạm tính: buổi đã diễn ra. */}
                    <Metric
                      value={data.done}
                      label={data.isOfficial ? "Có mặt" : "Đã học"}
                      tone="success"
                    />
                    {/* Bản chính thức: Vắng = absent THẬT trong snapshot (không lấy total-done —
                        total gồm cả buổi CHƯA diễn ra + buổi chờ bù). Bản tạm tính: Còn lại. */}
                    <Metric
                      value={
                        data.isOfficial && data.absent != null
                          ? data.absent
                          : Math.max(0, data.total - data.done)
                      }
                      label={data.isOfficial ? "Vắng" : "Còn lại"}
                      tone="muted"
                    />
                  </div>
                </div>
              )}

              {/* ─── Ba khối NỘI DUNG của học bạ đã phát hành (bổ sung 06/09/2026) ───
                  Bản v1 render đủ chúng; bản v2 — thứ prod đang chạy — không mang chúng
                  trong kiểu dữ liệu, nên từ ngày bật cờ v2 phụ huynh mở học bạ ra là
                  mất sạch phần đánh giá theo tiêu chí và nhận xét theo giai đoạn. */}
              {data.scores.length > 0 && (
                <>
                  <div className="my-6 h-px bg-border" />
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Đánh giá năng lực
                  </h3>
                  <ul className="divide-y divide-border rounded-2xl border border-border">
                    {data.scores.map((sc) => (
                      <li
                        key={sc.criterionId}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                      >
                        <span className="font-medium text-foreground">{sc.name}</span>
                        <span className="text-muted-foreground">
                          {MUC_DANH_GIA[sc.level] ?? sc.level}
                          {sc.note ? ` · ${sc.note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {data.periodComments.length > 0 && (
                <>
                  <div className="my-6 h-px bg-border" />
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Nhận xét theo giai đoạn
                  </h3>
                  <ul className="space-y-2">
                    {data.periodComments.map((pc, i) => (
                      <li key={i} className="rounded-2xl bg-muted/40 p-4 text-sm">
                        {/* Phụ huynh KHÔNG được thấy mã kỹ thuật SESSION_5/SESSION_12. */}
                        <span className="font-bold text-foreground">
                          {reportCardPeriodDisplay(pc.period)}:{" "}
                        </span>
                        <span className="text-muted-foreground">{pc.comment}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {data.completionStatus ? (
                <p className="mt-6 text-sm">
                  <span className="font-bold text-foreground">Kết quả: </span>
                  <span className="text-muted-foreground">{data.completionStatus}</span>
                </p>
              ) : null}

              {data.finalComment ? (
                <>
                  <div className="my-6 h-px bg-border" />
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Nhận xét tổng kết
                  </h3>
                  <p className="rounded-2xl bg-muted/40 p-5 text-sm leading-relaxed text-foreground">
                    {data.finalComment}
                  </p>
                </>
              ) : null}
            </div>
          </div>

          {/* Học viên học nhiều khoá: các bản phát hành CŨ hơn vẫn phải xem/tải được
              (parity v1 — v1 render tất cả bản PUBLISHED, không chỉ bản mới nhất). */}
          {data.olderPublished.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Học bạ đã phát hành trước đó
              </h3>
              <ul className="divide-y divide-border">
                {data.olderPublished.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {r.courseName ?? "Khóa học"}
                        {r.className ? ` · ${r.className}` : ""}
                      </p>
                      {r.publishedDate && (
                        <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                          Phát hành {dmy(r.publishedDate)}
                        </p>
                      )}
                    </div>
                    <a
                      href={`/api/portal/report-card/${r.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      <Download className="size-4" /> Tải PDF
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-border pb-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "success" | "muted";
}) {
  const c =
    tone === "success"
      ? "text-success"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div>
      <p className={`text-2xl font-bold tabular-nums ${c}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
