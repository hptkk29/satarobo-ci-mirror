import "server-only";

import { centerIdForOrgUnit } from "@/lib/org/org-service";

/**
 * Từ ĐƠN VỊ LÀM VIỆC (OrgUnit) suy ra CƠ SỞ (Center) cho hồ sơ nhân sự.
 *
 * ─── Vì sao hàm này tồn tại ───────────────────────────────────────────────────
 * Form nhân sự (PR-C) không còn gửi `centerId`; nó gửi `orgUnitId` và ghi chú
 * "centerId suy ra ở server". Phần "suy ra ở server" **chưa từng được viết**, nên
 * người dùng chọn nơi làm việc, bấm Lưu, hệ thống báo thành công — mà
 * `Employee.centerId` vẫn nguyên giá trị cũ (thường là NULL).
 *
 * Hai hậu quả đo được trên prod 20/08/2026 (**4 người có đơn vị / 1 người có cơ sở**):
 *  1. Cột "Cơ sở" ở màn danh sách đọc `employee.center.name` ⇒ trống. Lọc theo cơ sở
 *     cũng không ra. Đúng triệu chứng "gán rồi mà không hiện".
 *  2. `Employee` ∈ `SCOPED_MODELS` và KHÔNG ∈ `NULL_IS_GLOBAL_MODELS`, nên
 *     `centerId = NULL` khiến người đó **vô hình với mọi actor cấp cơ sở** — quản lý
 *     cơ sở không thấy chính nhân sự của mình.
 *
 * ─── Đây KHÔNG phải "dựng cầu đoán đơn vị" ────────────────────────────────────
 * `centerIdForOrgUnit()` đọc THẲNG khoá ngoại `OrgUnit.centerId` (`@unique`), không
 * dùng nhánh dự phòng `OrgUnit.code = Center.code`. Cầu theo `code` là thứ QĐ-CDA-11
 * bước 4 cấm, và nó chỉ được sống trong `ORG_UNIT_FOR_CENTER_SQL`. Hàm này cũng đã
 * chạy sẵn ở màn lớp và nhóm lớp — màn nhân sự là chỗ DUY NHẤT quên gọi.
 *
 * ─── Vì sao nhân sự Hội sở KHÔNG được gán `orgUnitId` = node HO ───────────────
 * Nghe thì hợp lý, nhưng `keoTaiKhoanTheoHoSo` kéo `User.orgUnitId` theo hồ sơ, rồi
 * `reconcileUserOrgRoles` neo vai tại đúng đơn vị đó. Neo vai tại HO ⇒ `isHoLevel`
 * ⇒ **thấy mọi cơ sở**. Đó đúng là lỗ rò quyền đã phải gỡ ở US-05. Nên với người Hội
 * sở, hàm này chỉ nói "cơ sở = null" và để chỗ làm được xác định qua
 * `EmployeeOrgAssignment` như thiết kế cũ.
 */
export type KetQuaSuyCoSo = { centerId: string | null };

export async function suyCoSoTuDonVi(
  input: { isHO?: boolean; orgUnitId?: string | null },
  /** Tiêm được để test không cần DB. Mặc định là cầu THẬT (đọc khoá ngoại). */
  tra: (orgUnitId: string) => Promise<string | null> = centerIdForOrgUnit,
): Promise<KetQuaSuyCoSo | null> {
  // Nhân sự Hội sở: không thuộc cơ sở nào. Quyết định này thắng mọi giá trị khác,
  // kể cả khi form lỡ gửi kèm một đơn vị.
  if (input.isHO === true) return { centerId: null };

  // `undefined` = lời gọi này KHÔNG đụng tới đơn vị (vd đổi mỗi số điện thoại qua
  // một đường khác) ⇒ trả null để bên gọi giữ nguyên `centerId` đang có. Phân biệt
  // với `null` bên dưới: `null` là NGƯỜI DÙNG CHỦ Ý xoá đơn vị.
  if (input.orgUnitId === undefined) return null;
  if (input.orgUnitId === null) return { centerId: null };

  return { centerId: await tra(input.orgUnitId) };
}
