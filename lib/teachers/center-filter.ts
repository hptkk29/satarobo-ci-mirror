// Logic lọc giáo viên theo cơ sở — THUẦN (không đụng DB) để dùng chung 3 nơi:
//  - form tạo/sửa lớp (client) lọc dropdown GV theo đơn vị đang chọn,
//  - guard server-side createClass/updateClass (defense-in-depth),
//  - unit test (chạy ở CI lane mặc định, không cần DB).
// Tách khỏi lib/teachers/assignable.ts (import @/lib/db) để KHÔNG kéo Prisma vào
// client bundle. R2-RBAC-3 — cách ly CS1↔CS2 khi phân công GV.

export type TeacherCenterLite = { id: string; centerId: string | null };

/**
 * Lọc GV theo `centerId` của đơn vị đang chọn, nhưng LUÔN giữ các id trong
 * `keepIds` (GV đang chọn / đang gán sẵn của lớp) để `<Select>` không tự rớt giá
 * trị đang chọn — gốc bug "Lớp học hiện trống". `centerId == null` (đơn vị HO không
 * có cơ sở) → chỉ giữ keepIds.
 */
export function filterTeachersByCenter<T extends TeacherCenterLite>(
  teachers: T[],
  centerId: string | null,
  keepIds: (string | null | undefined)[] = [],
  hoCenterIds: string[] = [],
): T[] {
  // 06/08 — chủ dự án chốt: GẮN ĐƯỢC BẤT KỲ GV NÀO cho lớp / lịch trial, không còn
  // ràng buộc cơ sở. GV nay là nguồn lực chung, điều đi theo lịch chứ không thuộc
  // một cơ sở cố định. Tham số centerId/hoCenterIds giữ lại để không phải sửa mọi
  // nơi gọi, và để quay lại lọc dễ dàng nếu chính sách đổi.
  void centerId;
  void hoCenterIds;
  void keepIds;
  return teachers;
}

/**
 * GV chính/trợ giảng được gán có hợp lệ cho lớp ở `centerId` không. Lớp HO/không
 * cơ sở (centerId null) → không ràng buộc. Trả message lỗi (VI) hoặc null nếu OK.
 * Backfill User.centerId GV = 100% (R2-RBAC-1) nên GV centerId null = không hợp lệ
 * cho lớp có cơ sở (cũng bắt được teacherId không tồn tại → centerId undefined).
 */
export function teacherCenterAssignmentError(
  centerId: string | null,
  assigned: { id: string; centerId: string | null | undefined }[],
  hoCenterIds: string[] = [],
): string | null {
  // 06/08 — BỎ ràng buộc "GV phải cùng cơ sở với lớp" (chủ dự án chốt): GV là nguồn
  // lực chung, gắn được cho lớp/lịch trial ở mọi cơ sở. Đây là gỡ hàng rào CÓ CHỦ Ý —
  // đừng thêm lại vì tưởng thiếu sót.
  //
  // VẪN chặn: teacherId không tồn tại (centerId undefined khi tra không ra user).
  // Đây là guard chống IDOR/typo, không liên quan chính sách cơ sở.
  void centerId;
  void hoCenterIds;
  for (const t of assigned) {
    if (t.centerId === undefined) {
      return "Giáo viên/trợ giảng không hợp lệ (không tìm thấy tài khoản)";
    }
  }
  return null;
}
