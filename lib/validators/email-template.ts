import { z } from "zod";
import { EmailTemplateTrigger, EmailLogStatus } from "@prisma/client";

export const EMAIL_TRIGGER_LABEL: Record<EmailTemplateTrigger, string> = {
  ORDER_CONFIRMATION: "Xác nhận đơn hàng",
  PAYMENT_RECEIPT: "Biên nhận thanh toán",
  RESERVATION_NOTICE: "Thông báo bảo lưu",
  WITHDRAWAL_NOTICE: "Thông báo nghỉ học",
  RENEWAL_REMINDER: "Nhắc tái tục",
  CLASS_REMINDER: "Nhắc buổi học",
  MANUAL: "Gửi thủ công",
};

export const EMAIL_LOG_STATUS_LABEL: Record<EmailLogStatus, string> = {
  PENDING: "Chờ gửi",
  SENT: "Đã gửi",
  FAILED: "Thất bại",
  BOUNCED: "Bị bounce",
};

export const EMAIL_LOG_STATUS_COLOR: Record<EmailLogStatus, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  SENT: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  BOUNCED: "bg-orange-100 text-orange-700",
};

// Documentation source for available {{vars}} per trigger.
// Full var-substitution engine in 5.13.1.
export const TRIGGER_VARIABLES: Record<EmailTemplateTrigger, string[]> = {
  ORDER_CONFIRMATION: [
    "customer_name",
    "order_code",
    "total_amount",
    "payment_method",
    "items_list",
    "order_date",
  ],
  PAYMENT_RECEIPT: [
    "customer_name",
    "order_code",
    "total_amount",
    "payment_method",
    "paid_at",
  ],
  RESERVATION_NOTICE: [
    "student_name",
    "parent_name",
    "started_at",
    "expected_end_at",
    "reason",
  ],
  WITHDRAWAL_NOTICE: [
    "student_name",
    "parent_name",
    "withdrawn_at",
    "reason",
  ],
  RENEWAL_REMINDER: [
    "student_name",
    "parent_name",
    "course_name",
    "end_date",
  ],
  CLASS_REMINDER: [
    "student_name",
    "parent_name",
    "class_name",
    "session_date",
    "center_name",
  ],
  MANUAL: [],
};

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,49}$/;

export const emailTemplateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      CODE_PATTERN,
      "Code phải bắt đầu bằng chữ in hoa, chỉ chứa CHỮ HOA/SỐ/_, dài 3-50",
    ),
  name: z.string().trim().min(2, "Tên ≥ 2 ký tự").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  trigger: z.nativeEnum(EmailTemplateTrigger),
  isActive: z.boolean().default(true),
  subject: z.string().trim().min(1, "Tiêu đề bắt buộc").max(500),
  bodyText: z.string().trim().min(1, "Body text bắt buộc"),
  bodyHtml: z.string().trim().min(1, "Body HTML bắt buộc"),
  availableVariables: z.array(z.string()).default([]),
  fromName: z.string().trim().max(100).optional().nullable(),
  replyTo: z
    .string()
    .email("Email reply-to không hợp lệ")
    .optional()
    .nullable(),
});

export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;
