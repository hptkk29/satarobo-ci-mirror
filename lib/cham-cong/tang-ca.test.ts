// Đợt 4 đơn từ — OT = khung đã duyệt × giờ làm thật (QĐ-2: trả = min(duyệt, thật)).
import { describe, expect, it } from "vitest";
import { giao, gop, khoangTu, tong, tru } from "./khoang-gio";
import { tinhTangCa } from "./tang-ca";
import { computeDay, DEFAULT_RULES, m, type EngineAssignment, type EngineLog } from "./engine";
import { catalogByCode } from "./catalog";
import { KHONG_CO_DON } from "./don-trong-ngay";

const K = (a: string, b: string) => khoangTu(a, b)!;
const CA_HC = [K("08:00", "11:30"), K("13:30", "17:30")];

describe("[KG] khoảng giờ", () => {
  it("[KG-01] gộp / giao / trừ / tổng không đếm hai lần phút chồng nhau", () => {
    expect(gop([K("08:00", "10:00"), K("09:00", "11:00")])).toEqual([K("08:00", "11:00")]);
    expect(giao([K("08:00", "12:00")], CA_HC)).toEqual([K("08:00", "11:30")]);
    expect(tru([K("17:00", "19:00")], CA_HC)).toEqual([K("17:30", "19:00")]);
    expect(tong([K("08:00", "10:00"), K("09:00", "11:00")])).toBe(180);
    expect(khoangTu("20:00", "18:00")).toBeNull();
  });
});

describe("[OT] tinhTangCa", () => {
  const t = (khung: string[], cap: string[][], lamTronPhut = 0) =>
    tinhTangCa({ khungDuyet: [K(khung[0]!, khung[1]!)], capDaDong: cap.map(([a, b]) => K(a!, b!)), gioCa: CA_HC, lamTronPhut });

  it("[OT-01] ví dụ BA: duyệt 18:00–21:00, làm 18:05–20:30 ⇒ thật 145′, trả 145′", () => {
    expect(t(["18:00", "21:00"], [["18:05", "20:30"]])).toEqual({ otApprovedMinutes: 180, otActualMinutes: 145, otPayableMinutes: 145 });
  });

  it("[OT-02] làm LÂU hơn khung (17:30–22:00) ⇒ chỉ tính trong khung 180′", () => {
    expect(t(["18:00", "21:00"], [["17:30", "22:00"]]).otPayableMinutes).toBe(180);
  });

  it("[OT-03] không có lượt quét ⇒ 0 dù đã duyệt (duyệt là cho phép, không phải đã làm)", () => {
    expect(t(["18:00", "21:00"], [])).toEqual({ otApprovedMinutes: 180, otActualMinutes: 0, otPayableMinutes: 0 });
  });

  it("[OT-04] khung chồng giờ ca (17:00–19:00) ⇒ phần trong ca KHÔNG đếm hai lần: duyệt 90′, làm 08:00–19:00 ⇒ 90′", () => {
    expect(t(["17:00", "19:00"], [["08:00", "11:30"], ["13:30", "19:00"]])).toEqual({ otApprovedMinutes: 90, otActualMinutes: 90, otPayableMinutes: 90 });
  });

  it("[OT-05] làm NGOÀI khung (21:00–22:00) ⇒ 0", () => {
    expect(t(["18:00", "21:00"], [["21:00", "22:00"]]).otActualMinutes).toBe(0);
  });

  it("[OT-06] làm tròn xuống bội 15′: 145′ ⇒ 135′; 0 = không làm tròn", () => {
    expect(t(["18:00", "21:00"], [["18:05", "20:30"]], 15).otPayableMinutes).toBe(135);
  });
});

describe("[OT-E] engine: OT vào dòng bảng công", () => {
  const e = catalogByCode("HC")!;
  const asg: EngineAssignment = {
    templateCode: "HC",
    segments: e.segments,
    attendanceMode: e.attendanceMode,
    soCapQuetKyVong: e.soCapQuetKyVong,
    dayCredit: e.dayCredit,
    isLeave: false,
    nominalMinutes: e.nominalMinutes ?? null,
    placeMode: "AT_UNITS",
  };
  let n = 0;
  const L = (t: string, d: "CHECK_IN" | "CHECK_OUT"): EngineLog => ({ id: `l${++n}`, minute: m(t), direction: d });
  const logs = [L("07:55", "CHECK_IN"), L("11:31", "CHECK_OUT"), L("13:25", "CHECK_IN"), L("20:30", "CHECK_OUT")];

  it("[OT-E1] không có đơn OT ⇒ 0 phút OT (OT chưa duyệt không ảnh hưởng bảng công)", () => {
    const r = computeDay({ assignment: asg, logs, rules: DEFAULT_RULES, nguCanhDon: KHONG_CO_DON });
    expect(r.otPayableMinutes).toBe(0);
    expect(r.flags).not.toContain("TANG_CA_DUYET");
  });

  it("[OT-E2] có khung duyệt 18:00–21:00 ⇒ trả 150′ (18:00–20:30), công trong ca KHÔNG đổi", () => {
    const khong = computeDay({ assignment: asg, logs, rules: DEFAULT_RULES, nguCanhDon: KHONG_CO_DON });
    const co = computeDay({ assignment: asg, logs, rules: DEFAULT_RULES, nguCanhDon: { ...KHONG_CO_DON, tangCa: [K("18:00", "21:00")] } });
    expect(co.otPayableMinutes).toBe(150);
    expect(co.flags).toContain("TANG_CA_DUYET");
    expect(co.dayCreditEarned).toBe(khong.dayCreditEarned);
    expect(co.workedMinutes).toBe(khong.workedMinutes);
  });
});
