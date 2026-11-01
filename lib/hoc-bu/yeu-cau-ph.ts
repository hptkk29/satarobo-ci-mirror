// lib/hoc-bu/yeu-cau-ph.ts — QLCS TẠO DÒNG CẦN BÙ THEO YÊU CẦU PHỤ HUYNH: luật THUẦN (kiểm đầu vào), dùng chung cho server action và màn hình.
//
// Chủ dự án chốt 21/10/2026: gói 12/24/36 buổi vào lớp từ buổi kế tiếp (hoặc học vượt quá trần n) KHÔNG bù gì nếu phụ huynh không yêu cầu; có yêu cầu thì
// Quản lý cơ sở là người tạo case bù, và QLCS TỰ CHỌN tính phí hay không tính phí. Dòng cần bù được tạo ở đây rồi đi tiếp đường học bù có sẵn
// (xếp case → điểm danh), không dựng đường thứ hai. Xem `NGUON_BU_YEU_CAU_PH` ở `xep-case.ts`.
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";

export type ChonPhi = "TINH_PHI" | "KHONG_TINH_PHI";

/** Số buổi tối đa tạo trong MỘT lần — chặn bấm nhầm cả khoá. */
export const TOI_DA_BUOI_MOI_YEU_CAU = 12;

export const NHAN_CHON_PHI: Record<ChonPhi, string> = {
  TINH_PHI: "Tính phí bù (không dùng lượt miễn phí)",
  KHONG_TINH_PHI: "Không tính phí (QLCS miễn phí)",
};

/** Câu từ chối đầu vào, hoặc `null` nếu hợp lệ. Lý do BẮT BUỘC cả hai nhánh: đây là quyết định tiền của QLCS và phải truy được về sau. */
export function kiemYeuCauBu(p: { soBuoi: number; chonPhi: string; lyDo: string }): string | null {
  if (p.chonPhi !== "TINH_PHI" && p.chonPhi !== "KHONG_TINH_PHI") return "Chọn tính phí hay không tính phí";
  if (!Number.isInteger(p.soBuoi) || p.soBuoi < 1) return "Chọn ít nhất một buổi cần bù";
  if (p.soBuoi > TOI_DA_BUOI_MOI_YEU_CAU) return `Mỗi lần tạo tối đa ${TOI_DA_BUOI_MOI_YEU_CAU} buổi`;
  if (p.lyDo.trim().length < LY_DO_TOI_THIEU) return `Ghi lý do / yêu cầu của phụ huynh ít nhất ${LY_DO_TOI_THIEU} ký tự`;
  return null;
}

/** Một buổi của lớp có thể đưa vào danh sách bù theo yêu cầu không (chỉ xét buổi — việc "bé có ghi danh lớp" do phía DB kiểm). */
export function buoiBuDuoc(b: { date: Date; status: string; lessonId: string | null }, now: Date): string | null {
  if (b.status === "CANCELLED") return "Buổi đã huỷ";
  if (b.date.getTime() >= now.getTime()) return "Buổi chưa diễn ra";
  if (!b.lessonId) return "Buổi chưa gắn bài — không xác định được buổi bù";
  return null;
}
