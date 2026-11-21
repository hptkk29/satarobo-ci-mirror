// Bảng ca GĐ1 — cặp quét kỳ vọng (luật 1.5 + chốt GĐ0 số 7, 9). Thuần, không DB, không đồng hồ; mỗi ca xanh khi chạy MỘT MÌNH.
import { describe, expect, it } from "vitest";
import { capQuetKyVong, soMocToiDa } from "./cap-quet-ky-vong";
import { xepBuoiVaoCa, type KhungCa } from "@/lib/phan-cong/ma-o";

const CA: KhungCa[] = [
  { ma: "S", tu: "07:45", den: "11:30" },
  { ma: "C", tu: "13:45", den: "17:30" },
  { ma: "T", tu: "17:15", den: "21:00" },
];
const day = (gio: string, caCoTruc: string[] = []) => {
  const [gioBatDau, gioKetThuc] = gio.split("-") as [string, string];
  return { gioBatDau, gioKetThuc, ca: xepBuoiVaoCa({ ca: CA, gioBatDau, gioKetThuc, caCoTruc }) };
};
const tom = (caTruc: string[], viecDay: ReturnType<typeof day>[] = [], gopDayHoToiDaPhut = 30) =>
  capQuetKyVong({ ca: CA, caTruc, viecDay, gopDayHoToiDaPhut }).map((c) => `${c.ma} ${c.tu}-${c.den} [${c.phuCa.join(",")}]`);

describe("capQuetKyVong — trực", () => {
  it("[CQK-01] trực 1 buổi ⇒ 1 cặp theo giờ ca", () => {
    expect(tom(["S"])).toEqual(["TRUC_S 07:45-11:30 [S]"]);
    expect(tom(["T"])).toEqual(["TRUC_T 17:15-21:00 [T]"]);
  });
  it("[CQK-02] trực C + T ⇒ MỘT cặp 13:45–21:00 phủ cả hai ô", () => {
    expect(tom(["C", "T"])).toEqual(["TRUC_CT 13:45-21:00 [C,T]"]);
  });
  it("[CQK-03] trực S + C ⇒ HAI cặp (khoảng hở trưa)", () => {
    expect(tom(["S", "C"])).toEqual(["TRUC_S 07:45-11:30 [S]", "TRUC_C 13:45-17:30 [C]"]);
  });
  it("[CQK-04] trực S + T ⇒ hai cặp", () => {
    expect(tom(["S", "T"])).toEqual(["TRUC_S 07:45-11:30 [S]", "TRUC_T 17:15-21:00 [T]"]);
  });
  it("[CQK-05] trực cả ngày S + C + T ⇒ S riêng, CT gộp", () => {
    expect(tom(["S", "C", "T"])).toEqual(["TRUC_S 07:45-11:30 [S]", "TRUC_CT 13:45-21:00 [C,T]"]);
  });
  it("[CQK-06] không trực, không dạy ⇒ 0 cặp, trần 0 mốc", () => {
    const c = capQuetKyVong({ ca: CA, caTruc: [], viecDay: [], gopDayHoToiDaPhut: 30 });
    expect(c).toEqual([]);
    expect(soMocToiDa(c)).toBe(0);
  });
  it("[CQK-07] tên cặp không bao giờ trùng mã ca ShiftTemplate (SC, CT, ST…) — luôn có tiền tố TRUC_/DAY_", () => {
    for (const truc of [["S"], ["C", "T"], ["S", "C"], ["S", "C", "T"]])
      for (const c of capQuetKyVong({ ca: CA, caTruc: truc, viecDay: [day("09:00-10:30")], gopDayHoToiDaPhut: 30 })) expect(c.ma).toMatch(/^(TRUC|DAY)_[SCT]+(_\d+)?$/);
  });
});

describe("capQuetKyVong — dạy", () => {
  it("[CQK-10] chỉ dạy một buổi ⇒ 1 cặp quanh giờ dạy (vào trước giờ đầu, ra sau giờ cuối)", () => {
    expect(tom([], [day("09:00-10:30")])).toEqual(["DAY_S 09:00-10:30 [S]"]);
    expect(tom([], [day("14:00-15:30"), day("15:45-17:15")])).toEqual(["DAY_C 14:00-17:15 [C]"]);
  });
  it("[CQK-11] dạy trong buổi đang trực ⇒ 0 cặp thêm (dùng cặp trực)", () => {
    expect(tom(["C"], [day("14:00-15:30")])).toEqual(["TRUC_C 13:45-17:30 [C]"]);
    expect(tom(["C", "T"], [day("14:00-15:30"), day("18:00-19:30")])).toEqual(["TRUC_CT 13:45-21:00 [C,T]"]);
  });
  it("[CQK-12] dạy ba buổi không trực ⇒ 3 cặp, trần 6 mốc (chốt 9 — không còn hằng 4)", () => {
    const c = capQuetKyVong({ ca: CA, caTruc: [], viecDay: [day("08:00-09:30"), day("14:00-15:30"), day("18:00-19:30")], gopDayHoToiDaPhut: 30 });
    expect(c.map((x) => x.ma)).toEqual(["DAY_S", "DAY_C", "DAY_T"]);
    expect(soMocToiDa(c)).toBe(6);
  });
  it("[CQK-13] trực S + dạy chiều không trực ⇒ cặp trực S + cặp dạy C", () => {
    expect(tom(["S"], [day("14:00-15:30")])).toEqual(["TRUC_S 07:45-11:30 [S]", "DAY_C 14:00-15:30 [C]"]);
  });
  it("[CQK-14] việc dạy vượt khung trực (xếp vào ô trực theo số phút) ⇒ cặp trực dãn ra phủ hết", () => {
    // 16:00–17:45: C 90' > T 30' ⇒ ô C, nhưng kết thúc 17:45 > 17:30.
    expect(tom(["C"], [day("16:00-17:45")])).toEqual(["TRUC_C 13:45-17:45 [C]"]);
  });
  it("[CQK-15] việc ngoài mọi khung (ca null) không sinh cặp", () => {
    expect(tom([], [day("12:00-13:30")])).toEqual([]);
  });
  it("[CQK-16] thứ tự cặp theo giờ, mỗi ô thuộc đúng một cặp", () => {
    const c = capQuetKyVong({ ca: CA, caTruc: ["T"], viecDay: [day("08:00-09:30"), day("14:00-15:30")], gopDayHoToiDaPhut: 30 });
    expect(c.map((x) => x.ma)).toEqual(["DAY_S", "DAY_C", "TRUC_T"]);
    expect(c.flatMap((x) => x.phuCa).sort()).toEqual(["C", "S", "T"]);
  });
  it("[CQK-17] dạy BẮT ĐẦU trước giờ trực (xếp vào ô trực) ⇒ cặp trực dãn về đầu (chốt GĐ1 số 3)", () => {
    // 13:15–14:45: S 0', C 60' ⇒ ô C; bắt đầu 13:15 < 13:45.
    expect(tom(["C"], [day("13:15-14:45")])).toEqual(["TRUC_C 13:15-17:30 [C]"]);
    // vượt cả hai đầu
    expect(tom(["C"], [day("13:15-14:45"), day("16:00-17:45")])).toEqual(["TRUC_C 13:15-17:45 [C]"]);
  });
});

describe("capQuetKyVong — gộp hai đoạn dạy không trực (chốt GĐ1 số 4)", () => {
  it("[CQK-20] hai đoạn CHẠM nhau ⇒ một cặp", () => {
    expect(tom([], [day("14:00-17:15"), day("17:15-18:45")])).toEqual(["DAY_CT 14:00-18:45 [C,T]"]);
  });
  it("[CQK-21] hở đúng 30' ⇒ gộp", () => {
    expect(tom([], [day("14:00-16:45"), day("17:15-18:45")])).toEqual(["DAY_CT 14:00-18:45 [C,T]"]);
  });
  it("[CQK-22] hở 31' ⇒ tách", () => {
    expect(tom([], [day("14:00-16:44"), day("17:15-18:45")])).toEqual(["DAY_C 14:00-16:44 [C]", "DAY_T 17:15-18:45 [T]"]);
  });
  it("[CQK-23] ngưỡng đọc từ tham số, không hằng: ngưỡng 0 ⇒ hở 30' tách; ngưỡng 60 ⇒ hở 31' gộp", () => {
    expect(tom([], [day("14:00-16:45"), day("17:15-18:45")], 0)).toHaveLength(2);
    expect(tom([], [day("14:00-16:44"), day("17:15-18:45")], 60)).toEqual(["DAY_CT 14:00-18:45 [C,T]"]);
  });
  it("[CQK-24] cặp dạy KHÔNG gộp vào cặp trực liền kề (trực C + dạy T hở 0') — chỉ gộp dạy với dạy", () => {
    expect(tom(["C"], [day("17:30-19:00")])).toEqual(["TRUC_C 13:45-17:30 [C]", "DAY_T 17:30-19:00 [T]"]);
  });
  it("[CQK-26] trong MỘT buổi, hai đoạn dạy hở 31' ⇒ HAI cặp cùng phủ ô đó, mã không trùng", () => {
    expect(tom([], [day("13:45-15:15"), day("15:46-17:15")])).toEqual(["DAY_C 13:45-15:15 [C]", "DAY_C_2 15:46-17:15 [C]"]);
  });
  it("[CQK-27] trong MỘT buổi, hở đúng 30' ⇒ một cặp", () => {
    expect(tom([], [day("13:45-15:15"), day("15:45-17:15")])).toEqual(["DAY_C 13:45-17:15 [C]"]);
  });
  it("[CQK-25] trần mốc theo cặp SAU KHI gộp: dạy C + T hở 10' ⇒ 1 cặp, 2 mốc", () => {
    const c = capQuetKyVong({ ca: CA, caTruc: [], viecDay: [day("14:00-17:05"), day("17:15-18:45")], gopDayHoToiDaPhut: 30 });
    expect(soMocToiDa(c)).toBe(2);
  });
});
