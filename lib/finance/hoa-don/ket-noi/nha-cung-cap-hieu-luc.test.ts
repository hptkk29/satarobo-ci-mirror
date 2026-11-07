// [NCC-*] Nhà cung cấp HIỆU LỰC của pháp nhân = dòng kết nối đã lưu (Quản trị tối cao chọn) thắng mặc định trong mã (`phanMem`). THUẦN, không DB.
// Anh hỏi: «lỡ HO không dùng MISA mà chuyển sang VIN-HOADON thì dev phải code cứng?» — nay không: chọn ở «Kết nối & ký».
import { describe, expect, it } from "vitest";
import {
  CAU_HINH_HOA_DON_MAC_DINH,
  laNhaCungCapApi,
  laPhapNhanPhatHanhQuaApi,
  nhaCungCapApiCuaPhapNhan,
  nhaCungCapHieuLuc,
  phapNhanVoiNhaCungCap,
} from "../phap-nhan";
import { giaiKetNoi, kiemKetNoi, type DauVaoKetNoi } from "./luat";

const SATA = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "SATA_ROBO")!; // mặc định MISA
const NEW_VISION = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "NEW_VISION")!; // mặc định VIN

describe("[NCC] nhà cung cấp hiệu lực", () => {
  it("[NCCH-01] KHÔNG có dòng ⇒ mặc định trong mã (prod hôm nay: hành vi y hệt trước khi có lựa chọn)", () => {
    expect(nhaCungCapHieuLuc(SATA, null)).toBe("MISA_MEINVOICE");
    expect(nhaCungCapHieuLuc(SATA, undefined)).toBe("MISA_MEINVOICE");
    expect(nhaCungCapHieuLuc(NEW_VISION, null)).toBe("VIN_HOADON");
  });

  it("[NCCH-02] CÓ dòng ⇒ dòng THẮNG mặc định, theo cả hai chiều (HO sang VIN; CS sang MISA)", () => {
    expect(nhaCungCapHieuLuc(SATA, "VIN_HOADON")).toBe("VIN_HOADON");
    expect(nhaCungCapHieuLuc(NEW_VISION, "MISA_MEINVOICE")).toBe("MISA_MEINVOICE");
  });

  it("[NCCH-03] giá trị LẠ trong DB bị bỏ qua (rơi về mặc định) — không bao giờ trả một nhà cung cấp không có cổng", () => {
    for (const la of ["", "misa", "VIN", "FAST", "MISA_MEINVOICE " ]) expect(nhaCungCapHieuLuc(SATA, la), la).toBe("MISA_MEINVOICE");
    expect(laNhaCungCapApi("VIN_HOADON")).toBe(true);
    expect(laNhaCungCapApi("misa")).toBe(false);
  });

  it("[NCCH-04] pháp nhân chưa khai `phanMem` mà có dòng ⇒ theo dòng; không dòng ⇒ null (không đoán)", () => {
    expect(nhaCungCapHieuLuc({ phanMem: undefined }, "VIN_HOADON")).toBe("VIN_HOADON");
    expect(nhaCungCapHieuLuc({ phanMem: undefined }, null)).toBeNull();
    expect(nhaCungCapHieuLuc(null, null)).toBeNull();
  });
});

describe("[NCC] pháp nhân mang `phanMem` đúng nhà cung cấp hiệu lực", () => {
  it("[NCCH-05] đổi sang VIN ⇒ mọi vị từ cũ (laPhapNhanPhatHanhQuaApi / nhaCungCapApiCuaPhapNhan) và dòng chữ «… phát hành» trên phiếu đọc VIN; bản gốc KHÔNG bị sửa", () => {
    const vin = phapNhanVoiNhaCungCap(SATA, "VIN_HOADON");
    expect(vin.phanMem).toBe("VIN HOADON");
    expect(nhaCungCapApiCuaPhapNhan(vin)).toBe("VIN_HOADON");
    expect(laPhapNhanPhatHanhQuaApi(vin)).toBe(true);
    expect(SATA.phanMem).toBe("MISA meInvoice"); // bất biến: hằng số trong mã không bị đổi
    expect(CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "SATA_ROBO")!.phanMem).toBe("MISA meInvoice");
  });

  it("[NCCH-06] trùng nhà cung cấp mặc định ⇒ trả NGUYÊN đối tượng (không sao chép thừa); `null` ⇒ trả nguyên (không bịa phần mềm)", () => {
    expect(phapNhanVoiNhaCungCap(SATA, "MISA_MEINVOICE")).toBe(SATA);
    expect(phapNhanVoiNhaCungCap(SATA, null)).toBe(SATA);
    const khongPhanMem = { ...SATA, phanMem: undefined };
    expect(phapNhanVoiNhaCungCap(khongPhanMem, null).phanMem).toBeUndefined();
  });
});

describe("[NCC] luật kiểm kết nối không còn buộc khớp mặc định trong mã", () => {
  const vinDayDu: DauVaoKetNoi = {
    phapNhanMa: "SATA_ROBO",
    moiTruong: "SANDBOX",
    nhaCungCapMa: "VIN_HOADON",
    dangBat: true,
    baseUrl: "https://vin-thu.example.test",
    mst: "0402301783",
    tenDangNhap: "ketoan",
    phuongThucKy: "HSM_NHA_CUNG_CAP",
    cheDoKy: "LO",
    chungThuSerial: null,
    chungThuHetHan: null,
    matKhauMoi: "mat-khau-vin",
    lyDo: "HO chuyển sang VIN theo quyết định",
  };

  it("[NCCH-07] pháp nhân mặc định MISA mà gửi VIN đầy đủ ⇒ HỢP LỆ (trước đây: «không khớp phần mềm phát hành đã khai»)", () => {
    expect(kiemKetNoi(vinDayDu, { nhaCungCapCuaPhapNhan: "MISA_MEINVOICE", daCoMatKhau: false })).toEqual([]);
    expect(kiemKetNoi(vinDayDu, { nhaCungCapCuaPhapNhan: null, daCoMatKhau: false })).toEqual([]); // pháp nhân chưa khai phần mềm vẫn khai được
  });

  it("[NCCH-08] ĐỐI CHỨNG ÂM — các luật khác GIỮ NGUYÊN: VIN bật mà thiếu mật khẩu / MISA + USB / lý do ngắn vẫn bị từ chối", () => {
    expect(kiemKetNoi({ ...vinDayDu, matKhauMoi: null }, { nhaCungCapCuaPhapNhan: "MISA_MEINVOICE", daCoMatKhau: false }).join("|")).toMatch(/mật khẩu/i);
    expect(kiemKetNoi({ ...vinDayDu, nhaCungCapMa: "MISA_MEINVOICE", phuongThucKy: "USB_TOKEN" }, { nhaCungCapCuaPhapNhan: "VIN_HOADON", daCoMatKhau: false }).join("|")).toMatch(/USB với MISA/);
    expect(kiemKetNoi({ ...vinDayDu, lyDo: "ngắn" }, { nhaCungCapCuaPhapNhan: "MISA_MEINVOICE", daCoMatKhau: false }).join("|")).toMatch(/Lý do/);
  });

  it("[NCCH-09] `giaiKetNoi` vẫn là lưới phụ: người gọi đưa nhà cung cấp KHÔNG khớp dòng ⇒ KHONG (không gửi sang nơi khác); đưa đúng nhà cung cấp hiệu lực ⇒ dùng được", () => {
    const hang = { nhaCungCapMa: "VIN_HOADON", dangBat: true, phuongThucKy: "HSM_NHA_CUNG_CAP", cheDoKy: "LO", coMatKhau: true, baseUrl: "https://x.example.test", mst: "0402301783", tenDangNhap: "u", chungThuSerial: null };
    expect(giaiKetNoi({ hang, nhaCungCapCuaPhapNhan: "MISA_MEINVOICE", envCoCong: false }).nguon).toBe("KHONG");
    expect(giaiKetNoi({ hang, nhaCungCapCuaPhapNhan: nhaCungCapHieuLuc(SATA, hang.nhaCungCapMa), envCoCong: false }).nguon).toBe("BANG");
  });
});
