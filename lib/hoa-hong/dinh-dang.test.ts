// @vitest-environment node
// [NHH-FE-DD-*] — ĐỊNH DẠNG NGÀY của màn chính sách. Tất cả theo NGÀY LỊCH VN (không theo múi giờ máy chủ/trình duyệt):
// 00:00 VN của 01/11 lưu là 17:00Z ngày 31/10 — in bằng `toLocaleDateString` của máy chủ UTC sẽ ra "31/10", sai một ngày.
import { describe, expect, it } from "vitest";
import { khoangHieuLuc, khoangHieuLucNgan, ngayDMYTuMoc, ngayGioVN } from "./dinh-dang";

describe("[NHH-FE-DD-01] ngày VN", () => {
  it("ngayDMYTuMoc: 17:00Z hôm trước = ngày hôm sau theo giờ VN", () => {
    expect(ngayDMYTuMoc(new Date("2026-10-31T17:00:00.000Z"))).toBe("01/11/2026");
    expect(ngayDMYTuMoc(new Date("2026-10-31T16:59:59.000Z"))).toBe("31/10/2026");
  });

  it("ngayGioVN: dd/mm/yyyy hh:mm theo giờ VN", () => {
    expect(ngayGioVN(new Date("2026-10-08T03:05:00.000Z"))).toBe("08/10/2026 10:05");
    expect(ngayGioVN(new Date("2026-10-08T20:30:00.000Z"))).toBe("09/10/2026 03:30");
  });
});

describe("[NHH-FE-DD-02] khoangHieuLuc — effectiveTo là biên MỞ, in 'đến hết' ngày TRƯỚC đó", () => {
  it("có ngày kết thúc: effectiveTo = 00:00 VN 01/01 ⇒ 'đến hết 31/12'", () => {
    expect(khoangHieuLuc(new Date("2026-10-31T17:00:00.000Z"), new Date("2026-12-31T17:00:00.000Z"))).toBe("01/11/2026 → hết 31/12/2026");
  });

  it("không kết thúc ⇒ 'chưa kết thúc'", () => {
    expect(khoangHieuLuc(new Date("2026-10-31T17:00:00.000Z"), null)).toBe("01/11/2026 → chưa kết thúc");
  });
});

describe("[NHH-FE-DD-03] khoangHieuLucNgan — cho ô bảng", () => {
  it("chưa kết thúc ⇒ 'từ …'; có kết thúc ⇒ 'a → b' với b là ngày CUỐI còn áp dụng", () => {
    expect(khoangHieuLucNgan(new Date("2026-10-31T17:00:00.000Z"), null)).toBe("từ 01/11/2026");
    expect(khoangHieuLucNgan(new Date("2026-10-31T17:00:00.000Z"), new Date("2026-12-31T17:00:00.000Z"))).toBe("01/11/2026 → 31/12/2026");
  });
});
