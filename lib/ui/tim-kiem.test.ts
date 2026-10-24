import { describe, it, expect } from "vitest";
import { boDau, khopBatKy, khopTimKiem } from "./tim-kiem";

describe("boDau", () => {
  it("bỏ dấu thanh + dấu mũ", () => {
    expect(boDau("Vòng lặp và điều kiện")).toBe("vong lap va dieu kien");
    expect(boDau("Bàn Tay Ma Thuật")).toBe("ban tay ma thuat");
  });

  it("đ/Đ phải thành d — nó KHÔNG nằm trong dải dấu kết hợp của NFD", () => {
    expect(boDau("Đấu Trường Con Quay")).toBe("dau truong con quay");
    expect(boDau("điều khiển")).toBe("dieu khien");
  });

  it("chuỗi không dấu giữ nguyên", () => {
    expect(boDau("Sata3 HP1")).toBe("sata3 hp1");
  });
});

describe("khopTimKiem", () => {
  const bai = "Buổi 7 - HP1 - Vòng lặp và điều kiện";

  it("gõ KHÔNG dấu vẫn khớp — đây là lý do hàm này tồn tại", () => {
    expect(khopTimKiem(bai, "vong lap")).toBe(true);
    expect(khopTimKiem(bai, "dieu kien")).toBe(true);
  });

  it("gõ CÓ dấu cũng khớp", () => {
    expect(khopTimKiem(bai, "vòng lặp")).toBe(true);
  });

  it("không phân biệt hoa thường", () => {
    expect(khopTimKiem(bai, "VONG LAP")).toBe(true);
  });

  it("các tiếng rời rạc, không cần liền mạch", () => {
    expect(khopTimKiem(bai, "vong dieu")).toBe(true);
    expect(khopTimKiem(bai, "hp1 kien")).toBe(true);
  });

  it("khớp cả số buổi và học phần vì nhãn đã chứa sẵn", () => {
    expect(khopTimKiem(bai, "buoi 7")).toBe(true);
    expect(khopTimKiem(bai, "HP1")).toBe(true);
  });

  it("từ không có thì KHÔNG khớp", () => {
    expect(khopTimKiem(bai, "cam bien")).toBe(false);
    expect(khopTimKiem(bai, "vong lap cam bien")).toBe(false);
  });

  it("từ khoá rỗng / toàn khoảng trắng ⇒ không lọc gì", () => {
    expect(khopTimKiem(bai, "")).toBe(true);
    expect(khopTimKiem(bai, "   ")).toBe(true);
  });
});

describe("khopBatKy", () => {
  it("khớp khi bất kỳ trường nào chứa từ khoá", () => {
    expect(khopBatKy(["Buổi 3 - Cảm biến", "CS1 · Sata3 · Lớp A"], "sata3")).toBe(true);
    expect(khopBatKy(["Buổi 3 - Cảm biến", "CS1 · Sata3 · Lớp A"], "cam bien")).toBe(true);
  });

  it("bỏ qua trường null/undefined, không nối thành chuỗi rác", () => {
    expect(khopBatKy(["Buổi 3", null, undefined], "buoi 3")).toBe(true);
  });

  it("không nối liền hai trường thành một cụm giả", () => {
    // "Cảm biến" ở trường 1, "Lớp A" ở trường 2 — gõ liền "biencam" không được khớp.
    expect(khopBatKy(["Cảm biến", "Lớp A"], "biếnlớp")).toBe(false);
  });
});
