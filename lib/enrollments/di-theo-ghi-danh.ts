// lib/enrollments/di-theo-ghi-danh.ts — NHỮNG GÌ ĐI THEO HỌC VIÊN khi ghi danh được thay bằng ghi danh MỚI ở lớp khác.
//
// MỘT chỗ cho hai đường chuyển: `chuyenLopTrongTx` (chuyển lớp cùng cơ sở + đổi khoá F4) và `approveTransfer` (/chuyen-lop: chuyển lớp / cơ sở có duyệt).
// Trước 21/10/2026 chỉ đường đầu đi theo; đường sau tạo ghi danh trơn ⇒ `buoiBatDau` về NULL ("học đủ khoá" — fail-open), mất sale phụ trách,
// quyền học vẫn trỏ ghi danh TRANSFERRED. Ba bản chép tay của một luật thì vá được hai bản là chuyện thường — nên tách ra.
//
// CỐ Ý KHÔNG đi theo: `leadChildId` (tín hiệu "đã chốt" của báo cáo trial-sale) và `renewedFromEnrollmentId` (chuỗi tái tục thuộc ghi danh gốc).
// CỐ Ý KHÔNG đụng `StudyEntitlement.centerId`: đó là cơ sở của ĐƠN (nơi ghi nhận doanh thu) — học viên đổi cơ sở học thì doanh thu vẫn ở cơ sở bán.
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Trạng thái quyền học còn sống — chỉ những quyền này dời theo ghi danh mới. */
export const TRANG_THAI_QUYEN_HOC_DOI_THEO = ["AWAITING_PLACEMENT", "ACTIVE", "FROZEN", "EXHAUSTED", "SEAT_HOLD"] as const;

/**
 * Hai cột ghi danh MỚI thừa hưởng từ ghi danh cũ.
 * `buoiBatDau` chỉ đi theo khi CÙNG KHOÁ: đổi khoá thì số bài của khoá cũ vô nghĩa ở khoá mới ⇒ NULL.
 */
export function diTheoGhiDanhCu(
  cu: { courseId: string; buoiBatDau: number | null; saleId: string | null },
  courseIdMoi: string,
): { buoiBatDau: number | null; saleId: string | null } {
  return { buoiBatDau: cu.courseId === courseIdMoi ? cu.buoiBatDau : null, saleId: cu.saleId };
}

/**
 * Dời quyền học CÙNG KHOÁ còn sống sang ghi danh mới + lớp mới. Quyền học trỏ mềm vào ghi danh + lớp; để nguyên thì nó vẫn trỏ ghi danh
 * TRANSFERRED ở lớp cũ (điểm danh / tiến độ đọc sai chỗ). Khác khoá = một quyền học khác, không dời.
 */
export async function doiQuyenHocSangGhiDanhMoi(
  tx: Tx,
  p: { enrollmentCuId: string; enrollmentMoiId: string; courseId: string; classId: string },
): Promise<number> {
  const r = await tx.studyEntitlement.updateMany({
    where: { enrollmentId: p.enrollmentCuId, courseId: p.courseId, status: { in: [...TRANG_THAI_QUYEN_HOC_DOI_THEO] } },
    data: { enrollmentId: p.enrollmentMoiId, classId: p.classId },
  });
  return r.count;
}
