"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, Copy, Archive, CheckCircle2 } from "lucide-react";
import { QuestionBuilder, emptyQuestion, type DraftQuestion } from "./question-builder";
import { createFormAction, cloneFormAction, setFormStatusAction } from "../_actions";

type Scope = "TEACHER_EVAL" | "CENTER_SURVEY" | "SESSION_EVAL";

export type FormRow = {
  id: string;
  title: string;
  scope: Scope;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  questions: number;
  rounds: number;
};

const SCOPE_LABEL = {
  TEACHER_EVAL: "Đánh giá GV",
  CENTER_SURVEY: "Khảo sát cơ sở",
  SESSION_EVAL: "Đánh giá buổi học",
} as const;
const STATUS_STYLE = {
  DRAFT: "bg-muted text-muted-foreground",
  ACTIVE: "bg-state-success-soft text-state-success-ink",
  ARCHIVED: "bg-state-warning-soft text-state-warning-ink",
} as const;
const STATUS_LABEL: Record<keyof typeof STATUS_STYLE, string> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang dùng",
  ARCHIVED: "Lưu trữ",
};

export function FormsManager({ forms }: { forms: FormRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<Scope>("TEACHER_EVAL");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);

  function submitNew() {
    startTransition(async () => {
      const res = await createFormAction({ title, scope, questions });
      if (res.ok) {
        toast.success("Đã tạo form");
        setCreating(false);
        setTitle("");
        setQuestions([emptyQuestion()]);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Mẫu form</h2>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          <FilePlus2 className="h-4 w-4" /> Tạo form
        </button>
      </div>

      {creating && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tiêu đề form…"
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="TEACHER_EVAL">Đánh giá GV (học viên)</option>
              <option value="CENTER_SURVEY">Khảo sát cơ sở (phụ huynh)</option>
              <option value="SESSION_EVAL">Đánh giá buổi học (GV chấm HS)</option>
            </select>
          </div>
          {/* PHOTO chỉ cho SESSION_EVAL — portal PH không có input tải ảnh. */}
          <QuestionBuilder questions={questions} onChange={setQuestions} allowPhoto={scope === "SESSION_EVAL"} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitNew}
              disabled={pending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
            >
              {pending ? "Đang lưu…" : "Lưu form"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {forms.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Chưa có form nào.</p>
        ) : (
          <ul className="divide-y divide-border">
            {forms.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <Link href={`/evaluations/${f.id}`} className="font-medium text-foreground hover:text-primary">
                    {f.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[f.status]}`}>{STATUS_LABEL[f.status] ?? f.status}</span>
                    <span>{SCOPE_LABEL[f.scope]}</span>
                    <span>· {f.questions} câu</span>
                    <span>· {f.rounds} đợt</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {f.status === "DRAFT" && (
                    <button
                      type="button"
                      onClick={() => act(() => setFormStatusAction(f.id, "ACTIVE"), "Đã kích hoạt")}
                      className="inline-flex items-center gap-1 rounded-md border border-state-success-soft px-2 py-1 text-xs font-medium text-state-success-ink hover:bg-state-success-soft"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Kích hoạt
                    </button>
                  )}
                  {f.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => act(() => setFormStatusAction(f.id, "ARCHIVED"), "Đã lưu trữ")}
                      className="inline-flex items-center gap-1 rounded-md border border-state-warning-soft px-2 py-1 text-xs font-medium text-state-warning-ink hover:bg-state-warning-soft"
                    >
                      <Archive className="h-3.5 w-3.5" /> Lưu trữ
                    </button>
                  )}
                  {f.status === "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => act(() => setFormStatusAction(f.id, "DRAFT"), "Đã kích hoạt lại")}
                      className="inline-flex items-center gap-1 rounded-md border border-state-success-soft px-2 py-1 text-xs font-medium text-state-success-ink hover:bg-state-success-soft"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Kích hoạt lại
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => act(() => cloneFormAction(f.id), "Đã nhân bản")}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" /> Nhân bản
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
