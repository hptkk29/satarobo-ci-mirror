import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { sendZaloNotification } from "@/lib/zalo/service";
import { buildBirthdayZnsParams } from "@/lib/zalo/templates";
import { formatDayKeyDMY, shiftDayKey, vnDayKey, vnDayStartUtc } from "@/lib/students/birthday-dates";

// =============================================================================
// Sinh nhật học viên — GỬI ZNS (pha 3 của cron student-birthday).
//
// Gửi ĐÚNG NGÀY SINH NHẬT, kể cả khi buổi tổ chức trong lớp đã diễn ra trước đó:
// lời chúc gửi tới phụ huynh phải rơi đúng hôm sinh nhật của bé.
//
// Tắt an toàn theo 3 tầng, tầng nào rỗng cũng KHÔNG ném lỗi:
//   1. `student.birthdayZnsEnabled` = false → không gửi (nhắc việc vẫn chạy).
//   2. `zalo.znsTemplateBirthday` rỗng → SKIPPED (mẫu chưa được Zalo duyệt).
//   3. Thiếu credential Zalo → sendZaloNotification tự ghi SKIPPED + email dự phòng.
//
// ⚠️ Bẫy SIMULATED: có credential nhưng `ZALO_LIVE ≠ true` thì provider trả ok với
// `providerMessageId = "SIMULATED-…"` mà PHỤ HUYNH KHÔNG NHẬN GÌ. Ghi rõ trạng thái
// SIMULATED thay vì SENT — đọc nhầm là "đã chúc rồi" thì cả nhà không ai chúc bé.
// =============================================================================

export interface SendBirthdayZnsResult {
  due: number;
  sent: number;
  simulated: number;
  skipped: number;
  failed: number;
}

export async function sendBirthdayGreetings(now: Date): Promise<SendBirthdayZnsResult> {
  const todayKey = vnDayKey(now);
  const result: SendBirthdayZnsResult = {
    due: 0,
    sent: 0,
    simulated: 0,
    skipped: 0,
    failed: 0,
  };

  const [enabled, templateId] = await Promise.all([
    getSetting("student.birthdayZnsEnabled"),
    getSetting("zalo.znsTemplateBirthday"),
  ]);
  if (!enabled) return result;

  const rows = await db.studentBirthdayGreeting.findMany({
    where: {
      znsStatus: null,
      birthdayDate: {
        gte: vnDayStartUtc(todayKey),
        lt: vnDayStartUtc(shiftDayKey(todayKey, 1)),
      },
    },
    select: {
      id: true,
      birthdayDate: true,
      student: {
        select: {
          name: true,
          parentName: true,
          parentPhone: true,
          parentEmail: true,
          parentUser: { select: { email: true, name: true } },
        },
      },
    },
    take: 200,
  });
  result.due = rows.length;
  if (rows.length === 0) return result;

  for (const row of rows) {
    const s = row.student;
    const email = s.parentUser?.email ?? s.parentEmail ?? null;
    const dateText = formatDayKeyDMY(vnDayKey(row.birthdayDate));

    // Mẫu chưa duyệt / chưa cấu hình, hoặc phụ huynh không có SĐT → đánh dấu SKIPPED
    // và đi tiếp. KHÔNG để trống znsStatus: mỗi sáng cron sẽ quét lại vô ích, còn màn
    // /admin/sinh-nhat thì hiện "chưa gửi" như thể sắp gửi.
    if (!templateId || !s.parentPhone?.trim()) {
      await db.studentBirthdayGreeting.update({
        where: { id: row.id },
        data: {
          znsStatus: "SKIPPED",
          znsSentAt: now,
        },
      });
      result.skipped++;
      continue;
    }

    const res = await sendZaloNotification({
      toPhone: s.parentPhone,
      templateKey: templateId,
      params: buildBirthdayZnsParams({ studentName: s.name, dateText }),
      fallbackEmail: email
        ? {
            to: email,
            toName: s.parentUser?.name ?? s.parentName,
            subject: `Chúc mừng sinh nhật bé ${s.name}`,
            bodyText: `Sata Robo chúc mừng sinh nhật bé ${s.name} (${dateText}). Chúc con luôn khoẻ mạnh, chăm ngoan và học thật giỏi!`,
          }
        : null,
    });

    let status: string = res.status;
    if (res.status === "SENT") {
      const log = await db.zaloMessageLog.findUnique({
        where: { id: res.logId },
        select: { providerMessageId: true },
      });
      if (log?.providerMessageId?.startsWith("SIMULATED-")) {
        status = "SIMULATED";
        console.warn(
          `[birthday-zns] ZNS SIMULATED (log ${res.logId}) — phụ huynh KHÔNG nhận tin thật (ZALO_LIVE tắt).`,
        );
      }
    }

    await db.studentBirthdayGreeting.update({
      where: { id: row.id },
      data: { znsStatus: status, znsLogId: res.logId, znsSentAt: now },
    });

    if (status === "SENT") result.sent++;
    else if (status === "SIMULATED") result.simulated++;
    else if (status === "SKIPPED") result.skipped++;
    else result.failed++;
  }

  return result;
}
