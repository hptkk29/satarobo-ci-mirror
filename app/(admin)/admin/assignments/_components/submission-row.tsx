"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ClipboardCheck, FileText, Gavel, ListChecks, X } from "lucide-react";
import { DocumentUploader, type UploadedFile } from "@/components/admin/DocumentUploader";
import { gradeSubmission, gradeSubmissionRubric, recordSubmission } from "../_actions";
import { RUBRIC_CRITERIA, RUBRIC_LEVELS } from "@/lib/rubric/criteria";

type Status = "NOT_SUBMITTED" | "SUBMITTED" | "LATE" | "GRADED";

const STATUS_INFO: Record<Status, { label: string; color: string }> = {
  NOT_SUBMITTED: { label: "Chưa nộp", color: "bg-muted text-foreground" },
  SUBMITTED: { label: "Đã nộp", color: "bg-state-info-soft text-state-info-ink" },
  LATE: { label: "Nộp muộn", color: "bg-state-warning-soft text-state-warning-ink" },
  GRADED: { label: "Đã chấm", color: "bg-state-success-soft text-state-success-ink" },
};

export interface SubmissionRowData {
  id: string;
  status: Status;
  textAnswer: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  /** BGĐ 31/07 — bài nộp NHIỀU file (cột đơn fileUrl chỉ là file đầu, 2-phase). */
  files: { id: string; url: string; name: string; size: number | null }[];
  submittedAt: Date | null;
  score: number | null;
  feedback: string | null;
  gradedAt: Date | null;
  studentName: string;
  studentCode: string | null;
  studentParentPhone: string | null;
  totalPoints: number;
  gradedByName: string | null;
}

function fmtDateTime(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SubmissionRow({ row }: { row: SubmissionRowData }) {
  const router = useRouter();
  const statusInfo = STATUS_INFO[row.status];
  const [recordOpen, setRecordOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [rubricOpen, setRubricOpen] = useState(false);

  const canRecord = row.status === "NOT_SUBMITTED";
  const canGrade = row.status === "SUBMITTED" || row.status === "LATE" || row.status === "GRADED";

  return (
    <tr className="hover:bg-muted/60">
      <td className="px-3 py-3">
        <div className="font-medium text-foreground">{row.studentName}</div>
        {row.studentCode && (
          <div className="text-xs text-muted-foreground tabular-nums">
            {row.studentCode}
          </div>
        )}
        {row.studentParentPhone && (
          <div className="text-xs text-muted-foreground tabular-nums">
            PH: {row.studentParentPhone}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
        >
          {statusInfo.label}
        </span>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
        {fmtDateTime(row.submittedAt)}
      </td>
      <td className="px-3 py-3">
        {row.textAnswer || row.fileUrl || row.files.length > 0 ? (
          <div className="space-y-1 max-w-[260px]">
            {row.textAnswer && (
              <p className="text-xs text-foreground line-clamp-2">
                {row.textAnswer}
              </p>
            )}
            {row.files.length > 0 ? (
              // BGĐ 31/07 — liệt kê ĐỦ danh sách file (như site GV) — trước đây chỉ
              // hiện cột đơn = file đầu, người chấm thấy 1/N file.
              <ul className="space-y-1">
                {row.files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-state-info-ink hover:underline"
                    >
                      <FileText className="h-3 w-3" />
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              row.fileUrl && (
                // 2-phase: bản nộp cũ chưa có AssignmentSubmissionFile → fallback cột đơn.
                <a
                  href={row.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-state-info-ink hover:underline"
                >
                  <FileText className="h-3 w-3" />
                  {row.fileName ?? "Tải file"}
                </a>
              )
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-right text-sm tabular-nums font-semibold text-foreground">
        {row.score !== null ? `${row.score}/${row.totalPoints}` : "—"}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[200px]">
        {row.feedback ? (
          <p className="line-clamp-2">{row.feedback}</p>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {row.gradedByName && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            bởi {row.gradedByName}
          </p>
        )}
      </td>
      <td className="px-3 py-3 text-right">
        <div className="inline-flex gap-1">
          {canRecord && (
            <button
              type="button"
              onClick={() => setRecordOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-state-info bg-card px-2.5 py-1 text-xs font-semibold text-state-info-ink hover:bg-state-info-soft"
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              Ghi nhận
            </button>
          )}
          {canGrade && (
            <button
              type="button"
              onClick={() => setGradeOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-primary bg-card px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
            >
              <Gavel className="h-3.5 w-3.5" />
              {row.status === "GRADED" ? "Sửa điểm" : "Chấm"}
            </button>
          )}
          {canGrade && (
            <button
              type="button"
              onClick={() => setRubricOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-state-success bg-card px-2.5 py-1 text-xs font-semibold text-state-success-ink hover:bg-state-success-soft"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Rubric
            </button>
          )}
        </div>
      </td>

      {recordOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <RecordSubmissionDialog
            submissionId={row.id}
            studentName={row.studentName}
            onClose={() => setRecordOpen(false)}
            onSuccess={() => {
              setRecordOpen(false);
              router.refresh();
            }}
          />,
          document.body,
        )}
      {gradeOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <GradeSubmissionDialog
            submissionId={row.id}
            studentName={row.studentName}
            currentScore={row.score}
            currentFeedback={row.feedback}
            totalPoints={row.totalPoints}
            onClose={() => setGradeOpen(false)}
            onSuccess={() => {
              setGradeOpen(false);
              router.refresh();
            }}
          />,
          document.body,
        )}
      {rubricOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <RubricGradeDialog
            submissionId={row.id}
            studentName={row.studentName}
            onClose={() => setRubricOpen(false)}
            onSuccess={() => {
              setRubricOpen(false);
              router.refresh();
            }}
          />,
          document.body,
        )}
    </tr>
  );
}

function RubricGradeDialog({
  submissionId,
  studentName,
  onClose,
  onSuccess,
}: {
  submissionId: string;
  studentName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [levels, setLevels] = useState<Record<string, string>>(
    Object.fromEntries(RUBRIC_CRITERIA.map((c) => [c.key, "GOOD"])),
  );
  const [feedback, setFeedback] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    onClose();
  }

  function submit() {
    setError(null);
    if (feedback.trim().length < 5) {
      setError("Nhận xét là bắt buộc (tối thiểu 5 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await gradeSubmissionRubric({
        submissionId,
        scores: RUBRIC_CRITERIA.map((c) => ({ criterion: c.key, level: levels[c.key] })),
        feedback: feedback.trim(),
        sendEmail,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8"
      onClick={close}
    >
      <div className="relative w-full max-w-xl rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={close} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
        <h3 className="mb-1 text-lg font-bold text-foreground">Chấm theo rubric</h3>
        <p className="mb-4 text-sm text-muted-foreground">{studentName}</p>

        <div className="space-y-3">
          {RUBRIC_CRITERIA.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-3">
              <div className="mb-2">
                <div className="text-sm font-semibold text-foreground">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.desc}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RUBRIC_LEVELS.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => setLevels((prev) => ({ ...prev, [c.key]: l.key }))}
                    className={`rounded-full border px-2.5 py-1 text-xs ${ levels[c.key] === l.key ? "border-state-success-ink bg-state-success-soft font-semibold text-state-success-ink" : "border-border text-muted-foreground" }`}
                  >
                    {l.label} ({l.points})
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-foreground">Nhận xét (bắt buộc)</span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
            placeholder="Nhận xét chung về bài làm của học viên…"
          />
        </label>

        <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Gửi email kết quả cho phụ huynh
        </label>

        {error && <p className="mt-2 text-sm text-state-danger-ink">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-state-success-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Đang lưu…" : "Lưu chấm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordSubmissionDialog({
  submissionId,
  studentName,
  onClose,
  onSuccess,
}: {
  submissionId: string;
  studentName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [textAnswer, setTextAnswer] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    onClose();
  }

  function handleSubmit() {
    setError(null);
    if (!textAnswer.trim() && !file) {
      setError("Cần điền text hoặc upload file");
      return;
    }
    startTransition(async () => {
      const res = await recordSubmission({
        submissionId,
        textAnswer: textAnswer.trim() || null,
        fileUrl: file?.url ?? null,
        fileName: file?.fileName ?? null,
        fileSize: file?.fileSize ?? null,
        mimeType: file?.mimeType ?? null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8"
      onClick={close}
    >
      <div
        className="relative w-full max-w-lg rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <ClipboardCheck className="h-5 w-5 text-state-info-ink" />
          Ghi nhận bài nộp
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          HS: <strong>{studentName}</strong>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Dùng cho luồng offline/Zalo — admin nhập thay HS. Nếu quá hạn sẽ tự
          set LATE.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">
              Nội dung trả lời (text)
            </span>
            <textarea
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              rows={4}
              disabled={pending}
              placeholder="Nội dung HS gửi qua Zalo/email/giấy..."
              className="w-full resize-y rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-state-info focus:ring-2 focus:ring-state-info/20"
            />
          </label>
          <div>
            <span className="mb-1 block text-xs font-semibold text-foreground">
              File đính kèm (tuỳ chọn)
            </span>
            <DocumentUploader
              value={file}
              onChange={setFile}
              disabled={pending}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-lg bg-state-info px-4 py-2 text-sm font-bold text-white hover:bg-state-info-ink disabled:opacity-50"
          >
            {pending ? "Đang lưu..." : "Lưu bài nộp"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GradeSubmissionDialog({
  submissionId,
  studentName,
  currentScore,
  currentFeedback,
  totalPoints,
  onClose,
  onSuccess,
}: {
  submissionId: string;
  studentName: string;
  currentScore: number | null;
  currentFeedback: string | null;
  totalPoints: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [score, setScore] = useState<number>(currentScore ?? 0);
  const [feedback, setFeedback] = useState(currentFeedback ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    onClose();
  }

  function handleSubmit() {
    setError(null);
    if (!Number.isFinite(score) || score < 0) {
      setError("Điểm phải là số >= 0");
      return;
    }
    if (score > totalPoints) {
      setError(`Điểm vượt tổng điểm (${totalPoints})`);
      return;
    }
    startTransition(async () => {
      const res = await gradeSubmission({
        submissionId,
        score,
        feedback: feedback.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Gavel className="h-5 w-5 text-primary" />
          Chấm điểm bài nộp
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          HS: <strong>{studentName}</strong> · Tổng: {totalPoints}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">
              Điểm * (0 - {totalPoints})
            </span>
            <input
              type="number"
              min={0}
              max={totalPoints}
              step={0.1}
              value={score}
              onChange={(e) =>
                setScore(Math.max(0, parseFloat(e.target.value) || 0))
              }
              disabled={pending}
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">
              Nhận xét
            </span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              disabled={pending}
              placeholder="Đã làm tốt phần... cần improve..."
              className="w-full resize-y rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {pending ? "Đang lưu..." : "Lưu điểm"}
          </button>
        </div>
      </div>
    </div>
  );
}
