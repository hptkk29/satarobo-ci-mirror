import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { purgeExpiredOtpRecords } from "@/lib/otp/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AUTH-SĐT P0 §3.7 — dọn OtpRequest/OtpDeliveryLog quá 90 ngày (hàng ngày).
//
// Đây là bảng ghi lại MỌI lần một email/SĐT chạm hệ thống mà trước đó không có
// chính sách lưu trữ nào — 15 cron hiện có, không cron nào dọn. Khi target
// chuyển sang SĐT thì đó là dữ liệu cá nhân theo NĐ 13/2023, giữ vô thời hạn là
// rủi ro tuân thủ chứ không chỉ là rác.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await purgeExpiredOtpRecords();
  return NextResponse.json({ ok: true, data: result });
}
