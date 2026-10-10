import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron/auth";
import { sendZaloNotification } from "@/lib/zalo/service";
import { getSetting } from "@/lib/settings/service";
import { effectiveReminderDays, isReminderDue, overdueBucket, remindOverdueInstallments } from "@/lib/finance/debt";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";

const ZNS_TEMPLATE_DEBT = process.env.ZALO_ZNS_TEMPLATE_DEBT || null;

// R7-04 — nhắc công nợ ĐỢT 2 theo PER-ROW reminderDays (QĐ-O7): mỗi đợt nhắc khi
// `dueDate − (reminderDays ?? default) ≤ hôm nay`, tiếp tục đến khi đóng đủ. Gửi qua
// ZALO OA (khi cấu hình) + fallback EMAIL. Chống spam: tối đa 1 nhắc/ngày/đợt (lastReminderAt).
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Số ngày nhắc trước hạn MẶC ĐỊNH — SystemSetting "finance.debtReminderDaysBefore" (14).
  const defaultDays = await getSetting("finance.debtReminderDaysBefore");
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Lấy mọi đợt CHƯA THU còn PENDING (per-row reminderDays quyết định đã đến hạn nhắc chưa).
  //
  // ⚠️ ĐÃ GỠ `soDot: 2` [14/09/2026]. Bộ lọc đó là một trần 2 đợt giấu trong cron: kế
  // hoạch 3-4 đợt thì đợt 3 và 4 KHÔNG BAO GIỜ được nhắc, và khoản đó lặng lẽ quá hạn mà
  // không ai gọi cho phụ huynh. Đợt nào chưa thu và có hạn thì đều phải nhắc — số thứ tự
  // của đợt không nói gì về việc đó.
  //
  // `dueDate: { not: null }` ngay dưới là thứ giữ cho lượt quét không ôm đợt đã thu
  // (đợt `daThu` được ghi với `dueDate: null`).
  const candidates = await db.orderInstallment.findMany({
    where: {
      status: "PENDING",
      dueDate: { not: null },
      order: { status: { notIn: ["CANCELLED", "REFUNDED"] } },
    },
    select: {
      id: true,
      amount: true,
      dueDate: true,
      reminderDays: true,
      lastReminderAt: true,
      order: {
        select: {
          code: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          totalAmount: true,
          studentId: true,
          centerId: true,
          items: { select: { itemName: true }, take: 1 },
        },
      },
    },
    take: 500,
  });

  const stats = {
    found: candidates.length,
    sent: 0,
    skippedNotDue: 0,
    skippedToday: 0,
    skippedNoChannel: 0,
  };

  for (const inst of candidates) {
    // Chưa tới mốc nhắc (per-row X) → bỏ qua.
    const days = effectiveReminderDays(inst.reminderDays, defaultDays);
    if (!isReminderDue(inst.dueDate, days, now)) {
      stats.skippedNotDue++;
      continue;
    }

    // R7-17 — thông báo in-app khi đợt đã QUÁ HẠN (dueDate < hôm nay). Độc lập kênh
    // email/Zalo: chỉ THÊM Notification cho portal PH, không đổi logic gửi email cũ.
    // Idempotent 1/ngày qua dedupeKey. Chỉ bắn khi có studentId (không broadcast nợ
    // cá nhân ra ALL_PARENTS — tránh lộ PII công nợ).
    if (overdueBucket(inst.dueDate, now) !== "none" && inst.order.studentId) {
      const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const dedupeKey = `debt.overdue:${inst.id}:${day}`;
      const overdueAmount = inst.amount.toLocaleString("vi-VN");
      await db.notification
        .upsert({
          where: { dedupeKey },
          create: {
            title: "Công nợ quá hạn",
            body: `Công nợ quá hạn: ${overdueAmount}đ (đơn ${inst.order.code}). Quý phụ huynh vui lòng hoàn tất thanh toán.`,
            audience: "STUDENT",
            studentId: inst.order.studentId,
            centerId: inst.order.centerId ?? null,
            createdByName: "Hệ thống",
            dedupeKey,
          },
          update: { body: `Công nợ quá hạn: ${overdueAmount}đ (đơn ${inst.order.code}). Quý phụ huynh vui lòng hoàn tất thanh toán.` },
        })
        .catch(() => {});
    }

    // Đã nhắc hôm nay rồi → bỏ qua.
    if (inst.lastReminderAt && inst.lastReminderAt >= startOfToday) {
      stats.skippedToday++;
      continue;
    }
    const email = inst.order.customerEmail?.trim() || null;
    const phone = inst.order.customerPhone?.trim() || null;
    if (!email && !phone) {
      stats.skippedNoChannel++;
      continue;
    }
    const due = inst.dueDate ? formatDateVN(inst.dueDate) : "";
    const courseName = inst.order.items[0]?.itemName ?? "khoá học";
    const amountStr = inst.amount.toLocaleString("vi-VN");
    const bodyText = `Kính gửi ${inst.order.customerName ?? "Quý phụ huynh"},\nĐơn ${inst.order.code} (${courseName}) còn ${amountStr}đ học phí đợt 2, hạn đóng ${due}.\nQuý phụ huynh vui lòng hoàn tất trước hạn. Xin cảm ơn.\n— Sata Robo`;

    // Zalo OA khi đã cấu hình; chưa có → fallback EMAIL (chạy ngay).
    await sendZaloNotification({
      toPhone: phone ?? "",
      templateKey: ZNS_TEMPLATE_DEBT,
      params: { order: inst.order.code, amount: amountStr, due, course: courseName },
      fallbackEmail: email
        ? { to: email, toName: inst.order.customerName, subject: `Nhắc đóng học phí đợt 2 — đơn ${inst.order.code}`, bodyText }
        : null,
    }).catch(() => {});

    await db.orderInstallment.update({ where: { id: inst.id }, data: { lastReminderAt: now } });
    stats.sent++;
  }

  // R7 P2 — nhắc nợ qua emailQueue (enqueueDebtReminder) cho MỌI đợt trả góp đến hạn
  // (đợt 1 + đợt 2), set lastReminderAt. Chạy SAU vòng Zalo ở trên: nếu đợt 2 vừa được
  // nhắc + set lastReminderAt thì hàm này skip (chống gửi trùng cùng ngày).
  const installmentReminders = await remindOverdueInstallments({ now, defaultReminderDays: defaultDays });

  console.log("[cron] debt-reminder:", stats, "installments:", installmentReminders);
  return NextResponse.json({ ok: true, stats, installmentReminders });
}
