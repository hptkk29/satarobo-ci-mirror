// lib/entitlements/ghi-danh-cua-dong.ts — "DÒNG ĐƠN NÀY ĐƯỢC XẾP VÀO LỚP QUA GHI DANH NÀO?" — THUẦN, không DB.
//
// Một chỗ quyết cho đường xếp lớp (`xep-lop-tu-don.ts`), cùng tinh thần `hoc-vien-cua-dong.ts`. Đầu vào do tầng DB đọc; hàm này chỉ chọn.
//
// THỨ TỰ NGUỒN (mạnh → yếu), và vì sao dừng ở đâu:
//   1. `OrderItem.enrollmentId` — `chuyenDoiDonAction` ghi cả hai cột (studentId + enrollmentId) cùng lúc;
//   2. CẦU NỐI CON LEAD: ghi danh do `convertLeadV2` tạo mang `Enrollment.leadChildId` = `OrderItem.metadata.leadChildId` (convert KHÔNG ghi
//      `OrderItem.enrollmentId`). Chỉ nhận khi ra ĐÚNG MỘT ghi danh còn sống, cùng khoá, cùng học viên của quyền học. Nhiều hơn một ⇒ MƠ HỒ.
//
// KHÔNG BAO GIỜ ĐOÁN: không theo tên, không theo "ghi danh mới nhất của học viên", không theo (học viên, khoá) một mình. Hai quyền học mua
// tiếp của cùng một học viên + khoá cùng khớp (học viên, khoá) với MỘT ghi danh — nối theo cặp đó là nối quyền học của lần mua sau vào lớp
// của lần mua trước. Ghi danh KHÔNG có cầu nối ⇒ CHUA_CO, người vận hành quyết (Chuyển đổi / gắn tay).

/** Ghi danh còn "sống" cho mục đích xếp lớp: chưa xoá mềm và đang học / chờ học. PAUSED (bảo lưu), COMPLETED, WITHDREW, TRANSFERRED, CANCELLED ⇒ không. */
export const TRANG_THAI_GHI_DANH_SONG = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"] as const;

export interface GhiDanhUngVien {
  readonly id: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly classId: string;
  readonly status: string;
  readonly deletedAt: Date | null;
}

export type NguonGhiDanh = "DONG_DON" | "CON_LEAD";

export type KetQuaGhiDanhCuaDong =
  | { readonly kieu: "CO"; readonly ghiDanh: GhiDanhUngVien; readonly nguon: NguonGhiDanh }
  /**
   * Chưa có ghi danh nào để xếp. `canXem = false`: trạng thái CHỜ BÌNH THƯỜNG (chưa Chuyển đổi / chưa ghi danh vào lớp) — không ai phải làm gì ngoài việc
   * xếp lớp, nên KHÔNG mở dòng hàng đợi. `canXem = true`: dòng ĐÃ gắn ghi danh mà ghi danh ấy hỏng / lệch khoá / lệch học viên — người vận hành phải xem.
   */
  | { readonly kieu: "CHUA_CO"; readonly lyDo: string; readonly canXem: boolean }
  | { readonly kieu: "MO_HO"; readonly lyDo: string; readonly ungVien: readonly string[] };

export interface DauVaoGhiDanhCuaDong {
  /** Khoá của dòng (quyền học nếu đã có, không thì `hinhThuc.courseId`). */
  readonly courseId: string;
  /** Học viên của QUYỀN HỌC; `null` khi dòng chưa có quyền học (khi đó không lọc theo học viên). */
  readonly studentId: string | null;
  /** `OrderItem.enrollmentId` và hàng ghi danh tương ứng (`null` nếu không đọc được hàng — ghi danh đã xoá hẳn). */
  readonly enrollmentIdCuaDong: string | null;
  readonly ghiDanhCuaDong: GhiDanhUngVien | null;
  /** `OrderItem.metadata.leadChildId`, đã cắt khoảng trắng. */
  readonly leadChildId: string | null;
  /** Ghi danh mang đúng `leadChildId` ấy. Có thể chứa cả ghi danh đã chết / khác khoá — hàm này lọc. */
  readonly ghiDanhCuaCon: readonly GhiDanhUngVien[];
}

const song = (g: GhiDanhUngVien): boolean => g.deletedAt === null && (TRANG_THAI_GHI_DANH_SONG as readonly string[]).includes(g.status);

export function chonGhiDanhChoDong(v: DauVaoGhiDanhCuaDong): KetQuaGhiDanhCuaDong {
  if (v.enrollmentIdCuaDong) {
    const g = v.ghiDanhCuaDong;
    if (!g || g.id !== v.enrollmentIdCuaDong) {
      return { kieu: "CHUA_CO", canXem: true, lyDo: "Ghi danh gắn với dòng đơn không còn tồn tại — Chuyển đổi lại để gắn ghi danh mới." };
    }
    if (!song(g)) {
      return { kieu: "CHUA_CO", canXem: true, lyDo: `Ghi danh gắn với dòng đơn không còn hiệu lực (trạng thái ${g.status}${g.deletedAt ? ", đã xoá" : ""}) — chưa xếp lớp theo quyền học.` };
    }
    if (g.courseId !== v.courseId) {
      return { kieu: "CHUA_CO", canXem: true, lyDo: "Ghi danh gắn với dòng đơn thuộc khoá khác với khoá của dòng — không xếp lớp, cần người vận hành kiểm tra." };
    }
    if (v.studentId !== null && g.studentId !== v.studentId) {
      return { kieu: "CHUA_CO", canXem: true, lyDo: "Ghi danh gắn với dòng đơn thuộc học viên khác với học viên của quyền học — không xếp lớp, cần người vận hành kiểm tra." };
    }
    return { kieu: "CO", ghiDanh: g, nguon: "DONG_DON" };
  }

  if (!v.leadChildId) {
    return { kieu: "CHUA_CO", canXem: false, lyDo: "Dòng đơn chưa gắn ghi danh và không mang con của phiếu lead để đối chiếu — Chuyển đổi hoặc xếp lớp xong thì hệ thống tự chốt phạm vi." };
  }
  const ungVien = v.ghiDanhCuaCon.filter((g) => song(g) && g.courseId === v.courseId && (v.studentId === null || g.studentId === v.studentId));
  if (ungVien.length === 0) {
    return { kieu: "CHUA_CO", canXem: false, lyDo: "Con của phiếu lead chưa có ghi danh còn hiệu lực cùng khoá và cùng học viên với quyền học — chờ xếp lớp." };
  }
  if (ungVien.length === 1) return { kieu: "CO", ghiDanh: ungVien[0]!, nguon: "CON_LEAD" };
  return {
    kieu: "MO_HO",
    lyDo: `Con của phiếu lead khớp ${ungVien.length} ghi danh còn hiệu lực cùng khoá — người vận hành chọn đúng ghi danh (gắn vào dòng đơn) rồi hệ thống tự chốt phạm vi.`,
    ungVien: ungVien.map((g) => g.id).sort(),
  };
}
