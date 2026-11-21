// @vitest-environment node
// [BTV] Bài tập NỘP VIDEO (12/11/2026): trần riêng cho video, bắt buộc video ở SERVER, giao bài có cờ, xem video trên màn chấm.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPortalSubmissionSchema, PORTAL_SUBMISSION_MAX_FILE_SIZE, PORTAL_SUBMISSION_MAX_VIDEO_SIZE } from "./portal-submission";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const R2 = "https://cdn.satarobo.test";
const schema = buildPortalSubmissionSchema(R2);
const tep = (fileSize: number, mimeType: string, ten = "bai.mp4") => ({
  assignmentId: "a1",
  files: [{ fileUrl: `${R2}/uploads/submissions/2026-11/${ten}`, fileName: ten, fileSize, mimeType }],
});

describe("[BTV] trần dung lượng theo loại tệp", () => {
  it("[BTV-01] video lớn tới 120MB qua; vượt 120MB thì bị từ chối", () => {
    expect(PORTAL_SUBMISSION_MAX_VIDEO_SIZE).toBe(120 * 1024 * 1024);
    expect(schema.safeParse(tep(100 * 1024 * 1024, "video/mp4")).success).toBe(true);
    expect(schema.safeParse(tep(PORTAL_SUBMISSION_MAX_VIDEO_SIZE, "video/webm", "b.webm")).success).toBe(true);
    expect(schema.safeParse(tep(PORTAL_SUBMISSION_MAX_VIDEO_SIZE + 1, "video/mp4")).success).toBe(false);
  });

  it("[BTV-02] KHÔNG nới trần cho ảnh/tài liệu: tệp không phải video vẫn bị chặn ở trần cũ", () => {
    expect(schema.safeParse(tep(PORTAL_SUBMISSION_MAX_FILE_SIZE, "application/pdf", "a.pdf")).success).toBe(true);
    expect(schema.safeParse(tep(PORTAL_SUBMISSION_MAX_FILE_SIZE + 1, "application/pdf", "a.pdf")).success).toBe(false);
    expect(schema.safeParse(tep(100 * 1024 * 1024, "image/png", "a.png")).success).toBe(false);
    // Khai láo mimeType video cho tệp rõ ràng không phải video vẫn không vượt được trần video.
    expect(schema.safeParse(tep(PORTAL_SUBMISSION_MAX_VIDEO_SIZE + 5, "video/mp4")).success).toBe(false);
  });

  it("[BTV-03] URL tệp vẫn phải thuộc kho của app (không nới cổng chống phishing)", () => {
    const x = { assignmentId: "a1", files: [{ fileUrl: "https://evil.test/v.mp4", fileName: "v.mp4", fileSize: 1000, mimeType: "video/mp4" }] };
    expect(schema.safeParse(x).success).toBe(false);
  });
});

describe("[BTV-W] dây nối", () => {
  it("[BTV-W1] nộp bài: bài YÊU CẦU VIDEO mà không có tệp video ⇒ từ chối Ở SERVER (trước khi ghi)", () => {
    const s = doc("app/(portal)/portal/bai-tap/actions.ts");
    expect(s).toContain("requireVideo: true,");
    const kiem = s.indexOf("assignment.requireVideo && !files.some(");
    expect(kiem).toBeGreaterThan(-1);
    expect(s).toContain('(f.mimeType ?? "").startsWith("video/")');
    expect(kiem).toBeLessThan(s.indexOf("portalTx(") === -1 ? s.length : s.indexOf("portalTx("));
  });

  it("[BTV-W2] presign video: chỉ PARENT, chỉ khi mục Bài tập đang mở, trần 120MB", () => {
    const r = doc("app/api/portal/upload-url/route.ts");
    expect(r).toContain('"video"');
    expect(r).toContain('category === "video" && !mucBaiTapBaiThiDangHien()');
    expect(r).toContain("PORTAL_VIDEO_MAX_BYTES");
    expect(r).toContain('session.user.role !== "PARENT"');
  });

  it("[BTV-W3] «Nộp video» là MỘT LOẠI CÂU HỎI: đầu bài có câu video ⇒ Assignment.requireVideo + bật allowFile; hộp tích riêng ở màn giao bài đã GỠ", () => {
    const a = doc("app/(teacher)/teacher/cham-bai/_actions.ts");
    expect(a).toContain("const coVideo = coCauNopVideo(links.map((l) => l.question));");
    expect(a).toContain("requireVideo: coVideo,");
    expect(a).toMatch(/coVideo \? \{ allowFile: true \} : \{\}/);
    expect(a).not.toContain("yeuCauVideo");
    const d = doc("app/(teacher)/teacher/cham-bai/_components/assign-dialog.tsx");
    expect(d).not.toContain("yeuCauVideo");
    expect(d).not.toContain("Yêu cầu học viên nộp video");
    // hai đường tạo bài còn lại cũng đi theo loại câu hỏi
    expect(doc("app/(admin)/admin/assignments/templates/_actions.ts")).toContain("requireVideo: true, allowFile: true");
    expect(doc("lib/lms/assignment.ts")).toContain('requireVideo: t.templateQuestions.some((tq) => tq.question.type === "VIDEO")');
  });

  it("[BTV-W4] màn chấm của giáo viên phát video NGAY (khung bấm mở to, có controls, từ URL kho), không chỉ link tải; CẢ HAI chỗ dựng màn chấm đều truyền mime", () => {
    expect(doc("app/(teacher)/teacher/cham-bai/_components/grade-form.tsx")).toContain("<BaiNopMedia");
    const m = doc("app/(teacher)/teacher/cham-bai/_components/bai-nop-media.tsx");
    expect(m).toMatch(/<video[\s\S]{0,260}controls/);
    expect(m).toContain("autoPlay");
    // Lỗi 12/11: chỉ trang chấm bài truyền mime, Class Hub thì không ⇒ video ở Class Hub hiện thành LINK TẢI.
    expect(doc("app/(teacher)/teacher/cham-bai/page.tsx")).toContain("mime: f.mimeType,");
    const hub = doc("app/(teacher)/teacher/lop/_components/hub-assignments-tab.tsx");
    expect(hub).toContain("mime: f.mimeType,");
    expect(hub).toMatch(/fileSize: true, mimeType: true/);
  });

  it("[BTV-W5] cả hai form nộp (phụ huynh + học sinh) nhận cờ BẮT BUỘC và đòi video ở client; hai trang đều truyền cờ", () => {
    for (const f of ["app/(portal)/portal/bai-tap/[assignmentId]/_components/submit-form.tsx", "components/portal/hv-nop-bai.tsx"]) {
      const s = doc(f);
      expect(s, f).toMatch(/\byeuCauVideo: boolean;/);
      expect(s, f).not.toMatch(/\byeuCauVideo\?:/);
      expect(s, f).toContain("<VideoUpload");
    }
    for (const f of ["app/(portal)/portal/bai-tap/[assignmentId]/page.tsx", "app/(portal)/portal/hoc-sinh/(hoc-sinh)/bai-tap/[assignmentId]/page.tsx"]) {
      expect(doc(f), f).toContain("yeuCauVideo={a.requireVideo}");
    }
  });

  it("[BTV-W6] migration cộng ĐÚNG một cột mặc định false; schema khớp", () => {
    const m = readFileSync(resolve(process.cwd(), "prisma/migrations/20261201090000_bai_tap_yeu_cau_video/migration.sql"), "utf8");
    expect(m).toMatch(/ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "requireVideo" BOOLEAN NOT NULL DEFAULT false;/);
    expect(m).not.toMatch(/DROP|ALTER COLUMN|UPDATE/i);
    expect(readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8")).toMatch(/requireVideo Boolean @default\(false\)/);
  });
});

describe("[BTV-Q] câu NỘP VIDEO không làm hỏng các luồng quanh nó (12/11/2026)", () => {
  it("[BTV-Q1] học viên thấy đề câu video: CẢ BA đường tạo bài ghép đề vào Assignment.instructions", () => {
    expect(doc("app/(teacher)/teacher/cham-bai/_actions.ts")).toContain("ghepDeBaiVideo(template.instructions");
    expect(doc("app/(admin)/admin/assignments/templates/_actions.ts")).toContain("ghepDeBaiVideo(data.instructions");
    expect(doc("lib/lms/assignment.ts")).toContain("ghepDeBaiVideo(t.instructions");
  });

  it("[BTV-Q2] bài tập quay video vẫn là BÀI TẬP, không thành «Kiểm tra»: hai chỗ đếm câu hỏi loại câu video ra", () => {
    for (const f of ["app/(teacher)/teacher/cham-bai/page.tsx", "app/(teacher)/teacher/hoc-vien/page.tsx"]) {
      expect(doc(f), f).toContain('questions: { where: { type: { not: "VIDEO" } } }');
    }
  });

  it("[BTV-Q3] câu video KHÔNG vào đề thi online: ngân hàng của trình dựng đề + sinh đề ngẫu nhiên đều loại VIDEO", () => {
    expect(doc("app/(admin)/admin/exams/[id]/builder/page.tsx")).toContain('type: { not: "VIDEO" }');
    const a = doc("app/(admin)/admin/exams/_actions.ts");
    expect(a).toContain('{ isPublic: true, type: { not: "VIDEO" } }');
    expect(a).toContain('parsed.data.type !== "VIDEO"');
  });

  it("[BTV-Q4] migration chỉ THÊM đúng một giá trị enum; schema khớp", () => {
    const m = readFileSync(resolve(process.cwd(), "prisma/migrations/20261202090000_cau_hoi_nop_video/migration.sql"), "utf8");
    expect(m).toMatch(/ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'VIDEO';/);
    expect(m.replace(/--.*$/gm, "")).not.toMatch(/DROP|UPDATE|DELETE/i);
    expect(readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8")).toMatch(/ORDERING\r?\n[^}]*\r?\n\s*VIDEO\r?\n}/);
  });

  it("[BTV-Q5] ô nộp video không còn trần thời lượng; chỉ còn trần dung lượng, và tệp vượt trần dung lượng vẫn bị ép nén dù dài bao lâu", () => {
    const v = doc("components/assignments/video-upload.tsx");
    expect(v).not.toMatch(/TOI_DA_GIAY\b/);
    expect(v).not.toMatch(/tối đa \{?\d*\}? ?giây/);
    expect(v).toContain("ts.giay <= TOI_DA_GIAY_DE_NEN || f.size > TOI_DA_BYTE");
  });
});
