import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { KhoaTienQuyetForm } from "./khoa-tien-quyet-form";

// Khoá tiên quyết của KHOÁ mà giáo trình này thuộc về (01/10/2026 — chủ dự án gộp màn
// /course-prerequisites vào đây). Dữ liệu vẫn gắn với Course, không phải Curriculum; ghi đi
// qua đúng ba server action cũ của /course-prerequisites (gác `courses:create`, chặn vòng lặp).
function nhan(c: { name: string; code: string | null }): string {
  return c.code ? `${c.code} · ${c.name}` : c.name;
}

export async function KhoaTienQuyet({ userId, courseId }: { userId: string; courseId: string }) {
  // Catalog LMS toàn cục — scopedDb pass-through (cùng cách trang cũ đọc).
  const sdb = scopedDb(await resolveActor(userId));
  const [coTheSua, khoa, tatCa] = await Promise.all([
    checkPermission("courses:create"),
    sdb.course.findUnique({
      where: { id: courseId },
      select: {
        name: true,
        code: true,
        prerequisites: { select: { requiredCourse: { select: { id: true, name: true, code: true } } } },
      },
    }),
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true, id: { not: courseId } },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);
  if (!khoa) return null;

  return (
    <KhoaTienQuyetForm
      courseId={courseId}
      tenKhoa={nhan(khoa)}
      dangYeuCau={khoa.prerequisites.map((p) => ({ id: p.requiredCourse.id, nhan: nhan(p.requiredCourse) }))}
      luaChon={tatCa.map((c) => ({ id: c.id, nhan: nhan(c) }))}
      coTheSua={coTheSua}
    />
  );
}
