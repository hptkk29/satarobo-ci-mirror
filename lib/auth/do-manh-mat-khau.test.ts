// @vitest-environment node
/** [DMK-*] Thang đo độ mạnh mật khẩu (chỉ gợi ý hiển thị). */
import { describe, expect, it } from "vitest";
import { doManhMatKhau } from "./do-manh-mat-khau";

describe("[DMK] độ mạnh mật khẩu", () => {
  it("[DMK-01] rỗng ⇒ điểm 0, nhãn nhắc tối thiểu 8 ký tự", () => {
    expect(doManhMatKhau("")).toEqual({ diem: 0, nhan: "Nhập ít nhất 8 ký tự" });
  });
  it("[DMK-02] 8 chữ thường ⇒ Yếu (1); thêm hoa+thường+số ⇒ Khá mạnh (3); thêm ký tự đặc biệt ⇒ Rất mạnh (4)", () => {
    expect(doManhMatKhau("abcdefgh")).toMatchObject({ diem: 1, nhan: "Yếu" });
    expect(doManhMatKhau("Abcdefg1")).toMatchObject({ diem: 3, nhan: "Khá mạnh" });
    expect(doManhMatKhau("Abcdef1!")).toMatchObject({ diem: 4, nhan: "Rất mạnh" });
  });
  it("[DMK-03] ngắn hơn 8 ký tự không được điểm 'đủ dài' dù có số/ký tự đặc biệt", () => {
    expect(doManhMatKhau("Ab1!")).toMatchObject({ diem: 3 });
    expect(doManhMatKhau("1234567").diem).toBe(1);
  });
  it("[DMK-04] đã gõ nhưng điểm 0 (vd 'abc') ⇒ nhãn nhắc ít nhất 8 ký tự", () => {
    expect(doManhMatKhau("abc")).toEqual({ diem: 0, nhan: "Nhập ít nhất 8 ký tự" });
  });
});
