import { describe, it, expect } from "vitest";
import { canXuLy, conThieu, phanLoaiHocPhi } from "./thieu-hoc-phi";

describe("[THP-01] phân loại — CHƯA CÓ ĐƠN tách riêng khỏi PHẢI THU = 0", () => {
  it("0 đơn → CHUA_CO_DON (đây là nhóm chốt hàng loạt không nhập tiền)", () => {
    expect(phanLoaiHocPhi({ soDon: 0, tongPhaiThu: 0, tongDaThu: 0 })).toBe("CHUA_CO_DON");
  });

  it("CÓ đơn nhưng đơn 0đ → KHÔNG phải CHUA_CO_DON", () => {
    // Hai ca này cùng ra "phải thu 0" trên số liệu nhưng việc phải làm khác hẳn:
    // chưa có đơn thì TẠO đơn; có đơn 0đ là dữ liệu sai cần người xem.
    expect(phanLoaiHocPhi({ soDon: 1, tongPhaiThu: 0, tongDaThu: 0 })).toBe("DU");
  });

  it("có đơn, chưa thu đồng nào → CO_DON_CHUA_THU", () => {
    expect(phanLoaiHocPhi({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 0 })).toBe(
      "CO_DON_CHUA_THU",
    );
  });

  it("thu một phần → THU_MOT_PHAN", () => {
    expect(phanLoaiHocPhi({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 3_000_000 })).toBe(
      "THU_MOT_PHAN",
    );
  });

  it("thu đủ hoặc thừa → DU", () => {
    expect(phanLoaiHocPhi({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 9_000_000 })).toBe("DU");
    expect(phanLoaiHocPhi({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 9_500_000 })).toBe("DU");
  });

  it("đầu vào rác → coi như 0, không ném", () => {
    expect(phanLoaiHocPhi({ soDon: Number.NaN, tongPhaiThu: 1, tongDaThu: 1 })).toBe("CHUA_CO_DON");
    expect(phanLoaiHocPhi({ soDon: 1, tongPhaiThu: Number.NaN, tongDaThu: Number.NaN })).toBe("DU");
  });
});

describe("[THP-02] conThieu — không âm, và không đoán khi chưa có đơn", () => {
  it("thiếu đúng phần chênh", () => {
    expect(conThieu({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 3_000_000 })).toBe(6_000_000);
  });

  it("thu thừa → 0, không trả số âm", () => {
    expect(conThieu({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 9_500_000 })).toBe(0);
  });

  it("chưa có đơn → 0 (chưa biết thiếu bao nhiêu, đừng bịa)", () => {
    expect(conThieu({ soDon: 0, tongPhaiThu: 0, tongDaThu: 0 })).toBe(0);
  });
});

describe("[THP-03] canXuLy — lọc danh sách màn hình", () => {
  it("mọi trạng thái trừ DU đều cần xử lý", () => {
    expect(canXuLy({ soDon: 0, tongPhaiThu: 0, tongDaThu: 0 })).toBe(true);
    expect(canXuLy({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 0 })).toBe(true);
    expect(canXuLy({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 1 })).toBe(true);
    expect(canXuLy({ soDon: 1, tongPhaiThu: 9_000_000, tongDaThu: 9_000_000 })).toBe(false);
  });
});
