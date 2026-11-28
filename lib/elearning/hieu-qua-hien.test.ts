import { describe, expect, it } from "vitest";
import { chuoiDiem, maTranTheoNguoi } from "./hieu-qua-hien";

const t = (d: number) => new Date(Date.UTC(2026, 10, d));

describe("[HQH-01] chuỗi điểm", () => {
  it("số / chuỗi / Decimal-giống ⇒ gọn, dấu phẩy; rỗng/không phải số ⇒ null", () => {
    expect(chuoiDiem("11.00")).toBe("11");
    expect(chuoiDiem(7)).toBe("7");
    expect(chuoiDiem({ toString: () => "8.50" })).toBe("8,5");
    expect(chuoiDiem(null)).toBeNull();
    expect(chuoiDiem(undefined)).toBeNull();
    expect(chuoiDiem("abc")).toBeNull();
  });
});

describe("[HQH-02] ma trận theo người: phiếu MỚI NHẤT của (người, mức); ô trống là null, không phải 0", () => {
  it("🔴 hai phiếu cùng mức ⇒ lấy phiếu mới hơn; mức chưa có phiếu ⇒ null; người khác không lẫn", () => {
    const m = maTranTheoNguoi([
      { subjectUserId: "a", level: "L2", score: "9", recordedAt: t(5) },
      { subjectUserId: "a", level: "L2", score: "11", recordedAt: t(10) },
      { subjectUserId: "a", level: "L1", score: "4", recordedAt: t(3) },
      { subjectUserId: "b", level: "L2", score: "7", recordedAt: t(2) },
    ]);
    const a = m.find((x) => x.userId === "a")!;
    expect(a.o.L2).toEqual({ diem: "11", luc: t(10) });
    expect(a.o.L1?.diem).toBe("4");
    expect(a.o.L3).toBeNull();
    expect(a.o.L4).toBeNull();
    expect(a.soPhieu).toBe(3);
    expect(m.find((x) => x.userId === "b")!.o.L2?.diem).toBe("7");
    expect(m).toHaveLength(2);
  });
  it("🔴 phiếu KHÔNG có điểm không chiếm ô (không biến thành 0); mức lạ không làm vỡ ma trận nhưng vẫn được đếm số phiếu", () => {
    const m = maTranTheoNguoi([
      { subjectUserId: "a", level: "L3", score: null, recordedAt: t(5) },
      { subjectUserId: "a", level: "L9", score: "5", recordedAt: t(6) },
    ]);
    expect(m[0]!.o.L3).toBeNull();
    expect(Object.values(m[0]!.o).every((o) => o === null)).toBe(true);
    expect(m[0]!.soPhieu).toBe(2);
  });
  it("điểm 0 là điểm thật (khác chưa có)", () => {
    const m = maTranTheoNguoi([{ subjectUserId: "a", level: "L2", score: "0", recordedAt: t(1) }]);
    expect(m[0]!.o.L2).toEqual({ diem: "0", luc: t(1) });
  });
});
