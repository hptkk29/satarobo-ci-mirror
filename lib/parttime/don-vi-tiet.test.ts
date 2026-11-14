// [Q1T-*] Q1 — chọn ghi đè số tiết + số tiết của một buổi (`don-vi-tiet.ts`, thuần).
import { describe, expect, it } from "vitest";
import { donViTiet, ghiDeChoBuoi, type GhiDeDonVi, type KhoaBuoi } from "./don-vi-tiet";

const g = (p: Partial<GhiDeDonVi>): GhiDeDonVi => ({
  id: "x",
  scopeType: "CLASS",
  scopeId: "lop1",
  effectiveFrom: "2026-10-15",
  effectiveTo: null,
  teachingDurationMinutes: null,
  teachingUnits: "0.67",
  policyVersionId: "pv238",
  ...p,
});
const K: KhoaBuoi = { sessionId: "s1", classId: "lop1", courseId: "k1", sessionType: "BU" };

describe("[Q1T] Q1 — số tiết của một buổi", () => {
  it("[Q1T-01] lọc ghi đè: đúng phạm vi + còn hiệu lực + đúng bản chính sách", () => {
    const ds = [
      g({ id: "a" }),
      g({ id: "lopKhac", scopeId: "lop2" }),
      g({ id: "het", effectiveTo: "2026-10-31" }),
      g({ id: "chua", effectiveFrom: "2026-12-01" }),
      g({ id: "csKhac", policyVersionId: "legacy" }),
      g({ id: "kh", scopeType: "COURSE", scopeId: "k1" }),
      g({ id: "lb", scopeType: "SESSION_TYPE", scopeId: "BU" }),
      g({ id: "b", scopeType: "SESSION", scopeId: "s1" }),
    ];
    expect(ghiDeChoBuoi(ds, K, "2026-11-07", "pv238").map((x) => x.id).sort()).toEqual(["a", "b", "kh", "lb"]);
    expect(ghiDeChoBuoi(ds, K, "2026-11-07", null)).toEqual([]);
    expect(ghiDeChoBuoi(ds, { sessionId: null, classId: null, courseId: null, sessionType: null }, "2026-11-07", "pv238")).toEqual([]);
  });

  it("[Q1T-02] ưu tiên: SESSION > CLASS > COURSE > SESSION_TYPE", () => {
    const ds = [g({ id: "lb", scopeType: "SESSION_TYPE", teachingUnits: "0.50" }), g({ id: "kh", scopeType: "COURSE", teachingUnits: "0.60" }), g({ id: "lop", teachingUnits: "0.67" })];
    expect(donViTiet({ thoiLuongDayPhut: 60, chuanDayPhut: 90, ghiDe: ds })).toEqual({ trangThai: "GHI_DE", donVi: "0.67", ghiDeId: "lop" });
    expect(donViTiet({ thoiLuongDayPhut: 60, chuanDayPhut: 90, ghiDe: [...ds, g({ id: "ss", scopeType: "SESSION", teachingUnits: "1.00" })] })).toMatchObject({ ghiDeId: "ss", donVi: "1.00" });
  });

  it("[Q1T-03] cùng hạng: dòng khai ĐÚNG thời lượng thắng dòng 'mọi thời lượng'; hai dòng ngang nhau ⇒ xung đột ⇒ NEEDS_POLICY_DECISION", () => {
    expect(donViTiet({ thoiLuongDayPhut: 60, chuanDayPhut: 90, ghiDe: [g({ id: "moi" }), g({ id: "dung", teachingDurationMinutes: 60, teachingUnits: "0.70" })] })).toMatchObject({ ghiDeId: "dung", donVi: "0.70" });
    expect(donViTiet({ thoiLuongDayPhut: 60, chuanDayPhut: 90, ghiDe: [g({ id: "a" }), g({ id: "b", teachingUnits: "0.50" })] })).toEqual({
      trangThai: "NEEDS_POLICY_DECISION",
      donVi: null,
      ghiDeId: null,
      lyDo: "GHI_DE_XUNG_DOT",
    });
  });

  it("[Q1T-04] buổi chuẩn ⇒ '1' bất kể ghi đè; lệch chuẩn không ghi đè ⇒ NEEDS_POLICY_DECISION (không tỉ lệ 60/90 hay 60/100)", () => {
    expect(donViTiet({ thoiLuongDayPhut: 90, chuanDayPhut: 90, ghiDe: [g({ teachingUnits: "3.00" })] })).toEqual({ trangThai: "CHUAN", donVi: "1", ghiDeId: null });
    for (const phut of [30, 45, 60, 75, 100, 120, 150]) {
      expect(donViTiet({ thoiLuongDayPhut: phut, chuanDayPhut: 90, ghiDe: [] }), String(phut)).toEqual({
        trangThai: "NEEDS_POLICY_DECISION",
        donVi: null,
        ghiDeId: null,
        lyDo: "THOI_LUONG_LECH_CHUAN",
      });
    }
  });
});
