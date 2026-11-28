// [CTPC-*] Vị từ "công tính theo phân công" — chủ dự án chốt 08/11/2026. Thuần, mốc tuyệt đối, mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";
import { chamTheoPhanCong } from "./cham-theo-phan-cong";

const MAC_DINH = SETTINGS["shift.parttimeLuatCongMoiTuKy"].default;

describe("chamTheoPhanCong", () => {
  it("[CTPC-01] mặc định registry = 2026-11-01 (chốt 08/11): PARTTIME từ 01/11 ⇒ theo phân công (đối chứng dương)", () => {
    expect(MAC_DINH).toBe("2026-11-01");
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-11-01", tuKy: MAC_DINH })).toBe(true);
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-11-07", tuKy: MAC_DINH })).toBe(true);
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2027-02-10", tuKy: MAC_DINH })).toBe(true);
  });
  it("[CTPC-02] PARTTIME TRƯỚC mốc ⇒ đường cũ (31/10 luôn cũ — sàn 01/11, kể cả cài đặt sớm hơn)", () => {
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-10-31", tuKy: MAC_DINH })).toBe(false);
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-10-31", tuKy: "2026-01-01" })).toBe(false);
    // Mốc dời giữa tháng ⇒ ngày trước mốc cũ, từ mốc mới.
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-11-14", tuKy: "2026-11-15" })).toBe(false);
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-11-15", tuKy: "2026-11-15" })).toBe(true);
  });
  it("[CTPC-03] FULLTIME có đứng lớp (và mọi loại khác / chưa khai) ⇒ GIỮ công ô ca, dù sau mốc (đối chứng âm)", () => {
    for (const c of ["FULLTIME", "INTERN", "FREELANCE", "THU_VIEC", "CHINH_THUC_XAC_DINH", null] as const)
      expect(chamTheoPhanCong({ contractType: c, ngay: "2026-11-05", tuKy: MAC_DINH })).toBe(false);
  });
  it("[CTPC-04] cài đặt để trống / hỏng ⇒ TẮT (không bao giờ đoán là bật)", () => {
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-11-05", tuKy: null })).toBe(false);
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "2026-11-05", tuKy: "2026-11-31" })).toBe(false);
    expect(chamTheoPhanCong({ contractType: "PARTTIME", ngay: "05/11/2026", tuKy: MAC_DINH })).toBe(false);
  });
});
