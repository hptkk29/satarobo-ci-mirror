import { checkPermission } from "@/lib/auth/check-permission";
import { ManNhapLead } from "./_components/man-nhap-lead";

/**
 * Vỏ SERVER của màn nhập lead — chỉ tồn tại để hỏi MỘT câu quyền rồi truyền xuống.
 *
 * Chủ dự án chốt 17/09/2026: cột "Đè" chỉ dành cho Quản lý cơ sở / Quản trị hệ thống.
 * Câu hỏi quyền phải ở SERVER — client không hỏi được `can()`, và tự suy từ `role` trong
 * session là đúng thứ lint `no-inline-authz` cấm (luật cứng Nền Hệ thống #1).
 *
 * ⚠️ Đây là cổng BÀY RA, không phải cổng CHẶN. Cổng chặn nằm ở
 * `POST /api/admin/import/leads` — xem khối `leads:overwrite` trong route đó.
 */
export default async function ImportLeadsPage() {
  return <ManNhapLead duocDe={await checkPermission("leads:overwrite")} />;
}
