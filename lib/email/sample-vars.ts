import type { EmailTemplateTrigger } from "@prisma/client";

/**
 * Sample values for each trigger's variables, used in "test send" UI.
 * Admin có thể override trong modal trước khi gửi.
 */
export const SAMPLE_VARS: Record<EmailTemplateTrigger, Record<string, string>> =
  {
    ORDER_CONFIRMATION: {
      customer_name: "Nguyễn Văn A",
      order_code: "ORD-260525-000123",
      total_amount: "1500000",
      payment_method: "Chuyển khoản BIDV",
      items_list:
        "<ul><li>Khoá học Robotics cấp độ 1 × 1 = 1.500.000 đ</li></ul>",
      order_date: new Date().toISOString(),
    },
    PAYMENT_RECEIPT: {
      customer_name: "Nguyễn Văn A",
      order_code: "ORD-260525-000123",
      total_amount: "1500000",
      payment_method: "Chuyển khoản BIDV",
      paid_at: new Date().toISOString(),
    },
    RESERVATION_NOTICE: {
      student_name: "Nguyễn Văn B",
      parent_name: "Nguyễn Văn A",
      started_at: new Date().toISOString(),
      expected_end_at: new Date(
        Date.now() + 30 * 86400 * 1000,
      ).toISOString(),
      reason: "Bệnh kéo dài 2 tuần, cần thời gian phục hồi",
    },
    WITHDRAWAL_NOTICE: {
      student_name: "Nguyễn Văn B",
      parent_name: "Nguyễn Văn A",
      withdrawn_at: new Date().toISOString(),
      reason: "Chuyển trường",
    },
    RENEWAL_REMINDER: {
      student_name: "Nguyễn Văn B",
      parent_name: "Nguyễn Văn A",
      course_name: "Robotics Cấp độ 2",
      end_date: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
    },
    CLASS_REMINDER: {
      student_name: "Nguyễn Văn B",
      parent_name: "Nguyễn Văn A",
      class_name: "Robotics L1 - T2/T5 18h00",
      session_date: new Date(Date.now() + 86400 * 1000).toISOString(),
      center_name: "Sata Robo - Cơ sở Nguyễn Hữu Thọ",
    },
    MANUAL: {},
  };
