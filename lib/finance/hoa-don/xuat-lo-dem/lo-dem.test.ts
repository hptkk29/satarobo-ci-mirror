import { describe, expect, it } from "vitest";
import type { DonChoHoaDon } from "../nguoi-mua";
import { lui, lyDoBoQuaLanThu, SO_NGAY_LUI, type BoiCanhChonLo, type DongUngVien, GIO_LO_CUOI_NGAY_VN, gioLoCuoiNgayKeTiep, GIO_YEN_LANG_VN, thoiDiemGuiThuHoaDonLo } from "./chon-lan-thu";
import { nguoiMuaChoLoDem, tenHocVienChoLanThu, TRAN_TEN_NGUOI_MUA } from "./nguoi-mua-tieu-dung";

// Luật của LÔ ĐÊM 23H — phần THUẦN (chọn lần thu · chọn người mua). Phần có DB ở tests/finance/hoa-don-lo-dem-db.test.ts.

const donTrong = (p: Partial<DonChoHoaDon> = {}): DonChoHoaDon => ({
  customerName: "Nguyễn Văn Ba",
  customerPhone: "0905123456",
  customerEmail: "ba@example.com",
  customerAddress: null,
  customerWard: null,
  customerCity: null,
  customerCccd: null,
  invoiceBuyerName: null,
  invoiceCompanyName: null,
  invoiceTaxCode: null,
  invoiceCustomerCode: null,
  invoiceEmail: null,
  ...p,
});

describe("[LD-NM] người mua của hoá đơn lô đêm", () => {
  it("[LD-NM-01] đơn chưa khai gì ⇒ «tiêu dùng»: tên = HỌC VIÊN (không phải phụ huynh), địa chỉ = tỉnh/thành của cơ sở", () => {
    const r = nguoiMuaChoLoDem(donTrong(), { tenHocVien: "Trần Bảo An", tinhThanh: "Đà Nẵng" });
    expect(r).toMatchObject({ ok: true, nguon: "TIEU_DUNG" });
    if (!r.ok) return;
    expect(r.nguoiMua.hoTen).toBe("Trần Bảo An");
    expect(r.nguoiMua.hoTen).not.toBe("Nguyễn Văn Ba");
    expect(r.nguoiMua.diaChi).toBe("Đà Nẵng");
    expect(r.nguoiMua.tenDonVi).toBeNull();
    expect(r.nguoiMua.maSoThue).toBeNull();
    expect(r.nguoiMua.cccd).toBeNull();
    // email/điện thoại người đặt đơn vẫn dùng để GỬI tờ cho phụ huynh
    expect(r.nguoiMua.email).toBe("ba@example.com");
  });

  it("[LD-NM-02] đơn đã có địa chỉ ⇒ dùng địa chỉ của đơn, KHÔNG ghi đè bằng tỉnh/thành của cơ sở", () => {
    const r = nguoiMuaChoLoDem(donTrong({ customerAddress: "12 Lê Lợi", customerCity: "Đà Nẵng" }), { tenHocVien: "Trần Bảo An", tinhThanh: "Hà Nội" });
    expect(r.ok && r.nguoiMua.diaChi).toBe("12 Lê Lợi, Đà Nẵng");
  });

  it("[LD-NM-03] ƯU TIÊN thông tin Sale đã khai: đã khai và ĐỦ ⇒ dùng nguyên, không thay bằng tên học viên", () => {
    const r = nguoiMuaChoLoDem(donTrong({ invoiceBuyerName: "Lê Thị Mẹ", customerAddress: "5 Hoàng Diệu" }), { tenHocVien: "Trần Bảo An", tinhThanh: "Đà Nẵng" });
    expect(r).toMatchObject({ ok: true, nguon: "SALE_DA_KHAI" });
    expect(r.ok && r.nguoiMua.hoTen).toBe("Lê Thị Mẹ");
  });

  it("[LD-NM-04] đã khai nhưng CHƯA ĐỦ (tên công ty, thiếu MST) ⇒ BỎ QUA, không xuất «tiêu dùng» đè lên tờ người đó cần", () => {
    const r = nguoiMuaChoLoDem(donTrong({ invoiceCompanyName: "Công ty ABC", customerAddress: "5 Hoàng Diệu" }), { tenHocVien: "Trần Bảo An", tinhThanh: "Đà Nẵng" });
    expect(r).toMatchObject({ ok: false, ma: "DA_KHAI_CHUA_DU" });
  });

  it("[LD-NM-05] không có tên học viên ⇒ bỏ qua (không bịa, không lấy tên phụ huynh thay)", () => {
    expect(nguoiMuaChoLoDem(donTrong(), { tenHocVien: null, tinhThanh: "Đà Nẵng" })).toMatchObject({ ok: false, ma: "THIEU_TEN_HOC_VIEN" });
    expect(nguoiMuaChoLoDem(donTrong(), { tenHocVien: "   ", tinhThanh: "Đà Nẵng" })).toMatchObject({ ok: false, ma: "THIEU_TEN_HOC_VIEN" });
  });

  it("[LD-NM-06] không có địa chỉ và cơ sở chưa khai tỉnh/thành ⇒ bỏ qua", () => {
    expect(nguoiMuaChoLoDem(donTrong(), { tenHocVien: "Trần Bảo An", tinhThanh: null })).toMatchObject({ ok: false, ma: "THIEU_TINH_THANH" });
    expect(nguoiMuaChoLoDem(donTrong(), { tenHocVien: "Trần Bảo An", tinhThanh: " " })).toMatchObject({ ok: false, ma: "THIEU_TINH_THANH" });
  });
});

describe("[LD-TEN] tên học viên của một lần thu", () => {
  it("[LD-TEN-01] ô Sale đã nhập thắng tên suy từ khoản", () => {
    expect(tenHocVienChoLanThu({ saleDaNhap: "Bé Na", theoKhoan: ["Trần Bảo An"] })).toBe("Bé Na");
  });
  it("[LD-TEN-02] nhiều khoản cùng một bé ⇒ một tên; hai bé ⇒ nối bằng dấu phẩy, không trùng (không phân biệt hoa/thường)", () => {
    expect(tenHocVienChoLanThu({ saleDaNhap: null, theoKhoan: ["Trần Bảo An", "trần bảo an", null, "Lê Minh"] })).toBe("Trần Bảo An, Lê Minh");
  });
  it("[LD-TEN-03] không có tên nào ⇒ null", () => {
    expect(tenHocVienChoLanThu({ saleDaNhap: null, theoKhoan: [null, "", "  "] })).toBeNull();
    expect(tenHocVienChoLanThu({ saleDaNhap: null, theoKhoan: [] })).toBeNull();
  });
  it("[LD-TEN-04] quá trần ⇒ cắt Ở RANH GIỚI TÊN, không cắt giữa một tên", () => {
    const ten = (i: number) => `Học viên số ${String(i).padStart(3, "0")} ${"x".repeat(20)}`;
    const r = tenHocVienChoLanThu({ saleDaNhap: null, theoKhoan: Array.from({ length: 30 }, (_, i) => ten(i)) })!;
    expect(r.length).toBeLessThanOrEqual(TRAN_TEN_NGUOI_MUA);
    expect(r.split(", ").every((t) => /^Học viên số \d{3} x{20}$/.test(t))).toBe(true);
  });
});

const ung = (p: Partial<DongUngVien> = {}): DongUngVien => ({
  ngan: "cho",
  ngayThu: "2026-11-03",
  coSoId: "cs1",
  phatHanhHien: true,
  coNgoaiLe: false,
  orderId: "o1",
  khoanIds: ["p1"],
  cocChuaTraDu: false,
  ...p,
});
const bc = (p: Partial<BoiCanhChonLo> = {}): BoiCanhChonLo => ({
  homNay: "2026-11-03",
  coSoTrongLo: new Set(["cs1"]),
  donKhachDangKhai: new Set(),
  khoanChuaXacNhan: new Set(),
  ...p,
});

describe("[LD-CHON] lần thu nào vào lô", () => {
  it("[LD-CHON-COC] đơn CỌC chưa trả đủ ⇒ KHÔNG vào lô (giữ cả đơn: MỘT hoá đơn khi trả đủ); đối chứng: đơn thường và đơn cọc đã trả đủ vào lô", () => {
    expect(lyDoBoQuaLanThu(ung({ cocChuaTraDu: true }), bc())).toBe("DON_COC_CHUA_TRA_DU");
    expect(lyDoBoQuaLanThu(ung({ cocChuaTraDu: false }), bc())).toBeNull();
    // Thứ tự nguyên nhân: cọc đứng SAU «khách đang khai» và TRƯỚC «khoản chưa xác nhận» (cọc chưa đủ thì chuyện xác nhận chưa phải việc của lô).
    expect(lyDoBoQuaLanThu(ung({ cocChuaTraDu: true }), bc({ donKhachDangKhai: new Set(["o1"]) }))).toBe("KHACH_DANG_KHAI");
    expect(lyDoBoQuaLanThu(ung({ cocChuaTraDu: true }), bc({ khoanChuaXacNhan: new Set(["p1"]) }))).toBe("DON_COC_CHUA_TRA_DU");
  });
  it("[LD-CHON-01] lần thu hôm nay, đủ điều kiện ⇒ vào lô (null)", () => {
    expect(lyDoBoQuaLanThu(ung(), bc())).toBeNull();
  });
  it("[LD-CHON-02] cơ sở ngoài thí điểm ⇒ KHÔNG vào (cơ sở null cũng không)", () => {
    expect(lyDoBoQuaLanThu(ung({ coSoId: "cs9" }), bc())).toBe("CO_SO_NGOAI_LO");
    expect(lyDoBoQuaLanThu(ung({ coSoId: null }), bc())).toBe("CO_SO_NGOAI_LO");
    expect(lyDoBoQuaLanThu(ung(), bc({ coSoTrongLo: new Set() }))).toBe("CO_SO_NGOAI_LO");
  });
  it("[LD-CHON-03] cửa sổ ngày: hôm nay và hôm qua vào; trước đó KHÔNG (không xuất lùi ngày)", () => {
    expect(SO_NGAY_LUI).toBe(1);
    expect(lyDoBoQuaLanThu(ung({ ngayThu: "2026-11-02" }), bc())).toBeNull();
    expect(lyDoBoQuaLanThu(ung({ ngayThu: "2026-11-01" }), bc())).toBe("NGAY_CU");
    expect(lyDoBoQuaLanThu(ung({ ngayThu: "2026-10-03" }), bc())).toBe("NGAY_CU");
  });
  it("[LD-CHON-04] lui() đúng qua ranh giới tháng/năm", () => {
    expect(lui("2026-11-01", 1)).toBe("2026-10-31");
    expect(lui("2027-01-01", 1)).toBe("2026-12-31");
    expect(lui("2028-03-01", 1)).toBe("2028-02-29");
  });
  it("[LD-CHON-05] ngăn khác «Chờ xuất» (lệch, nháp, đã xuất…) ⇒ không vào", () => {
    for (const ngan of ["lech", "nhap", "phat-hanh", "da-xuat", "khong-xuat", "don-huy", "can-dieu-chinh"]) {
      expect(lyDoBoQuaLanThu(ung({ ngan }), bc())).toBe("NGAN_KHAC");
    }
  });
  it("[LD-CHON-06] nút phát hành không hiện / có ngoại lệ ⇒ không vào", () => {
    expect(lyDoBoQuaLanThu(ung({ phatHanhHien: false }), bc())).toBe("KHONG_PHAT_HANH_DUOC");
    expect(lyDoBoQuaLanThu(ung({ coNgoaiLe: true }), bc())).toBe("NGOAI_LE");
  });
  it("[LD-CHON-07] phụ huynh đang khai / vừa gửi ⇒ không vào (chờ kế toán áp dụng)", () => {
    expect(lyDoBoQuaLanThu(ung(), bc({ donKhachDangKhai: new Set(["o1"]) }))).toBe("KHACH_DANG_KHAI");
    // đối chứng ÂM: đơn khác đang khai không chặn đơn này
    expect(lyDoBoQuaLanThu(ung(), bc({ donKhachDangKhai: new Set(["o2"]) }))).toBeNull();
  });
  it("[LD-CHON-08] CHỈ MỘT khoản chưa được kế toán xác nhận cũng đủ loại cả lần thu (lô không tự xác nhận tiền)", () => {
    const dong = ung({ khoanIds: ["p1", "p2"] });
    expect(lyDoBoQuaLanThu(dong, bc({ khoanChuaXacNhan: new Set(["p2"]) }))).toBe("KHOAN_CHUA_XAC_NHAN");
    expect(lyDoBoQuaLanThu(dong, bc({ khoanChuaXacNhan: new Set(["p9"]) }))).toBeNull();
    // lần thu không có khoản nào = dữ liệu hỏng ⇒ không vào (fail-closed)
    expect(lyDoBoQuaLanThu(ung({ khoanIds: [] }), bc())).toBe("KHOAN_CHUA_XAC_NHAN");
  });
});

describe("[LD-GIO] giờ lô cuối ngày 23h30 (BGĐ đổi 09/11/2026)", () => {
  it("hằng 23h30; trước 23h30 VN ⇒ lượt kế là 23h30 CÙNG ngày; đúng 23h30 hoặc sau ⇒ ngày hôm sau", () => {
    expect(GIO_LO_CUOI_NGAY_VN).toEqual({ gio: 23, phut: 30 });
    // 03/11/2026 10:00 VN = 03:00Z → 23:30 VN cùng ngày = 16:30Z
    expect(gioLoCuoiNgayKeTiep(new Date("2026-11-03T03:00:00Z")).toISOString()).toBe("2026-11-03T16:30:00.000Z");
    // 23:29:59 VN (16:29:59Z) vẫn là lượt hôm nay
    expect(gioLoCuoiNgayKeTiep(new Date("2026-11-03T16:29:59Z")).toISOString()).toBe("2026-11-03T16:30:00.000Z");
    // đúng 23:30 VN ⇒ đã tới giờ ⇒ lượt kế là hôm sau
    expect(gioLoCuoiNgayKeTiep(new Date("2026-11-03T16:30:00Z")).toISOString()).toBe("2026-11-04T16:30:00.000Z");
    expect(gioLoCuoiNgayKeTiep(new Date("2026-11-03T16:45:00Z")).toISOString()).toBe("2026-11-04T16:30:00.000Z");
  });
  it("ranh giới NGÀY VN ≠ ngày UTC: 00:10 VN (17:10Z hôm trước) ⇒ lượt kế là 23:30 của NGÀY VN đó (16:30Z hôm sau theo UTC)", () => {
    // 04/11/2026 00:10 VN = 03/11 17:10Z → ngày VN là 04/11 → lô kế = 04/11 23:30 VN = 04/11 16:30Z
    expect(gioLoCuoiNgayKeTiep(new Date("2026-11-03T17:10:00Z")).toISOString()).toBe("2026-11-04T16:30:00.000Z");
  });
  it("qua ranh giới tháng / năm vẫn đúng (31/12 23:40 VN ⇒ 01/01 23:30 VN)", () => {
    expect(gioLoCuoiNgayKeTiep(new Date("2026-12-31T16:40:00Z")).toISOString()).toBe("2027-01-01T16:30:00.000Z");
  });
});

describe("[LD-MAIL] thư hoá đơn do lô cuối ngày tạo chỉ gửi từ 8h sáng (BGĐ 09/11/2026)", () => {
  it("khung yên lặng 22h–8h VN", () => {
    expect(GIO_YEN_LANG_VN).toEqual({ tu: 22, den: 8 });
  });
  it("lô xong lúc 23h30 VN ⇒ hẹn 8h SÁNG HÔM SAU (01h00 UTC)", () => {
    // 03/11 23:35 VN = 03/11 16:35Z → 04/11 08:00 VN = 04/11 01:00Z
    expect(thoiDiemGuiThuHoaDonLo(new Date("2026-11-03T16:35:00Z")).toISOString()).toBe("2026-11-04T01:00:00.000Z");
  });
  it("sau nửa đêm mà trước 8h (00:20 VN) ⇒ hẹn 8h SÁNG CÙNG NGÀY VN đó", () => {
    // 04/11 00:20 VN = 03/11 17:20Z → 04/11 08:00 VN = 04/11 01:00Z
    expect(thoiDiemGuiThuHoaDonLo(new Date("2026-11-03T17:20:00Z")).toISOString()).toBe("2026-11-04T01:00:00.000Z");
    // 07:59:59 VN vẫn trong khung ⇒ 8h cùng ngày
    expect(thoiDiemGuiThuHoaDonLo(new Date("2026-11-04T00:59:59Z")).toISOString()).toBe("2026-11-04T01:00:00.000Z");
  });
  it("ngoài khung (8h00–21h59 VN) ⇒ gửi NGAY, đúng thời điểm truyền vào (không hẹn)", () => {
    for (const z of ["2026-11-04T01:00:00Z", "2026-11-04T05:00:00Z", "2026-11-04T14:59:59Z"]) {
      const t = new Date(z);
      expect(thoiDiemGuiThuHoaDonLo(t).getTime()).toBe(t.getTime());
    }
    // 22:00 VN (15:00Z) bắt đầu khung yên lặng
    expect(thoiDiemGuiThuHoaDonLo(new Date("2026-11-04T15:00:00Z")).toISOString()).toBe("2026-11-05T01:00:00.000Z");
  });
  it("qua ranh giới tháng / năm vẫn đúng (31/12 23:40 VN ⇒ 01/01 08:00 VN)", () => {
    expect(thoiDiemGuiThuHoaDonLo(new Date("2026-12-31T16:40:00Z")).toISOString()).toBe("2027-01-01T01:00:00.000Z");
  });
});
