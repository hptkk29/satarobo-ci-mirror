/**
 * Ca [HSO-*] — phép tính thuần của màn "Hồ sơ học viên" [25/09/2026].
 *
 * Ghi chú đồng hồ (luật 19): `tinhTuoi` BẮT BUỘC nhận `now` — ca dưới truyền mốc cố định,
 * không bao giờ đọc giờ thật. Bộ test chạy TZ=UTC (vitest.config.ts) nên mọi phép theo
 * lịch VN ở đây phải tự ghim +07, không dựa vào máy.
 */
import { describe, expect, it } from "vitest";
import {
  NHAN_GHI_DANH,
  laGhiDanhDangHoc,
  laLinkMoDuoc,
  ngayChoONhap,
  ngayNhapHoc,
  phanTramDaHoc,
  tinhTuoi,
} from "./nhan-ho-so";

describe("tinhTuoi", () => {
  const sinh = new Date("2016-05-10T00:00:00Z");

  it("[HSO-01] chưa tới sinh nhật trong năm ⇒ trừ một tuổi; tới rồi ⇒ đủ tuổi", () => {
    expect(tinhTuoi(sinh, new Date("2026-05-09T10:00:00Z"))).toBe(9);
    expect(tinhTuoi(sinh, new Date("2026-05-10T10:00:00Z"))).toBe(10);
    expect(tinhTuoi(sinh, new Date("2026-12-31T10:00:00Z"))).toBe(10);
    // Theo lịch VN: 17:30Z ngày 09/05 đã là 00:30 ngày 10/05 ở VN ⇒ tròn 10 tuổi.
    expect(tinhTuoi(sinh, new Date("2026-05-09T17:30:00Z"))).toBe(10);
  });

  it("[HSO-01b] không có ngày sinh / ngày sinh ở tương lai ⇒ null (không in '-1 tuổi')", () => {
    expect(tinhTuoi(null, new Date("2026-09-25T00:00:00Z"))).toBeNull();
    expect(tinhTuoi(new Date("2030-01-01T00:00:00Z"), new Date("2026-09-25T00:00:00Z"))).toBeNull();
  });
});

describe("ngayChoONhap — giá trị ô date theo LỊCH VN", () => {
  it("[HSO-02] ngày lưu lúc 00:00 giờ VN (= 17:00Z hôm trước) ⇒ ô hiện ĐÚNG ngày, không lùi một ngày", () => {
    // Mốc import Excel / convert: 00:00 ngày 10/05 giờ VN.
    expect(ngayChoONhap(new Date("2016-05-09T17:00:00Z"))).toBe("2016-05-10");
  });

  it("[HSO-02b] ngày lưu từ chính form (00:00Z) ⇒ vẫn đúng ngày đó — không làm lệch dữ liệu đang đúng", () => {
    expect(ngayChoONhap(new Date("2016-05-10T00:00:00Z"))).toBe("2016-05-10");
    expect(ngayChoONhap("2016-05-10T00:00:00.000Z")).toBe("2016-05-10");
    expect(ngayChoONhap(null)).toBe("");
    expect(ngayChoONhap("không-phải-ngày")).toBe("");
  });
});

describe("ngayNhapHoc", () => {
  it("[HSO-03] lấy ghi danh SỚM NHẤT bất kể thứ tự đầu vào; rỗng ⇒ null", () => {
    const a = new Date("2025-09-01T01:00:00Z");
    const b = new Date("2024-06-15T01:00:00Z");
    const c = new Date("2026-01-10T01:00:00Z");
    expect(ngayNhapHoc([{ enrolledAt: a }, { enrolledAt: b }, { enrolledAt: c }])).toEqual(b);
    expect(ngayNhapHoc([])).toBeNull();
  });
});

describe("laLinkMoDuoc — lớp thứ hai trước khi in thành <a href>", () => {
  it("[HSO-04] chỉ http(s); javascript:/data:/chuỗi trần ⇒ KHÔNG", () => {
    expect(laLinkMoDuoc("https://www.facebook.com/minh.nguyen.549")).toBe(true);
    expect(laLinkMoDuoc("http://facebook.com/abc")).toBe(true);
    expect(laLinkMoDuoc("javascript:alert(1)")).toBe(false);
    expect(laLinkMoDuoc("data:text/html,<script>")).toBe(false);
    expect(laLinkMoDuoc("facebook.com/abc")).toBe(false);
    expect(laLinkMoDuoc("https://face book.com")).toBe(false);
    expect(laLinkMoDuoc(null)).toBe(false);
  });
});

describe("nhãn + thanh tiến độ", () => {
  it("[HSO-05] ACTIVE mặc định của convert đọc là 'Đang học'; PAUSED KHÔNG thuộc khối lớp đang học", () => {
    expect(NHAN_GHI_DANH.ACTIVE.nhan).toBe("Đang học");
    expect(laGhiDanhDangHoc("ACTIVE")).toBe(true);
    expect(laGhiDanhDangHoc("CONFIRMED")).toBe(true);
    expect(laGhiDanhDangHoc("PAUSED")).toBe(false);
    expect(laGhiDanhDangHoc("COMPLETED")).toBe(false);
  });

  it("[HSO-06] phần trăm kẹp 0–100; khoá chưa có giáo trình ⇒ null (không vẽ thanh rỗng giả)", () => {
    expect(phanTramDaHoc(6, 12)).toBe(50);
    expect(phanTramDaHoc(14, 12)).toBe(100);
    expect(phanTramDaHoc(3, 0)).toBeNull();
  });
});
