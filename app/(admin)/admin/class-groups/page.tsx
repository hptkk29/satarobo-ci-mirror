import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { DeleteGroupButton } from "./_components/delete-group-button";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Nhóm lớp | Admin" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  GRADUATED: "Đã tốt nghiệp",
  DISBANDED: "Đã giải thể",
};

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "bg-state-success-soft text-state-success-ink",
  GRADUATED: "bg-state-info-soft text-state-info-ink",
  DISBANDED: "bg-muted text-muted-foreground",
};

export default async function ClassGroupsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("class_group:view-all"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canManage = await checkPermission("class_group:create");
  const canDelete = await checkPermission("class_group:delete");

  // Cách ly cơ sở: ClassGroup ∈ SCOPED_MODELS (có centerId) → scopedDb auto inject
  // centerId IN tầm-nhìn. CENTER_MANAGER@CS1 không thấy nhóm lớp CS2.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const groups = await sdb.classGroup.findMany({
    where: { deletedAt: null },
    include: {
      center: { select: { name: true, code: true } },
      _count: { select: { classes: true } },
    },
    orderBy: [{ status: "asc" }, { displayCode: "asc" }],
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Nhóm lớp (lớp cố định)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nhóm học sinh đi cùng nhau qua nhiều khoá/năm (tăng khoá Sata3 → 4 → 5…).
          </p>
        </div>
        {canManage && (
          <Link
            href="/class-groups/new"
            className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary-dark"
          >
            <Plus size={16} /> Thêm nhóm lớp
          </Link>
        )}
      </div>

      <div className="text-sm text-muted-foreground">{groups.length} nhóm lớp</div>

      <div className="overflow-hidden rounded border">
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted">
              <tr>
                <th className="px-3 py-2 text-left">Mã hiển thị</th>
                <th className="px-3 py-2 text-left">Tên nhóm</th>
                <th className="px-3 py-2 text-left">Cơ sở</th>
                <th className="px-3 py-2 text-right">Số lớp/khoá</th>
                <th className="px-3 py-2 text-left">Mã định danh</th>
                <th className="px-3 py-2 text-left">Trạng thái</th>
                {canDelete && <th className="px-3 py-2 text-right">Hành động</th>}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={canDelete ? 7 : 6} className="py-8 text-center text-muted-foreground">
                    Chưa có nhóm lớp nào.
                  </td>
                </tr>
              )}
              {groups.map((g) => (
                <tr key={g.id} className="border-b hover:bg-muted">
                  <td className="px-3 py-2 font-bold">
                    <Link
                      href={`/class-groups/${g.id}`}
                      className="text-state-info-ink hover:underline"
                    >
                      {g.displayCode}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{g.name ?? "—"}</td>
                  <td className="px-3 py-2">{g.center.name}</td>
                  <td className="px-3 py-2 text-right">{g._count.classes}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {g.code}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[g.status]}`}
                    >
                      {STATUS_LABEL[g.status]}
                    </span>
                  </td>
                  {canDelete && (
                    <td className="px-3 py-2 text-right">
                      <DeleteGroupButton id={g.id} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
