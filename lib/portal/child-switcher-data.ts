import "server-only";
import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";

// Portal v2 — dữ liệu switcher "Chế độ Phụ huynh / các con" ở topbar.
// Nhẹ: chỉ id + name + tên khóa học đang học (để hiện subtitle) — KHÔNG kéo
// attendance/debt như getParentChildrenOverview (chạy ở mọi page qua layout).

const ACTIVE = GHI_DANH_DANG_HOC; // lib/portal/trang-thai-ghi-danh.ts

export type SwitcherChild = {
  id: string;
  name: string;
  initials: string;
  courseName: string | null;
  active: boolean;
};

function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter((x) => /\p{L}/u.test(x[0] ?? ""));
  return (w.slice(-2).map((x) => x[0]).join("") || "HS").toUpperCase();
}

export async function getSwitcherChildren(
  parentUserId: string,
  activeStudentId: string | null,
): Promise<SwitcherChild[]> {
  const students = await db.student.findMany({
    where: { parentUserId, deletedAt: null },
    // 06/09 — CÙNG thứ tự với `getChildren` (lib/portal/session.ts sắp theo `name asc`).
    // Con MẶC ĐỊNH là `children[0]` của danh sách đó, nên hai nguồn sắp khác nhau thì
    // con được chọn sẵn lại không phải con đứng đầu trong bộ chuyển — trông như hệ
    // thống chọn nhầm con.
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      enrollments: {
        where: { status: { in: [...ACTIVE] }, deletedAt: null },
        orderBy: { enrolledAt: "desc" },
        take: 1,
        select: { course: { select: { name: true } } },
      },
    },
  });

  return students.map((s) => ({
    id: s.id,
    name: s.name,
    initials: initialsOf(s.name),
    courseName: s.enrollments[0]?.course?.name ?? null,
    active: s.id === activeStudentId,
  }));
}
