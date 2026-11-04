"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { approveTransferAction, rejectTransferAction } from "../_actions";

export function RequestActions({
  id,
  hasTarget,
  canManage,
}: {
  id: string;
  hasTarget: boolean;
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirmReject, setConfirmReject] = useState(false);

  // P1-c: chỉ người có quyền DUYỆT (CENTER_MANAGER/SUPER_ADMIN) thấy nút. Người
  // tạo (sale) chỉ xem trạng thái chờ duyệt.
  if (!canManage) {
    return <span className="text-xs text-muted-foreground">Chờ quản lý duyệt</span>;
  }

  function approve() {
    start(async () => {
      const res = await approveTransferAction(id);
      if (res.ok) toast.success("Đã duyệt chuyển");
      else toast.error(res.error ?? "Lỗi");
    });
  }

  function reject() {
    if (!confirmReject) {
      setConfirmReject(true);
      return;
    }
    start(async () => {
      const res = await rejectTransferAction(id);
      if (res.ok) toast.success("Đã từ chối");
      else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <div className="flex gap-2">
      {hasTarget ? (
        <button
          onClick={approve}
          disabled={pending}
          className="rounded bg-state-success-ink px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Duyệt
        </button>
      ) : null}
      <button
        onClick={reject}
        disabled={pending}
        className="rounded bg-state-danger-ink px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {confirmReject ? "Xác nhận?" : "Từ chối"}
      </button>
    </div>
  );
}
