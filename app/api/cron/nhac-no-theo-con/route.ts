import { NextResponse, type NextRequest } from "next/server";
import { notifyStaff } from "@/lib/notifications/notify";
import { verifyCronAuth } from "@/lib/cron/auth";
import { docNhaQuaHan } from "@/lib/finance/qua-han-db";
import { cauNhac } from "@/lib/finance/qua-han";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN G2 · US-23 AC3 — mỗi sáng nhắc SALE PHỤ TRÁCH những nhà đang quá hạn.
//
// ⚠️ **Cron này KHÔNG GHI MỘT DÒNG TIỀN NÀO** (chốt của chủ dự án). Nó đọc, gom, và bắn
// thông báo. Một cron vừa nhắc vừa ghi là một cron mà không ai dám chạy lại khi nghi ngờ —
// và "chạy lại được" chính là thứ làm cron đáng tin.
//
// ⚠️ Chống bắn trùng trong ngày (AC3) bằng `dedupeKey` khoá theo NGÀY GIỜ VN, không theo
// ngày UTC: Vercel chạy UTC, nên một cron 07:00 VN là 00:00 UTC — sát mép ngày. Lấy ngày
// UTC là hai lượt chạy cùng một buổi sáng VN có thể rơi vào hai "ngày" khác nhau và bắn hai
// lần. Cùng khuôn với cron `reserve-expiry`.
//
// ⚠️ **Nhà không suy được sale phụ trách thì KHÔNG ai nhận tin** — và con số ấy được ĐẾM và
// in ra, không lặng lẽ bỏ. Một danh sách quá hạn mà 30 nhà rơi vào khoảng trống là thứ chỉ
// lộ ra khi có người hỏi "sao tháng này không ai gọi nhà đó".
// ─────────────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD theo giờ VN (Asia/Ho_Chi_Minh). */
const ngayVN = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const doc = await docNhaQuaHan({ now });
  const ngay = ngayVN(now);

  const stats = {
    nhaQuaHan: doc.nha.length,
    daNhac: 0,
    khongCoSale: doc.khongCoSale,
    thaViBaoLuu: doc.thaViBaoLuu,
  };

  for (const nha of doc.nha) {
    if (!nha.saleUserId) continue;
    await notifyStaff({
      userIds: [nha.saleUserId],
      // Một nhà một tin một ngày. Khoá theo ĐƠN chứ không theo đợt: phụ huynh nhận một
      // cuộc gọi cho cả nhà, không phải ba cuộc cho ba đợt.
      dedupeKey: `no-qua-han:${nha.orderId}:${ngay}`,
      category: "FINANCE",
      title: `Quá hạn: ${nha.customerName || nha.orderCode}`,
      body: cauNhac(nha),
      href: `/orders/${nha.orderId}`,
      entityId: nha.orderId,
    });
    stats.daNhac++;
  }

  console.log("[cron] nhac-no-theo-con:", stats);
  return NextResponse.json({ ok: true, stats });
}
