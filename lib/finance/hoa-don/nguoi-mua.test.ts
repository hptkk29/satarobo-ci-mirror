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
