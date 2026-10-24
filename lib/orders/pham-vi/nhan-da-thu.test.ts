// @vitest-environment node
/**
 * [P7-29] Nhãn & chú thích "Đã thu" của đơn theo phạm vi học — hàm THUẦN. Ghim: chỉ đơn phạm vi đổi chữ, chú thích chỉ khi hai số lệch,
 * và số trong câu là CHÍNH hai số được truyền vào (không tính từ nguồn khác).
 */
import { describe, expect, it } from "vitest";
import {
  CHU_THICH_O_DA_THU_PHAM_VI,
  NHAN_COT_DA_DOI_KHOP,
  NHAN_COT_DA_THU_MAC_DINH,
  chuThichDaThuLech,
  nhanCotDaThuCuaPhieu,
} from "./nhan-da-thu";

describe("[P7-29] nhan-da-thu", () => {
  it("nhãn cột: đơn thường NGUYÊN 'Đã thu'; đơn phạm vi 'Đã đối khớp'", () => {
    expect(nhanCotDaThuCuaPhieu(false)).toBe("Đã thu");
    expect(NHAN_COT_DA_THU_MAC_DINH).toBe("Đã thu");
    expect(nhanCotDaThuCuaPhieu(true)).toBe("Đã đối khớp");
    expect(NHAN_COT_DA_DOI_KHOP).toBe("Đã đối khớp");
  });

  it("chú thích ô công nợ không rỗng và không trùng chữ 'Đã thu' (tránh nhãn lặp)", () => {
    expect(CHU_THICH_O_DA_THU_PHAM_VI.length).toBeGreaterThan(5);
    expect(CHU_THICH_O_DA_THU_PHAM_VI).not.toBe("Đã thu");
  });

  it("đơn thường ⇒ KHÔNG BAO GIỜ có chú thích, dù hai số lệch tới đâu", () => {
    expect(chuThichDaThuLech({ donPhamVi: false, daGhiNhanDon: 15_800_000, phieu: [{ allocated: 5_600_000 }] })).toBeNull();
  });

  it("đơn phạm vi, hai số TRÙNG ⇒ không chú thích (kể cả 0 = 0 và nhiều phiếu cộng lại)", () => {
    expect(chuThichDaThuLech({ donPhamVi: true, daGhiNhanDon: 0, phieu: [{ allocated: 0 }] })).toBeNull();
    expect(chuThichDaThuLech({ donPhamVi: true, daGhiNhanDon: 10_200_000, phieu: [{ allocated: 4_000_000 }, { allocated: 6_200_000 }] })).toBeNull();
    expect(chuThichDaThuLech({ donPhamVi: true, daGhiNhanDon: 0, phieu: [] })).toBeNull();
  });

  it("đơn phạm vi, lệch ⇒ chú thích in đúng hai số; tổng phiếu = Σ allocated", () => {
    const c = chuThichDaThuLech({ donPhamVi: true, daGhiNhanDon: 15_800_000, phieu: [{ allocated: 2_600_000 }, { allocated: 3_000_000 }] });
    expect(c).toContain("đã đối khớp (5.600.000đ)");
    expect(c).toContain("đã ghi nhận (15.800.000đ)");
    expect(c).toMatch(/hai số có thể khác nhau/);
  });

  it("lệch ở cả hai chiều (đối khớp > ghi nhận) cũng giải thích — không giả định ghi nhận luôn lớn hơn", () => {
    expect(chuThichDaThuLech({ donPhamVi: true, daGhiNhanDon: 1_000_000, phieu: [{ allocated: 3_000_000 }] })).not.toBeNull();
  });
});
