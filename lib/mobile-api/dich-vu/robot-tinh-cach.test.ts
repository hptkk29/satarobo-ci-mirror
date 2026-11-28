import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/disc/portal-doc", () => ({ docLichSuGiaDinh: vi.fn() }));
vi.mock("./disc", () => ({ docBaoCaoCaNhan: vi.fn() }));

import { dungRobotDto, dungRobotTuBaoCao } from "./robot-tinh-cach";

describe("robot tính cách — DTO thuần", () => {
  it("[RB-01] không có kiểu nổi bật ⇒ coRobot=false, robot=null (không bịa nhãn cho em nhỏ)", () => {
    expect(dungRobotDto(null)).toEqual({ coRobot: false, robot: null });
  });
  it("[RB-02] kiểu chính/phụ: tên robot + lời mô tả lấy từ nguồn web, có đủ bốn thanh phần trăm", () => {
    const d = dungRobotDto({ chinh: "C", phu: "S", thanh: { D: 10, I: 20, S: 60, C: 90 } });
    expect(d.coRobot).toBe(true);
    if (!d.coRobot) return;
    expect(d.robot.chinh.ma).toBe("C");
    expect(d.robot.chinh.tenRobot).toBe("Robot Kỹ Sư");
    expect(d.robot.chinh.manh.length).toBeGreaterThan(0);
    expect(d.robot.phu).toMatchObject({ ma: "S", tenRobot: "Robot Bảo Vệ" });
    expect(d.robot.thanh).toEqual({ D: 10, I: 20, S: 60, C: 90 });
  });
  it("[RB-03] DTO không có điểm thô/tên người khác (chỉ các khoá đã khai)", () => {
    const d = dungRobotDto({ chinh: "D", phu: "I", thanh: { D: 80, I: 50, S: 20, C: 10 } });
    expect(Object.keys(d).sort()).toEqual(["coRobot", "robot"]);
    if (d.coRobot) expect(Object.keys(d.robot).sort()).toEqual(["chinh", "nguon", "phu", "thanh"]);
  });
  it("[RB-04] sổ gia đình: nhóm chính + nhân vật «Rô …» + cột điểm ⇒ robot nguồn SO_GIA_DINH, không có phụ/lời web", () => {
    const d = dungRobotTuBaoCao({ chinh: "C", nhan: "Chuẩn xác", nhanVat: "Rô Tỉ Mỉ", motDong: "Em cẩn thận.", cot: [{ k: "D", v: 20 }, { k: "I", v: 30 }, { k: "S", v: 40 }, { k: "C", v: 120 }] });
    expect(d.coRobot).toBe(true);
    if (!d.coRobot) return;
    expect(d.robot).toMatchObject({ nguon: "SO_GIA_DINH", phu: null, chinh: { ma: "C", tenRobot: "Rô Tỉ Mỉ", cau: "Em cẩn thận." } });
    expect(d.robot.thanh.C).toBe(100); // kẹp 0–100
  });
  it("[RB-05] báo cáo thiếu nhóm chính / nhân vật / rác ⇒ coRobot=false (không bịa)", () => {
    for (const bc of [null, {}, { chinh: "X", nhanVat: "Rô" }, { chinh: "D", nhanVat: "" }]) expect(dungRobotTuBaoCao(bc)).toEqual({ coRobot: false, robot: null });
  });
});
