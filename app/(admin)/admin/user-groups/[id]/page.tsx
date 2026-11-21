// US-03 (Nền Hệ thống P0) — chi tiết nhóm người dùng: sửa tên/mô tả, thành viên
// (thêm/gỡ — HARD delete, quyền đổi ngay request kế), grant nhóm (tạo/xoá — KHÔNG
// sửa tại chỗ; đổi grant = xoá rồi tạo lại để RbacAuditLog giữ vết trọn vẹn).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, UsersRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { NON_GROUP_GRANTABLE_KEYS } from "@/lib/validators/user-group";
import { GroupSettingsForm } from "../_components/group-settings-form";
import { GroupMembers } from "../_components/group-members";
import { GroupGrants } from "../_components/group-grants";
import { DeleteGroupButton } from "../_components/delete-group-button";

export const metadata = { title: "Chi tiết nhóm người dùng | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const fmtDateTime = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh", // Vercel chạy UTC — không dùng giờ máy chủ trần
});

export default async function UserGroupDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("user-groups:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { id } = await params;

  // UserGroup ∉ SOFT_DELETE_MODELS → tự lọc deletedAt null; nhóm đã xoá mềm = 404.
  const group = await sdb.userGroup.findFirst({
    where: { id, deletedAt: null },
    include: {
      members: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
      },
    },
  });
  if (!group) notFound();

  const memberIds = group.members.map((m) => m.userId);

  // Grant của nhóm — kèm descriptor để cảnh báo key đã tắt (grant cũ trên key
  // isActive=false vẫn hiển thị, chỉ chặn tạo MỚI ở action).
  const [grants, descriptors, candidates] = await Promise.all([
    sdb.permissionGrant.findMany({
      where: { subjectType: "GROUP", subjectId: id },
      orderBy: { createdAt: "desc" },
      include: { descriptor: { select: { module: true, isActive: true } } },
    }),
    // Select permission key cho grant editor: CHỈ key đang hoạt động trong registry
    // (US-01), LOẠI khoá quản trị NON_GROUP_GRANTABLE_KEYS (chống tự-leo-thang —
    // validator chặn cứng ở action, đây là lớp UI cùng 1 nguồn hằng).
    sdb.permissionDescriptor.findMany({
      where: { isActive: true, key: { notIn: [...NON_GROUP_GRANTABLE_KEYS] } },
      orderBy: [{ module: "asc" }, { key: "asc" }],
      select: { key: true, module: true, sensitiveFields: true },
    }),
    // Ứng viên thành viên: tài khoản active chưa thuộc nhóm. Loại tài khoản phụ huynh
    // (primary role PARENT) — nhóm là công cụ cấp quyền NỘI BỘ ở P0, và tránh đổ hàng
    // nghìn tài khoản PH vào select.
    sdb.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        role: { not: "PARENT" },
        ...(memberIds.length > 0 ? { id: { notIn: memberIds } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return (
    <div>
      <Link
        href="/user-groups"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Nhóm người dùng
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
            <UsersRound className="h-7 w-7 text-primary" />
            {group.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tạo lúc {fmtDateTime.format(group.createdAt)} · {group.members.length} thành viên ·{" "}
            {grants.length} grant
          </p>
        </div>
        <DeleteGroupButton groupId={group.id} />
      </div>

      <div className="space-y-6">
        <GroupSettingsForm
          groupId={group.id}
          initialName={group.name}
          initialDescription={group.description ?? ""}
        />

        <GroupMembers
          groupId={group.id}
          members={group.members.map((m) => ({
            userId: m.userId,
            name: m.user.name ?? m.user.email ?? m.userId,
            email: m.user.email,
            isActive: m.user.isActive,
            addedAt: fmtDateTime.format(m.createdAt),
          }))}
          candidates={candidates.map((u) => ({
            id: u.id,
            label: u.name ? `${u.name}${u.email ? ` (${u.email})` : ""}` : (u.email ?? u.id),
          }))}
        />

        <GroupGrants
          groupId={group.id}
          grants={grants.map((g) => ({
            id: g.id,
            permissionKey: g.permissionKey,
            module: g.descriptor.module,
            keyInactive: !g.descriptor.isActive,
            effect: g.effect,
            dataScope: g.dataScope,
            fieldMask: g.fieldMask,
            reason: g.reason ?? "",
            createdAt: fmtDateTime.format(g.createdAt),
          }))}
          descriptors={descriptors.map((d) => ({
            key: d.key,
            module: d.module,
            sensitiveFields: d.sensitiveFields,
          }))}
        />
      </div>
    </div>
  );
}
