"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GraduationCap, Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { describeSkipped, type SkippedGroup } from "@/lib/classes/complete-class";
import { completeClassAction } from "../../_actions";

/**
 * 22/09/2026 — nút HOÀN THÀNH LỚP đúng nghĩa. Anh em sinh đôi của <ClassCancel>,
 * và ra đời vì đúng cái lỗi mà <ClassCancel> đã vá cho nhánh "Huỷ" hồi 21/07:
 * dropdown trạng thái chỉ set cờ `Class.status`, nên lớp đã xong mà học viên vẫn
 * "Đang học". Dropdown giờ không còn mục "Hoàn thành" — đi qua nút này.
 *
 * Hộp xác nhận nói TRƯỚC con số sẽ đổi (luật 12 — affordance phải nói thật): bao
 * nhiêu em chuyển sang Hoàn thành, bao nhiêu em bị bỏ qua và VÌ SAO. Số này do
 * `splitEnrollmentsForCompletion` tính ở trang, cùng hàm mà Server Action dùng, nên
 * không có đường nào để màn hình hứa một đằng còn DB làm một nẻo.
 */
export function ClassComplete({
  classId,
  className,
  status,
  completableCount,
  skipped,
  canEdit,
}: {
  classId: string;
  className: string;
  status: string;
  completableCount: number;
  skipped: SkippedGroup[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Lớp đã đóng (xong / huỷ) hoặc đang chờ duyệt thì không có việc gì ở đây —
  // cùng bộ điều kiện mà `completeClassAction` chặn ở server, để nút không bao giờ
  // hứa một thao tác chắc chắn bị từ chối.
  if (!canEdit || status === "COMPLETED" || status === "CANCELLED" || status === "PENDING_APPROVAL") {
    return null;
  }

  const skippedText = describeSkipped(skipped);

  function submit() {
    startTransition(async () => {
      const res = await completeClassAction(classId);
      if (!res.ok) {
        toast.error(res.error, { duration: 12000 });
        return;
      }
      const parts = [`${res.completed} học viên chuyển sang "Hoàn thành"`];
      if (res.certIssued > 0) parts.push(`cấp ${res.certIssued} chứng chỉ`);
      if (res.certAlready > 0) parts.push(`${res.certAlready} em đã có chứng chỉ từ trước`);
      toast.success(`Đã hoàn thành lớp "${className}" — ${parts.join(", ")}.`);
      if (res.skipped.length > 0) {
        toast.warning(`Bỏ qua ${describeSkipped(res.skipped)} — xử lý riêng ở trang học viên.`, {
          duration: 12000,
        });
      }
      setOpen(false);
      // ⚠️ RELOAD THẬT, không phải `router.refresh()` — đo được trên smoke 22/09.
      // `router.refresh()` dựng lại phần RSC (badge lớp đổi sang "Hoàn thành", sĩ số
      // tụt) nhưng <ClassForm> là client component đã mount, và ô <select> trạng thái
      // chạy bằng `defaultValue` — React CHỈ đọc defaultValue lúc mount. Ô đó nằm im
      // ở "Đang dạy" trong khi lớp đã Hoàn thành; ai bấm "Cập nhật" ngay sau đó là
      // GỬI status=ACTIVE, mở lại lớp vừa đóng mà học viên vẫn Hoàn thành.
      // Chờ một nhịp cho toast kịp hiện rồi mới nạp lại (mẫu ở orders/_components).
      setTimeout(() => window.location.reload(), 1200);
    });
  }

  return (
    <section className="rounded-xl border border-state-success-soft bg-state-success-soft/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-state-success-ink">
            <GraduationCap className="h-4 w-4" /> Hoàn thành lớp
          </h2>
          <p className="mt-0.5 text-xs text-state-success-ink/80">
            Đóng lớp khi đã dạy xong: chuyển ghi danh đang học sang{" "}
            <strong>Hoàn thành</strong>, cấp chứng chỉ và gửi email báo phụ huynh.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-state-success-ink bg-card px-4 py-2 text-sm font-semibold text-state-success-ink hover:bg-state-success-soft"
        >
          Hoàn thành lớp…
        </button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!pending) setOpen(o);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 shrink-0 text-state-success-ink" />
              {`Hoàn thành lớp "${className}"?`}
            </DialogTitle>
            <DialogDescription>
              {completableCount > 0 ? (
                <>
                  <strong>{completableCount} học viên đang học</strong> sẽ chuyển sang{" "}
                  <strong>Hoàn thành</strong>, được cấp chứng chỉ, và phụ huynh nhận email
                  chúc mừng kèm mã chứng chỉ. Hệ thống cũng tạo việc tư vấn tái đăng ký cho
                  Sale. Em đã có chứng chỉ khoá này thì bỏ qua, không gửi lại email.
                </>
              ) : (
                <>
                  Lớp không còn học viên nào đang học — chỉ đóng lớp, không cấp chứng chỉ
                  và không gửi email nào.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {skippedText && (
            <p className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Bỏ qua <strong>{skippedText}</strong>. Các em này giữ nguyên trạng thái —
                xử lý riêng ở trang học viên (kết thúc bảo lưu / cho vào học) rồi hoàn
                thành khoá cho từng em ở <em>Hoàn thành khoá &amp; chứng chỉ</em>.
              </span>
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Xếp loại và đánh giá cuối khoá của từng em vẫn nhập riêng ở{" "}
            <em>Hoàn thành khoá &amp; chứng chỉ</em>. Hành động này không thể hoàn tác.
          </p>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-state-success-ink px-4 py-2 text-sm font-semibold text-white hover:bg-state-success-ink-hover disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận hoàn thành lớp
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
