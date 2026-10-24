import type { Prisma } from "@prisma/client";

// AI THẤY ẢNH LỚP NÀO (chủ dự án chốt 01/10/2026) — áp cho thư viện admin `/media` LẪN site GV
// `/teacher/anh-lop`:
//   · người có `media:approve` (Quản lý cơ sở, Quản trị tối cao) thấy MỌI ảnh trong phạm vi lớp
//     của họ — phạm vi cơ sở do nơi gọi lo (sdb.class / assignedClassIds), hàm này không nới;
//   · mọi người khác (GV, Marketing, Giáo vụ, Sale…) chỉ thấy ảnh CHÍNH MÌNH tải lên.
// Ảnh cũ không ghi người tải lên (`uploadedById` NULL) vì vậy chỉ người duyệt còn thấy.
//
// Ranh giới lấy theo QUYỀN chứ không so tên vai (luật Nền Hệ thống #1): người duyệt ảnh phải
// thấy được ảnh cần duyệt. Tham số KHÔNG có mặc định (luật 7) — quên truyền là lỗi biên dịch,
// không phải im lặng mở toang.
export function locAnhTheoNguoiXem(p: {
  xemTatCa: boolean;
  userId: string;
}): Prisma.ClassSessionMediaWhereInput {
  return p.xemTatCa ? {} : { uploadedById: p.userId };
}
