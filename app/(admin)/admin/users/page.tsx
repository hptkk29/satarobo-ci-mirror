import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, KeyRound, Shield, AlertCircle } from "lucide-react";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { RoleBadges } from "./_components/role-badge";
import {
  UserStatusToggle,
  UserRowActions,
} from "./_components/user-row-actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const metadata = { title: "Tài khoản đăng nhập | Admin" };
export const dynamic = "force-dynamic";

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function formatLoginShort(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(date: Date | null): {
  text: string;
  idleDays: number | null;
} {
  if (!date) return { text: "Chưa từng", idleDays: null };
  const days = daysSince(date);
  if (days < 1) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return { text: `Hôm nay ${hh}:${mm}`, idleDays: days };
  }
  if (days === 1) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return { text: `Hôm qua ${hh}:${mm}`, idleDays: days };
  }
  return { text: formatLoginShort(date), idleDays: days };
}

export default async function UsersAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  // Nút "Vai trò theo đơn vị" (org-roles, RBAC v2) chỉ hiện cho người gán được.
  const canAssignRoles = await checkPermission("roles:assign");

  // User là SCOPE_EXEMPT (identity toàn cục) → sdb pass-through, hành vi y nguyên.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const users = await sdb.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      center: { select: { name: true } },
      _count: { select: { permissionGrants: true } },
    },
  });

  // Đếm SUPER_ADMIN active (xét union roles) để disable toggle nếu chỉ còn 1.
  const activeSuperAdminCount = users.filter(
    (u) => hasRole(u, "SUPER_ADMIN") && u.isActive,
  ).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Tài khoản đăng nhập
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} tài khoản · chỉ SUPER_ADMIN có quyền quản lý
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <NutXuat ma="tai-khoan" />
        <Link
          href="/users/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
        >
          <Plus className="h-4 w-4" />
          Tạo tài khoản mới
        </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tên
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nhân sự
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cơ sở
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đăng nhập cuối
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có tài khoản nào
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === session.user.id;
                  const isLastActiveSuperAdmin =
                    hasRole(u, "SUPER_ADMIN") &&
                    u.isActive &&
                    activeSuperAdminCount === 1;
                  const toggleDisabled = isSelf || isLastActiveSuperAdmin;
                  const toggleReason = isSelf
                    ? "Không thể tự disable chính mình"
                    : isLastActiveSuperAdmin
                      ? "Không thể disable SUPER_ADMIN duy nhất"
                      : undefined;
                  return (
                    <tr key={u.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/users/${u.id}/edit`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {u.email}
                        </Link>
                        {isSelf && (
                          <span className="ml-2 inline-flex rounded-full bg-state-info-soft px-2 py-0.5 text-[10px] font-semibold text-state-info-ink">
                            BẠN
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {u.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RoleBadges role={u.role} roles={u.roles} />
                          {u._count.permissionGrants > 0 && (
                            <Link
                              href={`/users/${u.id}/permissions`}
                              title="Xem chi tiết overrides"
                              className="inline-flex items-center gap-0.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary-soft-hover"
                            >
                              <Shield className="h-2.5 w-2.5" />
                              {u._count.permissionGrants} override
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {u.employee ? (
                          <Link
                            href={`/nhan-su/${u.employee.id}`}
                            className="text-primary hover:underline"
                          >
                            {u.employee.fullName}
                            {u.employee.employeeCode && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {u.employee.employeeCode}
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {u.center?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <UserStatusToggle
                          userId={u.id}
                          isActive={u.isActive}
                          disabled={toggleDisabled}
                          disabledReason={toggleReason}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {(() => {
                          const { text, idleDays } = formatRelative(
                            u.lastLoginAt,
                          );
                          if (idleDays === null) {
                            return (
                              <span className="inline-flex items-center gap-1 italic text-state-warning-ink">
                                <AlertCircle className="h-3 w-3" />
                                {text}
                              </span>
                            );
                          }
                          if (idleDays > 30) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-foreground">{text}</span>
                                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-warning-ink">
                                  <AlertCircle className="h-2.5 w-2.5" />
                                  Idle {idleDays}d
                                </span>
                              </div>
                            );
                          }
                          return <span className="text-muted-foreground">{text}</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <UserRowActions
                          userId={u.id}
                          isActive={u.isActive}
                          isSelf={isSelf}
                          canOrgRoles={canAssignRoles}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-state-info-soft bg-state-info-soft p-3 text-xs text-state-info-ink">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-state-info-ink" />
        <div>
          <strong>Lưu ý bảo mật:</strong> Khi đổi role hoặc reset password hoặc
          disable user → `tokenVersion` tự tăng → user đó bị đăng xuất khỏi
          mọi thiết bị ở request kế tiếp.
        </div>
      </div>
    </div>
  );
}
