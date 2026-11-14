// [NVT-01..04] Chữ của dòng tóm tắt nghĩa vụ hoá đơn (scanner). Thuần.
import { describe, expect, it } from "vitest";
import { HoaDonNghiaVuTrangThai } from "@prisma/client";
import { NHAN_TRANG_THAI_NGHIA_VU, cauTomTatNghiaVu, dinhDangLanQuet } from "./nghia-vu-tom-tat";

describe("[NVT-01] cauTomTatNghiaVu", () => {
  it("có dữ liệu: nêu tổng + từng trạng thái theo thứ tự cố định (việc cần làm trước), bỏ trạng thái 0", () => {
    const c = cauTomTatNghiaVu({ tong: 32, theoTrangThai: { DANG_XU_LY: 1, CHO_XUAT: 31, DA_XUAT: 0 }, quetLanCuoiLuc: "2026-11-02T11:40:00.000Z" });
    expect(c).toBe("Scanner đã ghi nhận 32 nghĩa vụ hoá đơn: 31 chờ xuất · 1 đang xử lý. Lần quét gần nhất: 02/11 18:40.");
  });
  it("thứ tự KHÔNG phụ thuộc thứ tự khoá của đầu vào; «chờ quyết» luôn đứng đầu", () => {
    const a = cauTomTatNghiaVu({ tong: 3, theoTrangThai: { DA_XUAT: 1, CHO_QUYET: 1, CHO_XUAT: 1 }, quetLanCuoiLuc: null });
    const b = cauTomTatNghiaVu({ tong: 3, theoTrangThai: { CHO_XUAT: 1, CHO_QUYET: 1, DA_XUAT: 1 }, quetLanCuoiLuc: null });
    expect(a).toBe(b);
    expect(a).toMatch(/1 chờ quyết · 1 chờ xuất · 1 đã xuất/);
  });
  it("chưa có nghĩa vụ ⇒ KHÔNG để trống: nói nguyên nhân có thể; đối chứng: tong>0 thì không dùng câu đó", () => {
    expect(cauTomTatNghiaVu({ tong: 0, theoTrangThai: {}, quetLanCuoiLuc: null })).toMatch(/chưa ghi nhận nghĩa vụ hoá đơn nào.*chưa vào thí điểm/);
    expect(cauTomTatNghiaVu({ tong: 1, theoTrangThai: { CHO_XUAT: 1 }, quetLanCuoiLuc: null })).not.toMatch(/chưa ghi nhận/);
  });
  it("trạng thái LẠ (thêm sau này) vẫn được đếm, in nhãn thô — không bị nuốt im lặng; không có lần quét ⇒ không nói «Lần quét»", () => {
    const c = cauTomTatNghiaVu({ tong: 2, theoTrangThai: { CHO_XUAT: 1, TRANG_THAI_MOI: 1 }, quetLanCuoiLuc: null });
    expect(c).toContain("1 TRANG_THAI_MOI");
    expect(c).not.toMatch(/Lần quét/);
  });
});

describe("[NVT-02] nhãn + giờ", () => {
  it("đủ nhãn cho MỌI trạng thái nghĩa vụ của schema (thêm giá trị enum mà quên nhãn ⇒ đỏ), không thừa nhãn lạ", () => {
    expect(Object.keys(NHAN_TRANG_THAI_NGHIA_VU).sort()).toEqual([...Object.values(HoaDonNghiaVuTrangThai)].sort());
  });
  it("giờ Việt Nam, không phụ thuộc múi giờ máy chạy test", () => {
    expect(dinhDangLanQuet("2026-11-02T17:30:00.000Z")).toBe("03/11 00:30");
  });
});
