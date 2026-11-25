// @vitest-environment node
/**
 * EL-14b — màn kho câu hỏi.
 *
 * Hai thứ canh ở đây đều hỏng theo hướng KHÔNG THẤY ĐƯỢC:
 *  · nội dung câu hỏi đi xuống người không có quyền — ẩn bằng CSS thì đề bài và
 *    đáp án vẫn nằm trong HTML, và cả kho mất giá trị vì một cú F12;
 *  · trang không có lối vào — khu e-learning không có thanh điều hướng chung, nên
 *    một màn không được màn nào dẫn tới thì chỉ người viết nó biết đường.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const TRANG = doc("app/(elearning)/elearning/kho-cau-hoi/page.tsx");
const FORM = doc("app/(elearning)/elearning/kho-cau-hoi/_components/question-form.tsx");
const DS = doc("app/(elearning)/elearning/kho-cau-hoi/_components/bank-list.tsx");
const CHUONG_TRINH = doc("app/(elearning)/elearning/chuong-trinh/page.tsx");
const ACTIONS = doc("app/(elearning)/elearning/kho-cau-hoi/_actions.ts");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("🔴 nội dung câu hỏi cắt ở SERVER, không ẩn ở giao diện", () => {
  it("`stem` chỉ đi xuống khi có quyền", () => {
    // Đây là chỗ cắt thật. Gửi xuống rồi ẩn là để đề bài nằm trong HTML.
    expect(chiMa(TRANG)).toContain("stem: xemNoiDung ? c.stem : null");
  });

  it("`chiTiet` (kèm đáp án) cũng chỉ đi xuống khi có quyền", () => {
    // `choices` mang `isCorrect` — đây là đáp án đúng, thứ tuyệt đối không được
    // gửi cho người không có quyền soạn.
    expect(chiMa(TRANG)).toContain("chiTiet: xemNoiDung");
  });

  it("giao diện KHÔNG tự dựng nội dung từ nguồn nào khác", () => {
    // Nếu danh sách tự đọc `isCorrect` từ đâu đó thì phép cắt ở server thành vô
    // nghĩa.
    expect(chiMa(DS)).not.toContain("isCorrect");
  });
});

describe("cổng quyền hai tầng", () => {
  it("vào màn bằng `content:author`, thấy nội dung bằng `content:publish`", () => {
    // Nghiệm thu đòi "chỉ Đào tạo + Quản trị tối cao thấy ngân hàng câu hỏi",
    // nhưng không khoá nào trong bộ 17 có đúng tập vai đó. Hai tầng giữ đúng phần
    // quan trọng mà không phải mở khoá thứ 18 — mở khoá mới là phải chạy
    // `seed-prod-roles.yml` từ `main` sau merge.
    expect(chiMa(TRANG)).toContain('can(actor, "elearning:content:author")');
    expect(chiMa(TRANG)).toContain('can(actor, "elearning:content:publish")');
  });

  it("người không thấy nội dung được NÓI vì sao, không để họ tưởng kho rỗng", () => {
    expect(DS).toContain("không xem được nội dung");
  });
});

describe("màn soạn chỉ hiện loại câu DÙNG ĐƯỢC", () => {
  it("đọc từ nguồn chung, không chép tay danh sách loại", () => {
    // Chép tay là danh sách trôi khỏi bộ chấm ngay lần đầu ai đó mở thêm một loại.
    expect(chiMa(FORM)).toContain("LOAI_CHAM_MAY");
    expect(chiMa(FORM)).toContain("LOAI_CHAM_TAY");
  });

  it("🔴 ô đánh dấu đúng đổi hình theo LOẠI câu", () => {
    // Dùng nút tròn cho cả câu nhiều-đáp-án là biến nhãn trên màn hình thành lời
    // nói dối — lỗi đã mắc một lần ở câu hỏi chèn giữa video.
    expect(chiMa(FORM)).toContain('type={type === "MULTIPLE" ? "checkbox" : "radio"}');
  });

  it("🔴 cờ đúng/sai đi CÙNG từng ô, không gửi chỉ số riêng", () => {
    // Gửi chỉ số của mảng chưa lọc kèm mảng đã lọc là sinh ra câu trỏ đáp án ra
    // ngoài danh sách — câu không ai trả lời đúng được. Lỗi đã mắc ở màn soạn cue.
    expect(chiMa(FORM)).not.toContain("correctIndex");
    expect(chiMa(FORM)).toContain("luaChon.filter((x) => x.text.trim())");
  });

  it("chặn tại chỗ khi ô được đánh dấu đúng bị bỏ trống", () => {
    expect(FORM).toContain("Ô được đánh dấu đúng đang để trống");
  });
});

describe("câu đã vào đề thì khoá nút sửa", () => {
  it("nút Sửa bị khoá, kèm lý do", () => {
    // Server cũng từ chối, nhưng để bấm được rồi mới báo lỗi là bắt người soạn gõ
    // lại từ đầu.
    expect(chiMa(DS)).toContain("disabled={d.daVaoDe}");
    expect(DS).toContain("nhân bản thay vì sửa");
  });
});

describe("trang có LỐI VÀO", () => {
  it("màn chương trình dẫn tới kho câu hỏi", () => {
    // Khu e-learning không có thanh điều hướng chung, nên mỗi màn mới phải được
    // một màn cũ dẫn tới.
    expect(CHUONG_TRINH).toContain('href="/elearning/kho-cau-hoi"');
  });
});

describe("cấu hình action ở lib, tệp `use server` chỉ là vỏ", () => {
  it("`_actions.ts` không chứa logic", () => {
    // Quy ước 10: tệp `"use server"` không nạp được trong vitest, nên logic ở đó là
    // buộc test chép lại cấu hình — và bản được kiểm không phải bản đang chạy.
    expect(ACTIONS).toContain("@/lib/elearning/question-bank");
    expect(chiMa(ACTIONS)).not.toContain("z.object");
    expect(chiMa(ACTIONS)).not.toContain("handler:");
  });
});
