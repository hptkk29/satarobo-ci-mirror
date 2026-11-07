// [LK-01..03] Danh sách LOẠI KHOẢN trong ô chọn của form chính sách phải KHỚP loại đơn thật của hệ thống (`OrderType` của Prisma) — trước 02/11/2026 ô này là chữ gõ tự do
// nên người không rành kế toán phải đoán mã. Thêm một loại đơn mới ở schema mà quên khai ở `LOAI_KHOAN_CHON` ⇒ đỏ (loại khoản thiếu trong ô chọn = không soạn được chính sách cho nó).
import { describe, expect, it } from "vitest";
import { OrderType } from "@prisma/client";
import { LOAI_KHOAN_CHON, nhanLoaiKhoan, nhapMoi, noiDungTuNhap } from "./chinh-sach-nhap";

describe("[LK-01] ô chọn loại khoản khớp OrderType + TAT_CA", () => {
  it("đủ MỌI giá trị OrderType, đúng một lần mỗi giá trị, cộng đúng một dòng phủ chung TAT_CA", () => {
    const ma = LOAI_KHOAN_CHON.map((l) => l.ma);
    expect([...ma].sort()).toEqual([...Object.values(OrderType), "TAT_CA"].sort());
    expect(new Set(ma).size).toBe(ma.length);
  });
  it("mỗi loại có tên tiếng Việt và lời giải thích (không để ô chọn hiện mã thô)", () => {
    for (const l of LOAI_KHOAN_CHON) {
      expect(l.nhan.trim().length, l.ma).toBeGreaterThan(2);
      expect(l.nhan, l.ma).not.toBe(l.ma);
      expect(l.giaiThich.trim().length, l.ma).toBeGreaterThan(10);
    }
  });
});

describe("[LK-02] nhanLoaiKhoan: mã lạ (bản cũ sao chép sang) trả lại ĐÚNG mã, không đoán", () => {
  it("mã có trong danh sách ⇒ tên Việt; mã lạ ⇒ chính nó", () => {
    expect(nhanLoaiKhoan("COURSE")).toBe("Học phí khoá học");
    expect(nhanLoaiKhoan("TAT_CA")).toBe("Tất cả loại còn lại");
    expect(nhanLoaiKhoan("MA_LA")).toBe("MA_LA");
  });
});

describe("[LK-03] đối chứng: chọn loại khoản không làm hiện mặc định pháp lý", () => {
  it("form MỚI vẫn để trống mọi ô có hệ quả thuế (không có thuế/giá/thời điểm điền sẵn)", () => {
    const n = nhapMoi(false);
    expect(n.dong).toHaveLength(1);
    expect(n.dong[0]).toMatchObject({ loaiKhoan: "", kieuMuc: "", phanTram: "", kieuGia: "", cachThuSoBuoi: "" });
    expect(n.thoiDiemLap).toBe("");
    expect(n.cheDoToiDa).toBe("");
    const nd = noiDungTuNhap(n) as { anhXaThue: Array<{ loaiKhoan: string; mucThue?: unknown }> };
    expect(nd.anhXaThue[0]!.mucThue).toBeUndefined();
  });
});
