import { describe, expect, it } from "vitest";
import { TOI_DA_NGAY_CHO_TU_XUAT, conTrongHanTuXuat, denGioTuXuat, gioTuXuat, kiemSoGio, lyDoBoQuaTuXuat } from "./chon-lan-thu";

// [TX-*] — khi nào và lần thu nào được TỰ xuất sau n giờ kể từ lúc phụ huynh điền form QR (BGĐ 03/11/2026). Luật ở `chon-lan-thu.ts`.

const GUI = new Date("2026-11-03T03:00:00.000Z");
const gio = (n: number) => new Date(GUI.getTime() + n * 3_600_000);

describe("[TX-01] giờ tự xuất = lần gửi cuối + n giờ", () => {
  it("n = 2: chưa tới giờ trước mốc, tới giờ ĐÚNG mốc và sau mốc (đối chứng hai phía)", () => {
    expect(gioTuXuat(GUI, 2).toISOString()).toBe("2026-11-03T05:00:00.000Z");
    expect(denGioTuXuat(GUI, 2, new Date(gio(2).getTime() - 1))).toBe(false);
    expect(denGioTuXuat(GUI, 2, gio(2))).toBe(true);
    expect(denGioTuXuat(GUI, 2, gio(5))).toBe(true);
  });
  it("PH gửi LẠI ⇒ mốc dời theo lần gửi cuối (gửi lúc 04:00 thì 05:00 chưa tới giờ nữa)", () => {
    const lanHai = gio(1);
    expect(denGioTuXuat(GUI, 2, gio(2))).toBe(true);
    expect(denGioTuXuat(lanHai, 2, gio(2))).toBe(false);
    expect(denGioTuXuat(lanHai, 2, gio(3))).toBe(true);
  });
  it("số giờ phải là số nguyên dương: 0, âm, lẻ, NaN đều ném (cấu hình hỏng không được thành «xuất ngay»)", () => {
    for (const x of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => kiemSoGio(x), String(x)).toThrow(RangeError);
      expect(() => gioTuXuat(GUI, x), String(x)).toThrow(RangeError);
      expect(() => denGioTuXuat(GUI, x, GUI), String(x)).toThrow(RangeError);
    }
    expect(kiemSoGio(1)).toBe(1);
    expect(kiemSoGio(48)).toBe(48);
  });
});

describe("[TX-02] hạn chờ tối đa: yêu cầu gửi quá lâu mà chưa xuất được thì ngừng tự xuất", () => {
  it(`đúng ${TOI_DA_NGAY_CHO_TU_XUAT} ngày vẫn còn; quá 1 mili giây là hết`, () => {
    const han = TOI_DA_NGAY_CHO_TU_XUAT * 86_400_000;
    expect(conTrongHanTuXuat(GUI, new Date(GUI.getTime() + han))).toBe(true);
    expect(conTrongHanTuXuat(GUI, new Date(GUI.getTime() + han + 1))).toBe(false);
    expect(conTrongHanTuXuat(GUI, GUI)).toBe(true);
  });
});

describe("[TX-03] chọn lần thu: mỗi mã lý do MỘT điều kiện, có đối chứng dương", () => {
  const ok = { ngan: "cho", phatHanhHien: true, coNgoaiLe: false, khoanIds: ["p1", "p2"] };
  const bc = { khoanChuaXacNhan: new Set<string>() };
  it("lần thu đủ điều kiện ⇒ null (tự xuất)", () => {
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
  it("còn MỘT khoản chưa xác nhận (dù khoản kia đã xác nhận) ⇒ KHOAN_CHUA_XAC_NHAN; không có khoản nào ⇒ cũng bỏ qua (không tự xuất lần thu rỗng)", () => {
    expect(lyDoBoQuaTuXuat(ok, { khoanChuaXacNhan: new Set(["p2"]) })).toBe("KHOAN_CHUA_XAC_NHAN");
    expect(lyDoBoQuaTuXuat({ ...ok, khoanIds: [] }, bc)).toBe("KHOAN_CHUA_XAC_NHAN");
    // Đối chứng: khoản chưa xác nhận của ĐƠN KHÁC (không thuộc lần thu này) không cản.
    expect(lyDoBoQuaTuXuat(ok, { khoanChuaXacNhan: new Set(["khac"]) })).toBeNull();
  });
  it("thứ tự nguyên nhân gốc trước: ngăn → nút → ngoại lệ → tiền", () => {
    const xau = { ngan: "da-xuat", phatHanhHien: false, coNgoaiLe: true, khoanIds: [] as string[] };
    expect(lyDoBoQuaTuXuat(xau, bc)).toBe("NGAN_KHAC");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho" }, bc)).toBe("KHONG_PHAT_HANH_DUOC");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho", phatHanhHien: true }, bc)).toBe("NGOAI_LE");
    expect(lyDoBoQuaTuXuat({ ...xau, ngan: "cho", phatHanhHien: true, coNgoaiLe: false }, bc)).toBe("KHOAN_CHUA_XAC_NHAN");
  });
});
