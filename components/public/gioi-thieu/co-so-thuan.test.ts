import { describe, expect, it } from "vitest";
import { SATA_ROBO_LOCATIONS, operationalLocations } from "@/lib/locations";
import { THONG_TIN_THEM_CO_SO, duongDanBanDo, gioMoCua, nhanCoSo, tenCoSoNgan } from "./co-so-thuan";

describe("[PUB-D-01] tên cơ sở ngắn", () => {
  it("bỏ tiền tố 'Cơ sở N - ' và giữ phần tên đường", () => {
    expect(tenCoSoNgan("Cơ sở 1 - Nguyễn Hữu Thọ")).toBe("Nguyễn Hữu Thọ");
    expect(tenCoSoNgan("Cơ sở 2 - Hoàng Diệu")).toBe("Hoàng Diệu");
  });
  it("tên không có tiền tố thì giữ nguyên", () => {
    expect(tenCoSoNgan("Hoàng Diệu")).toBe("Hoàng Diệu");
  });
});

describe("[PUB-D-02] liên kết bản đồ dựng từ địa chỉ thật", () => {
  it("mã hoá địa chỉ vào tham số query", () => {
    const url = duongDanBanDo("211 Nguyễn Hữu Thọ, Đà Nẵng");
    expect(url.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
    expect(decodeURIComponent(url.split("query=")[1] ?? "")).toBe("211 Nguyễn Hữu Thọ, Đà Nẵng");
  });
});

describe("[PUB-D-03] giờ mở cửa và nhãn cơ sở", () => {
  it("chuẩn hoá dấu gạch nhưng KHÔNG đổi giờ của repo", () => {
    expect(gioMoCua("T2 - T7: 8:00 - 20:00")).toBe("T2 – T7: 8:00 – 20:00");
  });
  it("nhãn từ mã cơ sở", () => {
    expect(nhanCoSo("CS1")).toBe("Cơ sở 1");
    expect(nhanCoSo("CS2")).toBe("Cơ sở 2");
  });
});

describe("[PUB-D-04] ảnh từng cơ sở", () => {
  it("mỗi cơ sở đang hoạt động đều có ảnh khai theo mã (không thì thẻ mất ảnh âm thầm)", () => {
    for (const loc of operationalLocations()) {
      expect(THONG_TIN_THEM_CO_SO[loc.code], `thiếu ảnh cho ${loc.code}`).toBeDefined();
    }
    expect(SATA_ROBO_LOCATIONS.length).toBeGreaterThan(0);
  });
});
