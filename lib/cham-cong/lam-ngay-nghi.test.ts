// Đợt 9–10 đơn từ — làm ngày nghỉ / lễ (engine, cột riêng) và chấm công ngoài địa điểm (cổng nguồn 4).
import { describe, expect, it } from "vitest";
import { catalogByCode } from "./catalog";
import { coLichTheoDon, quyenChamNgoai } from "./cham-ngoai";
import { dungNguCanhDon, KHONG_CO_DON, type DonHieuLuc, type NguCanhDon } from "./don-trong-ngay";
import { computeDay, DEFAULT_RULES, m, type EngineAssignment, type EngineLog } from "./engine";
import { khoangTu } from "./khoang-gio";

const don = (kind: DonHieuLuc["kind"], over: Partial<DonHieuLuc> = {}): DonHieuLuc => ({
  id: kind,
  kind,
  detail: null,
  startTime: null,
  endTime: null,
  approvedStartTime: null,
  approvedEndTime: null,
  leaveDurationType: null,
  leavePaidRatio: null,
  tyLeNghiBu: null,
  loaiNgayNghi: null,
  ...over,
});

let id = 0;
const L = (t: string, d: "CHECK_IN" | "CHECK_OUT", flags: string[] = []): EngineLog => ({ id: `l${++id}`, minute: m(t), direction: d, flags });
const lamNgayNghi = (loai: "LE" | "NGHI", tu: string, den: string, tyLe: number | null = null): NguCanhDon => ({
  ...KHONG_CO_DON,
  lamNgayNghi: [{ khung: khoangTu(tu, den)!, loai, tyLe }],
});

describe("[LNN] ngữ cảnh đơn làm ngày nghỉ / lễ", () => {
  it("[LNN-01] đơn mang ảnh chụp loại ngày ⇒ vào ngữ cảnh; thiếu ảnh chụp ⇒ KHÔNG đoán", () => {
    const co = dungNguCanhDon([don("HOLIDAY_WORK", { startTime: "08:00", endTime: "12:00", loaiNgayNghi: "NGHI", tyLeNghiBu: 1.5 })]);
    expect(co.lamNgayNghi).toEqual([{ khung: khoangTu("08:00", "12:00"), loai: "NGHI", tyLe: 1.5 }]);
    expect(dungNguCanhDon([don("HOLIDAY_WORK", { startTime: "08:00", endTime: "12:00" })]).lamNgayNghi).toEqual([]);
  });
});

describe("[LNN-E] engine", () => {
  it("[LNN-E1] ngày KHÔNG ca: phút = làm thật TRONG khung (không phải độ dài khung), không cờ chấm ngoài lịch", () => {
    const r = computeDay({
      assignment: null,
      // Lượt quét TRƯỚC khi đơn được duyệt đã mang cờ "chấm ngoài lịch" — engine phải gỡ ở mức ngày.
      logs: [L("08:30", "CHECK_IN", ["CHAM_NGOAI_LICH"]), L("12:40", "CHECK_OUT", ["CHAM_NGOAI_LICH"])],
      rules: DEFAULT_RULES,
      isWeeklyOff: true,
      nguCanhDon: lamNgayNghi("NGHI", "08:00", "12:00"),
    });
    expect(r.restDayWorkMinutes).toBe(210); // 08:30–12:00, phần sau 12:00 ngoài khung không tính
    expect(r.holidayWorkMinutes).toBe(0);
    expect(r.flags).toContain("LAM_NGAY_NGHI_DUYET");
    expect(r.flags).not.toContain("CHAM_NGOAI_LICH");
    expect(r.dayCreditEarned).toBe(0); // không cộng công thường
    expect(r.otPayableMinutes).toBe(0); // không cộng OT
  });

  it("[LNN-E2] đối chứng: không đơn ⇒ vẫn cờ chấm ngoài lịch, 0 phút", () => {
    const r = computeDay({ assignment: null, logs: [L("08:30", "CHECK_IN"), L("12:00", "CHECK_OUT")], rules: DEFAULT_RULES, nguCanhDon: KHONG_CO_DON });
    expect(r.flags).toContain("CHAM_NGOAI_LICH");
    expect(r.restDayWorkMinutes).toBe(0);
  });

  it("[LNN-E3] ngày LỄ có ca: phút vào cột làm ngày lễ; công lễ (holidayPaidUnits) giữ nguyên", () => {
    const e = catalogByCode("HC")!;
    const asg: EngineAssignment = {
      templateCode: "HC", segments: e.segments, attendanceMode: e.attendanceMode, soCapQuetKyVong: e.soCapQuetKyVong,
      dayCredit: e.dayCredit, isLeave: false, nominalMinutes: e.nominalMinutes ?? null, placeMode: "AT_UNITS",
    };
    const holiday = { coefficient: 1, effect: "PAID_LEAVE" as const };
    const khong = computeDay({ assignment: asg, logs: [], rules: DEFAULT_RULES, holiday, nguCanhDon: KHONG_CO_DON });
    const co = computeDay({
      assignment: asg,
      logs: [L("08:00", "CHECK_IN"), L("11:00", "CHECK_OUT")],
      rules: DEFAULT_RULES,
      holiday,
      nguCanhDon: lamNgayNghi("LE", "08:00", "11:00"),
    });
    expect(co.holidayWorkMinutes).toBe(180);
    expect(co.restDayWorkMinutes).toBe(0);
    expect(co.holidayPaidUnits).toBe(khong.holidayPaidUnits);
  });

  it("[LNN-E4] tỉ lệ nghỉ bù chụp lúc duyệt ⇒ phút quy quỹ; đơn trả tiền ⇒ 0", () => {
    const logs = [L("08:00", "CHECK_IN"), L("10:00", "CHECK_OUT")];
    expect(computeDay({ assignment: null, logs, rules: DEFAULT_RULES, nguCanhDon: lamNgayNghi("NGHI", "08:00", "12:00", 1.5) }).lamNgayNghiCompMinutes).toBe(180);
    expect(computeDay({ assignment: null, logs, rules: DEFAULT_RULES, nguCanhDon: lamNgayNghi("NGHI", "08:00", "12:00") }).lamNgayNghiCompMinutes).toBe(0);
  });
});

describe("[CN-4] chấm công ngoài địa điểm — nguồn 4 của cổng chấm ngoài", () => {
  const q = (d: DonHieuLuc[], luc: string) => quyenChamNgoai({ placeMode: "AT_UNITS", don: d, phut: m(luc), dungSaiPhut: 30 });

  it("[CN-4a] trong khung ± dung sai ⇒ được, cờ lượt NGOAI_DIA_DIEM_DUYET; ngoài ⇒ không", () => {
    const d = [don("OUTSIDE_ATTENDANCE", { startTime: "14:00", endTime: "16:00" })];
    expect(q(d, "13:30")).toMatchObject({ lyDo: "NGOAI_DIA_DIEM", co: "NGOAI_DIA_DIEM_DUYET" });
    expect(q(d, "16:30")).not.toBeNull();
    expect(q(d, "13:29")).toBeNull();
    expect(q(d, "16:31")).toBeNull();
  });

  it("[CN-4b] đơn thiếu khung (dữ liệu lạ) KHÔNG mở cả ngày — khác làm từ xa", () => {
    expect(q([don("OUTSIDE_ATTENDANCE")], "10:00")).toBeNull();
    expect(q([don("REMOTE")], "10:00")).not.toBeNull(); // đối chứng dương
  });

  it("[CN-4c] lịch theo đơn: công tác / làm ngày nghỉ CÓ; làm từ xa / chấm ngoài KHÔNG", () => {
    expect(coLichTheoDon([don("BUSINESS_TRIP")])).toBe(true);
    expect(coLichTheoDon([don("HOLIDAY_WORK")])).toBe(true);
    expect(coLichTheoDon([don("REMOTE"), don("OUTSIDE_ATTENDANCE")])).toBe(false);
  });
});
