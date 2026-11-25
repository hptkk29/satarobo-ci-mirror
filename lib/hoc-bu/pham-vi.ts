// lib/hoc-bu/pham-vi.ts — PHẠM VI của người làm học bù (T10, 08/10/2026). THUẦN.
//
// Vấn đề (HB-23/24): màn `/hoc-bu` lọc "Sale chỉ thấy học viên mình phụ trách" bằng tham số `chiCuaSale` ở TRANG (đọc), còn các Server Action ghi
// (tạo case, xếp bé, gỡ, huỷ, sửa, tạo phí) gọi dịch vụ với `actor` trần — Sale có `makeup:manage` bấm thẳng action với id dòng cần bù của Sale khác
// là xếp / gỡ / thu phí được. Lọc ở giao diện không phải kiểm soát (luật 12): ranh giới phải nằm ở MÁY CHỦ.
//
// Cách làm: phạm vi đi CÙNG người gọi. Mọi hàm ghi của dịch vụ học bù nhận `NguoiHocBu` (= `Actor` + `chiCuaSale`), nên không thể gọi mà quên khai phạm vi
// (luật 7: mặc định của SCOPE phải fail-closed — ở đây KHÔNG có mặc định, `tsc` liệt kê mọi chỗ gọi).
//   · `chiCuaSale = null`  — thấy / làm được mọi học viên trong tầm nhìn cơ sở (người có `makeup:view-all`: quản lý cơ sở, quản lý lớp, quản trị).
//   · `chiCuaSale = <userId>` — chỉ học viên do Sale đó PHỤ TRÁCH (`hocVienCuaSale`).
import type { Actor } from "@/lib/auth/actor";

export type NguoiHocBu = Actor & { readonly chiCuaSale: string | null };

/** Gắn phạm vi vào người gọi. `chiCuaSale` BẮT BUỘC khai — `null` là một lựa chọn có chủ đích ("thấy hết trong tầm nhìn"), không phải mặc định. */
export function nguoiHocBu(actor: Actor, chiCuaSale: string | null): NguoiHocBu {
  return { ...actor, chiCuaSale };
}

/**
 * Phạm vi suy từ quyền — MỘT hàm, để action và test ma trận dùng chung:
 *   · không có `makeup:view-all` ⇒ Sale: chỉ học viên MÌNH phụ trách;
 *   · không có `makeup:manage` ⇒ giáo viên thường: điểm danh / đánh giá / gửi bài chỉ case MÌNH dạy (kể cả khi gọi action của admin).
 */
export function phamViTuQuyen(q: { xemTatCa: boolean; quanLy: boolean }, userId: string): { chiCuaSale: string | null; chiGv: string | undefined } {
  return { chiCuaSale: q.xemTatCa ? null : userId, chiGv: q.quanLy ? undefined : userId };
}

export const CAU_KHONG_CUA_SALE = "Học viên này không thuộc danh sách bạn phụ trách";
