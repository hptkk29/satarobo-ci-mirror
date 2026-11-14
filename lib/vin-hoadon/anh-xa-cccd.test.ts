// [VIN-CC] CCCD / hộ chiếu người mua → dnmua_cccd | dnmua_hochieu (chủ dự án 08/11/2026: hoá đơn nháp thiếu CCCD dù đã khai).
import { describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { kiemPhieuVin, phieuSangVin } from "./anh-xa";

function phieu(cccd: string | null | undefined): PhieuPhatHanh {
  return {
    refId: "ref-001",
    kyHieu: "1C26TSR",
    mstNguoiBan: "0402145678",
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Thùy Trâm", donVi: null, mst: null, diaChi: "Đà Nẵng", email: null, ...(cccd === undefined ? {} : { cccd }) },
    hinhThucThanhToan: "Chuyển khoản",
    dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 }],
    tongTruocThue: 5_000_000,
    tongThue: 0,
    tongThanhToan: 5_000_000,
    soTienBangChu: "Năm triệu đồng.",
  };
}

describe("[VIN-CC] CCCD / hộ chiếu người mua", () => {
  it("[VIN-CC-01] CCCD 12 số (và CMND 9 số) ⇒ dnmua_cccd, đã bỏ khoảng trắng/dấu chấm", () => {
    expect(phieuSangVin(phieu(" 048 176 002 823 "))).toMatchObject({ dnmua_cccd: "048176002823" });
    expect(phieuSangVin(phieu("048.213.003"))).toMatchObject({ dnmua_cccd: "048213003" });
    expect(phieuSangVin(phieu("048176002823"))).not.toHaveProperty("dnmua_hochieu");
  });

  it("[VIN-CC-02] hộ chiếu (chữ + số) ⇒ dnmua_hochieu, KHÔNG nhét vào dnmua_cccd (≤12)", () => {
    const b = phieuSangVin(phieu("c1234567"));
    expect(b).toMatchObject({ dnmua_hochieu: "C1234567" });
    expect(b).not.toHaveProperty("dnmua_cccd");
  });

  it("[VIN-CC-03] ĐỐI CHỨNG ÂM: không khai / trắng ⇒ KHÔNG có khoá nào (không gửi chuỗi rỗng)", () => {
    for (const c of [null, "", "   ", undefined]) {
      const b = phieuSangVin(phieu(c));
      expect(b, String(c)).not.toHaveProperty("dnmua_cccd");
      expect(b, String(c)).not.toHaveProperty("dnmua_hochieu");
    }
  });

  it("[VIN-CC-04] sai dạng (13 số, ký tự lạ, quá ngắn) ⇒ tự chặn trước khi gửi, không in lại số", () => {
    for (const c of ["0481760028231", "04817600@823", "12345"]) {
      const loi = kiemPhieuVin(phieu(c));
      expect(loi, c).toMatch(/CCCD\/hộ chiếu/);
      expect(loi, c).not.toContain(c);
    }
    expect(kiemPhieuVin(phieu("048176002823"))).toBeNull();
  });
});
