// Phân trang ô ngày của lịch tháng.
//
// Vé gốc (05/09/2026): ô ngày in 4 lớp rồi bỏ phần còn lại sau dòng "+3" không bấm
// được ⇒ ngày đông lớp là ngày không xem được. Nay 5 lớp/trang + nút lật.
import { describe, it, expect } from "vitest";
import { MOI_TRANG, tinhTrangNgay } from "./phan-trang-ngay";

describe("tinhTrangNgay", () => {
  it("mặc định 5 lớp mỗi trang (chốt của chủ dự án)", () => {
    expect(MOI_TRANG).toBe(5);
  });

  it("đúng 5 lớp → một trang, KHÔNG bày nút lật", () => {
    const r = tinhTrangNgay(5, 0);
    expect(r).toEqual({ soTrang: 1, trangHienTai: 0, dau: 0, coPhanTrang: false });
  });

  it("6 lớp → hai trang, có nút lật", () => {
    expect(tinhTrangNgay(6, 0)).toMatchObject({ soTrang: 2, coPhanTrang: true });
    expect(tinhTrangNgay(6, 1)).toMatchObject({ trangHienTai: 1, dau: 5 });
  });

  it("13 lớp → ba trang", () => {
    expect(tinhTrangNgay(13, 2)).toMatchObject({ soTrang: 3, trangHienTai: 2, dau: 10 });
  });

  it("ngày rỗng vẫn là trang 1/1, không phải 0/0", () => {
    expect(tinhTrangNgay(0, 0)).toEqual({
      soTrang: 1,
      trangHienTai: 0,
      dau: 0,
      coPhanTrang: false,
    });
  });

  it("KẸP trang khi danh sách rút ngắn — nếu không, ô hiện rỗng như ngày không có lớp", () => {
    // Đang đứng trang 3 (chỉ số 2), đổi tháng xong ngày chỉ còn 4 lớp.
    expect(tinhTrangNgay(4, 2)).toMatchObject({ soTrang: 1, trangHienTai: 0, dau: 0 });
  });

  it("trang âm cũng bị kẹp về 0", () => {
    expect(tinhTrangNgay(12, -3)).toMatchObject({ trangHienTai: 0, dau: 0 });
  });

  it("moiTrang = 0 không làm chia cho 0", () => {
    expect(tinhTrangNgay(7, 0, 0).soTrang).toBe(7);
  });
});
