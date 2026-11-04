// lib/lead/intake/staff-identity.ts — G-D (biên bản chốt 4 cổng, 21/08/2026).
//
// Danh tính người nhập phiếu, suy từ PHIÊN ĐĂNG NHẬP thay vì từ ô "Mã số NV"
// người dùng tự gõ.
//
// Nằm ở `lib/` chứ không nằm trong Server Action vì `app/(admin)/**` bị ESLint
// cấm import `@/lib/db` trần (cổng cách ly cơ sở). Tra `Employee` theo tài khoản
// đang đăng nhập là truy vấn về CHÍNH MÌNH, không phải dữ liệu theo cơ sở, nên
// không có gì để `scopedDb` lọc — chỗ đúng của nó là đây.
import { db } from "@/lib/db";
import type { InternalFormStaff } from "./map-internal-form";

/**
 * Trả mã nhân viên + tên hiển thị của người đang đăng nhập.
 *
 * Không tìm thấy `Employee` (tài khoản chưa gắn hồ sơ nhân sự) → `employeeCode`
 * là `null`; mapper sẽ ghi tên vào ghi chú kèm một cảnh báo, phiếu vẫn được lưu.
 * Chặn phiếu vì tài khoản chưa gắn mã là đánh đổi sai — lead quan trọng hơn.
 */
export async function getStaffIdentity(
  userId: string,
  fallbackName: string,
): Promise<InternalFormStaff> {
  const employee = await db.employee.findFirst({
    where: { userAccount: { id: userId } },
    select: { employeeCode: true },
  });
  return {
    employeeCode: employee?.employeeCode ?? null,
    displayName: fallbackName,
  };
}
