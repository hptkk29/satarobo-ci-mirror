// [BONG-*] [DRIFT-*] chạy bóng + so sánh với công dạy cũ + cổng không-lệch (`chay-bong.ts`, thuần).
import { describe, expect, it } from "vitest";
import { congKhongLech, dongBongDay, dongBongTruc, soSanhBong, type DauVaoDayBong, type DongBong, type DongCu } from "./chay-bong";

const day = (p: Partial<DauVaoDayBong> = {}): DauVaoDayBong => ({
  assignmentId: "pc1",
  assignmentType: "SYSTEM",
  userId: "gv",
  role: "MAIN_TEACHER",
  activity: "REGULAR_CLASS",
  sourceType: "CLASS_SESSION",
  sourceId: "s1",
  workDate: "2026-11-02",
  lop: "TU_DONG",
  lyDo: [],
  donVi: "1",
  ...p,
});
const cu = (p: Partial<DongCu> = {}): DongCu => ({ sourceType: "CLASS_SESSION", sourceId: "s1", userId: "gv", workDate: "2026-11-02", vai: "MAIN", ...p });
const bong = (p: Partial<DauVaoDayBong> = {}) => dongBongDay(day(p))!;
const loai = (b: DongBong[], c: DongCu[]) => soSanhBong({ bong: b, cu: c, oCa: [] }).map((x) => x.loai);

describe("[BONG] dòng bóng — trạng thái, KHÔNG BAO GIỜ là căn cứ", () => {
  it("[BONG-01] sạch / xem tay ⇒ SHADOW (số tiết); Q1 ⇒ POLICY_UNRESOLVED; cutover chưa nhận ⇒ CUTOVER_GRACE; chặn khác ⇒ BLOCKED; chưa xong / không áp dụng ⇒ không dòng", () => {
    expect(bong()).toMatchObject({ trangThai: "SHADOW", donVi: "1", hoatDong: "MAIN" });
    expect(bong({ lop: "XEM_TAY", lyDo: ["DI_MUON"] }).trangThai).toBe("SHADOW");
    expect(bong({ lop: "CHAN", lyDo: ["THOI_LUONG_KHONG_CHUAN"], donVi: null })).toMatchObject({ trangThai: "POLICY_UNRESOLVED", donVi: null });
    expect(bong({ lop: "CHAN", lyDo: ["CUTOVER_GRACE"] })).toMatchObject({ trangThai: "CUTOVER_GRACE", donVi: null });
    expect(bong({ lop: "CHAN", lyDo: ["CHUA_NHAN"] })).toMatchObject({ trangThai: "BLOCKED", donVi: null });
    expect(dongBongDay(day({ lop: "CHUA_XONG" }))).toBeNull();
    expect(dongBongDay(day({ lop: "KHONG_AP_DUNG" }))).toBeNull();
    const tatCa = ["SHADOW", "POLICY_UNRESOLVED", "CUTOVER_GRACE", "BLOCKED"];
    for (const l of ["TU_DONG", "XEM_TAY", "CHAN"] as const) expect(tatCa).toContain(bong({ lop: l }).trangThai);
  });

  it("[BONG-02] hoạt động: MAIN · TA · SUBSTITUTE (loại phân công) · MAKEUP; trực ⇒ OPS (đơn vị trực / Q1-Q2 chưa quyết / chờ ⇒ không dòng)", () => {
    expect(bong({ role: "TEACHING_ASSISTANT" }).hoatDong).toBe("TA");
    expect(bong({ assignmentType: "SUBSTITUTE" }).hoatDong).toBe("SUBSTITUTE");
    expect(bong({ activity: "MAKEUP", sourceType: "MAKEUP_CASE" }).hoatDong).toBe("MAKEUP");
    expect(dongBongTruc({ dutyId: "d1", userId: "u", ngay: "2026-11-02", shiftCode: "T", lop: "TU_DONG", lyDo: [], donViTra: "0.5" })).toMatchObject({ hoatDong: "OPS", trangThai: "SHADOW", donVi: "0.5" });
    expect(dongBongTruc({ dutyId: "d1", userId: "u", ngay: "2026-11-02", shiftCode: "S", lop: "CHAN", lyDo: ["Q2_VUOT_CA"], donViTra: null })?.trangThai).toBe("POLICY_UNRESOLVED");
    expect(dongBongTruc({ dutyId: "d1", userId: "u", ngay: "2026-11-02", shiftCode: "T", lop: "CHO", lyDo: ["CHUA_HET_CA"], donViTra: null })).toBeNull();
  });
});

describe("[BONG-SS] so sánh với công dạy cũ", () => {
  it("[BONG-03] khớp ⇒ MATCH; cũ có mới không ⇒ MISSING_NEW; mới có cũ không ⇒ EXTRA_NEW", () => {
    expect(loai([bong()], [cu()])).toEqual(["MATCH"]);
    expect(loai([], [cu()])).toEqual(["MISSING_NEW"]);
    expect(loai([bong()], [])).toEqual(["EXTRA_NEW"]);
  });

  it("[BONG-04] người đứng lớp khác nhau ⇒ MỘT dòng WRONG_TEACHER (không phải một thiếu + một thừa)", () => {
    expect(loai([bong({ userId: "gvB" })], [cu({ userId: "gvA" })])).toEqual(["WRONG_TEACHER"]);
  });

  it("[BONG-05] cùng người: vai lệch ⇒ WRONG_ROLE; dạy thay / học bù lệch ⇒ WRONG_ACTIVITY; số tiết ≠ 1 ⇒ WRONG_UNITS", () => {
    expect(loai([bong({ role: "TEACHING_ASSISTANT" })], [cu()])).toEqual(["WRONG_ROLE"]);
    expect(loai([bong()], [cu({ vai: "SUBSTITUTE" })])).toEqual(["WRONG_ACTIVITY"]);
    expect(loai([bong({ assignmentType: "SUBSTITUTE" })], [cu({ vai: "SUBSTITUTE" })])).toEqual(["MATCH"]);
    expect(loai([bong({ donVi: "0.67" })], [cu()])).toEqual(["WRONG_UNITS"]);
  });

  it("[BONG-06] Q1 chưa quyết ⇒ POLICY_UNRESOLVED (nuốt dòng cũ cùng người — không thêm MISSING_NEW); cutover chưa nhận / chặn ⇒ MISSING_NEW", () => {
    expect(loai([bong({ lop: "CHAN", lyDo: ["THOI_LUONG_KHONG_CHUAN"] })], [cu()])).toEqual(["POLICY_UNRESOLVED"]);
    expect(loai([bong({ lop: "CHAN", lyDo: ["CUTOVER_GRACE"] })], [cu()])).toEqual(["MISSING_NEW"]);
    expect(loai([bong({ lop: "CHAN", lyDo: ["CHUA_NHAN"] })], [])).toEqual([]);
  });

  it("[BONG-07] trùng (một người hai dòng một buổi) ⇒ DUPLICATE; trực: ô ca cũ cùng mã + 1 ca ⇒ MATCH, không thì OPS_MISMATCH", () => {
    expect(loai([bong(), bong({ assignmentId: "pc2" })], [cu()])).toEqual(["DUPLICATE", "MISSING_NEW"]);
    const truc = dongBongTruc({ dutyId: "d1", userId: "u", ngay: "2026-11-02", shiftCode: "T", lop: "TU_DONG", lyDo: [], donViTra: "1" })!;
    expect(soSanhBong({ bong: [truc], cu: [], oCa: [{ userId: "u", workDate: "2026-11-02", shiftCode: "T" }] }).map((x) => x.loai)).toEqual(["MATCH"]);
    expect(soSanhBong({ bong: [truc], cu: [], oCa: [] }).map((x) => x.loai)).toEqual(["OPS_MISMATCH"]);
    expect(soSanhBong({ bong: [{ ...truc, donVi: "0.5" }], cu: [], oCa: [{ userId: "u", workDate: "2026-11-02", shiftCode: "T" }] })[0]).toMatchObject({ loai: "OPS_MISMATCH" });
  });
});

describe("[DRIFT] cổng không-lệch trước công tắc tiền", () => {
  it("[DRIFT-01] MISSING_NEW / EXTRA_NEW / WRONG_TEACHER / WRONG_ROLE / DUPLICATE > 0 ⇒ KHÔNG đạt (từng loại một)", () => {
    for (const [b, c] of [
      [[], [cu()]],
      [[bong()], []],
      [[bong({ userId: "x" })], [cu()]],
      [[bong({ role: "TEACHING_ASSISTANT" })], [cu()]],
      [[bong(), bong({ assignmentId: "p2" })], []],
    ] as [DongBong[], DongCu[]][]) {
      expect(congKhongLech(soSanhBong({ bong: b, cu: c, oCa: [] }), { loaiTru: new Set() }).dat).toBe(false);
    }
  });

  it("[DRIFT-02] POLICY_UNRESOLVED phải được LOẠI TRỪ có chủ đích; WRONG_ACTIVITY / WRONG_UNITS / OPS_MISMATCH là cảnh báo; toàn MATCH ⇒ đạt", () => {
    const ss = soSanhBong({ bong: [bong({ lop: "CHAN", lyDo: ["THOI_LUONG_KHONG_CHUAN"], sourceId: "s60" }), bong({ sourceId: "s2" })], cu: [cu({ sourceId: "s60" }), cu({ sourceId: "s2" })], oCa: [] });
    expect(congKhongLech(ss, { loaiTru: new Set() })).toMatchObject({ dat: false, chan: ["POLICY_UNRESOLVED chưa loại trừ có chủ đích = 1"] });
    expect(congKhongLech(ss, { loaiTru: new Set(["s60"]) })).toMatchObject({ dat: true, dem: { MATCH: 1, POLICY_UNRESOLVED: 1 } });
    const canh = congKhongLech(soSanhBong({ bong: [bong({ donVi: "0.67" })], cu: [cu()], oCa: [] }), { loaiTru: new Set() });
    expect(canh).toMatchObject({ dat: true, canhBao: ["WRONG_UNITS = 1 (phải xem từng dòng)"] });
  });
});
