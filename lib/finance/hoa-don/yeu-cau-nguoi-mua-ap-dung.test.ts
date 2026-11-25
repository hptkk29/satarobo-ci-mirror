// Ca [YCA-*] — luật THUẦN của bước «áp dụng thông tin người mua đã xác nhận vào đơn» (S11). Phần ghi DB đo ở tests/finance/hoa-don-yeu-cau-ap-dung-db.test.ts.
import { describe, expect, it } from "vitest";
import { anhXaNguoiMuaSangDon, cotDonDaDoi } from "./yeu-cau-nguoi-mua-ap-dung";
import { COT_GOC, giaTriGocHash } from "./yeu-cau-nguoi-mua-token";

const KHONG_CO = { cccd: null, sdt: null, tenHocVien: null, ngaySinhHocVien: null, cccdHocVien: null } as const;
/** Đủ MỌI cột trong `COT_GOC` (kiểu `DonGoc` bắt buộc đủ khoá — thiếu `select` một cột là lỗi biên dịch, không phải im lặng). */
const DON_TRONG = { customerCccd: null, invoiceParentPhone: null, invoiceStudentName: null, invoiceStudentCccd: null } as const;
const CA_NHAN = { loai: "CA_NHAN", ten: "Nguyễn Văn A", diaChi: "12 Lê Lợi, Đà Nẵng", email: "a@example.com", maSoThue: null, ...KHONG_CO } as const;
const DN = { loai: "DOANH_NGHIEP", ten: "Công ty TNHH B", diaChi: "34 Nguyễn Văn Linh, Đà Nẵng", email: "ketoan@b.example.com", maSoThue: "0401234567", ...KHONG_CO } as const;
const CA_NHAN_DAY_DU = {
  ...CA_NHAN,
  cccd: "048123456789",
  sdt: "0905123456",
  tenHocVien: "Nguyễn Văn Bé",
  ngaySinhHocVien: "2016-08-03",
  cccdHocVien: "048987654321",
} as const;

describe("[YCA-01] ánh xạ người mua → cột của đơn", () => {
  it("cá nhân: ghi tên người mua, XOÁ tên đơn vị + MST cũ (người mua nay là cá nhân), email, địa chỉ gộp một ô (ward/city xoá vì địa chỉ đã đầy đủ)", () => {
    expect(anhXaNguoiMuaSangDon(CA_NHAN)).toEqual({
      invoiceBuyerName: "Nguyễn Văn A",
      invoiceCompanyName: null,
      invoiceTaxCode: null,
      invoiceEmail: "a@example.com",
      customerAddress: "12 Lê Lợi, Đà Nẵng",
      customerWard: null,
      customerCity: null,
    });
  });
  it("doanh nghiệp: ghi tên đơn vị + MST + email (bắt buộc ở biểu mẫu); KHÔNG đụng tên / CCCD / SĐT ba/mẹ và khối học viên (khoá vắng mặt, không phải null)", () => {
    const r = anhXaNguoiMuaSangDon(DN);
    expect(r).toMatchObject({ invoiceCompanyName: "Công ty TNHH B", invoiceTaxCode: "0401234567", invoiceEmail: "ketoan@b.example.com", customerAddress: "34 Nguyễn Văn Linh, Đà Nẵng" });
    for (const c of ["invoiceBuyerName", "customerCccd", "invoiceParentPhone", "invoiceStudentName", "invoiceStudentDob", "invoiceStudentCccd"]) expect(c in r, c).toBe(false);
  });
  it("doanh nghiệp: email trống (dữ liệu cũ) ⇒ KHÔNG ghi đè email đã có", () => {
    expect("invoiceEmail" in anhXaNguoiMuaSangDon({ ...DN, email: null })).toBe(false);
  });
  it("[YCA-01b] cá nhân ĐỦ: CCCD ba/mẹ → customerCccd, SĐT → invoiceParentPhone (TUYỆT ĐỐI không customerPhone), khối học viên → invoiceStudent*, ngày sinh thành Date", () => {
    const r = anhXaNguoiMuaSangDon(CA_NHAN_DAY_DU);
    expect(r).toMatchObject({ customerCccd: "048123456789", invoiceParentPhone: "0905123456", invoiceStudentName: "Nguyễn Văn Bé", invoiceStudentCccd: "048987654321" });
    expect(r.invoiceStudentDob).toBeInstanceOf(Date);
    expect("customerPhone" in r).toBe(false); // chìa đối khớp tiền theo SĐT — không bao giờ bị phụ huynh ghi đè
  });
  it("[YCA-01c] cá nhân bỏ trống ô tuỳ chọn ⇒ KHÔNG xoá giá trị đơn đã có (khoá vắng mặt)", () => {
    const r = anhXaNguoiMuaSangDon({ ...CA_NHAN, cccd: "048123456789" });
    expect("invoiceParentPhone" in r).toBe(false);
    expect("invoiceStudentName" in r).toBe(false);
    expect("invoiceStudentDob" in r).toBe(false);
    expect("invoiceStudentCccd" in r).toBe(false);
  });
  it("đối chứng: cá nhân có email ⇒ khoá email CÓ mặt", () => {
    expect("invoiceEmail" in anhXaNguoiMuaSangDon(CA_NHAN)).toBe(true);
  });
});

describe("[YCA-02c] LƯỚI SINH: MỌI cột chuỗi mà bước áp dụng có thể ghi PHẢI nằm trong băm xung đột (thêm cột vào ánh xạ mà quên khai ở COT_GOC ⇒ đỏ)", () => {
  // Cột KHÔNG chuỗi hoặc cố ý ngoài băm: ngày sinh (kiểu ngày — giới hạn đã ghi ở COT_GOC) + khối địa chỉ (đã loại khỏi băm từ trước, xem `cotDonDaDoi`).
  const NGOAI_BAM = new Set(["invoiceStudentDob", "customerAddress", "customerWard", "customerCity"]);
  it.each([
    ["cá nhân đủ ô", CA_NHAN_DAY_DU, 6],
    ["doanh nghiệp", DN, 3],
  ] as const)("%s: mọi cột ghi ra (trừ ngoại lệ có chủ đích) đều có trong COT_GOC", (_ten, nm, toiThieu) => {
    const cot = Object.keys(anhXaNguoiMuaSangDon(nm)).filter((c) => !NGOAI_BAM.has(c));
    expect(cot.length).toBeGreaterThanOrEqual(toiThieu); // chống lưới rỗng: đúng số cột chuỗi mong đợi
    for (const c of cot) expect((COT_GOC as readonly string[]).includes(c), `cột ${c} được ghi nhưng KHÔNG nằm trong băm xung đột`).toBe(true);
  });
});

describe("[YCA-02] phát hiện đơn đã bị sửa SAU khi tạo yêu cầu (so băm từng cột, chỉ xét cột sắp bị ghi)", () => {
  const don = { invoiceBuyerName: "Cũ", invoiceCompanyName: null, invoiceTaxCode: null, invoiceEmail: "x@example.com", ...DON_TRONG };
  const hash = giaTriGocHash("yc1", don);
  it("không ai sửa ⇒ rỗng", () => {
    expect(cotDonDaDoi("yc1", hash, don, anhXaNguoiMuaSangDon(CA_NHAN))).toEqual([]);
  });
  it("kế toán sửa email trong lúc chờ ⇒ cột email bị báo (vì sắp bị ghi đè)", () => {
    expect(cotDonDaDoi("yc1", hash, { ...don, invoiceEmail: "khac@example.com" }, anhXaNguoiMuaSangDon(CA_NHAN))).toEqual(["invoiceEmail"]);
  });
  it("cột đã đổi nhưng KHÔNG bị ghi (doanh nghiệp bỏ trống email — dữ liệu cũ) ⇒ không báo; đối chứng với ca trên", () => {
    expect(cotDonDaDoi("yc1", hash, { ...don, invoiceEmail: "khac@example.com" }, anhXaNguoiMuaSangDon({ ...DN, email: null }))).toEqual([]);
  });
  it("[YCA-02b] CỘT MỚI (CCCD · SĐT · học viên) cũng được so: kế toán gõ tay CCCD trong lúc chờ ⇒ áp dụng KHÔNG ghi đè im lặng, báo đúng cột", () => {
    const daKhai = { ...don, customerCccd: "048000000001" };
    const h = giaTriGocHash("yc3", don); // băm LÚC TẠO yêu cầu: chưa có CCCD
    const ghi = anhXaNguoiMuaSangDon(CA_NHAN_DAY_DU);
    expect(cotDonDaDoi("yc3", h, don, ghi)).toEqual(expect.not.arrayContaining(["customerCccd"])); // chưa ai sửa ⇒ không báo
    expect(cotDonDaDoi("yc3", h, daKhai, ghi)).toContain("customerCccd"); // đã sửa ⇒ báo
    expect(cotDonDaDoi("yc3", h, { ...don, invoiceParentPhone: "0911111111" }, ghi)).toContain("invoiceParentPhone");
    expect(cotDonDaDoi("yc3", h, { ...don, invoiceStudentName: "Tên cũ" }, ghi)).toContain("invoiceStudentName");
  });
  it("muối theo id yêu cầu: băm của yêu cầu khác không khớp ⇒ coi như cột đã đổi (fail-closed)", () => {
    expect(cotDonDaDoi("yc2", hash, don, anhXaNguoiMuaSangDon(CA_NHAN))).toEqual(["invoiceBuyerName", "invoiceEmail"]);
  });
  it("băm lưu hỏng / thiếu cột ⇒ coi cột là đã đổi (không bao giờ im lặng ghi đè)", () => {
    expect(cotDonDaDoi("yc1", {}, don, anhXaNguoiMuaSangDon(CA_NHAN))).toEqual(["invoiceBuyerName", "invoiceCompanyName", "invoiceTaxCode", "invoiceEmail"]);
    expect(cotDonDaDoi("yc1", null, don, anhXaNguoiMuaSangDon(CA_NHAN))).toHaveLength(4);
  });
});
