// @vitest-environment node
/**
 * EL-14c — màn dựng đề.
 *
 * Nhóm nặng nhất ở đây không phải giao diện mà là **cổng và cửa**: đề dựng được
 * nhưng người học chưa thi được, nên loại bài "Bài kiểm tra" phải CÒN KHOÁ. Mở nó
 * bây giờ là dựng lại đúng cái bẫy vừa gỡ ở PR trước — người soạn gắn được đề vào
 * bài, khoá xuất bản trót lọt, và người học mở ra thì kẹt.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { laLoaiBaiDaMo, LOAI_BAI_CHUA_MO } from "@/lib/elearning/lesson-kind";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DS = doc("app/(elearning)/elearning/de-thi/page.tsx");
const CHI_TIET = doc("app/(elearning)/elearning/de-thi/[examId]/page.tsx");
const BUILDER = doc("app/(elearning)/elearning/de-thi/_components/exam-builder.tsx");
const FORM = doc("app/(elearning)/elearning/de-thi/_components/new-exam-form.tsx");
const CHUONG_TRINH = doc("app/(elearning)/elearning/chuong-trinh/page.tsx");
const ACTIONS = doc("app/(elearning)/elearning/de-thi/_actions.ts");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("🔴 cổng và cửa — `QUIZ` mở CÙNG đường làm bài", () => {
  it("`QUIZ` đã mở cùng đường làm bài", () => {
    // Ở PR dựng đề (EL-14c) loại này còn khoá, đúng — lúc đó mới có một đầu. Nay
    // đủ hai đầu: dựng đề, gắn đề vào bài, và người học thi được.
    expect(laLoaiBaiDaMo("QUIZ")).toBe(true);
    // `SCORM` vẫn là loại còn đóng, và danh sách đó không được rỗng âm thầm.
    expect(LOAI_BAI_CHUA_MO.SCORM).toBeTruthy();
  });

  it("màn đề nói rõ BƯỚC TIẾP, không để người soạn dừng giữa chừng", () => {
    // Đề không tự tới người học; nó tới qua một bài dạng "Bài kiểm tra".
    expect(DS).toContain("Bài kiểm tra");
  });

  it("màn tạo đề vẫn KHÔNG phơi `lessonId`", () => {
    // Đường nối là `TrnLesson.examId`, đặt ở màn soạn BÀI. Phơi thêm một đường thứ
    // hai ở đây là hai nguồn sự thật cho cùng một quan hệ.
    expect(chiMa(FORM)).not.toContain("lessonId");
  });
});

describe("ranh giới nháp / đã kích hoạt hiện ra trên màn hình", () => {
  it("đề đã kích hoạt thì màn chỉ ĐỌC", () => {
    // Server cũng chặn, nhưng để bấm được rồi mới báo lỗi là bắt người soạn thao
    // tác một vòng vô ích — và với nút Kích hoạt thì họ tưởng mình làm hỏng gì đó.
    expect(chiMa(BUILDER)).toContain("if (props.isActive)");
    expect(BUILDER).toContain("đã đóng băng");
  });

  it("cảnh báo điểm đạt vượt tổng điểm TRƯỚC khi bấm kích hoạt", () => {
    // Đợi tới lúc bấm mới báo là để họ dựng xong cả đề rồi mới biết nó hỏng.
    expect(chiMa(BUILDER)).toContain("props.passScore > tong");
    expect(BUILDER).toContain("không ai qua được");
  });

  it("nút kích hoạt khoá khi đề rỗng hoặc điểm đạt vượt thang", () => {
    expect(chiMa(BUILDER)).toContain("props.cacCau.length === 0 || props.passScore > tong");
  });

  it("người không có quyền xuất bản được NÓI vì sao không kích hoạt được", () => {
    expect(BUILDER).toContain("cần quyền xuất bản");
  });
});

describe("cách ly cơ sở đi qua `scopedDb`", () => {
  it("cả hai màn đọc bằng `scopedDb`, không `db` trần", () => {
    // Đọc bằng `db` trần rồi tự so `centerId` là dựng bản kiểm phạm vi thứ hai, và
    // bản thứ hai sẽ lệch.
    for (const [ten, src] of [
      ["danh sách", DS],
      ["chi tiết", CHI_TIET],
    ] as const) {
      expect(chiMa(src), ten).toContain("scopedDb(actor)");
      expect(chiMa(src), ten).not.toContain('from "@/lib/db"');
    }
  });

  it("đề không thuộc phạm vi ⇒ màn nói rõ, không hiện trang trắng", () => {
    expect(CHI_TIET).toContain("thuộc cơ sở khác");
  });
});

describe("kho câu còn lại lọc Ở SERVER", () => {
  it("lọc bằng `questionId`, không phải `TrnExamQuestion.id`", () => {
    // Hai id này khác nhau; so nhầm thì bộ lọc luôn cho qua, cả kho hiện ra như
    // thể chưa câu nào được dùng, và người soạn thêm trùng rồi mới nhận lỗi khoá.
    expect(chiMa(CHI_TIET)).toContain("select: { questionId: true }");
    expect(chiMa(CHI_TIET)).toContain("!dungTrongDe.has(q.id)");
  });
});

describe("cấu hình action ở lib, tệp `use server` chỉ là vỏ", () => {
  it("`_actions.ts` không chứa logic", () => {
    expect(ACTIONS).toContain("@/lib/elearning/exam-authoring");
    expect(chiMa(ACTIONS)).not.toContain("z.object");
    expect(chiMa(ACTIONS)).not.toContain("handler:");
  });
});

describe("trang có LỐI VÀO", () => {
  it("màn chương trình dẫn tới màn đề thi", () => {
    expect(CHUONG_TRINH).toContain('href="/elearning/de-thi"');
  });
});
