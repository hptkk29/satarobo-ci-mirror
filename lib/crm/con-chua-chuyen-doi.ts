/**
 * lib/crm/con-chua-chuyen-doi.ts — bé nào của một lead ĐÃ chuyển đổi còn được chuyển đổi (THUẦN).
 *
 * Sự cố prod 27/09/2026: convert khoá theo `Lead.convertedAt` ⇒ bé đầu đã vào học thì bé thứ
 * hai của cùng gia đình KHÔNG BAO GIỜ thành học viên được (gộp lead Phương Tuyết lộ ra ca
 * này; luật chống trùng mới — gộp phiếu bé thứ hai vào lead đã đăng ký — làm nó thành ca
 * thường).
 *
 * Một bé của lead đã chuyển đổi chỉ được coi là CHƯA thành học viên khi hội đủ CẢ BA:
 *   1. chưa có mốc chốt (`LeadChild.closedAt` null);
 *   2. không ghi danh nào / học viên nào trỏ về nó;
 *   3. được thêm vào lead SAU lần chuyển đổi đầu (`createdAt > Lead.convertedAt`).
 * Vế 3 là chốt an toàn cho dữ liệu CŨ: mốc chốt theo từng bé chỉ có từ 26/08 — bé đã vào học
 * trước đó mang mốc trống, và nếu chỉ dựa vào vế 1 thì nút "Chuyển đổi" hiện lại trên hàng
 * loạt lead cũ ⇒ đúc học viên trùng.
 */
export type ConXetChuyenDoi = {
  id: string;
  closedAt: Date | null;
  createdAt: Date;
  /** Số ghi danh có `leadChildId` = bé này. */
  soGhiDanh: number;
  /** Số học viên có `leadChildId` = bé này. */
  soHocVien: number;
};

export function conConChuyenDoiDuoc(
  leadConvertedAt: Date,
  con: readonly ConXetChuyenDoi[],
): string[] {
  return con
    .filter(
      (c) =>
        c.closedAt === null &&
        c.soGhiDanh === 0 &&
        c.soHocVien === 0 &&
        c.createdAt.getTime() > leadConvertedAt.getTime(),
    )
    .map((c) => c.id);
}
