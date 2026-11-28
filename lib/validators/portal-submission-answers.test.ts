// @vitest-environment node
// [BTC] Học viên làm bài tập TỪNG CÂU (26/11/2026): schema đáp án + lưới ghim dây nối (luật 11 — quên nối là lỗi CÂM).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPortalSubmissionSchema, PORTAL_SUBMISSION_MAX_ANSWERS } from "./portal-submission";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const schema = buildPortalSubmissionSchema("https://cdn.satarobo.test");
const nop = (answers: unknown) => schema.safeParse({ assignmentId: "a1", answers });

describe("[BTC-01] schema đáp án từng câu", () => {
  it("mọi hình dạng đáp án hợp lệ đều qua", () => {
    expect(
      nop([
        { questionId: "q1", dapAn: { k: "single", i: 1 } },
        { questionId: "q2", dapAn: { k: "multiple", i: [0, 3] } },
        { questionId: "q3", dapAn: { k: "boolean", v: true } },
        { questionId: "q4", dapAn: { k: "fill", t: ["2", "ba"] } },
        { questionId: "q5", dapAn: { k: "text", t: "robot" } },
        { questionId: "q6", dapAn: { k: "matching", r: ["một", "hai"] } },
        { questionId: "q7", dapAn: { k: "ordering", o: ["1", "2"] } },
      ]).success,
    ).toBe(true);
  });
  it("hình dạng lạ / thiếu trường / chuỗi quá dài / quá nhiều câu đều bị từ chối", () => {
    expect(nop([{ questionId: "q1", dapAn: { k: "lạ", i: 1 } }]).success).toBe(false);
    expect(nop([{ questionId: "q1", dapAn: { k: "single" } }]).success).toBe(false);
    expect(nop([{ questionId: "q1", dapAn: { k: "single", i: 1.5 } }]).success).toBe(false);
    expect(nop([{ questionId: "q1", dapAn: { k: "text", t: "x".repeat(2001) } }]).success).toBe(false);
    expect(nop([{ questionId: "", dapAn: { k: "boolean", v: true } }]).success).toBe(false);
    const nhieu = Array.from({ length: PORTAL_SUBMISSION_MAX_ANSWERS + 1 }, (_, i) => ({ questionId: `q${i}`, dapAn: { k: "boolean", v: true } }));
    expect(nop(nhieu).success).toBe(false);
  });
  it("bài không có câu hỏi vẫn nộp được như cũ (không khai answers)", () => {
    expect(schema.safeParse({ assignmentId: "a1", textAnswer: "bài làm" }).success).toBe(true);
  });
});

describe("[BTC-02] lưới ghim dây nối — quên nối là học viên mất câu hỏi mà KHÔNG lỗi nào báo", () => {
  const action = doc("app/(portal)/portal/bai-tap/actions.ts");

  it("action đọc câu hỏi Ở SERVER, kiểm từng đáp án, chấm, rồi ghi bảng câu trả lời", () => {
    expect(action).toMatch(/pdb\.question\.findMany\(/);
    expect(action).toMatch(/kiemDapAn\(/);
    expect(action).toMatch(/chamBai\(/);
    expect(action).toMatch(/tx\.assignmentAnswer\.createMany\(/);
    // nộp lại thay hẳn bộ cũ — thiếu deleteMany thì câu đã bỏ trống ở lần nộp mới vẫn mang đáp án cũ
    expect(action).toMatch(/tx\.assignmentAnswer\.deleteMany\(/);
  });
  it("câu trả lời tính là NỘI DUNG của bài nộp (bài trắc nghiệm thuần không văn bản/tệp vẫn hợp lệ)", () => {
    expect(action).toMatch(/dapAnTheoCau\.size === 0/);
  });
  it("câu trả lời của câu KHÔNG thuộc bài (hoặc câu video) làm hỏng cả lượt nộp, không bị bỏ qua im lặng", () => {
    expect(action).toMatch(/!c \|\| c\.q\.type === "video"/);
  });
  it("cả hai trang chi tiết bài truyền ĐỦ câu hỏi + câu trả lời cũ cho form", () => {
    for (const p of ["app/(portal)/portal/bai-tap/[assignmentId]/page.tsx", "app/(portal)/portal/hoc-sinh/(hoc-sinh)/bai-tap/[assignmentId]/page.tsx"]) {
      const s = doc(p);
      expect(s, p).toMatch(/cauHoi=\{a\.questions\}/);
      expect(s, p).toMatch(/initialAnswers=\{sub\?\.answers \?\? \[\]\}/);
    }
  });
  it("cả hai form khai cauHoi BẮT BUỘC (không dấu ?) và gửi answers lên action", () => {
    for (const p of ["app/(portal)/portal/bai-tap/[assignmentId]/_components/submit-form.tsx", "components/portal/hv-nop-bai.tsx"]) {
      const s = doc(p);
      expect(s, p).toMatch(/\bcauHoi: CauHoiHocVien\[\];/);
      expect(s, p).toMatch(/answers: dapAnDeGui\(dapAn\)/);
    }
  });
  it("màn chấm của giáo viên (cả hai chỗ) đọc bài làm từng câu và đưa vào GradeForm", () => {
    for (const p of ["app/(teacher)/teacher/cham-bai/page.tsx", "app/(teacher)/teacher/lop/_components/hub-assignments-tab.tsx"]) {
      const s = doc(p);
      expect(s, p).toMatch(/docBaiLamChoGV\(/);
      expect(s, p).toMatch(/bai=\{baiLam\}/);
    }
  });
  it("loader cổng học viên bỏ đáp án đúng bằng toCauHoiHocVien và CHỈ báo đúng/sai khi bài đã chấm", () => {
    const s = doc("lib/portal/learning.ts");
    expect(s).toMatch(/toCauHoiHocVien\(deserializeQuestionRow\(r\)/);
    expect(s).toMatch(/dung: daCham && r\.autoRatio != null/);
  });
});
