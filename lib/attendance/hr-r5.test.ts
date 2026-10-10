// R5 — geofence + QR token + xác nhận KHÔNG định vị học sinh (C3.4). Pure.
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { distanceMeters, withinGeofence } from "@/lib/attendance/geofence";
import { makeCenterToken, verifyCenterToken } from "@/lib/attendance/qr-token";

describe("[R5-03] geofence", () => {
  it("[R5-03-C3.1] trong bán kính → within=true", () => {
    const center = { lat: 16.0, lng: 108.0, radiusM: 100 };
    const r = withinGeofence({ lat: 16.0, lng: 108.0003 }, center); // ~32m
    expect(r.within).toBe(true);
    expect(r.distanceM).toBeLessThan(100);
  });
  it("[R5-03-C3.2] ngoài bán kính → within=false (không chặn cứng, chỉ ghi nhận)", () => {
    const center = { lat: 16.0, lng: 108.0, radiusM: 100 };
    const r = withinGeofence({ lat: 16.0, lng: 108.002 }, center); // ~213m
    expect(r.within).toBe(false);
    expect(r.distanceM).toBeGreaterThan(100);
  });
  it("cơ sở chưa khai toạ độ → không chặn (within=true)", () => {
    expect(withinGeofence({ lat: 1, lng: 2 }, { lat: null, lng: null, radiusM: 100 }).within).toBe(true);
  });
  it("distanceMeters Haversine ~111m cho 0.001° lng tại xích đạo", () => {
    expect(distanceMeters(0, 0, 0, 0.001)).toBeGreaterThan(105);
    expect(distanceMeters(0, 0, 0, 0.001)).toBeLessThan(115);
  });
});

describe("[R5-02] QR token (cố định/cơ sở)", () => {
  const S = "qr-secret";
  it("[R5-02-C2.1] đúng cơ sở + chữ ký → hợp lệ; sai cơ sở / tamper → từ chối", () => {
    const tok = makeCenterToken("CS1", S);
    expect(verifyCenterToken(tok, "CS1", S)).toBe(true);
    expect(verifyCenterToken(tok, "CS2", S)).toBe(false); // quét QR cơ sở khác
    expect(verifyCenterToken("CS1.deadbeef", "CS1", S)).toBe(false);
    expect(verifyCenterToken(tok, "CS1", "secret-khac")).toBe(false);
  });
});

describe("[R5-03-C3.4] geofence CHỈ cho nhân viên — KHÔNG định vị học sinh", () => {
  const fieldsOf = (name: string) =>
    (Prisma.dmmf.datamodel.models.find((m) => m.name === name)?.fields ?? []).map((f) => f.name);

  it("EmployeeCheckin CÓ toạ độ (chấm công NV); Student KHÔNG có toạ độ", () => {
    expect(fieldsOf("EmployeeCheckin")).toEqual(expect.arrayContaining(["latitude", "longitude"]));
    const student = fieldsOf("Student");
    expect(student).not.toContain("latitude");
    expect(student).not.toContain("longitude");
    expect(student.some((f) => /latitude|longitude|gpsLat|geoLat/i.test(f))).toBe(false);
  });
});
