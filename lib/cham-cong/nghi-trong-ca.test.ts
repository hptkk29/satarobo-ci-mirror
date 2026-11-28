// Đợt 7–8 đơn từ — nghỉ một phần ca (nửa buổi / theo giờ) và nghỉ bù quy ra phút trong ca + engine.
import { describe, expect, it } from "vitest";
import { catalogByCode, SHIFT_CATALOG } from "./catalog";
import { cumQuetKyVong } from "./cum-quet";
import { KHONG_CO_DON, nghiCuaDon, type DonHieuLuc } from "./don-trong-ngay";
import { computeDay, DEFAULT_RULES, m, type EngineAssignment, type EngineLog } from "./engine";
import { khoangTu } from "./khoang-gio";
import { cacBuoiNghi, caChiaNuaBuoi, cumSauNghi, giaiKhungNghi, loiCaKhongChiaNuaBuoi, type NghiTrongNgay } from "./nghi-trong-ca";

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
    expect(cumSauNghi(CUM_HC, [K("08:00", "11:30")], CA_HC)).toEqual([K("13:30", "17:30")]);
    expect(cumSauNghi(CUM_HC, [K("08:00", "09:30")], CA_HC)).toEqual([K("09:30", "11:30"), K("13:30", "17:30")]);
    expect(cumSauNghi(CUM_HC, [K("14:00", "16:00")], CA_HC)).toEqual(CUM_HC);
  });

  it("[NT-05b] ca MỘT cụm có khoảng hở (SC): mốc mới rơi vào giờ ca, KHÔNG rơi vào giờ nghỉ trưa", () => {
    const gioSc = [K("07:45", "11:30"), K("13:45", "17:30")];
    const cumSc = [K("07:45", "17:30")];
    expect(cumSauNghi(cumSc, [K("07:45", "11:30")], gioSc)).toEqual([K("13:45", "17:30")]);
    expect(cumSauNghi(cumSc, [K("13:45", "17:30")], gioSc)).toEqual([K("07:45", "11:30")]);
    // Nghỉ trọn giờ ca ⇒ không còn cụm nào phải quét (trước đây còn "cụm" 11:30–13:45 = giờ nghỉ trưa).
    expect(cumSauNghi(cumSc, gioSc, gioSc)).toEqual([]);
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
    computeDay({ assignment: asg, logs, rules: DEFAULT_RULES, nguCanhDon: { ...KHONG_CO_DON, nghi }, coSoViecParttime: new Set<string>() });

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

  it("[NT-E6] ca SC nghỉ SÁNG 07:45–11:30, vào 13:40 ⇒ KHÔNG đi muộn; nghỉ CHIỀU, ra 11:35 ⇒ KHÔNG về sớm", () => {
    const sc = catalogByCode("SC")!;
    const a: EngineAssignment = { ...asg, templateCode: "SC", segments: sc.segments, soCapQuetKyVong: sc.soCapQuetKyVong, dayCredit: sc.dayCredit };
    const sang = computeDay({ assignment: a, logs: [L("13:40", "CHECK_IN"), L("17:35", "CHECK_OUT")], rules: DEFAULT_RULES, nguCanhDon: { ...KHONG_CO_DON, nghi: [{ loai: "KHUNG", khung: K("07:45", "11:30"), coLuong: false, nguon: "LEAVE" }] }, coSoViecParttime: new Set<string>() });
    expect(sang.flags.filter((f) => /THIEU|DI_MUON|VE_SOM|KHONG_CO_LUOT/.test(f))).toEqual([]);
    expect(sang.lateMinutes).toBe(0);
    const chieu = computeDay({ assignment: a, logs: [L("07:40", "CHECK_IN"), L("11:35", "CHECK_OUT")], rules: DEFAULT_RULES, nguCanhDon: { ...KHONG_CO_DON, nghi: [{ loai: "KHUNG", khung: K("13:45", "17:30"), coLuong: false, nguon: "LEAVE" }] }, coSoViecParttime: new Set<string>() });
    expect(chieu.flags.filter((f) => /THIEU|DI_MUON|VE_SOM|KHONG_CO_LUOT/.test(f))).toEqual([]);
    expect(chieu.earlyLeaveMinutes).toBe(0);
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

describe("[NNB] ca chia được nửa buổi không (sự cố 27/10/2026 — ca T nộp «nửa buổi chiều»)", () => {
  it("[NNB-01] khớp ĐÚNG phép của đường duyệt (`giaiKhungNghi` trên cụm quét) cho MỌI mã ca có giờ", () => {
    let soMa = 0;
    for (const e of SHIFT_CATALOG) {
      const gio = e.segments.filter((s) => s.kind === "WORK").map((s) => K(s.start, s.end));
      if (gio.length === 0) continue;
      soMa++;
      const cum = cumQuetKyVong(gio, e.soCapQuetKyVong);
      const apDuoc = !giaiKhungNghi([{ loai: "CHIEU", khung: null, coLuong: true, nguon: "LEAVE" }], cum, gio).khongAp;
      expect({ ma: e.code, chia: caChiaNuaBuoi(e.soCapQuetKyVong) }).toEqual({ ma: e.code, chia: apDuoc });
    }
    expect(soMa).toBeGreaterThan(5);
  });

  it("[NNB-02] T / S / C / SC không chia; ST chia; chưa biết số cặp ⇒ không chia", () => {
    for (const ma of ["T", "S", "C", "SC"]) expect(caChiaNuaBuoi(catalogByCode(ma)!.soCapQuetKyVong)).toBe(false);
    expect(caChiaNuaBuoi(catalogByCode("ST")!.soCapQuetKyVong)).toBe(true);
    expect(caChiaNuaBuoi(null)).toBe(false);
  });

  it("[NNB-03] câu từ chối nêu mã ca và chỉ đường «Cả ngày» / «Theo giờ»", () => {
    expect(loiCaKhongChiaNuaBuoi("T")).toMatch(/^Ca T không chia buổi sáng \/ chiều.*«Cả ngày».*«Theo giờ»/);
  });
});

describe("[NBC] nút nửa buổi theo ĐÚNG các buổi của ca (27/10/2026 — «hệ thống tự nhận diện buổi»)", () => {
  const tom = (ma: string) =>
    cacBuoiNghi(catalogByCode(ma)!.segments, catalogByCode(ma)!.soCapQuetKyVong).map((b) =>
      `${b.buoi} ${b.leaveDurationType === "HOURLY" ? `${b.khung!.tu}–${b.khung!.den}` : b.leaveDurationType}`,
    );

  it("[NBC-01] sáng+chiều ⇒ sáng / chiều · chiều+tối ⇒ chiều / tối · ca một buổi ⇒ không có nút", () => {
    expect(tom("SC")).toEqual(["SANG 07:45–11:30", "CHIEU 13:45–17:30"]);
    expect(tom("HC")).toEqual(["SANG HALF_DAY_AM", "CHIEU HALF_DAY_PM"]); // 2 cụm ⇒ giữ nửa buổi theo cụm (đúng 0,5)
    expect(tom("CT")).toEqual(["CHIEU 13:45–17:30", "TOI 17:30–21:00"]); // nghỉ có lương 16:30–17:30 thuộc buổi chiều
    expect(tom("CS")).toEqual(["CHIEU 14:00–17:00", "TOI 17:00–21:00"]);
    expect(tom("ST")).toEqual(["SANG HALF_DAY_AM", "TOI HALF_DAY_PM"]);
    expect(tom("SCT")).toEqual(["SANG 07:45–11:30", "CHIEU 13:45–17:30", "TOI 17:30–21:00"]);
    for (const ma of ["S", "C", "T"]) expect({ ma, nut: tom(ma) }).toEqual({ ma, nut: [] });
  });

  it("[NBC-02] dữ liệu hỏng ⇒ không bày nút", () => {
    expect(cacBuoiNghi(null, 1)).toEqual([]);
    expect(cacBuoiNghi([{ start: "17:30" }], 1)).toEqual([]);
  });

  it("[NBC-03] MỌI mã ca, MỌI nút: làm đúng phần «còn phải quét» form báo ⇒ engine không gắn cờ thiếu / muộn / sớm, công nghỉ 0 < x < 1", () => {
    let soNut = 0;
    for (const e of SHIFT_CATALOG) {
      for (const b of cacBuoiNghi(e.segments, e.soCapQuetKyVong)) {
        soNut++;
        const logs: EngineLog[] = b.conQuet.flatMap((c, i) => [
          { id: `i${i}`, minute: m(c.vao) - 5, direction: "CHECK_IN" as const },
          { id: `o${i}`, minute: m(c.ra) + 5, direction: "CHECK_OUT" as const },
        ]);
        const nghi: NghiTrongNgay = b.leaveDurationType === "HOURLY"
          ? { loai: "KHUNG", khung: K(b.khung!.tu, b.khung!.den), coLuong: true, nguon: "LEAVE" }
          : { loai: b.leaveDurationType === "HALF_DAY_AM" ? "SANG" : "CHIEU", khung: null, coLuong: true, nguon: "LEAVE" };
        const r = computeDay({
          assignment: {
            templateCode: e.code, segments: e.segments, attendanceMode: e.attendanceMode, soCapQuetKyVong: e.soCapQuetKyVong,
            dayCredit: e.dayCredit, isLeave: false, nominalMinutes: e.nominalMinutes ?? null, placeMode: "AT_UNITS",
          },
          logs, rules: DEFAULT_RULES, nguCanhDon: { ...KHONG_CO_DON, nghi: [nghi] }, coSoViecParttime: new Set<string>(),
        });
        expect({ ma: e.code, buoi: b.buoi, co: r.flags.filter((f) => /THIEU|DI_MUON|VE_SOM|KHONG_CO_LUOT|KHONG_AP/.test(f)) })
          .toEqual({ ma: e.code, buoi: b.buoi, co: [] });
        expect(b.conQuet.length).toBeGreaterThan(0);
        expect(r.leaveUnits).toBeGreaterThan(0);
        expect(r.leaveUnits).toBeLessThan(e.dayCredit);
      }
    }
    expect(soNut).toBeGreaterThanOrEqual(20);
  });
});
