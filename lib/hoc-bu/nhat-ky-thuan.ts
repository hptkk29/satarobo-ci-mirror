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
  DUYET_CASE: { khoa: "hoc-bu.duyet-case", y: "Quản lý cơ sở duyệt case chờ duyệt (do Sale tạo) ⇒ lịch thật; có thể đổi giáo viên / phòng lúc duyệt", lyDo: false },
  TU_CHOI_CASE: { khoa: "hoc-bu.tu-choi-case", y: "Quản lý cơ sở TỪ CHỐI case chờ duyệt — case huỷ, các bé quay lại danh sách cần bù", lyDo: true },
  RUT_CASE: { khoa: "hoc-bu.rut-case", y: "Người tạo RÚT LẠI case còn chờ duyệt", lyDo: false },
  // ── Thêm học viên khác vào case có sẵn phải qua quản lý cơ sở duyệt (24/10/2026) — thực thể là LÔ yêu cầu (batchId) ──
  GUI_YEU_CAU_THEM_BE: { khoa: "hoc-bu.gui-yeu-cau-them-be", y: "Người không có quyền duyệt xin thêm học viên khác vào case có sẵn — case chưa đổi, chờ quản lý cơ sở duyệt", lyDo: false },
  DUYET_THEM_BE: { khoa: "hoc-bu.duyet-them-be", y: "Quản lý cơ sở DUYỆT yêu cầu thêm học viên vào case ⇒ các bé được xếp vào case (đi đúng đường xếp trực tiếp)", lyDo: false },
  TU_CHOI_THEM_BE: { khoa: "hoc-bu.tu-choi-them-be", y: "Quản lý cơ sở TỪ CHỐI yêu cầu thêm học viên vào case — case giữ nguyên, các dòng vẫn ở danh sách cần bù", lyDo: true },
  RUT_THEM_BE: { khoa: "hoc-bu.rut-them-be", y: "Người gửi RÚT LẠI yêu cầu thêm học viên vào case còn chờ duyệt", lyDo: false },
  HUY_YEU_CAU_THEM_BE: { khoa: "hoc-bu.huy-yeu-cau-them-be", y: "Yêu cầu thêm học viên đang chờ bị đóng vì case bị huỷ (hệ thống tự làm, cùng giao dịch huỷ case)", lyDo: true },
  DOI_TRANG_THAI_CASE: { khoa: "hoc-bu.doi-trang-thai-case", y: "Case đổi trạng thái (hoàn thành · không ai đến · huỷ vì hết bé · đảo khi sửa điểm danh)", lyDo: false },
  // ── Điểm danh · đánh giá ──
  DIEM_DANH_BE: { khoa: "hoc-bu.diem-danh-be", y: "Điểm danh lần đầu một bé (có mặt / vắng) kèm kết quả từng bài", lyDo: false },
  SUA_DIEM_DANH_BE: { khoa: "hoc-bu.sua-diem-danh-be", y: "Sửa điểm danh một bé (đảo lượt, đổi kết quả bài)", lyDo: true },
  DIEM_DANH_GHI_DE: { khoa: "hoc-bu.diem-danh-ghi-de-qua-han", y: "Điểm danh quá cửa sổ giờ — ghi đè có lý do", lyDo: true },
  DANH_GIA_MUC: { khoa: "hoc-bu.danh-gia-muc", y: "Ghi / sửa đánh giá của giáo viên cho một bài", lyDo: false },
  // ── Phí · miễn phí · huỷ dòng ──
  TAO_THEO_YEU_CAU: { khoa: "hoc-bu.tao-theo-yeu-cau", y: "Quản lý cơ sở tạo dòng cần bù cho buổi đã bỏ qua THEO YÊU CẦU phụ huynh, chọn tính phí / không tính phí", lyDo: true },
  CAP_THEM_LUOT: { khoa: "hoc-bu.cap-them-luot", y: "Quản lý cơ sở cấp THÊM lượt học bù cho một học viên (cộng dồn từng lần, bút toán ADJUSTMENT trong sổ lượt)", lyDo: true },
  KHONG_CAN_BU: { khoa: "hoc-bu.khong-can-bu", y: "Quản lý cơ sở chọn \"Không cần bù\" cho buổi vắng ở màn điểm danh (bắt buộc lý do) — dòng cần bù đang chờ (chưa xếp case) được thu hồi. Thực thể là bản ghi điểm danh", lyDo: true },
  GIAM_LUOT: { khoa: "hoc-bu.giam-luot", y: "Quản lý cơ sở GIẢM lượt học bù của một học viên (chỉ phần còn trống; bút toán ADJUSTMENT âm trong sổ lượt)", lyDo: true },
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
  NANG_CAP_CASE: { khoa: "hoc-bu.nang-cap-case", y: "Nâng một case đời cũ lên mô hình nhiều bài (nút ở màn chi tiết)", lyDo: false },
  SUA_DU_LIEU: { khoa: "hoc-bu.sua-du-lieu", y: "Script sửa dữ liệu học bù (T15): một dòng mỗi bản ghi được sửa, kèm bằng chứng và luật gốc của checker", lyDo: true },
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
