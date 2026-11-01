"use client";

// 21/08/2026 — Thao tác trên TỪNG học viên của roster lớp (/classes/<id>/students).
//
// Ba việc, ba nghĩa khác nhau — đừng gộp làm một:
//   • "Chuyển lớp"   → giữ nguyên ghi danh + tiền, chỉ dời sang lớp khác cùng khoá.
//   • "Xoá khỏi lớp" → kết thúc ghi danh Ở LỚP NÀY. Sau đó, tuỳ trạng thái hồ sơ:
//        còn đang học → em nằm ở tab "Chờ xếp lớp" chờ xếp lại;
//        đã Nghỉ học  → mời tiếp bước "Nghỉ hẳn".
//   • "Nghỉ hẳn"     → xoá học viên khỏi hệ thống (xoá MỀM). Hồ sơ lead của gia đình
//        và lịch sử cơ sở vẫn còn để cơ sở khác tra ra khách cũ.
//
// ⚠️ BƯỚC "NGHỈ HẲN" KHÔNG NẰM TRONG FILE NÀY — nó ở `LeaveSystemDialog`, do component
// CHA giữ. Lý do (smoke test 21/08 bắt được): gỡ xong thì dòng học viên biến mất khỏi
// roster ⇒ component của dòng bị unmount, kéo theo mọi hộp thoại nằm bên trong nó; và
// `useTransition` của lượt gỡ còn đang pending nên nút xác nhận kẹt ở "Đang xử lý…".
// Việc tiếp theo phải sống ở nơi không phụ thuộc dòng đó còn tồn tại hay không.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, UserMinus } from "lucide-react";
import { removeFromClassAction, transferFromClassAction } from "../_actions";
import { canLeaveSystemAfterRemoval } from "@/lib/lms/remove-from-class";

export type TargetClassOption = {
  id: string;
  name: string;
  classCode: string | null;
  status: string;
  maxStudents: number;
  enrolledCount: number;
  centerName: string | null;
};

/** Học viên đã sạch lớp + đang Nghỉ học ⇒ cha mở tiếp hộp thoại "Nghỉ hẳn". */
export type LeaveCandidate = { studentId: string; studentName: string };

const CLASS_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Đang lên KH",
  RECRUITING: "Tuyển sinh",
  PENDING_APPROVAL: "Chờ duyệt",
  ACTIVE: "Đang dạy",
};

const MIN_REASON = 5;

type Dialog = "transfer" | "remove" | null;

export function StudentRowActions({
  classId,
  enrollmentId,
  studentId,
  studentName,
  studentStatus,
  canTransfer,
  canRemove,
  canDeleteStudent,
  targetClasses,
  onOfferLeave,
}: {
  classId: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  studentStatus: string;
  canTransfer: boolean;
  canRemove: boolean;
  canDeleteStudent: boolean;
  targetClasses: TargetClassOption[];
  onOfferLeave: (candidate: LeaveCandidate) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setDialog(null);
    setReason("");
    setTargetId("");
    setError(null);
  }

  function submitTransfer() {
    setError(null);
    if (!targetId) return setError("Chọn lớp đích");
    if (reason.trim().length < MIN_REASON) {
      return setError(`Lý do phải có ít nhất ${MIN_REASON} ký tự`);
    }
    startTransition(async () => {
      const res = await transferFromClassAction(classId, enrollmentId, targetId, reason);
      if (!res.ok) return setError(res.error ?? "Không chuyển được lớp");
      toast.success(`Đã chuyển ${studentName} sang lớp mới`);
      setDialog(null);
      setReason("");
      setTargetId("");
      router.refresh();
    });
  }

  function submitRemove() {
    setError(null);
    if (reason.trim().length < MIN_REASON) {
      return setError(`Lý do phải có ít nhất ${MIN_REASON} ký tự`);
    }
    startTransition(async () => {
      const res = await removeFromClassAction(classId, enrollmentId, reason);
      if (!res.ok) return setError(res.error ?? "Không gỡ được học viên");
      toast.success(res.message ?? `Đã gỡ ${studentName} khỏi lớp`);
      setDialog(null);
      setReason("");
      // Server đã XÁC NHẬN em sạch lớp và đang ở trạng thái Nghỉ học → giao việc tiếp
      // cho cha (hộp thoại của cha sống độc lập với dòng sắp biến mất này).
      if (canDeleteStudent && res.outcome && canLeaveSystemAfterRemoval(res.outcome)) {
        onOfferLeave({ studentId, studentName });
      }
      router.refresh();
    });
  }

  if (!canTransfer && !canRemove) return null;

  return (
    <>
      <span className="flex items-center gap-1">
        {canTransfer && (
          <button
            type="button"
            onClick={() => setDialog("transfer")}
            disabled={pending}
            title="Chuyển sang lớp khác (giữ nguyên ghi danh và học phí)"
            // Dưới md nhãn bị ẩn (chỉ còn icon) → phải có tên cho trình đọc màn hình.
            aria-label={`Chuyển lớp cho ${studentName}`}
            className="inline-flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Chuyển lớp</span>
          </button>
        )}
        {canRemove && (
          <button
            type="button"
            onClick={() => setDialog("remove")}
            disabled={pending}
            title="Gỡ khỏi lớp này"
            aria-label={`Xoá ${studentName} khỏi lớp`}
            className="inline-flex items-center gap-1 rounded-md border border-state-danger px-2 py-1 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
          >
            <UserMinus className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Xoá khỏi lớp</span>
          </button>
        )}
      </span>

      {dialog !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
            {dialog === "transfer" ? (
              <>
                <h3 className="mb-1 text-lg font-bold text-foreground">
                  Chuyển lớp — {studentName}
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Ghi danh hiện tại được đánh dấu <b>Đã chuyển</b> và sinh ghi danh mới ở
                  lớp đích (trạng thái <b>Đã xếp</b>). Học phí, công nợ và lịch sử đi theo
                  — không phải nhập lại. Danh sách chỉ gồm lớp <b>cùng khoá, cùng cơ sở</b>;
                  chuyển sang cơ sở khác dùng màn <b>Chuyển lớp / cơ sở</b>.
                </p>
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm font-semibold text-foreground">
                    Lớp đích
                  </span>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— Chọn lớp —</option>
                    {targetClasses.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        disabled={c.enrolledCount >= c.maxStudents}
                      >
                        {c.classCode ? `${c.classCode} — ` : ""}
                        {c.name} ({c.enrolledCount}/{c.maxStudents}) ·{" "}
                        {CLASS_STATUS_LABEL[c.status] ?? c.status}
                        {c.enrolledCount >= c.maxStudents ? " — đã đầy" : ""}
                      </option>
                    ))}
                  </select>
                  {targetClasses.length === 0 && (
                    <span className="mt-1 block text-xs text-state-warning-ink">
                      Cơ sở này chưa có lớp nào khác cùng khoá để chuyển sang.
                    </span>
                  )}
                </label>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-lg font-bold text-foreground">
                  Xoá khỏi lớp — {studentName}
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Ghi danh ở lớp này kết thúc; em <b>không bị xoá khỏi hệ thống</b> và
                  công nợ giữ nguyên. Nếu em không còn lớp nào khác:
                  {studentStatus === "INACTIVE" ? (
                    <>
                      {" "}
                      hồ sơ đang ở trạng thái <b>Nghỉ học</b> nên sẽ hỏi tiếp có{" "}
                      <b>cho nghỉ hẳn</b> (xoá khỏi hệ thống) hay không.
                    </>
                  ) : (
                    <>
                      {" "}
                      em về tab <b>Chờ xếp lớp</b> ở màn Học viên, chờ xếp lớp lại.
                    </>
                  )}{" "}
                  Muốn giữ nguyên ghi danh và học phí thì dùng <b>Chuyển lớp</b>.
                </p>
              </>
            )}

            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-semibold text-foreground">
                Lý do <span className="text-state-danger-ink">*</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Ghi vào lịch sử ghi danh — tối thiểu 5 ký tự"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            {error && (
              <p className="mb-3 rounded-lg bg-state-danger-soft px-3 py-2 text-sm font-medium text-state-danger-ink">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={dialog === "transfer" ? submitTransfer : submitRemove}
                disabled={pending}
                className={
                  "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 " +
                  (dialog === "transfer"
                    ? "bg-primary hover:opacity-90"
                    : "bg-state-danger-ink hover:bg-state-danger-ink-hover")
                }
              >
                {pending
                  ? "Đang xử lý…"
                  : dialog === "transfer"
                    ? "Xác nhận chuyển lớp"
                    : "Xác nhận gỡ khỏi lớp"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
