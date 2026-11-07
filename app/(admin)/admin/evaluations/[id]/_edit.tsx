"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { QuestionBuilder, type DraftQuestion } from "../_components/question-builder";
import { updateQuestionsAction, cloneFormAction } from "../_actions";

export function FormEditor({
  formId,
  initial,
  locked,
  allowPhoto = true,
}: {
  formId: string;
  initial: DraftQuestion[];
  locked: boolean;
  /** PHOTO chỉ cho SESSION_EVAL (page truyền theo form.scope). */
  allowPhoto?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [questions, setQuestions] = useState<DraftQuestion[]>(initial);

  function save() {
    startTransition(async () => {
      const res = await updateQuestionsAction(formId, questions);
      if (res.ok) {
        toast.success("Đã lưu câu hỏi");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function clone() {
    startTransition(async () => {
      const res = await cloneFormAction(formId);
      if (res.ok && res.data) {
        toast.success("Đã nhân bản — chuyển sang bản nháp mới");
        router.push(`/evaluations/${res.data.id}`);
      } else toast.error(res.ok ? "Lỗi" : res.error);
    });
  }

  return (
    <div className="space-y-3">
      {locked && (
        <div className="flex items-start gap-2 rounded-lg border border-state-warning-soft bg-state-warning-soft p-3 text-sm text-state-warning-ink">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Form đã có phản hồi nên <strong>không thể sửa câu hỏi/lựa chọn</strong>. Hãy lưu trữ form này và
            <strong> nhân bản</strong> để chỉnh sửa trên bản mới rồi tạo đợt mới.
          </p>
        </div>
      )}

      <QuestionBuilder questions={questions} onChange={setQuestions} disabled={locked} allowPhoto={allowPhoto} />

      <div className="flex gap-2">
        {!locked && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            {pending ? "Đang lưu…" : "Lưu câu hỏi"}
          </button>
        )}
        <button
          type="button"
          onClick={clone}
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
        >
          Nhân bản form
        </button>
      </div>
    </div>
  );
}
