// lib/_handlers/r7-notifications.ts — R7-17 (slice): consumer cho các DomainEvent
// R7 đã được PRODUCE nhưng chưa có handler (payment.confirmed, class.session_changed,
// lead.trialAttended). Tạo thông báo idempotent (dedupeKey) cho PH (Notification —
// portal feed) và nhân viên (StaffNotification — inbox admin).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyStaff } from "@/lib/notifications/notify";
import { formatVndPlain } from "@/lib/format/money";
import { donCanGhiDanh } from "@/lib/finance/can-ghi-danh";

const str = (v: unknown): string => (v == null ? "" : String(v));

// ─── payment.confirmed → PH thấy khoản đã xác nhận (AC2 R7-04) ────────────────
export async function onPaymentConfirmed(event: DomainEventLite): Promise<void> {
  const paymentId = str(event.payload.paymentId);
  const enrollmentId = str(event.payload.enrollmentId);
  const orderId = str(event.payload.orderId);
  const amount = Number(event.payload.amount ?? 0);
  const receiptCode = str(event.payload.receiptCode);
  if (!paymentId) return;

  const nguoiNhan = enrollmentId
    ? await nguoiNhanTheoGhiDanh(enrollmentId)
    : orderId
      ? await nguoiNhanTheoDonKhongGhiDanh(orderId)
      : null;
  if (!nguoiNhan) return;

  const body =
    `Trung tâm đã xác nhận khoản thanh toán ${formatVndPlain(amount, false)}` +
    (nguoiNhan.noiDung ? ` cho ${nguoiNhan.noiDung}` : "") +
    "." +
    (receiptCode ? ` Phiếu thu: ${receiptCode}.` : "");
  await db.notification.upsert({
    where: { dedupeKey: `payment.confirmed:${paymentId}` },
    create: {
      title: "Đã xác nhận thanh toán",
      body,
      audience: "STUDENT",
      studentId: nguoiNhan.studentId,
      centerId: nguoiNhan.centerId,
      createdByName: "Hệ thống",
      dedupeKey: `payment.confirmed:${paymentId}`,
    },
    update: { body },
  });
}

type NguoiNhanXacNhan = { studentId: string; centerId: string | null; noiDung: string | null };

async function nguoiNhanTheoGhiDanh(enrollmentId: string): Promise<NguoiNhanXacNhan | null> {
  const enr = await db.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null }, // FIX-C3
    select: { studentId: true, student: { select: { centerId: true } } },
  });
  if (!enr?.studentId) return null;
  return { studentId: enr.studentId, centerId: enr.student?.centerId ?? null, noiDung: null };
}

/**
 * Khoản KHÔNG gắn ghi danh (29/09/2026): chỉ đơn KIT / THI mới xác nhận được như vậy — hỏi CÙNG
 * `donCanGhiDanh` với lõi xác nhận; đơn COURSE / loại lạ ⇒ không báo (giữ hành vi cũ, fail-closed).
 * Học viên lấy theo ĐƠN (`Order.studentId`, trống thì học viên DUY NHẤT của các dòng đơn — nhiều
 * em khác nhau ⇒ không đoán). Nội dung nêu tên dòng đơn thay cho khoá học.
 */
async function nguoiNhanTheoDonKhongGhiDanh(orderId: string): Promise<NguoiNhanXacNhan | null> {
  const don = await db.order.findUnique({
    where: { id: orderId },
    select: {
      type: true,
      studentId: true,
      centerId: true,
      student: { select: { centerId: true } },
      items: { select: { itemName: true, studentId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!don || donCanGhiDanh(don.type)) return null;
  const hvDong = [...new Set(don.items.map((i) => i.studentId).filter((v): v is string => !!v))];
  const studentId = don.studentId ?? (hvDong.length === 1 ? hvDong[0]! : null);
  if (!studentId) return null;
  const tenDong = [...new Set(don.items.map((i) => i.itemName.trim()).filter(Boolean))];
  return {
    studentId,
    centerId: don.student?.centerId ?? don.centerId ?? null,
    noiDung: tenDong.length ? tenDong.join(", ") : null,
  };
}

// ─── payment.rejected → PH thấy khoản bị từ chối (AC3 R7-04) ──────────────────
export async function onPaymentRejected(event: DomainEventLite): Promise<void> {
  const paymentId = str(event.payload.paymentId);
  const enrollmentId = str(event.payload.enrollmentId);
  const amount = Number(event.payload.amount ?? 0);
  const reason = str(event.payload.reason);
  if (!paymentId || !enrollmentId) return;

  const enr = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { studentId: true, student: { select: { centerId: true } } },
  });
  if (!enr?.studentId) return;

  const body =
    `Khoản thanh toán ${formatVndPlain(amount, false)} chưa được xác nhận.` +
    (reason ? ` Lý do: ${reason}.` : "") +
    " Vui lòng liên hệ trung tâm để được hỗ trợ.";
  await db.notification.upsert({
    where: { dedupeKey: `payment.rejected:${paymentId}` },
    create: {
      title: "Thanh toán cần xem lại",
      body,
      audience: "STUDENT",
      studentId: enr.studentId,
      centerId: enr.student?.centerId ?? null,
      createdByName: "Hệ thống",
      dedupeKey: `payment.rejected:${paymentId}`,
    },
    update: { body },
  });
}

// ─── class.session_changed → PH lớp + GV (AC5/AC6 R7-06) ──────────────────────
const CHANGE_LABEL: Record<string, string> = {
  CANCELLED: "có buổi bị huỷ (đã sắp buổi bù)",
  RESCHEDULED: "đã được dời lịch",
  ADJUSTED: "có buổi được điều chỉnh",
  // Đợt 11 đơn từ — huỷ đơn "Nghỉ buổi dạy" đã duyệt: buổi gốc học lại, buổi bù đã sắp bị gỡ.
  RESTORED: "có buổi được học lại như lịch cũ (buổi bù đã sắp được gỡ)",
};

export async function onClassSessionChanged(event: DomainEventLite): Promise<void> {
  const classId = str(event.payload.classId);
  if (!classId) return;
  const change = str(event.payload.change) || "ADJUSTED";
  const what = CHANGE_LABEL[change] ?? "có thay đổi lịch";

  const cls = await db.class.findUnique({
    where: { id: classId },
    select: { name: true, centerId: true, teacherId: true },
  });
  if (!cls) return;

  // PH của lớp (audience=CLASS) — idempotent theo event.id.
  await db.notification.upsert({
    where: { dedupeKey: `class.session_changed:${event.id}` },
    create: {
      title: "Thay đổi lịch học",
      body: `Lớp ${cls.name} ${what}. Vui lòng kiểm tra lịch mới.`,
      audience: "CLASS",
      classId,
      centerId: cls.centerId,
      createdByName: "Hệ thống",
      dedupeKey: `class.session_changed:${event.id}`,
    },
    update: {},
  });

  // GV phụ trách (StaffNotification inbox).
  if (cls.teacherId) {
    await notifyStaff({
      userIds: [cls.teacherId],
      dedupeKey: `class.session_changed:${event.id}`,
      category: "CLASS",
      title: "Lịch lớp thay đổi",
      body: `Lớp ${cls.name} ${what}.`,
      href: `/classes/${classId}/edit`,
      entityId: classId,
      // Không `reopen`: event phát lại là chuyện của hạ tầng, không phải lịch đổi lần nữa.
    });
  }
}

// ─── class.cancelled → PH lớp + GV phụ trách (LMS-10 / W3-2) ──────────────────
export async function onClassCancelled(event: DomainEventLite): Promise<void> {
  const classId = str(event.payload.classId);
  if (!classId) return;
  const reason = str(event.payload.reason);

  const cls = await db.class.findUnique({
    where: { id: classId },
    select: { name: true, centerId: true, teacherId: true },
  });
  if (!cls) return;

  const reasonSuffix = reason ? ` Lý do: ${reason}.` : "";

  // PH của lớp (audience=CLASS) — idempotent theo event.id.
  await db.notification.upsert({
    where: { dedupeKey: `class.cancelled:${event.id}` },
    create: {
      title: "Lớp học đã bị hủy",
      body: `Lớp ${cls.name} đã bị hủy.${reasonSuffix} Trung tâm sẽ liên hệ để hỗ trợ chuyển lớp/hoàn phí.`,
      audience: "CLASS",
      classId,
      centerId: cls.centerId,
      createdByName: "Hệ thống",
      dedupeKey: `class.cancelled:${event.id}`,
    },
    update: {},
  });

  // GV phụ trách (StaffNotification inbox).
  if (cls.teacherId) {
    await notifyStaff({
      userIds: [cls.teacherId],
      dedupeKey: `class.cancelled:${event.id}`,
      category: "CLASS",
      title: "Lớp đã bị hủy",
      body: `Lớp ${cls.name} đã bị hủy.${reasonSuffix}`,
      href: `/classes/${classId}/edit`,
      entityId: classId,
    });
  }
}

// ─── "con đã học thử xong" → Sale phụ trách follow-up (R7-02) ────────────────
//
// ⚠️ 03/09/2026 — handler này từng là HANDLER CHẾT. Nó nghe `lead.trialAttended`,
// nhưng KHÔNG MỘT CHỖ NÀO trong repo phát sự kiện tên đó. Đường điểm danh thật
// (`syncTrialProgress` → `lib/trial/service.ts`) phát **`lead.awaitingDecision`** khi
// MỌI con của lead đủ buổi ⇒ hai đầu lệch TÊN, và Sale không bao giờ nhận được tin
// "đã học thử xong, liên hệ chốt". Hai tài liệu đều ghi nhầm là luồng này đang chạy
// (`Document/0-yeucau/0-tai-lieu-goc/luong-LMS.md` §13 "17/17 trigger" và
// `docs/audit/LMS_R7_FE_BE_DB_EVENT_AUDIT.md` "đã có handler + emit").
//
// VÁ BẰNG CÁCH ĐĂNG KÝ THÊM TÊN ĐANG ĐƯỢC PHÁT, không phải thêm một `publishEvent`
// vào `syncTrialProgress`: hàm đó chạy TRONG transaction điểm danh, mà `dedupeKey` của
// `DomainEvent` là @unique — trùng khóa là P2002 nổ giữa transaction và Postgres huỷ cả
// lượt điểm danh (đúng landmine đã ghi ở `lib/trial/service.ts` đầu
// `rescheduleTrialEnrollment`). Thêm một dòng `on(...)` thì không đụng gì tới đường ghi.
//
// GIỮ `lead.trialAttended`: DomainEvent cũ trong DB vẫn mang tên đó (nếu có), và tên
// này là tên ĐÚNG về nghiệp vụ cho người viết producer mới.
//
// `dedupeKey` của THÔNG BÁO vẫn là `lead.trialAttended:<leadId>` dù vào từ đường nào —
// một lead chỉ đáng nhận đúng một tin "đã học thử xong", dù hai sự kiện cùng tới.────
export async function onLeadTrialAttended(event: DomainEventLite): Promise<void> {
  const leadId = str(event.payload.leadId);
  if (!leadId) return;
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { assignedToId: true, adminId: true, parentName: true },
  });
  const userId = lead?.assignedToId ?? lead?.adminId;
  if (!userId) return;

  await notifyStaff({
    userIds: [userId],
    dedupeKey: `lead.trialAttended:${leadId}`,
    category: "LEAD",
    title: "Lead đã học thử xong",
    body: `Phụ huynh ${lead?.parentName ?? ""} đã hoàn tất buổi học thử — liên hệ chốt.`,
    href: `/leads/${leadId}`,
    entityId: leadId,
  });
}

export function registerR7NotificationHandlers(): void {
  on("payment.confirmed", onPaymentConfirmed);
  on("payment.rejected", onPaymentRejected);
  on("class.session_changed", onClassSessionChanged);
  on("class.cancelled", onClassCancelled);
  on("lead.trialAttended", onLeadTrialAttended);
  // Tên THẬT đang được phát bởi `syncTrialProgress` — xem khối chú thích trên.
  on("lead.awaitingDecision", onLeadTrialAttended);
}
