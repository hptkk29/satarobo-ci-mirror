import { describe, it, expect } from "vitest";
import type { CaNgay } from "./gv-kha-dung";
import { LY_DO_GV_DOI_CA, LY_DO_GV_NGHI, gvVangTaiCase, type NguonOCa } from "./gv-vang-case";

// Hình dạng thật của lưới: ca `S` 07:30–11:30, ca `C` 13:30–17:30, `P` nghỉ phép, `X` nghỉ.
const CA_SANG: CaNgay = {
  ma: "S",
  kind: "TIMED",
  centerId: "cs1",
  segments: [{ start: "07:30", end: "11:30", kind: "WORK" }],
};
const CA_CHIEU: CaNgay = {
  ma: "C",
  kind: "TIMED",
  centerId: "cs1",
  segments: [{ start: "13:30", end: "17:30", kind: "WORK" }],
};
const NGHI_PHEP: CaNgay = { ma: "P", kind: "LEAVE", centerId: "cs1", segments: [] };
const NGHI_X: CaNgay = { ma: "X", kind: "OFF", centerId: "cs1", segments: [] };
const KHONG_GIO: CaNgay = { ma: "D1", kind: "LOCATION_ONLY", centerId: "cs1", segments: [] };

const CASE_CHIEU = { startTime: "14:00", endTime: "15:00" };
const o = (nguon: NguonOCa, ca: CaNgay) => ({ nguon, ca });

describe("gvVangTaiCase", () => {
  it("[GVC-01] đơn nghỉ đã duyệt (ô P/X nguồn LEAVE) ⇒ case bị đánh dấu GV nghỉ", () => {
    for (const ca of [NGHI_PHEP, NGHI_X]) {
      expect(gvVangTaiCase({ o: o("LEAVE", ca), khung: CASE_CHIEU })).toEqual({
        vang: true,
        loai: "NGHI",
        lyDo: LY_DO_GV_NGHI,
      });
    }
  });

  it("[GVC-02] đổi ca đã duyệt sang ca KHÔNG phủ giờ case ⇒ đánh dấu đổi ca", () => {
    expect(gvVangTaiCase({ o: o("SWAP", CA_SANG), khung: CASE_CHIEU })).toEqual({
      vang: true,
      loai: "DOI_CA",
      lyDo: LY_DO_GV_DOI_CA,
    });
  });

  it("[GVC-03] đổi ca SANG đúng khung chứa giờ case ⇒ KHÔNG đánh dấu (đối chứng dương)", () => {
    expect(gvVangTaiCase({ o: o("SWAP", CA_CHIEU), khung: CASE_CHIEU })).toEqual({ vang: false });
  });

  it("[GVC-04] ⚠️ không có đơn nào đứng sau (ô từ khung tuần / sửa tay / import) ⇒ KHÔNG đánh dấu", () => {
    // Dữ liệu thiếu ≠ giáo viên nghỉ: đánh dấu theo nó là báo động giả hàng loạt.
    for (const nguon of ["PATTERN", "MANUAL", "IMPORT", "HOLIDAY"] as const) {
      expect(gvVangTaiCase({ o: o(nguon, NGHI_X), khung: CASE_CHIEU })).toEqual({ vang: false });
      expect(gvVangTaiCase({ o: o(nguon, CA_SANG), khung: CASE_CHIEU })).toEqual({ vang: false });
    }
    expect(gvVangTaiCase({ o: null, khung: CASE_CHIEU })).toEqual({ vang: false });
  });

  it("[GVC-05] mã ca không mang giờ ⇒ không kết luận được ⇒ không đánh dấu", () => {
    expect(gvVangTaiCase({ o: o("SWAP", KHONG_GIO), khung: CASE_CHIEU })).toEqual({ vang: false });
  });
});
