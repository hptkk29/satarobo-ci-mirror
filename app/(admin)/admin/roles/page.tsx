import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { checkPermission } from "@/lib/auth/check-permission";
import { listRoles } from "@/lib/auth/rbac-service";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateRoleForm } from "./_components/create-role-form";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

export default async function RolesAdminPage() {
  // AC2 — chỉ SUPER_ADMIN (roles:manage). Defense-in-depth: action cũng tự chặn.
  if (!(await checkPermission("roles:manage"))) {
    redirect("/admin/dashboard");
  }

  const roles = await listRoles();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Vai trò & quyền (RBAC)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cấu hình role động. Mọi thay đổi yêu cầu lý do và được ghi nhật ký.
        </p>
        </div>
        <NutXuat ma="quyen-vai" />
      </div>

      <CreateRoleForm />

      <div className="mt-8 rounded-lg border">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã</TableHead>
                <TableHead>Tên</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead className="text-right">Số quyền</TableHead>
                <TableHead className="text-right">Người dùng</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-semibold">
                    <Link href={`/roles/${r.id}`} className="text-primary hover:underline">
                      {r.code}
                    </Link>
                  </TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    {r.isSystem ? (
                      <Badge variant="secondary">Hệ thống</Badge>
                    ) : r.isActive ? (
                      <Badge>Hoạt động</Badge>
                    ) : (
                      <Badge variant="outline">Tắt</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{r.permissions.length}</TableCell>
                  <TableCell className="text-right">{r._count.userRoles}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
