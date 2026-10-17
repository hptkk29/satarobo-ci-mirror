// Đợt 7–8 đơn từ — nghỉ một phần ca (nửa buổi / theo giờ) và nghỉ bù quy ra phút trong ca + engine.
import { describe, expect, it } from "vitest";
import { catalogByCode } from "./catalog";
import { KHONG_CO_DON, nghiCuaDon, type DonHieuLuc } from "./don-trong-ngay";
import { computeDay, DEFAULT_RULES, m, type EngineAssignment, type EngineLog } from "./engine";
import { khoangTu } from "./khoang-gio";
import { cumSauNghi, giaiKhungNghi, type NghiTrongNgay } from "./nghi-trong-ca";

const K = (a: string, b: string) => khoangTu(a, b)!;
const CUM_HC = [K("08:00", "11:30"), K("13:30", "17:30")];
const CA_HC = CUM_HC;

describe("[NT] giải khung nghỉ", () => {
  const n = (loai: NghiTrongNgay["loai"], khung: [string, string] | null = null, coLuong = true): NghiTrongNgay => ({
    loai,
    khung: khung ? K(khung[0], khung[1]) : null,
    coLuong,
    nguon: "LEAVE",
  });

  it("[NT-01] nửa sáng = CỤM ĐẦU, nửa chiều = CỤM CUỐI (không theo mốc 12:00)", () => {
    expect(giaiKhungNghi([n("SANG")], CUM_HC, CA_HC).khung).toEqual([K("08:00", "11:30")]);
    expect(giaiKhungNghi([n("CHIEU")], CUM_HC, CA_HC).khung).toEqual([K("13:30", "17:30")]);
  });

  it("[NT-02] ca MỘT cụm (S, C, T) ⇒ nghỉ nửa buổi KHÔNG áp được (không đoán)", () => {
    const r = giaiKhungNghi([n("SANG")], [K("07:45", "11:30")], [K("07:45", "11:30")]);
    expect(r.khongAp).toBe(true);
    expect(r.khung).toEqual([]);
  });

  it("[NT-03] theo giờ: cắt theo giờ ca (nghỉ 11:00–14:00 ⇒ 11:00–11:30 + 13:30–14:00)", () => {
    expect(giaiKhungNghi([n("KHUNG", ["11:00", "14:00"])], CUM_HC, CA_HC).khung).toEqual([K("11:00", "11:30"), K("13:30", "14:00")]);
  });

  it("[NT-04] không lương ⇒ không vào khung có lương", () => {
    const r = giaiKhungNghi([n("CHIEU", null, false)], CUM_HC, CA_HC);
    expect(r.khung).toHaveLength(1);
    expect(r.khungCoLuong).toEqual([]);
  });

  it("[NT-05] cụm còn phải chấm: phủ trọn ⇒ bỏ; chạm đầu ⇒ dời giờ vào; nằm giữa ⇒ giữ hai mốc ngoài", () => {
    expect(cumSauNghi(CUM_HC, [K("08:00", "11:30")])).toEqual([K("13:30", "17:30")]);
    expect(cumSauNghi(CUM_HC, [K("08:00", "09:30")])).toEqual([K("09:30", "11:30"), K("13:30", "17:30")]);
    expect(cumSauNghi(CUM_HC, [K("14:00", "16:00")])).toEqual(CUM_HC);
  });

  it("[NT-06] nghiCuaDon: nghỉ phép cả ngày KHÔNG vào ngữ cảnh (đi ô P/X); nghỉ bù cả ngày thì vào", () => {
    const d = (kind: DonHieuLuc["kind"], leaveDurationType: DonHieuLuc["leaveDurationType"]): DonHieuLuc => ({
      id: "x", kind, detail: null, startTime: "14:00", endTime: "16:00", approvedStartTime: null, approvedEndTime: null,
      leaveDurationType, leavePaidRatio: 1, tyLeNghiBu: null, loaiNgayNghi: null,
    });
    expect(nghiCuaDon(d("LEAVE", "FULL_DAY"))).toBeNull();
    expect(nghiCuaDon(d("LEAVE", null))).toBeNull();
    expect(nghiCuaDon(d("LEAVE", "HOURLY"))).toMatchObject({ loai: "KHUNG", coLuong: true });
    expect(nghiCuaDon(d("COMP_LEAVE", "FULL_DAY"))).toMatchObject({ loai: "CA_NGAY", coLuong: true, nguon: "COMP_LEAVE" });
  });
});

describe("[NT-E] engine với nghỉ một phần ca (ca HC 08:00–11:30 · 13:30–17:30)", () => {
  const e = catalogByCode("HC")!;
  const asg: EngineAssignment = {
    templateCode: "HC", segments: e.segments, attendanceMode: e.attendanceMode, soCapQuetKyVong: e.soCapQuetKyVong,
    dayCredit: e.dayCredit, isLeave: false, nominalMinutes: e.nominalMinutes ?? null, placeMode: "AT_UNITS",
  };
  let id = 0;
  const L = (t: string, d: "CHECK_IN" | "CHECK_OUT"): EngineLog => ({ id: `l${++id}`, minute: m(t), direction: d });
  const chay = (nghi: NghiTrongNgay[], logs: EngineLog[]) =>
    computeDay({ assignment: asg, logs, rules: DEFAULT_RULES, nguCanhDon: { ...KHONG_CO_DON, nghi } });

  it("[NT-E1] nghỉ nửa SÁNG có lương, chiều đi làm đủ ⇒ không cờ thiếu buổi, công 0,5 + nghỉ 0,5", () => {
    const r = chay([{ loai: "SANG", khung: null, coLuong: true, nguon: "LEAVE" }], [L("13:25", "CHECK_IN"), L("17:35", "CHECK_OUT")]);
    expect(r.flags).not.toContain("THIEU_BUOI_SANG");
    expect(r.flags).not.toContain("KHONG_CO_LUOT");
    expect(r.flags).toContain("NGHI_MOT_PHAN_DUYET");
    // Nửa buổi = đúng 1/2 công của ca hai cụm, KHÔNG theo phút (210/450 = 0,47 là số không ai dùng).
    expect(r.dayCreditEarned).toBe(0.5);
    expect(r.leaveUnits).toBe(0.5);
  });

  it("[NT-E2] nghỉ nửa CHIỀU KHÔNG lương ⇒ không cộng nghỉ có lương", () => {
    const r = chay([{ loai: "CHIEU", khung: null, coLuong: false, nguon: "LEAVE" }], [L("07:55", "CHECK_IN"), L("11:31", "CHECK_OUT")]);
    expect(r.flags).not.toContain("THIEU_BUOI_CHIEU");
    expect(r.leaveUnits).toBe(0);
  });

  it("[NT-E3] nghỉ theo giờ 08:00–09:30 rồi tới 09:35 ⇒ KHÔNG đi muộn (giờ vào dời về 09:30)", () => {
    const r = chay([{ loai: "KHUNG", khung: K("08:00", "09:30"), coLuong: true, nguon: "LEAVE" }], [
      L("09:35", "CHECK_IN"), L("11:31", "CHECK_OUT"), L("13:25", "CHECK_IN"), L("17:35", "CHECK_OUT"),
    ]);
    expect(r.flags).not.toContain("DI_MUON");
    expect(r.expectedMinutes).toBe(450 - 90);
  });

  it("[NT-E4] nghỉ theo giờ 14:00–16:00 giữa buổi chiều ⇒ không đòi quét ra/vào quanh khoảng nghỉ; ngoài khoảng vẫn chấm thường", () => {
    const r = chay([{ loai: "KHUNG", khung: K("14:00", "16:00"), coLuong: true, nguon: "LEAVE" }], [
      L("07:55", "CHECK_IN"), L("11:31", "CHECK_OUT"), L("13:25", "CHECK_IN"), L("17:35", "CHECK_OUT"),
    ]);
    expect(r.flags.filter((f) => /THIEU|DI_MUON|VE_SOM|KHONG_CO_LUOT/.test(f))).toEqual([]);
    // Đối chứng: KHÔNG quét gì ⇒ phần ngoài khoảng nghỉ vẫn bị đòi.
    expect(chay([{ loai: "KHUNG", khung: K("14:00", "16:00"), coLuong: true, nguon: "LEAVE" }], []).flags).toContain("KHONG_CO_LUOT");
  });

  it("[NT-E5] nghỉ bù CẢ NGÀY ⇒ ngày nghỉ, không đòi quét, nghỉ có lương = công của ca", () => {
    const r = chay([{ loai: "CA_NGAY", khung: null, coLuong: true, nguon: "COMP_LEAVE" }], []);
    expect(r.dayType).toBe("LEAVE");
    expect(r.flags).not.toContain("KHONG_CO_LUOT");
    expect(r.flags).toContain("NGHI_BU_DUYET");
    expect(r.dayCreditEarned).toBe(0);
    expect(r.leaveUnits).toBe(r.dayCreditExpected);
  });
});
