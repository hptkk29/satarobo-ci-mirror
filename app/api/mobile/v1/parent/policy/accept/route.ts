import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { dongYQuyDinh } from "@/lib/mobile-api/dich-vu/quy-dinh";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/policy/accept — đồng ý bản ĐANG PHÁT HÀNH (máy chủ tự lấy phiên bản; thân yêu cầu bị bỏ qua). Idempotent. Cổng C−QĐ. */
export async function POST(req: Request) {
  return chayDaDangNhap(req, async (nguoi, ctx) => {
    await dongYQuyDinh(nguoi.userId, { ip: ctx.ip, userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null });
    return traThanhCong({});
  });
}
