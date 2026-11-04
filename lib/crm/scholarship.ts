// scholarship.ts — MỘT chỗ trả lời câu "ai được cấp học bổng toàn phần".
//
// VÌ SAO TÁCH RA: câu này phải trả lời ở HAI nơi — trang chốt lead (quyết định có VẼ ô
// tick không) và Server Action `submitConvertV2` (quyết định có CHO GHI không). Hai bên
// tự viết điều kiện riêng là mở đường cho chúng lệch nhau, mà kiểu lệch nguy hiểm nhất
// là "giao diện giấu ô, server vẫn nhận" — lúc đó cổng chỉ còn là trang trí.
//
// File THUẦN, không import Prisma/DB/server-only: test Vitest chạy không cần DB, và
// trang RSC lẫn Server Action đều import được cùng một luật.

/** Phần dữ liệu actor mà luật này cần — cố ý hẹp để test khỏi phải dựng cả Actor. */
export type ScholarshipActor = {
  isSuperAdmin: boolean;
};

/**
 * Được cấp học bổng toàn phần (miễn 100% học phí) không.
 *
 * CHỈ Quản trị tối cao — chốt của chủ dự án 31/08/2026. Trước đó màn chốt lead có khung
 * "Ưu đãi học phí" cho giảm theo % hoặc số tiền tuỳ ý và KHÔNG chặn vai nào: ai chốt
 * được lead là giảm được học phí bao nhiêu tuỳ thích.
 *
 * ⚠️ Hỏi `isSuperAdmin` chứ KHÔNG đẻ permission mới, có lý do vận hành: permission mới
 * bắt buộc phải chạy tay workflow `seed-prod-roles.yml` sau khi merge, quên là màn chốt
 * lead TRẮNG với mọi vai trên prod. `isSuperAdmin` có sẵn trong Actor, không phụ thuộc
 * seed, và không lệch giữa RBAC v1 (local) với v2 (prod).
 */
export function canGrantFullScholarship(actor: ScholarshipActor): boolean {
  return actor.isSuperAdmin === true;
}

/**
 * Mức giảm này có làm học phí về 0 không — tức có phải "miễn phí toàn phần" không.
 *
 * VÌ SAO CẦN: màn chốt LẺ chỉ còn ô tick nên luôn là miễn toàn phần, nhưng màn chốt
 * HÀNG LOẠT nhận ưu đãi từ dữ liệu import (`Giảm=100%` / `Giảm=9000000đ`) với mức tuỳ ý.
 * Ở đó phải phân biệt "giảm một phần" (dữ liệu thật của khách cũ, vẫn cho nhập) với
 * "miễn toàn phần" (đòi Quản trị tối cao). Không phân biệt mà khoá hết là chặn cả nghiệp
 * vụ nhập liệu lịch sử.
 *
 * ⚠️ `listPrice <= 0` KHÔNG tính là miễn học phí: lớp chưa gán giá thì không có gì để
 * miễn, và coi nó là miễn sẽ chặn oan mọi lớp chưa có giá.
 *
 * Nhận `finalPrice` ĐÃ TÍNH SẴN (thay vì tự gọi `computeEnrollmentPrice`) để file này
 * giữ được tính THUẦN: không kéo `lib/finance/pricing` + `@prisma/client` vào mọi nơi
 * import nó. Người gọi luôn đã có `finalPrice` trong tay vì phải tính giá để ghi DB.
 */
export function isFullWaiver(listPrice: number, finalPrice: number): boolean {
  return listPrice > 0 && finalPrice === 0;
}

/** Câu từ chối khi vai khác cố gửi cờ học bổng thẳng vào Server Action. */
export const SCHOLARSHIP_FORBIDDEN =
  "Chỉ Quản trị tối cao mới cấp được học bổng toàn phần.";

/**
 * Lý do ghi NHẬT KÝ cho một lượt cấp học bổng.
 *
 * Trước 31/08 đây là ô chữ người dùng tự gõ (bắt buộc ≥10 ký tự). Ô đó đã gỡ theo chốt
 * "chỉ cần ô tick", nên câu này do SERVER dựng — tên lấy từ phiên đăng nhập, không nhận
 * từ client. Trách nhiệm không mất đi: cổng vai + dòng nhật ký có tên là hai lớp thay cho
 * một ô chữ mà chính người cấp tự điền.
 *
 * `at` truyền vào (không gọi `new Date()` bên trong) để test cố định được chuỗi.
 */
export function scholarshipAuditReason(actorName: string, at: Date): string {
  return `Học bổng toàn phần — cấp bởi ${actorName} (Quản trị tối cao) lúc ${at.toISOString()}`;
}
