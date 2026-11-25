import { describe, expect, it } from "vitest";
import { chuVietTat, vaiTroHoiThoai } from "@/lib/portal/tin-nhan-thuan";

describe("[TN-01] ô tròn + vai trò của hội thoại", () => {
  it("nhóm lớp lấy số cuối của tên; nhắn riêng lấy chữ cái đầu", () => {
    expect(chuVietTat("CLASS_GROUP", "Sata 3 · CS1.SATA3.01")).toBe("01");
    expect(chuVietTat("CLASS_GROUP", "Nhóm lớp")).toBe("L");
    expect(chuVietTat("DM_TEACHER_PARENT", "Hoàng Phan Tuấn Kiệt")).toBe("TK");
    expect(chuVietTat("DM_SALE_PARENT", "")).toBe("?");
  });
  it("loại lạ không vỡ", () => {
    expect(vaiTroHoiThoai("CLASS_GROUP")).toBe("Nhóm lớp");
    expect(vaiTroHoiThoai("X")).toBe("Hội thoại");
  });
});
