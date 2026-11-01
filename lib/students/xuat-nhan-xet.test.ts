import { describe, expect, it } from "vitest";
import { sapXepTheoBuoi } from "@/lib/pdf/sap-xep-buoi";
import { dungDuongDanXuat, sapXepDanhSachChon, TOI_DA_BUOI_MOT_LAN, type BuoiXuatDuoc } from "./xuat-nhan-xet";

const b = (id: string, buoi: number | null, lop: string | null = "L1"): BuoiXuatDuoc => ({
  id,
  buoi,
  ngay: "01/01/2026",
  lop,
  ten: "",
});

describe("hộp 'Xuất nhận xét'", () => {
  it("[XNX-01] danh sách chọn xếp theo lớp rồi buổi tăng dần, buổi không rõ số xuống cuối lớp", () => {
    const xs = sapXepDanhSachChon([b("a", 10), b("b", 2), b("c", null), b("d", 1, "L0"), b("e", 3)]);
    expect(xs.map((x) => x.id)).toEqual(["d", "b", "e", "a", "c"]);
  });

  it("[XNX-02] không đổi mảng gốc", () => {
    const goc = [b("a", 3), b("b", 1)];
    sapXepDanhSachChon(goc);
    expect(goc.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("[XNX-03] URL mang studentId + mỗi buổi một feedbackId, đúng thứ tự truyền vào, mã hoá ký tự lạ", () => {
    expect(dungDuongDanXuat("hv 1", ["f1", "f2"])).toBe(
      "/api/admin/reports/nhan-xet-buoi?studentId=hv+1&feedbackId=f1&feedbackId=f2",
    );
  });

  it("[XNX-04] trần số buổi: URL tối đa vẫn dưới 8KB (giới hạn đầu dòng thường gặp)", () => {
    const ids = Array.from({ length: TOI_DA_BUOI_MOT_LAN }, (_, i) => `cm${String(i).padStart(23, "x")}`);
    expect(dungDuongDanXuat("uat-hv-CS1-70", ids).length).toBeLessThan(8000);
  });

  it("[XNX-05] thứ tự trang PDF: theo lớp, rồi buổi 2 < 10 (so SỐ, không so chuỗi), buổi không rõ số theo ngày", () => {
    const t = (id: string, lop: string, soBuoi: number | null, ngay: number) => ({ id, lop, soBuoi, ngay });
    const xs = sapXepTheoBuoi([
      t("a", "L1", 10, 5),
      t("b", "L1", 2, 9),
      t("c", "L1", null, 8),
      t("d", "L1", null, 3),
      t("e", "L0", 7, 1),
    ]);
    expect(xs.map((x) => x.id)).toEqual(["e", "b", "a", "d", "c"]);
  });
});
