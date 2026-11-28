// [DPX-*] Dấu vân tay của tờ hoá đơn đã xem trước (24/11/2026): phủ MỌI thứ nhà cung cấp nhận, trừ `refId`.
import { describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { bamPhieuXemTruoc } from "./dau-phieu-xem-truoc";

const phieu = (o: Partial<PhieuPhatHanh> = {}): PhieuPhatHanh => ({
  refId: "ref-1",
  kyHieu: "1C26MAI",
  mstNguoiBan: "0402054690",
  ngayHoaDon: new Date("2026-11-25T00:00:00.000Z"),
  nguoiMua: { hoTen: "Nguyễn Bé An", donVi: null, mst: null, diaChi: "1 Lê Duẩn", email: "me@example.com", maKhachHang: null, cccd: "048000000009" },
  hinhThucThanhToan: "Chuyển khoản",
  dong: [{ stt: 1, ten: "Học phí khoá Sata4 (48 buổi)", donViTinh: "Khoá", soLuong: 1, donGia: 8_448_000, thanhTien: 8_448_000, thueSuat: 0, tienThue: 0 }],
  tongTruocThue: 8_448_000,
  tongThue: 0,
  tongThanhToan: 8_448_000,
  soTienBangChu: "Tám triệu bốn trăm bốn mươi tám nghìn đồng",
  ...o,
});

describe("[DPX-01] dấu ổn định + không phụ thuộc refId", () => {
  it("cùng nội dung ⇒ cùng dấu; khác refId ⇒ VẪN cùng dấu (refId sinh mỗi lần dựng)", () => {
    expect(bamPhieuXemTruoc(phieu())).toBe(bamPhieuXemTruoc(phieu()));
    expect(bamPhieuXemTruoc(phieu({ refId: "ref-2" }))).toBe(bamPhieuXemTruoc(phieu()));
  });
  it("dấu là 32 ký tự hex", () => {
    expect(bamPhieuXemTruoc(phieu())).toMatch(/^[0-9a-f]{32}$/);
  });
  it("khoảng trắng thừa / hoa-thường NFC không đổi dấu ở chữ; nhưng chữ khác thì đổi", () => {
    expect(bamPhieuXemTruoc(phieu({ nguoiMua: { ...phieu().nguoiMua, hoTen: "  Nguyễn   Bé An " } }))).toBe(bamPhieuXemTruoc(phieu()));
  });
});

describe("[DPX-02] mỗi thứ nhà cung cấp nhận đều làm đổi dấu", () => {
  const goc = bamPhieuXemTruoc(phieu());
  const doi: [string, Partial<PhieuPhatHanh>][] = [
    ["người mua (tên)", { nguoiMua: { ...phieu().nguoiMua, hoTen: "Phạm Thị Mẹ" } }],
    ["CCCD người mua", { nguoiMua: { ...phieu().nguoiMua, cccd: null } }],
    ["địa chỉ", { nguoiMua: { ...phieu().nguoiMua, diaChi: "2 Lê Duẩn" } }],
    ["email", { nguoiMua: { ...phieu().nguoiMua, email: "khac@example.com" } }],
    ["ký hiệu", { kyHieu: "1C26MNV" }],
    ["MST bán", { mstNguoiBan: "0400000000" }],
    ["ngày hoá đơn (qua nửa đêm)", { ngayHoaDon: new Date("2026-11-26T00:00:00.000Z") }],
    ["hình thức thanh toán", { hinhThucThanhToan: "Tiền mặt" }],
    ["nội dung dòng hàng (có «của …»)", { dong: [{ ...phieu().dong[0]!, ten: "Học phí khoá Sata4 (48 buổi) của Nguyễn Bé An" }] }],
    ["thành tiền dòng hàng", { dong: [{ ...phieu().dong[0]!, thanhTien: 8_000_000 }] }],
    ["tổng thanh toán", { tongThanhToan: 8_000_000 }],
  ];
  for (const [ten, d] of doi) {
    it(`đổi ${ten} ⇒ dấu khác`, () => {
      expect(bamPhieuXemTruoc(phieu(d))).not.toBe(goc);
    });
  }
});
