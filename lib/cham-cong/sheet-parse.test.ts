import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countCodes, normalizeCode, parseUnit, parseWorkbook, sheetTotalOf } from "./sheet-parse";
import { SHIFT_CODES } from "./catalog";

// Fixture = file Sheet thật tải 29/08/2026 (tests/fixtures/cham-cong). Các con số dưới đây đo
// tay bằng openpyxl ngày 05/09 — kế hoạch v3.3 §4 "15 con số lưới T09 phải khớp".
const FIXTURE = path.join(process.cwd(), "tests/fixtures/cham-cong/lich-phan-ca-2026-08-29.xlsx");
const wb = parseWorkbook(readFileSync(FIXTURE));

describe("parseWorkbook — Sheet lịch phân ca 29/08/2026", () => {
  it("không cảnh báo, có đủ 5 lưới tháng T08→T12", () => {
    expect(wb.warnings).toEqual([]);
    expect(wb.months.map((m) => m.periodKey)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  });

  it("KHUNG CA: 20 dòng, 19 người (Mr Phúc 2 dòng CS1 + CS2), Ms Huệ LD Thứ Hai + CN", () => {
    expect(wb.khungCa).toHaveLength(20);
    const phuc = wb.khungCa.filter((r) => r.displayName === "Mr Phúc");
    expect(phuc.map((r) => r.unit)).toEqual(["CS1", "CS2"]);
    expect(phuc[0].byWeekday).toEqual({ 1: "X", 2: "D2", 3: "CG", 4: "D2", 5: "CG", 6: "D2", 0: "CCT" });
    const hue = wb.khungCa.find((r) => r.displayName === "Ms Huệ")!;
    expect(hue.unit).toBe("HO");
    expect(hue.byWeekday[1]).toBe("LD");
    expect(hue.byWeekday[0]).toBe("LD");
    // Thứ Hai toàn Trung tâm nghỉ (trừ Ms Huệ)
    expect(wb.khungCa.filter((r) => r.byWeekday[1] !== "X").map((r) => r.displayName)).toEqual(["Ms Huệ"]);
    // "—" và ô trống → null
    const khoi = wb.khungCa.find((r) => r.displayName === "Thầy Khôi")!;
    expect(khoi.fullName).toBe("Lê Khôi");
    expect(khoi.byWeekday[4]).toBeNull();
  });

  it("LỊCH T09-2026: 20 người, 30 ngày, đúng 15 con số + X = 120", () => {
    const t9 = wb.months.find((m) => m.periodKey === "2026-09")!;
    expect(t9.daysInMonth).toBe(30);
    expect(t9.rows).toHaveLength(20);
    expect(t9.unknownUnitRows).toEqual([]);
    expect(countCodes(t9)).toEqual({
      X: 120, HC: 92, CG: 40, SC: 36, CCT: 32, T: 32, CT: 32, S: 28,
      CS: 24, C: 20, CGD: 20, D2: 12, D1: 12, ST: 8, LD: 8,
    });
    // Mọi mã trên lưới đều thuộc danh mục 21 mã
    for (const code of Object.keys(countCodes(t9))) expect(SHIFT_CODES).toContain(code);
  });

  it("Tổng công / Nghỉ trên Sheet = số ô có mã trừ X,P — khớp cột Sheet cho từng người", () => {
    const t9 = wb.months.find((m) => m.periodKey === "2026-09")!;
    for (const r of t9.rows) {
      const { total, off } = sheetTotalOf(r);
      expect(total, r.name).toBe(r.totalOnSheet);
      expect(off, r.name).toBe(r.offOnSheet);
    }
  });

  it("T09: 1/9 và 2/9 là X cho mọi người (lễ Quốc khánh), Ms Huệ LD ngày 7/9 (Thứ Hai)", () => {
    const t9 = wb.months.find((m) => m.periodKey === "2026-09")!;
    for (const r of t9.rows) {
      expect(r.cells[1], r.name).toBe("X");
      expect(r.cells[2], r.name).toBe("X");
    }
    const hue = t9.rows.find((r) => r.name === "Ms Huệ")!;
    expect(hue.cells[7]).toBe("LD");
    const phucCs1 = t9.rows.find((r) => r.name === "Mr Phúc" && r.unit === "CS1")!;
    expect(phucCs1.cells[3]).toBe("D2"); // Thứ Năm 3/9: làm tại CS2 (ô con trỏ)
  });

  it("DANH MỤC CA: 21 mã đúng thứ tự danh mục", () => {
    expect(wb.danhMucCa.map((r) => r.code)).toEqual([...SHIFT_CODES]);
    expect(wb.danhMucCa.find((r) => r.code === "CS")!.note).toMatch(/16:30–17:00/);
  });

  it("VIỆC CỐ ĐỊNH: 12 dòng (6 thứ × 2 cơ sở); GHI CHÚ: 9 dòng lễ 1/9, 2/9, 24/11 × 3 đơn vị, đều 'Không gửi tin'", () => {
    expect(wb.viecCoDinh).toHaveLength(12);
    expect(wb.viecCoDinh.filter((v) => v.unit === "CS1").map((v) => v.weekday)).toEqual([2, 3, 4, 5, 6, 0]);
    expect(wb.ghiChu).toHaveLength(9);
    expect(new Set(wb.ghiChu.map((g) => g.date))).toEqual(new Set(["2026-09-01", "2026-09-02", "2026-11-24"]));
    expect(wb.ghiChu.every((g) => g.suppress && !g.replaceAll && g.personName === null)).toBe(true);
  });
});

describe("parseUnit / normalizeCode", () => {
  it("đơn vị", () => {
    expect(parseUnit("Cơ sở 1")).toBe("CS1");
    expect(parseUnit(" cơ sở  2 ")).toBe("CS2");
    expect(parseUnit("HO")).toBe("HO");
    expect(parseUnit("Hội sở")).toBe("HO");
    expect(parseUnit("Cơ sở 3")).toBeNull();
    expect(parseUnit("")).toBeNull();
  });
  it("mã ca", () => {
    expect(normalizeCode(" sc ")).toBe("SC");
    expect(normalizeCode("—")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(12)).toBe("12");
  });
});
