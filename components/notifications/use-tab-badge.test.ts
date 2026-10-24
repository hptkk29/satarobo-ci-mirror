// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { stripTabBadge, withTabBadge } from "./use-tab-badge";

// Hai hàm này quyết định chuỗi hiện trên THANH TAB — thứ người dùng nhìn nhiều hơn cả chuông.
// Sai ở đây là hoặc mất con số, hoặc dồn tiền tố chồng lên nhau thành "(2) (2) (2) Trang chủ".

describe("withTabBadge", () => {
  it("ghép tiền tố vào ĐẦU tiêu đề — tab bị thu hẹp thì cắt phần đuôi trước", () => {
    expect(withTabBadge("Tổng quan | Sata Robo", 2)).toBe("(2) Tổng quan | Sata Robo");
  });

  it("hiện (1) ngay từ mục đầu tiên — KHÁC chuông (chuông chỉ có chấm)", () => {
    expect(withTabBadge("Tổng quan", 1)).toBe("(1) Tổng quan");
  });

  it("≥10 thì dừng ở (9+)", () => {
    expect(withTabBadge("Tổng quan", 10)).toBe("(9+) Tổng quan");
    expect(withTabBadge("Tổng quan", 137)).toBe("(9+) Tổng quan");
  });

  it("0 chưa đọc thì trả tiêu đề nguyên gốc, không thừa dấu cách", () => {
    expect(withTabBadge("Tổng quan", 0)).toBe("Tổng quan");
    expect(withTabBadge("(5) Tổng quan", 0)).toBe("Tổng quan");
  });

  it("KHÔNG chồng tiền tố khi gọi lại nhiều lần", () => {
    // Observer chạy mỗi lần tiêu đề đổi, nên hàm này bị gọi lặp trên chính kết quả của nó.
    let t = "Tổng quan";
    for (let i = 0; i < 5; i++) t = withTabBadge(t, 3);
    expect(t).toBe("(3) Tổng quan");
  });

  it("đổi số thì thay tiền tố cũ chứ không cộng thêm", () => {
    expect(withTabBadge("(2) Tổng quan", 7)).toBe("(7) Tổng quan");
    expect(withTabBadge("(9+) Tổng quan", 3)).toBe("(3) Tổng quan");
  });
});

describe("stripTabBadge", () => {
  it("gỡ đúng tiền tố ở đầu, giữ nguyên phần còn lại", () => {
    expect(stripTabBadge("(9+) Lớp của tôi | Sata Robo")).toBe("Lớp của tôi | Sata Robo");
    expect(stripTabBadge("Lớp của tôi")).toBe("Lớp của tôi");
  });

  it("không đụng vào dấu ngoặc nằm GIỮA tiêu đề", () => {
    expect(stripTabBadge("Lớp Sata4 (K1) | Sata Robo")).toBe("Lớp Sata4 (K1) | Sata Robo");
  });

  it("tiêu đề rỗng không vỡ", () => {
    expect(stripTabBadge("")).toBe("");
    expect(withTabBadge("", 0)).toBe("");
  });
});
