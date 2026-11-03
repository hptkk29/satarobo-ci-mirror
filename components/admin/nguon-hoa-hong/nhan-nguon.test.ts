import { describe, expect, it } from "vitest";
import { nhanTuoi, soVN, yeuCauNhap } from "./nhan-nguon";

describe("yeuCauNhap — một cụm chữ nói nhóm này bắt chọn gì ở ô nhập", () => {
  it("nhóm cần nhân viên + nhóm 11 cần giải trình + nhóm hệ thống + nhóm trơn", () => {
    expect(yeuCauNhap({ referrerRequirement: "EMPLOYEE", requiresNote: false, selectable: true })).toBe("Chọn nhân sự");
    expect(yeuCauNhap({ referrerRequirement: "NONE", requiresNote: true, selectable: true })).toBe("Giải trình bắt buộc");
    expect(yeuCauNhap({ referrerRequirement: "NONE", requiresNote: false, selectable: false })).toBe("Hệ thống gán");
    expect(yeuCauNhap({ referrerRequirement: "NONE", requiresNote: false, selectable: true })).toBe("Không");
    expect(yeuCauNhap({ referrerRequirement: "PARENT", requiresNote: true, selectable: true })).toBe(
      "Chọn phụ huynh · Giải trình bắt buộc",
    );
  });

  it("nhóm hệ thống thắng mọi yêu cầu khác (UNKNOWN không có ô nhập)", () => {
    expect(yeuCauNhap({ referrerRequirement: "EMPLOYEE", requiresNote: true, selectable: false })).toBe("Hệ thống gán");
  });
});

describe("nhanTuoi / soVN", () => {
  it("tuổi: 0 hoặc âm ⇒ Hôm nay; còn lại in số ngày", () => {
    expect(nhanTuoi(0)).toBe("Hôm nay");
    expect(nhanTuoi(-3)).toBe("Hôm nay");
    expect(nhanTuoi(12)).toBe("12 ngày");
  });
  it("số kiểu Việt, chịu 9 chữ số", () => {
    expect(soVN(2338)).toBe("2.338");
    expect(soVN(955563000)).toBe("955.563.000");
  });
});
