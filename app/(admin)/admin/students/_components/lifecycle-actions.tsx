"use client";

import { useState } from "react";
import type { StudentStatus } from "@prisma/client";
import { CirclePause, CirclePlay, RotateCcw, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReserveModal } from "./reserve-modal";
import { ResumeReserveModal } from "./resume-reserve-modal";
import { WithdrawModal } from "./withdraw-modal";
import { ReactivateModal } from "./reactivate-modal";
import { STUDYING_ENROLLMENT_STATUSES } from "@/lib/enrollment-status";
import { NUT_VIEN } from "./ho-so/o-nhap";

type ActiveReserve = {
  id: string;
  startedAt: Date;
  reason: string;
  expectedEndAt: Date | null;
};

type EnrollmentSummary = {
  id: string;
  status: string;
  class: { name: string };
};

type ModalKind = "reserve" | "resume" | "withdraw" | "reactivate" | null;

/**
 * Nút vòng đời học viên (Bảo lưu · Kết thúc bảo lưu · Nghỉ học hẳn · Kích hoạt lại).
 *
 * 25/09/2026 — chỉ ĐỔI VỎ: nằm trong dải đầu hồ sơ (bên phải tên) thay vì một thẻ riêng
 * dưới form; nhãn trạng thái đã đứng cạnh tên, cảnh báo "đang bảo lưu" thành một dải riêng
 * dưới dải đầu (trang dựng). Emoji thay bằng icon. GIỮ NGUYÊN: điều kiện hiện từng nút,
 * bốn hộp thoại, và server action của chúng.
 */
export function LifecycleActions({
  studentId,
  studentName,
  studentStatus,
  activeReserve,
  enrollments,
}: {
  studentId: string;
  studentName: string;
  studentStatus: StudentStatus;
  activeReserve: ActiveReserve | null;
  enrollments: EnrollmentSummary[];
}) {
  const [open, setOpen] = useState<ModalKind>(null);

  // 21/08 — trước đây chỉ nhận "STUDYING", nên với ghi danh mang status mặc định
  // `ACTIVE` (đa số học viên convert từ lead) nút "Bảo lưu" KHÔNG BAO GIỜ hiện.
  const studyingEnrollments = enrollments.filter((e) =>
    (STUDYING_ENROLLMENT_STATUSES as readonly string[]).includes(e.status),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {studentStatus === "ACTIVE" &&
        studyingEnrollments.length > 0 &&
        !activeReserve && (
          <button type="button" className={NUT_VIEN} onClick={() => setOpen("reserve")}>
            <CirclePause className="size-4 text-state-warning-ink" aria-hidden />
            Bảo lưu
          </button>
        )}
      {activeReserve && (
        <button type="button" className={NUT_VIEN} onClick={() => setOpen("resume")}>
          <CirclePlay className="size-4 text-state-success-ink" aria-hidden />
          Kết thúc bảo lưu
        </button>
      )}
      {studentStatus !== "INACTIVE" && (
        <button
          type="button"
          className={cn(
            NUT_VIEN,
            "text-state-danger-ink hover:border-state-danger-soft hover:bg-state-danger-soft",
          )}
          onClick={() => setOpen("withdraw")}
        >
          <UserX className="size-4" aria-hidden />
          Nghỉ học hẳn
        </button>
      )}
      {studentStatus === "INACTIVE" && (
        <button
          type="button"
          className={cn(
            NUT_VIEN,
            "text-state-success-ink hover:border-state-success-soft hover:bg-state-success-soft",
          )}
          onClick={() => setOpen("reactivate")}
        >
          <RotateCcw className="size-4" aria-hidden />
          Kích hoạt lại
        </button>
      )}

      {open === "reserve" && (
        <ReserveModal
          studentId={studentId}
          studentName={studentName}
          enrollments={studyingEnrollments}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "resume" && activeReserve && (
        <ResumeReserveModal
          reserveId={activeReserve.id}
          studentName={studentName}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "withdraw" && (
        <WithdrawModal
          studentId={studentId}
          studentName={studentName}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "reactivate" && (
        <ReactivateModal
          studentId={studentId}
          studentName={studentName}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
