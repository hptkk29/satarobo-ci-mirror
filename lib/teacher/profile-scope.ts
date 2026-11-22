// lib/teacher/profile-scope.ts — hồ sơ học viên đang xem LỚP NÀO.
//
// Vì sao file này tồn tại (QA site GV vòng 1, BUG-003 — nguyên nhân gốc RC-4):
// hợp đồng URL của trang hồ sơ chỉ có `{s, ptab}`. Sau guard IDOR, trang bơm TẤT CẢ
// lớp em đó còn ghi danh vào 3/4 tab, nên một em học 5 lớp thuộc 4 khoá cho ra 43 dòng
// điểm danh của 4 lớp trộn vào MỘT dòng thời gian phẳng — "Buổi 1" xuất hiện ba lần
// khác nhau, tên lớp chỉ là dòng phụ mờ. Tab Nhận xét trộn 16 phiếu của 3 lớp.
//
// Tab Học bạ thoát vì nó lặp theo TỪNG ghi danh — đó là mô hình đúng, file này đưa nó
// sang ba tab còn lại mà không phải viết lại từng tab.
//
// PURE — không DB, không "use server".

/** Một lớp em đang/đã ghi danh, đủ để dựng chip chọn lớp. */
export type ProfileClassRef = {
  classId: string;
  className: string;
  courseName: string;
};

export type ProfileScope = {
  /** Lớp đang xem; `null` = xem tất cả. */
  activeClassId: string | null;
  /** classIds mà các tab được phép đọc — một phần tử khi đã chọn lớp. */
  classIds: string[];
  /** Danh sách chip, đã khử trùng và sắp xếp tất định. */
  chips: ProfileClassRef[];
  /** Người gọi đưa `classId` lạ (không thuộc hồ sơ này) — đã hạ về xem tất cả. */
  rejected: boolean;
};

/**
 * Quyết định phạm vi của hồ sơ.
 *
 * ⚠️ CHỐT IDOR: `classId` đến từ URL nên KHÔNG được tin. Lớp không nằm trong danh sách
 * ghi danh của chính em này thì HẠ CẤP về "xem tất cả" (`rejected: true`) chứ không
 * ném lỗi — người dùng lỡ giữ link cũ sau khi em chuyển lớp vẫn xem được hồ sơ, chỉ là
 * không lọc theo lớp lạ. Tuyệt đối không dùng thẳng `classId` này để truy vấn.
 *
 * ⚠️ Khử trùng theo `classId`, KHÔNG theo tên: `Class.name` không unique trong schema
 * (chỉ `classCode` unique). Gộp theo tên thì hai lớp trùng tên thành một chip và bấm
 * vào lọc nhầm lớp.
 */
export function resolveProfileScope(
  enrollments: ProfileClassRef[],
  requestedClassId: string | null | undefined,
): ProfileScope {
  const byId = new Map<string, ProfileClassRef>();
  for (const e of enrollments) {
    // Một em có thể có HAI ghi danh trong cùng một lớp (học lại, chuyển đợt) — chip
    // vẫn phải là một.
    if (!byId.has(e.classId)) byId.set(e.classId, e);
  }
  // Sắp tất định: theo tên khoá rồi tên lớp rồi id. Có `classId` ở cuối để hai lớp
  // TRÙNG TÊN vẫn ra thứ tự cố định — nếu không, đảo thứ tự đầu vào là đảo thứ tự chip
  // và người dùng thấy chip nhảy chỗ giữa hai lần tải trang.
  const chips = [...byId.values()].sort(
    (a, b) =>
      a.courseName.localeCompare(b.courseName, "vi") ||
      a.className.localeCompare(b.className, "vi") ||
      a.classId.localeCompare(b.classId),
  );

  const wanted = requestedClassId?.trim() || null;
  const ok = wanted != null && byId.has(wanted);
  return {
    activeClassId: ok ? wanted : null,
    classIds: ok ? [wanted] : chips.map((c) => c.classId),
    chips,
    rejected: wanted != null && !ok,
  };
}

/**
 * Đường dẫn của một tab, MANG THEO lớp đang xem.
 *
 * ⚠️ `ProfileTabBar` dựng href dạng chỉ-query (`?s=…&ptab=…`) nên MỌI tham số ngữ cảnh
 * thêm vào sẽ rơi mất khi đổi tab nếu không ghép ở đây. Đó đúng là cách bộ lọc biến
 * mất giữa chừng.
 */
export function profileTabHref(args: {
  studentId: string;
  tab: string;
  activeClassId: string | null;
}): string {
  const q = new URLSearchParams({ s: args.studentId, ptab: args.tab });
  if (args.activeClassId) q.set("classId", args.activeClassId);
  return `?${q.toString()}`;
}
