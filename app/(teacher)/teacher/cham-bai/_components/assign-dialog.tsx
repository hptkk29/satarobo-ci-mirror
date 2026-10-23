"use client";

// assign-dialog.tsx — dialog "Giao bài cho lớp" (parity site GV 18/08, port từ
// satarobo-ui-giaovien assign-dialog.tsx, nối assignTemplateAction thật).
//
// Đầu bài lấy từ kho GV tự soạn (mặc định) hoặc thư viện admin cài sẵn, lọc theo
// hình thức + khoá của lớp. Bài tập về nhà có hạn nộp (ngày + giờ); bài kiểm tra
// có thời điểm mở và đóng làm bài. Gắn buổi học (không bắt buộc). Giữ thêm ô đính
// kèm tệp theo QĐ BGĐ 31/07 (ngoài phạm vi bản mock).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListChecks, Send } from "lucide-react";
import type { AssignmentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";
import { CreateAssignmentDialog } from "../../kho-bai-tap/_components/create-assignment-dialog";
import type { KhoCourseOption, KhoTemplate } from "../../kho-bai-tap/_types";
import { assignTemplateAction } from "../_actions";
import type { AssignClassOption, AssignSessionOption } from "../_data";

const NO_SESSION = "__none__";
type Origin = "teacher" | "admin";

/** Hôm nay (giờ VN) — chặn giao bài với hạn ở quá khứ, như bản mock. */
function todayVN(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}

export function AssignDialog({
  classes,
  sessions,
  courses,
  mine,
  library,
  canAuthor,
  triggerLabel = "Giao bài",
}: {
  /** Các lớp GV có thể giao bài. Nhiều hơn 1 thì hiện ô chọn lớp. */
  classes: AssignClassOption[];
  sessions: AssignSessionOption[];
  courses: KhoCourseOption[];
  /** Kho GV tự soạn + thư viện admin (đã lọc theo khoá GV phụ trách ở server). */
  mine: KhoTemplate[];
  library: KhoTemplate[];
  canAuthor: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  if (classes.length === 0) return null;

  return (
    <>
      <Button className="shrink-0" onClick={() => setOpen(true)}>
        <Send className="h-4 w-4" aria-hidden /> {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] sm:max-w-lg flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>
              {classes.length === 1
                ? `Giao bài cho lớp ${classes[0]!.name}`
                : "Giao bài cho lớp"}
            </DialogTitle>
          </DialogHeader>
          {/* key: mở lại là form sạch */}
          <AssignForm
            key={String(open)}
            classes={classes}
            sessions={sessions}
            courses={courses}
            mine={mine}
            library={library}
            canAuthor={canAuthor}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssignForm({
  classes,
  sessions,
  courses,
  mine,
  library,
  canAuthor,
  onDone,
}: {
  classes: AssignClassOption[];
  sessions: AssignSessionOption[];
  courses: KhoCourseOption[];
  mine: KhoTemplate[];
  library: KhoTemplate[];
  canAuthor: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const TODAY = useMemo(todayVN, []);
  const MIN_DT = `${TODAY}T00:00`;

  const [classId, setClassId] = useState(classes[0]!.id);
  const [kind, setKind] = useState<AssignmentKind>("HOMEWORK");
  const [origin, setOrigin] = useState<Origin>("teacher");
  const [templateId, setTemplateId] = useState("");
  const [sessionId, setSessionId] = useState(NO_SESSION);
  const [due, setDue] = useState(""); // bài tập: hạn nộp (datetime-local)
  const [openAt, setOpenAt] = useState(""); // kiểm tra: mở bài
  const [closeAt, setCloseAt] = useState(""); // kiểm tra: đóng bài
  // BGĐ 31/07 — GV đính kèm thêm file+ảnh riêng cho lần giao này.
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [pending, start] = useTransition();

  const cls = classes.find((c) => c.id === classId) ?? classes[0]!;
  const isTest = kind === "CLASSWORK";

  // Đầu bài của nguồn đang chọn: đúng hình thức + đúng khoá của lớp (đề không gắn
  // khoá dùng được cho mọi lớp).
  const source = useMemo(() => {
    const pool = origin === "teacher" ? mine : library;
    return pool.filter(
      (t) =>
        t.kind === kind && (t.courseId === null || t.courseId === cls.courseId),
    );
  }, [origin, mine, library, kind, cls.courseId]);
  const selected = source.find((t) => t.id === templateId);

  const classSessions = useMemo(
    () => sessions.filter((s) => s.classId === cls.id),
    [sessions, cls.id],
  );

  function submit() {
    if (!selected) {
      toast.error(
        origin === "teacher"
          ? "Hãy chọn một bài từ kho của bạn"
          : "Hãy chọn một mẫu từ thư viện",
      );
      return;
    }

    if (isTest) {
      if (!openAt || !closeAt) {
        toast.error("Hãy nhập thời điểm mở và đóng bài kiểm tra");
        return;
      }
      if (openAt >= closeAt) {
        toast.error("Thời điểm đóng phải sau thời điểm mở");
        return;
      }
      if (closeAt.slice(0, 10) < TODAY) {
        toast.error("Thời gian kiểm tra không thể ở quá khứ");
        return;
      }
    } else {
      if (!due) {
        toast.error("Hãy nhập hạn nộp");
        return;
      }
      if (due.slice(0, 10) < TODAY) {
        toast.error("Hạn nộp không thể ở quá khứ");
        return;
      }
    }

    start(async () => {
      const res = await assignTemplateAction({
        templateId: selected.id,
        classId: cls.id,
        sessionId: sessionId === NO_SESSION ? null : sessionId,
        due: isTest ? null : due,
        openAt: isTest ? openAt : null,
        closeAt: isTest ? closeAt : null,
        attachments: attachments.map((f) => ({
          fileUrl: f.url,
          fileName: f.name,
          fileSize: f.size || null,
          mimeType: f.mime || null,
        })),
      });
      if (res.ok) {
        toast.success("Đã giao bài cho lớp", {
          description: `${selected.title} · ${cls.name}`,
        });
        router.refresh();
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  const sessionField = (
    <Field label="Buổi học (không bắt buộc)">
      <Select
        value={sessionId}
        onValueChange={(v) => {
          if (v !== null) setSessionId(v);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(v: string | null) =>
              v === NO_SESSION
                ? "- Không gắn buổi -"
                : (classSessions.find((s) => s.id === v)?.label ?? "")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SESSION}>- Không gắn buổi -</SelectItem>
          {classSessions.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      {classes.length > 1 && (
        <Field label="Lớp">
          <Select
            value={classId}
            onValueChange={(v) => {
              if (v === null) return;
              setClassId(v);
              setTemplateId("");
              setSessionId(NO_SESSION);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => {
                  const c = classes.find((x) => x.id === v);
                  return c ? `${c.name}${c.courseName ? ` · ${c.courseName}` : ""}` : "";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.courseName ? ` · ${c.courseName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hình thức">
          <RadioRow
            name="kind"
            value={kind}
            onChange={(v) => {
              setKind(v as AssignmentKind);
              setTemplateId("");
            }}
            options={[
              { value: "HOMEWORK", label: "Bài tập về nhà" },
              { value: "CLASSWORK", label: "Bài kiểm tra" },
            ]}
          />
        </Field>

        <Field label="Nguồn đầu bài">
          <RadioRow
            name="origin"
            value={origin}
            onChange={(v) => {
              setOrigin(v as Origin);
              setTemplateId("");
            }}
            options={[
              { value: "teacher", label: "Kho của tôi" },
              { value: "admin", label: "Thư viện admin" },
            ]}
          />
        </Field>
      </div>

      <Field
        label={origin === "teacher" ? "Chọn bài trong kho" : "Chọn mẫu admin cài sẵn"}
        action={
          origin === "teacher" && canAuthor ? (
            <CreateAssignmentDialog
              courses={courses}
              defaultCourseId={cls.courseId}
              defaultKind={kind}
              onSaved={(id) => setTemplateId(id)}
              renderTrigger={(openDialog) => (
                <button
                  type="button"
                  onClick={openDialog}
                  className="text-xs font-semibold text-primary-ink hover:text-primary-ink-hover"
                >
                  + Tạo bài mới
                </button>
              )}
            />
          ) : null
        }
      >
        {source.length === 0 ? (
          <p className="rounded-lg bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
            {origin === "teacher"
              ? `Kho chưa có ${isTest ? "bài kiểm tra" : "bài tập"} nào cho khoá ${cls.courseName ?? "của lớp"}.`
              : `Chưa có mẫu phù hợp cho khoá ${cls.courseName ?? "của lớp"}.`}
          </p>
        ) : (
          <>
            <Select
              value={templateId}
              onValueChange={(v) => {
                if (v !== null) setTemplateId(v);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="- Chọn đầu bài -">
                  {(v: string | null) => {
                    if (!v) return "- Chọn đầu bài -";
                    const t = source.find((x) => x.id === v);
                    return t ? t.title : "Đề vừa tạo";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {source.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      {t.questionCount > 0 && (
                        <ListChecks className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {t.title}
                      {t.questionCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          · {t.questionCount} câu
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected?.description && (
              <p className="mt-1.5 text-xs text-muted-foreground">{selected.description}</p>
            )}
          </>
        )}
      </Field>

      {isTest ? (
        <>
          {sessionField}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mở bài kiểm tra">
              <DateTimeInput value={openAt} min={MIN_DT} onChange={setOpenAt} />
            </Field>
            <Field label="Đóng bài kiểm tra">
              <DateTimeInput value={closeAt} min={openAt || MIN_DT} onChange={setCloseAt} />
            </Field>
          </div>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sessionField}
          <Field label="Hạn nộp">
            <DateTimeInput value={due} min={MIN_DT} onChange={setDue} />
          </Field>
        </div>
      )}

      {/* BGĐ 31/07 — file có sẵn trong đề tự đính kèm; ở đây thêm file riêng lần giao này. */}
      <Field label="Tệp đính kèm thêm (không bắt buộc)">
        <AttachmentUpload value={attachments} onChange={setAttachments} disabled={pending} />
      </Field>

      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Huỷ
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? (
            "Đang giao…"
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden /> Giao bài
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function DateTimeInput({
  value,
  min,
  onChange,
}: {
  value: string;
  min: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="datetime-local"
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Nhóm lựa chọn dạng radio - gọn, dễ đọc hơn nút gạt cho 2-3 phương án. */
function RadioRow({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 py-1.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 text-sm",
              active ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              checked={active}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 accent-primary"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
