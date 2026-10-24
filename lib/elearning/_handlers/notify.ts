import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { on, type DomainEventLite } from "@/lib/events/registry";

/**
 * EL-06 — THÔNG BÁO của module đào tạo nội bộ.
 *
 * Hai kênh: **in-app + email công ty**. KHÔNG có Zalo ZNS (QĐ-CDA-08 bỏ hẳn).
 *
 * ⚠️ Khoảng trống CÓ TÊN, không giấu: người không mở email trong ngày thì mốc
 * nhắc **T-2 giờ** không chạm tới được. Bù bằng in-app — nên chuông nhân viên
 * chuyển từ *nên có* thành **bắt buộc** ở ticket này.
 *
 * ⚠️ Handler phải IDEMPOTENT: `dispatch-events` chạy lại sự kiện khi handler ném
 * lỗi giữa chừng. `notifyStaff` chống trùng bằng `dedupeKey`, nên mọi khoá dưới
 * đây đều suy từ id bản ghi chứ không từ thời gian.
 */

const str = (v: unknown): string => (v == null ? "" : String(v));

const ngayVN = (d: Date | null) =>
  d
    ? d.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

type ThongTinLuot = {
  id: string;
  userId: string;
  dueAt: Date | null;
  snapManagerUserId: string | null;
  courseTitle: string;
};

async function docLuot(enrollmentId: string): Promise<ThongTinLuot | null> {
  const e = await db.trnEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, userId: true, dueAt: true, snapManagerUserId: true, courseId: true },
  });
  if (!e) return null;
  const c = await db.trnCourse.findUnique({
    where: { id: e.courseId },
    select: { title: true },
  });
  return {
    id: e.id,
    userId: e.userId,
    dueAt: e.dueAt,
    snapManagerUserId: e.snapManagerUserId,
    // Khoá bị xoá mềm vẫn phải gọi được tên: thông báo "bạn được giao khoá
    // undefined" tệ hơn hẳn một cái tên cũ.
    courseTitle: c?.title ?? "khoá đào tạo nội bộ",
  };
}

/** "Bạn vừa được giao khoá X, hạn Y." */
export async function onEnrollmentCreated(event: DomainEventLite): Promise<void> {
  const id = str(event.payload.enrollmentId);
  if (!id) return;
  const e = await docLuot(id);
  if (!e) return;

  const han = ngayVN(e.dueAt);
  await notifyStaff({
    userIds: [e.userId],
    dedupeKey: `el.enr:${e.id}`,
    title: `Bạn được giao khoá "${e.courseTitle}"`,
    body: han
      ? `Hạn hoàn thành: ${han}.`
      : "Khoá này không đặt hạn — bạn chủ động sắp xếp thời gian.",
    href: `/elearning/hoc/${e.id}`,
    entityId: e.id,
  });
}

/**
 * "Đã quá hạn" — báo BA nhóm: người học, quản lý trực tiếp, phòng Đào tạo.
 *
 * ⚠️ Đường `snapManagerUserId` nay CHẠY THẬT (prod 13/15 có `Employee.managerId`)
 * — trước đây nó được coi là cột rỗng. Người chưa gán quản lý thì bỏ nhánh đó,
 * KHÔNG bỏ luôn thông báo cho người học.
 */
export async function onEnrollmentOverdue(event: DomainEventLite): Promise<void> {
  const id = str(event.payload.enrollmentId);
  if (!id) return;
  const e = await docLuot(id);
  if (!e) return;

  const han = ngayVN(e.dueAt);
  await notifyStaff({
    userIds: [e.userId],
    dedupeKey: `el.over:${e.id}:hoc-vien`,
    title: `Quá hạn khoá "${e.courseTitle}"`,
    body: han
      ? `Hạn là ${han}. Vào học tiếp hoặc liên hệ phòng Đào tạo để xin gia hạn.`
      : "Vào học tiếp hoặc liên hệ phòng Đào tạo.",
    href: `/elearning/hoc/${e.id}`,
    entityId: e.id,
  });

  if (e.snapManagerUserId) {
    // Tách khoá chống trùng theo NHÓM NGƯỜI NHẬN: dùng chung một khoá thì nhóm
    // thứ hai bị coi là trùng và không ai nhận.
    await notifyStaff({
      userIds: [e.snapManagerUserId],
      dedupeKey: `el.over:${e.id}:quan-ly`,
      title: `Nhân sự của bạn quá hạn khoá "${e.courseTitle}"`,
      body: "Xem chi tiết trong khu đào tạo nội bộ.",
      href: "/elearning",
      entityId: e.id,
    });
  }

  const daoTao = await userIdCuaVai("TRAINING");
  if (daoTao.length) {
    await notifyStaff({
      userIds: daoTao,
      dedupeKey: `el.over:${e.id}:dao-tao`,
      title: `Có lượt học quá hạn: "${e.courseTitle}"`,
      body: "Xem danh sách quá hạn trong báo cáo tuân thủ.",
      href: "/elearning/bao-cao",
      entityId: e.id,
    });
  }
}

/** Hoàn thành — chúc mừng người học; phần chứng nhận thuộc EL-16. */
export async function onEnrollmentCompleted(event: DomainEventLite): Promise<void> {
  const id = str(event.payload.enrollmentId);
  if (!id) return;
  const e = await docLuot(id);
  if (!e) return;

  await notifyStaff({
    userIds: [e.userId],
    dedupeKey: `el.done:${e.id}`,
    title: `Hoàn thành khoá "${e.courseTitle}"`,
    body: "Cảm ơn bạn đã hoàn thành đúng yêu cầu.",
    href: "/elearning",
    entityId: e.id,
  });
}

/**
 * Người mang một vai, tra theo `User.role` HOẶC `User.roles[]`.
 *
 * ⚠️ Phải soi CẢ HAI: `roles[]` là mảng đa vai và quyền là hợp, nên chỉ soi
 * `role` chính sẽ bỏ sót người kiêm nhiệm — đúng nhóm hay bị bỏ sót nhất.
 */
/**
 * Tài khoản đang hoạt động mang một vai.
 *
 * Xuất ra để `grader-reminder.ts` dùng lại — chép sang là dựng bản thứ hai của
 * cùng phép tra, và hai bản sẽ trôi khỏi nhau đúng ngày ai đó đổi cách lưu vai.
 */
export async function userIdCuaVai(vai: "TRAINING"): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: vai }, { roles: { has: vai } }],
    },
    select: { id: true },
    take: 50,
  });
  return rows.map((r) => r.id);
}

export function registerElearningNotifyHandlers(): void {
  on("elearning.enrollment.created", onEnrollmentCreated);
  on("elearning.enrollment.overdue", onEnrollmentOverdue);
  on("elearning.enrollment.completed", onEnrollmentCompleted);
}
