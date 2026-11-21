import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { scopedDb } from "@/lib/db-scope";
import {
  hasRole,
  getEmployeeFieldVisibility,
  redactEmployeeFields,
} from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { EmployeeForm } from "@/components/admin/nhan-su/employee-form";
import {
  ChangeRoleDialog,
  ROLE_LABEL,
  type Role,
} from "@/components/admin/nhan-su/change-role-dialog";
import { UserAccountSection } from "./_components/user-account-section";

export const metadata = { title: "Sửa nhân sự | Admin" };

const TEACHING_DEPARTMENTS = new Set<string>(["GIANG_DAY", "DAO_TAO"]);

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditEmployeePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  // Cách ly cơ sở (A0-04): Employee ∈ SCOPED_MODELS — sdb.findUnique null-filter NV
  // ngoài tầm nhìn cơ sở (chống IDOR) → notFound.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const employee = await sdb.employee.findUnique({
    where: { id },
    include: {
      userAccount: {
        select: {
          id: true,
          email: true,
          role: true,
          roles: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { permissionGrants: true } },
        },
      },
    },
  });
  if (!employee) notFound();

  // Target gate: employees:edit có cả tầng GLOBAL (HO_HR) và CENTER (CENTER_HR) —
  // truyền centerId của NV đang xem để v2 đánh giá đúng nhánh CENTER.
  if (!(await checkPermission("employees:edit", { centerId: employee.centerId }))) {
    redirect("/dashboard");
  }

  const canManageUsers = await checkPermission("users:manage");

  const [orgUnits, managers, departments] = await Promise.all([
    getSelectableOrgUnits(actor),
    sdb.employee.findMany({
      where: { isActive: true, NOT: { id } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, jobTitle: true },
    }),
    sdb.departmentDef.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { code: true, name: true, isTeaching: true },
    }),
  ]);

  // Cờ "Nhân viên HO": có EmployeeOrgAssignment active tới OrgUnit type=HO (Doc 15 OI-1).
  const hoUnit = await sdb.orgUnit.findFirst({
    where: { type: "HO", deletedAt: null },
    select: { id: true },
  });
  const initialIsHO = hoUnit
    ? (await sdb.employeeOrgAssignment.count({
        where: { employeeId: id, orgUnitId: hoUnit.id, status: "ACTIVE" },
      })) > 0
    : false;

  const isSuperAdmin = hasRole(session.user, "SUPER_ADMIN");
  const canViewAudit = await checkPermission("audit-logs:view");
  const showScheduleLink = TEACHING_DEPARTMENTS.has(employee.department);

  const auditLogs = canViewAudit
    ? await sdb.roleAuditLog.findMany({
        where: { employeeId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    : [];

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sửa: {employee.fullName}</h1>
          <p className="mt-1 text-sm text-muted-foreground font-mono">{employee.employeeCode}</p>
          {employee.userAccount && (
            <p className="mt-1 text-xs text-muted-foreground">
              User: {employee.userAccount.email} · Vai trò hiện tại:{" "}
              <strong className="text-foreground">
                {ROLE_LABEL[employee.userAccount.role as Role] ?? employee.userAccount.role}
              </strong>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && employee.userAccount && (
            <ChangeRoleDialog
              employeeId={employee.id}
              employeeName={employee.fullName}
              currentRole={employee.userAccount.role as Role}
              currentRoles={employee.userAccount.roles as Role[]}
            />
          )}
          {showScheduleLink && (
            <Link
              href={`/nhan-su/${id}/schedule`}
              className="inline-flex items-center gap-2 rounded-lg border-2 border-primary-soft bg-card px-4 py-2 text-sm font-bold text-primary hover:bg-primary-soft"
            >
              <CalendarDays className="h-4 w-4" />
              Xem lịch dạy
            </Link>
          )}
        </div>
      </div>

      <EmployeeForm
        mode="edit"
        // SEC-H04: redact field ngoài quyền TRƯỚC khi serialize xuống client form
        // (dùng cùng role với gate input bên dưới → payload không chứa PII bị ẩn).
        initial={redactEmployeeFields(
          employee,
          getEmployeeFieldVisibility(session.user.role),
        )}
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
        managers={managers}
        departments={departments}
        userRole={session.user.role}
        initialIsHO={initialIsHO}
      />

      {canManageUsers && (
        <UserAccountSection
          employeeId={employee.id}
          employeeName={employee.fullName}
          existingUser={employee.userAccount}
        />
      )}

      {canViewAudit && auditLogs.length > 0 && (
        <section className="mt-8 border-t pt-6">
          <h2 className="text-lg font-semibold mb-4 text-foreground">
            Lịch sử thay đổi vai trò
          </h2>
          <div className="space-y-2">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="border-l-2 border-state-warning pl-3 py-2 bg-state-warning-soft/50 rounded-r"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {ROLE_LABEL[log.fromRole as Role] ?? log.fromRole}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold text-state-warning-ink">
                    {ROLE_LABEL[log.toRole as Role] ?? log.toRole}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(log.createdAt).toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Bởi: <strong>{log.changedByName}</strong>
                </div>
                {log.reason && (
                  <div className="text-xs text-foreground mt-1 italic">
                    &ldquo;{log.reason}&rdquo;
                  </div>
                )}
              </div>
            ))}
          </div>
          {auditLogs.length === 20 && (
            <p className="text-xs text-muted-foreground mt-2">
              Hiển thị 20 thay đổi gần nhất.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
