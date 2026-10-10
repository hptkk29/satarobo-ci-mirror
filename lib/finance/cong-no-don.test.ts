// lib/finance/cong-no-don.test.ts — số "còn thiếu" in trên TRANG CHI TIẾT ĐƠN.
//
// Vì sao có file này: trang `/orders/[id]` ĐÃ tính `paidSoFar` (trục B) và ĐÃ nhận
// `accounting.confirmed/pending` (trục A), nhưng chỉ in `order.totalAmount` — người
// xem đơn không thấy được thiếu bao nhiêu. Tính rồi không hiện là loại lỗi không test
// nào bắt được nếu con số sống rải rác trong JSX, nên nó được gom vào MỘT hàm thuần.
import { describe, it, expect } from "vitest";
import { congNoDon } from "./cong-no-don";

describe("[CND-01] còn thiếu = tổng đơn − tiền ĐÃ GHI NHẬN (trục B)", () => {
  it("đơn 5tr, sale đã thu 3tr, kế toán chưa xác nhận → thiếu 2tr, chờ xác nhận 3tr", () => {
    // Đây đúng là hình dạng đơn tạo từ màn Thiếu học phí: khoản mang dấu
    // `[backfill-import]` nên saleStatus=RECORDED (trục B thấy) nhưng
    // accountantStatus=PENDING (trục A chưa thấy).
    expect(congNoDon({ totalAmount: 5_000_000, daGhiNhan: 3_000_000, daXacNhan: 0 })).toEqual({
      phaiDong: 5_000_000,
      daThu: 3_000_000,
      conThieu: 2_000_000,
      choXacNhan: 3_000_000,
      traVuot: 0,
      xong: false,
    });
  });

  it("KHÔNG lấy trục A làm đã thu — nếu lấy thì đơn vừa nhập sẽ báo thiếu TOÀN BỘ", () => {
    const r = congNoDon({ totalAmount: 5_000_000, daGhiNhan: 5_000_000, daXacNhan: 0 });
    expect(r.conThieu).toBe(0);
    expect(r.choXacNhan).toBe(5_000_000);
  });

  it("thu đủ và kế toán đã xác nhận hết → thiếu 0, chờ 0, xong", () => {
    expect(congNoDon({ totalAmount: 5_000_000, daGhiNhan: 5_000_000, daXacNhan: 5_000_000 })).toEqual(
      { phaiDong: 5_000_000, daThu: 5_000_000, conThieu: 0, choXacNhan: 0, traVuot: 0, xong: true },
    );
  });
});

describe("[CND-02] ca biên — không bao giờ in số âm", () => {
  it("khách trả VƯỢT → thiếu 0 và nói ra phần vượt (không phải −1tr)", () => {
    const r = congNoDon({ totalAmount: 5_000_000, daGhiNhan: 6_000_000, daXacNhan: 6_000_000 });
    expect(r.conThieu).toBe(0);
    expect(r.traVuot).toBe(1_000_000);
    expect(r.xong).toBe(true);
  });

  it("đơn 0đ chưa thu gì → không coi là thiếu, và KHÔNG coi là xong", () => {
    // Đơn 0đ là dữ liệu sai cần người xem (cùng lý do `phanLoaiHocPhi` tách
    // `soDon === 0` khỏi `tongPhaiThu === 0`), nên đừng đóng dấu xanh cho nó.
    const r = congNoDon({ totalAmount: 0, daGhiNhan: 0, daXacNhan: 0 });
    expect(r.conThieu).toBe(0);
    expect(r.xong).toBe(false);
  });

  it("trục A lớn hơn trục B (bút toán điều chỉnh) → chờ xác nhận về 0, không âm", () => {
    const r = congNoDon({ totalAmount: 5_000_000, daGhiNhan: 3_000_000, daXacNhan: 4_000_000 });
    expect(r.choXacNhan).toBe(0);
  });

  it("số không hữu hạn / âm từ aggregate rỗng → coi như 0, không ném", () => {
    const r = congNoDon({ totalAmount: Number.NaN, daGhiNhan: -1, daXacNhan: Number.NaN });
    expect(r).toEqual({ phaiDong: 0, daThu: 0, conThieu: 0, choXacNhan: 0, traVuot: 0, xong: false });
  });

  it("làm tròn về đồng — tiền không có phần thập phân", () => {
    const r = congNoDon({ totalAmount: 5_000_000.4, daGhiNhan: 2_999_999.6, daXacNhan: 0 });
    expect(r.phaiDong).toBe(5_000_000);
    expect(r.daThu).toBe(3_000_000);
    expect(r.conThieu).toBe(2_000_000);
  });
});
