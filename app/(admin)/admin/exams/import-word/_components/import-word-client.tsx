"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

// ── Types (mirror lib/exams/docx-import.ts shape returned by /parse) ──────────
type DocxType = "SINGLE" | "MULTI" | "TRUE_FALSE";
interface Option {
  key: string;
  text: string;
  imageRId: string | null;
}
interface PreviewQuestion {
  questionCode: string;
  type: DocxType | null;
  rawType: string;
  text: string;
  questionImageRId: string | null;
  options: Option[];
  correctRaw: string;
  score: number | null;
  explanation: string | null;
  tags: string[];
  hasExternalImage: boolean;
  errors: string[];
  dbExists: boolean;
  valid: boolean;
}

interface ExamOpt {
  id: string;
  title: string;
  examCode: string | null;
}

const CORRECT_RE = /^[A-D](\s*,\s*[A-D])*$/i;

// Client-side re-validate (mirror server rules) cho badge tức thì khi sửa inline.
function revalidate(q: PreviewQuestion): string[] {
  const errors: string[] = [];
  if (!q.questionCode) errors.push("Thiếu QUESTION_CODE.");
  if (!q.type) errors.push("QUESTION_TYPE không hợp lệ (SINGLE/MULTI/TRUE_FALSE).");
  if (!q.text.trim()) errors.push("Thiếu QUESTION_TEXT.");
  if (q.score == null || q.score <= 0) errors.push("SCORE phải là số dương.");
  if (q.hasExternalImage) errors.push("Ảnh chèn bằng link internet không được hỗ trợ.");

  const letters = q.correctRaw
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (q.type === "TRUE_FALSE" && q.options.length !== 2)
    errors.push("TRUE_FALSE cần đúng 2 lựa chọn.");
  if (q.type) {
    if (q.options.length < 2) errors.push("Cần ít nhất 2 lựa chọn.");
    if (!q.correctRaw.trim()) errors.push("Thiếu CORRECT_ANSWER.");
    else if (!CORRECT_RE.test(q.correctRaw.trim()))
      errors.push('CORRECT_ANSWER sai định dạng. Dùng "A" hoặc "A,C".');
    else {
      const keys = new Set(q.options.map((o) => o.key));
      const ghost = letters.filter((l) => !keys.has(l));
      if (ghost.length > 0)
        errors.push(`CORRECT_ANSWER trỏ tới lựa chọn không tồn tại: ${ghost.join(", ")}.`);
      if (q.type === "SINGLE" && letters.length !== 1)
        errors.push("SINGLE cần đúng 1 đáp án đúng.");
      if (q.type === "TRUE_FALSE" && letters.length !== 1)
        errors.push("TRUE_FALSE cần đúng 1 đáp án đúng.");
    }
  }
  return errors;
}

export function ImportWordClient({
  exams,
  defaultExamId,
}: {
  exams: ExamOpt[];
  defaultExamId: string;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<PreviewQuestion[]>([]);
  const [media, setMedia] = useState<Record<string, string>>({});
  const [examId, setExamId] = useState(defaultExamId);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [largeFile, setLargeFile] = useState(false);
  const [pending, startTransition] = useTransition();

  const validCount = useMemo(
    () => questions.filter((q) => q.valid).length,
    [questions],
  );

  function patch(idx: number, partial: Partial<PreviewQuestion>) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== idx) return q;
        const next = { ...q, ...partial };
        const errors = revalidate(next);
        return { ...next, errors, valid: errors.length === 0 };
      }),
    );
  }

  function patchOption(idx: number, optIdx: number, text: string) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== idx) return q;
        const options = q.options.map((o, j) =>
          j === optIdx ? { ...o, text } : o,
        );
        const next = { ...q, options };
        const errors = revalidate(next);
        return { ...next, errors, valid: errors.length === 0 };
      }),
    );
  }

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/exams/import-word/parse", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: {
          questions: PreviewQuestion[];
          media: Record<string, string>;
          summary: { largeFile: boolean };
        };
      };
      if (!json.ok || !json.data) {
        setError(json.error ?? "Parse thất bại");
        setQuestions([]);
        return;
      }
      setQuestions(json.data.questions);
      setMedia(json.data.media);
      setLargeFile(json.data.summary.largeFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setParsing(false);
    }
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/exams/import-word/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examId: examId || null,
          questions: questions
            .filter((q) => q.valid)
            .map((q) => ({
              questionCode: q.questionCode,
              type: q.type,
              text: q.text,
              questionImageRId: q.questionImageRId,
              options: q.options,
              correctRaw: q.correctRaw,
              score: q.score,
              explanation: q.explanation,
              tags: q.tags,
            })),
          media,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { created: number; updated: number; skipped: number };
      };
      if (!json.ok) {
        setError(json.error ?? "Import thất bại");
        return;
      }
      setDone(
        `Đã import: tạo mới ${json.data?.created ?? 0}, cập nhật ${json.data?.updated ?? 0}, bỏ qua ${json.data?.skipped ?? 0}.`,
      );
      setTimeout(() => router.refresh(), 800);
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {done && (
        <div className="flex items-start gap-2 rounded-lg border border-state-success-soft bg-state-success-soft px-4 py-3 text-sm text-state-success-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{done}</span>
        </div>
      )}

      {/* Upload */}
      <div className="rounded-xl border border-border bg-card p-6">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center hover:border-primary">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {parsing ? "Đang đọc file..." : "Chọn file .docx để parse"}
          </span>
          <span className="text-xs text-muted-foreground">Chỉ chấp nhận .docx (≤ 10MB)</span>
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            disabled={parsing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {questions.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
            <div className="text-sm text-foreground">
              Tổng <strong>{questions.length}</strong> câu · hợp lệ{" "}
              <strong className="text-state-success-ink">{validCount}</strong> · lỗi{" "}
              <strong className="text-state-danger-ink">{questions.length - validCount}</strong>
              {largeFile && (
                <span className="ml-2 text-state-warning-ink">
                  (file lớn &gt;50 câu — xử lý đồng bộ; job nền là follow-up)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">— Không gắn vào đề —</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.examCode ? `${e.examCode} · ` : ""}
                    {e.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending || validCount === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Xác nhận import ({validCount})
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {questions.map((q, idx) => (
              <div
                key={idx}
                className={`rounded-xl border bg-card p-4 ${ q.valid ? "border-border" : "border-state-danger" }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                    {q.questionCode || "(thiếu code)"}
                  </span>
                  {q.dbExists && (
                    <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-xs text-state-info-ink">
                      sẽ cập nhật
                    </span>
                  )}
                  {q.valid ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2 py-0.5 text-xs text-state-success-ink">
                      <CheckCircle2 className="h-3 w-3" /> hợp lệ
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-state-danger-soft px-2 py-0.5 text-xs font-semibold text-state-danger-ink">
                      <AlertCircle className="h-3 w-3" /> {q.errors.length} lỗi
                    </span>
                  )}
                </div>

                {!q.valid && (
                  <ul className="mb-2 list-inside list-disc text-xs text-state-danger-ink">
                    {q.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}

                <div className="grid gap-2 md:grid-cols-[140px_1fr]">
                  <select
                    value={q.type ?? ""}
                    onChange={(e) =>
                      patch(idx, { type: (e.target.value || null) as DocxType | null })
                    }
                    className="rounded-md border border-border px-2 py-1.5 text-sm"
                  >
                    <option value="">(loại?)</option>
                    <option value="SINGLE">SINGLE</option>
                    <option value="MULTI">MULTI</option>
                    <option value="TRUE_FALSE">TRUE_FALSE</option>
                  </select>
                  <textarea
                    value={q.text}
                    onChange={(e) => patch(idx, { text: e.target.value })}
                    rows={2}
                    placeholder="Đề bài"
                    className="resize-y rounded-md border border-border px-2 py-1.5 text-sm"
                  />
                </div>

                {q.questionImageRId && media[q.questionImageRId] && (
                  <img
                    src={media[q.questionImageRId]}
                    alt="ảnh đề"
                    className="mt-2 max-h-40 rounded border border-border"
                  />
                )}

                {q.options.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {q.options.map((o, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <span className="w-6 text-center font-bold text-muted-foreground">
                          {o.key}.
                        </span>
                        <input
                          value={o.text}
                          onChange={(e) => patchOption(idx, j, e.target.value)}
                          className="flex-1 rounded-md border border-border px-2 py-1 text-sm"
                        />
                        {o.imageRId && media[o.imageRId] && (
                          <img
                            src={media[o.imageRId]}
                            alt={`ảnh ${o.key}`}
                            className="h-10 w-10 rounded border border-border object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <span className="text-muted-foreground">Đáp án đúng:</span>
                    <input
                      value={q.correctRaw}
                      onChange={(e) => patch(idx, { correctRaw: e.target.value })}
                      placeholder="A hoặc A,C"
                      className="w-24 rounded-md border border-border px-2 py-1"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-muted-foreground">Điểm:</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={q.score ?? ""}
                      onChange={(e) =>
                        patch(idx, {
                          score: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="w-20 rounded-md border border-border px-2 py-1"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
