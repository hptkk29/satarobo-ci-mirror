import { cauHinhCapQuyen } from "@/lib/elearning-online/actions";
import { chayAdminOnlineThi } from "@/lib/online-thi/admin-goi";

export const dynamic = "force-dynamic";

/** POST /api/admin/online-exam/entitlements/grant { courseId, studentId, loai: "CAP_MIEN_PHI"|"GIA_HAN", idempotencyKey (≥8), lyDo (≥10) } — cấp/cấp lại quyền học (sau thu hồi ⇒ lượt thay thế). Quyền `onl:student:grant`. Việc MUA không đi đường này (webhook → `capQuyenHoc`). */
export async function POST(req: Request) {
  return chayAdminOnlineThi(cauHinhCapQuyen, req, (than) => {
    const { lyDo, ...rest } = than ?? {};
    return { input: rest, lyDo: typeof lyDo === "string" ? lyDo : null };
  });
}
