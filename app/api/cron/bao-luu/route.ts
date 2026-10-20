import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { chayCronBaoLuu } from "@/lib/bao-luu/cron-chay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// /api/cron/bao-luu — 06:00 giờ VN (spec §I): START hồ sơ đã tới ngày · nhắc Sale trước hạn / đúng hạn · QUÁ HẠN · leo thang quản lý ·
// CHẤM DỨT sau hạn phản hồi · nhắc tạm dừng lớp quá ngày dự kiến. Logic ở `lib/bao-luu/cron-ke-hoach.ts` (kế hoạch thuần) +
// `cron-chay.ts` (thực thi). Idempotent; KHÔNG ghi dòng tiền; cơ sở tắt `pause.enabled` thì bị bỏ qua.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const ketQua = await chayCronBaoLuu(new Date());
  console.log("[cron] bao-luu:", ketQua);
  return NextResponse.json({ ok: true, stats: ketQua });
}
