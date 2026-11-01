"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, KeyRound, Loader2, Shield, Trash2, Building2 } from "lucide-react";
import { toggleUserActiveAction, deleteUserAction } from "../_actions";

export function UserStatusToggle({
  userId,
  isActive,
  disabled,
  disabledReason,
}: {
  userId: string;
  isActive: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={disabled || pending}
      title={disabled ? disabledReason : undefined}
      onClick={() => {
        startTransition(async () => {
          const res = await toggleUserActiveAction(userId);
          if (res.ok) {
            toast.success(
              isActive ? "Đã disable tài khoản" : "Đã kích hoạt tài khoản",
            );
          } else {
            toast.error(res.error ?? "Lỗi thao tác");
          }
        });
      }}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ isActive ? "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft" : "bg-muted text-muted-foreground hover:bg-gray-300" }`}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${ isActive ? "bg-state-success-ink" : "bg-gray-500" }`}
        />
      )}
      {isActive ? "Hoạt động" : "Đã disable"}
    </button>
  );
}

// 2-click confirm: lần 1 hiện "Chắc chắn?", lần 2 mới xóa.
// Chỉ render cho tài khoản đã vô hiệu hóa (isActive=false) và không phải chính mình.
function UserDeleteButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <button
        type="button"
        disabled={pending}
        title="Bấm lần nữa để xóa vĩnh viễn"
        onClick={() => {
          startTransition(async () => {
            const res = await deleteUserAction(userId);
            if (res.ok) {
              toast.success("Đã xóa tài khoản");
            } else {
              toast.error(res.error ?? "Lỗi xóa tài khoản");
              setConfirming(false);
            }
          });
        }}
        className="inline-flex h-8 items-center gap-1 rounded-md bg-state-danger-ink px-2 text-xs font-semibold text-white hover:bg-state-danger-ink-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        Chắc chắn?
      </button>
    );
  }

  return (
    <button
      type="button"
      title="Xóa tài khoản (dọn dữ liệu test)"
      onClick={() => setConfirming(true)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-state-danger-soft hover:text-state-danger-ink"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

export function UserRowActions({
  userId,
  isActive,
  isSelf,
  canOrgRoles = false,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
  /** Người xem có roles:assign → hiện lối vào org-roles (nguồn quyền chính khi RBAC v2 ON). */
  canOrgRoles?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/users/${userId}/edit`}
        title="Sửa"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Pencil className="h-4 w-4" />
      </Link>
      {canOrgRoles && (
        <Link
          href={`/users/${userId}/org-roles`}
          title="Vai trò theo đơn vị (RBAC v2)"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-state-success-soft hover:text-state-success-ink"
        >
          <Building2 className="h-4 w-4" />
        </Link>
      )}
      <Link
        href={`/users/${userId}/permissions`}
        title="Phân quyền nâng cao"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary-soft hover:text-primary"
      >
        <Shield className="h-4 w-4" />
      </Link>
      <Link
        href={`/users/${userId}/reset-password`}
        title="Đổi mật khẩu"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary-soft hover:text-primary"
      >
        <KeyRound className="h-4 w-4" />
      </Link>
      {!isActive && !isSelf && <UserDeleteButton userId={userId} />}
    </div>
  );
}
