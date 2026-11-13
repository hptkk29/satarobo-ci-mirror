import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { verifyCronAuth } from "@/lib/cron/auth";
import { getNearingEndEnrollments } from "@/lib/students/renewal";
import { NGUONG_SAP_HET_KHOA } from "@/lib/portal/sap-het-khoa";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// 12/11/2026 — mỗi sáng nhắc SALE PHỤ TRÁCH (Enrollment.saleId) những học viên còn ≤ 4 buổi khoá để chăm sóc tái tục.
// Cùng hàm với tab «Sắp hết khoá» của admin và thẻ cảnh báo ở tổng quan phụ huynh (lib/portal/sap-het-khoa.ts).
//
// ⚠️ Cron này KHÔNG GHI gì ngoài thông báo. Chống bắn trùng bằng `dedupeKey` khoá theo ĐỢT, không theo ngày: mỗi ghi
// danh nhận TỐI ĐA hai tin — «sắp hết» (còn 3–4 buổi) và «gấp» (còn 1–2 buổi). Khoá theo ngày sẽ nhắn Sale mỗi sáng về
// cùng một em suốt cả tháng; Sale học cách bỏ qua chuông, và đó là lúc tin thật bị bỏ lỡ.
// Ghi danh không có Sale (saleId rỗng) được ĐẾM và in ra, không lặng lẽ bỏ.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const items = await getNearingEndEnrollments({ threshold: NGUONG_SAP_HET_KHOA });
  const stats = { sapHet: items.length, daNhac: 0, khongCoSale: 0 };
  if (items.length === 0) {
    console.log("[cron] nhac-sap-het-khoa:", stats);
    return NextResponse.json({ ok: true, stats });
  }

  const rows = await db.enrollment.findMany({
    where: { id: { in: items.map((i) => i.enrollmentId) } },
    select: { id: true, saleId: true },
  });
  const saleCua = new Map(rows.map((r) => [r.id, r.saleId]));

  for (const it of items) {
    const saleId = saleCua.get(it.enrollmentId);
    if (!saleId) {
      stats.khongCoSale++;
      continue;
    }
    const gap = it.remaining <= 2;
    await notifyStaff({
      userIds: [saleId],
      dedupeKey: `renewal:sap-het:${it.enrollmentId}:${gap ? "gap" : "sap"}`,
      title: `${gap ? "Gấp: " : ""}${it.studentName} sắp hết khoá`,
      body: `${it.studentName} (${it.className}) còn ${it.remaining}/${it.total} buổi. Liên hệ phụ huynh tư vấn gia hạn khoá.`,
      href: "/enrollments?tab=sap-het-khoa",
      entityId: it.enrollmentId,
    });
    stats.daNhac++;
  }

  console.log("[cron] nhac-sap-het-khoa:", stats);
  return NextResponse.json({ ok: true, stats });
}
