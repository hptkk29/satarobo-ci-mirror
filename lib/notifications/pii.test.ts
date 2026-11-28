import { describe, it, expect } from "vitest";
import { kiemPii, cheSdt } from "./pii";

// PRD xếp "SĐT/học phí lọt vào dòng xem trước" là rủi ro CHẶN PHÁT HÀNH (T5).
// Bộ test này là cái lưới đó.

describe("kiemPii — số điện thoại", () => {
  it.each([
    "Gọi lại cho phụ huynh 0818823720 trước 17h",
    "SĐT 84818823720 đã xác minh",
    "Liên hệ +84 818 823 720 giúp",
    "Số 0818.823.720 báo bận",
    "0818-823-720 không nghe máy",
    "SĐT0818823720 (không có dấu cách)",
  ])("bắt được: %s", (text) => {
    expect(kiemPii(text).coSdt).toBe(true);
  });

  it.each([
    "8 học viên chưa điểm danh",
    "Buổi 12 lớp SR-A1 chưa chốt",
    "Mã đơn 2026081900123 đã tạo",
    "Còn 3 việc quá hạn",
  ])("KHÔNG báo động nhầm: %s", (text) => {
    expect(kiemPii(text).coSdt).toBe(false);
  });
});

describe("kiemPii — số tiền", () => {
  it.each([
    "Học phí còn thiếu 1.500.000đ",
    "Đã thu 12,000,000 VNĐ",
    "Chênh lệch 500000đ",
  ])("bắt được: %s", (text) => {
    expect(kiemPii(text).coTien).toBe(true);
  });

  it("số đếm việc thường không bị nhận nhầm là tiền", () => {
    expect(kiemPii("5 việc cần xử lý.").coTien).toBe(false);
    expect(kiemPii("Còn 30 học viên chưa có học bạ").coTien).toBe(false);
  });
});

describe("cheSdt", () => {
  it("che số, giữ 3 chữ số cuối để còn nhận ra được", () => {
    expect(cheSdt("Gọi lại 0818823720 giúp")).toBe("Gọi lại ***720 giúp");
  });

  it("che mọi dạng viết, kể cả có dấu cách và tiền tố +84", () => {
    expect(cheSdt("+84 818 823 720")).toBe("***720");
    expect(cheSdt("0818.823.720")).toBe("***720");
  });

  it("che được nhiều số trong cùng một câu", () => {
    expect(cheSdt("0818823720 và 0912345678")).toBe("***720 và ***678");
  });

  it("không đụng vào chữ và số đếm bình thường", () => {
    const s = "5 việc cần xử lý, lớp SR-A1, buổi 12.";
    expect(cheSdt(s)).toBe(s);
  });

  it("chuỗi sau khi che thì kiểm lại phải sạch", () => {
    expect(kiemPii(cheSdt("PH 0818823720 vừa nhắn")).coSdt).toBe(false);
  });
});
