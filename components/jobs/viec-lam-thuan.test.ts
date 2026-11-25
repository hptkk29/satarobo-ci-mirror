import { describe, expect, it } from "vitest";
import {
  bieuTuongViTri,
  cacBuocUngTuyen,
  dinhDangLuong,
  laViTriGiangDay,
  locViTri,
  tabLocTuDuLieu,
  tachDoan,
  tomTatMoTa,
} from "@/components/jobs/viec-lam-thuan";

describe("[PUB-C-10] mức lương", () => {
  const rong = { salary: null, salaryMin: null, salaryMax: null, salaryNote: null };
  it("chữ tự do thắng khoảng số, khoảng số thắng ghi chú", () => {
    expect(dinhDangLuong({ ...rong, salary: "10–15 triệu", salaryMin: 1, salaryMax: 2, salaryNote: "n" })).toBe("10–15 triệu");
    expect(dinhDangLuong({ ...rong, salaryMin: 8_000_000, salaryMax: 12_000_000, salaryNote: "n" })).toContain("VND");
    expect(dinhDangLuong({ ...rong, salaryNote: "Thoả thuận" })).toBe("Thoả thuận");
  });
  it("không có thông tin lương ⇒ null (KHÔNG tự bịa 'Thoả thuận')", () => {
    expect(dinhDangLuong(rong)).toBeNull();
  });
});

describe("[PUB-C-11] tóm tắt & tách đoạn", () => {
  it("tóm tắt gộp khoảng trắng và cắt đúng độ dài", () => {
    expect(tomTatMoTa("a   b\n c")).toBe("a b c");
    const dai = "x".repeat(300);
    expect(tomTatMoTa(dai, 50)).toHaveLength(50);
    expect(tomTatMoTa(dai, 50).endsWith("…")).toBe(true);
  });
  it("tách đoạn bỏ dòng trống và gạch đầu dòng", () => {
    expect(tachDoan("- Dạy lớp\r\n\r\n• Soạn bài\n  Nhận xét")).toEqual(["Dạy lớp", "Soạn bài", "Nhận xét"]);
  });
});

describe("[PUB-C-12] biểu tượng & vị trí giảng dạy", () => {
  it("suy từ tên vị trí, có dấu hay không dấu", () => {
    expect(bieuTuongViTri("Giáo viên Robotics", null)).toBe("sach");
    expect(bieuTuongViTri("Trợ giảng", "Đào tạo")).toBe("sach");
    expect(bieuTuongViTri("Tư vấn tuyển sinh", null)).toBe("nguoi");
    expect(bieuTuongViTri("Marketing Content", null)).toBe("chat");
    expect(bieuTuongViTri("Kế toán", "Tài chính")).toBe("sao");
  });
  it("chỉ vị trí giảng dạy mới có bước dạy thử", () => {
    expect(laViTriGiangDay("Giáo viên Robotics", null)).toBe(true);
    expect(laViTriGiangDay("Kế toán tổng hợp", "Kế toán")).toBe(false);
    expect(cacBuocUngTuyen(true).map((b) => b.tieuDe)).toContain("Dạy thử");
    expect(cacBuocUngTuyen(false).map((b) => b.tieuDe)).not.toContain("Dạy thử");
  });
  it("quy trình không hứa số ngày hay form (chưa có thật)", () => {
    for (const gd of [true, false]) {
      const chu = cacBuocUngTuyen(gd).map((b) => `${b.tieuDe} ${b.moTa}`).join(" | ");
      expect(chu).not.toMatch(/\[|ngày làm việc|form/i);
    }
    expect(cacBuocUngTuyen(true).map((b) => b.so)).toEqual(["01", "02", "03", "04", "05"]);
    expect(cacBuocUngTuyen(false).map((b) => b.so)).toEqual(["01", "02", "03", "04"]);
  });
});

describe("[PUB-C-13] bộ lọc", () => {
  it("chỉ dựng tab khi có từ 2 giá trị khác nhau (không phân biệt hoa thường)", () => {
    expect(tabLocTuDuLieu(["Toàn thời gian", "toàn thời gian", null])).toEqual([]);
    expect(tabLocTuDuLieu(["Toàn thời gian", "Bán thời gian", "Toàn thời gian"]).map((t) => t.label)).toEqual([
      "Toàn thời gian",
      "Bán thời gian",
    ]);
  });
  it("lọc hai chiều độc lập", () => {
    const ds = [
      { hinhThuc: "Toàn thời gian", diaDiem: "CS1" },
      { hinhThuc: "Bán thời gian", diaDiem: "CS1" },
      { hinhThuc: "Bán thời gian", diaDiem: null },
    ];
    expect(locViTri(ds, null, null)).toHaveLength(3);
    expect(locViTri(ds, "bán thời gian", null)).toHaveLength(2);
    expect(locViTri(ds, "bán thời gian", "cs1")).toHaveLength(1);
    expect(locViTri(ds, null, "cs1")).toHaveLength(2);
  });
});
