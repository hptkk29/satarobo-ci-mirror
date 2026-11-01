/**
 * [CTK] Chọn tài khoản nhận tiền cho mã QR của một đơn — hai pháp nhân, không đoán.
 *
 * Sự cố gốc (19/10/2026, test.satarobo.vn): `BANK_CS1` và `BANK_CS2` cùng khai «Dùng chung».
 *  · Sale CS2 chọn «Chuyển khoản — CS1» cho đơn CS2 → QR trỏ tài khoản pháp nhân CS1.
 *  · Đơn không chọn phương thức → bản cũ lấy dòng đầu theo `displayOrder` (hai dòng cùng 0 ⇒
 *    thứ tự tuỳ ý) ⇒ tài khoản của pháp nhân nào hiện ra là ngẫu nhiên.
 * File này khoá luật mới (xem đầu `chon-tai-khoan-nhan-tien.ts`). THUẦN — không DB.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chonTaiKhoanNhanTien,
  coTaiKhoanChungMoHo,
  taiKhoanDungChungKhacNhau,
  type TaiKhoanMethod,
} from "./chon-tai-khoan-nhan-tien";

const CS1 = "center-cs1";
const CS2 = "center-cs2";

const tk = (centerId: string | null, so: string, bin = "970422", ten = "PHAP NHAN"): TaiKhoanMethod => ({
  centerId,
  bankBin: bin,
  bankAccountNumber: so,
  bankAccountName: ten,
});

const BANK_CS1_RIENG = tk(CS1, "1111111111", "970422", "STEM ROBOTICS");
const BANK_CS2_RIENG = tk(CS2, "2222222222", "970422", "NEW VISION");
const CHUNG_A = tk(null, "3333333333", "970422", "CHUNG A");
const CHUNG_B = tk(null, "4444444444", "970422", "CHUNG B");

describe("[CTK] phương thức đã chọn trên đơn", () => {
  it("[CTK-01] chọn phương thức CỦA CƠ SỞ MÌNH ⇒ dùng đúng nó", () => {
    const kq = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: BANK_CS2_RIENG, ungVien: [BANK_CS2_RIENG, CHUNG_A] });
    expect(kq).toMatchObject({ loai: "DA_CHON", boQuaDaChon: false });
    expect(kq.loai === "DA_CHON" && kq.cfg.accountNumber).toBe("2222222222");
  });

  it("[CTK-02] SỰ CỐ: đơn CS2 mà phương thức đã chọn là của CS1 ⇒ BỎ QUA, rơi về tài khoản của CS2", () => {
    const kq = chonTaiKhoanNhanTien({
      orderCenterId: CS2,
      daChon: BANK_CS1_RIENG,
      ungVien: [BANK_CS2_RIENG, CHUNG_A],
    });
    expect(kq.boQuaDaChon).toBe(true);
    expect(kq.loai).toBe("CUA_CO_SO");
    expect(kq.loai === "CUA_CO_SO" && kq.cfg.accountNumber).toBe("2222222222");
  });

  it("[CTK-03] đối chứng: chọn tường minh một phương thức DÙNG CHUNG vẫn hợp lệ ở mọi cơ sở, kể cả khi có 2 tài khoản chung", () => {
    const kq = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: CHUNG_B, ungVien: [CHUNG_A, CHUNG_B] });
    expect(kq.loai).toBe("DA_CHON");
    expect(kq.loai === "DA_CHON" && kq.cfg.accountNumber).toBe("4444444444");
  });

  it("[CTK-04] phương thức đã chọn khai THIẾU một mảnh ⇒ không dựng QR hỏng, lùi về bước sau", () => {
    const thieu: TaiKhoanMethod = { ...BANK_CS2_RIENG, bankAccountName: null };
    const kq = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: thieu, ungVien: [CHUNG_A] });
    expect(kq.loai).toBe("DUNG_CHUNG");
  });
});

describe("[CTK] không đoán giữa các tài khoản dùng chung", () => {
  it("[CTK-05] SỰ CỐ: cơ sở không có tài khoản riêng + 2 tài khoản chung KHÁC NHAU ⇒ MƠ HỒ, không chọn", () => {
    const kq = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: null, ungVien: [CHUNG_A, CHUNG_B] });
    expect(kq).toMatchObject({ loai: "MO_HO", soTaiKhoan: 2 });
  });

  it("[CTK-05b] kết quả không phụ thuộc thứ tự dòng (thứ tự Postgres trả về là tuỳ ý)", () => {
    const x = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: null, ungVien: [CHUNG_A, CHUNG_B] });
    const y = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: null, ungVien: [CHUNG_B, CHUNG_A] });
    expect(x.loai).toBe("MO_HO");
    expect(y.loai).toBe("MO_HO");
  });

  it("[CTK-06] đối chứng: 2 dòng dùng chung trỏ CÙNG một tài khoản ⇒ không mơ hồ (một pháp nhân)", () => {
    const kq = chonTaiKhoanNhanTien({
      orderCenterId: CS1,
      daChon: null,
      ungVien: [CHUNG_A, tk(null, "3333 333 333", "970422", "TEN KHAC NHAU CUNG TK")],
    });
    expect(kq.loai).toBe("DUNG_CHUNG");
  });

  it("[CTK-06b] cùng số tài khoản nhưng KHÁC ngân hàng (BIN) là hai tài khoản khác nhau", () => {
    expect(taiKhoanDungChungKhacNhau([tk(null, "3333333333", "970422"), tk(null, "3333333333", "970415")])).toHaveLength(2);
  });

  it("[CTK-07] cơ sở CÓ tài khoản riêng ⇒ dùng nó, hai tài khoản chung mơ hồ không ảnh hưởng", () => {
    const kq = chonTaiKhoanNhanTien({
      orderCenterId: CS1,
      daChon: null,
      ungVien: [BANK_CS1_RIENG, CHUNG_A, CHUNG_B],
    });
    expect(kq.loai).toBe("CUA_CO_SO");
    expect(kq.loai === "CUA_CO_SO" && kq.cfg.accountNumber).toBe("1111111111");
  });

  it("[CTK-08] đơn KHÔNG gắn cơ sở: 1 tài khoản chung ⇒ dùng; 2 tài khoản chung khác nhau ⇒ MƠ HỒ", () => {
    expect(chonTaiKhoanNhanTien({ orderCenterId: null, daChon: null, ungVien: [CHUNG_A] }).loai).toBe("DUNG_CHUNG");
    expect(chonTaiKhoanNhanTien({ orderCenterId: null, daChon: null, ungVien: [CHUNG_A, CHUNG_B] }).loai).toBe("MO_HO");
  });

  it("[CTK-09] không có gì khai đủ ⇒ KHONG_CO (người gọi lùi về kho cũ)", () => {
    expect(chonTaiKhoanNhanTien({ orderCenterId: CS1, daChon: null, ungVien: [] }).loai).toBe("KHONG_CO");
    expect(
      chonTaiKhoanNhanTien({ orderCenterId: CS1, daChon: null, ungVien: [{ ...CHUNG_A, bankBin: null }] }).loai,
    ).toBe("KHONG_CO");
  });

  it("[CTK-10] dòng của cơ sở KHÁC lọt vào danh sách ứng viên không bao giờ được chọn", () => {
    const kq = chonTaiKhoanNhanTien({ orderCenterId: CS2, daChon: null, ungVien: [BANK_CS1_RIENG] });
    expect(kq.loai).toBe("KHONG_CO");
  });
});

describe("[CTK] banner màn Phương thức thanh toán", () => {
  it("[CTK-11] coTaiKhoanChungMoHo: đúng khi ≥ 2 tài khoản chung khác nhau, sai ở các ca còn lại", () => {
    expect(coTaiKhoanChungMoHo([CHUNG_A, CHUNG_B])).toBe(true);
    expect(coTaiKhoanChungMoHo([CHUNG_A, CHUNG_A])).toBe(false);
    expect(coTaiKhoanChungMoHo([CHUNG_A, BANK_CS1_RIENG, BANK_CS2_RIENG])).toBe(false);
    expect(coTaiKhoanChungMoHo([])).toBe(false);
  });
});

// ── Lưới ghim DÂY NỐI: test hành vi ở trên không chứng minh được rằng đường dựng QR THẬT gọi nó.
// Mã trước bản vá: `for (const c of candidates) { const cfg = configFromMethod(c); if (cfg) return cfg; }`
// — lấy dòng đầu tiên có đủ ba mảnh, không hỏi nó thuộc cơ sở nào, không đếm tài khoản chung.
describe("[CTK-W] dây nối", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");

  it("[CTK-W1] resolveOrderPaymentConfig đi qua chonTaiKhoanNhanTien và không còn vòng 'lấy dòng đầu có đủ ba mảnh'", () => {
    const src = doc("lib/payments/vietqr.ts");
    expect(src.match(/chonTaiKhoanNhanTien\(/g)?.length).toBe(1);
    expect(src).not.toMatch(/for \(const c of candidates\)/);
    expect(src).not.toMatch(/configFromMethod\(/);
  });

  it("[CTK-W2] câu tra ứng viên có thứ tự TOÀN PHẦN (displayOrder rồi code) — không để Postgres tuỳ ý khi hoà", () => {
    const src = doc("lib/payments/vietqr.ts");
    expect(src).toMatch(/orderBy:\s*\[[^\]]*displayOrder:\s*"asc"[^\]]*code:\s*"asc"/);
  });

  it("[CTK-W3] MƠ HỒ không được rơi về khoá VIETQR chung — chỉ khoá theo cơ sở", () => {
    const src = doc("lib/payments/vietqr.ts");
    expect(src).toMatch(/kq\.loai === "MO_HO"\)\s*return input\.centerId\s*\?\s*getPaymentConfigExact\(input\.centerId\)\s*:\s*null/);
  });

  it("[CTK-W4] banner cảnh báo ở tab Phương thức thanh toán dùng đúng phép đếm của đường dựng QR", () => {
    const src = doc("app/(admin)/admin/cau-hinh-van-hanh/_components/tab-phuong-thuc-tt.tsx");
    expect(src.match(/coTaiKhoanChungMoHo\(/g)?.length).toBe(1);
    expect(src).toContain("CAU_TAI_KHOAN_CHUNG_MO_HO");
  });
});
