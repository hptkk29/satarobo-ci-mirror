// lib/_handlers/account-notif.ts — R7-17 (missing trigger): consumer cho DomainEvent
// `account.activated` — phát khi tài khoản phụ huynh (PARENT) hoàn tất kích hoạt portal
// (đặt mật khẩu + accountStatus=ACTIVE). Tạo 1 Notification chào mừng vào feed học viên
// (audience=STUDENT) idempotent theo dedupeKey = "account.activated:<userId>".
// Handler không throw lan — outbox sẽ retry; resolve student/centerId qua quan hệ.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

const str = (v: unknown): string => (v == null ? "" : String(v));

// ─── account.activated → PH thấy lời chào mừng trong feed học viên ──────────────
export async function onAccountActivated(event: DomainEventLite): Promise<void> {
  const userId = str(event.payload.userId);
  if (!userId) return;

  // studentId có thể đính sẵn trong payload; nếu không, lấy HV đầu tiên của PH.
  let studentId = str(event.payload.studentId);
  let centerId: string | null;

  if (studentId) {
    const s = await db.student.findUnique({
      where: { id: studentId },
      select: { centerId: true },
    });
    centerId = s?.centerId ?? null;
  } else {
    const s = await db.student.findFirst({
      where: { parentUserId: userId },
      select: { id: true, centerId: true },
    });
    if (!s) return; // chưa có học viên nào gắn PH → không có feed để gắn thông báo
    studentId = s.id;
    centerId = s.centerId ?? null;
  }

  const dedupeKey = `account.activated:${userId}`;
  const body =
    "Tài khoản phụ huynh của bạn đã được kích hoạt. " +
    "Bạn có thể theo dõi lịch học, học phí và tiến độ học tập của con trong cổng học viên.";

  await db.notification.upsert({
    where: { dedupeKey },
    create: {
      title: "Chào mừng đến với cổng phụ huynh Sata Robo",
      body,
      audience: "STUDENT",
      studentId,
      centerId,
      createdByName: "Hệ thống",
      dedupeKey,
    },
    update: { body },
  });
}

export function registerAccountNotifHandlers(): void {
  on("account.activated", onAccountActivated);
}
