// lib/ai-lead/dich-vu/san-sang-nguon.test.ts — phần THUẦN của cổng nguồn (không DB, không đồng hồ thật). Phần nối DB: tests/ai-lead/tao-lead.spec.ts [ATLD-NG*].
import { describe, expect, it } from "vitest";
import { danhGiaSanSangNguon } from "./san-sang-nguon";
import type { NguonDaChuanBi } from "@/lib/nguon/noi-day";

const co = (luat: string, groupCode: string): NguonDaChuanBi => ({ bat: true, ketQua: { luat, groupCode } as never, duLieu: {} as never, touchpoints: [], chanNhap: null });

describe("[SSN] danhGiaSanSangNguon — chỉ luật PAGE_MAPPING ra nhóm thật mới là «sẵn sàng»", () => {
  it("[SSN-01] PAGE_MAPPING + nhóm thật ⇒ sẵn sàng, mang mã nhóm", () => {
    expect(danhGiaSanSangNguon(co("PAGE_MAPPING", "MARKETING_HO"))).toEqual({ san: true, groupCode: "MARKETING_HO" });
  });
  it("[SSN-02] cờ nguồn tắt / chạy thử lỗi (bat:false) ⇒ KHÔNG sẵn sàng, mã NGUON_TAT_HOAC_LOI (fail-closed)", () => {
    expect(danhGiaSanSangNguon({ bat: false })).toEqual({ san: false, ma: "NGUON_TAT_HOAC_LOI" });
    expect(danhGiaSanSangNguon({ bat: false, loi: "lỗi giả" })).toEqual({ san: false, ma: "NGUON_TAT_HOAC_LOI" });
  });
  it("[SSN-03] rơi UNKNOWN (kể cả mang nhãn PAGE_MAPPING) hoặc luật khác (mặc định, kế thừa, chọn tay…) ⇒ KHÔNG sẵn sàng, PAGE_CHUA_GAN_NGUON", () => {
    for (const [luat, nhom] of [["UNKNOWN", "UNKNOWN"], ["PAGE_MAPPING", "UNKNOWN"], ["KE_THUA_SDT", "PAID_ADS"], ["DUONG_VAO_MAC_DINH", "WEB"], ["CHON_NGUON", "PAID_ADS"]] as const) {
      expect(danhGiaSanSangNguon(co(luat, nhom)), `${luat}/${nhom}`).toEqual({ san: false, ma: "PAGE_CHUA_GAN_NGUON" });
    }
  });
});
