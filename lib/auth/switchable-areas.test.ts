import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { listSwitchableAreas, AREA_META } from "./switchable-areas";

// #13 (câu 11) — helper "khu vực chuyển được". Bám decideRoute làm nguồn sự thật:
// mọi kỳ vọng dưới đây suy được từ route-policy (host×role gating).
const on = { teacherSiteEnabled: true };
const off = { teacherSiteEnabled: false };
const R = (...r: Role[]) => r;

describe("listSwitchableAreas", () => {
  it("chưa login / rỗng → []", () => {
    expect(listSwitchableAreas([], on)).toEqual([]);
    expect(listSwitchableAreas([null], on)).toEqual([]);
  });

  it("PARENT thuần → chỉ portal (1 khu vực, ẩn menu)", () => {
    expect(listSwitchableAreas(R("PARENT"), on)).toEqual(["portal"]);
  });

  it("staff thuần (CENTER_MANAGER) → chỉ admin, bất kể flag", () => {
    expect(listSwitchableAreas(R("CENTER_MANAGER"), on)).toEqual(["admin"]);
    expect(listSwitchableAreas(R("CENTER_MANAGER"), off)).toEqual(["admin"]);
  });

  it("TEACHER thuần, flag OFF → admin (GV vẫn làm trên admin — 2-phase)", () => {
    expect(listSwitchableAreas(R("TEACHER"), off)).toEqual(["admin"]);
  });

  it("TEACHER thuần, flag ON → teacher (admin đá GV thuần sang site GV)", () => {
    expect(listSwitchableAreas(R("TEACHER"), on)).toEqual(["teacher"]);
  });

  it("TEACHER + staff (CENTER_MANAGER), flag ON → admin + teacher (2 khu vực → hiện menu)", () => {
    expect(listSwitchableAreas(R("TEACHER", "CENTER_MANAGER"), on)).toEqual(["admin", "teacher"]);
  });

  it("TEACHER + staff, flag OFF → chỉ admin (host GV tắt)", () => {
    expect(listSwitchableAreas(R("TEACHER", "CENTER_MANAGER"), off)).toEqual(["admin"]);
  });

  it("Toại (2 staff không-GV: MARKETING + CENTER_MANAGER) → chỉ admin (khớp phát hiện #13: staff↔staff là đổi PANEL, không host-switch)", () => {
    // TRAINING không có trong Role enum legacy → dùng 2 staff enum khác đại diện ca kiêm nhiệm staff.
    expect(listSwitchableAreas(R("MARKETING", "CENTER_MANAGER"), on)).toEqual(["admin"]);
  });

  it("staff + PARENT → chỉ admin (isStaff thắng ở decideRoute; portal bị chặn — giới hạn đã biết)", () => {
    expect(listSwitchableAreas(R("CENTER_MANAGER", "PARENT"), on)).toEqual(["admin"]);
  });

  it("SUPER_ADMIN → admin (flag ON không đá vì không phải GV thuần)", () => {
    expect(listSwitchableAreas(R("SUPER_ADMIN"), on)).toEqual(["admin"]);
  });

  it("AREA_META phủ đúng 3 khu vực", () => {
    expect(Object.keys(AREA_META).sort()).toEqual(["admin", "portal", "teacher"]);
  });
});
