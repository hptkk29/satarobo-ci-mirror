import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ALL_ACTIONS } from "@/lib/auth/permissions";
import { RolePermissionsEditor } from "../_components/role-permissions-editor";
import { RoleMenuGonEditor } from "../_components/role-menu-gon-editor";

export const metadata = { title: "Quyền của vai | Admin" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function RoleDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cùng gate với danh sách vai: chỉ roles:manage mới sửa được quyền.
  // Defense-in-depth — setRolePermissions() ở service cũng tự requireManage().
  if (!(await checkPermission("roles:manage"))) redirect("/dashboard");

  // RoleDef KHÔNG có centerId (không thuộc SCOPED_MODELS) nên scopedDb là
  // pass-through; vẫn đi qua nó cho nhất quán với các trang admin khác — và để
  // không phải import `@/lib/db` trần (ESLint chặn trong app/(admin)).
  const sdb = scopedDb(await resolveActor(session.user.id));

  const role = await sdb.roleDef.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      isSystem: true,
      anMenu: true,
      permissions: {
        select: { action: true, scopeType: true },
        orderBy: { action: "asc" },
      },
      _count: { select: { userRoles: true } },
    },
  });
  if (!role) notFound();

  return (
    <div>
      <Link
        href="/roles"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách vai
      </Link>

      <div className="mb-6">
        <h1 className="flex flex-wrap items-center gap-2 text-3xl font-black text-foreground">
          <ShieldCheck className="h-7 w-7 shrink-0 text-primary" />
          {role.name}
          <span className="font-mono text-base font-semibold text-muted-foreground">
            {role.code}
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {role._count.userRoles} người đang giữ vai này. Mọi thay đổi yêu cầu lý do
          và được ghi nhật ký.
        </p>
      </div>

      {role.isSystem ? (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Vai hệ thống — sửa quyền ở đây ảnh hưởng toàn hệ thống.</span>
        </div>
      ) : null}

      <RolePermissionsEditor
        roleId={role.id}
        allActions={ALL_ACTIONS}
        current={role.permissions.map((p) => ({
          action: p.action,
          scopeType: p.scopeType,
        }))}
      />

      <RoleMenuGonEditor roleId={role.id} current={role.anMenu} />
    </div>
  );
}
