import { describe, expect, it } from "vitest";
import { lyDoBoQuaTuXuat } from "./chon-lan-thu";

// [XL-*] — lần thu nào được «Xuất liền» (nút của Sale, BGĐ 09/11/2026). Luật ở `chon-lan-thu.ts`. (Phần «sau n giờ» đã gỡ cùng luồng tự xuất.)

describe("[XL-03] chọn lần thu: mỗi mã lý do MỘT điều kiện, có đối chứng dương", () => {
  const ok = { ngan: "cho", phatHanhHien: true, coNgoaiLe: false, cocChuaTraDu: false, khoanIds: ["p1", "p2"] };
  const bc = { khoanChuaXacNhan: new Set<string>() };
  it("lần thu đủ điều kiện ⇒ null (xuất được)", () => {
    expect(lyDoBoQuaTuXuat(ok, bc)).toBeNull();
  });
  it("ngăn khác «chờ» ⇒ NGAN_KHAC", () => {
    for (const ngan of ["da-xuat", "khong-xuat", "dang-phat-hanh"]) expect(lyDoBoQuaTuXuat({ ...ok, ngan }, bc), ngan).toBe("NGAN_KHAC");
  });
  it("nút Phát hành không hiện ⇒ KHONG_PHAT_HANH_DUOC", () => {
    expect(lyDoBoQuaTuXuat({ ...ok, phatHanhHien: false }, bc)).toBe("KHONG_PHAT_HANH_DUOC");
  });
  it("có ngoại lệ (thiếu tiền / nghi trùng) ⇒ NGOAI_LE", () => {
    expect(lyDoBoQuaTuXuat({ ...ok, coNgoaiLe: true }, bc)).toBe("NGOAI_LE");
  });
  it("còn MỘT khoản chưa xác nhận (dù khoản kia đã xác nhận) ⇒ KHOAN_CHUA_XAC_NHAN; không có khoản nào ⇒ cũng bỏ qua (không xuất lần thu rỗng)", () => {
    expect(lyDoBoQuaTuXuat(ok, { khoanChuaXacNhan: new Set(["p2"]) })).toBe("KHOAN_CHUA_XAC_NHAN");
    expect(lyDoBoQuaTuXuat({ ...ok, khoanIds: [] }, bc)).toBe("KHOAN_CHUA_XAC_NHAN");
    // Đối chứng: khoản chưa xác nhận của ĐƠN KHÁC (không thuộc lần thu này) không cản.
    expect(lyDoBoQuaTuXuat(ok, { khoanChuaXacNhan: new Set(["khac"]) })).toBeNull();
  });
  it("đơn CỌC chưa trả đủ ⇒ DON_COC_CHUA_TRA_DU (Sale bấm «Xuất liền» cũng KHÔNG xuất riêng hoá đơn cọc — MỘT hoá đơn khi trả đủ); đứng TRƯỚC chuyện xác nhận khoản", () => {
    expect(lyDoBoQuaTuXuat({ ...ok, cocChuaTraDu: true }, bc)).toBe("DON_COC_CHUA_TRA_DU");
    expect(lyDoBoQuaTuXuat({ ...ok, cocChuaTraDu: true }, { khoanChuaXacNhan: new Set(["p1"]) })).toBe("DON_COC_CHUA_TRA_DU");
    expect(lyDoBoQuaTuXuat({ ...ok, cocChuaTraDu: false }, bc)).toBeNull();
  });
  it("thứ tự nguyên nhân gốc trước: ngăn → nút → ngoại lệ → tiền", () => {
    const xau = { ngan: "da-xuat", phatHanhHien: false, coNgoaiLe: true, cocChuaTraDu: false, khoanIds: [] as string[] };
    expect(lyDoBoQuaTuXuat(xau, bc)).toBe("NGAN_KHAC");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho" }, bc)).toBe("KHONG_PHAT_HANH_DUOC");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho", phatHanhHien: true }, bc)).toBe("NGOAI_LE");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho", phatHanhHien: true, coNgoaiLe: false }, bc)).toBe("KHOAN_CHUA_XAC_NHAN");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho", phatHanhHien: true, coNgoaiLe: false, cocChuaTraDu: true }, bc)).toBe("DON_COC_CHUA_TRA_DU");
  });
});
