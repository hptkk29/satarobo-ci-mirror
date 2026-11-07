import { checkPermission } from "@/lib/auth/check-permission";
import { loadNguonChoFormNhap } from "@/lib/nguon/nguon-cho-form-nhap";
import { ManNhapLead } from "./_components/man-nhap-lead";

// Đọc cờ nguồn + danh mục nguồn lúc yêu cầu (cổng chặn thật ở route; trang chỉ bày ô chọn) — cùng cách `nhap-khach-hang/page.tsx`.
export const dynamic = "force-dynamic";

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
  // 28/10/2026 — «Nguồn của cả file»: `null` (module Nguồn TẮT) ⇒ màn không vẽ ô chọn, đường nhập chạy như cũ. Cổng chặn thật ở `POST /api/admin/import/leads`.
  const [duocDe, nguon] = await Promise.all([
    checkPermission("leads:overwrite"),
    loadNguonChoFormNhap([], new Date()),
  ]);
  return <ManNhapLead duocDe={duocDe} nguon={nguon} />;
}
