// @vitest-environment node
/** [NHH-DSP-UI-L*] — chữ hiển thị của tab Khiếu nại (THUẦN): không in mã enum trần, cùng một mô tả cho bảng và Sheet. */
import { describe, it, expect } from "vitest";

import { TRANG_THAI_KHIEU_NAI } from "@/lib/hoa-hong/khieu-nai-trang-thai";
import { NHAN_KET_QUA } from "@/lib/hoa-hong/khieu-nai-trang-thai";
import { dangChoDoiNguon, inkKetQuaHienThi, maKhieuNai, moTaDich, moTaDichNgan, nhanKetQuaHienThi, nhanVai, TONE_KET_QUA, toneKetQuaHienThi, tuoiMo } from "./nhan-khieu-nai";

describe("[NHH-DSP-UI-L1] nhan-khieu-nai", () => {
  it("nhanVai: vai master có tên tiếng Việt; mã lạ in lại mã (không đoán)", () => {
    expect(nhanVai("SALE")).toBe("Sale (người chốt đơn)");
    expect(nhanVai("REFERRER_PARENT")).toBe("Phụ huynh giới thiệu");
    expect(nhanVai("VAI_LA")).toBe("VAI_LA");
  });

  it("moTaDich: dòng = vai · tiền · kỳ; khoản thu = tiền (+ đơn); số lớn giữ nguyên dấu chấm nghìn", () => {
    expect(moTaDich({ loai: "DONG", vai: "SALE", soTien: 363_636, ky: "2026-10", nguoiHuong: "x" })).toBe("Sale (người chốt đơn) · 363.636đ · kỳ 2026-10");
    expect(moTaDich({ loai: "KHOAN", soTien: 955_563_000, maDon: "ORD-001", ngayThu: new Date("2026-10-12T03:00:00Z") })).toBe("Khoản thu 955.563.000đ · đơn ORD-001");
    expect(moTaDich({ loai: "KHOAN", soTien: 4_000_000, maDon: null, ngayThu: new Date("2026-10-12T03:00:00Z") })).toBe("Khoản thu 4.000.000đ");
  });

  it("tuoiMo: hôm nay / N ngày; số âm (đồng hồ lệch) không in '-1 ngày'", () => {
    expect([tuoiMo(0), tuoiMo(1), tuoiMo(12), tuoiMo(-3)]).toEqual(["hôm nay", "1 ngày", "12 ngày", "hôm nay"]);
  });

  it("mọi kết quả đều có tông và có nhãn tiếng Việt; không nhãn nào chứa mã enum trần", () => {
    for (const k of Object.keys(NHAN_KET_QUA) as (keyof typeof NHAN_KET_QUA)[]) {
      expect(TONE_KET_QUA[k], k).toBeDefined();
      expect(NHAN_KET_QUA[k]).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    }
    expect(TRANG_THAI_KHIEU_NAI).toHaveLength(5);
  });

  it("maKhieuNai: 6 ký tự cuối, in hoa", () => {
    expect(maKhieuNai("cmuzmk8e3003vgnr9r5b9yjnk")).toBe("R5B9YJNK".slice(-6));
  });
});

describe("[NHH-DSP-UI-L2] pill kết quả nói thật: duyệt 'sửa nguồn' chưa đóng là việc còn treo", () => {
  it("APPROVED + sửa nguồn ⇒ 'chờ đổi nguồn', tông warning; CLOSED ⇒ xanh 'Được duyệt — sửa nguồn' (đối chứng)", () => {
    expect(dangChoDoiNguon("DUOC_DUYET_DOI_NGUON", "APPROVED")).toBe(true);
    expect(nhanKetQuaHienThi("DUOC_DUYET_DOI_NGUON", "APPROVED")).toBe("Đã duyệt — chờ đổi nguồn");
    expect(toneKetQuaHienThi("DUOC_DUYET_DOI_NGUON", "APPROVED")).toBe("warning");
    expect(inkKetQuaHienThi("DUOC_DUYET_DOI_NGUON", "APPROVED")).toBe("text-state-warning-ink");
    expect(dangChoDoiNguon("DUOC_DUYET_DOI_NGUON", "CLOSED")).toBe(false);
    expect(nhanKetQuaHienThi("DUOC_DUYET_DOI_NGUON", "CLOSED")).toBe("Được duyệt — sửa nguồn");
    expect(toneKetQuaHienThi("DUOC_DUYET_DOI_NGUON", "CLOSED")).toBe("success");
    // điều chỉnh tiền đóng ngay trong giao dịch quyết định — không bao giờ ở APPROVED, và không bị đổi nhãn.
    expect(nhanKetQuaHienThi("DUOC_DUYET_DIEU_CHINH_TIEN", "CLOSED")).toBe("Được duyệt — điều chỉnh tiền");
  });

  it("moTaDichNgan KHÔNG chứa số tiền (số tiền có cột riêng); moTaDich vẫn có", () => {
    const dong = { loai: "DONG", vai: "SALE", soTien: 363_636, ky: "2026-10", nguoiHuong: "x" } as const;
    expect(moTaDichNgan(dong)).toBe("Sale (người chốt đơn) · kỳ 2026-10");
    expect(moTaDichNgan(dong)).not.toMatch(/\d\.\d{3}/);
    expect(moTaDichNgan({ loai: "KHOAN", soTien: 4_000_000, maDon: "ORD-001", ngayThu: new Date("2026-10-12T03:00:00Z") })).toBe("Khoản thu · đơn ORD-001");
  });
});
