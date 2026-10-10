// lib/bao-luu/dieu-kien-bao-luu.ts — MỘT chỗ định nghĩa "hồ sơ bảo lưu theo quy chế đang phủ ngày X" (BR-09).
//
// Cố ý KHÔNG `import "server-only"` và không import `db`: `lib/hoc-bu/dong-service.ts` (cửa tạo dòng cần bù) đọc điều kiện này TRONG giao dịch của người gọi
// (`tx.studentReserve`) và còn được spec R3 nạp, mà cấu hình R3 không có shim `server-only`. `roster-db.ts` (đọc bằng `db`) dùng CHUNG điều kiện này —
// hai nơi không được chép luật riêng, kẻo lệch (một nơi bỏ qua buổi bảo lưu, nơi kia vẫn sinh nhu cầu bù).
import type { Prisma } from "@prisma/client";

/** Hồ sơ ĐÃ DUYỆT (đời mới), bắt đầu trước/đúng `ngay`, và còn hiệu lực tại `ngay` (đang chạy chưa kết thúc, hoặc kết thúc SAU `ngay`). */
export function dieuKienBaoLuuTaiNgay(ngay: Date): Prisma.StudentReserveWhereInput {
  return {
    approvedAt: { not: null },
    startedAt: { lte: ngay },
    OR: [{ isActive: true, endedAt: null }, { endedAt: { gt: ngay } }],
  };
}
