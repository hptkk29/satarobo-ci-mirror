import { cauHinhLichSuGianDoan } from "@/lib/elearning-online/actions";
import { chayAdminOnlineThi } from "@/lib/online-thi/admin-goi";

export const dynamic = "force-dynamic";

/** GET /api/admin/online-exam/interruptions?courseId=…[&entitlementId=…] — lịch sử lượt bị gián đoạn khi thu hồi + bồi hoàn (không có đáp án/điểm). Quyền `onl:student:view`. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  return chayAdminOnlineThi(cauHinhLichSuGianDoan, req, () => ({ input: { courseId: u.get("courseId") ?? "", ...(u.get("entitlementId") ? { entitlementId: u.get("entitlementId") } : {}) } }), false);
}
