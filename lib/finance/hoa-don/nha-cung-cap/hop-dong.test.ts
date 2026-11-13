import { describe, expect, it } from "vitest";
import { MA_NHA_CUNG_CAP, NhaCungCapChuaHoTro, PHUONG_THUC_CUA_NANG_LUC } from "./hop-dong";
import { NANG_LUC } from "./nang-luc";

describe("[HDNCC-HDG] hợp đồng adapter — bảng năng lực ↔ phương thức", () => {
  it("[HDNCC-HDG-01] MỖI năng lực ánh xạ tới đúng một phương thức; TAI_PDF và TAI_XML cùng trỏ taiTep; không phương thức nào mồ côi", () => {
    expect(Object.keys(PHUONG_THUC_CUA_NANG_LUC).sort()).toEqual([...NANG_LUC].sort());
    expect(PHUONG_THUC_CUA_NANG_LUC.TAI_PDF).toBe("taiTep");
    expect(PHUONG_THUC_CUA_NANG_LUC.TAI_XML).toBe("taiTep");
    const phuongThuc = new Set(Object.values(PHUONG_THUC_CUA_NANG_LUC));
    // 13 năng lực, trừ một lần trùng taiTep ⇒ 12 phương thức khác nhau
    expect(phuongThuc.size).toBe(12);
  });

  it("[HDNCC-HDG-02] danh sách mã nhà cung cấp ghim: MISA, VIN, Viettel, MOCK — thêm nhà cung cấp mới phải sửa đây có chủ đích", () => {
    expect([...MA_NHA_CUNG_CAP].sort()).toEqual(["MISA_MEINVOICE", "MOCK", "VIETTEL_SINVOICE", "VIN_HOADON"]);
  });

  it("[HDNCC-HDG-03] NhaCungCapChuaHoTro là Error có kiểu: mã EN cố định, mang nhà cung cấp + năng lực, name rõ ràng", () => {
    const loi = new NhaCungCapChuaHoTro("VIN_HOADON", "HUY", "thông điệp");
    expect(loi).toBeInstanceOf(Error);
    expect(loi).toBeInstanceOf(NhaCungCapChuaHoTro);
    expect(loi.ma).toBe("PROVIDER_NOT_SUPPORTED");
    expect(loi.name).toBe("NhaCungCapChuaHoTro");
    expect(loi.nhaCungCap).toBe("VIN_HOADON");
    expect(loi.nangLuc).toBe("HUY");
    expect(loi.message).toBe("thông điệp");
  });
});
