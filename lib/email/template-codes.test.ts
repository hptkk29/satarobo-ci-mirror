import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATE_DEFS } from "./template-codes";
import { renderTemplate } from "./render";

// B1.5 — bất biến: nội dung MẶC ĐỊNH của mỗi template render với bộ vars mẫu
// (đúng bộ mà trigger/call-site truyền) KHÔNG được sót "{{var}}" nào — renderer
// giữ nguyên placeholder khi var null ⇒ sót = email tới PH có "{{...}}" thô.

const SAMPLE_VARS: Record<string, Record<string, string | number>> = {
  // BGĐ 31/07 — email cấp tài khoản nhân sự (SĐT đăng nhập + MK + link theo vai trò).
  STAFF_ACCOUNT_GRANTED: {
    staffName: "Thầy Nam",
    loginId: "84901234567",
    password: "MatKhau@2026",
    loginUrl: "https://admin.satarobo.vn/login",
  },
  ACCOUNT_ACTIVATED: {
    parentName: "Chị Lan",
    childPart: " của bé An",
    childPartHtml: " của bé <b>An</b>",
  },
  ENROLLMENT_CONFIRMATION: {
    parentName: "Chị Lan",
    studentName: "An",
    codePart: " (mã CS1-26-ABC)",
    className: "Robot 3A",
    courseName: "Sata 3",
    startPart: "\nNgày bắt đầu: 01/08/2026.",
    startPartHtml: "Ngày bắt đầu: <b>01/08/2026</b>.",
  },
  DEBT_REMINDER_ORDER: { customerName: "Chị Lan", orderCode: "DH-001", amount: 1500000 },
  NEW_FEEDBACK: {
    parentName: "Chị Lan",
    studentName: "An",
    className: "Robot 3A",
    comment: "Bé tiến bộ rõ",
    ratingPart: " — 5/5⭐",
  },
  NEW_ASSIGNMENT: {
    parentName: "Chị Lan",
    studentName: "An",
    className: "Robot 3A",
    assignmentTitle: "Lắp cảm biến",
    duePart: "\nHạn nộp: 05/08/2026.",
    duePartHtml: "Hạn nộp: <b>05/08/2026</b>.",
  },
  ASSIGNMENT_GRADED: {
    parentName: "Chị Lan",
    studentName: "An",
    assignmentTitle: "Lắp cảm biến",
    scoreText: "9",
    total: 10,
  },
  COURSE_COMPLETION: {
    parentName: "Chị Lan",
    studentName: "An",
    courseName: "Sata 3",
    certificateCode: "CERT-001",
  },
  HOLIDAY_SHIFT: {
    teacherName: "Thầy Nam",
    className: "Robot 3A",
    oldDate: "2026-09-02",
    newDate: "2026-09-09",
  },
  RUBRIC_GRADED: {
    parentName: "Chị Lan",
    studentName: "An",
    assignmentTitle: "Lắp cảm biến",
    scoreText: "8.5",
    feedback: "Làm tốt phần lắp ráp",
  },
};

const LEFTOVER = /\{\{\w+(?::\w+)?\}\}/;

describe("EMAIL_TEMPLATE_DEFS — render mặc định sạch placeholder", () => {
  for (const [code, def] of Object.entries(EMAIL_TEMPLATE_DEFS)) {
    it(`${code}: có sample vars + render không sót {{var}}`, () => {
      const vars = SAMPLE_VARS[code];
      expect(vars, `thiếu SAMPLE_VARS cho ${code} — thêm vào test khi thêm template`).toBeTruthy();
      for (const field of [def.subject, def.bodyText, def.bodyHtml]) {
        const out = renderTemplate(field, vars);
        expect(out).not.toMatch(LEFTOVER);
      }
    });

    it(`${code}: availableVariables ⊆ sample vars (doc cho admin không nói dối)`, () => {
      const keys = new Set(Object.keys(SAMPLE_VARS[code] ?? {}));
      for (const v of def.availableVariables) {
        // availableVariables có thể ghi kèm hint "(dùng {{amount:currency}})" — lấy token đầu.
        const name = v.split(" ")[0];
        expect(keys.has(name), `${code}: biến "${name}" khai trong availableVariables nhưng trigger không truyền`).toBe(true);
      }
    });
  }

  it("mọi code trong DEFS đều có SAMPLE_VARS và ngược lại", () => {
    expect(Object.keys(SAMPLE_VARS).sort()).toEqual(Object.keys(EMAIL_TEMPLATE_DEFS).sort());
  });
});
