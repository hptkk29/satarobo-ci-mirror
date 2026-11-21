import { describe, expect, it } from "vitest";
import {
  KHOA_MS,
  TOI_DA_LAN_SAI,
  chamNguongKhoa,
  dangBiKhoa,
  dongHoKhoa,
  giayConKhoa,
  khoaDaHet,
  lanThuConLai,
  laMaDeDoan,
  laMaDungKhuon,
  mocKhoaDen,
} from "./hv-ma-thuan";

const NAM_NAY = 2026;
const NAM_SINH_CON = [2016, 2018];
const hoi = (ma: string) => laMaDeDoan(ma, NAM_SINH_CON, NAM_NAY);

describe("mã thoát — khuôn mã", () => {
  it("[HVM-01] chỉ nhận đúng 4 chữ số", () => {
    expect(laMaDungKhuon("4827")).toBe(true);
    for (const x of ["482", "48273", "48a7", "", " 4827", "4 27", 4827, null, undefined]) expect(laMaDungKhuon(x)).toBe(false);
    expect(hoi("48a7")).toBe("SAI_KHUON");
  });
});

describe("mã thoát — mã dễ đoán", () => {
  it("[HVM-02] mã lặp một chữ số (0000…9999) và nhịp hai số lặp (1212) bị chặn", () => {
    for (const m of ["0000", "1111", "2222", "9999", "1212", "7878", "0101"]) expect(hoi(m)).toBe("DE_DOAN_LAP");
  });
  it("[HVM-03] dãy số tăng/giảm từng đơn vị bị chặn — cả chiều tăng lẫn giảm", () => {
    for (const m of ["1234", "0123", "6789", "4321", "9876", "3210"]) expect(hoi(m)).toBe("DE_DOAN_DAY_SO");
    // gần giống nhưng KHÔNG phải dãy ⇒ cho qua
    expect(hoi("1243")).toBeNull();
    expect(hoi("1235")).toBeNull();
  });
  it("[HVM-04] năm sinh của MỌI con và năm nay/năm ngoái bị chặn", () => {
    expect(hoi("2016")).toBe("DE_DOAN_NAM_SINH");
    expect(hoi("2018")).toBe("DE_DOAN_NAM_SINH");
    expect(hoi("2026")).toBe("DE_DOAN_NAM_SINH");
    expect(hoi("2025")).toBe("DE_DOAN_NAM_SINH");
    // năm sinh của một năm KHÔNG ai sinh ⇒ không chặn theo luật này
    expect(hoi("2019")).toBeNull();
    // đối chứng: mã khác năm sinh thì qua
    expect(laMaDeDoan("2016", [], NAM_NAY)).toBeNull();
  });
  it("[HVM-05] mã phổ biến của bàn phím bị chặn, mã ngẫu nhiên thì qua", () => {
    for (const m of ["2580", "1004", "2468", "1357"]) expect(hoi(m)).toBe("DE_DOAN_PHO_BIEN");
    for (const m of ["4827", "5903", "7314"]) expect(hoi(m)).toBeNull();
  });
});

describe("mã thoát — đếm sai và khoá", () => {
  it("[HVM-06] chạm ngưỡng đúng ở lần sai thứ 5, không sớm hơn", () => {
    expect(TOI_DA_LAN_SAI).toBe(5);
    expect(chamNguongKhoa(4)).toBe(false);
    expect(chamNguongKhoa(5)).toBe(true);
    expect(chamNguongKhoa(6)).toBe(true);
    expect(lanThuConLai(0)).toBe(5);
    expect(lanThuConLai(2)).toBe(3);
    expect(lanThuConLai(5)).toBe(0);
    expect(lanThuConLai(9)).toBe(0);
  });
  it("[HVM-07] khoá kéo dài 5 phút, hết giờ thì mở và được phép dọn bộ đếm", () => {
    const t0 = new Date("2026-11-02T10:00:00Z");
    const khoaDen = mocKhoaDen(t0);
    expect(khoaDen.getTime() - t0.getTime()).toBe(KHOA_MS);
    expect(KHOA_MS).toBe(5 * 60 * 1000);
    const dem = { soLanSai: 5, khoaDen };
    expect(dangBiKhoa(dem, new Date(t0.getTime() + 60_000))).toBe(true);
    expect(dangBiKhoa(dem, new Date(khoaDen.getTime() - 1))).toBe(true);
    // đúng mốc hết hạn: KHÔNG còn khoá (không để con chờ thừa 1 mili giây)
    expect(dangBiKhoa(dem, khoaDen)).toBe(false);
    expect(khoaDaHet(dem, khoaDen)).toBe(true);
    expect(khoaDaHet(dem, t0)).toBe(false);
    // chưa từng khoá ⇒ không khoá, cũng không "hết khoá"
    expect(dangBiKhoa({ soLanSai: 2, khoaDen: null }, t0)).toBe(false);
    expect(khoaDaHet({ soLanSai: 2, khoaDen: null }, t0)).toBe(false);
  });
  it("[HVM-08] đồng hồ đếm ngược: 299 giây là 04:59, không âm", () => {
    const t0 = new Date("2026-11-02T10:00:00Z");
    const khoaDen = mocKhoaDen(t0);
    expect(giayConKhoa(khoaDen, new Date(t0.getTime() + 1000))).toBe(299);
    expect(dongHoKhoa(299)).toBe("04:59");
    expect(dongHoKhoa(300)).toBe("05:00");
    expect(dongHoKhoa(0)).toBe("00:00");
    expect(dongHoKhoa(-5)).toBe("00:00");
    expect(giayConKhoa(null, t0)).toBe(0);
    expect(giayConKhoa(khoaDen, new Date(khoaDen.getTime() + 9999))).toBe(0);
  });
});
