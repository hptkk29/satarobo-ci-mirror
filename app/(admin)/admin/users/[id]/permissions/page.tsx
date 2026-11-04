import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Shield, AlertTriangle, BadgeCheck } from "lucide-react";
import { PERMISSIONS, isSuperAdmin as checkSuperAdmin } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { RoleBadge } from "../../_components/role-badge";
import { GrantsTable } from "./_components/grants-table";
import { AddGrantForm } from "./_components/add-grant-form";
import { EffectiveMatrix } from "./_components/effective-matrix";

export const metadata = { title: "Phân quyền user | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function UserPermissionsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // User SCOPE_EXEMPT (identity toàn cục) → sdb pass-through, hành vi y nguyên.
  const sdb = scopedDb(await resolveActor(session.user.id));

  const { id } = await params;
  const user = await sdb.user.findFirst({
    where: { id, deletedAt: null },
    include: {
      permissionGrants: {
        include: {
          grantor: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      employee: { select: { id: true, fullName: true, employeeCode: true } },
    },
  });
  if (!user) notFound();

  const isSuperAdmin = checkSuperAdmin(user.role);
  const existingActions = user.permissionGrants.map((g) => g.action);
  const grants = user.permissionGrants.map((g) => ({
    action: g.action,
    grant: g.grant,
  }));

  return (
    <div className="max-w-5xl">
      <Link
        href={`/users/${user.id}/edit`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại sửa tài khoản
      </Link>

      {/* Section A — User header */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary shrink-0" />
              <h1 className="truncate text-2xl font-bold text-foreground">
                Phân quyền nâng cao
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{user.email}</span>
              {user.name && (
                <>
                  <span className="mx-1.5 text-muted-foreground">·</span>
                  {user.name}
                </>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RoleBadge role={user.role} />
              {user.employee && (
                <Link
                  href={`/nhan-su/${user.employee.id}`}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  <BadgeCheck className="h-3 w-3" />
                  {user.employee.fullName}
                  {user.employee.employeeCode && (
                    <span className="text-muted-foreground">
                      · {user.employee.employeeCode}
                    </span>
                  )}
                </Link>
              )}
              {user.permissionGrants.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {user.permissionGrants.length} override
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Per-user overrides cho phép cấp (ALLOW) hoặc thu hồi (DENY) một quyền
          cụ thể bất kể role. Thứ tự ưu tiên:{" "}
          <strong>DENY &gt; ALLOW &gt; role matrix</strong>.
        </p>
      </div>

      {/* Banner — SUPER_ADMIN cannot be overridden */}
      {isSuperAdmin && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary-soft bg-primary-soft p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm text-primary">
            <strong>SUPER_ADMIN</strong> có toàn quyền — overrides không có
            hiệu lực để chống self-lockout. Nếu cần hạn chế, đổi role trước
            khi thêm grants.
          </div>
        </div>
      )}

      {/* Section B — Current grants table */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Quyền override hiện tại
        </h2>
        <GrantsTable grants={user.permissionGrants} />
      </section>

      {/* Section C — Add grant form */}
      <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Thêm quyền override
        </h2>
        <AddGrantForm
          userId={user.id}
          existingActions={existingActions}
          disabled={isSuperAdmin}
          disabledReason="SUPER_ADMIN có toàn quyền — không cần override permissions."
        />
      </section>

      {/* Section D — Effective permissions preview */}
      <section className="mb-6">
        <EffectiveMatrix
          role={user.role}
          grants={grants}
          roleMatrix={PERMISSIONS}
        />
      </section>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-state-info-soft bg-state-info-soft p-3 text-xs text-state-info-ink">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-state-info-ink" />
        <div>
          <strong>Lưu ý bảo mật:</strong> Mỗi thao tác add/edit/delete grant
          sẽ tăng <code>tokenVersion</code> → user bị đăng xuất khỏi mọi thiết
          bị ở request kế tiếp.
        </div>
      </div>
    </div>
  );
}
