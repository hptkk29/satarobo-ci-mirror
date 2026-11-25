import { describe, expect, it } from "vitest";
import { FORM_TRONG, type FormNguoiMua } from "./form-nguoi-mua";
import { O_KHONG_DIEN_SAN, O_NGUOI_MUA } from "./yeu-cau-nguoi-mua";
import { cotDonTuPhuHuynh, dienSanTuForm, docBanDauTho } from "./yeu-cau-nguoi-mua-ghi-don";

// [GD-*] — điền sẵn trang công khai + ghi thẳng vào đơn (chủ dự án chốt 03/11/2026). Luật ở `yeu-cau-nguoi-mua-ghi-don.ts`.

const form = (p: Partial<FormNguoiMua> = {}): FormNguoiMua => ({
  ...FORM_TRONG,
  hocVienTen: "Nguyễn Minh Khang",
  hocVienNgaySinh: "2016-05-20",
  hocVienCccd: "048216000123",
  tinh: "Đà Nẵng",
  phuong: "Hải Châu 1",
  diaChi: "114 Hoàng Diệu",
  phuHuynhTen: "Nguyễn Thị An",
  phuHuynhSdt: "0905 123 456",
  phuHuynhCccd: "048185000999",
  phuHuynhEmail: "An@Example.com",
  ...p,
});

describe("[GD-01] điền sẵn từ giá trị hiệu lực của đơn / hồ sơ / lead", () => {
  it("cá nhân mặc định: tên ba/mẹ, SĐT, email, địa chỉ gộp MỘT ô, tên + ngày sinh học viên — đã chuẩn hoá; KHÔNG có hai ô CCCD dù hồ sơ có", () => {
    const o = dienSanTuForm(form());
    expect(o).toEqual({
      loai: "CA_NHAN",
      ten: "Nguyễn Thị An",
      sdt: "0905123456",
      email: "an@example.com",
      diaChi: "114 Hoàng Diệu, Hải Châu 1, Đà Nẵng",
      tenHocVien: "Nguyễn Minh Khang",
      ngaySinhHocVien: "2016-05-20",
    });
    for (const k of O_KHONG_DIEN_SAN) expect(k in o).toBe(false);
  });
  it("KHÔNG BAO GIỜ điền sẵn CCCD — kể cả hồ sơ có đủ cả hai (đối chứng: ô khác thì có)", () => {
    const o = dienSanTuForm(form({ phuHuynhCccd: "048185000999", hocVienCccd: "048216000123" }));
    expect(o.cccd).toBeUndefined();
    expect(o.cccdHocVien).toBeUndefined();
    expect(o.ten).toBe("Nguyễn Thị An");
  });
  it("ô trống ở hồ sơ ⇒ không có khoá (không điền chuỗi rỗng); loại luôn có", () => {
    const o = dienSanTuForm(form({ phuHuynhSdt: "", phuHuynhEmail: "", hocVienTen: "", hocVienNgaySinh: "", tinh: "", phuong: "", diaChi: "" }));
    expect(Object.keys(o).sort()).toEqual(["loai", "ten"]);
  });
  it("loại mặc định CÁ NHÂN; chỉ khi đơn có CẢ tên đơn vị lẫn MST mới điền sẵn DOANH NGHIỆP (thiếu một trong hai ⇒ vẫn cá nhân)", () => {
    expect(dienSanTuForm(form()).loai).toBe("CA_NHAN");
    expect(dienSanTuForm(form({ donViTen: "Công ty A" })).loai).toBe("CA_NHAN");
    expect(dienSanTuForm(form({ donViMst: "0401234567" })).loai).toBe("CA_NHAN");
    const dn = dienSanTuForm(form({ donViTen: "Công ty A", donViMst: "0401 234 567" }));
    expect(dn).toEqual({ loai: "DOANH_NGHIEP", ten: "Công ty A", maSoThue: "0401234567", email: "an@example.com", diaChi: "114 Hoàng Diệu, Hải Châu 1, Đà Nẵng" });
  });
});

describe("[GD-02] `banDau` từ client: chỉ giữ ô hợp lệ, không tin cậy", () => {
  it("bỏ khoá lạ, giá trị không phải chuỗi, ô rỗng, hai ô CCCD; chuẩn hoá; cắt trần độ dài", () => {
    const r = docBanDauTho({ ten: "  An  Nguyễn ", cccd: "123456789012", cccdHocVien: "1", hoChieu: "x", sdt: 5, email: "", diaChi: "x".repeat(900), loai: "CA_NHAN" });
    expect(r).toEqual({ ten: "An Nguyễn", diaChi: "x".repeat(500), loai: "CA_NHAN" });
  });
  it("không phải object (null, mảng, chuỗi, số) ⇒ rỗng — không ném", () => {
    for (const x of [null, undefined, [], "x", 3, true]) expect(docBanDauTho(x)).toEqual({});
  });
});

describe("[GD-03] ghi vào đơn: CHỈ ô phụ huynh THẬT SỰ ĐỔI so với bản điền sẵn", () => {
  const ban = dienSanTuForm(form());
  const gui = (p: Record<string, string>) => ({ ...ban, cccd: "048185000999", ...p });

  it("gửi nguyên bản điền sẵn (chỉ thêm CCCD vì CCCD không được điền sẵn) ⇒ chỉ cột CCCD; KHÔNG đụng tên, địa chỉ, email, SĐT, học viên", () => {
    expect(cotDonTuPhuHuynh(gui({}), ban)).toEqual({ customerCccd: "048185000999" });
  });
  it("địa chỉ: không sửa ô ⇒ ba cột địa chỉ KHÔNG bị đụng (không dồn thành một chuỗi); sửa ô ⇒ ghi một ô đầy đủ, xoá phường + tỉnh", () => {
    expect("customerAddress" in cotDonTuPhuHuynh(gui({}), ban)).toBe(false);
    expect(cotDonTuPhuHuynh(gui({ diaChi: "9 Lê Duẩn, Đà Nẵng" }), ban)).toMatchObject({ customerAddress: "9 Lê Duẩn, Đà Nẵng", customerWard: null, customerCity: null });
  });
  it("PH sửa tên + email + SĐT ⇒ ghi đúng ba cột (SĐT về dạng nội địa); ô không sửa không có mặt", () => {
    const cot = cotDonTuPhuHuynh(gui({ ten: "Nguyễn Thị Ánh", email: "anh@example.com", sdt: "+84905111222" }), ban);
    expect(cot).toEqual({ invoiceBuyerName: "Nguyễn Thị Ánh", invoiceEmail: "anh@example.com", invoiceParentPhone: "0905111222", customerCccd: "048185000999" });
  });
  it("khối học viên: sửa tên + ngày sinh + gõ CCCD học viên ⇒ ghi ba cột; ngày sinh thành Date theo ngày VN", () => {
    const cot = cotDonTuPhuHuynh(gui({ tenHocVien: "Nguyễn Minh Khôi", ngaySinhHocVien: "2015-01-31", cccdHocVien: "048215000321" }), ban);
    expect(cot.invoiceStudentName).toBe("Nguyễn Minh Khôi");
    expect(cot.invoiceStudentCccd).toBe("048215000321");
    expect(cot.invoiceStudentDob).toBeInstanceOf(Date);
    expect(cot.invoiceStudentDob?.getTime()).toBe(new Date("2015-01-31T00:00:00.000Z").getTime());
  });
  it("PH XOÁ trống một ô tuỳ chọn ⇒ KHÔNG xoá cột trên đơn (ô trống = «không cung cấp»)", () => {
    const { email: _bo, ...khongEmail } = gui({});
    expect("invoiceEmail" in cotDonTuPhuHuynh(khongEmail, ban)).toBe(false);
  });
  it("DOANH NGHIỆP điền sẵn (đơn đã có công ty): PH gửi nguyên ⇒ KHÔNG ghi gì (không vô tình đè thông tin công ty)", () => {
    const dn = dienSanTuForm(form({ donViTen: "Công ty A", donViMst: "0401234567" }));
    expect(cotDonTuPhuHuynh({ ...dn }, dn)).toEqual({});
  });
  it("đổi loại CÁ NHÂN → DOANH NGHIỆP: ghi tên đơn vị + MST + email; KHÔNG đụng tên / CCCD ba/mẹ và khối học viên", () => {
    const cot = cotDonTuPhuHuynh({ loai: "DOANH_NGHIEP", ten: "Công ty B", maSoThue: "0401234567", email: "ketoan@b.vn", diaChi: ban.diaChi as string }, ban);
    expect(cot).toEqual({ invoiceCompanyName: "Công ty B", invoiceTaxCode: "0401234567", invoiceEmail: "ketoan@b.vn" });
  });
  it("đổi loại DOANH NGHIỆP → CÁ NHÂN: XOÁ tên đơn vị + MST và ghi tên ba/mẹ KỂ CẢ khi tên trùng bản điền sẵn (ô `ten` đổi nghĩa)", () => {
    const dn = dienSanTuForm(form({ donViTen: "Công ty A", donViMst: "0401234567" }));
    const cot = cotDonTuPhuHuynh({ loai: "CA_NHAN", ten: "Công ty A", cccd: "048185000999", diaChi: dn.diaChi as string }, dn);
    expect(cot).toMatchObject({ invoiceCompanyName: null, invoiceTaxCode: null, invoiceBuyerName: "Công ty A", customerCccd: "048185000999" });
  });
  it("thiếu `loai` ⇒ không ghi gì (không đoán nghĩa của ô `ten`); `loai` lạ cũng vậy", () => {
    expect(cotDonTuPhuHuynh({ ten: "A An", cccd: "048185000999" }, {})).toEqual({});
    expect(cotDonTuPhuHuynh({ loai: "KHAC", ten: "A An" }, {})).toEqual({});
  });
  it("không có bản điền sẵn (`banDau` rỗng) ⇒ MỌI ô PH gửi đều là «đổi»", () => {
    const cot = cotDonTuPhuHuynh({ loai: "CA_NHAN", ten: "A An", cccd: "048185000999", diaChi: "114 Hoàng Diệu" }, {});
    expect(cot).toMatchObject({ invoiceBuyerName: "A An", customerCccd: "048185000999", customerAddress: "114 Hoàng Diệu", invoiceCompanyName: null, invoiceTaxCode: null });
  });
  it("mọi khoá của tập ô đều được xét — không ô nào của biểu mẫu bị bỏ sót (đối chứng cho `O_NGUOI_MUA`)", () => {
    const tatCa = Object.fromEntries(
      O_NGUOI_MUA.map((o) => [o, { loai: "CA_NHAN", ten: "A An", diaChi: "114 Hoàng Diệu", email: "a@b.vn", maSoThue: "0401234567", cccd: "048185000999", sdt: "0905123456", tenHocVien: "B Bình", ngaySinhHocVien: "2016-05-20", cccdHocVien: "048216000123" }[o]]),
    );
    const cot = cotDonTuPhuHuynh(tatCa, {});
    // cá nhân: MST không có nghĩa ⇒ không ghi `invoiceTaxCode` ngoài lần XOÁ (null); mọi cột còn lại có giá trị.
    expect(cot).toMatchObject({
      invoiceBuyerName: "A An",
      customerCccd: "048185000999",
      invoiceParentPhone: "0905123456",
      invoiceStudentName: "B Bình",
      invoiceStudentCccd: "048216000123",
      invoiceEmail: "a@b.vn",
      customerAddress: "114 Hoàng Diệu",
      invoiceTaxCode: null,
    });
    expect(cot.invoiceStudentDob).toBeInstanceOf(Date);
  });
});
