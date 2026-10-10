"use client";

// assignments-tabs.tsx — 3 tab trang "Bài tập & kiểm tra" (parity site GV 18/08,
// port từ satarobo-ui-giaovien assignments/page.tsx):
//   · Bài đã giao        — bảng bài ở các lớp phụ trách + nút "Giao bài" (popup).
//   · Kho bài tập của tôi — AssignmentBankPanel (soạn/sửa/xoá/preview 8 loại câu hỏi).
//   · Thư viện admin      — mẫu trung tâm cài sẵn, đọc-only, xem nhanh + giao qua
//                           nút "Giao bài" (nguồn "Thư viện admin").
import { useState } from "react";
import { Eye, FileQuestion, FolderOpen, Library, NotebookPen } from "lucide-react";
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
import { EmptyState } from "../../_components/ui/empty-state";
import { ListToolbar } from "../../_components/ui/list-toolbar";
import {
  AssignmentBankPanel,
  KindBadge,
} from "../../kho-bai-tap/_components/bank-panel";
import type { KhoTemplate } from "../../kho-bai-tap/_types";
import { AssignmentList, type AssignmentRow } from "./assignment-list";
import { AssignDialog } from "./assign-dialog";
import type { TeacherAssignData } from "../_data";

type TabKey = "assigned" | "bank" | "library";

const TABS: { key: TabKey; label: string; icon: typeof NotebookPen }[] = [
  { key: "assigned", label: "Bài đã giao", icon: NotebookPen },
  { key: "bank", label: "Kho bài tập của tôi", icon: FolderOpen },
  { key: "library", label: "Thư viện admin", icon: Library },
];

export function AssignmentsTabs({
  rows,
  data,
  canAuthor,
  canAssign,
}: {
  rows: AssignmentRow[];
  data: TeacherAssignData;
  canAuthor: boolean;
  canAssign: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("assigned");

  return (
    <div>
      <div
        role="tablist"
        className="mb-5 flex w-full justify-start gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary text-primary-ink"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "assigned" && (
        <AssignmentList
          rows={rows}
          actions={
            canAssign ? (
              <AssignDialog
                classes={data.classes}
                sessions={data.sessions}
                courses={data.courses}
                mine={data.mine}
                library={data.library}
                canAuthor={canAuthor}
              />
            ) : undefined
          }
        />
      )}
      {tab === "bank" && (
        <AssignmentBankPanel rows={data.mine} courses={data.courses} canAuthor={canAuthor} />
      )}
      {tab === "library" && <AdminLibraryTab templates={data.library} />}
    </div>
  );
}

/* --------------------------- Tab: Thư viện admin ------------------------- */

/**
 * Bài tập & kiểm tra do trung tâm (admin/Đào tạo) cài sẵn cho các khoá giáo viên
 * phụ trách. Chỉ đọc - giáo viên không sửa, chọn để giao qua nút "Giao bài".
 */
function AdminLibraryTab({ templates }: { templates: KhoTemplate[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [preview, setPreview] = useState<KhoTemplate | null>(null);

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={Library}
        title="Chưa có mẫu admin nào"
        description="Trung tâm chưa cài sẵn bài tập / kiểm tra cho khoá bạn phụ trách."
      />
    );
  }

  const filtered = templates.filter((t) => {
    const q = query.trim().toLowerCase();
    const matchQ =
      !q ||
      t.title.toLowerCase().includes(q) ||
      (t.courseName ?? "").toLowerCase().includes(q);
    const matchKind = kind === "all" || t.kind === kind;
    return matchQ && matchKind;
  });

  return (
    <div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm mẫu admin theo tên, khoá..."
        filters={[
          {
            value: kind,
            onChange: setKind,
            options: [
              { value: "all", label: "Mọi hình thức" },
              { value: "HOMEWORK", label: "Bài tập" },
              { value: "CLASSWORK", label: "Kiểm tra" },
            ],
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Không tìm thấy mẫu nào"
          description="Thử đổi từ khoá hoặc bộ lọc."
        />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang tenDonVi="mẫu"
          khoaGhiNho="gv-cham-bai-thu-vien">
          <table className="min-w-[820px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-5 py-3">Tiêu đề</th>
                <th scope="col" className="px-5 py-3">Khoá</th>
                <th scope="col" className="px-5 py-3">Hình thức</th>
                <th scope="col" className="px-5 py-3">Dạng bài</th>
                <th scope="col" className="px-5 py-3">Mô tả</th>
                <th scope="col" className="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-5 py-3.5 font-semibold text-foreground">{t.title}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                    {t.courseName ?? "Mọi khoá"}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <KindBadge kind={t.kind} />
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                    {t.questionCount > 0 ? `${t.questionCount} câu hỏi` : "Chưa số hoá"}
                  </td>
                  <td className="max-w-md px-5 py-3.5 text-muted-foreground">
                    <span className="line-clamp-2">{t.description}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setPreview(t)}
                      aria-label={`Xem ${t.title}`}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-state-info-soft hover:text-state-info-ink"
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </PhanTrangBang>
        </div>
      )}

      <LibraryPreviewDialog
        open={preview !== null}
        onOpenChange={(v) => !v && setPreview(null)}
        template={preview}
      />
    </div>
  );
}

/** Xem nhanh một mẫu admin — có câu hỏi thì hiện đề, chưa số hoá thì ghi chú. */
function LibraryPreviewDialog({
  open,
  onOpenChange,
  template: t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: KhoTemplate | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t?.title ?? "Xem mẫu"}</DialogTitle>
          <DialogDescription>
            {t
              ? `${t.courseName ?? "Mọi khoá"} · ${
                  t.kind === "CLASSWORK" ? "Bài kiểm tra" : "Bài tập"
                } · Thư viện admin`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {t?.description && (
            <p className="rounded-lg bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
              {t.description}
            </p>
          )}

          {t && t.questions.length > 0 ? (
            <ol className="space-y-4">
              {t.questions.map((q, i) => (
                <QuestionView key={q.id} question={q} index={i} />
              ))}
            </ol>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-border px-4 py-4">
              <FileQuestion
                className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/70"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                Mẫu do trung tâm biên soạn, nội dung câu hỏi chưa số hoá trên hệ thống.
                Bạn vẫn có thể giao mẫu này cho lớp qua nút{" "}
                <span className="font-semibold">Giao bài</span>.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
