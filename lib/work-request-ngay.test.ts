// Canh gác kiểm khoảng ngày của đơn từ — QA site GV vòng 1 (NV-005).
import { describe, expect, it } from "vitest";

import { kiemKhoangNgayDon } from "@/lib/work-request";

const d = (s: string) => new Date(`${s}T00:00:00+07:00`);

describe("kiemKhoangNgayDon", () => {
  it("thiếu ngày ⇒ chặn", () => {
    expect(kiemKhoangNgayDon("LEAVE", null, null)).toContain("Chọn ngày");
  });

  it("ngày không hợp lệ ⇒ chặn, không ném lỗi", () => {
    expect(kiemKhoangNgayDon("LEAVE", new Date("x"), null)).toContain("Chọn ngày");
  });

  it("loại MỘT NGÀY: chỉ cần fromDate, không đòi toDate", () => {
    expect(kiemKhoangNgayDon("LATE_EARLY", d("2026-08-28"), null)).toBe(null);
    expect(kiemKhoangNgayDon("SUB_TEACH", d("2026-08-28"), null)).toBe(null);
    expect(kiemKhoangNgayDon("TIMESHEET_FIX", d("2026-08-28"), null)).toBe(null);
  });

  it("loại CÓ KHOẢNG: to trước from ⇒ chặn (lỗ mà form không bịt được)", () => {
    expect(
      kiemKhoangNgayDon("LEAVE", d("2026-08-30"), d("2026-08-01")),
    ).toContain("không được trước");
  });

  it("loại CÓ KHOẢNG: to bằng from ⇒ hợp lệ (nghỉ một ngày)", () => {
    expect(kiemKhoangNgayDon("LEAVE", d("2026-08-28"), d("2026-08-28"))).toBe(null);
  });

  it("loại CÓ KHOẢNG: to sau from ⇒ hợp lệ", () => {
    expect(kiemKhoangNgayDon("LEAVE", d("2026-08-28"), d("2026-08-30"))).toBe(null);
  });

  it("loại CÓ KHOẢNG thiếu toDate ⇒ chặn", () => {
    expect(kiemKhoangNgayDon("LEAVE", d("2026-08-28"), null)).toContain(
      "Chọn ngày kết thúc",
    );
  });
});
