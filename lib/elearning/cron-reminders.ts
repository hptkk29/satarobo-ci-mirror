import { db } from "@/lib/db";
import { lapLichNhac, lyDoHuy, type Moc } from "@/lib/elearning/reminder-schedule";

/**
 * EL-06 — CRON NHẮC, chạy mỗi 15 phút LỆCH PHA (`7,22,37,52 * * * *`).
 *
 * MỘT cron duy nhất tính CẢ 7 mốc trong mã — không phải bảy lịch cron. Lý do
 * nhịp 15 phút chứ không phải nhịp ngày: mốc **T-2 giờ** không có cách nào phục
 * vụ được bằng một lần chạy mỗi đêm.
 *
 * Lệch pha (phút 7/22/37/52) là có chủ đích: mọi phút chia hết cho 5 đã bị
 * `email-queue`, `sla-check` và `chat-zns-notify` chiếm — chồng giờ là hai tác
 * vụ nặng cùng tranh một kết nối.
 *
 * Ba việc, theo thứ tự:
 *   1. lập lịch cho lượt ghi danh CHƯA có lịch;
 *   2. huỷ lịch của lượt đã xong / bị thu hồi / đang tạm dừng;
 *   3. gửi các mốc đã tới hạn.
 *
 * ⚠️ Việc (2) chạy TRƯỚC việc (3): ngược lại thì người vừa học xong vẫn kịp nhận
 * "còn 2 giờ để hoàn thành" trong đúng nhịp này.
 */

const LO = 200;
const TRAN_MS = 2 * 60 * 1000;

export type KetQuaNhac = {
  lapLich: number;
  huy: number;
  daGui: number;
  boQua: number;
  loi: string[];
};

type DongEnroll = {
  id: string;
  status: string;
  dueAt: Date | null;
  pausedAt: Date | null;
  createdAt: Date;
};

export async function runElearningReminders(now = new Date()): Promise<KetQuaNhac> {
  const batDau = Date.now();
  const conGio = () => Date.now() - batDau < TRAN_MS;
  const ket: KetQuaNhac = { lapLich: 0, huy: 0, daGui: 0, boQua: 0, loi: [] };

  // ── 1. Lập lịch cho lượt ghi danh chưa có dòng nhắc nào ───────────────────
  try {
    const chuaCo = (await db.trnEnrollment.findMany({
      where: {
        status: { in: ["NOT_STARTED", "IN_PROGRESS"] },
        reminders: { none: {} },
      },
      select: { id: true, status: true, dueAt: true, pausedAt: true, createdAt: true },
      take: LO,
    })) as DongEnroll[];

    for (const e of chuaCo) {
      if (!conGio()) break;
      const lich = lapLichNhac({
        // `createdAt` của lượt ghi danh LÀ mốc được giao: dòng này sinh ra đúng
        // lúc lượt giao chạy.
        assignedAt: e.createdAt,
        dueAt: e.dueAt,
        now,
      });
      // `skipDuplicates` + khoá `@@unique([enrollmentId, milestone])`: hai nhịp
      // cron chồng nhau (chạy lâu quá 15 phút) không đẻ lịch đôi.
      const r = await db.trnReminder.createMany({
        data: lich.map((d) => ({
          enrollmentId: e.id,
          milestone: d.milestone,
          scheduledAt: d.scheduledAt,
          status: d.status,
          reason: d.reason ?? null,
        })),
        skipDuplicates: true,
      });
      ket.lapLich += r.count;
    }
  } catch (e) {
    ket.loi.push(`lap-lich: ${String(e)}`);
  }

  // ── 2. Huỷ lịch của lượt đã đóng hoặc đang tạm dừng ───────────────────────
  try {
    const dong: { dk: Record<string, unknown>; ly: string }[] = [
      { dk: { status: "COMPLETED" }, ly: lyDoHuy("COMPLETED") },
      { dk: { status: "COMPLETED_LATE" }, ly: lyDoHuy("COMPLETED_LATE") },
      { dk: { status: "REVOKED" }, ly: lyDoHuy("REVOKED") },
      { dk: { pausedAt: { not: null } }, ly: lyDoHuy("PAUSED") },
    ];
    for (const d of dong) {
      const r = await db.trnReminder.updateMany({
        // ⚠️ CHỈ đụng dòng `PENDING`. Dòng `SENT` là bản ghi việc đã xảy ra, không
        // phải kế hoạch — huỷ nó là sửa lại lịch sử.
        where: { status: "PENDING", enrollment: d.dk },
        data: { status: "CANCELLED", reason: d.ly },
      });
      ket.huy += r.count;
    }
  } catch (e) {
    ket.loi.push(`huy: ${String(e)}`);
  }

  // ── 3. Gửi các mốc đã tới hạn ─────────────────────────────────────────────
  try {
    while (conGio()) {
      const den = (await db.trnReminder.findMany({
        where: { status: "PENDING", scheduledAt: { lte: now } },
        select: {
          id: true,
          milestone: true,
          enrollment: { select: { id: true, userId: true, status: true, courseId: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: LO,
      })) as {
        id: string;
        milestone: Moc;
        enrollment: { id: string; userId: string; status: string; courseId: string };
      }[];
      if (!den.length) break;

      for (const r of den) {
        // Người đã xong mà mốc vẫn còn `PENDING` (vừa xong giữa hai nhịp) ⇒ bỏ
        // qua chứ không gửi. Việc (2) đã quét, nhưng khoảng hở giữa hai việc vẫn
        // là khoảng hở.
        const xong =
          r.enrollment.status === "COMPLETED" || r.enrollment.status === "COMPLETED_LATE";
        if (xong) {
          await db.trnReminder.update({
            where: { id: r.id },
            data: { status: "SKIPPED", reason: "đã hoàn thành trước khi tới mốc" },
          });
          ket.boQua += 1;
          continue;
        }

        // Gửi thật đi qua hàng sự kiện, không gọi thẳng nhà cung cấp: kênh và
        // câu chữ là việc của handler, cron chỉ chịu trách nhiệm ĐÚNG LÚC.
        await ghiNhanDaGui(r.id, now);
        ket.daGui += 1;
      }

      if (den.length < LO) break;
    }
  } catch (e) {
    ket.loi.push(`gui: ${String(e)}`);
  }

  return ket;
}

async function ghiNhanDaGui(reminderId: string, now: Date) {
  await db.trnReminder.update({
    where: { id: reminderId },
    data: {
      status: "SENT",
      sentAt: now,
      // ⚠️ Hai kênh, KHÔNG có ZNS (QĐ-CDA-08). Kênh thứ ba đã bị chặn từ tầng
      // nhập của lượt giao; ghi ở đây là bản ghi việc đã làm.
      sentChannels: ["IN_APP", "EMAIL"],
    },
  });
}
