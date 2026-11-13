// @vitest-environment node
// [GGV] cổng phụ huynh gọi giáo viên «thầy/cô + TÊN» (chủ dự án 13/11/2026: «nhắn tin cho thầy Kiệt», không cả họ tên).
import { describe, expect, it } from "vitest";
import { danhXungGv, goiGiaoVien, vietHoaDau } from "./goi-giao-vien";

describe("[GGV] gọi giáo viên", () => {
  it("[GGV-01] lấy TÊN (tiếng cuối), danh xưng theo giới tính đã khai", () => {
    expect(goiGiaoVien("Hoàng Phan Tuấn Kiệt", "MALE")).toBe("thầy Kiệt");
    expect(goiGiaoVien("Nguyễn Bích Trà", "FEMALE")).toBe("cô Trà");
    expect(goiGiaoVien("  Lê   Nhật  Thuận ", "MALE")).toBe("thầy Thuận");
  });

  it("[GGV-02] chưa khai giới tính: «Thị» ⇒ cô, «Văn» ⇒ thầy; không đoán được ⇒ «thầy/cô» (không bịa)", () => {
    expect(goiGiaoVien("Trần Thị Hà", null)).toBe("cô Hà");
    expect(goiGiaoVien("Lê Văn Bình", undefined)).toBe("thầy Bình");
    expect(goiGiaoVien("Hoàng Phan Tuấn Kiệt", null)).toBe("thầy/cô Kiệt");
    expect(danhXungGv("Ngô Minh Anh", "OTHER")).toBe("thầy/cô");
  });

  it("[GGV-03] giới tính đã khai THẮNG tên đệm (người tên «Văn» là nữ vẫn là cô)", () => {
    expect(goiGiaoVien("Phạm Văn Anh", "FEMALE")).toBe("cô Anh");
    expect(goiGiaoVien("Lý Thị Mai", "MALE")).toBe("thầy Mai");
  });

  it("[GGV-04] «Thị»/«Văn» chỉ xét ở tên ĐỆM, không xét tên chính; tên rỗng ⇒ null; viết hoa đầu cụm", () => {
    expect(goiGiaoVien("Nguyễn Văn", null)).toBe("thầy/cô Văn");
    expect(goiGiaoVien("", "MALE")).toBeNull();
    expect(goiGiaoVien(null, "MALE")).toBeNull();
    expect(vietHoaDau("thầy Kiệt")).toBe("Thầy Kiệt");
  });
});
