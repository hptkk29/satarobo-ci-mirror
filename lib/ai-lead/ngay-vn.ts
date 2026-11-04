// lib/ai-lead/ngay-vn.ts — NGÀY theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7, không đổi giờ mùa hè). THUẦN: `nowMs` là tham số.
//
// Cột `AiLeadIncident.day` là `@db.Date`. Prisma ghi Date bằng NGÀY UTC của giá trị truyền vào, nên phải truyền nửa đêm UTC của ngày VN
// (`Date.UTC(y, m, d)`) — truyền nửa đêm giờ VN sẽ lùi một ngày. Đã gặp ở 9 model `@db.Date` của repo (luật đọc số).
const BU_VN_MS = 7 * 3_600_000;

/** Nửa đêm UTC của ngày lịch Việt Nam chứa `nowMs`. */
export function ngayVnLaDate(nowMs: number): Date {
  const vn = new Date(nowMs + BU_VN_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}
