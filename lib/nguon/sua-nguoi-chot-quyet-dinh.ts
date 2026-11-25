// lib/nguon/sua-nguoi-chot-quyet-dinh.ts — QUYẾT ĐỊNH CỦA OWNER cho từng lead cụ thể trong «sửa Lead.convertedById legacy». THUẦN: chỉ kiểu + bảng dữ liệu.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY (23/10/2026)
//
// Sau đợt GHI đầu (81 lead, run 39892378712) còn 7 lead mà luật suy từ bằng chứng KHÔNG quyết được:
//   · 3 lead mà file Excel gọi tên «Toại» (Trưởng phòng Đào tạo) — chỉ MỘT nguồn (Excel «Sales» và `assignedToId` cùng gốc);
//   · 4 lead «ngoài mẫu» — không qua BACKFILL_IMPORT mà do tài khoản quản trị bấm chuyển đổi.
// Owner đã ĐỌC bằng chứng từng lead và quyết định (nguyên văn bảng dưới). Quyết định của owner là NGUỒN SỰ THẬT cho 7 lead này — planner KHÔNG suy lại.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUY ƯỚC
//
//   · Người nhận được chọn bằng `maNhanVien` (= `Employee.employeeCode`), KHÔNG bằng id cuid (khác nhau giữa DB test/dev/prod) và KHÔNG bằng tên hiển thị
//     (đo PROD 23/10: «Diệu» có 3 tài khoản — một Sale, một giáo viên, một phụ huynh). Planner giải ra `User.id` từ dữ liệu hệ thống và PHẢI ra đúng MỘT
//     người, là Sale hợp lệ, cùng cơ sở với lead/đơn — không thì dòng INVALID ⇒ cổng ghi từ chối cả lượt (fail-closed).
//   · Bảng này nằm TRONG MÃ nên đi qua review + merge của owner; kết quả (dòng kế hoạch) lại được owner KÝ Ed25519 như mọi dòng khác.
//   · Chỉ đổi `Lead.convertedById`. Không đụng `convertedAt`, `assignedToId`, `CommissionLine`, `CommissionTransaction`.
//   · Tối đa MỘT quyết định cho mỗi lead (trùng ⇒ planner ném lỗi). Lead không nằm trong bảng KHÔNG bao giờ bị bảng này chạm tới.

/** Chọn người nhận theo mã nhân viên (`Employee.employeeCode`). */
export type NguoiNhanQuyetDinh = { maNhanVien: string };

export type QuyetDinhOwner =
  | { leadId: string; hanhDong: "DOI_NGUOI_CHOT"; nguoiNhan: NguoiNhanQuyetDinh }
  | { leadId: string; hanhDong: "GIU_NGUYEN" };

/** Diệu — Sale CS1 (SALES_CSM). */
export const MA_NV_DIEU = "CS1.NV.002";
/** Vân — Sale CS2 (SALES_CSM). */
export const MA_NV_VAN = "CS2.NV.002";

/**
 * 7 quyết định của owner chốt 23/10/2026 (sắp theo leadId). Đọc cùng bảng bằng chứng ở báo cáo «7 lead chưa quyết định»:
 *   cmshf1vr2… · cmshf1vr3… · cmshf1w50…  — lead «Toại» (BACKFILL_IMPORT, Excel gọi tên Toại, không có bằng chứng độc lập) ⇒ đổi sang Diệu
 *   cmskk6cs…                              — Admin tạo/gán tay/chuyển đổi, assignedTo là Diệu                                   ⇒ đổi sang Diệu
 *   cmtbi8ee…                              — Kiệt chuyển đổi, lead legacy-sheet gán Diệu                                         ⇒ đổi sang Diệu
 *   cmtbdd55f…                             — 0đ (học bổng toàn phần), Kiệt chuyển đổi                                           ⇒ GIỮ NGUYÊN
 *   cmvah7qgn…                             — Vân làm toàn bộ rồi Kiệt bấm chốt                                                  ⇒ đổi sang Vân
 */
export const QUYET_DINH_OWNER_2310: readonly QuyetDinhOwner[] = [
  { leadId: "cmshf1vr20002adw1i5tfsyrh", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } },
  { leadId: "cmshf1vr30006adw16giej2mz", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } },
  { leadId: "cmshf1w50001wadw1rop4509k", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } },
  { leadId: "cmskk6cs000013to4a5vmn0kd", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } },
  { leadId: "cmtbdd55f000112xdhdmlk4e8", hanhDong: "GIU_NGUYEN" },
  { leadId: "cmtbi8ee1000b59896lbuoqhk", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } },
  { leadId: "cmvah7qgn06qhpb042hp2br4e", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_VAN } },
];
