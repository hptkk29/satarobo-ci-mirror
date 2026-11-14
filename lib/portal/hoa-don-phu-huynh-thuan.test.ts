import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HoaDonTrangThai, HoaDonNguonPhatHanh } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  coNhuCauHoaDon,
  dungHoaDonHienThi,
  whereDonCoNhuCauCuaCon,
  duongDanTaiHoaDon,
  hoaDonHienChoPhuHuynh,
  nhanNgayHoaDon,
  tenTepTaiVe,
  boHoaDonTrungKhoiHub,
  tomTenKhoa,
  whereHoaDonPhuHuynh,
  type HoaDonTho,
} from "@/lib/portal/hoa-don-phu-huynh-thuan";

describe("[HDPH-01] hoaDonHienChoPhuHuynh — CHỈ DA_XAC_NHAN, không bao giờ bản mô phỏng", () => {
  it("duyệt qua TOÀN BỘ enum trạng thái × nguồn: duy nhất (DA_XAC_NHAN, thật) lọt", () => {
    const lot: string[] = [];
    for (const trangThai of Object.values(HoaDonTrangThai))
      for (const nguonPhatHanh of Object.values(HoaDonNguonPhatHanh))
        if (hoaDonHienChoPhuHuynh({ trangThai, nguonPhatHanh })) lot.push(`${trangThai}/${nguonPhatHanh}`);
    expect(lot.sort()).toEqual(["DA_XAC_NHAN/MISA_API", "DA_XAC_NHAN/TAI_LEN"]);
  });
  it("NHAP · THAY_THE · KHONG_XUAT · DANG_PHAT_HANH · LOI_PHAT_HANH đều bị loại; giá trị lạ bị loại (fail-closed)", () => {
    for (const t of ["NHAP", "THAY_THE", "KHONG_XUAT", "DANG_PHAT_HANH", "LOI_PHAT_HANH", "TRANG_THAI_MOI_CHUA_BIET"])
      expect(hoaDonHienChoPhuHuynh({ trangThai: t, nguonPhatHanh: "TAI_LEN" })).toBe(false);
  });
  it("DA_XAC_NHAN nhưng MISA_GIA_LAP ⇒ loại", () => {
    expect(hoaDonHienChoPhuHuynh({ trangThai: "DA_XAC_NHAN", nguonPhatHanh: "MISA_GIA_LAP" })).toBe(false);
  });
});

describe("[HDPH-02] whereHoaDonPhuHuynh — điều kiện sở hữu + luật bản", () => {
  it("mang đủ trạng thái, nguồn, và HAI đường sở hữu giới hạn theo studentIds", () => {
    const w = whereHoaDonPhuHuynh(["s1", "s2"]);
    expect(w.trangThai).toBe("DA_XAC_NHAN");
    expect(w.nguonPhatHanh).toEqual({ not: "MISA_GIA_LAP" });
    expect(w.OR).toHaveLength(2);
    expect(JSON.stringify(w.AND)).toContain("invoiceBuyerName"); // CHỈ đơn có nhu cầu (khách đã khai người mua)
    const txt = JSON.stringify(w.OR);
    expect(txt).toContain('"studentId":{"in":["s1","s2"]}');
    expect(txt).toContain('"hieuLuc":true');
  });
  it("có hoaDonId ⇒ thêm id; không có ⇒ không có khoá id", () => {
    expect(whereHoaDonPhuHuynh(["s1"], "hd1").id).toBe("hd1");
    expect("id" in whereHoaDonPhuHuynh(["s1"])).toBe(false);
  });
  it("studentIds rỗng ⇒ KHÔNG BAO GIỜ khớp (không rơi về mọi hoá đơn), kể cả khi có hoaDonId", () => {
    expect(whereHoaDonPhuHuynh([])).toEqual({ id: { in: [] } });
    expect(whereHoaDonPhuHuynh([], "hd1")).toEqual({ id: { in: [] } });
  });
});

describe("[HDPH-ND] coNhuCauHoaDon — «có nhu cầu» = người mua ĐÃ ĐƯỢC KHAI RIÊNG cho hoá đơn", () => {
  const trong = { invoiceBuyerName: null, invoiceCompanyName: null, invoiceTaxCode: null, invoiceEmail: null };
  it("không cột invoice* nào có chữ ⇒ KHÔNG nhu cầu (kể cả khi đơn có customer*/hồ sơ — bản sao tự động không tính)", () => {
    expect(coNhuCauHoaDon(trong)).toBe(false);
    // đơn mang tên/email khách đặt + ô học viên điền sẵn: không phải 4 cột người mua
    expect(
      coNhuCauHoaDon({ ...trong, customerName: "Phụ huynh A", customerEmail: "a@x.vn", invoiceStudentName: "Bé An", invoiceParentPhone: "0905123456" } as never),
    ).toBe(false);
  });
  it("trống/khoảng trắng ⇒ không", () => {
    expect(coNhuCauHoaDon({ invoiceBuyerName: "  ", invoiceCompanyName: "", invoiceTaxCode: null, invoiceEmail: " " })).toBe(false);
  });
  it("MỖI cột trong bốn cột có chữ ⇒ có nhu cầu (đối chứng dương từng cột)", () => {
    expect(coNhuCauHoaDon({ ...trong, invoiceBuyerName: "Nguyễn Văn A" })).toBe(true);
    expect(coNhuCauHoaDon({ ...trong, invoiceCompanyName: "Công ty X" })).toBe(true);
    expect(coNhuCauHoaDon({ ...trong, invoiceTaxCode: "0401234567" })).toBe(true);
    expect(coNhuCauHoaDon({ ...trong, invoiceEmail: "ketoan@x.vn" })).toBe(true);
  });
  it("whereDonCoNhuCauCuaCon: rỗng ⇒ không khớp gì; có con ⇒ mang điều kiện nhu cầu + đường sở hữu", () => {
    expect(whereDonCoNhuCauCuaCon([])).toEqual({ id: { in: [] } });
    const w = JSON.stringify(whereDonCoNhuCauCuaCon(["s1"]));
    expect(w).toContain("invoiceEmail");
    expect(w).toContain('"studentId":{"in":["s1"]}');
    expect(w).toContain("REFUNDED");
  });
});

describe("[HDPH-03] dòng hiển thị", () => {
  const tho: HoaDonTho = {
    id: "hd1",
    soHoaDon: "0000127",
    kyHieu: "1C26TSR",
    ngayPhatHanh: new Date("2026-09-12T00:00:00.000Z"),
    xacNhanLuc: new Date("2026-09-13T01:00:00.000Z"),
    tongTien: 5_040_000,
    coPdf: true,
    coXml: true,
    tenKhoaTuKhoan: ["Sata 3"],
    tenDongDon: ["Học phí Sata 3"],
  };
  it("số + ký hiệu + ngày phát hành + tổng tiền + khoá; nút tải khi có tệp và kho sẵn sàng", () => {
    const v = dungHoaDonHienThi(tho, true);
    expect(v.tieuDe).toBe("Hoá đơn số 0000127");
    expect(v.phu).toBe("Ký hiệu 1C26TSR · Phát hành 12/09/2026");
    expect(v.khoa).toBe("Sata 3");
    expect(v.tongTien).toBe(5_040_000);
    expect(v.hrefPdf).toBe("/portal/hoa-don/hd1/tai-ve?loai=pdf");
    expect(v.hrefXemPdf).toBe("/portal/hoa-don/hd1/tai-ve?loai=pdf&xem=1"); // «Xem» ≠ «Tải về»
    expect(v.hrefXml).toBe("/portal/hoa-don/hd1/tai-ve?loai=xml");
    expect(v.tepDangChuanBi).toBe(false);
  });
  it("không có XML ⇒ không có nút XML (không vẽ nút giả)", () => {
    const v = dungHoaDonHienThi({ ...tho, coXml: false }, true);
    expect(v.hrefPdf).not.toBeNull();
    expect(v.hrefXml).toBeNull();
  });
  it("kho chưa cấu hình ⇒ KHÔNG nút (sẽ 503), nói thật là đang chuẩn bị", () => {
    const v = dungHoaDonHienThi(tho, false);
    expect(v.hrefPdf).toBeNull();
    expect(v.hrefXemPdf).toBeNull();
    expect(v.hrefXml).toBeNull();
    expect(v.tepDangChuanBi).toBe(true);
  });
  it("không có tệp nào ⇒ không nút, không 'đang chuẩn bị'", () => {
    const v = dungHoaDonHienThi({ ...tho, coPdf: false, coXml: false }, true);
    expect(v.hrefPdf ?? v.hrefXml).toBeNull();
    expect(v.tepDangChuanBi).toBe(false);
  });
  it("thiếu số hoá đơn / ngày phát hành ⇒ không bịa", () => {
    const v = dungHoaDonHienThi({ ...tho, soHoaDon: null, kyHieu: null, ngayPhatHanh: null, xacNhanLuc: null }, true);
    expect(v.tieuDe).toBe("Hoá đơn điện tử");
    expect(v.phu).toBe("");
  });
  it("không có ngày phát hành ⇒ dùng ngày chốt theo lịch VN (UTC+7 qua nửa đêm)", () => {
    const v = dungHoaDonHienThi({ ...tho, ngayPhatHanh: null, xacNhanLuc: new Date("2026-09-12T18:30:00.000Z") }, true);
    expect(v.phu).toContain("Phát hành 13/09/2026");
  });
  it("nhanNgayHoaDon đọc cột DATE theo UTC (không lùi ngày)", () => {
    expect(nhanNgayHoaDon(new Date("2026-01-01T00:00:00.000Z"))).toBe("01/01/2026");
    expect(nhanNgayHoaDon(null)).toBeNull();
  });
  it("duongDanTaiHoaDon mã hoá id", () => {
    expect(duongDanTaiHoaDon("a/b", "pdf")).toBe("/portal/hoa-don/a%2Fb/tai-ve?loai=pdf");
  });
});

describe("[HDPH-04] tomTenKhoa & tenTepTaiVe", () => {
  it("bỏ trống/trùng, tối đa 3 tên rồi +N; khoản không có khoá thì dùng dòng hàng", () => {
    expect(tomTenKhoa(["Sata 3", null, "Sata 3", " "], [])).toBe("Sata 3");
    expect(tomTenKhoa(["A", "B", "C", "D", "E"], [])).toBe("A · B · C · +2");
    expect(tomTenKhoa([null], ["Học phí Sata 4"])).toBe("Học phí Sata 4");
    expect(tomTenKhoa([], [])).toBeNull();
  });
  it("tên tệp theo ký hiệu + số; thiếu thì dùng tên đã lưu", () => {
    expect(tenTepTaiVe({ kyHieu: "1C26TSR", soHoaDon: "127", loai: "pdf", tenDaLuu: "x.pdf" })).toBe("hoa-don-1C26TSR-127.pdf");
    expect(tenTepTaiVe({ kyHieu: null, soHoaDon: null, loai: "xml", tenDaLuu: "goc.xml" })).toBe("goc.xml");
    expect(tenTepTaiVe({ kyHieu: null, soHoaDon: null, loai: "xml", tenDaLuu: null })).toBe("hoa-don.xml");
  });
});

describe("[HDPH-DD] hai nguồn hoá đơn ở trang Học phí không hiện trùng", () => {
  const a = { id: "a" }, b = { id: "b" };
  it("hoá đơn đã ở khối Hub bị bỏ khỏi mục theo nhu cầu; hoá đơn chỉ mục này có thì giữ, mục vẫn bật", () => {
    expect(boHoaDonTrungKhoiHub({ bat: true, items: [a, b] }, new Set(["a"]))).toEqual({ bat: true, items: [b] });
  });
  it("mọi hoá đơn đều ở khối Hub ⇒ mục ẩn hẳn (không để câu «sẽ hiện ở đây» cạnh hoá đơn đã xuất)", () => {
    expect(boHoaDonTrungKhoiHub({ bat: true, items: [a, b] }, new Set(["a", "b"]))).toEqual({ bat: false, items: [] });
  });
  it("khối Hub không có dòng nào ⇒ giữ nguyên, kể cả trạng thái rỗng của mục (đối chứng)", () => {
    expect(boHoaDonTrungKhoiHub({ bat: true, items: [a] }, new Set())).toEqual({ bat: true, items: [a] });
    expect(boHoaDonTrungKhoiHub({ bat: true, items: [] }, new Set())).toEqual({ bat: true, items: [] });
  });
  it("mục đang tắt thì luôn tắt, dù Hub có hay không", () => {
    expect(boHoaDonTrungKhoiHub({ bat: false, items: [] }, new Set(["a"])).bat).toBe(false);
    expect(boHoaDonTrungKhoiHub({ bat: false, items: [] }, new Set()).bat).toBe(false);
  });
});

describe("[HDPH-DD-W] lưới ghim dây nối: trang Học phí thật sự lọc trùng", () => {
  const bo = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((d) => !/^\s*\/\//.test(d))
      .join("\n");
  it("trang dùng boHoaDonTrungKhoiHub(...) đúng một lần, lọc theo id của khối Hub", () => {
    const trang = bo(readFileSync(resolve(process.cwd(), "app/(portal)/portal/hoc-phi/page.tsx"), "utf8"));
    expect(trang.match(/boHoaDonTrungKhoiHub\(await docMucHoaDon\(\[studentId\]\), new Set\(hoaDon\.dong\.map\(\(d\) => d\.id\)\)\)/g)?.length ?? 0).toBe(1);
  });
});
