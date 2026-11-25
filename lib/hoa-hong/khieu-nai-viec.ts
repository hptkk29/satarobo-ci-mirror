// lib/hoa-hong/khieu-nai-viec.ts — "NGƯỜI NÀY ĐƯỢC LÀM VIỆC GÌ với khiếu nại này" — MỘT hàm cho nút VẼ và cho cổng SERVER. THUẦN.
//
// Nguồn: docs/source-commission/04 §15, 06 §5.5; CLAUDE.md luật 12 ("affordance phải NÓI THẬT").
//
// Nút "Nhận xử lý" / "Giao lại" / "Quyết định" / "Đóng" chỉ được VẼ khi hàm này nói `true` — và hàm này đọc ĐÚNG những điều kiện mà `khieu-nai.ts`
// ném lỗi nếu sai (quyền duyệt · không phải người khiếu nại · trạng thái · người xử lý). Hai bên lệch nhau là một nút bấm được mà server từ chối.
// Ca `[NHH-DSP-V*]` so bảng này với hành vi THẬT của service trên Postgres (tests/hoa-hong/khieu-nai-viec.spec.ts).
import type { CachGiaiKhieuNai, TrangThaiKhieuNai } from "./khieu-nai-trang-thai";

export type VeKhieuNai = {
  status: TrangThaiKhieuNai;
  raisedByUserId: string;
  assignedToUserId: string | null;
  resolution: CachGiaiKhieuNai | null;
  /**
   * Khiếu nại đang CHỜ CẤP HAI: có đề xuất điều chỉnh ĐANG MỞ (PENDING / APPROVED_L1). Người cấp 1 đã quyết rồi; service chặn nhận · giao lại · quyết lại (`chanKhiDangChoCapHai`) nên nút KHÔNG
   * được vẽ. BẮT BUỘC khai (luật 7): quên là nút sáng mà máy chủ từ chối.
   */
  dangChoCapHai: boolean;
};

export type ViecDuocLam = {
  /** OPEN → UNDER_REVIEW, người nhận = chính mình. */
  nhan: boolean;
  /** UNDER_REVIEW và đang do NGƯỜI KHÁC xử lý → lấy về cho mình. */
  nhanLai: boolean;
  /** UNDER_REVIEW và đang do MÌNH xử lý → giao cho người khác. */
  giao: boolean;
  /** Duyệt / từ chối: chỉ người đang xử lý. */
  quyet: boolean;
  /** APPROVED theo cách "sửa nguồn": đóng khi luồng đổi nguồn đã ghi tiền. */
  dongDoiNguon: boolean;
};

const KHONG: ViecDuocLam = { nhan: false, nhanLai: false, giao: false, quyet: false, dongDoiNguon: false };

export function viecDuocLam(nguoi: { userId: string; coQuyenDuyet: boolean }, d: VeKhieuNai): ViecDuocLam {
  // Người khiếu nại không bao giờ xử lý khiếu nại của chính mình, dù giữ quyền duyệt (04 §15).
  if (!nguoi.coQuyenDuyet || d.raisedByUserId === nguoi.userId) return KHONG;
  const laNguoiXuLy = d.assignedToUserId === nguoi.userId;
  return {
    nhan: d.status === "OPEN",
    nhanLai: d.status === "UNDER_REVIEW" && !laNguoiXuLy && !d.dangChoCapHai,
    giao: d.status === "UNDER_REVIEW" && laNguoiXuLy && !d.dangChoCapHai,
    quyet: d.status === "UNDER_REVIEW" && laNguoiXuLy && !d.dangChoCapHai,
    dongDoiNguon: d.status === "APPROVED" && d.resolution === "SOURCE_CORRECTION",
  };
}
