// Bảng ca GĐ1 — mã ô (bảng 1.2 + chốt GĐ0 số 11, 12). Thuần, không DB, không đồng hồ; mỗi ca xanh khi chạy MỘT MÌNH (luật 18).
import { describe, expect, it } from "vitest";
import { maTongQuat, tinhMaO, xepBuoiVaoCa, type KhungCa, type ViecDay } from "./ma-o";
import { maNen } from "@/lib/parttime/luoi-tuan";

const CA: KhungCa[] = [
  { ma: "S", tu: "07:45", den: "11:30" },
  { ma: "C", tu: "13:45", den: "17:30" },
  { ma: "T", tu: "17:15", den: "21:00" },
];

let n = 0;
const v = (loai: ViecDay["loai"], vai: ViecDay["vai"], gio: string, x: Partial<ViecDay> = {}): ViecDay & { ca: string | null } => {
  const [gioBatDau, gioKetThuc] = gio.split("-") as [string, string];
  return { id: `${loai}-${vai}-${gio}-${++n}`, loai, vai, gioBatDau, gioKetThuc, phongId: "P1", coSoId: "CS1", ...x, ca: x && "ca" in x ? (x as { ca: string | null }).ca : xepBuoiVaoCa({ ca: CA, gioBatDau, gioKetThuc, caCoTruc: [] }) };
};
const o = (ca: string, viec: ReturnType<typeof v>[], truc = false) => tinhMaO({ ca, viecTrongNgay: viec, truc, toiDaTietMoiCa: 2 });

describe("xepBuoiVaoCa — chốt 11", () => {
  it("[XBC-01] việc nằm trọn một ca ⇒ ca đó (giữ hành vi xepVaoCa cũ)", () => {
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "09:00", gioKetThuc: "10:30", caCoTruc: [] })).toBe("S");
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "18:00", gioKetThuc: "19:30", caCoTruc: [] })).toBe("T");
  });
  it("[XBC-02] vắt hai ca ⇒ ca chứa NHIỀU PHÚT hơn", () => {
    // 16:45–18:15: C giữ 45', T giữ 60' ⇒ T.
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "16:45", gioKetThuc: "18:15", caCoTruc: [] })).toBe("T");
    // 16:00–17:45: C 90', T 30' ⇒ C.
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "16:00", gioKetThuc: "17:45", caCoTruc: [] })).toBe("C");
  });
  it("[XBC-03] hoà phút ⇒ ca có người trực", () => {
    // 17:15–17:30 nằm trong cả C lẫn T (15' mỗi bên).
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "17:15", gioKetThuc: "17:30", caCoTruc: ["C"] })).toBe("C");
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "17:15", gioKetThuc: "17:30", caCoTruc: ["T"] })).toBe("T");
  });
  it("[XBC-04] hoà phút, không ca nào (hoặc cả hai) có trực ⇒ ca SAU", () => {
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "17:15", gioKetThuc: "17:30", caCoTruc: [] })).toBe("T");
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "17:15", gioKetThuc: "17:30", caCoTruc: ["C", "T"] })).toBe("T");
  });
  it("[XBC-05] ngoài mọi khung ⇒ null (không đoán); đối chứng: chạm biên một phút vẫn xếp", () => {
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "12:00", gioKetThuc: "13:30", caCoTruc: [] })).toBeNull();
    expect(xepBuoiVaoCa({ ca: CA, gioBatDau: "12:00", gioKetThuc: "13:46", caCoTruc: [] })).toBe("C");
  });
});

describe("tinhMaO — bảng 1.2", () => {
  it("[MAO-01] chỉ ca trực ⇒ T · 0 tiết · trực 1", () => {
    expect(o("C", [], true)).toMatchObject({ ma: "T", tietD: 0, tietTG: 0, trucQuyDoi: 1, coTrungGio: false });
  });
  it("[MAO-02] 1 tiết đứng chính ⇒ D · trực 0", () => {
    expect(o("S", [v("LOP", "MAIN", "09:00-10:30")])).toMatchObject({ ma: "D", tietD: 1, tietTG: 0, trucQuyDoi: 0 });
  });
  it("[MAO-03] 1 tiết trợ giảng ⇒ TG", () => {
    expect(o("S", [v("LOP", "TA", "09:00-10:30")])).toMatchObject({ ma: "TG", tietD: 0, tietTG: 1, trucQuyDoi: 0 });
  });
  it("[MAO-04] đứng chính + trực ⇒ TD · trực 0,5", () => {
    expect(o("C", [v("LOP", "MAIN", "14:00-15:30")], true)).toMatchObject({ ma: "TD", tietD: 1, trucQuyDoi: 0.5 });
  });
  it("[MAO-05] trợ giảng + trực ⇒ TTG · trực 0,5", () => {
    expect(o("C", [v("LOP", "TA", "14:00-15:30")], true)).toMatchObject({ ma: "TTG", tietTG: 1, trucQuyDoi: 0.5 });
  });
  it("[MAO-06] 2 tiết ⇒ D2 / D+TG / TG2, có trực vẫn trực 0", () => {
    expect(o("C", [v("LOP", "MAIN", "14:00-15:30"), v("LOP", "MAIN", "15:45-17:15")], true)).toMatchObject({ ma: "D2", trucQuyDoi: 0 });
    expect(o("C", [v("LOP", "MAIN", "14:00-15:30"), v("LOP", "TA", "15:45-17:15")])).toMatchObject({ ma: "D+TG", trucQuyDoi: 0 });
    expect(o("C", [v("LOP", "TA", "14:00-15:30"), v("LOP", "TA", "15:45-17:15")], true)).toMatchObject({ ma: "TG2", trucQuyDoi: 0 });
  });
  it("[MAO-07] 3 tiết ⇒ D3, có trực vẫn trực 0 (chốt GĐ1 số 6 — không ô nào có tiết mà không có mã)", () => {
    const ba = [v("LOP", "MAIN", "13:45-14:45"), v("LOP", "MAIN", "15:00-16:00"), v("LOP", "MAIN", "16:15-17:15")];
    expect(o("C", ba, true)).toMatchObject({ ma: "D3", tietD: 3, trucQuyDoi: 0 });
  });
  it("[MAO-08] ô trống, không trực ⇒ X · trực 0", () => {
    expect(o("S", [])).toMatchObject({ ma: "X", trucQuyDoi: 0, coTrial: false });
  });
  it("[MAO-09] học bù KHÔNG ghép là tiết đứng chính (D)", () => {
    expect(o("C", [v("BU", "MAIN", "14:00-15:30")], true)).toMatchObject({ ma: "TD", tietD: 1, ghep: [] });
  });
  it("[MAO-10] chỉ tính việc của ĐÚNG ô: việc ở buổi khác không đếm", () => {
    expect(o("S", [v("LOP", "MAIN", "14:00-15:30")])).toMatchObject({ ma: "X", tietD: 0 });
  });
});

describe("tinhMaO — +TR, ghép và trùng giờ (chốt 12)", () => {
  it("[MAO-20] Trial riêng ⇒ cờ +TR, không cộng tiết", () => {
    expect(o("T", [v("TRIAL", "MAIN", "18:00-19:00")], true)).toMatchObject({ ma: "T", tietD: 0, trucQuyDoi: 1, coTrial: true, coTrungGio: false });
  });
  it("[MAO-21] D2 NỐI TIẾP hợp lệ — không cờ", () => {
    expect(o("C", [v("LOP", "MAIN", "14:00-15:30"), v("LOP", "MAIN", "15:30-17:00")])).toMatchObject({ ma: "D2", coTrungGio: false });
  });
  it("[MAO-22] hai lớp chính thức CHỒNG giờ ⇒ cờ đỏ (kể cả cùng phòng)", () => {
    const r = o("C", [v("LOP", "MAIN", "14:00-15:30"), v("LOP", "MAIN", "15:00-16:30")]);
    expect(r).toMatchObject({ ma: "D2", coTrungGio: true });
    expect(r.trungGio).toHaveLength(1);
  });
  it("[MAO-23] Trial trùng khung với lớp của chính GV (cùng phòng) ⇒ D +TR, không D2, không cờ", () => {
    expect(o("S", [v("LOP", "MAIN", "09:45-11:15"), v("TRIAL", "MAIN", "09:45-11:15")])).toMatchObject({ ma: "D", tietD: 1, coTrial: true, coTrungGio: false });
  });
  it("[MAO-24] học bù ghép vào lớp của chính GV (cùng phòng) ⇒ không đổi mã", () => {
    const lop = v("LOP", "MAIN", "09:45-11:15");
    const bu = v("BU", "MAIN", "09:45-11:15");
    expect(o("S", [lop, bu])).toMatchObject({ ma: "D", tietD: 1, ghep: [bu.id], coTrungGio: false });
    // đối chứng: cùng lớp không có học bù ⇒ cũng D.
    expect(o("S", [lop])).toMatchObject({ ma: "D" });
  });
  it("[MAO-25] Trial / học bù chồng giờ với lớp ở PHÒNG KHÁC ⇒ cờ đỏ, và việc đó được đếm (không phải ghép)", () => {
    const r = o("S", [v("LOP", "MAIN", "09:45-11:15"), v("BU", "MAIN", "10:00-11:00", { phongId: "P2" })]);
    expect(r).toMatchObject({ coTrungGio: true, ghep: [], ma: "D2" });
    expect(o("S", [v("LOP", "MAIN", "09:45-11:15"), v("TRIAL", "MAIN", "10:00-11:00", { phongId: "P2" })])).toMatchObject({ coTrungGio: true, ma: "D", coTrial: true });
  });
  it("[MAO-26] chồng giờ với lớp ở CƠ SỞ KHÁC ⇒ cờ đỏ, kể cả ô ở cơ sở kia", () => {
    const lop = v("LOP", "MAIN", "09:45-11:15", { coSoId: "CS1" });
    const tr = v("TRIAL", "MAIN", "09:45-11:15", { coSoId: "CS2" });
    expect(o("S", [lop, tr])).toMatchObject({ coTrungGio: true, ghep: [] });
  });
  it("[MAO-27] chưa biết phòng (null) cùng cơ sở ⇒ coi là ghép, không cờ", () => {
    const r = o("S", [v("LOP", "MAIN", "09:45-11:15"), v("BU", "MAIN", "09:45-11:15", { phongId: null })]);
    expect(r).toMatchObject({ ma: "D", coTrungGio: false });
    expect(r.ghep).toHaveLength(1);
  });
  it("[MAO-28] trùng giờ vắt qua ô: cờ hiện ở CẢ hai ô chứa hai việc", () => {
    const a = v("LOP", "MAIN", "16:00-17:45"); // C (90' vs 30')
    const b = v("LOP", "MAIN", "17:15-18:45"); // T
    expect(o("C", [a, b]).coTrungGio).toBe(true);
    expect(o("T", [a, b]).coTrungGio).toBe(true);
    expect(o("S", [a, b]).coTrungGio).toBe(false);
  });
});

describe("tinhMaO — hai học bù / Trial chồng giờ (chốt GĐ1 số 2)", () => {
  it("[MAO-40] hai học bù cùng phòng chồng giờ ⇒ 1 tiết; việc bắt đầu SỚM hơn là việc chính, việc kia ghép; không phụ thuộc thứ tự mảng", () => {
    const a = v("BU", "MAIN", "14:00-15:30");
    const b = v("BU", "MAIN", "14:30-16:00");
    for (const ds of [[a, b], [b, a]]) {
      const r = o("C", ds, true);
      expect(r).toMatchObject({ ma: "TD", tietD: 1, coTrungGio: false, trucQuyDoi: 0.5 });
      expect(r.ghep).toEqual([b.id]);
    }
  });
  it("[MAO-41] học bù + Trial cùng phòng chồng giờ ⇒ 1 tiết + TR (Trial bắt đầu trước cũng vậy)", () => {
    expect(o("C", [v("BU", "MAIN", "14:00-15:30"), v("TRIAL", "MAIN", "14:00-15:00")])).toMatchObject({ ma: "D", tietD: 1, coTrial: true, coTrungGio: false });
    expect(o("C", [v("TRIAL", "MAIN", "13:45-15:00"), v("BU", "MAIN", "14:00-15:30")])).toMatchObject({ ma: "D", tietD: 1, coTrial: true, coTrungGio: false });
  });
  it("[MAO-42] hai học bù chồng giờ KHÁC phòng ⇒ cờ đỏ, cả hai đếm; khác cơ sở cũng vậy", () => {
    expect(o("C", [v("BU", "MAIN", "14:00-15:30"), v("BU", "MAIN", "14:30-16:00", { phongId: "P2" })])).toMatchObject({ ma: "D2", coTrungGio: true, ghep: [] });
    expect(o("C", [v("BU", "MAIN", "14:00-15:30"), v("BU", "MAIN", "14:30-16:00", { coSoId: "CS2" })])).toMatchObject({ ma: "D2", coTrungGio: true, ghep: [] });
  });
  it("[MAO-43] đối chứng: hai học bù NỐI TIẾP (không chồng) ⇒ D2, không ghép", () => {
    expect(o("C", [v("BU", "MAIN", "14:00-15:30"), v("BU", "MAIN", "15:30-17:00")])).toMatchObject({ ma: "D2", ghep: [], coTrungGio: false });
  });
  it("[MAO-44] cùng giờ bắt đầu: tất định theo id, đúng MỘT việc ghép", () => {
    const a = v("BU", "MAIN", "14:00-15:30", { id: "a" });
    const b = v("BU", "MAIN", "14:00-15:30", { id: "b" });
    expect(o("C", [b, a]).ghep).toEqual(["b"]);
  });
});

describe("tinhMaO — thứ tự việc chính không theo id", () => {
  it("[MAO-45] việc chính là việc BẮT ĐẦU SỚM HƠN kể cả khi id của nó lớn hơn", () => {
    const muon = v("BU", "MAIN", "14:30-16:00", { id: "a" });
    const som = v("BU", "MAIN", "14:00-15:30", { id: "z" });
    expect(o("C", [muon, som]).ghep).toEqual(["a"]);
  });
});

describe("maTongQuat — chốt GĐ1 số 6", () => {
  it("[MAO-30] trùng `maNen` ở MỌI ô ≤ 2 tiết (bảng 1.2 không đổi)", () => {
    for (let m = 0; m <= 2; m++)
      for (let t = 0; t + m <= 2; t++) for (const truc of [false, true]) expect(maTongQuat({ main: m, ta: t, truc })).toBe(maNen({ main: m, ta: t, truc }));
  });
  it("[MAO-31] dạng tổng quát D{n} · TG{n} · D{n}+TG{m}; có trực không thêm T", () => {
    expect(maTongQuat({ main: 3, ta: 0, truc: true })).toBe("D3");
    expect(maTongQuat({ main: 0, ta: 3, truc: false })).toBe("TG3");
    expect(maTongQuat({ main: 2, ta: 1, truc: false })).toBe("D2+TG");
    expect(maTongQuat({ main: 1, ta: 2, truc: true })).toBe("D+TG2");
    expect(maTongQuat({ main: 2, ta: 2, truc: false })).toBe("D2+TG2");
  });
  it("[MAO-32] không ô nào có tiết mà không có mã; trực quy đổi 0 khi tổng ≥ 2", () => {
    for (let m = 0; m <= 5; m++)
      for (let t = 0; t <= 5; t++) {
        expect(maTongQuat({ main: m, ta: t, truc: true })).toMatch(/^(X|T|D\d*|TG\d*|TD|TTG|D\d*\+TG\d*)$/);
      }
    const bon = ["14:00-14:30", "14:40-15:10", "15:20-15:50", "16:00-16:30"].map((g, i) => v("LOP", i % 2 ? "TA" : "MAIN", g));
    expect(o("C", bon, true)).toMatchObject({ ma: "D2+TG2", trucQuyDoi: 0 });
  });
});

describe("tinhMaO — trực quy đổi khi tối đa một ca > 2", () => {
  it("[MAO-33] tổng ≥ 2 tiết ⇒ trực 0 kể cả khi chính sách cho tối đa 3 tiết/ca (chốt GĐ1 số 6); 1 tiết ⇒ 0,5", () => {
    const hai = [v("LOP", "MAIN", "14:00-15:30"), v("LOP", "MAIN", "15:45-17:15")];
    expect(tinhMaO({ ca: "C", viecTrongNgay: hai, truc: true, toiDaTietMoiCa: 3 })).toMatchObject({ ma: "D2", trucQuyDoi: 0 });
    expect(tinhMaO({ ca: "C", viecTrongNgay: hai.slice(0, 1), truc: true, toiDaTietMoiCa: 3 })).toMatchObject({ ma: "TD", trucQuyDoi: 0.5 });
  });
});

describe("cờ vàng “chưa có phòng” — chốt lượt 2 điểm 1 (27/10)", () => {
  it("[MAO-50] học bù / Trial chưa phòng ⇒ cờ VÀNG, KHÔNG đỏ, luật ghép GIỮ nguyên (thiếu phòng vẫn ghép vào lớp cùng cơ sở)", () => {
    const lop = v("LOP", "MAIN", "14:00-15:30");
    const bu = v("BU", "MAIN", "14:00-15:30", { phongId: null });
    const kq = o("C", [lop, bu]);
    expect(kq).toMatchObject({ coChuaPhong: true, coTrungGio: false, ghep: [bu.id], tietD: 1 });
    expect(o("C", [v("TRIAL", "MAIN", "15:00-16:00", { phongId: null })]).coChuaPhong).toBe(true);
  });
  it("[MAO-51] đối chứng: học bù CÓ phòng ⇒ không cờ vàng; lớp chính thức thiếu phòng ⇒ KHÔNG cờ vàng (cờ chỉ cho học bù / Trial)", () => {
    expect(o("C", [v("BU", "MAIN", "14:00-15:30")]).coChuaPhong).toBe(false);
    expect(o("C", [v("LOP", "MAIN", "14:00-15:30", { phongId: null })]).coChuaPhong).toBe(false);
  });
  it("[MAO-52] cờ theo Ô: học bù chưa phòng ở ca T không gắn cờ cho ô C", () => {
    const viec = [v("LOP", "MAIN", "14:00-15:30"), v("BU", "MAIN", "18:00-19:30", { phongId: null })];
    expect(o("C", viec).coChuaPhong).toBe(false);
    expect(o("T", viec).coChuaPhong).toBe(true);
  });
});
