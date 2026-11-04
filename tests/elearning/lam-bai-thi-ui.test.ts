// @vitest-environment node
/**
 * EL-14d — trang làm bài thi.
 *
 * Nhóm nặng nhất: **chống lộ đề**, và nó phải kiểm ở TẦNG DỮ LIỆU. Ẩn đáp án bằng
 * CSS là để nó nằm trong thân phản hồi — không ai thấy trên màn hình, nhưng nó
 * nằm trong tab Network và trong mọi bộ nhớ đệm, và cả ngân hàng câu hỏi mất giá
 * trị bằng một cú F12.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { locCauHoiChoNguoiHoc, type CauHoiCue } from "@/lib/elearning/lesson-cue";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const VIEW = doc("lib/elearning/exam-view.ts");
const RUNNER = doc("app/(elearning)/elearning/hoc/_components/exam-runner.tsx");
const TRANG = doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx");
const ACTIONS = doc("app/(elearning)/elearning/hoc/_actions.ts");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("🔴 chống lộ đề — kiểm ở TẦNG DỮ LIỆU", () => {
  it("phần gửi xuống người thi KHÔNG mang đáp án đúng", () => {
    // Kiểm trên JSON đã serialize: đây là thứ thật sự đi qua dây.
    const q: CauHoiCue = {
      id: "q1",
      type: "single",
      question: "Bước nào trước?",
      options: ["A", "B", "C"],
      correctIndex: 2,
    };
    const s = JSON.stringify(locCauHoiChoNguoiHoc(q));
    expect(s).not.toContain("correctIndex");
    expect(s).toContain("Bước nào trước");
  });

  it("dữ liệu trang đi QUA hàm lọc, không bơm `contentJson` thô", () => {
    expect(chiMa(VIEW)).toContain("locCauHoiChoNguoiHoc");
    // `contentJson` chỉ được đọc để PHÂN TÍCH, không được đưa thẳng vào kết quả.
    expect(chiMa(VIEW)).not.toContain("contentJson: c.question.contentJson");
  });

  it("kiểu dữ liệu trang KHÔNG có chỗ cho đáp án", () => {
    // Nếu kiểu có trường đáp án thì sớm muộn có người điền vào nó.
    expect(chiMa(VIEW)).not.toContain("isCorrect");
    expect(chiMa(RUNNER)).not.toContain("isCorrect");
    expect(chiMa(RUNNER)).not.toContain("correctIndex");
  });

  it("giải thích đáp án cũng KHÔNG đi xuống lúc đang thi", () => {
    expect(chiMa(VIEW)).not.toContain("explanation");
  });
});

describe("trộn thứ tự không làm lệch chấm", () => {
  it("trộn CÂU và trộn LỰA CHỌN, nhưng mã giữ nguyên chỉ số gốc", () => {
    // Trộn cả mã thì server chấm theo một thứ tự, client hiện theo thứ tự khác, và
    // người bấm đúng bị chấm sai.
    expect(chiMa(VIEW)).toContain("de.shuffleQuestions ? tron(dung, dangMo.id)");
    expect(chiMa(VIEW)).toContain("tron(loc.luaChon,");
    // `locCauHoiChoNguoiHoc` sinh `ma` từ chỉ số gốc; hàm trộn chỉ đảo thứ tự phần
    // tử, không đánh số lại.
    expect(chiMa(VIEW)).not.toContain("ma: String(i)");
  });
});

describe("lưu dần từng câu", () => {
  it("lưu ngay khi bấm, không gom tới lúc nộp", () => {
    // Gom lại là để mất mạng mười giây thành mất cả bài.
    expect(chiMa(RUNNER)).toContain("luuCauTraLoiAction");
    const iChon = chiMa(RUNNER).indexOf("const chon = (c: CauDeThi");
    const than = chiMa(RUNNER).slice(iChon, iChon + 500);
    expect(than).toContain("luuCau(");
  });

  it("🔴 lỗi lưu MỘT câu không làm hỏng cả bài", () => {
    // Người học vẫn phải làm tiếp được, và nút Nộp vẫn còn đó.
    const i = chiMa(RUNNER).indexOf("if (!r.ok) toast.error");
    expect(i).toBeGreaterThan(0);
    const than = chiMa(RUNNER).slice(i, i + 200);
    expect(than).not.toContain("throw");
  });

  it("chặn chồng lệnh cho CÙNG một câu", () => {
    // Bấm nhanh hai lần thì lệnh sau có thể về trước, và lựa chọn cũ ghi đè lựa
    // chọn mới.
    expect(chiMa(RUNNER)).toContain("dangLuu.current.has(examQuestionId)");
  });
});

describe("đồng hồ", () => {
  it("hết giờ KHÔNG tự nộp", () => {
    // Tự nộp là cướp mất giây cuối của người đang gõ dở.
    expect(chiMa(RUNNER)).not.toContain("conLai === 0 && nop");
    expect(RUNNER).toContain("bấm “Nộp bài”");
  });

  it("đồng hồ hiển thị KÈM ân hạn, đúng con số server dùng", () => {
    // Hiện hạn CHẶT hơn hạn thật là làm người học hoảng và nộp sớm; lỏng hơn là để
    // họ tin mình còn giờ trong khi server đã đóng.
    expect(chiMa(VIEW)).toContain("AN_HAN_GIAY");
  });
});

describe("trang học mở nhánh bài KIỂM TRA", () => {
  it("có nhánh `QUIZ` và nạp `examId`", () => {
    expect(chiMa(TRANG)).toContain('lesson.kind === "QUIZ"');
    expect(chiMa(TRANG)).toContain("examId: true");
  });

  it("bài chưa gắn đề ⇒ nói rõ, không hiện khung làm bài rỗng", () => {
    expect(TRANG).toContain("chưa có đề");
  });

  it("đề chưa kích hoạt ⇒ nói rõ, không cho thi", () => {
    // Thi trên đề nháp là chấm trên một thang có thể đổi sau lưng người học.
    expect(TRANG).toContain("chưa được kích hoạt");
  });
});

describe("cấu hình action ở lib, tệp `use server` chỉ là vỏ", () => {
  it("`_actions.ts` không chứa logic", () => {
    expect(ACTIONS).toContain("@/lib/elearning/exam-taking");
    expect(chiMa(ACTIONS)).not.toContain("z.object");
    expect(chiMa(ACTIONS)).not.toContain("handler:");
  });
});

describe("🔴 trộn TẤT ĐỊNH, không ngẫu nhiên mỗi lượt tải", () => {
  it("không dùng `Math.random()`", () => {
    // Trang này là Server Component: nó chạy lại mỗi lượt tải. Trộn ngẫu nhiên
    // nghĩa là thứ tự lựa chọn NHẢY LOẠN mỗi lần người học tải lại trang giữa lúc
    // đang thi — lựa chọn đã lưu vẫn đúng, nhưng họ mất phương hướng và sẽ nghĩ hệ
    // thống hỏng.
    expect(chiMa(VIEW)).not.toContain("Math.random()");
  });

  it("hạt giống gắn với LƯỢT THI, không phải giờ hệ thống", () => {
    // Cùng lượt thi ⇒ thứ tự cố định; hai người khác nhau ⇒ khác nhau; hai lượt của
    // cùng một người ⇒ cũng khác nhau.
    expect(chiMa(VIEW)).toContain("tron(dung, dangMo.id)");
    expect(chiMa(VIEW)).toContain("`${dangMo.id}:${c.id}`");
    expect(chiMa(VIEW)).not.toContain("Date.now()) || 1");
  });
});
