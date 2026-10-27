import { enqueueEmail } from "./queue";

// =============================================================================
// Cụm A2 — enqueue helper cho các trigger phase đầu.
// MỖI email chỉ chứa dữ liệu CỦA CON LIÊN QUAN — không lộ con khác.
//
// B1.5 (10/07): mỗi trigger truyền `templateKey` (mã trong lib/email/template-codes.ts)
// + `vars` → worker ưu tiên EmailTemplate ACTIVE trong DB (admin sửa nội dung ở
// /admin/email-templates, quyền emails:manage) rồi mới rơi về inline dưới đây.
// Inline giữ NGUYÊN VĂN cũ — chưa seed template thì hành vi không đổi.
// ⚠️ vars phải LUÔN là string có nghĩa (renderer giữ nguyên "{{var}}" khi null) —
// phần điều kiện compose sẵn thành var "…Part" (rỗng khi thiếu).
// =============================================================================

const SIGNATURE = "\n\n— Trung tâm Sata Robo";
const wrap = (title: string, lines: string[]) =>
  `<div style="font-family:system-ui,sans-serif;color:#333">
    <h2 style="color:#F97316">${title}</h2>
    ${lines.map((l) => `<p>${l}</p>`).join("")}
    <p style="color:#999;font-size:12px">— Trung tâm Sata Robo</p>
  </div>`;

/** (a) Tài khoản phụ huynh được kích hoạt. */
export function enqueueAccountActivated(p: { to: string; parentName?: string | null; childName?: string | null }) {
  const parentName = p.parentName ?? "quý phụ huynh";
  return enqueueEmail({
    to: p.to,
    toName: p.parentName ?? undefined,
    templateKey: "ACCOUNT_ACTIVATED",
    vars: {
      parentName,
      childPart: p.childName ? ` của bé ${p.childName}` : "",
      childPartHtml: p.childName ? ` của bé <b>${p.childName}</b>` : "",
    },
    subject: "Tài khoản phụ huynh Sata Robo đã kích hoạt",
    bodyText: `Chào ${parentName},\nTài khoản theo dõi học tập${p.childName ? ` của bé ${p.childName}` : ""} đã được kích hoạt. Bạn có thể đăng nhập tại hocvien.satarobo.vn.${SIGNATURE}`,
    bodyHtml: wrap("Tài khoản đã kích hoạt", [
      `Chào <b>${parentName}</b>,`,
      `Tài khoản theo dõi học tập${p.childName ? ` của bé <b>${p.childName}</b>` : ""} đã được kích hoạt.`,
      `Đăng nhập tại <a href="https://hocvien.satarobo.vn">hocvien.satarobo.vn</a>.`,
    ]),
    context: { type: "ACCOUNT_ACTIVATED", id: p.to },
  });
}

/** (b) Xác nhận đăng ký khoá. */
export function enqueueEnrollmentConfirmation(p: {
  to: string;
  parentName?: string | null;
  studentName: string;
  studentCode?: string | null;
  className: string;
  courseName: string;
  startDate?: string | null;
}) {
  const parentName = p.parentName ?? "quý phụ huynh";
  const lines = [
    `Chào ${parentName},`,
    `Bé <b>${p.studentName}</b>${p.studentCode ? ` (mã ${p.studentCode})` : ""} đã được đăng ký vào lớp <b>${p.className}</b> — khoá ${p.courseName}.`,
    p.startDate ? `Ngày bắt đầu: <b>${p.startDate}</b>.` : "",
  ].filter(Boolean);
  return enqueueEmail({
    to: p.to,
    toName: p.parentName ?? undefined,
    templateKey: "ENROLLMENT_CONFIRMATION",
    vars: {
      parentName,
      studentName: p.studentName,
      codePart: p.studentCode ? ` (mã ${p.studentCode})` : "",
      className: p.className,
      courseName: p.courseName,
      startPart: p.startDate ? `\nNgày bắt đầu: ${p.startDate}.` : "",
      startPartHtml: p.startDate ? `Ngày bắt đầu: <b>${p.startDate}</b>.` : "",
    },
    subject: `Xác nhận đăng ký khoá học — ${p.studentName}`,
    bodyText: lines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n") + SIGNATURE,
    bodyHtml: wrap("Xác nhận đăng ký", lines),
    context: { type: "ENROLLMENT_CONFIRMATION", id: p.studentCode ?? p.studentName },
  });
}

/** (d2) Nhắc thanh toán hoá đơn đơn lẻ (R2-06 C6.3 — qua Resend). */
export function enqueueDebtReminder(p: {
  to: string;
  customerName?: string | null;
  orderId: string;
  orderCode: string;
  amount: number;
}) {
  const customerName = p.customerName ?? "quý phụ huynh";
  const amt = p.amount.toLocaleString("vi-VN");
  return enqueueEmail({
    to: p.to,
    toName: p.customerName ?? undefined,
    templateKey: "DEBT_REMINDER_ORDER",
    // amount để RAW NUMBER — template dùng {{amount:currency}} (formatter render.ts).
    vars: { customerName, orderCode: p.orderCode, amount: p.amount },
    subject: `Nhắc thanh toán học phí — ${p.orderCode}`,
    bodyText: `Chào ${customerName},\nHoá đơn ${p.orderCode} còn ${amt}đ chưa thanh toán. Vui lòng hoàn tất giúp trung tâm.${SIGNATURE}`,
    bodyHtml: wrap("Nhắc thanh toán học phí", [
      `Chào <b>${customerName}</b>,`,
      `Hoá đơn <b>${p.orderCode}</b> còn <b>${amt}đ</b> chưa thanh toán.`,
      `Vui lòng hoàn tất giúp trung tâm. Cảm ơn quý phụ huynh.`,
    ]),
    context: { type: "DEBT_REMINDER_ORDER", id: p.orderId },
  });
}

/** (e) Có nhận xét mới cho bé. */
export function enqueueNewFeedback(p: {
  to: string;
  parentName?: string | null;
  studentName: string;
  className: string;
  comment: string;
  rating?: number | null;
}) {
  const parentName = p.parentName ?? "quý phụ huynh";
  const lines = [
    `Chào ${parentName},`,
    `Giáo viên vừa có nhận xét mới cho bé <b>${p.studentName}</b> (lớp ${p.className}):`,
    `<i>"${p.comment}"</i>${p.rating ? ` — ${p.rating}/5⭐` : ""}`,
    `Xem chi tiết tại mục Nhận xét trên cổng học viên.`,
  ];
  return enqueueEmail({
    to: p.to,
    toName: p.parentName ?? undefined,
    templateKey: "NEW_FEEDBACK",
    vars: {
      parentName,
      studentName: p.studentName,
      className: p.className,
      comment: p.comment,
      ratingPart: p.rating ? ` — ${p.rating}/5⭐` : "",
    },
    subject: `Nhận xét mới cho bé ${p.studentName}`,
    bodyText: lines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n") + SIGNATURE,
    bodyHtml: wrap("Nhận xét mới", lines),
    context: { type: "NEW_FEEDBACK", id: p.studentName },
  });
}

/** (f) Có bài tập mới. */
export function enqueueNewAssignment(p: {
  to: string;
  parentName?: string | null;
  studentName: string;
  className: string;
  assignmentTitle: string;
  dueAt?: string | null;
}) {
  const parentName = p.parentName ?? "quý phụ huynh";
  const lines = [
    `Chào ${parentName},`,
    `Lớp <b>${p.className}</b> của bé <b>${p.studentName}</b> vừa có bài tập mới: <b>${p.assignmentTitle}</b>.`,
    p.dueAt ? `Hạn nộp: <b>${p.dueAt}</b>.` : "",
  ].filter(Boolean);
  return enqueueEmail({
    to: p.to,
    toName: p.parentName ?? undefined,
    templateKey: "NEW_ASSIGNMENT",
    vars: {
      parentName,
      studentName: p.studentName,
      className: p.className,
      assignmentTitle: p.assignmentTitle,
      duePart: p.dueAt ? `\nHạn nộp: ${p.dueAt}.` : "",
      duePartHtml: p.dueAt ? `Hạn nộp: <b>${p.dueAt}</b>.` : "",
    },
    subject: `Bài tập mới — ${p.assignmentTitle}`,
    bodyText: lines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n") + SIGNATURE,
    bodyHtml: wrap("Bài tập mới", lines),
    context: { type: "NEW_ASSIGNMENT", id: p.studentName },
  });
}

/** (g) Bài đã chấm. */
export function enqueueAssignmentGraded(p: {
  to: string;
  parentName?: string | null;
  studentName: string;
  assignmentTitle: string;
  score: number | null;
  total: number;
}) {
  const parentName = p.parentName ?? "quý phụ huynh";
  const lines = [
    `Chào ${parentName},`,
    `Bài tập <b>${p.assignmentTitle}</b> của bé <b>${p.studentName}</b> đã được chấm: <b>${p.score ?? "—"}/${p.total}</b>.`,
  ];
  return enqueueEmail({
    to: p.to,
    toName: p.parentName ?? undefined,
    templateKey: "ASSIGNMENT_GRADED",
    vars: {
      parentName,
      studentName: p.studentName,
      assignmentTitle: p.assignmentTitle,
      scoreText: String(p.score ?? "—"),
      total: p.total,
    },
    subject: `Kết quả bài tập — ${p.studentName}`,
    bodyText: lines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n") + SIGNATURE,
    bodyHtml: wrap("Bài tập đã chấm", lines),
    context: { type: "ASSIGNMENT_GRADED", id: p.studentName },
  });
}
