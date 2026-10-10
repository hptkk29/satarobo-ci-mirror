import { db } from "@/lib/db";

export type AssignableTeacher = {
  id: string;
  name: string | null;
  role: string;
  centerId: string | null;
};

/**
 * Nguồn DUY NHẤT xác định "giáo viên có thể phân lớp" (fix #9 — trước đây mỗi form
 * lọc một kiểu: trang Lớp học dùng `roles hasSome [TEACHER, CENTER_MANAGER]` nên
 * lọt quản lý/sale; trang Lớp trải nghiệm dùng `roles has TEACHER` strict nên chỉ
 * thấy 2 người).
 *
 * Điều kiện 1 user là giáo viên hợp lệ:
 *  - active + chưa xoá, VÀ
 *  - (có role TEACHER trong roles[]  HOẶC  có TeacherProfile status = ACTIVE).
 *
 * KHÔNG gồm người chỉ là CENTER_MANAGER/SALES_CSM thuần. Người đa vai trò mà CÓ
 * TEACHER vẫn xuất hiện.
 *
 * @param opts.includeIds  luôn kèm các user id này (vd: GV đang được gán vào lớp
 *   dù dữ liệu của họ không còn match điều kiện) để `<Select>` không tự rớt giá
 *   trị đang chọn — đây là gốc của bug "gán từ trang Giáo viên nhưng Lớp học hiện
 *   trống".
 * @param opts.centerIds  (FL-R2 W4 / R2-RBAC-2) chỉ lấy GV thuộc các cơ sở này —
 *   cách ly cơ sở: tạo lớp CS1 KHÔNG được thấy GV CS2 (TBD-1: không kiêm nhiệm →
 *   lọc thuần theo `User.centerId`). Rỗng/không truyền = mọi cơ sở (vd SUPER_ADMIN).
 *   `includeIds` LUÔN được kèm bất kể cơ sở (giữ GV đang gán selectable).
 */
export async function getAssignableTeachers(opts?: {
  includeIds?: (string | null | undefined)[];
  centerIds?: (string | null | undefined)[];
}): Promise<AssignableTeacher[]> {
  const includeIds = (opts?.includeIds ?? []).filter(Boolean) as string[];
  const centerIds = (opts?.centerIds ?? []).filter(Boolean) as string[];
  const centerWhere = centerIds.length ? { centerId: { in: centerIds } } : {};

  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { isActive: true, roles: { has: "TEACHER" }, ...centerWhere },
        { isActive: true, teacherProfile: { is: { status: "ACTIVE" } }, ...centerWhere },
        ...(includeIds.length ? [{ id: { in: includeIds } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true, centerId: true },
  });

  return rows;
}
