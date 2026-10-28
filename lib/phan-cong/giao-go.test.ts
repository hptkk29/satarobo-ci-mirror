// [PCG2-*] Luật thuần giao / gỡ GĐ2. Mốc tuyệt đối, không đồng hồ thật (luật 19); mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import { hetThangSau, lyDoKhongGiaoDuoc, ngayTheoPhamVi } from "./giao-go";

describe("ngayTheoPhamVi", () => {
  it("[PCG2-01] CHI_BUOI_NAY ⇒ đúng một ngày", () => {
    expect(ngayTheoPhamVi({ ngay: "2026-11-04", phamVi: "CHI_BUOI_NAY" })).toEqual(["2026-11-04"]);
  });
  it("[PCG2-02] CAC_TUAN_SAU ⇒ cùng thứ mỗi tuần tới hết tháng kế tiếp", () => {
    const r = ngayTheoPhamVi({ ngay: "2026-11-25", phamVi: "CAC_TUAN_SAU" });
    expect(r[0]).toBe("2026-11-25");
    expect(r.at(-1)).toBe("2026-12-30");
    expect(r).toHaveLength(6);
    for (const d of r) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(3);
  });
  it("[PCG2-03] hết tháng sau: qua năm và tháng 2", () => {
    expect(hetThangSau("2026-12-10")).toBe("2027-01-31");
    expect(hetThangSau("2027-01-31")).toBe("2027-02-28");
    expect(hetThangSau("2027-12-01")).toBe("2028-01-31");
  });
});

describe("lyDoKhongGiaoDuoc", () => {
  it("[PCG2-04] ngày đã qua ⇒ chặn; hôm nay và ngày tới ⇒ được (đối chứng)", () => {
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-03", homNay: "2026-11-04", trangThaiKy: null })).toMatch(/đã qua/);
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-04", homNay: "2026-11-04", trangThaiKy: null })).toBeNull();
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-05", homNay: "2026-11-04", trangThaiKy: "OPEN" })).toBeNull();
  });
  it("[PCG2-05] kỳ đã chốt ⇒ chặn", () => {
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-05", homNay: "2026-11-04", trangThaiKy: "LOCKED" })).toMatch(/đã chốt/);
  });
});
