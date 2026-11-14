import { describe, expect, it } from "vitest";
import { BIEN_VIN, docCauHinhVin, kiemBaseUrlVin, type EnvVin } from "./cau-hinh";

const OK: EnvVin = {
  VIN_EINVOICE_MODE: "sandbox",
  VIN_EINVOICE_BASE_URL: "https://vin-thu.example.test",
  VIN_EINVOICE_USERNAME: "nguoi-dung-gia",
  VIN_EINVOICE_PASSWORD: "  mat-khau-gia  ",
};

describe("[VIN-CH] cấu hình cổng VIN-HOADON từ env — thiếu/sai ⇒ TẮT, chỉ nói TÊN biến", () => {
  it("[VIN-CH-01] không khai / off ⇒ tắt, không lỗi; giá trị lạ ⇒ tắt kèm câu lỗi", () => {
    for (const mode of [undefined, "", "off", "OFF"]) {
      const r = docCauHinhVin({ ...OK, VIN_EINVOICE_MODE: mode });
      expect(r.cauHinh, String(mode)).toBeNull();
      expect(r.loi, String(mode)).toBeNull();
      expect(r.cheDoKhai, String(mode)).toBe("off");
    }
    const la = docCauHinhVin({ ...OK, VIN_EINVOICE_MODE: "gia-lap" });
    expect(la.cauHinh).toBeNull();
    expect(la.loi).toMatch(/VIN_EINVOICE_MODE/);
  });

  it("[VIN-CH-02] khai bật mà thiếu biến ⇒ TẮT và liệt kê TÊN biến thiếu, KHÔNG chứa giá trị nào", () => {
    const r = docCauHinhVin({ VIN_EINVOICE_MODE: "production", VIN_EINVOICE_USERNAME: "nguoi-dung-gia" });
    expect(r.cauHinh).toBeNull();
    expect(r.thieu.sort()).toEqual([BIEN_VIN.BASE_URL, BIEN_VIN.MAT_KHAU].sort());
    expect(r.loi).toContain(BIEN_VIN.BASE_URL);
    expect(r.loi).not.toContain("nguoi-dung-gia");
  });

  it("[VIN-CH-03] đủ biến ⇒ bật; gốc URL chuẩn hoá về origin; mật khẩu KHÔNG bị trim, tài khoản có trim", () => {
    const r = docCauHinhVin({ ...OK, VIN_EINVOICE_USERNAME: "  nguoi-dung-gia ", VIN_EINVOICE_BASE_URL: "https://vin-thu.example.test/" });
    expect(r.cauHinh).toEqual({
      cheDo: "sandbox",
      baseUrl: "https://vin-thu.example.test",
      username: "nguoi-dung-gia",
      password: "  mat-khau-gia  ",
    });
  });

  it("[VIN-CH-04] URL: bắt buộc https, không thông tin đăng nhập, không query/fragment, KHÔNG có đường dẫn (do mã tự nối /api/services/hddtws)", () => {
    const xau: Array<readonly [string, string]> = [
      ["không phải URL", "vin-thu"],
      ["http", "http://vin-thu.example.test"],
      ["có user:pass", "https://u:p@vin-thu.example.test"],
      ["có query", "https://vin-thu.example.test?x=1"],
      ["có fragment", "https://vin-thu.example.test#a"],
      ["có đường dẫn", "https://vin-thu.example.test/api/services/hddtws"],
    ];
    for (const [nhan, url] of xau) expect(kiemBaseUrlVin("sandbox", url), nhan).not.toBeNull();
    // đối chứng DƯƠNG: có cổng thì vẫn hợp lệ
    expect(kiemBaseUrlVin("sandbox", "https://vin-thu.example.test:8443")).toBeNull();
    expect(kiemBaseUrlVin("production", "https://hoadon.vin.example.vn")).toBeNull();
  });

  it("[VIN-CH-05] production TỪ CHỐI host trông như môi trường thử; sandbox thì nhận", () => {
    for (const host of ["test.vin.example.vn", "vin-sandbox.example.vn", "demo.vin.example.vn", "uat-vin.example.vn", "vin.staging.example.vn", "dev1.vin.example.vn"]) {
      expect(kiemBaseUrlVin("production", `https://${host}`), host).toMatch(/môi trường thử/);
      expect(kiemBaseUrlVin("sandbox", `https://${host}`), host).toBeNull();
    }
    // không bắt oan: "protest"/"developer" chứa chữ nhưng không phải nhãn môi trường
    expect(kiemBaseUrlVin("production", "https://contestvin.example.vn")).toBeNull();
  });

  it("[VIN-CH-06] sai URL ⇒ TẮT với câu lỗi nêu TÊN biến, không in giá trị URL", () => {
    const r = docCauHinhVin({ ...OK, VIN_EINVOICE_BASE_URL: "http://bi-mat.example.test" });
    expect(r.cauHinh).toBeNull();
    expect(r.loi).toContain(BIEN_VIN.BASE_URL);
    expect(r.loi).not.toContain("bi-mat.example.test");
  });
});
