import { cauHinhThuHoiQuyen } from "@/lib/elearning-online/actions";
import { chayAdminOnlineThi } from "@/lib/online-thi/admin-goi";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/online-exam/entitlements/revoke { courseId, studentId, idempotencyKey (≥8), lyDo (≥10) } — EX-02: Admin thu hồi quyền học. Lượt đang làm (còn hạn) ⇒ `INTERRUPTED`:
 * GIỮ bài làm đã lưu, KHÔNG chấm, KHÔNG tính trượt; cấp lại sau đó ⇒ lượt thay thế (đúng đề cũ). `loaiThuHoi="ADMIN"` do lõi E cố định ở action. Quyền `onl:student:revoke`.
 */
export async function POST(req: Request) {
  return chayAdminOnlineThi(cauHinhThuHoiQuyen, req, (than) => {
    const { lyDo, ...rest } = than ?? {};
    return { input: rest, lyDo: typeof lyDo === "string" ? lyDo : null };
  });
}
