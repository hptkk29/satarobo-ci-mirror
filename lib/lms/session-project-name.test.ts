// Khoá luật R5 (21/08): tên dự án của phiếu nhận xét SUY TỪ BUỔI, không nhập tay.
// Sửa 25/08: tên dự án gửi PH là TÊN BÀI TRẦN (bỏ tiền tố "Dự án N:"), còn số buổi +
// học phần chuyển hết sang NHÃN BUỔI của bảng (deriveSessionLabel).
import { describe, it, expect } from "vitest";
import {
  deriveSessionLabel,
  deriveSessionProjectName,
  meaningfulSessionTitle,
  moduleCodeFromTitle,
  resolveDisplayProjectName,
} from "./session-project-name";
import { DEFAULT_PROJECT_NAME } from "./session-eval-rubric";

describe("deriveSessionProjectName — tên gửi phụ huynh", () => {
  it("ưu tiên customTitle của lớp hơn tên bài giáo trình", () => {
    expect(
      deriveSessionProjectName({
        sessionNumber: 3,
        planTitle: "Xe dò line nâng cao",
        lessonTitle: "Cảm biến dò line",
      }),
    ).toBe("Xe dò line nâng cao");
  });

  it("không có customTitle → dùng tên bài giáo trình", () => {
    expect(
      deriveSessionProjectName({ sessionNumber: 5, lessonTitle: "Cảm biến siêu âm" }),
    ).toBe("Cảm biến siêu âm");
  });

  it("chỉ có topic của buổi → dùng topic", () => {
    expect(deriveSessionProjectName({ sessionNumber: 2, topic: "Ôn tập giữa khoá" })).toBe(
      "Ôn tập giữa khoá",
    );
  });

  it("KHÔNG còn gắn tiền tố 'Dự án N:' vào tên bài", () => {
    expect(
      deriveSessionProjectName({ sessionNumber: 7, lessonTitle: "Bàn Tay Ma Thuật" }),
    ).toBe("Bàn Tay Ma Thuật");
  });

  it("có số buổi nhưng KHÔNG có tên nào → 'Dự án N'", () => {
    expect(deriveSessionProjectName({ sessionNumber: 9 })).toBe("Dự án 9");
  });

  it("chưa tra được số buổi → lùi về Lesson.order", () => {
    expect(deriveSessionProjectName({ lessonOrder: 4 })).toBe("Dự án 4");
  });

  it("không có gì → hằng mặc định (ô Dự án không bao giờ trống)", () => {
    expect(deriveSessionProjectName({})).toBe(DEFAULT_PROJECT_NAME);
  });

  it("tên bài giáo trình cũ đã mang tiền tố 'Dự án' → giữ nguyên, không lồng hai lần", () => {
    expect(
      deriveSessionProjectName({ sessionNumber: 1, lessonTitle: "Dự án 1: Làm quen hệ thống" }),
    ).toBe("Dự án 1: Làm quen hệ thống");
  });

  it("chuỗi rỗng / toàn khoảng trắng không được coi là tên bài", () => {
    expect(deriveSessionProjectName({ sessionNumber: 6, planTitle: "   ", lessonTitle: "" })).toBe(
      "Dự án 6",
    );
  });
});

describe("deriveSessionLabel — nhãn cột 'Buổi học'", () => {
  it("đủ ba mảnh → 'Buổi 1 - HP1 - Bàn Tay Ma Thuật'", () => {
    expect(
      deriveSessionLabel({
        sessionNumber: 1,
        moduleCode: "HP1",
        lessonTitle: "Bàn Tay Ma Thuật",
      }),
    ).toBe("Buổi 1 - HP1 - Bàn Tay Ma Thuật");
  });

  it("khoá không chia học phần → bỏ hẳn mảnh HP, không để dấu '-' cụt", () => {
    expect(
      deriveSessionLabel({
        sessionNumber: 4,
        moduleCode: null,
        lessonTitle: "Dự án xe robot tự hành",
      }),
    ).toBe("Buổi 4 - Dự án xe robot tự hành");
  });

  it("lớp chưa ghim giáo trình → chỉ còn số buổi", () => {
    expect(deriveSessionLabel({ sessionNumber: 12 })).toBe("Buổi 12");
  });

  it("customTitle của lớp thắng tên bài giáo trình, học phần vẫn giữ", () => {
    expect(
      deriveSessionLabel({
        sessionNumber: 2,
        moduleCode: "HP3",
        planTitle: "Buổi bù — Đấu Trường Con Quay",
        lessonTitle: "Đấu Trường Con Quay",
      }),
    ).toBe("Buổi 2 - HP3 - Buổi bù — Đấu Trường Con Quay");
  });

  it("chưa tra được số buổi → lùi về Lesson.order", () => {
    expect(
      deriveSessionLabel({ lessonOrder: 13, moduleCode: "HP2", lessonTitle: "Họa Sĩ Robot" }),
    ).toBe("Buổi 13 - HP2 - Họa Sĩ Robot");
  });

  it("không có gì → chuỗi rỗng để chỗ gọi tự quyết", () => {
    expect(deriveSessionLabel({})).toBe("");
  });

  it("khoảng trắng thừa không sinh mảnh rác", () => {
    expect(
      deriveSessionLabel({ sessionNumber: 5, moduleCode: "  ", lessonTitle: " Vũ Công Robot " }),
    ).toBe("Buổi 5 - Vũ Công Robot");
  });
});

describe("ô trống 'Buổi N' không được coi là tên bài", () => {
  // Lớp tạo TRƯỚC khi có giáo trình thật mang customTitle = "Buổi 7" (bản sao đông cứng
  // của ô trống do nút "Áp dụng số buổi" sinh ra). Nếu nó vẫn thắng, nạp giáo trình xong
  // nhãn in ra "Buổi 7 - HP1 - Buổi 7" và phiếu phụ huynh in "Buổi 7" — xấu hơn lúc chưa nạp.
  it("customTitle rỗng nghĩa → rơi xuống tên bài của giáo trình", () => {
    const src = {
      sessionNumber: 7,
      moduleCode: "HP1",
      planTitle: "Buổi 7",
      lessonTitle: "Bàn Tay Ma Thuật",
    };
    expect(deriveSessionLabel(src)).toBe("Buổi 7 - HP1 - Bàn Tay Ma Thuật");
    expect(deriveSessionProjectName(src)).toBe("Bàn Tay Ma Thuật");
  });

  it("cả plan lẫn lesson đều là ô trống → rơi xuống topic", () => {
    expect(
      deriveSessionLabel({
        sessionNumber: 3,
        planTitle: "Buổi 3",
        lessonTitle: "Buổi 3",
        topic: "Học bù thứ 7",
      }),
    ).toBe("Buổi 3 - Học bù thứ 7");
  });

  it("không còn nguồn nào → chỉ in số buổi, không in 'Buổi 7' hai lần", () => {
    expect(deriveSessionLabel({ sessionNumber: 7, planTitle: "Buổi 7" })).toBe("Buổi 7");
    expect(deriveSessionProjectName({ sessionNumber: 7, planTitle: "Buổi 7" })).toBe("Dự án 7");
  });

  it("tên thật có chữ 'Buổi' nhưng KHÔNG phải tiền tố đánh số → giữ nguyên", () => {
    expect(deriveSessionLabel({ sessionNumber: 5, lessonTitle: "Buổi diễn tập" })).toBe(
      "Buổi 5 - Buổi diễn tập",
    );
    // "Buổi 2 ôn tập" — không có dấu ngăn sau số ⇒ không phải tiền tố, cắt là mất chữ.
    expect(deriveSessionLabel({ sessionNumber: 2, lessonTitle: "Buổi 2 ôn tập" })).toBe(
      "Buổi 2 - Buổi 2 ôn tập",
    );
  });
});

describe("cắt tiền tố 'Buổi N —' thừa ở đầu tên bài", () => {
  // Giáo trình demo trên DB test đặt tên bài kèm sẵn số buổi. Nhãn buổi vốn đã mở đầu
  // bằng "Buổi N" nên giữ nguyên là in ra "Buổi 1 - Buổi 1 — Làm quen bộ học cụ".
  it.each([
    ["Buổi 1 — Làm quen bộ học cụ", "Buổi 1 - Làm quen bộ học cụ"],
    ["Buổi 1: Làm quen bộ học cụ", "Buổi 1 - Làm quen bộ học cụ"],
    ["Buổi 1 - Làm quen bộ học cụ", "Buổi 1 - Làm quen bộ học cụ"],
    ["Buổi 1. Làm quen bộ học cụ", "Buổi 1 - Làm quen bộ học cụ"],
  ])("%s → %s", (title, expected) => {
    expect(deriveSessionLabel({ sessionNumber: 1, lessonTitle: title })).toBe(expected);
  });

  it("phiếu gửi phụ huynh cũng hết phần thừa", () => {
    expect(
      deriveSessionProjectName({ sessionNumber: 1, lessonTitle: "Buổi 1 — Làm quen bộ học cụ" }),
    ).toBe("Làm quen bộ học cụ");
  });

  it("cắt xong mà rỗng thì coi như không có tên", () => {
    expect(deriveSessionLabel({ sessionNumber: 4, lessonTitle: "Buổi 4 —" })).toBe("Buổi 4");
  });
});

describe("resolveDisplayProjectName — tên dự án theo BUỔI, không theo phiếu", () => {
  // Dữ liệu THẬT đo được 26/08 trên lớp CS1.LAPTRI.006 buổi 8: năm học viên cùng một
  // buổi mang năm "dự án" khác nhau, không cái nào dính đến bài học.
  const buoi8 = {
    sessionNumber: 8,
    lessonTitle: "Buổi 8 — Tay gắp cơ khí",
    lessonOrder: 8,
    topic: "Buổi 8",
  };

  it("bỏ qua projectName đã lưu khi buổi suy được tên bài", () => {
    for (const luu of [
      "Robot tránh vật cản",
      "Xe dò vạch",
      "Xe điều khiển từ xa",
      "Dự án 3: Robot tránh vật cản",
    ]) {
      expect(resolveDisplayProjectName(buoi8, luu)).toBe("Tay gắp cơ khí");
    }
  });

  it("cùng một buổi thì mọi học viên ra CÙNG một tên dự án", () => {
    const ket = ["Cánh tay gắp", "Robot phân loại", null, ""].map((v) =>
      resolveDisplayProjectName(buoi8, v),
    );
    expect(new Set(ket).size).toBe(1);
  });

  it("tên dự án khớp tiêu đề buổi — không còn cảnh 'Buổi 8: Tay gắp' mà 'Dự án: Robot tránh vật cản'", () => {
    const nhan = deriveSessionLabel(buoi8);
    const duAn = resolveDisplayProjectName(buoi8, "Robot tránh vật cản");
    expect(nhan).toContain(duAn);
  });

  it("buổi CHƯA gắn giáo án thì mới lùi về giá trị giáo viên đã gõ", () => {
    const trong = { sessionNumber: 4, topic: "Buổi 4" };
    expect(resolveDisplayProjectName(trong, "Xe dò vạch")).toBe("Xe dò vạch");
    // …và cắt tiền tố "Dự án N:" vì nhãn "Dự án:" đã đứng sẵn ở giao diện.
    expect(resolveDisplayProjectName(trong, "Dự án 2: Xe dò vạch")).toBe("Xe dò vạch");
  });

  it("không giáo án, không giá trị lưu → vẫn có chữ, không để trống ô", () => {
    expect(resolveDisplayProjectName({ sessionNumber: 4, topic: "Buổi 4" }, null)).toBe(
      "Dự án 4",
    );
  });
});

describe("tiền tố HPn — cắt khỏi tên, giữ ở nhãn buổi", () => {
  // Tên bài THẬT trên prod (đo 26/08): giáo trình do Đào tạo soạn tay đặt kèm học phần.
  const buoi = {
    sessionNumber: 5,
    lessonTitle: "HP2 - Họa Sĩ Robot",
    lessonOrder: 5,
    topic: "Buổi 5",
  };

  it("phiếu gửi phụ huynh là TÊN TRẦN, không còn 'HP2 -'", () => {
    expect(resolveDisplayProjectName(buoi, null)).toBe("Họa Sĩ Robot");
    expect(deriveSessionProjectName(buoi)).toBe("Họa Sĩ Robot");
  });

  it("nhãn buổi VẪN có học phần — suy lại từ chính tiền tố vừa cắt", () => {
    expect(deriveSessionLabel(buoi)).toBe("Buổi 5 - HP2 - Họa Sĩ Robot");
  });

  it("Lesson.moduleCode thật thì thắng, không lấy từ tên", () => {
    expect(deriveSessionLabel({ ...buoi, moduleCode: "HP3" })).toBe(
      "Buổi 5 - HP3 - Họa Sĩ Robot",
    );
  });

  it("cắt được cả hai tiền tố khi tên mang cả hai", () => {
    expect(meaningfulSessionTitle("Buổi 5 - HP2 - Họa Sĩ Robot")).toBe("Họa Sĩ Robot");
  });

  it("chỉ cắt khi CÓ dấu ngăn sau số — không ăn mất chữ", () => {
    expect(meaningfulSessionTitle("HP2")).toBe("HP2");
    expect(meaningfulSessionTitle("HPV và cảm biến")).toBe("HPV và cảm biến");
    expect(moduleCodeFromTitle("HP2")).toBe("");
  });

  it("moduleCodeFromTitle đọc đúng mã, tên không có tiền tố thì rỗng", () => {
    expect(moduleCodeFromTitle("HP2 - Họa Sĩ Robot")).toBe("HP2");
    expect(moduleCodeFromTitle("HP10: Tổng kết")).toBe("HP10");
    expect(moduleCodeFromTitle("Xe dò line")).toBe("");
    expect(moduleCodeFromTitle(null)).toBe("");
  });
});
