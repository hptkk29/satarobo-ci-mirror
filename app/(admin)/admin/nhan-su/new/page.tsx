import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { EmployeeForm } from "@/components/admin/nhan-su/employee-form";

export const metadata = { title: "Thêm nhân sự | Admin" };

export default async function NewEmployeePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("employees:create"))) redirect("/dashboard");

  // Cách ly cơ sở (A0-04): Employee ∈ SCOPED_MODELS → đọc qua scopedDb.
  // Lưu ý: employees:create hiện chỉ cấp cho SUPER_ADMIN/HR HO-level (scope ALL) nên
  // mã đề xuất vẫn tính trên TOÀN BỘ NV; nếu sau này cấp cho center-level, mã chỉ là
  // đề xuất — create action vẫn chặn trùng bằng unique employeeCode.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Tính next employee code (SR.NV.001, SR.NV.002, ...)
  const lastEmployee = await sdb.employee.findFirst({
    where: { employeeCode: { startsWith: "SR.NV." } },
    orderBy: { employeeCode: "desc" },
  });

  let nextCode = "SR.NV.001";
  if (lastEmployee) {
    const match = lastEmployee.employeeCode.match(/SR\.NV\.E?(\d+)/);
    if (match) {
      const num = parseInt(match[1]) + 1;
      nextCode = `SR.NV.${String(num).padStart(3, "0")}`;
    }
  }

  const [orgUnits, managers, departments] = await Promise.all([
    getSelectableOrgUnits(actor),
    sdb.employee.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, jobTitle: true },
    }),
    sdb.departmentDef.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { code: true, name: true, isTeaching: true },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Thêm nhân sự mới</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mã NV tự động đề xuất: <code className="font-mono">{nextCode}</code>
        </p>
      </div>

      <EmployeeForm
        mode="create"
        defaultCode={nextCode}
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
        managers={managers}
        departments={departments}
        userRole={session.user.role}
      />
    </div>
  );
}
