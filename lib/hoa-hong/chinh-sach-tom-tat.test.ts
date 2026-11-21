// @vitest-environment node
// [NHH-FE-TS-*] — TÓM TẮT một chính sách để vẽ MỘT dòng bảng: chọn phiên bản "hiện hành" và gộp tỉ lệ theo loại giao dịch.
// Dòng bảng nói về chính sách, mà một chính sách có nhiều phiên bản; chọn nhầm phiên bản là bảng báo "đang áp dụng 4%" khi
// bản 4% đã bị thay. Thứ tự ưu tiên là luật, không phải thẩm mỹ.
import { describe, expect, it } from "vitest";
import { chonPhienBanHienHanh, locChinhSach, tomTatTiLe, type PhienBanTomTat } from "./chinh-sach-tom-tat";

const NOW = new Date("2026-10-08T03:00:00.000Z");
const v = (versionNo: number, status: PhienBanTomTat["status"], from: string, to: string | null = null): PhienBanTomTat => ({
  versionId: `v${versionNo}`,
  versionNo,
  status,
  effectiveFrom: new Date(from),
  effectiveTo: to ? new Date(to) : null,
});

describe("[NHH-FE-TS-01] chonPhienBanHienHanh", () => {
  it("ưu tiên: đang áp dụng > chờ hiệu lực > nháp mới nhất > bản cũ mới nhất > đã huỷ", () => {
    const dang = v(2, "ACTIVE", "2026-09-01T00:00:00Z");
    const cho = v(3, "ACTIVE", "2026-11-01T00:00:00Z");
    const nhap = v(4, "DRAFT", "2026-12-01T00:00:00Z");
    const cu = v(1, "SUPERSEDED", "2026-01-01T00:00:00Z", "2026-09-01T00:00:00Z");
    const huy = v(5, "CANCELLED", "2026-12-01T00:00:00Z");
    expect(chonPhienBanHienHanh([cu, dang, cho, nhap, huy], NOW)?.versionNo).toBe(2);
    expect(chonPhienBanHienHanh([cu, cho, nhap, huy], NOW)?.versionNo).toBe(3);
    expect(chonPhienBanHienHanh([cu, nhap, huy], NOW)?.versionNo).toBe(4);
    expect(chonPhienBanHienHanh([cu, huy], NOW)?.versionNo).toBe(1);
    expect(chonPhienBanHienHanh([huy], NOW)?.versionNo).toBe(5);
    expect(chonPhienBanHienHanh([], NOW)).toBeNull();
  });

  it("nhiều nháp ⇒ nháp có versionNo cao nhất; nhiều bản cũ ⇒ bản cũ có versionNo cao nhất", () => {
    expect(chonPhienBanHienHanh([v(2, "DRAFT", "2026-12-01T00:00:00Z"), v(3, "DRAFT", "2026-12-01T00:00:00Z")], NOW)?.versionNo).toBe(3);
    expect(
      chonPhienBanHienHanh(
        [v(1, "EXPIRED", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"), v(2, "SUPERSEDED", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z")],
        NOW,
      )?.versionNo,
    ).toBe(2);
  });

  it("ACTIVE đã quá effectiveTo (chưa ai đóng) KHÔNG được chọn như đang áp dụng", () => {
    const het = v(1, "ACTIVE", "2026-01-01T00:00:00Z", "2026-09-01T00:00:00Z");
    expect(chonPhienBanHienHanh([het, v(2, "DRAFT", "2026-12-01T00:00:00Z")], NOW)?.versionNo).toBe(2);
  });

  // Cấy 08/10 (rà soát độc lập): `effectiveTo > now` → `>=` XANH — ca trên đặt effectiveTo cách now cả tháng, không ca nào đúng biên.
  // Biên PHẢI MỞ (khớp `chonQuyTac`): tại đúng `effectiveTo` bản đã hết. Cần một bản thứ hai để biên lộ ra: không có nó, bản vừa hết
  // vẫn được chọn ở nhánh "bản cũ" và hai cách viết cho cùng kết quả.
  it("biên MỞ: ACTIVE có effectiveTo ĐÚNG bằng now đã hết (nhường nháp); trước effectiveTo 1 ms thì còn đang áp dụng", () => {
    const nhap = v(2, "DRAFT", "2026-12-01T00:00:00Z");
    expect(chonPhienBanHienHanh([v(1, "ACTIVE", "2026-01-01T00:00:00Z", NOW.toISOString()), nhap], NOW)?.versionNo).toBe(2);
    expect(chonPhienBanHienHanh([v(1, "ACTIVE", "2026-01-01T00:00:00Z", new Date(NOW.getTime() + 1).toISOString()), nhap], NOW)?.versionNo).toBe(1);
  });
});

describe("[NHH-FE-TS-02] tomTatTiLe — tổng % mỗi loại giao dịch, đúng số nguyên", () => {
  it("cộng micro, không trôi: 4 + 1 + 2 + 1 + 1 = 9; RENEWAL riêng", () => {
    const r = tomTatTiLe([
      { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.04" },
      { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.010000" },
      { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.02" },
      { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.01" },
      { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.01" },
      { transactionTypeCode: "RENEWAL", calcKind: "PERCENT", rate: "0.0125" },
    ]);
    expect(r).toEqual([
      { loai: "NEW", tongPhanTram: "9", khongTinDuoc: false },
      { loai: "RENEWAL", tongPhanTram: "1,25", khongTinDuoc: false },
    ]);
  });

  it("rule EXCLUDE góp 0; kiểu cố định / thưởng bậc làm tổng 'chưa đủ' (khongTinDuoc) thay vì lặng lẽ bỏ", () => {
    const r = tomTatTiLe([
      { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.04" },
      { transactionTypeCode: "NEW", calcKind: "EXCLUDE", rate: null },
      { transactionTypeCode: "NEW", calcKind: "TIER_PERIOD_BONUS", rate: null },
    ]);
    expect(r).toEqual([{ loai: "NEW", tongPhanTram: "4", khongTinDuoc: true }]);
  });

  it("không rule ⇒ mảng rỗng; thứ tự NEW rồi RENEWAL", () => {
    expect(tomTatTiLe([])).toEqual([]);
    expect(
      tomTatTiLe([
        { transactionTypeCode: "RENEWAL", calcKind: "PERCENT", rate: "0.01" },
        { transactionTypeCode: "NEW", calcKind: "PERCENT", rate: "0.02" },
      ]).map((x) => x.loai),
    ).toEqual(["NEW", "RENEWAL"]);
  });
});

describe("[NHH-FE-TS-03] locChinhSach — bộ lọc trên URL", () => {
  const dong = [
    { policyCode: "A", khoa: "DANG_AP_DUNG", vai: [{ code: "SALE" }, { code: "MARKETING" }], coBanNhap: null },
    { policyCode: "B", khoa: "NHAP", vai: [{ code: "SALE" }], coBanNhap: { versionNo: 2 } },
    { policyCode: "C", khoa: "HET_HIEU_LUC", vai: [{ code: "CENTER_MANAGER" }], coBanNhap: null },
  ];
  it("lọc theo trạng thái và vai; 'nhap' lấy cả chính sách đang áp dụng nhưng có bản nháp kèm theo", () => {
    expect(locChinhSach(dong, { trangThai: "dang-ap-dung", vai: null }).map((x) => x.policyCode)).toEqual(["A"]);
    expect(locChinhSach(dong, { trangThai: null, vai: "SALE" }).map((x) => x.policyCode)).toEqual(["A", "B"]);
    expect(locChinhSach(dong, { trangThai: "het-hieu-luc", vai: "SALE" })).toEqual([]);
    expect(locChinhSach(dong, { trangThai: null, vai: null })).toHaveLength(3);
    expect(
      locChinhSach([...dong, { policyCode: "D", khoa: "DANG_AP_DUNG", vai: [{ code: "SALE" }], coBanNhap: { versionNo: 3 } }], { trangThai: "nhap", vai: null }).map(
        (x) => x.policyCode,
      ),
    ).toEqual(["B", "D"]);
  });
});
