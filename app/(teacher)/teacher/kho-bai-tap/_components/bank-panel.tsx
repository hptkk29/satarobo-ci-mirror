"use client";

// bank-panel.tsx — "Kho bài tập của tôi" (parity site GV 18/08, port từ
// satarobo-ui-giaovien assignment-bank.tsx). Dùng chung cho tab "Kho bài tập"
// ở trang Bài tập & kiểm tra và cho route /teacher/kho-bai-tap.
//
// Soạn một lần, giao lại nhiều lần: bảng đề GV tự soạn + Xem trước (đáp án đúng
// tô xanh) + Sửa (CreateAssignmentDialog chế độ edit) + Xoá (2-click confirm —
// convention repo, nguồn xoá 1 phát).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { QuestionView } from "@/components/assignments/question-view";
import { isAutoGraded } from "@/lib/assignments/question-content";
import { ListToolbar } from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import { CreateAssignmentDialog } from "./create-assignment-dialog";
import { deleteOwnTemplateAction } from "../_actions";
import type { KhoCourseOption, KhoTemplate } from "../_types";

const ALL = "all";

export function AssignmentBankPanel({
  rows,
  courses,
  canAuthor,
}: {
  rows: KhoTemplate[];
  courses: KhoCourseOption[];
  canAuthor: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(ALL);
  const [preview, setPreview] = useState<KhoTemplate | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function del(t: KhoTemplate) {
    start(async () => {
      const res = await deleteOwnTemplateAction(t.id);
      if (res.ok) {
        toast.success("Đã xoá khỏi kho", { description: t.title });
        setConfirmId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // Kho trống hoàn toàn: hiện lời mời soạn bài, chưa cần thanh công cụ.
  if (rows.length === 0) {
    return (
      <div className="t-card flex flex-col items-center justify-center px-6 py-14 text-center">
        <NotebookPen className="mb-3 h-9 w-9 text-muted-foreground/60" aria-hidden />
        <p className="text-base font-bold text-foreground">Kho bài tập còn trống</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Soạn một đầu bài trộn nhiều dạng câu hỏi. Sau đó mỗi lần giao bài, bạn chỉ cần
          chọn lại từ kho - không phải soạn lại.
        </p>
        {canAuthor && (
          <div className="mt-4">
            <CreateAssignmentDialog courses={courses} />
          </div>
        )}
      </div>
    );
  }

  const filtered = rows.filter((t) => {
    const q = query.trim().toLowerCase();
    const matchQ =
      !q ||
      t.title.toLowerCase().includes(q) ||
      (t.courseName ?? "").toLowerCase().includes(q);
    const matchKind = kind === ALL || t.kind === kind;
    return matchQ && matchKind;
  });

  return (
    <div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm đầu bài trong kho..."
        actions={canAuthor ? <CreateAssignmentDialog courses={courses} /> : undefined}
        filters={[
          {
            value: kind,
            onChange: setKind,
            options: [
              { value: ALL, label: "Mọi hình thức" },
              { value: "HOMEWORK", label: "Bài tập" },
              { value: "CLASSWORK", label: "Kiểm tra" },
            ],
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="Không tìm thấy đầu bài nào"
          description="Thử đổi từ khoá hoặc bộ lọc."
        />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang tenDonVi="đề"
          khoaGhiNho="gv-kho-bai-tap">
          <table className="min-w-[720px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-5 py-3">Tiêu đề</th>
                <th scope="col" className="px-5 py-3">Khoá</th>
                <th scope="col" className="px-5 py-3">Hình thức</th>
                <th scope="col" className="px-5 py-3">Dạng bài</th>
                <th scope="col" className="px-5 py-3">Ngày tạo</th>
                <th scope="col" className="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="max-w-xs px-5 py-3.5">
                    <p className="font-semibold text-foreground">{t.title}</p>
                    {t.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                    {t.courseName ?? "Mọi khoá"}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <KindBadge kind={t.kind} />
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <p className="font-medium text-foreground">
                      {t.questionCount} câu hỏi
                    </p>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                    {t.createdAt}
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    {confirmId === t.id ? (
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={pending}
                          onClick={() => del(t)}
                        >
                          {pending ? "Đang xoá…" : "Xác nhận xoá"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => setConfirmId(null)}
                        >
                          Huỷ
                        </Button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreview(t)}
                          aria-label={`Xem trước ${t.title}`}
                          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-state-info-soft hover:text-state-info-ink"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </button>
                        {canAuthor && (
                          <CreateAssignmentDialog
                            courses={courses}
                            template={t}
                            renderTrigger={(open) => (
                              <button
                                type="button"
                                onClick={open}
                                aria-label={`Sửa ${t.title}`}
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </button>
                            )}
                          />
                        )}
                        {canAuthor && (
                          <button
                            type="button"
                            onClick={() => setConfirmId(t.id)}
                            aria-label={`Xoá ${t.title}`}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-state-danger-soft hover:text-state-danger-ink"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </PhanTrangBang>
        </div>
      )}

      <BankPreviewDialog
        open={preview !== null}
        onOpenChange={(v) => !v && setPreview(null)}
        template={preview}
      />
    </div>
  );
}

/** Xem trước đầu bài đúng như học viên sẽ thấy (đáp án đúng được tô xanh). */
export function BankPreviewDialog({
  open,
  onOpenChange,
  template: t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: KhoTemplate | null;
}) {
  const autoCount = t ? t.questions.filter((q) => isAutoGraded(q.type)).length : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t?.title ?? "Xem trước"}</DialogTitle>
          <DialogDescription>
            {t
              ? `${t.courseName ?? "Mọi khoá"} · ${
                  t.kind === "CLASSWORK" ? "Bài kiểm tra" : "Bài tập"
                } · ${t.questions.length} câu · ${autoCount} chấm tự động`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {t?.description && (
            <p className="rounded-lg bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
              {t.description}
            </p>
          )}

          <ol className="space-y-4">
            {t?.questions.map((q, i) => (
              <QuestionView key={q.id} question={q} index={i} />
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Nhãn hình thức — token hệ thống (khớp AssignmentList: KT = primary, BT = info). */
export function KindBadge({ kind }: { kind: KhoTemplate["kind"] }) {
  const isTest = kind === "CLASSWORK";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        isTest
          ? "bg-primary-soft text-primary-ink"
          : "bg-state-info-soft text-state-info-ink",
      )}
    >
      {isTest ? "Kiểm tra" : "Bài tập"}
    </span>
  );
}
