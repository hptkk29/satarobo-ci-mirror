// [TXN-*] — vị từ THUẦN "người xem có là người ghi khoản này không" (AC5, tách nhiệm vụ).
// Cổng máy chủ (lõi xác nhận, action, xác nhận hàng loạt, chốt hoá đơn, hàng chờ hoá đơn) và cờ `laNguoiGhi`
// của màn Thanh toán cùng gọi hàm này — xem lưới dây nối `tu-xac-nhan-wiring.test.ts`.
import { describe, expect, it } from "vitest";
import { CAU_TU_XAC_NHAN, laNguoiGhiKhoan } from "./tu-xac-nhan";

describe("[TXN] laNguoiGhiKhoan", () => {
  it("[TXN-01] cùng một người ⇒ true (người ghi KHÔNG được tự xác nhận)", () => {
    expect(laNguoiGhiKhoan("u-sale", "u-sale")).toBe(true);
  });

  it("[TXN-02] đối chứng dương: người khác ⇒ false (kế toán khác vẫn xác nhận được)", () => {
    expect(laNguoiGhiKhoan("u-sale", "u-ke-toan")).toBe(false);
    // Khác nhau một ký tự cũng là người khác — không so lỏng.
    expect(laNguoiGhiKhoan("u-sale", "u-sale ")).toBe(false);
    expect(laNguoiGhiKhoan("u-sale", "U-SALE")).toBe(false);
  });

  it("[TXN-03] khoản KHÔNG có người ghi (dữ liệu cũ / hệ thống tự sinh) ⇒ false — không ai 'tự' xác nhận được", () => {
    expect(laNguoiGhiKhoan(null, "u-ke-toan")).toBe(false);
    expect(laNguoiGhiKhoan(undefined, "u-ke-toan")).toBe(false);
    expect(laNguoiGhiKhoan("", "u-ke-toan")).toBe(false);
    // `null === null` / `"" === ""` KHÔNG được thành 'cùng một người'.
    expect(laNguoiGhiKhoan(null, "")).toBe(false);
    expect(laNguoiGhiKhoan("", "")).toBe(false);
  });

  it("[TXN-04] id người xem rỗng ⇒ false (không so khớp được với ai); null / undefined bị trình biên dịch chặn", () => {
    expect(laNguoiGhiKhoan("u-sale", "")).toBe(false);
    // @ts-expect-error — người xem BẮT BUỘC là string (luật 7): quên truyền là lỗi biên dịch, không phải `false` lặng lẽ.
    expect(laNguoiGhiKhoan("u-sale", null)).toBe(false);
    // @ts-expect-error — như trên.
    expect(laNguoiGhiKhoan("u-sale", undefined)).toBe(false);
  });

  it("[TXN-05] câu từ chối là MỘT nguồn và nói đúng việc", () => {
    expect(CAU_TU_XAC_NHAN).toBe("Người ghi nhận không được tự xác nhận khoản của mình");
  });
});
