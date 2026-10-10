// lib/hoc-bu/nhat-ky-thuan.ts — DANH SÁCH ĐÓNG các hành động học bù được ghi nhật ký (T14). THUẦN, không DB.
//
// Mỗi hành động = một phép GHI nghiệp vụ. Khoá = tên dùng ở AuditLog (`action`), giá trị = ý nghĩa + có BẮT BUỘC lý do không + ai ghi (để lưới
// `[NKW-*]` đối chiếu với mã nguồn). Thêm phép ghi mới = thêm một dòng ở đây, KHÔNG có đường nào khác ghi `module: "hoc-bu"`.
export const HANH_DONG = {
  // ── Xếp lịch ──
  TAO_CASE: { khoa: "hoc-bu.tao-case", y: "Tạo case dạy bù và xếp các bé vào", lyDo: false },
  XEP_VAO_CASE: { khoa: "hoc-bu.xep-vao-case", y: "Xếp thêm bé / thêm bài vào case có sẵn", lyDo: false },
  SUA_CASE: { khoa: "hoc-bu.sua-case", y: "Sửa ngày · giờ · giáo viên · phòng · bộ bài của case chưa điểm danh", lyDo: false },
  GO_MUC: { khoa: "hoc-bu.go-muc-khoi-case", y: "Gỡ một mục (một bài của một bé) khỏi case chưa điểm danh", lyDo: false },
  HUY_CASE: { khoa: "hoc-bu.huy-case", y: "Huỷ case chưa điểm danh", lyDo: false },
  DOI_TRANG_THAI_CASE: { khoa: "hoc-bu.doi-trang-thai-case", y: "Case đổi trạng thái (hoàn thành · không ai đến · huỷ vì hết bé · đảo khi sửa điểm danh)", lyDo: false },
  // ── Điểm danh · đánh giá ──
  DIEM_DANH_BE: { khoa: "hoc-bu.diem-danh-be", y: "Điểm danh lần đầu một bé (có mặt / vắng) kèm kết quả từng bài", lyDo: false },
  SUA_DIEM_DANH_BE: { khoa: "hoc-bu.sua-diem-danh-be", y: "Sửa điểm danh một bé (đảo lượt, đổi kết quả bài)", lyDo: true },
  DIEM_DANH_GHI_DE: { khoa: "hoc-bu.diem-danh-ghi-de-qua-han", y: "Điểm danh quá cửa sổ giờ — ghi đè có lý do", lyDo: true },
  DANH_GIA_MUC: { khoa: "hoc-bu.danh-gia-muc", y: "Ghi / sửa đánh giá của giáo viên cho một bài", lyDo: false },
  // ── Phí · miễn phí · huỷ dòng ──
  TAO_PHI: { khoa: "hoc-bu.tao-phi", y: "Tạo đơn phí học bù cho dòng hết lượt", lyDo: false },
  MIEN_PHI: { khoa: "hoc-bu.mien-phi", y: "Miễn phí ngoại lệ cho một dòng (huỷ đơn phí chưa thu nếu có)", lyDo: true },
  GO_MIEN_PHI: { khoa: "hoc-bu.go-mien-phi", y: "Gỡ miễn phí ngoại lệ", lyDo: true },
  HUY_DONG: { khoa: "hoc-bu.huy-dong", y: "Huỷ không bù một dòng cần bù", lyDo: true },
  KHOI_PHUC_DONG: { khoa: "hoc-bu.khoi-phuc-dong", y: "Khôi phục dòng đã huỷ không bù", lyDo: false },
  // ── Dây chuyền (cascade) — hệ thống tự làm, người dùng không bấm ──
  GO_VI_PHI_BI_LOAI: { khoa: "hoc-bu.go-khoi-case-vi-phi-bi-loai", y: "Gỡ bé chưa điểm danh khỏi case vì đơn phí bị huỷ/hoàn", lyDo: true },
  PHI_BI_LOAI_SAU_BU: { khoa: "hoc-bu.phi-bi-loai-sau-khi-bu", y: "Đơn phí bị huỷ/hoàn sau khi bé đã bù xong — ngoại lệ tài chính", lyDo: true },
  GO_VI_PHI_THIEU: { khoa: "hoc-bu.go-khoi-case-vi-phi-thieu", y: "Gỡ bé chưa điểm danh khỏi case vì phí đã thu bị hoàn một phần (thu thiếu)", lyDo: true },
  PHI_THIEU_SAU_BU: { khoa: "hoc-bu.phi-thieu-sau-khi-bu", y: "Phí thu thiếu do hoàn một phần sau khi bé đã bù xong — ngoại lệ tài chính", lyDo: true },
  CONG_SAU_CHOT_KY: { khoa: "hoc-bu.cong-day-sau-chot-ky", y: "Case hoàn thành SAU khi kỳ công của tháng đó đã chốt — công dạy chưa nằm trong bản chốt", lyDo: true },
} as const;

export type HanhDongKey = keyof typeof HANH_DONG;
export type HanhDong = (typeof HANH_DONG)[HanhDongKey]["khoa"];

/** Mọi khoá hành động — cho lưới đối chiếu. */
export const KHOA_HANH_DONG: readonly HanhDong[] = Object.values(HANH_DONG).map((h) => h.khoa);

/** Hành động có BẮT BUỘC lý do (người dùng nhập hoặc hệ thống ghi nguyên nhân). */
export function canLyDo(khoa: string): boolean {
  return Object.values(HANH_DONG).some((h) => h.khoa === khoa && h.lyDo);
}
