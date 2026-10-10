// app/(teacher)/teacher/kho-bai-tap/_owner.ts — CHỦ SỞ HỮU "Kho bài tập của tôi".
//
// AssignmentTemplate.createdById là CHUỖI PHẲNG (không FK — dấu vết audit). "Kho của
// tôi" lọc `where createdById = ownerId`, còn action tạo set createdById = ownerId.
// HAI GIÁ TRỊ NÀY PHẢI KHỚP, nên gom về 1 helper duy nhất:
//   ownerId = employeeId (nếu GV có hồ sơ nhân sự) else userId.
// Question.authorId thì là FK → Employee, nên chỉ set khi có employeeId (else null).
import type { scopedDb } from "@/lib/db-scope";

export interface TemplateOwner {
  /** Dùng cho AssignmentTemplate.createdById (lọc + set) — luôn có giá trị. */
  ownerId: string;
  /** Dùng cho Question.authorId (FK Employee) — null nếu GV chưa gắn hồ sơ nhân sự. */
  employeeId: string | null;
}

export async function resolveTemplateOwnerId(
  sdb: ReturnType<typeof scopedDb>,
  userId: string,
): Promise<TemplateOwner> {
  const me = await sdb.user.findUnique({
    where: { id: userId },
    select: { employeeId: true },
  });
  const employeeId = me?.employeeId ?? null;
  return { ownerId: employeeId ?? userId, employeeId };
}
