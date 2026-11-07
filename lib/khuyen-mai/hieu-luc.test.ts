// @vitest-environment node
// Chính sách khuyến mãi — "có hiệu lực vào ngày X không": MỘT hàm cho màn quản trị, Tra cứu và
// tạo đơn. Mỗi ca canh một luật nêu ở đầu `hieu-luc.ts`.
import { describe, it, expect } from "vitest";
import {
  apDungTrongPhamVi,
  daTungHieuLuc,
  dangHieuLuc,
  ngayBatDau,
  ngayKetThuc,
  trangThaiTai,
} from "./hieu-luc";
import { baoTrum } from "./pham-vi";
import { moTaUuDaiMa } from "./mo-ta";

const cs = (tu: string, den: string, thuHoi: string | null = null) => ({
  validFrom: new Date(`${tu}T00:00:00Z`),
  validUntil: new Date(`${den}T00:00:00Z`),
  revokedAt: thuHoi ? new Date(thuHoi) : null,
});

describe("[KM-HL-01] hiệu lực theo ngày — tính CẢ HAI ĐẦU", () => {
  const p = cs("2026-09-01", "2026-12-31");
  it("trước / đúng ngày đầu / giữa / đúng ngày cuối / sau", () => {
    expect(trangThaiTai(p, "2026-08-31")).toBe("sap_ap_dung");
    expect(trangThaiTai(p, "2026-09-01")).toBe("dang_ap_dung");
    expect(trangThaiTai(p, "2026-10-15")).toBe("dang_ap_dung");
    expect(trangThaiTai(p, "2026-12-31")).toBe("dang_ap_dung");
    expect(trangThaiTai(p, "2027-01-01")).toBe("het_han");
  });
  it("ngày đọc từ cột Date (UTC) — không lệch múi giờ", () => {
    expect(ngayBatDau(p)).toBe("2026-09-01");
    expect(ngayKetThuc(p)).toBe("2026-12-31");
  });
});

describe("[KM-HL-02] thu hồi — hết hiệu lực TỪ NGÀY thu hồi (giờ VN)", () => {
  // 08:00Z ngày 10/10 = 15:00 ngày 10/10 ở VN.
  const p = cs("2026-09-01", "2026-12-31", "2026-10-10T08:00:00Z");
  it("ngày hiệu lực cuối = ngày TRƯỚC ngày thu hồi", () => {
    expect(ngayKetThuc(p)).toBe("2026-10-09");
    expect(trangThaiTai(p, "2026-10-09")).toBe("dang_ap_dung");
  });
  it("ngay trong ngày thu hồi đã là 'đã thu hồi' — không phải 'còn tới hết ngày'", () => {
    expect(trangThaiTai(p, "2026-10-10")).toBe("da_thu_hoi");
    expect(dangHieuLuc(p, "2026-10-10")).toBe(false);
  });
  it("thu hồi lúc 18:00Z = 01:00 hôm SAU ở VN ⇒ ngày thu hồi là hôm sau", () => {
    const q = cs("2026-09-01", "2026-12-31", "2026-10-10T18:00:00Z");
    expect(ngayKetThuc(q)).toBe("2026-10-10");
  });
  it("thu hồi SAU ngày hết hạn ⇒ ngày cuối vẫn là ngày hết hạn, hiển thị 'đã thu hồi'", () => {
    const q = cs("2026-09-01", "2026-09-30", "2026-11-01T02:00:00Z");
    expect(ngayKetThuc(q)).toBe("2026-09-30");
    expect(trangThaiTai(q, "2026-10-15")).toBe("da_thu_hoi");
  });
  it("thu hồi TRƯỚC ngày bắt đầu ⇒ chưa từng hiệu lực, không ngày nào 'đang áp dụng'", () => {
    const q = cs("2026-11-01", "2026-12-31", "2026-10-20T02:00:00Z");
    expect(daTungHieuLuc(q)).toBe(false);
    for (const d of ["2026-10-25", "2026-11-01", "2026-12-01"]) expect(dangHieuLuc(q, d), d).toBe(false);
  });
});

describe("[KM-PV] phạm vi", () => {
  it("[KM-PV-01] không khai cơ sở = toàn hệ thống — áp ở mọi phạm vi", () => {
    expect(apDungTrongPhamVi([], ["CS2"])).toBe(true);
  });
  it("[KM-PV-02] khai cơ sở ⇒ chỉ phạm vi giao nhau", () => {
    expect(apDungTrongPhamVi(["CS1"], ["CS2"])).toBe(false);
    expect(apDungTrongPhamVi(["CS1", "CS2"], ["CS2"])).toBe(true);
  });
  it("[KM-PV-03] neo Hội sở bao trùm mọi cơ sở; neo CS1 KHÔNG bao trùm CS10 (dấu / cuối)", () => {
    expect(baoTrum("/ho/", ["/ho/danang/cs1/"])).toBe(true);
    expect(baoTrum("/ho/danang/cs1/", ["/ho/danang/cs1/"])).toBe(true);
    expect(baoTrum("/ho/danang/cs1/", ["/ho/danang/cs10/"])).toBe(false);
    expect(baoTrum("/ho/danang/cs2/", ["/ho/danang/cs1/"])).toBe(false);
  });
  it("[KM-PV-04] đường dẫn neo thiếu '/' cuối ⇒ không bao trùm gì (không so tiền tố hở)", () => {
    expect(baoTrum("/ho/danang/cs1", ["/ho/danang/cs10/"])).toBe(false);
  });
});

describe("[KM-MT] mô tả ưu đãi của mã", () => {
  it("phần trăm có/không trần; tiền cố định", () => {
    expect(moTaUuDaiMa({ discountKind: "PERCENT", discountPercent: 10, discountAmount: null, maxDiscount: 500_000 })).toBe(
      "Giảm 10% (tối đa 500.000 đ)",
    );
    expect(moTaUuDaiMa({ discountKind: "PERCENT", discountPercent: 15, discountAmount: null, maxDiscount: null })).toBe("Giảm 15%");
    expect(moTaUuDaiMa({ discountKind: "FIXED", discountPercent: null, discountAmount: 300_000, maxDiscount: null })).toBe(
      "Giảm 300.000 đ",
    );
  });
});
