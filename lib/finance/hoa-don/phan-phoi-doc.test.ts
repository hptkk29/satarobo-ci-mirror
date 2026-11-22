// Ca [PPD-*] — HOÁ ĐƠN ĐÃ PHÁT HÀNH NÀO HIỂN THỊ / TẢI CHO VAI NÀO (Invoice Hub S10, luật thuần). Không DB, không đồng hồ.
// Mỗi ca "KHÔNG" kèm đối chứng dương cùng bảng đầu vào.
import { describe, expect, it } from "vitest";
import {
  choPhepTaiPdf,
  duongTaiPdf,
  hienChoPhuHuynh,
  hienChoSale,
  hienThiChoPhuHuynh,
  hienThiChoSale,
  hoaDonThuocPhuHuynh,
  tenTepAnToan,
  type HoaDonPhanPhoiVao,
} from "./phan-phoi-doc";

const hd = (o: Partial<HoaDonPhanPhoiVao> = {}): HoaDonPhanPhoiVao => ({
  id: "hd1",
  trangThai: "DA_XAC_NHAN",
  nguonPhatHanh: "MISA_API",
  kyHieu: "1C26TSR",
  soHoaDon: "127",
  ngayPhatHanh: new Date("2026-10-11T00:00:00Z"),
  tongTien: 5_000_000,
  coTepPdf: true,
  ...o,
});

describe("[PPD-01] phụ huynh chỉ thấy bản ĐÃ XÁC NHẬN, có PDF, KHÔNG phải mô phỏng", () => {
  it("đối chứng dương: bản đủ điều kiện hiện ra, kèm đường tải PDF", () => {
    const ra = hienThiChoPhuHuynh([hd()], { khoOk: true });
    expect(ra).toHaveLength(1);
    expect(ra[0]).toMatchObject({ id: "hd1", tieuDe: "Hoá đơn số 127", ngayLabel: "11/10/2026", soTien: 5_000_000, taiPdf: "/api/hoa-don/hd1/tai-pdf" });
  });
  it.each(["NHAP", "DANG_PHAT_HANH", "LOI_PHAT_HANH", "THAY_THE", "KHONG_XUAT"])("trạng thái %s ⇒ KHÔNG hiện", (trangThai) => {
    expect(hienThiChoPhuHuynh([hd({ trangThai })], { khoOk: true })).toEqual([]);
    expect(hienChoPhuHuynh(hd({ trangThai }))).toBe(false);
  });
  it("bản mô phỏng (MISA_GIA_LAP) ⇒ KHÔNG hiện; đối chứng: cùng hàng nhưng MISA_API ⇒ hiện", () => {
    expect(hienThiChoPhuHuynh([hd({ nguonPhatHanh: "MISA_GIA_LAP" })], { khoOk: true })).toEqual([]);
    expect(hienThiChoPhuHuynh([hd({ nguonPhatHanh: "TAI_LEN" })], { khoOk: true })).toHaveLength(1);
  });
  it("chưa có tệp PDF ⇒ KHÔNG hiện (không có dòng 'thấy mà không tải được')", () => {
    expect(hienThiChoPhuHuynh([hd({ coTepPdf: false })], { khoOk: true })).toEqual([]);
  });
  it("kho tệp chưa cấu hình ⇒ rỗng; đối chứng: kho sẵn sàng ⇒ có", () => {
    expect(hienThiChoPhuHuynh([hd()], { khoOk: false })).toEqual([]);
    expect(hienThiChoPhuHuynh([hd()], { khoOk: true })).toHaveLength(1);
  });
  it("hiện chọn lọc từng dòng: trộn nhiều bản ⇒ chỉ bản hợp lệ ở lại, giữ thứ tự", () => {
    const ra = hienThiChoPhuHuynh([hd({ id: "a" }), hd({ id: "b", trangThai: "THAY_THE" }), hd({ id: "c" })], { khoOk: true });
    expect(ra.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("[PPD-02] view-model KHÔNG mang khoá lưu trữ, hash, mã tra cứu, studentId, MST", () => {
  it("đầu vào cố tình chứa các trường nhạy cảm ⇒ đầu ra chỉ có đúng tập khoá cho phép", () => {
    const bẩn = { ...hd(), tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf", tepPdfSha256: "abc", maTraCuu: "XYZ", phapNhanMst: "0401234567", studentId: "st1", nguoiMuaMst: "0309999999" };
    const ph = hienThiChoPhuHuynh([bẩn], { khoOk: true })[0]!;
    expect(Object.keys(ph).sort()).toEqual(["id", "kyHieu", "ngayLabel", "soTien", "taiPdf", "tieuDe"]);
    const sale = hienThiChoSale([bẩn], { duocTaiPdf: true, khoOk: true })[0]!;
    expect(Object.keys(sale).sort()).toEqual(["daThayThe", "id", "kyHieu", "lyDoKhongTai", "ngayLabel", "nhan", "soHoaDon", "soTien", "taiPdf", "tone"]);
    const chuoi = JSON.stringify([ph, sale]);
    for (const nhay of ["hoa-don/CS1", "abc", "XYZ", "0401234567", "st1", "0309999999", "tepPdfKey", "Sha256"]) expect(chuoi).not.toContain(nhay);
  });
});

describe("[PPD-03] Sale: thấy đã phát hành + đã thay thế (kèm nhãn), chỉ tải PDF bản còn hiệu lực", () => {
  const mo = { duocTaiPdf: true, khoOk: true };
  it("đã phát hành + quyền + kho ⇒ có nút tải; đã thay thế ⇒ hiện với nhãn nhưng KHÔNG nút tải", () => {
    const [a, b] = hienThiChoSale([hd({ id: "a" }), hd({ id: "b", trangThai: "THAY_THE" })], mo);
    expect(a).toMatchObject({ nhan: "Đã phát hành", tone: "success", daThayThe: false, taiPdf: "/api/hoa-don/a/tai-pdf", lyDoKhongTai: null });
    expect(b).toMatchObject({ nhan: "Đã thay thế", tone: "muted", daThayThe: true, taiPdf: null });
    expect(b!.lyDoKhongTai).toMatch(/đã được thay/);
  });
  it.each(["NHAP", "DANG_PHAT_HANH", "LOI_PHAT_HANH", "KHONG_XUAT"])("trạng thái %s ⇒ không vào danh sách của Sale", (trangThai) => {
    expect(hienThiChoSale([hd({ trangThai })], mo)).toEqual([]);
    expect(hienChoSale(hd({ trangThai }))).toBe(false);
  });
  it("thiếu quyền xem PII ⇒ xem được dòng nhưng KHÔNG tải, và nói lý do; đối chứng: có quyền ⇒ tải", () => {
    const khong = hienThiChoSale([hd()], { duocTaiPdf: false, khoOk: true })[0]!;
    expect(khong.taiPdf).toBeNull();
    expect(khong.lyDoKhongTai).toMatch(/quyền xem thông tin khách/);
    expect(hienThiChoSale([hd()], mo)[0]!.taiPdf).not.toBeNull();
  });
  it("bản mô phỏng ⇒ nhãn 'Bản mô phỏng', không tải; chưa có PDF ⇒ nói 'báo kế toán'; kho chưa cấu hình ⇒ nói rõ", () => {
    expect(hienThiChoSale([hd({ nguonPhatHanh: "MISA_GIA_LAP" })], mo)[0]).toMatchObject({ nhan: "Bản mô phỏng", tone: "warning", taiPdf: null });
    expect(hienThiChoSale([hd({ coTepPdf: false })], mo)[0]!.lyDoKhongTai).toMatch(/chưa có tệp PDF/);
    expect(hienThiChoSale([hd()], { duocTaiPdf: true, khoOk: false })[0]!.lyDoKhongTai).toMatch(/Kho lưu hoá đơn chưa cấu hình/);
  });
});

describe("[PPD-04] vị từ tải dùng chung (nút = danh sách = route)", () => {
  it("chỉ đã phát hành + có PDF + không mô phỏng", () => {
    expect(choPhepTaiPdf({ trangThai: "DA_XAC_NHAN", nguonPhatHanh: "MISA_API", coTepPdf: true })).toBe(true);
    expect(choPhepTaiPdf({ trangThai: "NHAP", nguonPhatHanh: "MISA_API", coTepPdf: true })).toBe(false);
    expect(choPhepTaiPdf({ trangThai: "DA_XAC_NHAN", nguonPhatHanh: "MISA_GIA_LAP", coTepPdf: true })).toBe(false);
    expect(choPhepTaiPdf({ trangThai: "DA_XAC_NHAN", nguonPhatHanh: "MISA_API", coTepPdf: false })).toBe(false);
  });
  it("đường tải là /api/hoa-don/<id>/tai-pdf, id được mã hoá (không thoát khỏi đường dẫn)", () => {
    expect(duongTaiPdf("abc")).toBe("/api/hoa-don/abc/tai-pdf");
    expect(duongTaiPdf("a/b?c")).toBe("/api/hoa-don/a%2Fb%3Fc/tai-pdf");
  });
});

describe("[PPD-05] tên tệp an toàn, không mang tên học viên", () => {
  it("giữ ký hiệu + số; ký tự lạ (kế toán gõ tay) biến thành gạch", () => {
    expect(tenTepAnToan("1C26TSR", "127")).toBe("hoa-don-1C26TSR-127.pdf");
    expect(tenTepAnToan("1C26/TSR", " 0127 ")).toBe("hoa-don-1C26-TSR-0127.pdf");
    expect(tenTepAnToan('1C"; x=y', "1\r\nSet-Cookie: a")).toBe("hoa-don-1C-x-y-1-Set-Cookie-a.pdf");
  });
  it("thiếu ký hiệu hoặc số ⇒ tên chung (đối chứng của nhánh đủ)", () => {
    expect(tenTepAnToan(null, "127")).toBe("hoa-don.pdf");
    expect(tenTepAnToan("1C26TSR", null)).toBe("hoa-don.pdf");
    expect(tenTepAnToan("", "")).toBe("hoa-don.pdf");
  });
});

describe("[PPD-06] hoá đơn của con nào — fail-closed", () => {
  const MINH = ["a", "b"]; // hai con của phụ huynh
  it("đối chứng dương: khoản gắn đúng con của mình ⇒ thuộc; đang xem đúng con đó ⇒ thuộc", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["a"], conTheoDon: [], conCuaPhuHuynh: MINH })).toBe(true);
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["a"], conTheoDon: [], conCuaPhuHuynh: MINH, conDangChon: "a" })).toBe(true);
  });
  it("khoản gắn con của NGƯỜI KHÁC ⇒ không thuộc", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["x"], conTheoDon: [], conCuaPhuHuynh: MINH })).toBe(false);
  });
  it("lẫn con của mình và con người khác ⇒ không thuộc (không đoán)", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["a", "x"], conTheoDon: [], conCuaPhuHuynh: MINH })).toBe(false);
  });
  it("không nối được con nào (khoản chưa gắn, đơn chưa gắn) ⇒ ẩn", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: [], conTheoDon: [], conCuaPhuHuynh: MINH })).toBe(false);
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: [null, undefined], conTheoDon: [null], conCuaPhuHuynh: MINH })).toBe(false);
  });
  it("đang xem con B mà hoá đơn chỉ của con A ⇒ không hiện dưới B; đối chứng: dưới A thì hiện", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["a"], conTheoDon: [], conCuaPhuHuynh: MINH, conDangChon: "b" })).toBe(false);
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["a"], conTheoDon: [], conCuaPhuHuynh: MINH, conDangChon: "a" })).toBe(true);
  });
  it("rơi về con trên đơn CHỈ khi không khoản nào gắn con; có khoản gắn con thì khoản thắng đơn", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: [], conTheoDon: ["a"], conCuaPhuHuynh: MINH })).toBe(true);
    // khoản gắn con của người khác, đơn ghi con của mình ⇒ khoản thắng ⇒ không thuộc
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["x"], conTheoDon: ["a"], conCuaPhuHuynh: MINH })).toBe(false);
    // đơn ghi lẫn con người khác, chưa khoản nào gắn ⇒ không thuộc
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: [], conTheoDon: ["a", "x"], conCuaPhuHuynh: MINH })).toBe(false);
  });
  it("phụ huynh không còn con nào ⇒ không thuộc cái gì", () => {
    expect(hoaDonThuocPhuHuynh({ conTheoKhoan: ["a"], conTheoDon: [], conCuaPhuHuynh: [] })).toBe(false);
  });
});
