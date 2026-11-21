// [FNM-*] 8 ô «Người mua trên hoá đơn» — luật thuần (điền sẵn đơn→hồ sơ, ghi đơn, đẩy sang hồ sơ).
// Xem đầu `form-nguoi-mua.ts`. Ca nào lật một quy tắc thì cấy lỗi tương ứng và thấy nó đỏ (ghi ở commit).
import { describe, expect, it } from "vitest";
import {
  FORM_TRONG,
  KHOA_FORM,
  COT_NHAY_CAM,
  cotDonTuForm,
  formTuDon,
  hieuLuc,
  kiemForm,
  oCanDayVaoHoSo,
  vaChamTuForm,
  type DonChoForm,
  type FormNguoiMua,
} from "./form-nguoi-mua";

const DON_TRONG: DonChoForm = {
  invoiceStudentName: null,
  invoiceStudentDob: null,
  invoiceStudentCccd: null,
  customerAddress: null,
  customerWard: null,
  customerCity: null,
  invoiceBuyerName: null,
  customerName: "Phan Thị Hồng",
  invoiceParentPhone: null,
  customerPhone: "0905123456",
  customerCccd: null,
  invoiceEmail: null,
  customerEmail: "hong@example.com",
  invoiceCompanyName: null,
  invoiceTaxCode: null,
  invoiceCustomerCode: null,
};
const HO_SO: FormNguoiMua = {
  ...FORM_TRONG,
  hocVienTen: "Nguyễn Đức Huy Hoàng",
  hocVienNgaySinh: "2015-03-09",
  hocVienCccd: "048215001234",
  tinh: "Thành phố Đà Nẵng",
  phuong: "Phường Hải Châu",
  diaChi: "60 Đồng Du",
  phuHuynhTen: "Phan Thị Hồng (hồ sơ)",
  phuHuynhSdt: "0905000111",
  phuHuynhCccd: "048183006790",
  phuHuynhEmail: "hosoph@example.com",
};
const HOM_NAY = new Date("2026-11-01T03:00:00Z");

describe("[FNM] hiệu lực: đơn trước, hồ sơ sau", () => {
  it("[FNM-01] đơn trống ⇒ lấy hồ sơ (nguồn 'ho-so'); ba/mẹ vẫn rơi về cột customer* của đơn TRƯỚC hồ sơ", () => {
    const { form, nguon } = hieuLuc(DON_TRONG, HO_SO);
    expect(form.hocVienTen).toBe("Nguyễn Đức Huy Hoàng");
    expect(nguon.hocVienTen).toBe("ho-so");
    // tên/SĐT/email ba/mẹ: customerName/Phone/Email của ĐƠN thắng hồ sơ (đơn là thứ đã khai cho tờ này)
    expect(form.phuHuynhTen).toBe("Phan Thị Hồng");
    expect(form.phuHuynhSdt).toBe("0905123456");
    expect(form.phuHuynhEmail).toBe("hong@example.com");
    expect(nguon.phuHuynhTen).toBe("don");
    // CCCD ba/mẹ đơn không có ⇒ hồ sơ
    expect(form.phuHuynhCccd).toBe("048183006790");
    expect(nguon.phuHuynhCccd).toBe("ho-so");
  });

  it("[FNM-02] ô đã khai riêng cho hoá đơn thắng customer* và hồ sơ", () => {
    const { form } = hieuLuc(
      { ...DON_TRONG, invoiceBuyerName: "Nguyễn Văn Bình", invoiceParentPhone: "0911222333", invoiceEmail: "ketoan@abc.vn" },
      HO_SO,
    );
    expect([form.phuHuynhTen, form.phuHuynhSdt, form.phuHuynhEmail]).toEqual(["Nguyễn Văn Bình", "0911222333", "ketoan@abc.vn"]);
  });

  it("[FNM-03] khối địa chỉ đi NGUYÊN KHỐI: đơn có bất kỳ ô nào thì KHÔNG trộn tỉnh/phường của hồ sơ", () => {
    const { form, nguon } = hieuLuc({ ...DON_TRONG, customerCity: "Quảng Nam" }, HO_SO);
    expect([form.tinh, form.phuong, form.diaChi]).toEqual(["Quảng Nam", "", ""]);
    expect([nguon.tinh, nguon.phuong, nguon.diaChi]).toEqual(["don", "trong", "trong"]);
    // đối chứng: đơn trống hẳn ⇒ cả khối từ hồ sơ
    const tron = hieuLuc(DON_TRONG, HO_SO);
    expect([tron.form.tinh, tron.form.phuong, tron.form.diaChi]).toEqual(["Thành phố Đà Nẵng", "Phường Hải Châu", "60 Đồng Du"]);
  });

  it("[FNM-04] ngày sinh trên đơn đọc theo lịch VN (cột DATE = nửa đêm UTC), không lùi một ngày", () => {
    const { form } = hieuLuc({ ...DON_TRONG, invoiceStudentDob: new Date("2015-03-09T00:00:00.000Z") }, FORM_TRONG);
    expect(form.hocVienNgaySinh).toBe("2015-03-09");
  });
});

describe("[FNM] ghi lên đơn", () => {
  it("[FNM-05] ô trắng ⇒ null (không ghi chuỗi rỗng); ngày sinh ⇒ nửa đêm UTC của ngày đó", () => {
    const cot = cotDonTuForm({ ...FORM_TRONG, hocVienTen: "  ", hocVienNgaySinh: "2015-03-09", phuHuynhTen: " Hồng " });
    expect(cot.invoiceStudentName).toBeNull();
    expect(cot.invoiceStudentDob).toEqual(new Date("2015-03-09T00:00:00.000Z"));
    expect(cot.invoiceBuyerName).toBe("Hồng");
    expect(cot.customerAddress).toBeNull();
  });

  it("[FNM-06] SĐT ba/mẹ ghi vào cột RIÊNG, không bao giờ vào customerPhone (chìa đối khớp tiền)", () => {
    const cot = cotDonTuForm({ ...FORM_TRONG, phuHuynhSdt: "0911222333" });
    expect(Object.keys(cot)).not.toContain("customerPhone");
    expect(Object.keys(cot)).not.toContain("customerName");
    expect(cot.invoiceParentPhone).toBe("0911222333");
  });

  it("[FNM-07] hai cột giấy tờ tùy thân được đánh dấu nhạy cảm (vết chỉ ghi TÊN cột)", () => {
    expect([...COT_NHAY_CAM].sort()).toEqual(["customerCccd", "invoiceStudentCccd"]);
  });

  it("[FNM-08] formTuDon ∘ cotDonTuForm không đổi nghĩa (đi vòng không mất ô nào)", () => {
    const f = { ...HO_SO, donViTen: "Cty ABC", donViMst: "0401234567" };
    const cot = cotDonTuForm(f);
    const lai = formTuDon({
      ...DON_TRONG,
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      ...cot,
    } as DonChoForm);
    expect(lai).toEqual(f);
  });
});

describe("[FNM] kiểm form — chỉ soi ô người dùng ĐÃ ĐỔI", () => {
  const goc = { ...HO_SO };
  it("[FNM-09] CCCD sai độ dài / SĐT hỏng / email hỏng / ngày tương lai ⇒ lỗi, đúng câu", () => {
    expect(kiemForm({ ...goc, hocVienCccd: "123" }, goc, HOM_NAY)).toMatch(/CCCD của học viên.*9 hoặc 12/);
    expect(kiemForm({ ...goc, phuHuynhCccd: "04818300679x" }, goc, HOM_NAY)).toMatch(/CCCD của ba\/mẹ/);
    expect(kiemForm({ ...goc, phuHuynhSdt: "12" }, goc, HOM_NAY)).toMatch(/SĐT/);
    expect(kiemForm({ ...goc, phuHuynhEmail: "khong-phai-email" }, goc, HOM_NAY)).toMatch(/Email/);
    expect(kiemForm({ ...goc, hocVienNgaySinh: "2027-01-01" }, goc, HOM_NAY)).toMatch(/Ngày sinh/);
    expect(kiemForm({ ...goc, hocVienNgaySinh: "2015-02-31" }, goc, HOM_NAY)).toMatch(/Ngày sinh/);
  });

  it("[FNM-10] ô KHÔNG đổi thì không bị soi: đơn cũ mang CCCD gõ tay kiểu cũ vẫn lưu được phần khác", () => {
    const cu = { ...goc, phuHuynhCccd: "so-cu-khong-chuan" };
    expect(kiemForm({ ...cu, hocVienTen: "Tên mới" }, cu, HOM_NAY)).toBeNull();
  });

  it("[FNM-11] ô quá dài bị chặn (200; địa chỉ 300)", () => {
    expect(kiemForm({ ...goc, hocVienTen: "a".repeat(201) }, goc, HOM_NAY)).toMatch(/quá dài/);
    expect(kiemForm({ ...goc, diaChi: "a".repeat(300) }, goc, HOM_NAY)).toBeNull();
    expect(kiemForm({ ...goc, diaChi: "a".repeat(301) }, goc, HOM_NAY)).toMatch(/quá dài/);
  });

  it("[FNM-12] hợp lệ ⇒ null", () => {
    expect(kiemForm({ ...goc, hocVienCccd: "048215001999", phuHuynhSdt: "0911222333" }, goc, HOM_NAY)).toBeNull();
  });
});

describe("[FNM] đẩy sang hồ sơ", () => {
  it("[FNM-13] ô giữ nguyên giá trị điền sẵn + hồ sơ đã có giá trị khác ⇒ KHÔNG đè hồ sơ", () => {
    const banDau = { ...HO_SO, phuHuynhTen: "Tên trên đơn" };
    const ds = oCanDayVaoHoSo(banDau, banDau, HO_SO);
    expect(ds).not.toContain("phuHuynhTen");
  });

  it("[FNM-14] ô người dùng SỬA ⇒ đẩy; sửa thành giá trị hồ sơ đang có ⇒ không đẩy (không đẻ vết rỗng)", () => {
    const banDau = { ...HO_SO };
    expect(oCanDayVaoHoSo({ ...banDau, phuHuynhTen: "Tên mới" }, banDau, HO_SO)).toEqual(["phuHuynhTen"]);
    expect(oCanDayVaoHoSo({ ...banDau, phuHuynhSdt: "+84 905 000 111" }, banDau, HO_SO)).toEqual([]); // cùng số, khác chữ
  });

  it("[FNM-15] hồ sơ TRỐNG ô nào thì ô đó được điền dù người dùng không sửa (gõ một lần, có ở mọi nơi)", () => {
    const hoSoThieu = { ...HO_SO, hocVienCccd: "", phuHuynhEmail: "" };
    const banDau = { ...HO_SO };
    expect(oCanDayVaoHoSo(banDau, banDau, hoSoThieu).sort()).toEqual(["hocVienCccd", "phuHuynhEmail"]);
  });

  it("[FNM-16] ô để TRỐNG ở hoá đơn không xoá gì ở hồ sơ", () => {
    const banDau = { ...HO_SO };
    expect(oCanDayVaoHoSo({ ...banDau, phuHuynhEmail: "" }, banDau, HO_SO)).toEqual([]);
  });

  it("[FNM-17] sửa MỘT ô địa chỉ ⇒ đẩy CẢ KHỐI (không để lại phường cũ của tỉnh khác)", () => {
    const banDau = { ...HO_SO };
    const ds = oCanDayVaoHoSo({ ...banDau, tinh: "Thành phố Huế", phuong: "" }, banDau, HO_SO);
    expect(ds.sort()).toEqual(["diaChi", "phuong", "tinh"]);
    const va = vaChamTuForm({ ...banDau, tinh: "Thành phố Huế", phuong: "" }, ds);
    expect(va).toMatchObject({ city: "Thành phố Huế", ward: null, address: "60 Đồng Du" });
  });

  it("[FNM-18] dịch sang dạng hồ sơ: SĐT nội địa, ngày sinh nửa đêm UTC, CCCD hai loại tách riêng", () => {
    const f = { ...HO_SO, phuHuynhSdt: "+84 911 222 333", hocVienNgaySinh: "2015-03-09" };
    const va = vaChamTuForm(f, [...KHOA_FORM]);
    expect(va.parentPhone).toBe("0911222333");
    expect(va.dateOfBirth).toEqual(new Date("2015-03-09T00:00:00.000Z"));
    expect(va.nationalId).toBe("048215001234");
    expect(va.parentNationalId).toBe("048183006790");
    expect(va.name).toBe("Nguyễn Đức Huy Hoàng");
  });

  it("[FNM-19] SĐT/ngày hỏng thì BỎ ô đó (không đoán, không ghi rác)", () => {
    const va = vaChamTuForm({ ...HO_SO, phuHuynhSdt: "abc", hocVienNgaySinh: "không" }, ["phuHuynhSdt", "hocVienNgaySinh"]);
    expect(va).toEqual({});
  });

  it("[FNM-20] hai ô đơn vị/MST không bao giờ sang hồ sơ", () => {
    const f = { ...HO_SO, donViTen: "Cty ABC", donViMst: "0401234567" };
    const ds = oCanDayVaoHoSo(f, FORM_TRONG, FORM_TRONG);
    expect(ds).not.toContain("donViTen");
    expect(ds).not.toContain("donViMst");
  });
});

describe("[FNM-MKH] Mã khách hàng — ô điền sẵn từ mã học viên, sửa được, KHÔNG đẩy ngược về hồ sơ", () => {
  const HO_SO_MA: FormNguoiMua = { ...HO_SO, maKhachHang: "CS1-26-AB12CD" };

  it("[MKH-01] đơn chưa lưu mã ⇒ điền sẵn mã học viên của hồ sơ (nguồn 'ho-so'); đơn đã lưu mã thì mã của đơn thắng", () => {
    const a = hieuLuc(DON_TRONG, HO_SO_MA);
    expect(a.form.maKhachHang).toBe("CS1-26-AB12CD");
    expect(a.nguon.maKhachHang).toBe("ho-so");
    const b = hieuLuc({ ...DON_TRONG, invoiceCustomerCode: "KH-0042" }, HO_SO_MA);
    expect(b.form.maKhachHang).toBe("KH-0042");
    expect(b.nguon.maKhachHang).toBe("don");
    // không có ở đâu cả ⇒ trống, nguồn 'trong'
    const c = hieuLuc(DON_TRONG, HO_SO);
    expect([c.form.maKhachHang, c.nguon.maKhachHang]).toEqual(["", "trong"]);
  });

  it("[MKH-02] ghi đơn: ô trắng ⇒ null (không ghi chuỗi rỗng); có mã ⇒ cột invoiceCustomerCode, đã cắt khoảng trắng", () => {
    expect(cotDonTuForm({ ...FORM_TRONG, maKhachHang: "  KH-0042 " }).invoiceCustomerCode).toBe("KH-0042");
    expect(cotDonTuForm({ ...FORM_TRONG, maKhachHang: "   " }).invoiceCustomerCode).toBeNull();
  });

  it("[MKH-03] formTuDon CHỈ đọc cột của đơn — không tự lấy mã học viên (tờ hoá đơn đọc thứ đã lưu)", () => {
    expect(formTuDon(DON_TRONG).maKhachHang).toBe("");
    expect(formTuDon({ ...DON_TRONG, invoiceCustomerCode: " KH-1 " }).maKhachHang).toBe("KH-1");
  });

  it("[MKH-04] KHÔNG BAO GIỜ đẩy sang hồ sơ: sửa mã, hay hồ sơ đang trống mã, đều không đưa ô này vào danh sách đẩy", () => {
    const sua = { ...HO_SO_MA, maKhachHang: "KH-0042" };
    expect(oCanDayVaoHoSo(sua, HO_SO_MA, HO_SO_MA)).not.toContain("maKhachHang");
    expect(oCanDayVaoHoSo(sua, FORM_TRONG, FORM_TRONG)).not.toContain("maKhachHang"); // hồ sơ trống mã
    expect(vaChamTuForm(sua, [...KHOA_FORM])).not.toHaveProperty("studentCode");
  });

  it("[MKH-05] kiểm: chỉ soi khi ĐÃ ĐỔI; mã có khoảng trắng / ký tự lạ / quá 50 ký tự bị chặn, mã thường qua", () => {
    const ban = { ...HO_SO_MA };
    for (const ma of ["CS1-26-AB12CD", "KH.0042", "KH_0042/A", "a1"]) {
      expect(kiemForm({ ...ban, maKhachHang: ma }, ban, HOM_NAY), ma).toBeNull();
    }
    for (const ma of ["KH 0042", "KH#1", "Mã-1", "x".repeat(51)]) {
      expect(kiemForm({ ...ban, maKhachHang: ma }, ban, HOM_NAY), ma).toMatch(/Mã khách hàng/);
    }
    // đơn cũ mang mã gõ kiểu lạ mà người dùng KHÔNG đụng tới ⇒ không bị chặn lưu phần còn lại
    const cu = { ...ban, maKhachHang: "KH 0042" };
    expect(kiemForm(cu, cu, HOM_NAY)).toBeNull();
    // để trống là hợp lệ (mã tuỳ chọn)
    expect(kiemForm({ ...ban, maKhachHang: "" }, ban, HOM_NAY)).toBeNull();
  });
});
