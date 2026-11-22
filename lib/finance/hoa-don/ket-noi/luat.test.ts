import { describe, expect, it } from "vitest";
import {
  chuanHoaBaseUrl,
  duocDungDuongHsm,
  giaiKetNoi,
  kiemKetNoi,
  moiTruongKetNoiTuMoiTruongChay,
  type DauVaoKetNoi,
  type KetNoiDaDoc,
  type NguCanhKiemKetNoi,
} from "./luat";

// Ca [KNL-*] — luật thuần của «Kết nối & ký»: kiểm đầu vào + chọn nguồn kết nối (bảng → env → không) + USB không được đi đường HSM.

const VIN_OK: DauVaoKetNoi = {
  phapNhanMa: "NEW_VISION",
  moiTruong: "SANDBOX",
  nhaCungCapMa: "VIN_HOADON",
  dangBat: true,
  baseUrl: "https://demows.vin-hoadon.com",
  mst: "0402341070",
  tenDangNhap: "ketoan",
  phuongThucKy: "USB_TOKEN",
  cheDoKy: "LO",
  chungThuSerial: "5400FA1B2C3D",
  chungThuHetHan: "2027-05-01",
  matKhauMoi: "mat-khau-gia-1",
  lyDo: "Khai kết nối VIN lần đầu cho CS2",
};
const NC_VIN: NguCanhKiemKetNoi = { nhaCungCapCuaPhapNhan: "VIN_HOADON", daCoMatKhau: false };
const sua = (p: Partial<DauVaoKetNoi>, nc = NC_VIN) => kiemKetNoi({ ...VIN_OK, ...p }, nc);

const HANG_VIN: KetNoiDaDoc = {
  nhaCungCapMa: "VIN_HOADON",
  dangBat: true,
  phuongThucKy: "USB_TOKEN",
  cheDoKy: "LO",
  coMatKhau: true,
  baseUrl: "https://demows.vin-hoadon.com",
  mst: "0402341070",
  tenDangNhap: "ketoan",
  chungThuSerial: null,
};

describe("[KNL] kiểm đầu vào khi lưu kết nối", () => {
  it("[KNL-01] đầu vào VIN + USB hợp lệ ⇒ không lỗi (đối chứng dương cho mọi ca dưới)", () => {
    expect(sua({})).toEqual([]);
    expect(kiemKetNoi({ ...VIN_OK, phuongThucKy: "HSM_NHA_CUNG_CAP", chungThuSerial: null, chungThuHetHan: null }, NC_VIN)).toEqual([]);
  });

  it("[KNL-02] lý do < 10 ký tự (kể cả toàn khoảng trắng) bị chặn", () => {
    expect(sua({ lyDo: "ngắn" })).toHaveLength(1);
    expect(sua({ lyDo: "          x" })).toHaveLength(1);
    expect(sua({ lyDo: null })).toHaveLength(1);
  });

  // [ĐẢO 05/11/2026] Luật cũ «nhà cung cấp phải KHỚP `phanMem` khai trong mã; pháp nhân chưa khai ⇒ không cấu hình được» đã bị đảo có chủ đích: chủ dự án chốt «lỡ HO chuyển
  // từ MISA sang VIN thì dev phải code cứng?» ⇒ Quản trị tối cao tự CHỌN nhà cung cấp ở «Kết nối & ký». `phanMem` chỉ còn là mặc định cho pháp nhân chưa có dòng.
  // Các cổng của việc ĐỔI (tạm dừng · không còn hoá đơn dở / lệnh ký chờ · xoá tài khoản cũ) kiểm ở `luuKetNoi` — `[DNC-DB-*]`; luật thuần mới: `[NCCH-07..09]`.
  it("[KNL-03] ĐÃ ĐẢO: nhà cung cấp gửi lên KHÔNG còn bị buộc khớp mặc định trong mã; pháp nhân chưa khai phần mềm vẫn khai được (đối chứng: các luật khác giữ nguyên)", () => {
    expect(sua({}, { nhaCungCapCuaPhapNhan: "MISA_MEINVOICE", daCoMatKhau: false }).join(" ")).not.toMatch(/không khớp/);
    expect(sua({}, { nhaCungCapCuaPhapNhan: null, daCoMatKhau: false }).join(" ")).not.toMatch(/chưa khai phần mềm/);
    expect(sua({ lyDo: "ngắn" }, { nhaCungCapCuaPhapNhan: "MISA_MEINVOICE", daCoMatKhau: false }).join(" ")).toMatch(/Lý do/);
  });

  it("[KNL-04] chế độ ký NEN bị từ chối (OD-08 chưa sửa); TUNG_LENH và LO được", () => {
    expect(sua({ cheDoKy: "NEN" }).join(" ")).toMatch(/nền/);
    expect(sua({ cheDoKy: "TUNG_LENH" })).toEqual([]);
    expect(sua({ cheDoKy: "LO" })).toEqual([]);
    expect(sua({ cheDoKy: "KHAC" })).not.toEqual([]);
  });

  it("[KNL-05] VIN: địa chỉ phải https sạch; MST 10 số hoặc 10-3; thiếu thông tin khi BẬT bị chặn, khi TẮT thì được lưu dở", () => {
    expect(sua({ baseUrl: "http://demows.vin-hoadon.com" })).not.toEqual([]);
    expect(sua({ baseUrl: "https://u:p@demows.vin-hoadon.com" })).not.toEqual([]);
    expect(sua({ baseUrl: "https://demows.vin-hoadon.com/?a=1" })).not.toEqual([]);
    expect(sua({ baseUrl: "https://localhost" })).not.toEqual([]);
    expect(sua({ mst: "12345" })).not.toEqual([]);
    expect(sua({ mst: "0402341070-001" })).toEqual([]);
    expect(sua({ baseUrl: null })).not.toEqual([]);
    expect(sua({ baseUrl: null, mst: null, tenDangNhap: null, matKhauMoi: null, dangBat: false })).toEqual([]);
  });

  it("[KNL-06] mật khẩu: bắt buộc khi bật mà chưa có; giữ mật khẩu cũ khi để trống nếu đã có; quá dài bị chặn", () => {
    expect(sua({ matKhauMoi: null })).not.toEqual([]);
    expect(sua({ matKhauMoi: null }, { ...NC_VIN, daCoMatKhau: true })).toEqual([]);
    expect(sua({ matKhauMoi: "x".repeat(201) })).not.toEqual([]);
  });

  it("[KNL-07] MISA: không nhận địa chỉ/MST/tài khoản/mật khẩu (đọc từ env); USB với MISA bị từ chối; HSM sạch thì được", () => {
    const misa: DauVaoKetNoi = { ...VIN_OK, phapNhanMa: "SATA_ROBO", nhaCungCapMa: "MISA_MEINVOICE", phuongThucKy: "HSM_NHA_CUNG_CAP", baseUrl: null, mst: null, tenDangNhap: null, matKhauMoi: null };
    const nc = { nhaCungCapCuaPhapNhan: "MISA_MEINVOICE" as const, daCoMatKhau: false };
    expect(kiemKetNoi(misa, nc)).toEqual([]);
    expect(kiemKetNoi({ ...misa, matKhauMoi: "x" }, nc)).not.toEqual([]);
    expect(kiemKetNoi({ ...misa, mst: "0402301783" }, nc)).not.toEqual([]);
    expect(kiemKetNoi({ ...misa, phuongThucKy: "USB_TOKEN" }, nc).join(" ")).toMatch(/USB với MISA/);
  });

  it("[KNL-08] chứng thư: serial thập lục phân; ngày hết hạn đúng khuôn", () => {
    expect(sua({ chungThuSerial: "ZZ-không-hợp-lệ" })).not.toEqual([]);
    expect(sua({ chungThuHetHan: "01/05/2027" })).not.toEqual([]);
    expect(sua({ chungThuSerial: null, chungThuHetHan: null })).toEqual([]);
  });

  it("[KNL-09] thông điệp lỗi KHÔNG chứa mật khẩu người dùng gõ", () => {
    const bi = "Mat-Khau-Bi-Mat-9z";
    const loi = sua({ matKhauMoi: bi, baseUrl: "http://x", lyDo: "ngắn", cheDoKy: "NEN" }).join("\n");
    expect(loi.length).toBeGreaterThan(0);
    expect(loi).not.toContain(bi);
  });

  it("[KNL-10] chuẩn hoá địa chỉ: bỏ dấu / cuối, giữ đường dẫn; sai ⇒ null", () => {
    expect(chuanHoaBaseUrl(" https://demows.vin-hoadon.com/ ")).toBe("https://demows.vin-hoadon.com");
    expect(chuanHoaBaseUrl("https://a.vn/vin/")).toBe("https://a.vn/vin");
    expect(chuanHoaBaseUrl("ftp://a.vn")).toBeNull();
    expect(chuanHoaBaseUrl("không phải url")).toBeNull();
  });

  it("[KNL-11] môi trường kết nối: chỉ production thật ⇒ PROD, còn lại SANDBOX", () => {
    expect(moiTruongKetNoiTuMoiTruongChay(true)).toBe("PROD");
    expect(moiTruongKetNoiTuMoiTruongChay(false)).toBe("SANDBOX");
  });
});

describe("[KNL] chọn nguồn kết nối: bảng → env → không", () => {
  const giai = (hang: KetNoiDaDoc | null, ncc: "VIN_HOADON" | "MISA_MEINVOICE" | null = "VIN_HOADON", envCoCong = false) =>
    giaiKetNoi({ hang, nhaCungCapCuaPhapNhan: ncc, envCoCong });

  it("[KNL-20] có dòng BẬT đủ thông tin ⇒ dùng BẢNG, đúng phương thức ký (USB/HSM) và chế độ", () => {
    expect(giai(HANG_VIN)).toEqual({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "USB", cheDoKy: "LO" });
    expect(giai({ ...HANG_VIN, phuongThucKy: "HSM_NHA_CUNG_CAP", cheDoKy: "TUNG_LENH" })).toEqual({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "HSM", cheDoKy: "TUNG_LENH" });
  });

  it("[KNL-21] không có dòng ⇒ biến môi trường (HSM, chế độ LO) nếu đủ; không đủ ⇒ KHONG", () => {
    expect(giai(null, "VIN_HOADON", true)).toEqual({ nguon: "ENV", nhaCungCap: "VIN_HOADON", phuongThucKy: "HSM", cheDoKy: "LO" });
    expect(giai(null, "VIN_HOADON", false).nguon).toBe("KHONG");
  });

  it("[KNL-22] dòng đang TẮT ⇒ KHONG, KHÔNG rơi về env dù env đủ (kế toán tắt có chủ đích)", () => {
    const k = giai({ ...HANG_VIN, dangBat: false }, "VIN_HOADON", true);
    expect(k.nguon).toBe("KHONG");
    expect(giai(HANG_VIN, "VIN_HOADON", true).nguon).toBe("BANG"); // đối chứng: bật thì dùng bảng
  });

  it("[KNL-23] dòng không khớp phần mềm của pháp nhân, hoặc pháp nhân chưa khai phần mềm ⇒ KHONG (không gửi bằng nhà cung cấp khác)", () => {
    expect(giai({ ...HANG_VIN, nhaCungCapMa: "MISA_MEINVOICE" }, "VIN_HOADON", true).nguon).toBe("KHONG");
    expect(giai(HANG_VIN, null, true).nguon).toBe("KHONG");
  });

  it("[KNL-24] VIN thiếu địa chỉ / MST / tài khoản / mật khẩu ⇒ KHONG", () => {
    for (const thieu of [{ baseUrl: null }, { mst: null }, { tenDangNhap: null }, { coMatKhau: false }]) {
      expect(giai({ ...HANG_VIN, ...thieu }).nguon).toBe("KHONG");
    }
  });

  it("[KNL-25] MISA: HSM + env đủ ⇒ BANG; thiếu env ⇒ KHONG; USB ⇒ KHONG", () => {
    const misa: KetNoiDaDoc = { ...HANG_VIN, nhaCungCapMa: "MISA_MEINVOICE", phuongThucKy: "HSM_NHA_CUNG_CAP", baseUrl: null, mst: null, tenDangNhap: null, coMatKhau: false };
    expect(giai(misa, "MISA_MEINVOICE", true).nguon).toBe("BANG");
    expect(giai(misa, "MISA_MEINVOICE", false).nguon).toBe("KHONG");
    expect(giai({ ...misa, phuongThucKy: "USB_TOKEN" }, "MISA_MEINVOICE", true).nguon).toBe("KHONG");
  });

  it("[KNL-26] ĐƯỜNG HSM: USB KHÔNG BAO GIỜ được dùng đường HSM; HSM (bảng hoặc env) được; KHONG thì không", () => {
    expect(duocDungDuongHsm(giai(HANG_VIN))).toBe(false); // USB
    expect(duocDungDuongHsm(giai({ ...HANG_VIN, phuongThucKy: "HSM_NHA_CUNG_CAP" }))).toBe(true);
    expect(duocDungDuongHsm(giai(null, "VIN_HOADON", true))).toBe(true);
    expect(duocDungDuongHsm(giai(null, "VIN_HOADON", false))).toBe(false);
  });

  it("[KNL-27] chế độ ký lạ ở DB ⇒ về LO (không bao giờ NEN âm thầm)", () => {
    for (const la of ["NEN", "KY_LA"]) {
      const k = giai({ ...HANG_VIN, cheDoKy: la });
      expect(k.nguon === "BANG" && k.cheDoKy).toBe("LO");
    }
    const t = giai({ ...HANG_VIN, cheDoKy: "TUNG_LENH" }); // đối chứng dương
    expect(t.nguon === "BANG" && t.cheDoKy).toBe("TUNG_LENH");
  });
});
