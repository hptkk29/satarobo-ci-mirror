// lib/parttime/cutover-luat.ts — luật THUẦN của chuyển đổi (cutover) Parttime: grace Q5 · hạn nhận lớp Q6 · cổng xác nhận tháng Q8.
// Không DB, không đồng hồ (nhận `now`). Quyết định của chủ dự án: docs/cham-cong/parttime/13-CUTOVER-DECISIONS.md.

/**
 * Q5 — LEGACY_ACTIVE_PENDING_ACCEPTANCE. Hẹp có chủ đích, đủ CẢ BA vế:
 *   · phân công NHẬP lúc cutover (`assignmentType = CUTOVER`) — phân công thường chưa nhận KHÔNG bao giờ được grace;
 *   · còn CHỜ người được phân xác nhận (`WAITING_ACCEPTANCE`) — đã nhận thì không cần grace, đã từ chối / thay / huỷ thì hết;
 *   · ngày buổi ≤ mốc grace của cơ sở (`graceDen` "YYYY-MM-DD"; rỗng = KHÔNG có grace — mặc định).
 * Grace cho CHẤM CÔNG (không cờ ngoài lịch, thẻ ngữ cảnh) — không bao giờ cho "đã nhận", xác nhận giả, hay đơn vị công việc.
 */
export function trongGraceCutover(p: { assignmentType: string; status: string; ngay: string; graceDen: string }): boolean {
  return p.assignmentType === "CUTOVER" && p.status === "WAITING_ACCEPTANCE" && /^\d{4}-\d{2}-\d{2}$/.test(p.graceDen) && p.ngay <= p.graceDen;
}

/** Q6 — kiểu hạn nhận lớp. `KHONG` (mặc định) = không hạn, KHÔNG leo thang. Chưa có cron / leo thang nào đọc hạn này. */
export const KIEU_HAN_NHAN = ["KHONG", "MOC_CO_DINH", "SAU_PHAN_CONG", "THEO_GRACE_CUTOVER"] as const;
export type KieuHanNhan = (typeof KIEU_HAN_NHAN)[number];

/**
 * Q6 — hạn chót nhận một phân công (chỉ để HIỂN THỊ / báo cáo). null = không hạn.
 *   MOC_CO_DINH        — một mốc chung (`moc` ISO, vd "2026-11-01T23:59:00+07:00");
 *   SAU_PHAN_CONG      — `soGio` giờ sau lúc phân công;
 *   THEO_GRACE_CUTOVER — hết ngày grace của cơ sở (chỉ cho phân công CUTOVER).
 * Thiếu tham số của kiểu đã chọn ⇒ null (không đoán).
 */
export function hanNhanLop(p: {
  kieu: KieuHanNhan;
  moc: string;
  soGio: number;
  graceDen: string;
  assignedAt: Date;
  assignmentType: string;
}): Date | null {
  if (p.kieu === "MOC_CO_DINH") {
    const d = new Date(p.moc);
    return p.moc && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (p.kieu === "SAU_PHAN_CONG") return p.soGio > 0 ? new Date(p.assignedAt.getTime() + p.soGio * 3_600_000) : null;
  if (p.kieu === "THEO_GRACE_CUTOVER")
    return p.assignmentType === "CUTOVER" && /^\d{4}-\d{2}-\d{2}$/.test(p.graceDen) ? new Date(`${p.graceDen}T23:59:59+07:00`) : null;
  return null;
}

/**
 * Q8 — cổng "nhân viên đã xác nhận bảng công tháng" khi chốt kỳ Parttime. `batBuoc` = `shift.parttimeXacNhanThangBatBuoc` (mặc định
 * false) ⇒ chỉ CẢNH BÁO `EMPLOYEE_NOT_CONFIRMED`, không chặn. ⚠️ CHƯA NỐI vào khoá kỳ: Parttime chưa có dữ liệu "nhân viên xác
 * nhận tháng" (khác xác nhận công P2.2 của ca thường) — nối khi chủ dự án quyết Q8 và dữ liệu có thật.
 */
export function congXacNhanThang(p: { batBuoc: boolean; chuaXacNhan: readonly string[] }): {
  chan: boolean;
  canhBao: { ma: "EMPLOYEE_NOT_CONFIRMED"; userId: string }[];
} {
  const canhBao = p.chuaXacNhan.map((userId) => ({ ma: "EMPLOYEE_NOT_CONFIRMED" as const, userId }));
  return { chan: p.batBuoc && canhBao.length > 0, canhBao };
}
