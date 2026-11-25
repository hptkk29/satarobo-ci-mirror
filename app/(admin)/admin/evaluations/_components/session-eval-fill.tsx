"use client";

// FL4 — GV điền phiếu đánh giá BUỔI HỌC (SESSION_EVAL) động theo từng HS.
// Phiếu nạp LƯỜI (bấm nút) qua server action — không useEffect-fetch (rule admin).
// Hỗ trợ: nhóm tiêu chí (groupLabel, R5), ô tải ảnh (PHOTO, R5), nhập tự do kèm
// lựa chọn (allowCustomText, R6). SessionEvalEditor dùng chung cho lớp chính + lớp
// trải nghiệm (R4) qua callback load/save.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck, Save, X } from "lucide-react";
import type { QuestionDef, SubmittedAnswer } from "@/lib/eval/schema";
import type { StudentEvalSubmission, SessionEvalState } from "@/lib/eval/session-eval";
import { FileUploader, type UploadResult } from "@/components/admin/file-uploader";
import { loadSessionEvalAction, saveSessionEvalAction } from "@/lib/eval/session-eval-actions";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type StudentLite = { studentId: string; name: string; present: boolean };

type AnswerState = { valueNumber: number | null; valueOptions: string[]; valueText: string };
type StudentAnswers = Record<string, AnswerState>; // questionId → answer

function blankAnswer(): AnswerState {
  return { valueNumber: null, valueOptions: [], valueText: "" };
}

function fromSubmitted(answers: SubmittedAnswer[] | undefined): StudentAnswers {
  const out: StudentAnswers = {};
  for (const a of answers ?? []) {
    out[a.questionId] = {
      valueNumber: a.valueNumber ?? null,
      valueOptions: a.valueOptions ?? [],
      valueText: a.valueText ?? "",
    };
  }
  return out;
}

function hasAnyAnswer(sa: StudentAnswers | undefined): boolean {
  if (!sa) return false;
  return Object.values(sa).some(
    (a) => a.valueNumber != null || a.valueOptions.length > 0 || a.valueText.trim().length > 0,
  );
}

/** Gom câu hỏi theo groupLabel (giữ thứ tự xuất hiện đầu tiên của mỗi nhóm). */
function groupQuestions(qs: QuestionDef[]): { label: string | null; questions: QuestionDef[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, QuestionDef[]>();
  for (const q of qs) {
    const key = q.groupLabel ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(q);
  }
  return order.map((label) => ({ label, questions: map.get(label)! }));
}

// ─── Editor dùng chung (lớp chính + lớp trải nghiệm) ─────────────────────────
export function SessionEvalEditor({
  students,
  canEdit,
  load,
  save,
}: {
  students: StudentLite[];
  canEdit: boolean;
  load: () => Promise<ActionResult<SessionEvalState>>;
  save: (roundId: string, submissions: StudentEvalSubmission[]) => Promise<ActionResult<{ saved: number }>>;
}) {
  const router = useRouter();
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [opened, setOpened] = useState(false);
  const [round, setRound] = useState<{ roundId: string; title: string; questions: QuestionDef[] } | null>(null);
  const [noForm, setNoForm] = useState(false);
  const [byStudent, setByStudent] = useState<Record<string, StudentAnswers>>({});
  const [sel, setSel] = useState(0);

  function open() {
    startLoad(async () => {
      const res = await load();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpened(true);
      if (!res.data.active) {
        setNoForm(true);
        setRound(null);
        return;
      }
      const st = res.data;
      setRound({ roundId: st.roundId, title: st.formTitle, questions: st.questions });
      const init: Record<string, StudentAnswers> = {};
      for (const s of students) init[s.studentId] = fromSubmitted(st.answersByStudent[s.studentId]);
      setByStudent(init);
      setNoForm(false);
    });
  }

  function patch(studentId: string, questionId: string, p: Partial<AnswerState>) {
    setByStudent((cur) => {
      const sa = { ...(cur[studentId] ?? {}) };
      sa[questionId] = { ...(sa[questionId] ?? blankAnswer()), ...p };
      return { ...cur, [studentId]: sa };
    });
  }

  function doSave() {
    if (!round) return;
    const submissions: StudentEvalSubmission[] = students
      .filter((s) => hasAnyAnswer(byStudent[s.studentId]))
      .map((s) => {
        const sa = byStudent[s.studentId] ?? {};
        return {
          studentId: s.studentId,
          answers: round.questions.map((q) => {
            const a = sa[q.id] ?? blankAnswer();
            const usesOptions = q.type === "RADIO" || q.type === "CHECKBOX" || q.type === "PHOTO";
            const usesText = q.type === "TEXTBOX" || (!!q.allowCustomText && q.type !== "PHOTO");
            return {
              questionId: q.id,
              valueNumber: q.type === "STAR_RATING" ? a.valueNumber : null,
              valueOptions: usesOptions ? a.valueOptions : null,
              valueText: usesText ? a.valueText : null,
            };
          }),
        };
      });
    if (submissions.length === 0) {
      toast.error("Chưa điền phiếu cho học sinh nào");
      return;
    }
    startSave(async () => {
      const res = await save(round.roundId, submissions);
      if (res.ok) {
        toast.success(`Đã lưu phiếu cho ${res.data.saved} học sinh`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-primary-soft bg-primary-soft px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-soft-hover disabled:opacity-60"
      >
        <ClipboardCheck className="h-4 w-4" />
        {loading ? "Đang tải phiếu…" : "Phiếu đánh giá buổi học"}
      </button>
    );
  }

  if (noForm || !round) {
    return (
      <p className="text-sm text-muted-foreground">
        Hiện chưa có phiếu đánh giá buổi nào đang mở áp cho lớp này.
      </p>
    );
  }

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">Buổi chưa có học sinh để đánh giá.</p>;
  }

  const current = students[sel];
  const groups = groupQuestions(round.questions);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary-soft bg-primary-soft/50 px-3 py-2 text-xs text-primary">
        Phiếu: <strong>{round.title}</strong>
      </div>

      {/* chọn HS */}
      <div className="flex flex-wrap gap-1.5">
        {students.map((s, i) => {
          const done = hasAnyAnswer(byStudent[s.studentId]);
          return (
            <button
              key={s.studentId}
              type="button"
              onClick={() => setSel(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${ i === sel ? "bg-primary text-white" : done ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground" }`}
            >
              {s.name}
              {done ? " ✓" : ""}
              {!s.present ? " (vắng)" : ""}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="space-y-5 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">{current.name}</p>
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-4">
              {g.label && (
                <h4 className="border-b border-border pb-1 text-xs font-bold uppercase tracking-wider text-primary">
                  {g.label}
                </h4>
              )}
              {g.questions.map((q) => (
                <QuestionField
                  key={q.id}
                  q={q}
                  a={byStudent[current.studentId]?.[q.id] ?? blankAnswer()}
                  disabled={!canEdit || saving}
                  studentId={current.studentId}
                  onPatch={(p) => patch(current.studentId, q.id, p)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={doSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Đang lưu…" : "Lưu phiếu đánh giá buổi"}
        </button>
      )}
    </div>
  );
}

function QuestionField({
  q,
  a,
  disabled,
  studentId,
  onPatch,
}: {
  q: QuestionDef;
  a: AnswerState;
  disabled: boolean;
  studentId: string;
  onPatch: (p: Partial<AnswerState>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">
        {q.label}
        {q.required && <span className="ml-1 text-state-danger-ink">*</span>}
      </label>

      {q.type === "STAR_RATING" && (
        <select
          value={a.valueNumber ?? ""}
          disabled={disabled}
          onChange={(e) => onPatch({ valueNumber: e.target.value ? Number(e.target.value) : null })}
          className="h-9 rounded-lg border border-border px-2 text-sm disabled:bg-muted"
          aria-label={q.label}
        >
          <option value="">— sao —</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} ★
            </option>
          ))}
        </select>
      )}

      {q.type === "RADIO" && (
        <div className="space-y-1">
          {(q.options ?? []).map((opt) => (
            <label key={opt} className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={`${studentId}-${q.id}`}
                checked={a.valueOptions[0] === opt}
                disabled={disabled}
                onChange={() => onPatch({ valueOptions: [opt] })}
                className="mt-1"
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}

      {q.type === "CHECKBOX" && (
        <div className="space-y-1">
          {(q.options ?? []).map((opt) => {
            const checked = a.valueOptions.includes(opt);
            return (
              <label key={opt} className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onPatch({
                      valueOptions: checked
                        ? a.valueOptions.filter((o) => o !== opt)
                        : [...a.valueOptions, opt],
                    })
                  }
                  className="mt-1"
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}

      {q.type === "PHOTO" && (
        <PhotoField urls={a.valueOptions} disabled={disabled} onChange={(urls) => onPatch({ valueOptions: urls })} />
      )}

      {q.type === "TEXTBOX" && (
        <textarea
          value={a.valueText}
          disabled={disabled}
          rows={2}
          onChange={(e) => onPatch({ valueText: e.target.value })}
          placeholder="Nhận xét…"
          className="w-full resize-y rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
        />
      )}

      {/* R6 — nhập tự do kèm lựa chọn (STAR/RADIO/CHECKBOX). */}
      {q.allowCustomText && q.type !== "TEXTBOX" && q.type !== "PHOTO" && (
        <input
          value={a.valueText}
          disabled={disabled}
          onChange={(e) => onPatch({ valueText: e.target.value })}
          placeholder="Ghi chú thêm (tuỳ chọn)…"
          className="w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
        />
      )}
    </div>
  );
}

function PhotoField({
  urls,
  disabled,
  onChange,
}: {
  urls: string[];
  disabled: boolean;
  onChange: (urls: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {urls.map((u) => (
            <div key={u} className="relative overflow-hidden rounded-lg border border-border">
              <img src={u} alt="Ảnh" className="h-20 w-full object-cover" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(urls.filter((x) => x !== u))}
                  className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70"
                  aria-label="Xoá ảnh"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <FileUploader
          acceptedCategories={["image"]}
          multiple
          showPreview={false}
          onUploaded={(r: UploadResult) => onChange([...urls, r.url])}
          onError={(e) => toast.error(e)}
        />
      )}
    </div>
  );
}

// ─── Lớp chính (ClassSession) — wrapper mỏng dùng action lớp chính ───────────
export function SessionEvalFill({
  sessionId,
  students,
  canEdit,
}: {
  sessionId: string;
  students: StudentLite[];
  canEdit: boolean;
}) {
  return (
    <SessionEvalEditor
      students={students}
      canEdit={canEdit}
      load={() => loadSessionEvalAction(sessionId)}
      save={(roundId, submissions) => saveSessionEvalAction({ sessionId, roundId, submissions })}
    />
  );
}
