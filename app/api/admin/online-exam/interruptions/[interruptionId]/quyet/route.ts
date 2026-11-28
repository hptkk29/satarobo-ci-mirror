import { cauHinhQuyetBoiHoan } from "@/lib/elearning-online/actions";
import { chayAdminOnlineThi } from "@/lib/online-thi/admin-goi";

export const dynamic = "force-dynamic";

/** POST /api/admin/online-exam/interruptions/:interruptionId/quyet { quyet: "DUYET"|"TU_CHOI", lyDo (≥10) } — duyệt/từ chối bồi hoàn đang chờ xem xét (PENDING_REVIEW). Quyền `onl:student:grant`. Idempotent theo quyết định. */
export async function POST(req: Request, ctx: { params: Promise<{ interruptionId: string }> }) {
  const { interruptionId } = await ctx.params;
  return chayAdminOnlineThi(cauHinhQuyetBoiHoan, req, (than) => ({ input: { ...(than ?? {}), interruptionId } }));
}
