// US-03 (Nền Hệ thống P0) — danh sách Nhóm người dùng (grant ad-hoc, không sửa vai chuẩn).
// Gate user-groups:manage (chỉ SUPER_ADMIN — như roles:manage); action tự chặn lại
// (defense-in-depth). UserGroup ∉ SCOPED_MODELS (cấu hình quyền toàn cục) → scopedDb
// pass-through, vẫn đi scopedDb theo luật cổng DB.
import Link from "next/link";
import { redirect } from "next/navigation";
import { UsersRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateGroupForm } from "./_components/create-group-form";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Nhóm người dùng | Admin" };
export const dynamic = "force-dynamic";

export default async function UserGroupsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("user-groups:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sdb = scopedDb(await resolveActor(session.user.id));

  // UserGroup ∉ SOFT_DELETE_MODELS (lọc tự động) → tự filter deletedAt null (SOFT DELETE).
  const groups = await sdb.userGroup.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });

  // Số grant per nhóm: subjectId polymorphic (không FK/relation) → groupBy tay.
  const grantRows =
    groups.length === 0
      ? []
      : await sdb.permissionGrant.groupBy({
          by: ["subjectId"],
          where: {
            subjectType: "GROUP",
            subjectId: { in: groups.map((g) => g.id) },
          },
          _count: { _all: true },
        });
  const grantCountByGroup = new Map(
    grantRows.map((r) => [r.subjectId, r._count._all]),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
          <UsersRound className="h-7 w-7 text-primary" />
          Nhóm người dùng
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cấp quyền cho một nhóm người mà không sửa vai trò
        </p>
      </div>

      <PageHelp>
        <p>
          Cấp quyền ad-hoc cho ít người mà không sửa vai trò chuẩn. DENY của
          nhóm thắng ALLOW của vai trò; gỡ khỏi nhóm là quyền mất ngay request
          kế tiếp.
        </p>
      </PageHelp>

      <CreateGroupForm />

      <div className="mt-8 rounded-lg border">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên nhóm</TableHead>
                <TableHead>Mô tả</TableHead>
                <TableHead className="text-right">Thành viên</TableHead>
                <TableHead className="text-right">Grant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Chưa có nhóm nào. Tạo nhóm đầu tiên bằng form phía trên.
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <Link
                        href={`/user-groups/${g.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {g.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {g.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {g._count.members}
                    </TableCell>
                    <TableCell className="text-right">
                      {(grantCountByGroup.get(g.id) ?? 0) > 0 ? (
                        <Badge variant="secondary">
                          {grantCountByGroup.get(g.id)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
