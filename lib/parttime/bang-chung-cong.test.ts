// [P4-*] Công Parttime SR.QD.238 · P4 — luật THUẦN gắn chấm công vào phân công. Đồng hồ ĐÓNG BĂNG (luật 19).
import { describe, expect, it } from "vitest";
import {
  danhGiaBangChung,
  khoangCoMatTrongNgay,
  luotKhongGan,
  ngoaiLeCapBuoi,
  type DauVaoBangChung,
  type KhoangCoMat,
  type LuotQuetHopLe,
} from "./bang-chung-cong";

const vn = (hhmm: string, ymd = "2026-11-02") => new Date(`${ymd}T${hhmm}:00+07:00`);
const CS = "cs1";
let soLuot = 0;
const luot = (direction: "CHECK_IN" | "CHECK_OUT", hhmm: string, p: Partial<LuotQuetHopLe> = {}): LuotQuetHopLe => ({
  id: `l${++soLuot}`,
  loggedAt: vn(hhmm),
  direction,
  centerId: CS,
  flags: [],
  ...p,
});
const khoang = (...ds: LuotQuetHopLe[]) => khoangCoMatTrongNgay(ds, 2);

/** Buổi 18:00–19:30, chuẩn bị 10' ⇒ phải có mặt 17:50. Mặc định: MAIN, đã nhận, buổi ĐÃ CHỐT, người dạy = chính mình, now 21:00. */
type TuyChon = {
  khoang?: KhoangCoMat[];
  now?: Date;
  dungSai?: DauVaoBangChung["dungSai"];
  daNhan?: boolean;
  chuanBiPhut?: number | null;
  pc?: Partial<DauVaoBangChung["phanCong"]>;
  buoi?: Partial<DauVaoBangChung["buoi"]>;
};
const vao = (p: TuyChon = {}): DauVaoBangChung => ({
  phanCong: {
    id: "pc1",
    phienBan: 1,
    userId: "gv",
    role: "MAIN_TEACHER",
    status: "ACCEPTED",
    activity: "REGULAR_CLASS",
    sourceType: "CLASS_SESSION",
    sourceId: "s1",
    centerId: CS,
    ngay: "2026-11-02",
    gioBatDau: "18:00",
    gioKetThuc: "19:30",
    ...p.pc,
  },
  daNhan: p.daNhan ?? true,
  graceCutover: false,
  buoi: { tinhTrang: "DA_CHOT", apDung: true, nguoiDay: { id: "gv", nguon: "actualTeacherId" }, ...p.buoi },
  chuanBiPhut: p.chuanBiPhut === undefined ? 10 : p.chuanBiPhut,
  chinhSach: "SR.QD.238",
  khoang: p.khoang ?? [],
  dungSai: p.dungSai ?? { treVaoPhut: 0, veSomPhut: 0 },
  now: p.now ?? vn("21:00"),
});

describe("[P4] khoảng có mặt", () => {
  it("[P4-03] VÀO-RA-VÀO-RA ra HAI khoảng — không bịa có mặt lúc vắng giữa ngày", () => {
    const k = khoang(luot("CHECK_IN", "13:40"), luot("CHECK_OUT", "15:00"), luot("CHECK_IN", "17:45"), luot("CHECK_OUT", "19:35"));
    expect(k.map((x) => [x.tu.toISOString(), x.den?.toISOString()])).toEqual([
      [vn("13:40").toISOString(), vn("15:00").toISOString()],
      [vn("17:45").toISOString(), vn("19:35").toISOString()],
    ]);
    // Buổi 15:30–17:00 nằm trong khoảng VẮNG ⇒ không có bằng chứng (vào đầu – ra cuối sẽ bịa ra có mặt).
    const r = danhGiaBangChung(vao({ khoang: k, pc: { gioBatDau: "15:30", gioKetThuc: "17:00" } }));
    expect(r.trangThai).toBe("KHONG_BANG_CHUNG");
    expect(r.ngoaiLe).toContain("ASSIGNED_NO_ATTENDANCE");
  });

  it("[P4-03b] bấm trùng trong 2 phút bị bỏ như bảng công; RA không VÀO bị bỏ", () => {
    const k = khoang(luot("CHECK_OUT", "12:00"), luot("CHECK_IN", "17:40"), luot("CHECK_IN", "17:41"), luot("CHECK_OUT", "19:40"));
    expect(k.length).toBe(1);
    expect(k[0].tu.toISOString()).toBe(vn("17:40").toISOString());
  });
});

describe("[P4] khoảng có mặt — tất định", () => {
  it("[P4-03c] lượt CÙNG PHÚT (bấm đúp / ba buổi chung một cặp lượt): `inId`/`outId` KHÔNG phụ thuộc thứ tự đầu vào (thứ tự hàng Postgres)", () => {
    const v1 = luot("CHECK_IN", "17:45", { id: "a1" });
    const v2 = luot("CHECK_IN", "17:45", { id: "a2" });
    const v3 = luot("CHECK_IN", "17:45", { id: "a3" });
    const r1 = luot("CHECK_OUT", "19:35", { id: "b1" });
    const r2 = luot("CHECK_OUT", "19:35", { id: "b2" });
    const thuan = khoang(v1, v2, v3, r1, r2);
    expect(thuan.map((k) => [k.inId, k.outId])).toEqual([["a1", "b1"]]);
    for (const dao of [[v3, v2, v1, r2, r1], [r2, v2, r1, v3, v1], [v2, r1, v1, r2, v3]]) expect(khoang(...dao)).toEqual(thuan);
    // Giờ ghi khác nhau trong cùng phút ⇒ lượt SỚM hơn thắng, không theo id.
    const som = luot("CHECK_IN", "17:45", { id: "z9", loggedAt: new Date(vn("17:45").getTime() + 5_000) });
    const muon = luot("CHECK_IN", "17:45", { id: "a0", loggedAt: new Date(vn("17:45").getTime() + 40_000) });
    expect(khoang(muon, som)[0].inId).toBe("z9");
  });
});

describe("[P4] đánh giá một phân công", () => {
  it("[P4-01] một VÀO/RA phủ trọn buổi ⇒ DU_BANG_CHUNG, có dòng dõi id lượt", () => {
    const vaoL = luot("CHECK_IN", "17:46");
    const raL = luot("CHECK_OUT", "19:35");
    const r = danhGiaBangChung(vao({ khoang: khoang(vaoL, raL) }));
    expect(r).toMatchObject({ trangThai: "DU_BANG_CHUNG", coMat: "DU", treVaoPhut: 0, raSomPhut: 0, khopNguoiDay: "KHOP", ngoaiLe: [] });
    expect(r.requiredFrom?.toISOString()).toBe(vn("17:50").toISOString());
    expect(r.dongDoi).toMatchObject({ attendanceInId: vaoL.id, attendanceOutId: raL.id, nguoiDayId: "gv", nguonNguoiDay: "actualTeacherId", chinhSach: "SR.QD.238" });
  });

  it("[P4-02] MỘT khoảng 13:40–21:05 là bằng chứng cho BA phân công trong ngày (không đòi mỗi buổi một lượt)", () => {
    const k = khoang(luot("CHECK_IN", "13:40"), luot("CHECK_OUT", "21:05"));
    const ca = [
      ["14:00", "15:30", "MAIN_TEACHER"],
      ["16:00", "17:30", "TEACHING_ASSISTANT"],
      ["18:00", "19:30", "MAIN_TEACHER"],
    ] as const;
    const r = ca.map(([a, b, role], i) => danhGiaBangChung(vao({ khoang: k, pc: { id: `pc${i}`, sourceId: `s${i}`, gioBatDau: a, gioKetThuc: b, role } })));
    expect(r.map((x) => x.trangThai)).toEqual(["DU_BANG_CHUNG", "DU_BANG_CHUNG", "DU_BANG_CHUNG"]);
    expect(new Set(r.map((x) => x.dongDoi.attendanceInId)).size).toBe(1);
  });

  it("[P4-04] phải có mặt 17:50, vào 17:56 ⇒ trễ 6', DI_MUON (dung sai 0); dung sai 10' ⇒ vẫn báo 6' nhưng không gắn muộn", () => {
    const k = khoang(luot("CHECK_IN", "17:56"), luot("CHECK_OUT", "19:35"));
    expect(danhGiaBangChung(vao({ khoang: k }))).toMatchObject({ trangThai: "DI_MUON", treVaoPhut: 6, diMuon: true });
    expect(danhGiaBangChung(vao({ khoang: k })).ngoaiLe).toContain("LATE");
    expect(danhGiaBangChung(vao({ khoang: k, dungSai: { treVaoPhut: 10, veSomPhut: 0 } }))).toMatchObject({ trangThai: "DU_BANG_CHUNG", treVaoPhut: 6, diMuon: false });
  });

  it("[P4-05] có mặt 17:45–19:00 cho buổi đến 19:30 ⇒ vào ĐÚNG giờ, ra sớm 30' (không chia tiền)", () => {
    const r = danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:45"), luot("CHECK_OUT", "19:00")) }));
    expect(r).toMatchObject({ trangThai: "RA_SOM", diMuon: false, treVaoPhut: 0, raSom: true, raSomPhut: 30, coMat: "DU" });
    expect(r.ngoaiLe).toContain("EARLY_LEAVE");
  });

  it("[P4-06] có VÀO không có RA: trong buổi ⇒ DA_VAO; hết buổi ⇒ THIEU_RA + MISSING_CHECKOUT (không bịa có mặt cả ngày)", () => {
    const k = khoang(luot("CHECK_IN", "17:48"));
    expect(danhGiaBangChung(vao({ khoang: k, now: vn("18:30"), buoi: { tinhTrang: "MO" } }))).toMatchObject({ trangThai: "DA_VAO", coMat: "DANG_O" });
    const r = danhGiaBangChung(vao({ khoang: k }));
    expect(r).toMatchObject({ trangThai: "THIEU_RA", coMat: "THIEU_RA", checkOutAt: null });
    expect(r.ngoaiLe).toContain("MISSING_CHECKOUT");
  });

  it("[P4-07][P4-08] lượt bị TỪ CHỐI / đã THAY không bao giờ tới engine (bộ lọc ở nơi đọc) — engine không có đường tự đưa chúng vào", () => {
    // Bằng chứng ở đây: không có khoảng ⇒ không có bằng chứng; lọc REJECTED/DISMISSED được ghim ở tầng DB ([P4-DB-05/06]).
    expect(danhGiaBangChung(vao({ khoang: [] })).trangThai).toBe("KHONG_BANG_CHUNG");
  });

  it("[P4-09] MAIN đã nhận, buổi chốt, người dạy là chính mình ⇒ KHOP", () => {
    expect(danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40")) })).khopNguoiDay).toBe("KHOP");
  });

  it("[P4-10] MAIN A đã nhận nhưng người dạy là B ⇒ SAI_NGUOI_DUNG_LOP dù A có chấm công đầy đủ", () => {
    const r = danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40")), buoi: { nguoiDay: { id: "B", nguon: "actualTeacherId" } } }));
    expect(r).toMatchObject({ trangThai: "SAI_NGUOI_DUNG_LOP", khopNguoiDay: "LECH", coMat: "DU" });
    expect(r.ngoaiLe).toContain("MAIN_ACTUAL_MISMATCH");
  });

  it("[P4-11] trợ giảng KHÔNG cần trùng người dạy thực tế (người dạy là GV khác vẫn DU_BANG_CHUNG)", () => {
    const r = danhGiaBangChung(vao({ pc: { role: "TEACHING_ASSISTANT" }, khoang: khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40")), buoi: { nguoiDay: { id: "GV-chinh", nguon: "actualTeacherId" } } }));
    expect(r).toMatchObject({ trangThai: "DU_BANG_CHUNG", khopNguoiDay: "KHONG_XET" });
  });

  it("[P4-12] buổi đã HUỶ ⇒ không có ứng viên thực hiện; có mặt trong khung chỉ thành ngoại lệ đối soát", () => {
    const r = danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40")), buoi: { tinhTrang: "DA_DONG" } }));
    expect(r).toMatchObject({ trangThai: "BUOI_DA_HUY", coMat: "KHONG_XET" });
    expect(r.ngoaiLe).toEqual(["SESSION_CANCELLED_WITH_ATTENDANCE"]);
    expect(danhGiaBangChung(vao({ buoi: { tinhTrang: "DA_DONG" } })).ngoaiLe).toEqual([]);
  });

  it("[P4-13][P4-14] trial vẫn là TRIAL, học bù vẫn là MAKEUP — engine không đổi hoạt động", () => {
    const k = khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40"));
    expect(danhGiaBangChung(vao({ khoang: k, pc: { sourceType: "TRIAL_SESSION", activity: "TRIAL" }, buoi: { nguoiDay: { id: "gv", nguon: "trial.teacherId" } } })).activity).toBe("TRIAL");
    expect(danhGiaBangChung(vao({ khoang: k, pc: { sourceType: "MAKEUP_CASE", activity: "MAKEUP" }, buoi: { nguoiDay: { id: "gv", nguon: "makeup.teacherId" } } })).activity).toBe("MAKEUP");
  });

  it("[P4-15] ngày LEGACY (trước 15/10) ⇒ KHONG_AP_DUNG, không xét gì", () => {
    const r = danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:40")), buoi: { apDung: false }, chuanBiPhut: null }));
    expect(r).toMatchObject({ trangThai: "KHONG_AP_DUNG", coMat: "KHONG_XET", ngoaiLe: [], requiredFrom: null });
  });

  it("[P4-16] khoảng ở cơ sở KHÁC không gắn được; nêu PRESENT_AT_OTHER_CENTER", () => {
    const r = danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:40", { centerId: "cs2" }), luot("CHECK_OUT", "19:40", { centerId: "cs2" })) }));
    expect(r.trangThai).toBe("KHONG_BANG_CHUNG");
    expect(r.ngoaiLe).toEqual(expect.arrayContaining(["PRESENT_AT_OTHER_CENTER", "ASSIGNED_NO_ATTENDANCE"]));
  });

  it("[P4-17] chưa tới giờ phải có mặt ⇒ CHUA_DEN_GIO; nhận PHIÊN BẢN CŨ ⇒ coi như chưa nhận", () => {
    expect(danhGiaBangChung(vao({ now: vn("17:00"), buoi: { tinhTrang: "MO" } })).trangThai).toBe("CHUA_DEN_GIO");
    const r = danhGiaBangChung(vao({ daNhan: false, khoang: khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40")) }));
    expect(r.ngoaiLe).toContain("ASSIGNMENT_NOT_ACCEPTED");
    expect(r.daNhan).toBe(false);
  });

  it("[P4-18] buổi chưa chốt mà đã hết giờ + đã nhận ⇒ ASSIGNMENT_ACCEPTED_BUT_SESSION_NOT_RUN; cảnh báo thiết bị CHỈ là cảnh báo", () => {
    const k = khoang(luot("CHECK_IN", "17:40", { flags: ["THIET_BI_CHUA_TIN_CAY"] }), luot("CHECK_OUT", "19:40"));
    const r = danhGiaBangChung(vao({ khoang: k, buoi: { tinhTrang: "MO" } }));
    expect(r.ngoaiLe).toContain("ASSIGNMENT_ACCEPTED_BUT_SESSION_NOT_RUN");
    expect(r.canhBaoLuot).toEqual(["THIET_BI_CHUA_TIN_CAY"]);
    expect(r.trangThai).toBe("DU_BANG_CHUNG");
  });

  it("[P4-19] dấu vân: cùng đầu vào ⇒ cùng dấu; đổi phiên bản / lượt ra / người dạy ⇒ đổi dấu", () => {
    const k = khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40"));
    const a = danhGiaBangChung(vao({ khoang: k }));
    expect(danhGiaBangChung(vao({ khoang: k })).dauVan).toBe(a.dauVan);
    expect(danhGiaBangChung(vao({ khoang: k, pc: { phienBan: 2 } })).dauVan).not.toBe(a.dauVan);
    expect(danhGiaBangChung(vao({ khoang: k, buoi: { nguoiDay: { id: "B", nguon: "actualTeacherId" } } })).dauVan).not.toBe(a.dauVan);
    expect(danhGiaBangChung(vao({ khoang: khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:50")) })).dauVan).not.toBe(a.dauVan);
  });
});

describe("[P4] ngoại lệ ngoài từng phân công", () => {
  it("[P4-20] buổi chốt mà không có GV đứng chính đã nhận; TA mặc định có mặt mà không có phân công TA", () => {
    const k = khoang(luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40"));
    const base = { sourceType: "CLASS_SESSION" as const, sourceId: "s1", centerId: CS, apDung: true, requiredFrom: vn("17:50"), requiredTo: vn("19:30"), macDinhTaId: "ta", khoangTaMacDinh: k, now: vn("21:00") };
    expect(ngoaiLeCapBuoi({ ...base, tinhTrang: "DA_CHOT", coMainDaNhan: false, coTaSong: false }).map((x) => x.ma)).toEqual([
      "SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN",
      "TA_PRESENT_WITHOUT_ASSIGNMENT",
    ]);
    expect(ngoaiLeCapBuoi({ ...base, tinhTrang: "DA_CHOT", coMainDaNhan: true, coTaSong: true })).toEqual([]);
  });

  it("[P4-21] có mặt ngoài mọi khung phân công ⇒ UNMATCHED_ATTENDANCE (ngữ cảnh, không phải lỗi); trong khung thì không", () => {
    const k = khoang(luot("CHECK_IN", "08:00"), luot("CHECK_OUT", "11:00"), luot("CHECK_IN", "17:40"), luot("CHECK_OUT", "19:40"));
    const ra = luotKhongGan({ userId: "gv", workDate: "2026-11-02", centerId: CS, khoang: k, khungPhanCong: [{ tu: vn("17:50"), den: vn("19:30") }], now: vn("21:00") });
    expect(ra.map((x) => x.tu.toISOString())).toEqual([vn("08:00").toISOString()]);
  });
});
