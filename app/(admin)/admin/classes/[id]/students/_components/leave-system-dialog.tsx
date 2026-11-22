"use client";

// 21/08/2026 — Bước 2 của "Xoá khỏi lớp": học viên đã sạch lớp VÀ đang ở trạng thái
// Nghỉ học ⇒ hỏi có cho nghỉ hẳn (xoá khỏi hệ thống) không.
//
// ⚠️ Ở CẤP DANH SÁCH, KHÔNG ở trong dòng học viên. Gỡ xong thì dòng đó biến mất khỏi
// roster; hộp thoại nằm trong dòng sẽ bị unmount cùng, và `useTransition` của lượt gỡ
// còn pending nên nút xác nhận kẹt ở "Đang xử lý…" (smoke test 21/08 bắt được cả hai).
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { withdrawFromSystemAction } from "../_actions";
import type { LeaveCandidate } from "./student-row-actions";

export function LeaveSystemDialog({
  classId,
  candidate,
  onClose,
}: {
  classId: string;
  candidate: LeaveCandidate;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await withdrawFromSystemAction(classId, candidate.studentId);
      if (!res.ok) {
        toast.error(res.error ?? "Không xoá được học viên");
        return;
      }
      toast.success(
        `Đã cho ${candidate.studentName} nghỉ hẳn — hồ sơ lead vẫn được giữ lại`,
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
        <h3 className="mb-1 text-lg font-bold text-state-danger-ink">
          Nghỉ hẳn — {candidate.studentName}
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Em đã được gỡ khỏi lớp và <b>không còn lớp nào</b>. Cho nghỉ hẳn = xoá học viên
          khỏi hệ thống (xoá mềm): hồ sơ biến mất khỏi mọi danh sách vận hành.{" "}
          <b>Vẫn giữ lại</b> hồ sơ lead của gia đình và lịch sử &ldquo;đã từng học tại cơ
          sở này&rdquo; — sau này gia đình đăng ký ở cơ sở khác thì sale bên đó vẫn tra ra
          được. Thao tác này <b>không tự hoàn tiền</b>; khoản đã thu xử lý ở màn Hoàn tiền.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Để sau
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded-lg bg-state-danger-ink px-4 py-2 text-sm font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-50"
          >
            {pending ? "Đang xử lý…" : "Xác nhận nghỉ hẳn"}
          </button>
        </div>
      </div>
    </div>
  );
}
