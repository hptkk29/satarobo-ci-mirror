import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, KeyRound, Power, Shield, ArrowRight, Building2 } from "lucide-react";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { UserForm } from "../../_components/user-form";
import { toggleUserActiveAction } from "../../_actions";

export const metadata = { title: "Sửa tài khoản | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function EditUserPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // User SCOPE_EXEMPT → sdb pass-through; Employee ∈ SCOPED_MODELS → tự cách ly cơ sở.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const { id } = await params;
  const user = await sdb.user.findFirst({
    where: { id, deletedAt: null },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      center: { select: { id: true, name: true } },
      _count: { select: { permissionGrants: true } },
    },
  });
  if (!user) notFound();

  // PR-C: picker đơn vị tổ chức qua OrgUnit tree (gồm HO) thay cho db.center.
  const [orgUnits, unlinkedEmployees] = await Promise.all([
    getSelectableOrgUnits(actor),
    sdb.employee.findMany({
      where: { status: "ACTIVE", userAccount: null },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, employeeCode: true },
    }),
  ]);

  // Hợp nhất unlinkedEmployees + current employee (nếu có) → dropdown có thể
  // giữ lựa chọn hiện tại.
  const employees = user.employee
    ? [user.employee, ...unlinkedEmployees].filter(
        (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i,
      )
    : unlinkedEmployees;

  const isSelf = user.id === session.user.id;

  // Org-roles (RBAC v2) — nguồn quyền chính khi cờ ON; chỉ người có roles:assign
  // thấy lối vào. Đếm vai đang ACTIVE để hiện trạng thái ngay trên card.
  const canAssignRoles = await checkPermission("roles:assign");
  const activeOrgRoleCount = canAssignRoles
    ? await sdb.userOrgRole.count({ where: { userId: user.id, status: "ACTIVE" } })
    : 0;

  // Last active SUPER_ADMIN protection mirror với list page (xét union roles).
  const activeSuperAdminCount = await sdb.user.count({
    where: { roles: { has: "SUPER_ADMIN" }, isActive: true, deletedAt: null },
  });
  const isLastActiveSuperAdmin =
    hasRole(user, "SUPER_ADMIN") &&
    user.isActive &&
    activeSuperAdminCount === 1;

  return (
    <div className="max-w-3xl">
      <Link
        href="/users"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{user.email}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.name ?? "—"}
          {isSelf && (
            <span className="ml-2 inline-flex rounded-full bg-state-info-soft px-2 py-0.5 text-[10px] font-semibold text-state-info-ink">
              ĐÂY LÀ BẠN
            </span>
          )}
        </p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <UserForm
          mode="edit"
          initialData={{
            id: user.id,
            name: user.name,
            email: user.email ?? undefined,
            role: user.role,
            roles: user.roles,
            orgUnitId: user.orgUnitId,
            employeeId: user.employeeId,
          }}
          orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
          employees={employees}
        />
      </div>

      {/* Thông tin hệ thống — readonly */}
      <div className="mt-6 rounded-xl border border-border bg-muted/50 p-5 text-sm">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Thông tin hệ thống
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Ngày tạo</dt>
            <dd className="mt-0.5 tabular-nums text-foreground">
              {formatDate(user.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lần đăng nhập cuối</dt>
            <dd className="mt-0.5 tabular-nums text-foreground">
              {formatDate(user.lastLoginAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Token version</dt>
            <dd className="mt-0.5 font-mono text-xs text-foreground">
              {user.tokenVersion}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Trạng thái</dt>
            <dd className="mt-0.5">
              {user.isActive ? (
                <span className="inline-flex rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
                  Hoạt động
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  Đã disable
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Phân quyền nâng cao — Phase 5.3.2 */}
      <div className="mt-6 rounded-xl border border-primary-soft bg-primary-soft/30 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
              <Shield className="h-4 w-4" />
              Phân quyền nâng cao
            </h2>
            <p className="mt-2 text-sm text-foreground">
              Cấp (ALLOW) hoặc thu hồi (DENY) một quyền cụ thể bất kể role.
              {user._count.permissionGrants > 0 ? (
                <>
                  {" "}User này đang có{" "}
                  <strong className="text-primary">
                    {user._count.permissionGrants} override
                  </strong>
                  .
                </>
              ) : (
                <> User này chưa có override nào — đang dùng quyền mặc định theo role.</>
              )}
            </p>
          </div>
          <Link
            href={`/users/${user.id}/permissions`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
          >
            Quản lý
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Vai trò theo đơn vị (RBAC v2) — nguồn quyền chính khi cờ RBAC_V2 bật */}
      {canAssignRoles && (
        <div className="mt-6 rounded-xl border border-state-success-soft bg-state-success-soft/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-state-success-ink">
                <Building2 className="h-4 w-4" />
                Vai trò theo đơn vị (RBAC v2)
              </h2>
              <p className="mt-2 text-sm text-foreground">
                Gán vai trò (RoleDef) theo từng cơ sở/Hội sở — đây là nguồn quyền
                chính khi hệ phân quyền v2 bật.
                {activeOrgRoleCount > 0 ? (
                  <>
                    {" "}User này đang giữ{" "}
                    <strong className="text-state-success-ink">
                      {activeOrgRoleCount} vai trò
                    </strong>{" "}
                    đang hiệu lực.
                  </>
                ) : (
                  <>
                    {" "}User này <strong className="text-state-danger-ink">chưa có vai trò v2 nào</strong>{" "}
                    — khi v2 bật sẽ không có quyền gì.
                  </>
                )}
              </p>
            </div>
            <Link
              href={`/users/${user.id}/org-roles`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-state-success bg-card px-4 py-2 text-sm font-semibold text-state-success-ink hover:bg-state-success-soft"
            >
              Quản lý
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {/* Nguy hiểm: reset password + toggle disable */}
      <div className="mt-6 rounded-xl border-2 border-state-danger-soft bg-state-danger-soft/40 p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-state-danger-ink">
          Hành động nhạy cảm
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/users/${user.id}/reset-password`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
          >
            <KeyRound className="h-4 w-4" />
            Đổi mật khẩu
          </Link>

          <form
            action={async () => {
              "use server";
              await toggleUserActiveAction(user.id);
            }}
          >
            <button
              type="submit"
              disabled={isSelf || isLastActiveSuperAdmin}
              title={
                isSelf
                  ? "Không thể tự disable chính mình"
                  : isLastActiveSuperAdmin
                    ? "Không thể disable SUPER_ADMIN duy nhất"
                    : undefined
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-state-danger bg-card px-4 py-2 text-sm font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Power className="h-4 w-4" />
              {user.isActive ? "Disable tài khoản" : "Kích hoạt lại"}
            </button>
          </form>
        </div>
        <p className="mt-3 text-xs text-state-danger-ink/80">
          ⚠️ Cả 2 thao tác sẽ tăng tokenVersion → user đó bị đăng xuất khỏi
          mọi thiết bị ở request kế tiếp.
        </p>
      </div>
    </div>
  );
}
