// lib/payments/ma-giao-dich-ngan-hang.test.ts — `[MGD-*]` mã giao dịch ngân hàng khai tay.
import { describe, it, expect } from "vitest";
import { chuanHoaMaGiaoDichNganHang, docMaGiaoDichKhaiTay } from "./ma-giao-dich-ngan-hang";
import { maGiaoDichMarker } from "@/lib/finance/payment-markers";

describe("[MGD] chuanHoaMaGiaoDichNganHang", () => {
  it("[MGD-01] in hoa, bỏ khoảng trắng / gạch — cùng một mã người ta gõ nhiều kiểu", () => {
    for (const x of ["FT26000000000002", "ft26000000000002", " FT 26000 000000002 ", "FT-26000-000000002", "ft_26000000000002"]) {
      expect(chuanHoaMaGiaoDichNganHang(x), x).toBe("FT26000000000002");
    }
  });

  it("[MGD-02] mã lạ ⇒ null (không biến một chuỗi bậy thành khoá chống trùng)", () => {
    for (const x of ["", "abc", "12345", "FT2627920196118!", "FT26000000000002 chuyển khoản MB", "a".repeat(41), null, undefined, 123456789012]) {
      expect(chuanHoaMaGiaoDichNganHang(x), String(x)).toBeNull();
    }
  });

  it("[MGD-03] mã dạng webhook không phải FT (providerTxnId 9990000000001-20260101) vẫn chuẩn hoá được — để ingest tra cùng một khoá", () => {
    expect(chuanHoaMaGiaoDichNganHang("9990000000001-20260101")).toBe("999000000000120260101");
  });
});

describe("[MGD] docMaGiaoDichKhaiTay — ô trống ≠ ô sai", () => {
  it("[MGD-04] ô trống / không có ⇒ không khai; có chữ mà sai ⇒ LỖI (không lặng lẽ bỏ khoá chống trùng)", () => {
    expect(docMaGiaoDichKhaiTay(undefined)).toEqual({ loai: "KHONG_KHAI" });
    expect(docMaGiaoDichKhaiTay(null)).toEqual({ loai: "KHONG_KHAI" });
    expect(docMaGiaoDichKhaiTay("   ")).toEqual({ loai: "KHONG_KHAI" });
    expect(docMaGiaoDichKhaiTay("FT26000000000002")).toEqual({ loai: "HOP_LE", ma: "FT26000000000002" });
    expect(docMaGiaoDichKhaiTay("xyz!")).toEqual({ loai: "SAI_DINH_DANG" });
  });

  it("[MGD-05] marker có hình dạng cố định và KHÔNG phải họ `[auto:` (không giả làm tiền do cổng đẩy vào)", () => {
    const m = maGiaoDichMarker("FT26000000000002");
    expect(m).toBe("[ma-gd:FT26000000000002]");
    expect(m.startsWith("[auto:")).toBe(false);
  });
});
