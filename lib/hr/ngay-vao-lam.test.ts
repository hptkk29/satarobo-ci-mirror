import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { boMocUnix, ngayVaoLamHopLe } from "./ngay-vao-lam";
import { employeeUpdateSchema } from "@/lib/validators/employee";

const GOC = join(__dirname, "..", "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

describe("boMocUnix — loại mốc Unix khỏi ngày công việc", () => {
  it("1970-01-01 → null (NULL bị ghi thành 0, không phải ngày thật)", () => {
    expect(boMocUnix(new Date("1970-01-01T00:00:00Z"))).toBeNull();
    expect(boMocUnix(new Date(0))).toBeNull();
  });

  it("ngày thật giữ nguyên", () => {
    const d = new Date("2025-11-24T00:00:00Z");
    expect(boMocUnix(d)?.toISOString()).toBe(d.toISOString());
  });

  it("null / undefined / ngày hỏng → null", () => {
    expect(boMocUnix(null)).toBeNull();
    expect(boMocUnix(undefined)).toBeNull();
    expect(boMocUnix(new Date("xxx"))).toBeNull();
  });

  it("ngayVaoLamHopLe là cùng một cổng", () => {
    expect(ngayVaoLamHopLe(new Date(0))).toBeNull();
  });
});

// ── Đường GHI: form nhân sự ─────────────────────────────────────────────────
//
// Form đọc 1970 ra ô ngày rồi GHI LẠI NGUYÊN XI khi ai đó mở-và-lưu. Dọn dữ liệu mà
// không vá đây thì mốc 1970 quay lại ở lượt sửa hồ sơ kế tiếp.
describe("validator nhân sự chặn mốc Unix ở NGÀY CÔNG VIỆC", () => {
  // `employeeUpdateSchema` là `.partial()` — parse thẳng đúng trường đang kiểm, không
  // kéo theo trường khác (chúng có ràng buộc riêng và sẽ che mất thứ ta muốn đo).
  const nen = {};

  it("joinedAt = 1970-01-01 → null", () => {
    const r = employeeUpdateSchema.safeParse({
      ...nen,
      joinedAt: "1970-01-01",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.joinedAt).toBeNull();
  });

  it("endDate = 1970-01-01 → null", () => {
    const r = employeeUpdateSchema.safeParse({ ...nen, endDate: "1970-01-01" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.endDate).toBeNull();
  });

  it("số 0 (ô Excel trống) → null, không thành 1970", () => {
    const r = employeeUpdateSchema.safeParse({ ...nen, joinedAt: 0 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.joinedAt).toBeNull();
  });

  it("ngày vào làm THẬT vẫn qua", () => {
    const r = employeeUpdateSchema.safeParse({
      ...nen,
      joinedAt: "2025-11-24",
    });
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.joinedAt?.toISOString().slice(0, 10)).toBe("2025-11-24");
  });

  // ⚠️ Ranh giới quan trọng: sinh 01/01/1970 là một ngày THẬT của một người có thật.
  it("dateOfBirth = 1970-01-01 KHÔNG bị chặn — đó là ngày sinh hợp lệ", () => {
    const r = employeeUpdateSchema.safeParse({
      ...nen,
      dateOfBirth: "1970-01-01",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dateOfBirth).not.toBeNull();
  });
});

describe("cả hai đường ghi đều qua cổng", () => {
  it("validator form dùng nullableWorkDate cho joinedAt và endDate", () => {
    const src = doc("lib/validators/employee.ts");
    expect(src).toContain("joinedAt: nullableWorkDate");
    expect(src).toContain("endDate: nullableWorkDate");
    expect(src).toContain("dateOfBirth: nullableDate");
  });

  it("route import bọc parseExcelDate bằng boMocUnix — trừ dateOfBirth", () => {
    const src = doc("app/api/admin/import/employees/route.ts");
    expect(src).toContain("boMocUnix(parseExcelDate(v))");
    const dob = src.slice(src.indexOf("dateOfBirth:"), src.indexOf("gender:"));
    expect(dob).not.toContain("boMocUnix");
  });
});
