// lib/phan-cong/chi-tiet-buoi.ts — chữ của tầng XÁC NHẬN (CONFIRMED) cho một phân công trên panel màn Phân công gộp (GĐ7). THUẦN.
//
// Ba tầng của một buổi × người:
//   · KẾ HOẠCH (PLAN)     = phân công đang sống (`SessionStaffAssignment`) — panel đã có.
//   · THỰC TẾ (ACTUAL)    = bằng chứng chấm công (`nhanBangChung`) + người đứng lớp thực (`giaoVienDuocQuyCong`) — không suy ở đây.
//   · XÁC NHẬN (CONFIRMED) = hàm này. RẼ THEO LUẬT KỲ (chốt 8): kỳ luật cũ ⇒ QLCS xác nhận từng buổi (`WorkConfirmation`, P5);
//     kỳ luật mới ⇒ công tính tự động theo ô, chỉ ghi cứng `WorkUnit` lúc CHỐT KỲ (chốt 10) — xác nhận tay bị chặn.
// Không bao giờ coi "có kế hoạch" là "đã xác nhận" (luật 12): thiếu dữ liệu nói là thiếu dữ liệu.

export type ToneXacNhan = "success" | "warning" | "danger" | "info" | "muted";
export type NhanXacNhanBuoi = { nhan: string; tone: ToneXacNhan; chiTiet: string };

export function nhanXacNhanBuoi(v: {
  luat: "CU" | "MOI";
  /** Quyết định mới nhất cho ĐÚNG phiên bản + dấu vân hiện tại (`DongDoiSoat.xacNhan`). */
  quyetDinh: "CONFIRMED" | "REJECTED" | "NEEDS_INFO" | null;
  lyDo: string | null;
  /** Đơn vị công đang sống của phân công (`DongDoiSoat.donVi`), trạng thái KHI ĐỌC. */
  donVi: "CONFIRMED" | "STALE" | "VOIDED" | null;
  /** Kỳ của ngày buổi đã chốt sổ. */
  kyKhoa: boolean;
}): NhanXacNhanBuoi {
  if (v.luat === "MOI") {
    if (v.donVi === "CONFIRMED") return { nhan: "Đã ghi công", tone: "success", chiTiet: "Kỳ luật mới — đơn vị công đã ghi cứng lúc chốt kỳ." };
    return {
      nhan: v.kyKhoa ? "Không có đơn vị công" : "Tính tự động theo ô",
      tone: v.kyKhoa ? "warning" : "info",
      chiTiet: v.kyKhoa
        ? "Kỳ đã chốt nhưng phân công này không có đơn vị công — ô thiếu lượt quét hoặc buổi chưa chốt lúc chốt kỳ. Xem Công parttime tháng."
        : "Kỳ luật mới — không xác nhận từng buổi. Công tính từ lượt quét theo ô (Công parttime tháng → Tổng hợp tự động), ghi cứng lúc chốt kỳ.",
    };
  }
  if (v.donVi === "STALE")
    return { nhan: "Xác nhận đã cũ", tone: "warning", chiTiet: "Phân công hoặc chấm công đổi sau khi xác nhận — cần xác nhận lại ở Công parttime tháng." };
  if (v.quyetDinh === "CONFIRMED") return { nhan: "Đã xác nhận", tone: "success", chiTiet: v.lyDo ? `QLCS xác nhận: ${v.lyDo}` : "QLCS đã xác nhận đã thực hiện." };
  if (v.quyetDinh === "REJECTED") return { nhan: "Không xác nhận", tone: "danger", chiTiet: v.lyDo ? `QLCS không xác nhận: ${v.lyDo}` : "QLCS không xác nhận buổi này." };
  if (v.quyetDinh === "NEEDS_INFO") return { nhan: "Cần bổ sung", tone: "warning", chiTiet: v.lyDo ? `QLCS cần thêm thông tin: ${v.lyDo}` : "QLCS cần thêm thông tin." };
  return { nhan: "Chưa xác nhận", tone: "muted", chiTiet: "Chưa ai xác nhận — QLCS xác nhận ở Công parttime tháng → Đối soát & xác nhận." };
}
