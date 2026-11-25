// lib/parttime/cham-theo-phan-cong.ts — MỘT câu hỏi, MỘT chỗ: "công của người này NGÀY này có tính theo PHÂN CÔNG không?". THUẦN.
//
// Chủ dự án chốt 08/11/2026 (trong chat): từ 01/11/2026 giáo viên parttime chấm công HOÀN TOÀN theo phân công trên hệ thống (QLCS phân
// công tay = xác nhận) — tiết đứng chính / trợ giảng, ca trực đủ / nửa, hỗ trợ Trial, đúng phép tính "Lương dự kiến" của màn Phân công.
// Công theo ô ca S/C/T (lịch rảnh) BỎ HẲN cho nhóm này; lượt quét chỉ còn là bằng chứng.
//
//   · "GV parttime" = `Employee.contractType === "PARTTIME"` (đo prod 08/11: SR.NV.007…019). FULLTIME có đứng lớp (SR.NV.004/005) KHÔNG
//     vào nhóm — họ giữ công ô ca HC như cũ. Thiếu hồ sơ nhân sự / chưa khai loại hợp đồng ⇒ KHÔNG vào nhóm (giữ đường cũ, không đoán).
//   · MỐC = cài đặt `shift.parttimeLuatCongMoiTuKy` (mặc định 2026-11-01) hỏi qua `luatNgay` — CÙNG hàm mọi cổng luật công mới dùng, nên
//     sàn 01/11/2026 và "để trống = tắt" là của chung. KHÔNG có hằng số mốc thứ hai.
//
// Mọi màn (Bảng công ngày admin · Bảng công site GV · Bảng công tháng) hỏi hàm này — đừng viết lại điều kiện tại chỗ.
import type { ContractType } from "@prisma/client";
import { luatNgay } from "@/lib/phan-cong/cong-o";

export function chamTheoPhanCong(p: {
  /** `Employee.contractType` của người đó; null = không có hồ sơ / chưa khai. BẮT BUỘC (luật 7). */
  contractType: ContractType | null;
  /** "YYYY-MM-DD" giờ VN. */
  ngay: string;
  /** Giá trị THÔ của `shift.parttimeLuatCongMoiTuKy` (`docKyLuatMoi`). BẮT BUỘC (luật 7) — không hàm thuần nào tự đọc cài đặt. */
  tuKy: string | null;
}): boolean {
  return p.contractType === "PARTTIME" && luatNgay(p.ngay, p.tuKy) === "MOI";
}
