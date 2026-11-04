// app/(teacher)/teacher/anh-lop/_components/draft-store-panel.tsx — KHO ẢNH (DRAFT).
//
// 25/08 — GIỮ LẠI CÓ CHỦ ĐÍCH dù giáo viên không còn tạo ảnh DRAFT nữa (tải lên là vào
// thẳng hàng duyệt). Kho vẫn nhận hai nguồn: ảnh TỒN từ luồng cũ (dev/test/prod đều
// đang có) và ảnh do Marketing / Giáo vụ góp — họ chỉ có `media:upload-draft` nên
// KHÔNG đẩy thẳng vào hàng duyệt được (chốt 11/08). Đây là đường DUY NHẤT để những
// ảnh đó rời kho, xoá component này là chúng kẹt lại vĩnh viễn.
//
// Khu "Kho ảnh cũ — chưa gửi phụ huynh" trong album lớp: grid ảnh DRAFT multi-select
// (checkbox) + panel hành động: chip chọn học viên (disable HS chưa consent — cùng
// UX UploadPhotoDialog), checkbox "Ảnh chung cả lớp", nút "Gửi cho phụ huynh"
// (publishClassMediaAction — GV → PENDING chờ duyệt, QL → APPROVED luôn) + "Xoá
// khỏi kho" (deleteDraftMediaAction, 2-click confirm). Server Component cha fetch
// data; component này CHỈ tương tác. ⚠️ Câu 46: props chỉ TÊN học viên.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Loader2, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteDraftMediaAction,
  publishClassMediaAction,
} from "@/app/(admin)/admin/media/actions";

export type DraftItem = {
  id: string;
  url: string;
  /** Nhãn nhóm (buổi/ngày chụp) — chỉ hiển thị, không dùng để quyết định gì. */
  label: string;
  /** Ai đưa ảnh vào kho — kho có cả ảnh của Marketing/Giáo vụ (chốt 11/08). */
  uploader: string | null;
};

export function DraftStorePanel({
  drafts,
  students,
  nonConsentIds,
  sessions,
  defaultSessionId,
}: {
  drafts: DraftItem[];
  students: { id: string; name: string }[];
  nonConsentIds: string[];
  /** B3: buổi của lớp (mới → cũ) để gán buổi lúc gửi — server đã hỗ trợ classSessionId. */
  sessions: { id: string; label: string }[];
  /** Buổi gần nhất ĐÃ diễn ra (mặc định chọn sẵn); "" = không gắn buổi. */
  defaultSessionId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [tagged, setTagged] = useState<string[]>([]);
  const [wholeClass, setWholeClass] = useState(false);
  // B3: buổi gắn cho cả lô lúc gửi — trước đây panel KHÔNG truyền classSessionId nên ảnh
  // "không gắn buổi" vĩnh viễn nằm nhóm chưa phân loại, PH không xem được theo buổi.
  const [sessionId, setSessionId] = useState(defaultSessionId);
  // Xoá 2-click: click 1 = "chắc chưa?", click 2 = xoá thật (pattern confirm-delete).
  const [confirmDelete, setConfirmDelete] = useState(false);

  const noConsent = new Set(nonConsentIds);
  const allSelected = drafts.length > 0 && selected.length === drafts.length;

  function toggle(id: string) {
    setConfirmDelete(false);
    setSelected((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );
  }

  function publish() {
    if (selected.length === 0) {
      toast.error("Chọn ảnh trong kho trước");
      return;
    }
    if (!wholeClass && tagged.length === 0) {
      toast.error('Chọn học viên trong ảnh hoặc đánh dấu "Ảnh chung cả lớp"');
      return;
    }
    startTransition(async () => {
      // Chia lô 60 (PUBLISH_BATCH_MAX phía server) — "Chọn tất cả" trên kho >60
      // ảnh mà gửi nguyên mảng là fail cả lượt (review 02/08).
      let sentCount = 0;
      let lastStatus: string | undefined;
      for (let i = 0; i < selected.length; i += 60) {
        const res = await publishClassMediaAction({
          mediaIds: selected.slice(i, i + 60),
          isClassWide: wholeClass,
          studentIds: wholeClass ? [] : tagged,
          // B3: gán buổi cho cả lô lúc gửi (null = giữ nguyên/không gắn buổi).
          classSessionId: sessionId || null,
        });
        if (!res.ok) {
          toast.error(
            `${res.error ?? "Lỗi gửi ảnh"}${sentCount > 0 ? ` (đã gửi được ${sentCount} ảnh trước đó)` : ""}`,
          );
          router.refresh();
          return;
        }
        sentCount += res.count ?? 0;
        lastStatus = res.status;
      }
      toast.success(
        lastStatus === "APPROVED"
          ? `Đã gửi ${sentCount} ảnh — phụ huynh xem được ngay`
          : `Đã gửi ${sentCount} ảnh — chờ quản lý duyệt`,
      );
      setSelected([]);
      setTagged([]);
      setWholeClass(false);
      router.refresh();
    });
  }

  function removeDrafts() {
    if (selected.length === 0) {
      toast.error("Chọn ảnh trong kho trước");
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      setConfirmDelete(false);
      // Chia lô 60 như publish — cùng trần server.
      let deletedCount = 0;
      for (let i = 0; i < selected.length; i += 60) {
        const res = await deleteDraftMediaAction({
          mediaIds: selected.slice(i, i + 60),
        });
        if (!res.ok) {
          toast.error(
            `${res.error ?? "Lỗi xoá ảnh"}${deletedCount > 0 ? ` (đã xoá ${deletedCount} ảnh trước đó)` : ""}`,
          );
          router.refresh();
          return;
        }
        deletedCount += res.deleted ?? 0;
      }
      toast.success(`Đã xoá ${deletedCount} ảnh khỏi kho`);
      setSelected([]);
      router.refresh();
    });
  }

  if (drafts.length === 0) return null;

  return (
    <section className="t-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            Kho ảnh cũ — chưa gửi phụ huynh ({drafts.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Ảnh còn tồn trong kho: ảnh tải lên trước đây và ảnh do marketing /
            giáo vụ góp cho lớp. Chọn ảnh, gắn học viên (hoặc đánh dấu ảnh chung
            cả lớp) rồi bấm “Gửi cho phụ huynh”. Ảnh trong kho phụ huynh KHÔNG
            nhìn thấy. Ảnh bạn đăng mới không vào đây nữa — nó sang thẳng hàng
            chờ quản lý cơ sở duyệt.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirmDelete(false);
            setSelected(allSelected ? [] : drafts.map((d) => d.id));
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-ink hover:text-primary-ink-hover"
        >
          {allSelected ? (
            <CheckSquare className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Square className="h-3.5 w-3.5" aria-hidden />
          )}
          {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
        </button>
      </div>

      {/* Grid DRAFT multi-select — click cả thẻ để chọn (checkbox hiển thị góc) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {drafts.map((d) => {
          const on = selected.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              disabled={pending}
              aria-pressed={on}
              onClick={() => toggle(d.id)}
              className={cn(
                "relative overflow-hidden rounded-lg border-2 text-left transition-colors",
                on
                  ? "border-primary"
                  : "border-transparent hover:border-border",
              )}
            >
              <img
                src={d.url}
                alt="Ảnh trong kho"
                className="aspect-square w-full object-cover"
              />
              <span
                className={cn(
                  "absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded border bg-background/90",
                  on
                    ? "border-primary text-primary-ink"
                    : "border-border text-transparent",
                )}
                aria-hidden
              >
                ✓
              </span>
              <span className="block truncate bg-background/95 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {d.label}
              </span>
              {d.uploader && (
                <span className="block truncate bg-background/95 px-1.5 pb-0.5 text-[10px] text-muted-foreground">
                  {d.uploader}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panel hành động — chỉ có nghĩa khi đã chọn ảnh */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        {/* Cảnh báo consent hiện CẢ KHI "ảnh chung cả lớp" — nhánh đó KHÔNG gắn thẻ
            HS nên server không kiểm consent được (C6.3 chỉ soi studentIds). Kho lại
            có ảnh do marketing/giáo vụ góp (người không đứng lớp, không biết em nào
            chưa đồng ý) ⇒ người duy nhất kiểm được khung hình là GV, ngay tại đây. */}
        {noConsent.size > 0 && (
          <p className="rounded-md border border-state-warning-soft bg-state-warning-soft p-2 text-[11px] text-state-warning-ink dark:border-state-warning">
            <strong>Chưa đồng ý dùng hình ảnh:</strong>{" "}
            {students
              .filter((s) => noConsent.has(s.id))
              .map((s) => s.name)
              .join(", ")}
            . Kiểm khung hình trước khi gửi — kể cả khi chọn “Ảnh chung cả lớp”.
          </p>
        )}
        {/* B3: select buổi học — gắn buổi cho ảnh ngay lúc gửi (ghi đè nếu ảnh đã gắn
            buổi khác; chọn "Không gắn buổi" thì giữ nguyên hiện trạng từng ảnh). */}
        {sessions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="draft-session-select"
              className="text-xs font-medium text-foreground"
            >
              Buổi học
            </label>
            <select
              id="draft-session-select"
              value={sessionId}
              disabled={pending}
              onChange={(e) => setSessionId(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
            >
              <option value="">— Không gắn buổi —</option>
              {sessions.map((sn) => (
                <option key={sn.id} value={sn.id}>
                  {sn.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              Ảnh gửi đi sẽ gắn vào buổi này (phụ huynh xem album theo buổi).
            </span>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
          <input
            type="checkbox"
            checked={wholeClass}
            disabled={pending}
            onChange={(e) => {
              setWholeClass(e.target.checked);
              if (e.target.checked) setTagged([]);
            }}
            className="h-4 w-4 rounded border-input text-primary-ink focus:ring-primary"
          />
          Ảnh chung cả lớp (mọi phụ huynh trong lớp đều xem được)
        </label>

        {!wholeClass && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Học viên trong ảnh (chỉ phụ huynh được gắn thẻ mới thấy ảnh)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {students.map((s) => {
                const on = tagged.includes(s.id);
                const disabled = noConsent.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled || pending}
                    title={disabled ? "Chưa đồng ý dùng hình ảnh" : undefined}
                    onClick={() =>
                      setTagged((p) =>
                        on ? p.filter((x) => x !== s.id) : [...p, s.id],
                      )
                    }
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      disabled
                        ? "cursor-not-allowed bg-muted text-muted-foreground/50 line-through"
                        : on
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={publish}
            disabled={pending || selected.length === 0}
          >
            {pending ? (
              <Loader2
                className="mr-1.5 h-3.5 w-3.5 animate-spin"
                aria-hidden
              />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            Gửi cho phụ huynh
            {selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
          <Button
            size="sm"
            variant={confirmDelete ? "destructive" : "outline"}
            onClick={removeDrafts}
            disabled={pending || selected.length === 0}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {confirmDelete
              ? `Chắc chắn xoá ${selected.length} ảnh?`
              : "Xoá khỏi kho"}
          </Button>
          {confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Huỷ
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
