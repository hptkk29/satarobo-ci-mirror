import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText } from "lucide-react";
import { ngayGioVN } from "@/lib/format/date";
import { requireActiveStudent } from "@/lib/portal/session";
import { getAssignmentDetail } from "@/lib/portal/learning";
import {
  RUBRIC_CRITERIA,
  RUBRIC_LEVELS,
  criterionLabel,
} from "@/lib/rubric/criteria";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { SubmitForm } from "./_components/submit-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Bài tập | Sata Robo",
  robots: { index: false },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  NOT_SUBMITTED: { label: "Chưa nộp", cls: "bg-neutral-100 text-neutral-600" },
  SUBMITTED: { label: "Đã nộp", cls: "bg-blue-100 text-blue-700" },
  LATE: { label: "Nộp trễ", cls: "bg-amber-100 text-amber-700" },
  GRADED: { label: "Đã chấm", cls: "bg-emerald-100 text-emerald-700" },
};

interface Props {
  params: Promise<{ assignmentId: string }>;
}

export default async function AssignmentDetailPage({ params }: Props) {
  const { studentId } = await requireActiveStudent();
  const { assignmentId } = await params;
  const a = await getAssignmentDetail(studentId, assignmentId);
  if (!a) notFound();

  const sub = a.submission;
  const st = STATUS[sub?.status ?? "NOT_SUBMITTED"] ?? STATUS.NOT_SUBMITTED;
  const graded = sub?.status === "GRADED";

  // L8.3 — tài liệu đính kèm + file bài nộp (GV/PH xem lại) đi qua signed URL TTL
  // ngắn (flag MEDIA_SIGNED_URL; OFF → resolveMediaUrl trả nguyên fileUrl cũ).
  const documents = await Promise.all(
    a.documents.map(async (d) => ({
      ...d,
      fileUrl: await resolveMediaUrl(d.fileUrl),
    })),
  );
  // BGĐ 31/07 — file GV upload trực tiếp khi giao bài.
  const attachments = await Promise.all(
    a.attachments.map(async (f) => ({
      ...f,
      fileUrl: await resolveMediaUrl(f.fileUrl),
    })),
  );
  // BGĐ 31/07 — bài nộp nhiều file; fallback cột đơn cũ khi chưa có bản ghi files.
  const subFiles =
    sub && sub.files.length > 0
      ? sub.files.map((f) => ({
          url: f.fileUrl,
          name: f.fileName,
          size: f.fileSize ?? 0,
          mime: f.mimeType ?? "",
        }))
      : sub?.fileUrl
        ? [
            {
              url: sub.fileUrl,
              name: sub.fileName ?? "Tệp đã nộp",
              size: 0,
              mime: "",
            },
          ]
        : [];
  const initialFiles = await Promise.all(
    subFiles.map(async (f) => ({ ...f, url: await resolveMediaUrl(f.url) })),
  );

  return (
    <div className="space-y-5">
      <Link
        href="/portal/bai-tap"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
      >
        <ChevronLeft className="h-4 w-4" /> Tất cả bài tập
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-neutral-900">{a.title}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
          >
            {st.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-600">
          {a.totalPoints} điểm
          {/* 06/09 — GHIM giờ VN; `toLocaleString("vi-VN")` trần lấy giờ tiến trình
              (Vercel = UTC) nên hạn 23:59 giờ VN in ra "16:59". */}
          {a.dueAt && ` · Hạn ${ngayGioVN(a.dueAt)}`}
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        {a.description && (
          <p className="whitespace-pre-wrap text-sm text-neutral-700">
            {a.description}
          </p>
        )}
        {a.instructions && (
          <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">
            <p className="mb-1 font-semibold text-neutral-700">Hướng dẫn</p>
            <p className="whitespace-pre-wrap">{a.instructions}</p>
          </div>
        )}
        {(documents.length > 0 || attachments.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {documents.map((d) => (
              <a
                key={d.id}
                href={d.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                <FileText className="h-3.5 w-3.5" /> {d.title}
              </a>
            ))}
            {attachments.map((f) => (
              <a
                key={f.id}
                href={f.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100"
              >
                <FileText className="h-3.5 w-3.5" /> {f.fileName}
              </a>
            ))}
          </div>
        )}
      </div>

      {graded && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">
            Điểm: {sub?.score ?? 0}/{a.totalPoints}
          </p>
          {sub?.feedback && (
            <p className="mt-1 text-sm text-emerald-700">
              Nhận xét: {sub.feedback}
            </p>
          )}
        </div>
      )}

      {graded && sub?.rubricScores && sub.rubricScores.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Đánh giá theo tiêu chí (rubric)
          </h2>
          <ul className="space-y-2">
            {(() => {
              const byCrit = new Map(
                sub.rubricScores.map((r) => [r.criterion, r.level]),
              );
              return RUBRIC_CRITERIA.filter((c) => byCrit.has(c.key)).map(
                (c) => {
                  const lvl = byCrit.get(c.key);
                  const meta = RUBRIC_LEVELS.find((l) => l.key === lvl);
                  return (
                    <li
                      key={c.key}
                      className="flex items-center justify-between border-b border-neutral-100 pb-2 text-sm last:border-0"
                    >
                      <span className="text-neutral-700">
                        {criterionLabel(c.key)}
                      </span>
                      <span
                        className={`font-semibold ${meta?.color ?? "text-neutral-600"}`}
                      >
                        {meta?.label ?? lvl} ({meta?.points ?? "—"}/4)
                      </span>
                    </li>
                  );
                },
              );
            })()}
          </ul>
        </div>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
          {graded ? "Bài đã nộp" : sub ? "Cập nhật bài nộp" : "Nộp bài"}
        </h2>
        <SubmitForm
          assignmentId={a.id}
          allowText={a.allowText}
          allowFile={a.allowFile}
          initialText={sub?.textAnswer ?? null}
          initialFiles={initialFiles}
          graded={graded}
        />
      </section>
    </div>
  );
}
