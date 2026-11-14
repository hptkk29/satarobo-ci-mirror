"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Shield,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  UserPlus,
} from "lucide-react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/app/(admin)/admin/users/_components/role-badge";

interface ExistingUser {
  id: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  _count: { permissionGrants: number };
}

interface Props {
  employeeId: string;
  employeeName: string;
  existingUser: ExistingUser | null;
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function formatDateTime(date: Date | null): string {
  if (!date) return "Chưa từng đăng nhập";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function UserAccountSection({
  employeeId,
  employeeName,
  existingUser,
}: Props) {
  const router = useRouter();

  if (!existingUser) {
    return (
      <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">
              Tài khoản đăng nhập
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nhân sự này chưa có tài khoản để đăng nhập vào hệ thống.
            </p>
            <div className="mt-4">
              <Button
                type="button"
                onClick={() =>
                  router.push(`/users/new?employeeId=${employeeId}`)
                }
              >
                <UserPlus className="h-4 w-4" />
                Tạo tài khoản đăng nhập
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Tên và email của <strong>{employeeName}</strong> sẽ được điền
                sẵn vào form.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const idleDays = daysSince(existingUser.lastLoginAt);
  const isIdle = idleDays === null || idleDays > 30;
  const idleLabel =
    idleDays === null
      ? "chưa từng đăng nhập"
      : `${idleDays} ngày không hoạt động`;

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Tài khoản đăng nhập
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Thông tin tài khoản hệ thống của <strong>{employeeName}</strong>.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Left column */}
        <div className="space-y-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Email
            </dt>
            <dd className="mt-0.5 font-mono text-sm text-foreground break-all">
              {existingUser.email}
            </dd>
          </div>

          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Vai trò
            </dt>
            <dd className="mt-1">
              <RoleBadge role={existingUser.role} />
            </dd>
          </div>

          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Trạng thái
            </dt>
            <dd className="mt-1">
              {existingUser.isActive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2.5 py-0.5 text-xs font-semibold text-state-success-ink">
                  <CheckCircle2 className="h-3 w-3" />
                  Hoạt động
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  <XCircle className="h-3 w-3" />
                  Đã vô hiệu hoá
                </span>
              )}
            </dd>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Lần đăng nhập cuối
            </dt>
            <dd
              className={`mt-0.5 text-sm tabular-nums ${ existingUser.lastLoginAt ? "text-foreground" : "italic text-muted-foreground" }`}
            >
              {formatDateTime(existingUser.lastLoginAt)}
            </dd>
          </div>

          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Ngày tạo
            </dt>
            <dd className="mt-0.5 text-sm tabular-nums text-foreground">
              {formatDate(existingUser.createdAt)}
            </dd>
          </div>

          {existingUser._count.permissionGrants > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Quyền override
              </dt>
              <dd className="mt-1">
                <Link
                  href={`/users/${existingUser.id}/permissions`}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary-soft-hover"
                >
                  <Shield className="h-3 w-3" />
                  {existingUser._count.permissionGrants} quyền override
                </Link>
              </dd>
            </div>
          )}
        </div>
      </div>

      {/* Idle warning */}
      {isIdle && existingUser.isActive && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-state-warning-soft bg-state-warning-soft p-3 text-sm text-state-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-state-warning-ink" />
          <div>
            <strong>Tài khoản idle:</strong> {idleLabel} — cân nhắc vô hiệu
            hoá nếu không còn cần đăng nhập.
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={`/users/${existingUser.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <Pencil className="h-4 w-4" />
          Sửa tài khoản
        </Link>
        <Link
          href={`/users/${existingUser.id}/reset-password`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-card px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft"
        >
          <KeyRound className="h-4 w-4" />
          Đổi mật khẩu
        </Link>
        <Link
          href={`/users/${existingUser.id}/permissions`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-card px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft"
        >
          <Shield className="h-4 w-4" />
          Phân quyền
        </Link>
      </div>
    </section>
  );
}
