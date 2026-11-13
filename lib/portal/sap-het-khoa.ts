// lib/portal/sap-het-khoa.ts — «Khoá của con sắp hết» cho cổng phụ huynh (12/11/2026).
//
// KHÔNG tự đếm lại: gọi ĐÚNG hàm sau tab «Sắp hết khoá» của admin (`getNearingEndEnrollments`) với ngưỡng riêng của
// cổng phụ huynh — luật 12b: hai nơi in hai con số khác nhau cho cùng một câu hỏi là bug. Ngưỡng 4 là yêu cầu của chủ
// dự án («còn 4 buổi thì báo»); ngưỡng của tab admin (setting `student.nearEndThreshold`, mặc định 5) giữ nguyên.
//
// ⚠️ ĐỊNH NGHĨA «còn lại» là của hàm đó: tổng số buổi CỦA KHOÁ (`Course.totalSessions`) trừ số buổi con đã học — không
// phải số buổi trong từng lần mua. Con mua theo phạm vi học (cờ `billing.scopePurchaseEnabled`, hiện chỉ thử ở CS2 test)
// được tính ở đường quyền học (`lib/portal/tien-do-pham-vi.ts`), chưa nối vào đây. Xem ghi chú PR.
import { getNearingEndEnrollments } from "@/lib/students/renewal";

/** Còn ≤ ngần này buổi thì báo phụ huynh (và báo Sale ở cron `nhac-sap-het-khoa`). */
export const NGUONG_SAP_HET_KHOA = 4;

export type SapHetKhoa = {
  enrollmentId: string;
  conLai: number;
  tong: number;
  tenKhoa: string;
};

/** Khoá sắp hết của MỘT học viên (ít buổi còn lại nhất); không có ⇒ null. Lỗi đọc ⇒ null (không làm sập trang tổng quan). */
export async function docSapHetKhoa(studentId: string): Promise<SapHetKhoa | null> {
  try {
    const [it] = await getNearingEndEnrollments({
      threshold: NGUONG_SAP_HET_KHOA,
      studentIds: [studentId],
    });
    if (!it) return null;
    return { enrollmentId: it.enrollmentId, conLai: it.remaining, tong: it.total, tenKhoa: it.courseName };
  } catch {
    return null;
  }
}
