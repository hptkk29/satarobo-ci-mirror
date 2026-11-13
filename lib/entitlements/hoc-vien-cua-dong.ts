// lib/entitlements/hoc-vien-cua-dong.ts — "dòng đơn này là của HỌC VIÊN nào?" — THUẦN, không DB.
//
// Một chỗ quyết cho đường cấp quyền học (`cap-tu-don.ts`). Đầu vào do tầng DB đọc dưới khoá đơn; hàm này chỉ chọn.
//
// THỨ TỰ NGUỒN (mạnh → yếu), và vì sao dừng ở đâu:
//   1. `OrderItem.studentId` — người tạo đơn chọn thẳng học viên đã có hồ sơ;
//   2. `OrderItem.enrollment.studentId` — dòng đã được Chuyển đổi (`chuyen-doi/_actions.ts` ghi cả hai cột);
//   3. CẦU NỐI CON LEAD: `OrderItem.metadata.leadChildId` → ghi danh / hồ sơ học viên của ĐÚNG con ấy. Đây là đường duy
//      nhất của khách mới chốt qua `convertLeadV2` (nó tạo Student + Enrollment nhưng KHÔNG ghi `OrderItem.studentId`).
//      Chỉ nhận khi ra ĐÚNG MỘT học viên khác nhau. Không có ⇒ CHƯA CÓ. Nhiều hơn một ⇒ MƠ HỒ.
//
// KHÔNG BAO GIỜ ĐOÁN: theo tên, theo số điện thoại phụ huynh, hay "học viên mới nhất của phụ huynh". Mơ hồ thì dòng đứng ở
// hàng đợi CHO_CHUYEN_DOI kèm lý do, và người vận hành quyết.

export type NguonHocVien = "DONG_DON" | "GHI_DANH_CUA_DONG" | "CON_LEAD";

export type KetQuaHocVienCuaDong =
  | { readonly kieu: "CO"; readonly studentId: string; readonly nguon: NguonHocVien }
  | { readonly kieu: "CHUA_CO"; readonly lyDo: string }
  | { readonly kieu: "MO_HO"; readonly lyDo: string; readonly ungVien: readonly string[] };

export interface DauVaoHocVienCuaDong {
  readonly studentIdDong: string | null;
  readonly studentIdGhiDanhCuaDong: string | null;
  /** `OrderItem.metadata.leadChildId`, đã cắt khoảng trắng; `null` khi dòng không mang con lead. */
  readonly leadChildId: string | null;
  /** Học viên của các ghi danh (chưa xoá mềm) cùng `leadChildId` + cùng khoá học. Có thể trùng nhau. */
  readonly hocVienTuGhiDanhCuaCon: readonly string[];
  /** Học viên (chưa xoá mềm) có `Student.leadChildId` = con ấy. Có thể trùng nhau. */
  readonly hocVienTuHoSoCuaCon: readonly string[];
}

export function chonHocVienChoDong(v: DauVaoHocVienCuaDong): KetQuaHocVienCuaDong {
  if (v.studentIdDong) return { kieu: "CO", studentId: v.studentIdDong, nguon: "DONG_DON" };
  if (v.studentIdGhiDanhCuaDong) return { kieu: "CO", studentId: v.studentIdGhiDanhCuaDong, nguon: "GHI_DANH_CUA_DONG" };

  if (!v.leadChildId) {
    return {
      kieu: "CHUA_CO",
      lyDo: "Dòng đơn chưa gắn học viên và không mang con của phiếu lead để đối chiếu — chờ Chuyển đổi gắn học viên vào dòng.",
    };
  }
  const ungVien = [...new Set([...v.hocVienTuGhiDanhCuaCon, ...v.hocVienTuHoSoCuaCon])].sort();
  if (ungVien.length === 0) {
    return { kieu: "CHUA_CO", lyDo: "Đã đủ tiền nhưng con của phiếu lead chưa có hồ sơ học viên — chờ Chuyển đổi." };
  }
  if (ungVien.length === 1) return { kieu: "CO", studentId: ungVien[0]!, nguon: "CON_LEAD" };
  return {
    kieu: "MO_HO",
    lyDo: `Con của phiếu lead khớp ${ungVien.length} hồ sơ học viên khác nhau — người vận hành chọn đúng hồ sơ (gắn học viên vào dòng đơn) rồi hệ thống tự cấp.`,
    ungVien,
  };
}
