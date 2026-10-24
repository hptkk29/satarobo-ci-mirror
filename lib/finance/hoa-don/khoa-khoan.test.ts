// Ca [KHK-*] — câu từ chối của cổng hoá đơn trong sổ tiền (PLAN §5): nói ĐÚNG hoá đơn nào đang giữ
// khoản và PHẢI LÀM GÌ trước (luật 12). Hành vi tra DB ở `tests/finance/hoa-don-khoa.test.ts`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KHOAN_CHUA_KHOA_HOA_DON, thongDiepKhoaHoaDon, type KhoanDaKhoa } from "./khoa-khoan";

const k = (o: Partial<KhoanDaKhoa>): KhoanDaKhoa => ({
  paymentId: "p1",
  hoaDonId: "hd1",
  trangThai: "DA_XAC_NHAN",
  kyHieu: "1C26TSR",
  soHoaDon: "127",
  ...o,
});

describe("[KHK-01] câu từ chối theo trạng thái hoá đơn", () => {
  it("đã xác nhận ⇒ nêu ký hiệu-số, bảo HUỶ hoá đơn", () => {
    const c = thongDiepKhoaHoaDon([k({})]);
    expect(c).toContain("1C26TSR-127");
    expect(c).toMatch(/huỷ hoá đơn/);
  });
  it("[KHK-03] đã xác nhận ⇒ KHÔNG nhắc 'thay' — GĐ 8 không có thao tác thay (luật 12)", () => {
    expect(thongDiepKhoaHoaDon([k({})])).not.toMatch(/thay/);
  });
  it("nháp ⇒ bảo gỡ bản nháp; không xuất ⇒ bảo gỡ dấu", () => {
    expect(thongDiepKhoaHoaDon([k({ trangThai: "NHAP", soHoaDon: null })])).toMatch(/hoá đơn nháp 1C26TSR — gỡ bản nháp/);
    expect(thongDiepKhoaHoaDon([k({ trangThai: "KHONG_XUAT", kyHieu: null, soHoaDon: null })])).toMatch(/không xuất.*gỡ dấu/);
  });
  it("không khoản nào khoá ⇒ chuỗi rỗng", () => {
    expect(thongDiepKhoaHoaDon([])).toBe("");
  });
});

describe("[KHK-02] cổng KHÔNG hỏi cờ, và điều kiện bỏ qua neo đúng dòng nối còn hiệu lực", () => {
  it("khoa-khoan.ts không import công tắc màn hoá đơn (tắt cờ không được mở lại đường ghi)", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/finance/hoa-don/khoa-khoan.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*feature["']/);
    expect(src).not.toMatch(/laHoaDonBat\(/);
  });
  it("KHOAN_CHUA_KHOA_HOA_DON = không có dòng nối hieuLuc", () => {
    expect(KHOAN_CHUA_KHOA_HOA_DON).toEqual({ hoaDonKhoan: { none: { hieuLuc: true } } });
  });
});
