// Ca [NM-*] — khối "người mua" của hoá đơn.
//
// Ba ca đầu dựng lại người mua của BA TỜ THẬT; phần còn lại khoá luật rơi-về và luật chặn.
import { describe, it, expect } from "vitest";
import {
  daKhaiHoaDon,
  nguoiMuaChoDon,
  thieuChoHoaDon,
  xuatDuocHoaDon,
  type DonChoHoaDon,
} from "@/lib/finance/hoa-don/nguoi-mua";

const DON_TRONG: DonChoHoaDon = {
  conChoNguoiMua: null,
  customerName: null,
  customerPhone: null,
  customerEmail: null,
  customerAddress: null,
  customerWard: null,
  customerCity: null,
  customerCccd: null,
  invoiceBuyerName: null,
  invoiceCompanyName: null,
  invoiceTaxCode: null,
  invoiceCustomerCode: null,
  invoiceEmail: null,
};
const don = (p: Partial<DonChoHoaDon>): DonChoHoaDon => ({ ...DON_TRONG, ...p });

describe("[NM-01] dựng lại người mua của ba tờ thật", () => {
  it("1C26TSR-86 — có CCCD, địa chỉ đủ", () => {
    const nm = nguoiMuaChoDon(
      don({
        customerName: "Nguyễn Mai Vi",
        customerCccd: "049189012543",
        customerAddress: "211 Lê Nhân Tông",
        customerWard: "Phường Quảng Phú",
        customerCity: "Thành phố Đà Nẵng",
      }),
    );
    expect(nm.hoTen).toBe("Nguyễn Mai Vi");
    expect(nm.cccd).toBe("049189012543");
    expect(nm.diaChi).toBe(
      "211 Lê Nhân Tông, Phường Quảng Phú, Thành phố Đà Nẵng",
    );
    expect(thieuChoHoaDon(nm).chan).toEqual([]);
  });

  it("1C26TSR-127 — KHÔNG có CCCD, địa chỉ chỉ là 'Thành phố Đà Nẵng'", () => {
    // Tờ này ĐÃ PHÁT HÀNH THẬT với đúng bấy nhiêu thông tin. Cổng mà đòi thêm là chặn
    // chính tờ giấy đang tồn tại ngoài đời.
    const nm = nguoiMuaChoDon(
      don({
        customerName: "Nguyễn Công Hoàng Khải",
        customerCity: "Thành phố Đà Nẵng",
      }),
    );
    expect(thieuChoHoaDon(nm).chan).toEqual([]);
    expect(thieuChoHoaDon(nm).nhac).toContain("CCCD/Hộ chiếu người mua");
  });

  it("1C26MNV-13 — người mua KHÁC học viên", () => {
    // Người mua "Phan Thị Hồng", học viên "Nguyễn Đức Huy Hoàng". Đây là lý do
    // `invoiceBuyerName` tồn tại như một cột riêng.
    const nm = nguoiMuaChoDon(
      don({
        customerName: "Nguyễn Đức Huy Hoàng",
        invoiceBuyerName: "Phan Thị Hồng",
        customerCccd: "048183006790",
        customerAddress: "60 Đồng Du",
        customerWard: "Phường An Hải",
        customerCity: "Thành phố Đà Nẵng",
      }),
    );
    expect(nm.hoTen).toBe("Phan Thị Hồng");
    expect(thieuChoHoaDon(nm).chan).toEqual([]);
  });
});

describe("[NM-02] rơi về, KHÔNG sao chép sẵn", () => {
  it("invoice* trống thì dùng customer*", () => {
    const nm = nguoiMuaChoDon(
      don({ customerName: "Bố", customerEmail: "bo@example.com" }),
    );
    expect(nm.hoTen).toBe("Bố");
    expect(nm.email).toBe("bo@example.com");
  });

  it("invoice* có thì THẮNG customer*", () => {
    const nm = nguoiMuaChoDon(
      don({
        customerName: "Bố",
        customerEmail: "bo@example.com",
        invoiceBuyerName: "Mẹ",
        invoiceEmail: "ketoan@congty.vn",
      }),
    );
    expect(nm.hoTen).toBe("Mẹ");
    expect(nm.email).toBe("ketoan@congty.vn");
  });

  it("chuỗi toàn khoảng trắng coi như TRỐNG", () => {
    // "   " lọt qua kiểm `!= null` của mọi tầng nhưng in ra tờ hoá đơn là một ô trắng.
    const nm = nguoiMuaChoDon(
      don({ customerName: "Bố", invoiceBuyerName: "   ", customerCity: "  " }),
    );
    expect(nm.hoTen).toBe("Bố");
    expect(nm.diaChi).toBeNull();
  });

  it("ghép địa chỉ bỏ qua phần trống, không để lại dấu phẩy thừa", () => {
    const nm = nguoiMuaChoDon(
      don({ customerAddress: "60 Đồng Du", customerCity: "Đà Nẵng" }),
    );
    expect(nm.diaChi).toBe("60 Đồng Du, Đà Nẵng");
  });
});

describe("[NM-03] luật CHẶN", () => {
  it("thiếu họ tên hoặc địa chỉ ⇒ chặn (hai ô có mặt ở CẢ BA tờ)", () => {
    expect(thieuChoHoaDon(nguoiMuaChoDon(DON_TRONG)).chan).toEqual([
      "Họ tên người mua hàng",
      "Địa chỉ người mua",
    ]);
  });

  it("thiếu CCCD KHÔNG chặn — 1/3 tờ thật không có", () => {
    const t = thieuChoHoaDon(
      nguoiMuaChoDon(don({ customerName: "A", customerCity: "Đà Nẵng" })),
    );
    expect(t.chan).toEqual([]);
    expect(t.nhac).toContain("CCCD/Hộ chiếu người mua");
  });

  it("có tên đơn vị mà thiếu MST ⇒ CHẶN (hoá đơn công ty không MST là vô hiệu)", () => {
    const t = thieuChoHoaDon(
      nguoiMuaChoDon(
        don({
          customerName: "A",
          customerCity: "Đà Nẵng",
          invoiceCompanyName: "CÔNG TY TNHH X",
        }),
      ),
    );
    expect(t.chan.join(" ")).toContain("Mã số thuế");
  });

  it("có MST mà KHÔNG có tên đơn vị thì không sao — cá nhân vẫn có MST", () => {
    const t = thieuChoHoaDon(
      nguoiMuaChoDon(
        don({
          customerName: "A",
          customerCity: "Đà Nẵng",
          invoiceTaxCode: "0402301783",
        }),
      ),
    );
    expect(t.chan).toEqual([]);
  });

  it("MST nhận 10 / 12 / 13 chữ số, chặn độ dài khác", () => {
    // 12 số vì ô mẫu MISA là "MST/CCCD chủ hộ" — CCCD cũng điền vào đúng ô đó.
    for (const mst of ["0402301783", "049189012543", "0402301783001"]) {
      const t = thieuChoHoaDon(
        nguoiMuaChoDon(
          don({ customerName: "A", customerCity: "ĐN", invoiceTaxCode: mst }),
        ),
      );
      expect(t.chan, mst).toEqual([]);
    }
    const xau = thieuChoHoaDon(
      nguoiMuaChoDon(
        don({ customerName: "A", customerCity: "ĐN", invoiceTaxCode: "12345" }),
      ),
    );
    expect(xau.chan.join(" ")).toContain("10, 12 hoặc 13");
  });

  it("xuatDuocHoaDon gói lại đúng luật chặn", () => {
    expect(xuatDuocHoaDon(DON_TRONG)).toBe(false);
    expect(
      xuatDuocHoaDon(don({ customerName: "A", customerCity: "Đà Nẵng" })),
    ).toBe(true);
  });
});

describe("[NM-04] hoá đơn là TUỲ KHÁCH, không phải nghĩa vụ của đơn", () => {
  it("chưa ai khai ô nào ⇒ daKhaiHoaDon = false (trạng thái BÌNH THƯỜNG)", () => {
    // Chủ dự án 14/09: "có KH cần hoá đơn, có KH không cần". Màn dựa vào cờ này để im
    // lặng thay vì treo nhãn cảnh báo trên mọi đơn trong hệ thống.
    expect(daKhaiHoaDon(don({ customerName: "A", customerCity: "Đà Nẵng" }))).toBe(
      false,
    );
  });

  it("khai BẤT KỲ ô invoice* nào ⇒ true", () => {
    for (const o of [
      { invoiceBuyerName: "Mẹ" },
      { invoiceCompanyName: "CÔNG TY X" },
      { invoiceTaxCode: "0402301783" },
      { invoiceEmail: "ketoan@x.vn" },
    ]) {
      expect(daKhaiHoaDon(don(o)), JSON.stringify(o)).toBe(true);
    }
  });

  it("ô chỉ có khoảng trắng KHÔNG tính là đã khai", () => {
    expect(daKhaiHoaDon(don({ invoiceBuyerName: "   " }))).toBe(false);
  });

  it("đơn chưa khai gì VẪN có thể thiếu mục để xuất — hai câu hỏi KHÁC nhau", () => {
    // `daKhaiHoaDon` = "khách có hỏi hoá đơn không"; `thieuChoHoaDon` = "dựng được tờ
    // giấy chưa". Trộn hai câu này là nguồn của nhãn "còn thiếu N mục bắt buộc" cũ.
    const d = don({ customerName: "A" }); // thiếu địa chỉ
    expect(daKhaiHoaDon(d)).toBe(false);
    expect(thieuChoHoaDon(nguoiMuaChoDon(d)).chan).toContain("Địa chỉ người mua");
  });
});

describe("[NGM-MA] mã khách hàng trong khối người mua", () => {
  it("[NGM-MA-01] đọc CHỈ cột invoiceCustomerCode của đơn, đã cắt khoảng trắng; trắng ⇒ null", () => {
    expect(nguoiMuaChoDon(don({ invoiceCustomerCode: "  KH-0042 " })).maKhachHang).toBe("KH-0042");
    expect(nguoiMuaChoDon(don({ invoiceCustomerCode: "   " })).maKhachHang).toBeNull();
    expect(nguoiMuaChoDon(don({})).maKhachHang).toBeNull();
  });
  it("[NGM-MA-02] mã KHÔNG làm đơn «đã khai hoá đơn» và không thành điều kiện chặn xuất", () => {
    const d = don({ customerName: "A", customerCity: "ĐN", invoiceCustomerCode: "KH-1" });
    expect(daKhaiHoaDon(d)).toBe(false);
    expect(thieuChoHoaDon(nguoiMuaChoDon(d)).chan.join("|")).not.toContain("Mã khách hàng");
  });
});

// ─── Người mua là BA/MẸ hay CON (kế toán 17/11/2026) ────────────────────────────────────────────────────────────────────────────
describe("[NMC-04] nguoiMuaChoDon áp luật ba/mẹ hay con — ba tình huống của kế toán dựng lại bằng ĐƠN thật", () => {
  const dia = { customerAddress: "23 Cẩm Bắc 4", customerWard: "Phường Cẩm Lệ", customerCity: "Tp Đà Nẵng" };

  it("TH1: mẹ có tên + CCCD, con chỉ có tên ⇒ MẸ làm người mua, theoCon = null (nội dung cũ)", () => {
    const nm = nguoiMuaChoDon(don({ ...dia, customerName: "Mẹ 1", customerCccd: "048000000001", conChoNguoiMua: { hoTen: "Con 1", cccd: null } }));
    expect(nm).toMatchObject({ hoTen: "Mẹ 1", cccd: "048000000001", theoCon: null });
  });

  it("TH2: mẹ chỉ có tên, con có tên + CCCD ⇒ CON làm người mua, mang tên mẹ để dòng hàng ghi «con của»", () => {
    const nm = nguoiMuaChoDon(
      don({ ...dia, customerName: "Mẹ 2", customerPhone: "0905000002", customerEmail: "me2@example.com", conChoNguoiMua: { hoTen: "Con 2", cccd: "048000000002" } }),
    );
    expect(nm.hoTen).toBe("Con 2");
    expect(nm.cccd).toBe("048000000002");
    expect(nm.theoCon).toEqual({ tenPhuHuynh: "Mẹ 2" });
    // Địa chỉ DÙNG CHUNG; email + điện thoại vẫn của ba/mẹ (nơi GỬI tờ hoá đơn).
    expect(nm.diaChi).toBe("23 Cẩm Bắc 4, Phường Cẩm Lệ, Tp Đà Nẵng");
    expect(nm.email).toBe("me2@example.com");
    expect(nm.dienThoai).toBe("0905000002");
  });

  it("TH3: mẹ chỉ có tên, con chỉ có tên ⇒ bằng nhau ⇒ CON; con không CCCD thì cccd = null, KHÔNG mượn CCCD của mẹ", () => {
    const nm = nguoiMuaChoDon(don({ ...dia, customerName: "Mẹ 3", conChoNguoiMua: { hoTen: "Con 3", cccd: null } }));
    expect(nm).toMatchObject({ hoTen: "Con 3", cccd: null, theoCon: { tenPhuHuynh: "Mẹ 3" } });
  });

  it("ảnh chụp màn của kế toán: mẹ «Trương Thị Hảo» không CCCD, con «Trần Nam Khôi» có CCCD ⇒ con", () => {
    const nm = nguoiMuaChoDon(
      don({ ...dia, customerName: "Trương Thị Hảo", customerPhone: "0968676891", conChoNguoiMua: { hoTen: "Trần Nam Khôi", cccd: "064218014477" } }),
    );
    expect(nm).toMatchObject({ hoTen: "Trần Nam Khôi", cccd: "064218014477", theoCon: { tenPhuHuynh: "Trương Thị Hảo" } });
    expect(thieuChoHoaDon(nm).chan).toEqual([]);
  });

  it("đơn có tên đơn vị / MST ⇒ người mua là doanh nghiệp ⇒ KHÔNG chuyển sang con dù con đủ hơn", () => {
    const nm = nguoiMuaChoDon(
      don({ ...dia, customerName: "Mẹ", invoiceCompanyName: "Công ty ABC", invoiceTaxCode: "0401234567", conChoNguoiMua: { hoTen: "Con", cccd: "048000000002" } }),
    );
    expect(nm).toMatchObject({ hoTen: "Mẹ", tenDonVi: "Công ty ABC", maSoThue: "0401234567", theoCon: null });
  });

  it("không có con ứng viên (luật tắt / đơn đã có chứng từ / đơn nhiều con) ⇒ y hệt trước bản này", () => {
    expect(nguoiMuaChoDon(don({ ...dia, customerName: "Mẹ", conChoNguoiMua: null }))).toMatchObject({ hoTen: "Mẹ", theoCon: null });
  });

  it("họ tên người mua theo khai riêng (`invoiceBuyerName`) vẫn là «ba/mẹ» khi so với con", () => {
    const nm = nguoiMuaChoDon(don({ ...dia, customerName: "Tên đặt đơn", invoiceBuyerName: "Mẹ khai riêng", customerCccd: "048000000001", conChoNguoiMua: { hoTen: "Con", cccd: null } }));
    expect(nm.hoTen).toBe("Mẹ khai riêng");
  });
});

describe("[NM-CHON] `nguoiMuaChon` — kế toán chọn tay người mua (24/11/2026)", () => {
  const goc = {
    customerName: "Phạm Thị Mẹ",
    customerCccd: "048000000001",
    customerAddress: "1 Lê Duẩn",
    customerEmail: "me@example.com",
    conChoNguoiMua: { hoTen: "Phạm Bé Con", cccd: null },
  };
  it("không chọn ⇒ luật tự động: mẹ đủ hơn ⇒ mẹ", () => {
    const nm = nguoiMuaChoDon(don(goc));
    expect(nm.hoTen).toBe("Phạm Thị Mẹ");
    expect(nm.theoCon).toBeNull();
  });
  it("chọn CON ⇒ con đứng tên (tên con, CCCD của con), email/SĐT/địa chỉ vẫn của ba/mẹ, `theoCon` mang tên ba/mẹ", () => {
    const nm = nguoiMuaChoDon(don({ ...goc, nguoiMuaChon: "CON" }));
    expect(nm.hoTen).toBe("Phạm Bé Con");
    expect(nm.cccd).toBeNull();
    expect(nm.diaChi).toBe("1 Lê Duẩn");
    expect(nm.email).toBe("me@example.com");
    expect(nm.theoCon).toEqual({ tenPhuHuynh: "Phạm Thị Mẹ" });
  });
  it("chọn PHU_HUYNH khi con đủ hơn ⇒ ba/mẹ", () => {
    const nm = nguoiMuaChoDon(don({ ...goc, customerCccd: null, conChoNguoiMua: { hoTen: "Phạm Bé Con", cccd: "048000000002" }, nguoiMuaChon: "PHU_HUYNH" }));
    expect(nm.hoTen).toBe("Phạm Thị Mẹ");
    expect(nm.theoCon).toBeNull();
  });
  it("chọn CON mà đơn có tên đơn vị ⇒ vẫn đơn vị (không đổi sang trẻ em)", () => {
    const nm = nguoiMuaChoDon(don({ ...goc, invoiceCompanyName: "Công ty ABC", invoiceTaxCode: "0312345678", nguoiMuaChon: "CON" }));
    expect(nm.tenDonVi).toBe("Công ty ABC");
    expect(nm.theoCon).toBeNull();
  });
});
