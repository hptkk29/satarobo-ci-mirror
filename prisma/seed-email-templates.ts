import { PrismaClient, EmailTemplateTrigger } from "@prisma/client";
import { EMAIL_TEMPLATE_DEFS } from "../lib/email/template-codes";

const TEMPLATES = [
  {
    code: "ORDER_CONFIRMATION_VI",
    name: "Xác nhận đơn hàng (Tiếng Việt)",
    trigger: EmailTemplateTrigger.ORDER_CONFIRMATION,
    isActive: true,
    subject: "Đã nhận đơn hàng {{order_code}} - Sata Robo",
    bodyText: `Xin chào {{customer_name}},

Cảm ơn anh/chị đã đặt hàng tại Sata Robo!

Thông tin đơn hàng:
- Mã đơn: {{order_code}}
- Ngày đặt: {{order_date:date}}
- Tổng tiền: {{total_amount:currency}}
- Phương thức thanh toán: {{payment_method}}

Chi tiết đơn hàng:
{{items_list}}

Đội ngũ Sata Robo sẽ liên hệ xác nhận trong vòng 24h.

Trân trọng,
Sata Robo
Hotline: 0837312860`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f97316, #7e22ce); color: white; border-radius: 8px 8px 0 0;">
  <h1 style="margin: 0;">Sata Robo</h1>
  <p style="margin: 8px 0 0;">Cảm ơn anh/chị đã đặt hàng!</p>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{customer_name}}</strong>,</p>
  <p>Đơn hàng của anh/chị đã được tiếp nhận. Chúng tôi sẽ liên hệ xác nhận trong vòng 24h.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Mã đơn:</strong></td><td style="padding: 8px;">{{order_code}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Ngày đặt:</strong></td><td style="padding: 8px;">{{order_date:date}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Phương thức TT:</strong></td><td style="padding: 8px;">{{payment_method}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Tổng tiền:</strong></td><td style="padding: 8px; font-size: 18px; color: #f97316;"><strong>{{total_amount:currency}}</strong></td></tr>
  </table>

  <h3 style="border-bottom: 2px solid #f97316; padding-bottom: 8px;">Chi tiết đơn hàng</h3>
  {{items_list}}

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
  <p style="text-align: center; color: #666; font-size: 13px;">
    Mọi thắc mắc liên hệ <strong>0837312860</strong> hoặc <strong>satarobo@gmail.com</strong>
  </p>
</div>
</body></html>`,
    availableVariables: [
      "customer_name",
      "order_code",
      "total_amount",
      "payment_method",
      "items_list",
      "order_date",
    ],
  },
  {
    code: "PAYMENT_RECEIPT_VI",
    name: "Biên nhận thanh toán (Tiếng Việt)",
    trigger: EmailTemplateTrigger.PAYMENT_RECEIPT,
    isActive: true,
    subject: "Xác nhận thanh toán đơn {{order_code}} - Sata Robo",
    bodyText: `Xin chào {{customer_name}},

Đơn hàng {{order_code}} đã thanh toán thành công.

Thông tin:
- Số tiền: {{total_amount:currency}}
- Phương thức: {{payment_method}}
- Thời gian: {{paid_at:datetime}}

Đội ngũ Sata Robo sẽ tiến hành các bước tiếp theo và liên hệ với anh/chị sớm.

Trân trọng,
Sata Robo`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: #10b981; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
  <div style="font-size: 48px;">✓</div>
  <h2 style="margin: 8px 0 0;">Thanh toán thành công</h2>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{customer_name}}</strong>,</p>
  <p>Cảm ơn anh/chị đã hoàn tất thanh toán cho đơn hàng <strong>{{order_code}}</strong>.</p>
  <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 20px 0;">
    <p style="margin: 4px 0;"><strong>Số tiền:</strong> <span style="color: #10b981; font-size: 18px;">{{total_amount:currency}}</span></p>
    <p style="margin: 4px 0;"><strong>Phương thức:</strong> {{payment_method}}</p>
    <p style="margin: 4px 0;"><strong>Thời gian:</strong> {{paid_at:datetime}}</p>
  </div>
  <p>Đội ngũ Sata Robo sẽ liên hệ với anh/chị sớm để tiến hành các bước tiếp theo.</p>
</div>
</body></html>`,
    availableVariables: [
      "customer_name",
      "order_code",
      "total_amount",
      "payment_method",
      "paid_at",
    ],
  },
  {
    code: "RESERVATION_NOTICE_VI",
    name: "Thông báo bảo lưu (Tiếng Việt)",
    trigger: EmailTemplateTrigger.RESERVATION_NOTICE,
    isActive: true,
    subject: "Xác nhận bảo lưu - {{student_name}}",
    bodyText: `Xin chào {{parent_name}},

Sata Robo xác nhận đã ghi nhận yêu cầu bảo lưu cho học viên {{student_name}}.

Thông tin bảo lưu:
- Ngày bắt đầu: {{started_at:date}}
- Dự kiến trở lại: {{expected_end_at:date}}
- Lý do: {{reason}}

Trong thời gian bảo lưu, chỗ học của bé sẽ được giữ. Khi sẵn sàng trở lại, vui lòng liên hệ trước 3-5 ngày để chúng tôi sắp xếp lớp phù hợp.

Trân trọng,
Sata Robo`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: #fef3c7; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
  <div style="font-size: 32px;">🟡</div>
  <h2 style="margin: 8px 0 0; color: #92400e;">Đã ghi nhận bảo lưu</h2>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{parent_name}}</strong>,</p>
  <p>Sata Robo xác nhận đã ghi nhận yêu cầu bảo lưu cho học viên <strong>{{student_name}}</strong>.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Ngày bắt đầu:</strong></td><td style="padding: 8px;">{{started_at:date}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Dự kiến trở lại:</strong></td><td style="padding: 8px;">{{expected_end_at:date}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Lý do:</strong></td><td style="padding: 8px;">{{reason}}</td></tr>
  </table>
  <div style="background: #fefce8; padding: 12px; border-left: 3px solid #facc15; margin: 16px 0; font-size: 14px;">
    Chỗ học của bé sẽ được giữ trong thời gian bảo lưu. Vui lòng liên hệ trước 3-5 ngày khi bé sẵn sàng trở lại để chúng tôi sắp xếp lớp phù hợp.
  </div>
</div>
</body></html>`,
    availableVariables: [
      "student_name",
      "parent_name",
      "started_at",
      "expected_end_at",
      "reason",
    ],
  },

  // ─── WITHDRAWAL_NOTICE_VI ────────────────────────────────────────
  {
    code: "WITHDRAWAL_NOTICE_VI",
    name: "Xác nhận thôi học (Tiếng Việt)",
    description: "Gửi cho phụ huynh khi học sinh được rút khỏi danh sách",
    trigger: EmailTemplateTrigger.WITHDRAWAL_NOTICE,
    isActive: true,
    subject: "Xác nhận thôi học - {{student_name}} | Sata Robo",
    bodyText: `Xin chào {{parent_name}},

Sata Robo xác nhận học viên {{student_name}} đã chính thức ngừng học tại trung tâm.

Thông tin:
- Ngày ghi nhận: {{withdrawn_at:date}}
- Lý do: {{reason}}

Sata Robo cảm ơn anh/chị và {{student_name}} đã đồng hành cùng chúng tôi.
Mọi câu hỏi về học phí, hoàn trả hoặc thủ tục, vui lòng liên hệ 0837312860.

Hẹn gặp lại trong tương lai!

Trân trọng,
Sata Robo`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #7e22ce, #475569); color: white; border-radius: 8px 8px 0 0;">
  <h1 style="margin: 0;">Sata Robo</h1>
  <p style="margin: 8px 0 0;">Xác nhận thôi học</p>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{parent_name}}</strong>,</p>
  <p>Sata Robo xác nhận học viên <strong>{{student_name}}</strong> đã chính thức ngừng học tại trung tâm.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Ngày ghi nhận:</strong></td><td style="padding: 8px;">{{withdrawn_at:date}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Lý do:</strong></td><td style="padding: 8px;">{{reason}}</td></tr>
  </table>

  <p>Sata Robo cảm ơn anh/chị đã đồng hành cùng chúng tôi. Hẹn gặp lại trong tương lai!</p>

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
  <p style="text-align: center; color: #666; font-size: 13px;">
    Mọi câu hỏi liên hệ <strong>0837312860</strong> hoặc <strong>satarobo@gmail.com</strong>
  </p>
</div>
</body></html>`,
    availableVariables: ["parent_name", "student_name", "withdrawn_at", "reason"],
  },

  // ─── CONSULT_LEAD_NOTIFICATION_INTERNAL ──────────────────────────
  // Note: dùng trigger MANUAL vì không tạo enum mới (tránh migration).
  // consult-notification.ts tìm theo CODE thay vì trigger.
  {
    code: "CONSULT_LEAD_NOTIFICATION_INTERNAL",
    name: "Thông báo Lead mới (Nội bộ)",
    description:
      "Gửi tới email nội bộ khi có lead đăng ký tư vấn từ trang /khoa-hoc/[slug]",
    trigger: EmailTemplateTrigger.MANUAL,
    isActive: true,
    subject:
      "Lead tư vấn mới: {{parent_name}} quan tâm {{course_name}}",
    bodyText: `Lead mới từ trang chi tiết khoá học:

Phụ huynh:    {{parent_name}}
SĐT:          {{phone}}
Email:        {{email}}
Tên con:      {{child_name}}
Thời gian PH muốn được liên hệ: {{preferred_time}}

Khoá quan tâm: {{course_name}} ({{course_slug}})
Trang nguồn:   https://satarobo.vn{{landing_page}}
Thời gian:     {{created_at:datetime}}

Lead ID: {{lead_id}}
Mở trong admin: https://satarobo.vn/admin/leads/{{lead_id}}`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; margin-bottom: 16px;">
  <strong>LEAD MỚI - CẦN GỌI TRONG 30 PHÚT</strong>
</div>
<table style="width: 100%; border-collapse: collapse;">
  <tr><td style="padding: 8px; background: #f9fafb; width: 40%;"><strong>Phụ huynh:</strong></td><td style="padding: 8px;">{{parent_name}}</td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>SĐT:</strong></td><td style="padding: 8px;"><a href="tel:{{phone}}" style="font-size: 16px; color: #f97316; font-weight: bold;">{{phone}}</a></td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>Email:</strong></td><td style="padding: 8px;">{{email}}</td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>Tên con:</strong></td><td style="padding: 8px;">{{child_name}}</td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>Thời gian muốn liên hệ:</strong></td><td style="padding: 8px;">{{preferred_time}}</td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>Khoá quan tâm:</strong></td><td style="padding: 8px;"><strong style="color: #7e22ce;">{{course_name}}</strong> ({{course_slug}})</td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>Trang nguồn:</strong></td><td style="padding: 8px;"><a href="https://satarobo.vn{{landing_page}}">{{landing_page}}</a></td></tr>
  <tr><td style="padding: 8px; background: #f9fafb;"><strong>Thời gian:</strong></td><td style="padding: 8px;">{{created_at:datetime}}</td></tr>
</table>
<div style="margin-top: 20px; text-align: center;">
  <a href="https://satarobo.vn/admin/leads/{{lead_id}}" style="display: inline-block; padding: 12px 24px; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Mở trong Admin →</a>
</div>
</body></html>`,
    availableVariables: [
      "lead_id",
      "parent_name",
      "phone",
      "email",
      "child_name",
      "preferred_time",
      "course_name",
      "course_slug",
      "landing_page",
      "created_at",
    ],
  },

  // ─── CLASS_REMINDER_VI ───────────────────────────────────────────
  {
    code: "CLASS_REMINDER_VI",
    name: "Nhắc lịch học (24h trước)",
    description: "Gửi cho phụ huynh 24h trước mỗi buổi học",
    trigger: EmailTemplateTrigger.CLASS_REMINDER,
    isActive: true,
    subject: "Nhắc lịch học: {{class_name}} ngày mai - {{student_name}}",
    bodyText: `Xin chào {{parent_name}},

Sata Robo nhắc nhở lịch học của {{student_name}} ngày mai:

Buổi học: {{class_name}}
Thời gian: {{session_date:datetime}}
Địa điểm: {{center_name}}
Chủ đề: {{session_topic}}

Vui lòng cho con đi học đúng giờ. Nếu có thay đổi đột xuất, vui lòng liên hệ ngay
0837.312.860 để Sata Robo sắp xếp.

Trân trọng,
Sata Robo`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #3b82f6, #6366f1); color: white; border-radius: 8px 8px 0 0;">
  <h1 style="margin: 0; font-size: 22px;">Nhắc lịch học</h1>
  <p style="margin: 8px 0 0;">Sata Robo</p>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{parent_name}}</strong>,</p>
  <p>Sata Robo nhắc nhở lịch học của <strong>{{student_name}}</strong> ngày mai:</p>

  <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <div style="margin-bottom: 8px;"><strong>Buổi học:</strong> {{class_name}}</div>
    <div style="margin-bottom: 8px;"><strong>Thời gian:</strong> <span style="color: #ea580c; font-weight: bold;">{{session_date:datetime}}</span></div>
    <div style="margin-bottom: 8px;"><strong>Địa điểm:</strong> {{center_name}}</div>
    <div><strong>Chủ đề:</strong> {{session_topic}}</div>
  </div>

  <p>Vui lòng cho con đi học đúng giờ. Nếu có thay đổi đột xuất, liên hệ ngay:</p>
  <p style="text-align: center; margin: 20px 0;">
    <a href="tel:0837312860" style="display: inline-block; padding: 12px 24px; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">0837.312.860</a>
  </p>

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
  <p style="text-align: center; color: #666; font-size: 13px;">
    Mọi câu hỏi liên hệ <strong>0837.312.860</strong> hoặc <strong>satarobo@gmail.com</strong>
  </p>
</div>
</body></html>`,
    availableVariables: [
      "parent_name",
      "student_name",
      "class_name",
      "session_date",
      "center_name",
      "session_topic",
    ],
  },

  // ─── RENEWAL_REMINDER_VI ─────────────────────────────────────────
  {
    code: "RENEWAL_REMINDER_VI",
    name: "Nhắc gia hạn khóa học (14 ngày trước)",
    description: "Gửi cho phụ huynh 14 ngày trước khi enrollment kết thúc",
    trigger: EmailTemplateTrigger.RENEWAL_REMINDER,
    isActive: true,
    subject:
      "{{student_name}} sắp hoàn thành khóa {{course_name}} - Sata Robo",
    bodyText: `Xin chào {{parent_name}},

Sata Robo xin thông báo: {{student_name}} sắp hoàn thành khóa học hiện tại.

Thông tin:
- Khóa học: {{course_name}}
- Ngày kết thúc: {{end_date:date}} ({{days_remaining}} ngày nữa)

Để con tiếp tục lộ trình Robotics liền mạch, Sata Robo trân trọng mời anh/chị
đăng ký khóa tiếp theo trước ngày {{end_date:date}}.

Liên hệ ngay 0837.312.860 để được tư vấn lộ trình phù hợp với độ tuổi và mục
tiêu của con.

Trân trọng,
Sata Robo`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f97316, #7e22ce); color: white; border-radius: 8px 8px 0 0;">
  <h1 style="margin: 0;">Sắp kết thúc khóa học</h1>
  <p style="margin: 8px 0 0;">Sata Robo</p>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{parent_name}}</strong>,</p>
  <p><strong>{{student_name}}</strong> sắp hoàn thành khóa học hiện tại tại Sata Robo!</p>

  <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <div style="margin-bottom: 8px;"><strong>Khóa học:</strong> {{course_name}}</div>
    <div><strong>Ngày kết thúc:</strong> <span style="color: #c2410c; font-weight: bold;">{{end_date:date}}</span> (còn {{days_remaining}} ngày)</div>
  </div>

  <p>Để con tiếp tục lộ trình Robotics <strong>liền mạch</strong>, không bị gián đoạn tư duy đã xây dựng, anh/chị nên đăng ký khóa tiếp theo trong 14 ngày tới.</p>

  <p style="text-align: center; margin: 24px 0;">
    <a href="tel:0837312860" style="display: inline-block; padding: 14px 28px; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Liên hệ tư vấn ngay</a>
  </p>

  <p style="text-align: center; color: #666; font-size: 14px;">
    Hoặc xem các khóa tiếp theo tại: <a href="https://satarobo.vn/khoa-hoc/laptrinhrobot" style="color: #f97316;">satarobo.vn/khoa-hoc</a>
  </p>

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
  <p style="text-align: center; color: #666; font-size: 13px;">
    Sata Robo · 0837.312.860 · satarobo@gmail.com
  </p>
</div>
</body></html>`,
    availableVariables: [
      "parent_name",
      "student_name",
      "course_name",
      "end_date",
      "days_remaining",
    ],
  },

  // ─── PROGRESS_REPORT_VI (Phase T2.1) ─────────────────────────────
  // Dùng trigger MANUAL + tìm theo CODE (tránh tạo enum mới / migration),
  // giống pattern CONSULT_LEAD_NOTIFICATION_INTERNAL.
  {
    code: "PROGRESS_REPORT_VI",
    name: "Báo cáo tiến độ học tập (Phụ huynh)",
    description: "Gửi cho phụ huynh khi giáo viên tạo báo cáo tiến độ lớp",
    trigger: EmailTemplateTrigger.MANUAL,
    isActive: true,
    subject: "Báo cáo tiến độ học tập của {{student_name}} - Sata Robo",
    bodyText: `Xin chào {{parent_name}},

Sata Robo gửi anh/chị báo cáo tiến độ học tập của {{student_name}} tại lớp {{class_name}}:

- Điểm danh: {{attendance_rate}}% ({{attended_sessions}}/{{total_sessions}} buổi)
- Bài học đã hoàn thành: {{covered_lessons}}/{{total_lessons}}
- Bài tập đã nộp: {{submitted_assignments}}/{{total_assignments}}
- Điểm trung bình: {{average_score}}
- Đề thi đạt: {{passed_exams}}/{{exam_attempts}}

Báo cáo lập ngày {{report_date:date}}.

Mọi thắc mắc về tiến độ của con, anh/chị vui lòng liên hệ 0837312860.

Trân trọng,
Sata Robo`,
    bodyHtml: `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f97316, #7e22ce); color: white; border-radius: 8px 8px 0 0;">
  <h1 style="margin: 0;">Báo cáo tiến độ học tập</h1>
  <p style="margin: 8px 0 0;">Sata Robo</p>
</div>
<div style="background: white; padding: 24px; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
  <p>Xin chào <strong>{{parent_name}}</strong>,</p>
  <p>Sata Robo gửi anh/chị báo cáo tiến độ học tập của <strong>{{student_name}}</strong> tại lớp <strong>{{class_name}}</strong>:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Điểm danh:</strong></td><td style="padding: 8px;">{{attendance_rate}}% ({{attended_sessions}}/{{total_sessions}} buổi)</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Bài học hoàn thành:</strong></td><td style="padding: 8px;">{{covered_lessons}}/{{total_lessons}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Bài tập đã nộp:</strong></td><td style="padding: 8px;">{{submitted_assignments}}/{{total_assignments}}</td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Điểm trung bình:</strong></td><td style="padding: 8px; font-size: 18px; color: #f97316;"><strong>{{average_score}}</strong></td></tr>
    <tr><td style="padding: 8px; background: #f9fafb;"><strong>Đề thi đạt:</strong></td><td style="padding: 8px;">{{passed_exams}}/{{exam_attempts}}</td></tr>
  </table>
  <p style="color: #666; font-size: 13px;">Báo cáo lập ngày {{report_date:date}}.</p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
  <p style="text-align: center; color: #666; font-size: 13px;">
    Mọi thắc mắc liên hệ <strong>0837312860</strong> hoặc <strong>satarobo@gmail.com</strong>
  </p>
</div>
</body></html>`,
    availableVariables: [
      "parent_name",
      "student_name",
      "class_name",
      "attendance_rate",
      "attended_sessions",
      "total_sessions",
      "covered_lessons",
      "total_lessons",
      "submitted_assignments",
      "total_assignments",
      "average_score",
      "passed_exams",
      "exam_attempts",
      "report_date",
    ],
  },
];

export async function seedEmailTemplates(prisma: PrismaClient) {
  let created = 0;
  let updated = 0;
  for (const tpl of TEMPLATES) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { code: tpl.code },
      select: { id: true },
    });
    await prisma.emailTemplate.upsert({
      where: { code: tpl.code },
      create: tpl,
      // Update content but preserve sentCount + lastSentAt stats.
      update: {
        name: tpl.name,
        description: tpl.description,
        trigger: tpl.trigger,
        isActive: tpl.isActive,
        subject: tpl.subject,
        bodyText: tpl.bodyText,
        bodyHtml: tpl.bodyHtml,
        availableVariables: tpl.availableVariables,
      },
    });
    if (existing) updated++;
    else created++;
  }

  // ── B1.5 (10/07) — 9 email hệ thống (trigger + call-site) từ template-codes.ts ──
  // Khác TEMPLATES ở trên: CREATE-ONLY — nội dung do ADMIN SỞ HỮU sau khi seed
  // (sửa ở /admin/email-templates, quyền emails:manage). Seed chạy lại KHÔNG đè
  // bản admin đã sửa. Trigger MANUAL (worker tìm theo CODE, không theo trigger).
  let sysCreated = 0;
  let sysKept = 0;
  for (const [code, def] of Object.entries(EMAIL_TEMPLATE_DEFS)) {
    const existing = await prisma.emailTemplate.findUnique({ where: { code }, select: { id: true } });
    if (existing) {
      sysKept++;
      continue;
    }
    await prisma.emailTemplate.create({
      data: {
        code,
        name: def.name,
        description: def.description,
        trigger: EmailTemplateTrigger.MANUAL,
        isActive: true,
        subject: def.subject,
        bodyText: def.bodyText,
        bodyHtml: def.bodyHtml,
        availableVariables: def.availableVariables,
      },
    });
    sysCreated++;
  }

  console.log(
    `Email templates: ${created} mới · ${updated} cập nhật · hệ thống (create-only): ${sysCreated} mới · ${sysKept} giữ nguyên`,
  );
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedEmailTemplates(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
