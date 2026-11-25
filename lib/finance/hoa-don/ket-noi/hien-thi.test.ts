import { describe, expect, it } from "vitest";
import { canhBaoChungThu, NGAY_BAO_CHUNG_THU, nhanKetQuaKiemTra, soNgayConLai, tomTatTrangThai } from "./hien-thi";

// Ca [KNH-*] — chữ và mức cảnh báo của «Kết nối & ký». Mọi ca đo cả hai phía của biên (luật 11: đối chứng dương).

describe("[KNH] chứng thư sắp hết hạn", () => {
  const HOM_NAY = "2026-11-04";
  it("[KNH-01] đếm ngày theo lịch VN, âm khi đã hết", () => {
    expect(soNgayConLai("2026-11-04", HOM_NAY)).toBe(0);
    expect(soNgayConLai("2026-11-05", HOM_NAY)).toBe(1);
    expect(soNgayConLai("2026-11-03", HOM_NAY)).toBe(-1);
    expect(soNgayConLai("2027-11-04", HOM_NAY)).toBe(365);
  });

  it("[KNH-02] biên cảnh báo: hết hạn (hôm qua) = danger; hôm nay = warning (ngày CUỐI còn hiệu lực); ≤ 30 ngày = warning; 31 ngày = success", () => {
    expect(canhBaoChungThu("2026-11-01", HOM_NAY)?.muc).toBe("danger");
    expect(canhBaoChungThu("2026-11-04", HOM_NAY)?.muc).toBe("warning");
    expect(canhBaoChungThu("2026-11-05", HOM_NAY)?.muc).toBe("warning");
    expect(canhBaoChungThu("2026-12-04", HOM_NAY)?.muc).toBe("warning"); // đúng 30 ngày
    expect(NGAY_BAO_CHUNG_THU).toBe(30);
    expect(canhBaoChungThu("2026-12-05", HOM_NAY)?.muc).toBe("success"); // 31 ngày
  });

  it("[KNH-03] chưa khai hạn ⇒ null (không bịa)", () => {
    expect(canhBaoChungThu(null, HOM_NAY)).toBeNull();
  });

  it("[KNH-04] câu cảnh báo nói đúng số ngày", () => {
    expect(canhBaoChungThu("2026-11-14", HOM_NAY)?.cau).toContain("10 ngày");
    expect(canhBaoChungThu("2026-10-30", HOM_NAY)?.cau).toContain("5 ngày");
  });
});

describe("[KNH] nhãn kiểm tra và trạng thái", () => {
  it("[KNH-10] mã kiểm tra: OK xanh; sai đăng nhập đỏ; chưa kiểm xám; mã lạ KHÔNG bịa", () => {
    expect(nhanKetQuaKiemTra("OK").muc).toBe("success");
    expect(nhanKetQuaKiemTra("DANG_NHAP_SAI").muc).toBe("danger");
    expect(nhanKetQuaKiemTra(null)).toEqual({ cau: "Chưa kiểm tra", muc: "muted" });
    expect(nhanKetQuaKiemTra("MA_LA_NAO_DO")).toEqual({ cau: "Kết quả kiểm tra không rõ", muc: "muted" });
  });

  it("[KNH-11] tóm tắt trạng thái theo đúng nguồn: bảng · env · không", () => {
    expect(tomTatTrangThai({ nguon: "KHONG", lyDo: "Chưa cấu hình kết nối." })).toMatchObject({ muc: "danger", chiTiet: "Chưa cấu hình kết nối." });
    expect(tomTatTrangThai({ nguon: "ENV", nhaCungCap: "VIN_HOADON", phuongThucKy: "HSM", cheDoKy: "LO" })).toMatchObject({ muc: "info" });
    const usb = tomTatTrangThai({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "USB", cheDoKy: "LO" });
    expect(usb).toMatchObject({ muc: "success" });
    expect(usb.chiTiet).toMatch(/USB token/);
    expect(usb.chiTiet).toMatch(/cả lô/);
    expect(tomTatTrangThai({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "USB", cheDoKy: "TUNG_LENH" }).chiTiet).toMatch(/từng hoá đơn/);
    expect(tomTatTrangThai({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "HSM", cheDoKy: "LO" }).chiTiet).toMatch(/HSM/);
  });
});
