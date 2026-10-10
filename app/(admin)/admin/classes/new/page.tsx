import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { isClassGroupEnabled } from "@/lib/flags";
import { ClassForm } from "../_components/class-form";

export const dynamic = "force-dynamic";

export default async function NewClassPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("classes:create"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const actor = await resolveActor(session.user.id);

  const hoCenterIds = await getNonEnrollableCenterIds();
  const sdb = scopedDb(actor);
  // Scope GHI per-model của Class (vá 24/07) — dùng cho CẢ picker GV lẫn picker "Đơn vị"
  // bên dưới: actor kiểu Toại (TRAINING@HO + CM@CS1) chỉ thấy CS1, hết bày GV CS2.
  const classCenters = getModelVisibleCenterIds("Class", actor);
  // Cờ GỠ "Nhóm lớp" (mặc định OFF từ 20/08) — ô biến mất thì danh sách nhóm cũng thừa,
  // bỏ luôn 1 query. Bật cờ lại là truy vấn chạy như cũ, không cần revert code.
  const classGroupEnabled = isClassGroupEnabled();
  const [courses, orgUnits, classGroups, rooms, teachers, curricula] = await Promise.all([
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, code: true, slug: true }, // T3.4 — code/slug để gợi ý tên lớp
    }),
    // Lớp CHỈ mở ở cơ sở dạy học — Hội sở không nằm trong danh sách (chốt 04/08).
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
    classGroupEnabled
      ? sdb.classGroup.findMany({
          where: { deletedAt: null, status: "ACTIVE" },
          orderBy: { displayCode: "asc" },
          select: { id: true, displayCode: true, name: true, centerId: true },
        })
      : Promise.resolve([]),
    sdb.room.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ centerId: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, centerId: true },
    }),
    // Fix #9 — nguồn DUY NHẤT cho GV có thể phân lớp (không lọt quản lý/sale thuần).
    // R2-RBAC-3 + vá 24/07 — GV theo scope per-model của Class ("ALL" → như cũ theo
    // visibleCenterIds); form còn lọc tiếp theo đơn vị đang chọn ở client.
    // 06/08 — GV là nguồn lực chung (Hội sở điều đi mọi cơ sở): KHÔNG lọc
    // danh sách theo cơ sở nữa, nếu không CS2 không bao giờ tới được form và
    // bộ lọc phía client có mở cũng vô nghĩa.
    getAssignableTeachers({}),
    sdb.curriculum.findMany({
      where: {
        isActive: true,
        status: "ACTIVE",
        course: { isActive: true, isTeachable: true },
      },
      orderBy: [{ courseId: "asc" }, { version: "desc" }],
      select: { id: true, courseId: true, version: true, name: true },
    }),
  ]);

  // Picker "Đơn vị" theo scope GHI của Class (đối xứng guard createClass — vá 24/07):
  // role HO không có quyền classes:* không được mời chọn cơ sở ngoài scope.
  const orgUnitsInScope =
    classCenters === "ALL"
      ? orgUnits
      : orgUnits.filter((o) => o.centerId != null && classCenters.includes(o.centerId));

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">Thêm lớp học mới</h1>
      <ClassForm
        hoCenterIds={hoCenterIds}
        courses={courses}
        orgUnits={orgUnitsInScope.map((o) => ({
          id: o.orgUnitId,
          name: o.name,
          centerId: o.centerId,
        }))}
        classGroups={classGroups}
        classGroupEnabled={classGroupEnabled}
        rooms={rooms}
        teachers={teachers.map((t) => ({
          id: t.id,
          name: t.name ?? "(chưa đặt tên)",
          role: t.role,
          centerId: t.centerId,
        }))}
        curricula={curricula}
      />
    </div>
  );
}
