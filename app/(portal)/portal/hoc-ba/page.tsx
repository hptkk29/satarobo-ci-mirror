import { requireActiveStudent } from "@/lib/portal/session";
import { getPublishedReportCards } from "@/lib/lms/report-card";
import { getStudentTranscript } from "@/lib/transcript/service";
import { ReportCardView } from "@/components/report-card/report-card-view";
import { TranscriptView } from "@/components/transcript/transcript-view";
import { isPortalV2Enabled } from "@/lib/flags";
import { getStudentReportCard } from "@/lib/portal/report-card-v2";
import { HocBaPageV2 } from "@/components/portal/hoc-ba-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Học bạ | Sata Robo",
  robots: { index: false },
};

export default async function PortalTranscriptPage() {
  const { ctx, studentId } = await requireActiveStudent();

  // Portal v2 — trang Học bạ giống SataUI (per-child, tổng hợp chuyên cần + thông tin chung).
  if (isPortalV2Enabled()) {
    const data = await getStudentReportCard(studentId);
    return (
      <HocBaPageV2
        kids={ctx.children.map((c) => ({ id: c.id, name: c.name }))}
        activeId={ctx.activeStudent?.id ?? null}
        data={data}
      />
    );
  }

  // R7-15: nguồn chính = học bạ ĐÃ PHÁT HÀNH (ReportCard PUBLISHED, đọc snapshot).
  // DRAFT/PENDING/RECALLED → PH KHÔNG thấy. Chưa có bản phát hành → fallback transcript cũ.
  const published = await getPublishedReportCards(studentId);

  if (published.length > 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Học bạ</h1>
          <p className="text-sm text-neutral-500">
            Các học bạ đã được trung tâm phát hành.
          </p>
        </div>
        {published.map((card) => (
          <ReportCardView key={card.id} card={card} />
        ))}
      </div>
    );
  }

  // Fallback (2-phase): học bạ tổng hợp cũ + PDF transcript.
  const t = await getStudentTranscript(studentId);
  if (!t) {
    return <p className="text-sm text-neutral-500">Chưa có dữ liệu học bạ.</p>;
  }
  return <TranscriptView t={t} pdfHref="/api/portal/transcript" />;
}
