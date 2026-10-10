// Ca [PTD-*] — MỘT công thức dữ liệu cho cả phiếu thu chính thức lẫn bản CHỜ XÁC NHẬN.
//
// Kế toán làm hoá đơn MISA theo bản chờ; tờ chính thức in sau (có số RCP) phải ra đúng dòng thu /
// thuế / người mua mà kế toán đã dựa vào. Hai công thức là đúng lớp lỗi sự cố nội dung CK 24/09.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dongDonCuaKhoan, dungPhieuThuData, tenHocVienChoKhoan, type DongDonPhieuThu } from "./phieu-thu-data";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon } from "./phap-nhan";
import { KIEU_GIA } from "./tinh-hoa-don";

const PN = phapNhanChoDon("CS1", CAU_HINH_HOA_DON_MAC_DINH)!;
const DON = {
  code: "ORD-1",
  type: "COURSE",
  customerName: "Nguyễn Văn A",
  customerPhone: "0905123456",
  customerEmail: null,
  customerAddress: "12 Lê Lợi",
  customerWard: null,
  customerCity: "Đà Nẵng",
  customerCccd: null,
  invoiceBuyerName: null,
  invoiceCompanyName: null,
  invoiceTaxCode: null,
  invoiceEmail: null,
};
const vao = (maPhieu: string | null) =>
  dungPhieuThuData({
    maPhieu,
    ngayLap: "10/09/2026",
    phapNhan: PN,
    cauHinh: CAU_HINH_HOA_DON_MAC_DINH,
    don: DON,
    soTien: 3_000_000,
    hinhThucThanhToan: "Chuyển khoản",
    tenKhoa: "Sata 4",
    tenHocVien: "Bé Một",
    tenLop: "S4-A",
    nguoiThu: "Sale",
    // Đơn COURSE: dòng đơn KHÔNG đổi tên dòng phiếu (vẫn "Khoá học …") — [PTD-01] ghim.
    dongDon: [{ itemName: "Sata 4", type: "COURSE_ENROLLMENT", quantity: 1, totalPrice: 3_000_000, discountAmount: 0 }],
  });

describe("[PTD-01] bản chờ và bản chính thức chỉ khác ô số phiếu", () => {
  it("cùng đầu vào ⇒ cùng dòng, cùng tổng, cùng người mua", () => {
    const cho = vao(null);
    const that = vao("RCP-260910-0001");
    expect(cho.maPhieu).toBeNull();
    expect({ ...cho, maPhieu: "X" }).toEqual({ ...that, maPhieu: "X" });
    expect(cho.dong[0]!.ten).toBe("Khoá học Sata 4 — HV Bé Một (lớp S4-A)");
    expect(cho.tong.congTienThanhToan).toBe(3_000_000);
  });
});

describe("[PTD-02] tên học viên theo KHOẢN, không theo đơn", () => {
  it("ghi danh → con trên đơn → học viên của đơn", () => {
    const don = { name: "Bé Của Đơn" };
    expect(tenHocVienChoKhoan({ enrollment: { student: { name: "Bé GD" } }, orderItem: { student: { name: "Bé Con" } } }, don)).toBe("Bé GD");
    expect(tenHocVienChoKhoan({ enrollment: null, orderItem: { student: { name: "Bé Con" } } }, don)).toBe("Bé Con");
    expect(tenHocVienChoKhoan({ enrollment: null, orderItem: null }, don)).toBe("Bé Của Đơn");
    expect(tenHocVienChoKhoan({ enrollment: null, orderItem: null }, null)).toBeNull();
  });
});

describe("[PTD-03] LƯỚI GHIM: hai route cùng đi qua dungPhieuThuData, không route nào tự dựng dòng", () => {
  // 30/09 — phần nạp + dựng trang của bản CHỜ dời sang `lib/finance/hoa-don/trang-phieu-cho.ts` để "Phát hành
  // qua MISA" dựng tờ từ CHÍNH dữ liệu ấy. Luật không đổi: một chỗ gọi `dungPhieuThuData` cho bản chờ, và
  // route chờ không tự dựng dòng (ca dưới ghim route → hàm dùng chung).
  const ROUTE = ["app/(admin)/admin/payments/[id]/phieu-thu/route.ts", "lib/finance/hoa-don/trang-phieu-cho.ts"];
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of ROUTE) {
    it(f, () => {
      const src = boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
      expect(src.match(/\bdungPhieuThuData\(/g)?.length ?? 0).toBe(1);
      expect(src.match(/\btenHocVienChoKhoan\(/g)?.length ?? 0).toBe(1);
      // 29/09/2026 — dòng đơn của khoản (tên + đơn vị tờ kit/thi) đi qua MỘT hàm cho cả hai route.
      expect(src.match(/\bdongDonCuaKhoan\(/g)?.length ?? 0).toBe(1);
      // Trước bản vá: route chính thức tự gọi tinhDongHoaDon + tongHoaDon + soTienBangChu.
      expect(src).not.toMatch(/\btinhDongHoaDon\(|\btongHoaDon\(|\bsoTienBangChu\(/);
    });
  }
  it("route phiếu CHỜ dựng trang bằng ĐÚNG hàm dùng chung (napTrangPhieuCho), không tự dựng", () => {
    const src = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/payments/hoa-don/phieu-cho/route.ts"), "utf8"));
    expect(src.match(/\bnapTrangPhieuCho\(/g)?.length ?? 0).toBe(1);
    expect(src).not.toMatch(/\bdungPhieuThuData\(|\btinhDongHoaDon\(|\btongHoaDon\(|\bsoTienBangChu\(/);
  });
});

describe("[PTD-04] đơn KIT / THI (PRODUCT · EXAM — không có ghi danh) ⇒ tờ dựng được, thuế rẽ theo LOẠI ĐƠN", () => {
  // Kế toán khai riêng dòng thuế cho kit (10%, chưa gồm thuế); thi không khai riêng ⇒ rơi về TAT_CA.
  const CAU_HINH = {
    ...CAU_HINH_HOA_DON_MAC_DINH,
    thue: [
      ...CAU_HINH_HOA_DON_MAC_DINH.thue,
      { loaiDon: "PRODUCT", thueSuat: 10, kieuGia: KIEU_GIA.CHUA_GOM_THUE, ghiChu: "" },
    ],
  };
  const tu = (type: string, dongDon: readonly DongDonPhieuThu[] = []) =>
    dungPhieuThuData({
      maPhieu: null,
      ngayLap: "10/09/2026",
      phapNhan: PN,
      cauHinh: CAU_HINH,
      don: { ...DON, type },
      soTien: 1_100_000,
      hinhThucThanhToan: "Chuyển khoản",
      // Đơn kit/thi KHÔNG có ghi danh ⇒ route truyền null cho khoá + lớp (enrollment?.class?.course).
      tenKhoa: null,
      tenHocVien: null,
      tenLop: null,
      nguoiThu: null,
      dongDon,
    });

  it("PRODUCT ⇒ đúng dòng thuế riêng của kit (10%, cộng thuế trên số tiền)", () => {
    const t = tu("PRODUCT");
    expect(t.dong).toHaveLength(1);
    expect(t.dong[0]).toMatchObject({ thueSuat: 10, soLuong: 1, thanhTien: 1_100_000, tienThue: 110_000 });
    expect(t.tong.congTienThanhToan).toBe(1_210_000);
    expect(t.nguoiMua.hoTen).toBe("Nguyễn Văn A");
  });

  it("EXAM (không khai riêng) ⇒ rơi về dòng TAT_CA — 8%, số khách trả ĐÃ GỒM thuế", () => {
    const t = tu("EXAM");
    expect(t.dong[0]).toMatchObject({ thueSuat: 8, congTien: 1_100_000 });
    expect(t.tong.congTienThanhToan).toBe(1_100_000);
  });

  it("thiếu khoá + học viên + lớp + KHÔNG dòng đơn (dữ liệu cũ) ⇒ nhãn theo loại đơn, không sập, không 'Học phí'", () => {
    for (const type of ["PRODUCT", "EXAM"]) {
      const d = tu(type).dong[0]!;
      expect(d.ten.trim().length, type).toBeGreaterThan(0);
      expect(d.ten, type).not.toMatch(/undefined|null|\(lớp|Học phí/);
    }
    expect(tu("PRODUCT").dong[0]).toMatchObject({ ten: "Bộ kit", donViTinh: "Bộ" });
    expect(tu("EXAM").dong[0]).toMatchObject({ ten: "Lệ phí thi", donViTinh: "Lần" });
  });
});

describe("[PTD-05] đơn KIT / THI ⇒ tên dòng lấy từ DÒNG ĐƠN, đơn vị theo loại dòng (29/09/2026)", () => {
  const dong = (itemName: string, type: string, o: Partial<DongDonPhieuThu> = {}): DongDonPhieuThu => ({
    itemName,
    type,
    quantity: 1,
    totalPrice: 1_100_000,
    discountAmount: 0,
    ...o,
  });
  const tu = (type: string, dongDon: readonly DongDonPhieuThu[], soTien = 1_100_000, tenHocVien: string | null = null) =>
    dungPhieuThuData({
      maPhieu: null,
      ngayLap: "10/09/2026",
      phapNhan: PN,
      cauHinh: CAU_HINH_HOA_DON_MAC_DINH,
      don: { ...DON, type },
      soTien,
      hinhThucThanhToan: "Tiền mặt",
      tenKhoa: null,
      tenHocVien,
      tenLop: null,
      nguoiThu: null,
      dongDon,
    }).dong[0]!;

  it("kit ⇒ 'Bộ kit Sata 4' · đơn vị 'Bộ'; thi ⇒ 'Lệ phí thi RoboSim' · đơn vị 'Lần'", () => {
    expect(tu("PRODUCT", [dong("Bộ kit Sata 4", "PRODUCT")])).toMatchObject({ ten: "Bộ kit Sata 4", donViTinh: "Bộ", soLuong: 1 });
    expect(tu("EXAM", [dong("Lệ phí thi RoboSim", "EXAM_REGISTRATION")])).toMatchObject({
      ten: "Lệ phí thi RoboSim",
      donViTinh: "Lần",
      soLuong: 1,
    });
  });

  it("có tên bé ⇒ nối sau tên dòng như tờ học phí", () => {
    expect(tu("PRODUCT", [dong("Bộ kit Sata 4", "PRODUCT")], 1_100_000, "Bé Một").ten).toBe("Bộ kit Sata 4 — HV Bé Một");
  });

  it("số lượng = quantity CHỈ khi thu TRỌN dòng (sau giảm); thu một phần ⇒ 1", () => {
    const hai = dong("Bộ kit Sata 4", "PRODUCT", { quantity: 2, totalPrice: 2_200_000, discountAmount: 200_000 });
    expect(tu("PRODUCT", [hai], 2_000_000).soLuong).toBe(2);
    expect(tu("PRODUCT", [hai], 1_000_000).soLuong).toBe(1);
  });

  it("khoản phủ NHIỀU dòng ⇒ nối tên các dòng, đơn vị 'Lần'", () => {
    expect(tu("PRODUCT", [dong("Bộ kit Sata 4", "PRODUCT"), dong("Cảm biến siêu âm", "PRODUCT")])).toMatchObject({
      ten: "Bộ kit Sata 4, Cảm biến siêu âm",
      donViTinh: "Lần",
    });
  });

  it("đối chứng: đơn COURSE cùng dòng đơn ⇒ vẫn 'Học phí' / 'Khoá học …', không lấy tên dòng", () => {
    expect(tu("COURSE", [dong("Bộ kit Sata 4", "PRODUCT")]).ten).toBe("Học phí");
  });

  it("dongDonCuaKhoan: khoản đã gắn dòng ⇒ chỉ dòng đó; không gắn ⇒ mọi dòng của đơn", () => {
    const a = dong("A", "PRODUCT");
    const b = dong("B", "PRODUCT");
    expect(dongDonCuaKhoan({ orderItem: a }, [a, b])).toEqual([a]);
    expect(dongDonCuaKhoan({ orderItem: null }, [a, b])).toEqual([a, b]);
    expect(dongDonCuaKhoan({ orderItem: null }, undefined)).toEqual([]);
  });
});
