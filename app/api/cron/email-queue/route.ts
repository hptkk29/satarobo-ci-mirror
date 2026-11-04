import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { processEmailQueue } from "@/lib/email/queue";
import { doiSoatGuiHoaDon } from "@/lib/finance/hoa-don/gui-email";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { safeEqual } from "@/lib/security/safe-equal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trần thời gian một lượt (GĐ 8). Một nhịp nay làm HAI việc nối đuôi: đối soát tối đa 50 lượt gửi hoá
 * đơn (mỗi lượt một transaction) rồi gửi tối đa 25 thư — dòng hoá đơn còn ký URL tệp trước khi gửi.
 * Bật lại cờ hoá đơn sau một đợt tắt là đúng lúc lô đầy nhất. Tiền lệ khai `maxDuration`:
 * `app/api/cron/orgunit-drift/route.ts` · `app/api/cron/push-outbox/route.ts`.
 */
export const maxDuration = 60;

// Worker xử lý EmailQueue. Chạy qua cron (CRON_SECRET) HOẶC thủ công bởi admin
// có quyền emails:view. Trả về số đã gửi/lỗi.
async function authorize(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (safeEqual(header ?? "", `Bearer ${secret}`)) return true;
  }
  const session = await auth();
  return !!session?.user && (await checkPermission("emails:view"));
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // 10/08 — KẸP TRẦN. Trước đây `?limit=` đi thẳng vào `take` không chặn: một request
  // `?limit=100000` vét sạch hàng đợi trong một nhịp. Nguy hiểm vì route này nhận CẢ phiên
  // admin (`emails:view`), và hàng đợi có thể ôm email tồn nhiều ngày — bấm nhầm là cả
  // đống thư cũ bay ra khách cùng lúc. Số âm/NaN cũng phải chặn (`take: -1` làm Prisma nổ).
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;
  // Hoá đơn điện tử (PLAN §7): lượt gửi còn CHO quá 10 phút (sự kiện chết) ⇒ xếp lại TRƯỚC khi
  // worker chạy, để lượt vừa xếp đi luôn trong nhịp này. Lỗi đối soát không làm chết hàng đợi chung.
  // GĐ 8 — đọc cờ MỘT lần cho cả nhịp; đọc hỏng ⇒ coi như TẮT (giữ thư hoá đơn lại an toàn hơn gửi
  // nhầm lúc người vận hành vừa tắt), email thường vẫn đi.
  const hoaDonBat = await laHoaDonBat().catch(() => false);
  const hoaDonXepLai = await doiSoatGuiHoaDon(new Date(), { hoaDonBat }).catch(() => 0);
  const result = await processEmailQueue(limit, { guiHoaDon: hoaDonBat });
  return NextResponse.json({ ...result, hoaDonXepLai, hoaDonBat }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = GET;
