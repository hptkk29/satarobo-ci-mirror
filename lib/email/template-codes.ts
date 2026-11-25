// lib/email/template-codes.ts — danh mục MÃ TEMPLATE cho email tự động (B1.5 10/07).
//
// Nguồn sự thật duy nhất: mỗi email tự động có 1 code + nội dung MẶC ĐỊNH ({{var}}).
// - Trigger/call-site truyền `templateKey: CODE` + `vars` → worker (lib/email/queue.ts:82)
//   ưu tiên EmailTemplate ACTIVE trong DB (admin sửa ở /admin/email-templates, quyền
//   emails:manage) rồi mới rơi về inline fallback → admin đổi nội dung KHÔNG cần code.
// - prisma/seed-email-templates.ts upsert các code này (CREATE-ONLY — không đè bản sửa).
//
// ⚠️ Renderer (lib/email/render.ts): var null/undefined → GIỮ NGUYÊN "{{var}}" trong email.
// Vì vậy MỌI var ở đây phải LUÔN là string/number có nghĩa — phần điều-kiện (tên bé, hạn
// nộp, mã HV…) được compose sẵn ở call-site thành var "…Part" (chuỗi rỗng khi thiếu).

export type EmailTemplateDef = {
  name: string;
  description: string;
  availableVariables: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
};

const FOOT_TEXT = "\n\n— Trung tâm Sata Robo";
const html = (title: string, lines: string[]) =>
  `<div style="font-family:system-ui,sans-serif;color:#333">
    <h2 style="color:#F97316">${title}</h2>
    ${lines.map((l) => `<p>${l}</p>`).join("\n    ")}
    <p style="color:#999;font-size:12px">— Trung tâm Sata Robo</p>
  </div>`;

export const EMAIL_TEMPLATE_DEFS: Record<string, EmailTemplateDef> = {
  // BGĐ 31/07 — gửi khi admin CẤP tài khoản nhân sự / reset mật khẩu.
  // ⚠️ Email này gửi TRỰC TIẾP qua lib/email/staff-account.ts (KHÔNG qua EmailQueue —
  // password không được nằm trong payload/bodyText DB; EmailLog lưu bản đã mask).
  STAFF_ACCOUNT_GRANTED: {
    name: "Cấp tài khoản nhân sự",
    description:
      "Gửi nhân sự khi được cấp tài khoản mới hoặc reset mật khẩu. Chứa thông tin đăng nhập + yêu cầu đổi mật khẩu ngay.",
    availableVariables: ["staffName", "loginId", "password", "loginUrl"],
    subject: "Cấp tài khoản từ Sata Robo",
    bodyText: `Chào {{staffName}},\nBạn được cấp tài khoản hệ thống Sata Robo:\n- Tài khoản đăng nhập: {{loginId}}\n- Mật khẩu: {{password}}\n- Đăng nhập tại: {{loginUrl}}\nVì lý do bảo mật, hệ thống sẽ YÊU CẦU BẠN ĐỔI MẬT KHẨU ngay lần đăng nhập đầu tiên. Không chia sẻ email này cho người khác.${FOOT_TEXT}`,
    bodyHtml: html("Cấp tài khoản từ Sata Robo", [
      "Chào <b>{{staffName}}</b>,",
      "Bạn được cấp tài khoản hệ thống Sata Robo:",
      "Tài khoản đăng nhập: <b>{{loginId}}</b>",
      "Mật khẩu: <b>{{password}}</b>",
      'Đăng nhập tại: <a href="{{loginUrl}}">{{loginUrl}}</a>',
      "Vì lý do bảo mật, hệ thống sẽ <b>yêu cầu bạn đổi mật khẩu</b> ngay lần đăng nhập đầu tiên. Không chia sẻ email này cho người khác.",
    ]),
  },
  ACCOUNT_ACTIVATED: {
    name: "Tài khoản phụ huynh kích hoạt",
    description: "Gửi khi tài khoản portal của phụ huynh được kích hoạt.",
    availableVariables: ["parentName", "childPart", "childPartHtml"],
    subject: "Tài khoản phụ huynh Sata Robo đã kích hoạt",
    bodyText: `Chào {{parentName}},\nTài khoản theo dõi học tập{{childPart}} đã được kích hoạt. Bạn có thể đăng nhập tại hocvien.satarobo.vn.${FOOT_TEXT}`,
    bodyHtml: html("Tài khoản đã kích hoạt", [
      "Chào <b>{{parentName}}</b>,",
      "Tài khoản theo dõi học tập{{childPartHtml}} đã được kích hoạt.",
      'Đăng nhập tại <a href="https://hocvien.satarobo.vn">hocvien.satarobo.vn</a>.',
    ]),
  },
  ENROLLMENT_CONFIRMATION: {
    name: "Xác nhận đăng ký khoá học",
    description: "Gửi phụ huynh khi học viên được ghi danh vào lớp.",
    availableVariables: ["parentName", "studentName", "codePart", "className", "courseName", "startPart", "startPartHtml"],
    subject: "Xác nhận đăng ký khoá học — {{studentName}}",
    bodyText: `Chào {{parentName}},\nBé {{studentName}}{{codePart}} đã được đăng ký vào lớp {{className}} — khoá {{courseName}}.{{startPart}}${FOOT_TEXT}`,
    bodyHtml: html("Xác nhận đăng ký", [
      "Chào {{parentName}},",
      "Bé <b>{{studentName}}</b>{{codePart}} đã được đăng ký vào lớp <b>{{className}}</b> — khoá {{courseName}}.",
      "{{startPartHtml}}",
    ]),
  },
  DEBT_REMINDER_ORDER: {
    name: "Nhắc thanh toán học phí",
    description: "Nhắc phụ huynh hoá đơn còn nợ (cron + thủ công).",
    availableVariables: ["customerName", "orderCode", "amount (dùng {{amount:currency}})"],
    subject: "Nhắc thanh toán học phí — {{orderCode}}",
    bodyText: `Chào {{customerName}},\nHoá đơn {{orderCode}} còn {{amount:currency}} chưa thanh toán. Vui lòng hoàn tất giúp trung tâm.${FOOT_TEXT}`,
    bodyHtml: html("Nhắc thanh toán học phí", [
      "Chào <b>{{customerName}}</b>,",
      "Hoá đơn <b>{{orderCode}}</b> còn <b>{{amount:currency}}</b> chưa thanh toán.",
      "Vui lòng hoàn tất giúp trung tâm. Cảm ơn quý phụ huynh.",
    ]),
  },
  NEW_FEEDBACK: {
    name: "Nhận xét mới của giáo viên",
    description: "Báo phụ huynh khi giáo viên nhận xét buổi học của bé.",
    availableVariables: ["parentName", "studentName", "className", "comment", "ratingPart"],
    subject: "Nhận xét mới cho bé {{studentName}}",
    bodyText: `Chào {{parentName}},\nGiáo viên vừa có nhận xét mới cho bé {{studentName}} (lớp {{className}}):\n"{{comment}}"{{ratingPart}}\nXem chi tiết tại mục Nhận xét trên cổng học viên.${FOOT_TEXT}`,
    bodyHtml: html("Nhận xét mới", [
      "Chào {{parentName}},",
      "Giáo viên vừa có nhận xét mới cho bé <b>{{studentName}}</b> (lớp {{className}}):",
      "<i>&quot;{{comment}}&quot;</i>{{ratingPart}}",
      "Xem chi tiết tại mục Nhận xét trên cổng học viên.",
    ]),
  },
  NEW_ASSIGNMENT: {
    name: "Bài tập mới",
    description: "Báo phụ huynh khi lớp của bé có bài tập mới.",
    availableVariables: ["parentName", "studentName", "className", "assignmentTitle", "duePart", "duePartHtml"],
    subject: "Bài tập mới — {{assignmentTitle}}",
    bodyText: `Chào {{parentName}},\nLớp {{className}} của bé {{studentName}} vừa có bài tập mới: {{assignmentTitle}}.{{duePart}}${FOOT_TEXT}`,
    bodyHtml: html("Bài tập mới", [
      "Chào {{parentName}},",
      "Lớp <b>{{className}}</b> của bé <b>{{studentName}}</b> vừa có bài tập mới: <b>{{assignmentTitle}}</b>.",
      "{{duePartHtml}}",
    ]),
  },
  ASSIGNMENT_GRADED: {
    name: "Kết quả bài tập (quiz/nộp bài)",
    description: "Báo phụ huynh khi bài tập của bé được chấm.",
    availableVariables: ["parentName", "studentName", "assignmentTitle", "scoreText", "total"],
    subject: "Kết quả bài tập — {{studentName}}",
    bodyText: `Chào {{parentName}},\nBài tập {{assignmentTitle}} của bé {{studentName}} đã được chấm: {{scoreText}}/{{total}}.${FOOT_TEXT}`,
    bodyHtml: html("Bài tập đã chấm", [
      "Chào {{parentName}},",
      "Bài tập <b>{{assignmentTitle}}</b> của bé <b>{{studentName}}</b> đã được chấm: <b>{{scoreText}}/{{total}}</b>.",
    ]),
  },
  COURSE_COMPLETION: {
    name: "Chúc mừng hoàn thành khoá",
    description: "Gửi phụ huynh khi học viên hoàn thành khoá + mời khảo sát cuối khoá.",
    availableVariables: ["parentName", "studentName", "courseName", "certificateCode"],
    subject: "Chúc mừng bé {{studentName}} hoàn thành khoá {{courseName}}",
    bodyText: `Chào {{parentName}},\nBé {{studentName}} đã hoàn thành khoá {{courseName}}. Mã chứng chỉ: {{certificateCode}}.\nMời quý phụ huynh làm khảo sát cuối khoá tại cổng học viên (mục Khảo sát).${FOOT_TEXT}`,
    bodyHtml: html("Chúc mừng hoàn thành khoá!", [
      "Bé <b>{{studentName}}</b> đã hoàn thành khoá <b>{{courseName}}</b>.",
      "Mã chứng chỉ: <b>{{certificateCode}}</b>",
      "Mời quý phụ huynh làm <b>khảo sát cuối khoá</b> tại cổng học viên (mục Khảo sát).",
    ]),
  },
  HOLIDAY_SHIFT: {
    name: "Dời buổi học do ngày nghỉ (gửi GV)",
    description: "Báo giáo viên khi buổi học bị dời vì trùng ngày nghỉ.",
    availableVariables: ["teacherName", "className", "oldDate", "newDate"],
    subject: "Dời buổi học do nghỉ — lớp {{className}}",
    bodyText: `Chào {{teacherName}},\nBuổi học lớp {{className}} ngày {{oldDate}} trùng ngày nghỉ đã được dời sang {{newDate}}.${FOOT_TEXT}`,
    bodyHtml: html("Dời buổi học", [
      "Chào <b>{{teacherName}}</b>,",
      "Buổi học lớp <b>{{className}}</b> ngày <b>{{oldDate}}</b> trùng ngày nghỉ đã được dời sang <b>{{newDate}}</b>.",
    ]),
  },
  RUBRIC_GRADED: {
    name: "Kết quả chấm bài (rubric)",
    description: "Báo phụ huynh khi bài nộp được chấm rubric kèm nhận xét.",
    availableVariables: ["parentName", "studentName", "assignmentTitle", "scoreText", "feedback"],
    subject: "Kết quả chấm bài: {{assignmentTitle}} — {{studentName}}",
    bodyText: `Chào {{parentName}},\nBài "{{assignmentTitle}}" của bé {{studentName}} đã được chấm.\nĐiểm: {{scoreText}}/10.\nNhận xét: {{feedback}}\nXem chi tiết rubric tại cổng học viên.${FOOT_TEXT}`,
    bodyHtml: html("Kết quả chấm bài", [
      "Chào {{parentName}},",
      "Bài <b>&quot;{{assignmentTitle}}&quot;</b> của bé <b>{{studentName}}</b> đã được chấm.",
      "Điểm: <b>{{scoreText}}/10</b>.",
      "Nhận xét: {{feedback}}",
      "Xem chi tiết rubric tại cổng học viên.",
    ]),
  },
};

export type SystemEmailTemplateCode = keyof typeof EMAIL_TEMPLATE_DEFS;
