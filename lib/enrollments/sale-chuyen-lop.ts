// lib/enrollments/sale-chuyen-lop.ts — SALE TỰ CHUYỂN LỚP CHO HỌC VIÊN CỦA MÌNH. THUẦN.
//
// Chủ dự án 21/10/2026: *"sale sau khi chốt xong thì tự xếp được vào lớp, hoặc chuyển lớp học viên của mình được để khỏi
// phải nhờ kỹ thuật hay QLCS"*. Trước đó `transferEnrollment` đòi `enrollments:transfer` — quyền chỉ Quản lý cơ sở / Quản trị tối cao có.
//
// Luật (MỘT chỗ — action, trang roster và test cùng gọi để nút hiện ra đúng là thứ server sẽ nhận, luật 12):
//   · Có `enrollments:transfer` ⇒ như cũ, KHÔNG thêm ràng buộc nào (không siết người đang chuyển được).
//   · Không có, nhưng có `enrollments:create` (Sale) ⇒ chuyển được NẾU:
//       1. học viên do chính họ PHỤ TRÁCH (`hocVienCuaSale` — Enrollment.saleId, rơi về Sale của phiếu lead);
//       2. lớp đích CÙNG KHOÁ (khác khoá = đổi mức phí — luật R6-E2 ở `lib/transfer/service.ts`);
//       3. lớp đích CÙNG CƠ SỞ (chuyển cơ sở đi màn /chuyen-lop, có duyệt);
//       4. ghi danh KHÔNG ở "Chờ xếp lớp" (PENDING): ghi danh còn chờ quyền học chốt số buổi mà bị chuyển thì dòng đơn vẫn trỏ ghi danh cũ ⇒ `xetXepLopChoDon` không xếp được nữa.
//   · Còn lại ⇒ từ chối bằng câu nói rõ vì sao.
// Điều kiện TIỀN ("đơn có ≥ 1 khoản thu ghi nhận") KHÔNG lặp ở đây: học viên đã có ghi danh vào lớp tức đã đi qua cổng tiền của bước Chuyển đổi.

export type DauVaoChuyenLop = {
  coQuyenChuyen: boolean;
  coQuyenGhiDanh: boolean;
  /** Học viên có do người thao tác phụ trách không (đã đọc ở `sale-chuyen-lop-db.ts`). */
  laHocVienCuaMinh: boolean;
  /** Ghi danh cũ đang PENDING ("Chờ xếp lớp" — quyền học chưa chốt phạm vi). */
  dangChoXepLop: boolean;
  khoaNguon: string;
  khoaDich: string;
  coSoNguon: string | null;
  coSoDich: string | null;
};

export type KetQuaXetChuyenLop =
  | { ok: true; theo: "QUAN_LY" | "SALE_CUA_MINH" }
  | { ok: false; lyDo: string };

export function xetChuyenLop(v: DauVaoChuyenLop): KetQuaXetChuyenLop {
  if (v.coQuyenChuyen) return { ok: true, theo: "QUAN_LY" };
  if (!v.coQuyenGhiDanh) return { ok: false, lyDo: "Không có quyền chuyển lớp" };
  if (!v.laHocVienCuaMinh) {
    return { ok: false, lyDo: "Bạn chỉ chuyển lớp được cho học viên do mình phụ trách — nhờ Quản lý cơ sở chuyển học viên này." };
  }
  if (v.dangChoXepLop) {
    return { ok: false, lyDo: "Học viên đang ở trạng thái Chờ xếp lớp (chờ hệ thống chốt số buổi đã mua) — chưa chuyển được; chờ xếp xong hoặc nhờ Quản lý cơ sở." };
  }
  if (v.khoaNguon !== v.khoaDich) {
    return { ok: false, lyDo: "Lớp đích khác khoá học — đổi khoá là đổi mức phí, cần Quản lý cơ sở xử lý hoặc tạo đơn mới." };
  }
  if (v.coSoNguon !== v.coSoDich) {
    return { ok: false, lyDo: "Lớp đích khác cơ sở — chuyển cơ sở đi qua màn Chuyển lớp / cơ sở (có Quản lý duyệt)." };
  }
  return { ok: true, theo: "SALE_CUA_MINH" };
}

/** Hậu tố ghi vào lý do chuyển lớp để audit nhìn là biết đây là Sale tự chuyển, không phải quản lý. */
export const HAU_TO_SALE_TU_CHUYEN = " (Sale tự chuyển — học viên do mình phụ trách)";
