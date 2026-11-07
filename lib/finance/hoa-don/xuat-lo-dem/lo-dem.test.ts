import { describe, expect, it } from "vitest";
import type { DonChoHoaDon } from "../nguoi-mua";
import { lui, lyDoBoQuaLanThu, SO_NGAY_LUI, type BoiCanhChonLo, type DongUngVien } from "./chon-lan-thu";
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
