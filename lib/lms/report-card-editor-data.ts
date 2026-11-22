// lib/lms/report-card-editor-data.ts — #06 (L6): data helper cho màn "Học bạ" site GV.
//
// Hai đoạn đọc RAW db này vốn nằm INLINE trong trang admin
// app/(admin)/admin/report-cards/[enrollmentId]/page.tsx (db.reportCard.findUnique +
// db.classSession.count) và CHƯA có hàm lib tương đương. Trang teacher
// (app/(teacher)/**) KHÔNG được import @/lib/db trần (ESLint R6-F1) → tách thành
// helper lib (raw db hợp lệ ở lib/**). KHÔNG sửa trang admin — admin giữ inline
// như cũ; teacher dùng helper này để data assembly Y HỆT.
//
// ⚠️ CALL-SITE PHẢI GÁC SCOPE TRƯỚC KHI GỌI (checkEnrollmentScope hoặc
// enrollment.classId ∈ actor.assignedClassIds) — helper đọc raw KHÔNG tự cách ly
// cơ sở, y hệt đường đọc của trang admin (dựa checkEnrollmentScope; xem carve-out
// câu 20 ở lib/lms/report-card-core — ĐỪNG migrate sang scopedDb, sẽ giết carve-out).
import "server-only";
import { db } from "@/lib/db";

/** Bản ghi học bạ cho form editor (mirror SELECT inline của trang admin). */
export interface ReportCardEditorRecord {
  status: string;
  finalComment: string | null;
  completionStatus: string | null;
  periodComments: unknown;
  publishedAt: Date | null;
  scores: { criterionId: string; level: number; note: string | null }[];
}

/** Học bạ (nếu đã có) của 1 ghi danh — null = chưa nhập lần nào (sẽ tạo DRAFT khi lưu). */
export async function getReportCardEditorRecord(
  enrollmentId: string,
): Promise<ReportCardEditorRecord | null> {
  return db.reportCard.findUnique({
    where: { enrollmentId },
    select: {
      status: true,
      finalComment: true,
      completionStatus: true,
      periodComments: true,
      publishedAt: true,
      scores: { select: { criterionId: true, level: true, note: true } },
    },
  });
}

/**
 * Số buổi lớp ĐÃ hoàn tất — "đạt buổi N" cho mốc kỳ 5/12 (#17 Gap 1, câu 55:
 * ClassSession không có số thứ tự buổi nên đếm buổi COMPLETED; CANCELLED không tính).
 */
export async function countCompletedClassSessions(classId: string): Promise<number> {
  return db.classSession.count({ where: { classId, status: "COMPLETED" } });
}
