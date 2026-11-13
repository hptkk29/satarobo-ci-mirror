// [TDH-*] Dòng hoá đơn «Học phí khoá Sata4 (48 buổi) của <học viên>», đơn vị «Khoá», MỖI dòng khoá học một dòng (chủ dự án 08/11/2026).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chiaSoTienTheoDong, khoaIdCuaCacDong, suyCacDongKhoa, tenDongHocPhi, tenNganKhoa } from "./ten-dong-hoc-phi";
import { dungPhieuThuData } from "./phieu-thu-data";
import { nguoiMuaChoDon } from "./nguoi-mua";
import { nguoiMuaPhatHanh } from "./phieu-phat-hanh";
import { tongHoaDon } from "./tinh-hoa-don";
import type { CauHinhHoaDon, PhapNhan } from "./phap-nhan";

describe("[TDH] tên dòng học phí", () => {
  it("[TDH-01] tên gọi ngắn của khoá = phần trước dấu gạch ngăn cách", () => {
    expect(tenNganKhoa("Sata3 — Ươm Mầm Tài Năng")).toBe("Sata3");
    expect(tenNganKhoa("Combo — Full Lộ Trình Luyện Thi")).toBe("Combo");
    expect(tenNganKhoa("Sata7 - Kiến Tạo Tương Lai")).toBe("Sata7");
    expect(tenNganKhoa("Sata4")).toBe("Sata4");
    expect(tenNganKhoa("Sata-4")).toBe("Sata-4");
  });

  it("[TDH-02] đúng mẫu chủ dự án; thiếu tên học viên thì bỏ vế «của …»", () => {
    expect(tenDongHocPhi({ tenKhoa: "Sata4", soBuoi: 48 }, "Bùi Nguyên Khang")).toBe("Học phí khoá Sata4 (48 buổi) của Bùi Nguyên Khang");
    expect(tenDongHocPhi({ tenKhoa: "Sata3", soBuoi: 32 }, null)).toBe("Học phí khoá Sata3 (32 buổi)");
    expect(tenDongHocPhi({ tenKhoa: "Sata3", soBuoi: 32 }, "  ")).toBe("Học phí khoá Sata3 (32 buổi)");
  });

  const khoa = new Map([
    ["c4", { name: "Sata4 — Bứt Phá Giới Hạn" }],
    ["c3", { name: "Sata3 — Ươm Mầm Tài Năng" }],
  ]);
  const dong = (metadata: unknown, ten: string | null, tien = 1_000_000, type = "COURSE_ENROLLMENT") => ({
    type,
    metadata,
    totalPrice: tien,
    discountAmount: 0,
    student: ten ? { name: ten } : null,
  });

  it("[TDH-03] số buổi = đúng số Sale chọn (metadata.soBuoi); KHÔNG có ⇒ không đoán «cả khoá» ⇒ null", () => {
    expect(suyCacDongKhoa({ dongDon: [dong({ courseId: "c4", soBuoi: 24 }, "Khang")], khoaTheoId: khoa, khoaGhiDanh: null })?.[0]).toMatchObject({ tenKhoa: "Sata4", soBuoi: 24, tenHocVien: "Khang" });
    expect(suyCacDongKhoa({ dongDon: [dong({ courseId: "c4" }, "Khang")], khoaTheoId: khoa, khoaGhiDanh: null })).toBeNull();
    expect(suyCacDongKhoa({ dongDon: [dong({ courseId: "c4", soBuoi: 0 }, "Khang")], khoaTheoId: khoa, khoaGhiDanh: null })).toBeNull();
  });

  it("[TDH-04] đơn hai con: MỖI dòng khoá một phần tử, tên con lấy ở CHÍNH dòng đó, đúng thứ tự dòng", () => {
    const r = suyCacDongKhoa({
      dongDon: [dong({ courseId: "c4", soBuoi: 48 }, "Bùi Nguyên Khang", 11_520_000), dong({ courseId: "c3", soBuoi: 32 }, "Nguyễn Thị Kim Ngân", 10_560_000)],
      khoaTheoId: khoa,
      khoaGhiDanh: null,
    });
    expect(r?.map((x) => tenDongHocPhi(x, x.tenHocVien))).toEqual(["Học phí khoá Sata4 (48 buổi) của Bùi Nguyên Khang", "Học phí khoá Sata3 (32 buổi) của Nguyễn Thị Kim Ngân"]);
  });

  it("[TDH-05] đường convert không ghi courseId ⇒ khoá lấy từ ghi danh, CHỈ khi khoản có đúng một dòng", () => {
    const gd = { name: "Sata4 — Bứt Phá" };
    expect(suyCacDongKhoa({ dongDon: [dong({ soBuoi: 48 }, "A")], khoaTheoId: new Map(), khoaGhiDanh: gd })?.[0]?.tenKhoa).toBe("Sata4");
    expect(suyCacDongKhoa({ dongDon: [dong({ soBuoi: 48 }, "A"), dong({ soBuoi: 48 }, "B")], khoaTheoId: new Map(), khoaGhiDanh: gd })).toBeNull();
  });

  it("[TDH-06] ĐỐI CHỨNG ÂM — không đoán: có dòng không phải khoá học, không biết khoá, không dòng nào ⇒ null (cả khoản về cách ghi cũ)", () => {
    expect(suyCacDongKhoa({ dongDon: [dong({ courseId: "c4", soBuoi: 48 }, "A"), dong(null, null, 500_000, "PRODUCT")], khoaTheoId: khoa, khoaGhiDanh: null })).toBeNull();
    expect(suyCacDongKhoa({ dongDon: [dong({ courseId: "khong-co", soBuoi: 48 }, "A")], khoaTheoId: khoa, khoaGhiDanh: null })).toBeNull();
    expect(suyCacDongKhoa({ dongDon: [], khoaTheoId: khoa, khoaGhiDanh: null })).toBeNull();
  });

  it("[TDH-07] khoaIdCuaCacDong: chỉ dòng khoá học, không trùng", () => {
    expect(khoaIdCuaCacDong([dong({ courseId: "c3", soBuoi: 1 }, null), dong({ courseId: "c3", soBuoi: 1 }, null), dong({ courseId: "x" }, null, 1, "PRODUCT"), dong(null, null)])).toEqual(["c3"]);
  });
});

describe("[TDH-08] chiaSoTienTheoDong — tổng luôn đúng bằng số khoản", () => {
  it("[TDH-08a] khoản thu đủ cả đơn ⇒ mỗi dòng đúng bằng phần tiền của dòng", () => {
    expect(chiaSoTienTheoDong(30_826_672, [19_040_014, 11_786_658])).toEqual([19_040_014, 11_786_658]);
  });
  it("[TDH-08b] thu một phần (cọc) ⇒ chia theo tỉ lệ, phần dư theo số dư lớn nhất, TỔNG đúng bằng số cọc", () => {
    const r = chiaSoTienTheoDong(10_000_001, [3, 3, 3])!;
    expect(r.reduce((s, x) => s + x, 0)).toBe(10_000_001);
    expect(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(1);
    for (const soTien of [1, 7, 999_999, 12_345_678]) expect(chiaSoTienTheoDong(soTien, [19_040_014, 11_786_658, 5])!.reduce((s, x) => s + x, 0)).toBe(soTien);
  });
  it("[TDH-08c] ĐỐI CHỨNG ÂM: không có dòng / tổng trọng số 0 ⇒ null (không chia theo gì)", () => {
    expect(chiaSoTienTheoDong(1_000, [])).toBeNull();
    expect(chiaSoTienTheoDong(1_000, [0, 0])).toBeNull();
  });
});

describe("[TDH-09] dungPhieuThuData dùng cacDongKhoa cho đơn khoá học", () => {
  const phapNhan = { ma: "NV", ten: "Pháp nhân thử", maSoThue: "0402341070", diaChi: "x", dienThoai: "0", website: "w", kyHieu: "1C26MNV", phanMem: "VIN_HOADON" } as unknown as PhapNhan;
  const cauHinh = { thue: [{ loaiDon: "TAT_CA", thueSuat: 8, kieuGia: "DA_GOM_THUE" }], phapNhan: [phapNhan], macDinhTheoCoSo: [] } as unknown as CauHinhHoaDon;
  const goi = (cacDongKhoa: Parameters<typeof dungPhieuThuData>[0]["cacDongKhoa"], tenKhoa: string | null, soTien = 30_826_672) =>
    dungPhieuThuData({
      maPhieu: null,
      ngayLap: "08/11/2026",
      phapNhan,
      cauHinh,
      don: {
        code: "ORD-1", type: "COURSE", customerName: "Thùy Trâm", customerPhone: null, customerEmail: null, customerAddress: null, customerWard: null,
        customerCity: null, customerCccd: null, invoiceBuyerName: null, invoiceCompanyName: null, invoiceTaxCode: null, invoiceCustomerCode: null, invoiceEmail: null,
      },
      soTien,
      hinhThucThanhToan: "Chuyển khoản",
      cacDongKhoa,
      tenKhoa,
      tenHocVien: "Tên mặc định của đơn",
      tenLop: "Lớp A",
      nguoiThu: null,
      dongDon: [],
    });
  const HAI_CON = [
    { tenKhoa: "Sata4", soBuoi: 48, tenHocVien: "Bùi Nguyên Khang", thanhTienDong: 19_040_014 },
    { tenKhoa: "Sata3", soBuoi: 32, tenHocVien: "Nguyễn Thị Kim Ngân", thanhTienDong: 11_786_658 },
  ];

  it("[TDH-09a] đơn hai con ⇒ HAI dòng, đúng tên + đơn vị «Khoá»; giá đã gồm thuế; tổng + thuế = số khoản thu", () => {
    const p = goi(HAI_CON, "Sata 4");
    expect(p.dong.map((d) => d.ten)).toEqual(["Học phí khoá Sata4 (48 buổi) của Bùi Nguyên Khang", "Học phí khoá Sata3 (32 buổi) của Nguyễn Thị Kim Ngân"]);
    expect(p.dong.every((d) => d.donViTinh === "Khoá" && d.soLuong === 1)).toBe(true);
    expect(p.dong.map((d) => d.congTien)).toEqual([19_040_014, 11_786_658]);
    const t = tongHoaDon(p.dong);
    expect(t.congTienThanhToan).toBe(30_826_672);
    expect(t.thanhTienTruocThue + t.tienThue).toBe(30_826_672);
  });

  it("[TDH-09b] khoản thu MỘT PHẦN của đơn hai con ⇒ vẫn hai dòng, tổng đúng số cọc", () => {
    const p = goi(HAI_CON, null, 10_000_000);
    expect(p.dong).toHaveLength(2);
    expect(tongHoaDon(p.dong).congTienThanhToan).toBe(10_000_000);
  });

  it("[TDH-09c] dòng chưa gắn học viên mà đơn chỉ MỘT dòng khoá ⇒ lấy tên học viên của khoản; đơn nhiều dòng thì bỏ vế «của …»", () => {
    expect(goi([{ tenKhoa: "Sata4", soBuoi: 48, tenHocVien: null, thanhTienDong: 100 }], null, 100).dong[0]!.ten).toBe("Học phí khoá Sata4 (48 buổi) của Tên mặc định của đơn");
    expect(goi([{ tenKhoa: "Sata4", soBuoi: 48, tenHocVien: null, thanhTienDong: 100 }, { tenKhoa: "Sata3", soBuoi: 32, tenHocVien: null, thanhTienDong: 100 }], null, 200).dong[0]!.ten).toBe("Học phí khoá Sata4 (48 buổi)");
  });

  it("[TDH-09d] ĐỐI CHỨNG ÂM: cacDongKhoa null (hoặc không chia được) ⇒ cách ghi cũ, không bịa số buổi", () => {
    expect(goi(null, "Sata 3", 100).dong).toHaveLength(1);
    expect(goi(null, "Sata 3", 100).dong[0]!.ten).toBe("Khoá học Sata 3 — HV Tên mặc định của đơn (lớp Lớp A)");
    const chua = goi(null, null, 100).dong[0]!;
    expect(chua.ten).toBe("Học phí — HV Tên mặc định của đơn (lớp Lớp A)");
    expect(chua.donViTinh).toBe("Lần");
    expect(goi([{ ...HAI_CON[0]!, thanhTienDong: 0 }], null, 100).dong[0]!.ten).toBe("Học phí — HV Tên mặc định của đơn (lớp Lớp A)");
  });
});

describe("[CCCD-W1] CCCD người mua đi từ khối người mua sang phiếu phát hành", () => {
  const don = {
    customerName: "Thùy Trâm", customerPhone: null, customerEmail: null, customerAddress: null, customerWard: null, customerCity: null,
    invoiceBuyerName: null, invoiceCompanyName: null, invoiceTaxCode: null, invoiceCustomerCode: null, invoiceEmail: null,
  };
  it("[CCCD-W1a] nguoiMuaPhatHanh mang cccd của khối người mua (đường chạy thật LUÔN điền)", () => {
    const nm = nguoiMuaChoDon({ ...don, customerCccd: " 048176002823 " });
    expect(nm.cccd).toBe("048176002823");
    expect(nguoiMuaPhatHanh(nm).cccd).toBe("048176002823");
  });
  it("[CCCD-W1b] ĐỐI CHỨNG ÂM: đơn không có CCCD ⇒ null", () => {
    expect(nguoiMuaPhatHanh(nguoiMuaChoDon({ ...don, customerCccd: null })).cccd).toBeNull();
    expect(nguoiMuaPhatHanh(nguoiMuaChoDon({ ...don, customerCccd: "  " })).cccd).toBeNull();
  });
});

describe("[TDH-W] dây nối: cả hai đường dựng tờ cùng suy dòng khoá; chỉ phiếu chờ đọc tên học viên đã khai", () => {
  const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));
  it("[TDH-W1] trang-phieu-cho + route phiếu thu chính thức: suyCacDongKhoa + napKhoaTheoDong + học viên của từng dòng", () => {
    for (const p of ["lib/finance/hoa-don/trang-phieu-cho.ts", "lib/pdf/phieu-thu-khoan.ts"]) {
      const s = doc(p);
      expect(s, p).toMatch(/cacDongKhoa: suyCacDongKhoa\(/);
      // Bản chính thức: tên khoá nạp ở ROUTE (cần client đã cách ly) rồi truyền vào `taoPdfPhieuThu` qua `khoaTheoId`.
      if (p.endsWith("trang-phieu-cho.ts")) expect(s, p).toContain("napKhoaTheoDong(");
      else expect(s, p).toContain("khoaTheoId: p.khoaTheoId");
      // Tên con nằm TRÊN dòng đơn: select phải lấy `student` của chính dòng (cả `items` lẫn `orderItem`).
      if (p.endsWith("trang-phieu-cho.ts")) expect(s.match(/metadata: true, student: \{ select: \{ name: true \} \}/g)?.length ?? 0, p).toBeGreaterThanOrEqual(2);
      else {
        expect(s.match(/metadata: true, student: \{ select: \{ name: true \} \}/g)?.length ?? 0, p).toBe(1);
        expect(s).toContain("items: { select: DONG_DON }");
        expect(s).toContain("orderItem: { select: DONG_DON }");
      }
    }
    expect(doc("lib/finance/hoa-don/trang-phieu-cho.ts")).toMatch(/hocVienCuaDon = don\.invoiceStudentName/);
  });
});
