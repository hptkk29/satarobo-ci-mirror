"use client";

// template-questions-editor.tsx — soạn câu hỏi TRỰC TIẾP trong mẫu bài tập
// (parity site GV 18/08: "thư viện admin làm lại giống phần tạo bài tập").
//
// Thay picker ngân hàng cũ: admin/Đào tạo trộn 8 loại câu hỏi bằng đúng bộ soạn
// QuestionListEditor của GV, xem trước như học viên thấy (QuestionView), lưu qua
// saveTemplateQuestionsAuthored (Question riêng của mẫu + link theo thứ tự).
// Mẫu 0 câu = mẫu mô tả thuần ("chưa số hoá") — vẫn lưu được.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionListEditor, newQuestionId } from "@/components/assignments/question-editor";
import { QuestionView } from "@/components/assignments/question-view";
import {
  blankQuestion,
  cleanQuestion,
  cloneQuestion,
  validateQuestion,
  type ContentQuestion,
} from "@/lib/assignments/question-content";
import { saveTemplateQuestionsAuthored } from "../_actions";

export function TemplateQuestionsEditor({
  templateId,
  templateTitle,
  initialQuestions,
}: {
  templateId: string;
  templateTitle: string;
  initialQuestions: ContentQuestion[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<ContentQuestion[]>(() =>
    initialQuestions.map(cloneQuestion),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pending, start] = useTransition();

  function addFirst() {
    setQuestions([blankQuestion("single", newQuestionId())]);
  }

  function save() {
    for (let i = 0; i < questions.length; i++) {
      const err = validateQuestion(questions[i]!, i + 1);
      if (err) {
        toast.error(err);
        return;
      }
    }
    const cleaned = questions.map(cleanQuestion);
    start(async () => {
      const res = await saveTemplateQuestionsAuthored({
        templateId,
        questions: cleaned,
      });
      if (res.ok) {
        toast.success("Đã lưu bộ câu hỏi của mẫu");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-wider text-foreground uppercase">
            Câu hỏi của mẫu
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Trộn nhiều loại câu hỏi trong cùng một đầu bài — giáo viên chọn mẫu này để
            giao cho lớp. Mẫu không có câu hỏi vẫn giao được (đề chưa số hoá).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {questions.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="h-4 w-4" aria-hidden /> Xem trước
            </Button>
          )}
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            <Save className="h-4 w-4" aria-hidden />
            {pending ? "Đang lưu…" : "Lưu bộ câu hỏi"}
          </Button>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-semibold text-foreground">
            Mẫu chưa có câu hỏi số hoá
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Thêm câu hỏi để giáo viên xem trước được đề và học viên làm bài trên hệ
            thống. Hoặc giữ nguyên nếu đề nằm trong file đính kèm/mô tả.
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={addFirst}>
            Thêm câu hỏi đầu tiên
          </Button>
        </div>
      ) : (
        <QuestionListEditor questions={questions} onChange={setQuestions} />
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-xl flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{templateTitle}</DialogTitle>
            <DialogDescription>
              Xem trước như học viên thấy · {questions.length} câu (đáp án đúng tô xanh)
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <ol className="space-y-4">
              {questions.map((q, i) => (
                <QuestionView key={q.id} question={q} index={i} />
              ))}
            </ol>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
