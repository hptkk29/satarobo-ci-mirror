"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, X } from "lucide-react";
import { changeEmployeeRoleAction } from "@/app/(admin)/admin/nhan-su/actions";
import { ROLE_LABELS, getRoleOptions } from "@/lib/labels";

// Role gán cho nhân viên (loại PARENT) — nhãn lấy từ single source lib/labels.
type Role =
  | "SUPER_ADMIN"
  | "CENTER_MANAGER"
  | "HR"
  | "SALES_CSM"
  | "TEACHER"
  | "MARKETING"
  | "ACCOUNTANT";

const ROLE_OPTIONS = getRoleOptions([
  "SUPER_ADMIN",
  "CENTER_MANAGER",
  "HR",
  "SALES_CSM",
  "TEACHER",
  "MARKETING",
  "ACCOUNTANT",
]) as Array<{ value: Role; label: string }>;

const ROLE_LABEL = ROLE_LABELS;

interface Props {
  employeeId: string;
  employeeName: string;
  currentRole: Role;
  currentRoles?: Role[]; // Đợt 3B — tất cả vai trò hiện giữ
}

export function ChangeRoleDialog({ employeeId, employeeName, currentRole, currentRoles }: Props) {
  const router = useRouter();
  const initialRoles = currentRoles && currentRoles.length > 0 ? currentRoles : [currentRole];
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Role[]>(initialRoles);
  const [primary, setPrimary] = useState<Role>(currentRole);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    if (pending) return;
    setIsOpen(false);
    setError(null);
    setReason("");
    setSelected(initialRoles);
    setPrimary(currentRole);
  };

  const toggle = (r: Role) => {
    setSelected((cur) => {
      const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
      // Nếu bỏ vai trò chính, chọn lại primary = phần tử đầu còn lại.
      if (!next.includes(primary) && next.length > 0) setPrimary(next[0]);
      return next;
    });
  };

  const handleSubmit = () => {
    setError(null);
    if (selected.length === 0) {
      setError("Chọn ít nhất 1 vai trò");
      return;
    }
    if (!selected.includes(primary)) {
      setError("Vai trò chính phải nằm trong các vai trò đã chọn");
      return;
    }
    if (reason.trim().length < 5) {
      setError("Lý do phải có ít nhất 5 ký tự");
      return;
    }

    startTransition(async () => {
      const res = await changeEmployeeRoleAction({
        employeeId,
        roles: selected,
        primaryRole: primary,
        reason: reason.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setIsOpen(false);
      setReason("");
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border-2 border-state-warning bg-card px-4 py-2 text-sm font-bold text-state-warning-ink hover:bg-state-warning-soft"
      >
        <ShieldAlert className="h-4 w-4" />
        Đổi vai trò
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-role-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="relative w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={close}
              aria-label="Đóng"
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>

            <h2
              id="change-role-title"
              className="flex items-center gap-2 text-lg font-bold text-foreground"
            >
              <ShieldAlert className="h-5 w-5 text-state-warning-ink" />
              Thay đổi vai trò
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nhân viên: <strong>{employeeName}</strong>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Hành động ghi vào audit log, không xoá được.
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-state-danger bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
                {error}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-semibold">
                  Vai trò (chọn nhiều) *
                </label>
                <div className="space-y-1.5">
                  {ROLE_OPTIONS.map((opt) => {
                    const on = selected.includes(opt.value);
                    return (
                      <div key={opt.value} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(opt.value)}
                            disabled={pending}
                            className="h-4 w-4 rounded border-border"
                          />
                          {opt.label}
                        </label>
                        <button
                          type="button"
                          onClick={() => on && setPrimary(opt.value)}
                          disabled={!on || pending}
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ primary === opt.value ? "bg-state-warning text-white" : on ? "bg-muted text-muted-foreground hover:bg-state-warning-soft" : "bg-muted text-muted-foreground" }`}
                        >
                          {primary === opt.value ? "Vai trò chính" : "Đặt chính"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quyền = hợp của tất cả vai trò. Vai trò chính dùng cho dashboard mặc định.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">
                  Lý do thay đổi *{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (tối thiểu 5 ký tự)
                  </span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="VD: Thăng chức lên Quản lý sau 1 năm hiệu suất tốt..."
                  rows={3}
                  disabled={pending}
                  required
                  className="w-full resize-y rounded-lg border border-border px-3 py-2 text-sm focus:border-state-warning focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
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
                onClick={handleSubmit}
                disabled={pending || selected.length === 0}
                className="rounded-lg bg-state-warning px-4 py-2 text-sm font-bold text-white hover:bg-state-warning-ink disabled:opacity-50"
              >
                {pending ? "Đang lưu..." : "Xác nhận thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { ROLE_LABEL };
export type { Role };
