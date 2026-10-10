// @vitest-environment node
/**
 * EL-04 — trình soạn bài đọc.
 *
 * Trình soạn là tính năng HẠNG NHẤT của module: dự án không còn chốt danh mục
 * khoá, nên nếu soạn bài khó thì danh mục trống vào ngày mở — đúng rủi ro số 1.
 *
 * Case đắt nhất ở đây là "xem trước KHỚP trang học". Hai bộ render khác nhau là
 * cách chắc chắn nhất để người soạn thấy một đằng, người học thấy một nẻo — và họ
 * chỉ phát hiện SAU KHI bài đã phát ra.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");
/**
 * Bỏ bình luận trước khi quét "không được chứa X".
 *
 * Bản đầu quét cả bình luận và đỏ vì một dòng GHI CHÚ giải thích "gate ở đây là
 * content:author, KHÁC lesson:learn". Đó là test bắt mã sửa cho vừa test: ghi chú đó
 * đáng giữ, và xóa nó đi để test xanh là mất đúng thứ nói cho người sau biết vì sao.
 */
const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const SOAN = doc("app/(elearning)/elearning/soan/_components/lesson-editor.tsx");
const TRANG_SOAN = doc("app/(elearning)/elearning/soan/[lessonId]/page.tsx");
const TRANG_HOC = doc(
  "app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx",
);
const ACTION = doc("app/(elearning)/elearning/soan/_actions.ts");

describe("xem trước phải khớp trang học", () => {
  it("cả hai dùng CÙNG MarkdownRenderer", () => {
    for (const [ten, src] of [
      ["trình soạn", SOAN],
      ["trang học", TRANG_HOC],
    ] as const) {
      expect(src, ten).toContain("MarkdownRenderer");
      expect(src, ten).toContain("@/components/blog/markdown-renderer");
    }
  });

  it("cả hai đều hạ H1 bằng CÙNG hàm demoteH1", () => {
    // Không hạ ở khung xem trước thì người soạn THẤY tiêu đề, còn trang học NUỐT
    // mất — và không có thông báo nào giải thích khoảng trống đó.
    for (const [ten, src] of [
      ["trình soạn", SOAN],
      ["trang học", TRANG_HOC],
    ] as const) {
      expect(src, ten).toMatch(/demoteH1\(/);
    }
  });
});

describe("ngưỡng đọc: một công thức, không hai", () => {
  it("client hiện ngưỡng bằng CHÍNH hàm server dùng lúc lưu", () => {
    // Ước lượng lại ở client bằng công thức riêng thì con số hiện cho người soạn
    // là một LỜI HỨA SAI: họ thấy 60 giây, hệ thống lưu 90.
    expect(SOAN).toContain("computeMinReadSeconds");
    expect(ACTION).toContain("computeMinReadSeconds");
  });

  it("action lưu CỨNG minReadSeconds, không để trang đọc tính lại", () => {
    // Tính lại theo từng lượt xem nghĩa là sửa một chữ trong bài cũng đổi ngưỡng
    // của người đang đọc dở — họ ở giữa chừng thì đột nhiên "chưa đủ".
    expect(ACTION).toContain("minReadSeconds,");
    expect(TRANG_HOC).not.toContain("computeMinReadSeconds");
  });
});

describe("gate soạn bài KHÁC gate học bài", () => {
  it("trang soạn gác bằng elearning:content:author", () => {
    expect(TRANG_SOAN).toContain('can(actor, "elearning:content:author")');
  });

  it("action cũng gác bằng đúng khoá đó — không dựa vào gate trang", () => {
    // Gate trang giữ cho người ta không soạn xong mới biết mình không có quyền;
    // gate action mới là thứ chặn thật. Thiếu cái sau thì gọi thẳng action là qua.
    expect(ACTION).toContain('permission: "elearning:content:author"');
  });

  it("KHÔNG dùng nhầm quyền học để gác việc soạn", () => {
    expect(chiMa(TRANG_SOAN)).not.toContain("elearning:lesson:learn");
    expect(chiMa(ACTION)).not.toContain("elearning:lesson:learn");
  });
});

describe("bản nháp không được ghi đè công của người khác", () => {
  it("có bản nháp thì BÁO, không tự khôi phục", () => {
    // Bản nháp trên máy này có thể CŨ HƠN bản người khác vừa lưu trên server. Tự
    // khôi phục là âm thầm ghi đè công của họ bằng bản cũ.
    expect(SOAN).toContain("setCoBanNhap(true)");
    expect(SOAN).toContain("Khôi phục");
    expect(SOAN).toContain("Bỏ bản nháp");
  });

  it("localStorage hỏng/đầy không làm chết trình soạn", () => {
    const soTryCatch = (SOAN.match(/try \{/g) ?? []).length;
    expect(soTryCatch).toBeGreaterThanOrEqual(3);
  });

  it("lưu thành công thì XOÁ bản nháp", () => {
    // Không xoá thì lần mở sau vẫn báo "có bản nháp", và người ta sẽ khôi phục
    // đúng cái vừa lưu — vô hại lần đầu, gây nghi ngờ từ lần thứ hai.
    expect(SOAN).toContain("removeItem(khoa)");
  });
});

describe("file `use server` chỉ export hàm async", () => {
  it("mọi export const đều là defineAction", () => {
    // `export const` lạc vào file `"use server"` làm Server Action vỡ LÚC CHẠY
    // (E352) mà `pnpm build` vẫn xanh.
    for (const m of ACTION.matchAll(/^export\s+const\s+(\w+)/gm)) {
      const sau = ACTION.slice(m.index ?? 0, (m.index ?? 0) + 200);
      expect(sau, m[1]).toContain("defineAction(");
    }
  });
});
