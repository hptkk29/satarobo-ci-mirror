"use client";

// create-assignment-dialog.tsx — dialog "Tạo bài tập" / "Sửa bài tập" của kho GV
// (parity site GV 18/08, port từ satarobo-ui-giaovien create-assignment-dialog.tsx).
//
// Soạn một đầu bài trộn 8 loại câu hỏi (QuestionListEditor dùng chung) → lưu vào
// kho riêng của GV qua createOwnTemplateAction / updateOwnTemplateAction. Soạn một
// lần, giao lại nhiều lần. Dialog CONTROLLED theo pattern site GV (không DialogTrigger);
// `renderTrigger` cho phép nơi gọi tự vẽ nút mở (nút outline, icon bút chì, link chữ...).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { AssignmentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AttachmentUpload,
  type UploadedFile,
} from "@/components/assignments/attachment-upload";
import {
  QuestionListEditor,
  Segmented,
  newQuestionId,
} from "@/components/assignments/question-editor";
import {
  blankQuestion,
  cleanQuestion,
  cloneQuestion,
  validateQuestion,
  type ContentQuestion,
} from "@/lib/assignments/question-content";
import { createOwnTemplateAction, updateOwnTemplateAction } from "../_actions";
import type { KhoCourseOption, KhoTemplate } from "../_types";

/** Giá trị "không gắn khoá" của ô chọn khoá học (đề dùng chung mọi khoá). */
const ANY_COURSE = "__any__";

export function CreateAssignmentDialog({
  courses,
  defaultCourseId,
  defaultKind = "HOMEWORK",
  template,
  renderTrigger,
  onSaved,
}: {
  /** Các khoá GV có thể gắn đề (suy từ lớp phụ trách). */
  courses: KhoCourseOption[];
  defaultCourseId?: string | null;
  defaultKind?: AssignmentKind;
  /** Có = mở ở chế độ SỬA đầu bài này; không có = tạo mới. */
  template?: KhoTemplate;
  /** Tự vẽ nút mở dialog; mặc định = nút outline "Tạo bài tập". */
  renderTrigger?: (open: () => void) => React.ReactNode;
  onSaved?: (templateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = !!template;

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Tạo bài tập
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] sm:max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{isEdit ? "Sửa bài tập" : "Tạo bài tập mới"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Chỉnh sửa đầu bài trong kho. Thay đổi áp cho lần giao bài sau."
                : "Trộn nhiều loại câu hỏi trong cùng một đầu bài. Lưu vào kho rồi giao lại nhiều lần."}
            </DialogDescription>
          </DialogHeader>
          {/* key: mở lại là form sạch */}
          <CreateForm
            key={`${String(open)}-${template?.id ?? "new"}`}
            courses={courses}
            defaultCourseId={defaultCourseId}
            defaultKind={defaultKind}
            template={template}
            onDone={(id) => {
              setOpen(false);
              if (id) onSaved?.(id);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateForm({
  courses,
  defaultCourseId,
  defaultKind,
  template,
  onDone,
}: {
  courses: KhoCourseOption[];
  defaultCourseId?: string | null;
  defaultKind: AssignmentKind;
  template?: KhoTemplate;
  /** Gọi khi đóng form; id có giá trị khi đã lưu thành công. */
  onDone: (templateId?: string) => void;
}) {
  const router = useRouter();
  const isEdit = !!template;

  // Đề đang SỬA có thể gắn khoá GV không còn dạy (kỳ sau đổi lớp) — vẫn phải giữ
  // được lựa chọn đó, nên thêm option riêng thay vì âm thầm rơi về "mọi khoá".
  const courseOptions =
    template?.courseId && !courses.some((c) => c.id === template.courseId)
      ? [...courses, { id: template.courseId, name: template.courseName ?? "Khoá cũ" }]
      : courses;

  const validCourse = (id: string | null | undefined) =>
    id && courseOptions.some((c) => c.id === id) ? id : ANY_COURSE;

  const [title, setTitle] = useState(template?.title ?? "");
  const [courseId, setCourseId] = useState<string>(
    template ? validCourse(template.courseId) : validCourse(defaultCourseId),
  );
  const [kind, setKind] = useState<AssignmentKind>(template?.kind ?? defaultKind);
  const [totalPoints, setTotalPoints] = useState(String(template?.totalPoints ?? 10));
  const [description, setDescription] = useState(template?.description ?? "");
  const [questions, setQuestions] = useState<ContentQuestion[]>(
    template?.questions.length
      ? template.questions.map(cloneQuestion)
      : [blankQuestion("single", newQuestionId())],
  );
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [pending, start] = useTransition();

  function submit() {
    const finalTitle = title.trim();
    if (!finalTitle) {
      toast.error("Hãy nhập tiêu đề bài tập");
      return;
    }
    const points = Number(totalPoints);
    if (!Number.isFinite(points) || points <= 0) {
      toast.error("Thang điểm phải lớn hơn 0");
      return;
    }
    if (questions.length === 0) {
      toast.error("Hãy thêm ít nhất một câu hỏi");
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const err = validateQuestion(questions[i]!, i + 1);
      if (err) {
        toast.error(err);
        return;
      }
    }

    const payload = {
      title: finalTitle,
      kind,
      description: description.trim(),
      courseId: courseId === ANY_COURSE ? null : courseId,
      totalPoints: points,
      questions: questions.map(cleanQuestion),
      attachments: attachments.map((f) => ({
        fileUrl: f.url,
        fileName: f.name,
        fileSize: f.size || null,
        mimeType: f.mime || null,
      })),
    };

    start(async () => {
      const res = isEdit
        ? await updateOwnTemplateAction({ ...payload, templateId: template!.id })
        : await createOwnTemplateAction(payload);
      if (res.ok) {
        toast.success(isEdit ? "Đã cập nhật bài tập" : "Đã lưu vào kho bài tập", {
          description: finalTitle,
        });
        router.refresh();
        onDone(res.templateId);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <Field label="Tiêu đề">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            kind === "CLASSWORK" ? "VD: Kiểm tra chương 2" : "VD: Ôn tập vòng lặp"
          }
          className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Khoá học">
          <Select
            value={courseId}
            onValueChange={(v) => {
              if (v !== null) setCourseId(v);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  v === ANY_COURSE
                    ? "Dùng chung mọi khoá"
                    : (courseOptions.find((c) => c.id === v)?.name ?? "")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_COURSE}>Dùng chung mọi khoá</SelectItem>
              {courseOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Hình thức">
          <Segmented
            options={[
              { value: "HOMEWORK", label: "Bài tập" },
              { value: "CLASSWORK", label: "Kiểm tra" },
            ]}
            value={kind}
            onChange={(v) => setKind(v as AssignmentKind)}
          />
        </Field>

        <Field label="Thang điểm">
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={totalPoints}
            onChange={(e) => setTotalPoints(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
      </div>

      <Field label="Mô tả ngắn (không bắt buộc)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Mục tiêu, phạm vi kiến thức, lưu ý khi làm bài..."
          className="w-full resize-y rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <QuestionListEditor questions={questions} onChange={setQuestions} />

      {/* BGĐ 31/07 — file+ảnh đề bài. Khi SỬA: file cũ giữ nguyên, chỉ thêm mới. */}
      <Field
        label={
          isEdit
            ? "Thêm tệp/ảnh đề bài (file cũ giữ nguyên)"
            : "Tệp/ảnh đề bài (không bắt buộc)"
        }
      >
        <AttachmentUpload value={attachments} onChange={setAttachments} disabled={pending} />
      </Field>

      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
        <Button variant="outline" onClick={() => onDone()} disabled={pending}>
          Huỷ
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? (
            "Đang lưu…"
          ) : isEdit ? (
            "Lưu thay đổi"
          ) : (
            <>
              <Plus className="h-4 w-4" aria-hidden /> Lưu vào kho
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-foreground">{label}</p>
      {children}
    </div>
  );
}
