import type { NguoiTrongTap } from "@/lib/elearning/audience";
import type { TrangThaiGhiDanh } from "@/lib/elearning/extend-revoke";

/**
 * EL-05 — TẬP ĐỘNG: so tập người học hiện tại với tập luật, ra việc phải làm.
 *
 * Hàm thuần. Đường ĐỘNG chạy mỗi đêm và KHÔNG AI BẤM NÚT — không có màn xem
 * trước, không có ai đọc thông báo ngay lúc đó. Nên mọi quyết định ở đây phải
 * đứng vững một mình, và mọi thứ bị bỏ qua phải ĐẾM ĐƯỢC.
 */

export const LY_DO_ROI_TAP = "rời tập luật";

export type GhiDanhHienCo = {
  id: string;
  userId: string;
  status: TrangThaiGhiDanh;
};

export type ViecCanLam = {
  /** Người mới khớp luật, chưa có lượt ghi danh ⇒ tạo. */
  themMoi: NguoiTrongTap[];
  /** Rời tập ⇒ `REVOKED` + lý do "rời tập luật". */
  thuHoiId: string[];
  /**
   * Khớp luật nhưng chưa có `centerId`/tài khoản ⇒ HÀNG ĐỢI "chờ dữ liệu Nhân
   * sự": không tạo bản ghi, thử lại đêm sau, và ĐẾM ĐƯỢC.
   *
   * Đây là nhóm dễ trôi nhất của cả module: không ai bấm nút nên không ai thấy
   * thông báo, và người thiếu dữ liệu sẽ vắng mặt khỏi mọi báo cáo hết đêm này
   * sang đêm khác mà không có dấu vết nào.
   */
  choDuLieuNhanSu: NguoiTrongTap[];
};

export function soSanhTapDong(input: {
  /** Người khớp luật đêm nay, ĐÃ qua phân nhóm của `gopTapNguoiHoc`. */
  nhan: NguoiTrongTap[];
  thieuCoSo: NguoiTrongTap[];
  thieuTaiKhoan: NguoiTrongTap[];
  /** Lượt ghi danh đang có của lượt giao này. */
  hienCo: GhiDanhHienCo[];
}): ViecCanLam {
  const trongTap = new Set(
    input.nhan.map((n) => n.userId).filter((x): x is string => !!x),
  );
  const daCo = new Set(input.hienCo.map((e) => e.userId));

  const themMoi = input.nhan.filter((n) => n.userId && !daCo.has(n.userId));

  const thuHoiId = input.hienCo
    .filter((e) => {
      if (trongTap.has(e.userId)) return false;
      // ⚠️ Đã thu hồi rồi thì thôi — thu hồi lại mỗi đêm là ghi đè `revokedAt`
      // liên tục và đẩy một dòng vô nghĩa vào sổ audit mỗi 24 giờ.
      if (e.status === "REVOKED") return false;
      // ⚠️ Người ĐÃ HỌC XONG không bị thu hồi dù đã rời tập. Họ đổi phòng ban
      // sau khi học xong là chuyện bình thường; thu hồi là xoá bằng chứng của
      // một việc đã hoàn thành thật.
      if (e.status === "COMPLETED" || e.status === "COMPLETED_LATE") return false;
      return true;
    })
    .map((e) => e.id);

  // Gộp hai nhóm thiếu dữ liệu vào một hàng đợi: với người vận hành thì cả hai
  // đều là "Nhân sự phải điền thêm gì đó", và tách ra chỉ làm báo cáo dài hơn.
  const daKe = new Set<string>();
  const choDuLieuNhanSu: NguoiTrongTap[] = [];
  for (const n of [...input.thieuCoSo, ...input.thieuTaiKhoan]) {
    if (daKe.has(n.employeeId)) continue;
    daKe.add(n.employeeId);
    choDuLieuNhanSu.push(n);
  }

  return { themMoi, thuHoiId, choDuLieuNhanSu };
}
