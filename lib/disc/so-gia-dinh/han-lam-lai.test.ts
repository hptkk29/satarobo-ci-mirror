import { describe, expect, it } from "vitest";

import { congThangYmd, duXaDeSoSanh, hanCaNha, hanCuaMotNguoi } from "./han-lam-lai";

describe("hạn làm lại (doc 18, 7.1)", () => {
  it("[SG-HL-01] cộng 6 tháng theo lịch: 31/08 ⇒ 28/02 (cuối tháng), năm nhuận ⇒ 29/02, qua năm", () => {
    expect(congThangYmd("2026-08-31", 6)).toBe("2027-02-28");
    expect(congThangYmd("2027-08-31", 6)).toBe("2028-02-29");
    expect(congThangYmd("2026-11-02", 6)).toBe("2027-05-02");
    expect(congThangYmd("2026-12-15", 6)).toBe("2027-06-15");
    expect(congThangYmd("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("[SG-HL-02] không có bài ⇒ KHÔNG bịa hạn; còn ngày / đúng hôm nay / quá hạn", () => {
    expect(hanCuaMotNguoi({ id: "a", ten: "A" }, null, "2026-11-02")).toBeNull();
    expect(hanCuaMotNguoi({ id: "a", ten: "A" }, "2026-11-02", "2026-11-02")).toMatchObject({ ngayDen: "2027-05-02", conNgay: 181, denHan: false });
    expect(hanCuaMotNguoi({ id: "a", ten: "A" }, "2026-05-02", "2026-11-02")).toMatchObject({ conNgay: 0, denHan: true });
    expect(hanCuaMotNguoi({ id: "a", ten: "A" }, "2026-04-02", "2026-11-02")).toMatchObject({ conNgay: -31, denHan: true });
  });

  it("[SG-HL-03] cả nhà lấy hạn SỚM NHẤT + danh sách người đã đến hạn", () => {
    const h = hanCaNha(
      [
        { id: "a", ten: "A", ngayLamYmd: "2026-10-30" },
        { id: "b", ten: "B", ngayLamYmd: "2026-03-01" },
        { id: "c", ten: "C", ngayLamYmd: null },
      ],
      "2026-11-02",
    )!;
    expect(h.som.id).toBe("b");
    expect(h.tatCa.map((x) => x.id)).toEqual(["b", "a"]);
    expect(h.nguoiDenHan.map((x) => x.id)).toEqual(["b"]);
    expect(hanCaNha([{ id: "c", ten: "C", ngayLamYmd: null }], "2026-11-02")).toBeNull();
  });

  it("[SG-HL-04] so hai mốc chỉ khi cách nhau ≥ 90 ngày", () => {
    expect(duXaDeSoSanh("2026-08-01", "2026-10-30")).toBe(true); // 90 ngày
    expect(duXaDeSoSanh("2026-08-01", "2026-10-29")).toBe(false);
  });
});
