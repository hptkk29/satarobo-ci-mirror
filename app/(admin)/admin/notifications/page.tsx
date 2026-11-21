import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { NotificationsClient } from "./_components/notifications-client";

export const metadata = { title: "Thông báo | Admin" };
export const dynamic = "force-dynamic";

const SCOPE: Record<string, string> = {
  ALL_PARENTS: "Tất cả phụ huynh",
  CENTER: "Theo cơ sở",
  CLASS: "Theo lớp",
  STUDENT: "Theo học viên",
};

export default async function AdminNotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("notifications:manage"))) redirect("/dashboard");

  // Cách ly cơ sở: Notification/Class/Student ∈ SCOPED_MODELS → sdb auto inject
  // `centerId IN visibleCenterIds`. CENTER_MANAGER@CS1 chỉ thấy thông báo/lớp/HS
  // của CS mình; SUPER_ADMIN/HO bypass (ALL). Center là model reference (không
  // scoped) → sdb.center là no-op, giữ nguyên danh sách cơ sở cho dropdown.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [rows, centers, classes, students] = await Promise.all([
    sdb.notification.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    sdb.center.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    sdb.class.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, classCode: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    // #7 — học viên CÓ liên kết tài khoản phụ huynh (mới gửi riêng được).
    sdb.student.findMany({
      where: { deletedAt: null, parentUserId: { not: null } },
      select: { id: true, name: true, studentCode: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);

  const items = rows.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    audience: n.audience,
    scopeLabel: SCOPE[n.audience] ?? n.audience,
    isPublished: n.isPublished,
    createdAt: n.createdAt.toISOString(),
    createdByName: n.createdByName,
  }));

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Thông báo phụ huynh</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Đăng thông báo hiển thị trên portal hocvien.satarobo.vn.
        </p>
      </div>
      <NotificationsClient
        items={items}
        centers={centers.map((c) => ({ id: c.id, label: c.name }))}
        classes={classes.map((c) => ({
          id: c.id,
          label: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
        }))}
        students={students.map((s) => ({
          id: s.id,
          label: s.studentCode ? `${s.name} (${s.studentCode})` : s.name,
        }))}
      />
    </div>
  );
}
