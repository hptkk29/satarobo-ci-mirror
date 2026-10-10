import "server-only";
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import {
  formatDayKeyDMY,
  shiftDayKey,
  vnDayKey,
  vnDayStartUtc,
} from "@/lib/students/birthday-dates";

// =============================================================================
// Sinh nhật học viên — BÁO NHÂN SỰ (pha 2 của cron student-birthday).
//
// Người nhận (chủ dự án chốt 06/08/2026):
//   • SALES_CSM + CENTER_MANAGER đang hoạt động TẠI cơ sở của học viên
//   • GIÁO VIÊN đứng buổi tổ chức — người thật sự tổ chức trong lớp
//
// Kênh: StaffNotification (chuông admin + chuông site GV dùng chung API bell),
// idempotent theo (userId, dedupeKey) — cùng mẫu lib/portal/parent-request-notify.ts.
//
// ⚠️ Mốc nhắc bám `celebrationDate`, KHÔNG bám ngày sinh nhật: buổi tổ chức có thể
// rơi TRƯỚC sinh nhật, báo theo ngày sinh nhật là báo khi buổi đã tan.
// =============================================================================

/** Vai trò nhận thông báo sinh nhật tại cơ sở — giống bộ nhận yêu cầu phụ huynh. */
const NOTIFY_ROLES = ["SALES_CSM", "CENTER_MANAGER"] as const;

export interface NotifyBirthdaysResult {
  due: number;
  notified: number;
  /** Không tìm được ai để báo (cơ sở chưa có Sale/QLCS nào đang hoạt động). */
  skippedNoRecipient: number;
}

/**
 * Đẩy thông báo cho các bản ghi sinh nhật tới hạn báo mà chưa báo lần nào.
 * Đánh dấu `staffNotifiedAt` sau khi ghi xong → cron chạy lại không dội chuông.
 */
export async function notifyUpcomingBirthdays(
  now: Date,
  cfg: { alertDaysBefore: number },
): Promise<NotifyBirthdaysResult> {
  const todayKey = vnDayKey(now);
  // Tới hạn = buổi tổ chức nằm trong [hôm nay, hôm nay + alertDaysBefore].
  // Cận dưới là ĐẦU ngày hôm nay (không phải `now`) để buổi học sáng nay vẫn được
  // báo — cron chạy 08:00 mà lớp 08:30 thì so với `now` sẽ trượt mất.
  const from = vnDayStartUtc(todayKey);
  const to = vnDayStartUtc(shiftDayKey(todayKey, cfg.alertDaysBefore + 1));

  const rows = await db.studentBirthdayGreeting.findMany({
    where: {
      staffNotifiedAt: null,
      celebratedAt: null,
      celebrationDate: { gte: from, lt: to },
    },
    select: {
      id: true,
      // studentId để gắn `entityId` cho thông báo — catalog xếp loại "birthday:" là đối
      // tượng HỌC VIÊN, nên id lượt chúc mừng không phải thứ đúng để neo vào đó.
      studentId: true,
      centerId: true,
      birthdayDate: true,
      celebrationDate: true,
      celebrationSessionId: true,
      student: { select: { name: true } },
    },
    take: 500,
  });

  const result: NotifyBirthdaysResult = {
    due: rows.length,
    notified: 0,
    skippedNoRecipient: 0,
  };

  for (const row of rows) {
    // Buổi tổ chức: lấy lớp + giáo viên thực đứng lớp. Ưu tiên dạy-thay → GV ghi
    // nhận thực tế → GV chủ nhiệm; đúng thứ tự người CÓ MẶT ở buổi đó.
    const sess = row.celebrationSessionId
      ? await db.classSession.findUnique({
          where: { id: row.celebrationSessionId },
          select: {
            substituteTeacherId: true,
            actualTeacherId: true,
            class: { select: { name: true, teacherId: true } },
          },
        })
      : null;

    const recipients = await db.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        roles: { hasSome: [...NOTIFY_ROLES] },
        // Không có cơ sở (dữ liệu cũ) → báo mọi Sale/QLCS: thà thừa còn hơn bỏ sót.
        ...(row.centerId ? { centerId: row.centerId } : {}),
      },
      select: { id: true },
    });

    const teacherId =
      sess?.substituteTeacherId ?? sess?.actualTeacherId ?? sess?.class.teacherId ?? null;

    // Map userId → href. Sale/QLCS về màn danh sách sinh nhật (có nút "Đã chúc");
    // GV về buổi học của mình. GV kiêm quản lý cơ sở chỉ nhận MỘT thông báo — Map
    // khử trùng, và nhánh dưới ưu tiên giữ link buổi học cho người đó.
    const hrefByUser = new Map<string, string>();
    for (const r of recipients) hrefByUser.set(r.id, "/sinh-nhat");
    if (teacherId) {
      hrefByUser.set(
        teacherId,
        row.celebrationSessionId ? `/sessions/${row.celebrationSessionId}` : "/sinh-nhat",
      );
    }

    if (hrefByUser.size === 0) {
      result.skippedNoRecipient++;
      // Vẫn đánh dấu đã xử lý: danh sách nhân sự không tự đổi giữa hai lần cron,
      // để trống là mỗi sáng lại quét lại đúng dòng này mà vẫn không có ai nhận.
      await db.studentBirthdayGreeting.update({
        where: { id: row.id },
        data: { staffNotifiedAt: now },
      });
      continue;
    }

    const className = sess?.class.name ?? null;
    const birthdayKey = vnDayKey(row.birthdayDate);
    const celebrationKey = row.celebrationDate ? vnDayKey(row.celebrationDate) : null;
    const birthdayStr = formatDayKeyDMY(birthdayKey);

    const body =
      celebrationKey === birthdayKey
        ? `Bé ${row.student.name} sinh nhật ${birthdayStr} — đúng hôm có buổi học${
            className ? ` lớp ${className}` : ""
          }. Chuẩn bị chúc mừng trong buổi.`
        : `Bé ${row.student.name} sinh nhật ${birthdayStr}. Hôm đó không có buổi học nên tổ chức tại buổi ${
            celebrationKey ? formatDayKeyDMY(celebrationKey) : "—"
          }${className ? ` lớp ${className}` : ""}.`;

    const dedupeKey = `birthday:${row.id}`;

    // Gom người nhận THEO href rồi gọi một lần cho mỗi href: fan-out realtime tính chi phí
    // theo từng người nhận, nên cả phòng Sale/QLCS phải đi chung một lô. Không gộp được
    // thành MỘT lời gọi duy nhất vì GV đứng buổi có đích riêng (buổi học) — đó là khác biệt
    // nghiệp vụ, không phải chi tiết kỹ thuật gộp bừa được.
    const nguoiNhanTheoHref = new Map<string, string[]>();
    for (const [userId, href] of hrefByUser) {
      const nhom = nguoiNhanTheoHref.get(href);
      if (nhom) nhom.push(userId);
      else nguoiNhanTheoHref.set(href, [userId]);
    }

    for (const [href, userIds] of nguoiNhanTheoHref) {
      result.notified += await notifyStaff({
        userIds,
        dedupeKey,
        category: "student_birthday",
        title: "🎂 Sinh nhật học viên",
        body,
        // GV trên host giaovien: /sessions/* được teacherHref map sang /lich.
        href,
        entityId: row.studentId,
        // Không `reopen`: đã báo rồi thì giữ nguyên trạng thái đọc, không kéo lại chưa-đọc.
      });
    }

    await db.studentBirthdayGreeting.update({
      where: { id: row.id },
      data: { staffNotifiedAt: now },
    });
  }

  return result;
}
