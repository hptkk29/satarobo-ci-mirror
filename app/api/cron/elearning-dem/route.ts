import { type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { ok, fail } from "@/lib/api/response";
import { runElearningDem } from "@/lib/elearning/cron-dem";
import { isElearningEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

// EL-06 — cron đêm 00:47 giờ VN (`47 17 * * *` UTC). NĂM việc tuần tự:
// quá hạn → tập ĐỘNG → chứng nhận → dọn dữ liệu tầng 2 → thử lại hàng đợi.
//
// Trả `thuLai.nguoiVanKet` KÈM TÊN: đây là nhóm không ai bấm nút hộ, nên nếu
// không nêu tên thì họ vắng mặt khỏi mọi báo cáo hết đêm này sang đêm khác.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return fail("UNAUTHENTICATED", "Không có quyền gọi tác vụ nền", { status: 401 });
  }
  if (!isElearningEnabled()) return ok({ skipped: "flag OFF" });
  return ok(await runElearningDem());
}
