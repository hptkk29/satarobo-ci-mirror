// [CO-*] Công parttime tự động theo ô (GĐ6). Thuần, mốc tuyệt đối, mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import type { CapQuet } from "@/lib/cham-cong/cap-quet-ky-vong";
import { danhGiaCap, luatKy, tranMocNgay, trangThaiO } from "./cong-o";

const p = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const TRUC_C: CapQuet = { ma: "TRUC_C", loai: "TRUC", tu: "13:45", den: "17:30", phuCa: ["C"] };
const DAY_T: CapQuet = { ma: "DAY_T", loai: "DAY", tu: "18:00", den: "19:30", phuCa: ["T"] };
const DS = { treVaoPhut: 5, veSomPhut: 5 };

describe("luatKy / tranMocNgay — chốt 8, 9", () => {
  it("[CO-01] kỳ ≤ 10/2026 ⇒ luật CŨ; từ 11/2026 ⇒ MỚI", () => {
    expect(luatKy("2026-10", "2026-11")).toBe("CU");
    expect(luatKy("2026-11", "2026-11")).toBe("MOI");
    expect(luatKy("2027-01", "2026-11")).toBe("MOI");
    // SÀN: cài đặt sớm hơn 2026-11 vẫn không kéo kỳ 10 sang luật mới (chốt 8).
    expect(luatKy("2026-10", "2026-01")).toBe("CU");
    // Dời ranh giới: cài đặt 2026-12 ⇒ kỳ 11 về luật cũ.
    expect(luatKy("2026-11", "2026-12")).toBe("CU");
    // Cài đặt rỗng / hỏng ⇒ luật mới TẮT mọi kỳ.
    expect(luatKy("2027-01", null)).toBe("CU");
    expect(luatKy("2027-01", "2026-13")).toBe("CU");
  });
  it("[CO-02] khoá hỏng / rỗng / tháng 13 ⇒ luật CŨ (không bao giờ đoán là mới)", () => {
    for (const k of ["", "2026-13", "2026-11-01", "abc", "2026-1"]) expect(luatKy(k, "2026-11")).toBe("CU");
  });
  it("[CO-03] trần mốc: luật mới = số cặp × 2; luật cũ = hằng cũ (đối chứng cùng đầu vào)", () => {
    const cap = [TRUC_C, DAY_T, { ...DAY_T, ma: "DAY_S", tu: "08:00", den: "09:30", phuCa: ["S"] }];
    expect(tranMocNgay({ periodKey: "2026-11", tuKy: "2026-11", cap, hangCu: 4 })).toBe(6);
    expect(tranMocNgay({ periodKey: "2026-10", tuKy: "2026-11", cap, hangCu: 4 })).toBe(4);
  });
});

describe("danhGiaCap", () => {
  it("[CO-10] vào trước, ra sau ⇒ đủ; vào muộn quá dung sai ⇒ VAO_MUON; trong dung sai ⇒ đủ", () => {
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:40"), den: p("17:35") }], dungSai: DS, chuanBiPhut: 10 })[0]).toMatchObject({ du: true });
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:50"), den: p("17:35") }], dungSai: DS, chuanBiPhut: 10 })[0]).toMatchObject({ du: true });
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:51"), den: p("17:35") }], dungSai: DS, chuanBiPhut: 10 })[0]).toMatchObject({ du: false, lyDo: ["VAO_MUON"] });
  });
  it("[CO-11] cặp DẠY tính cả thời gian chuẩn bị: dạy 18:00, chuẩn bị 10′, dung sai 5′ ⇒ vào 17:55 kịp, 17:56 muộn", () => {
    expect(danhGiaCap({ cap: [DAY_T], khoang: [{ tu: p("17:56"), den: p("19:40") }], dungSai: DS, chuanBiPhut: 10 })[0]!.lyDo).toEqual(["VAO_MUON"]);
    expect(danhGiaCap({ cap: [DAY_T], khoang: [{ tu: p("17:55"), den: p("19:40") }], dungSai: DS, chuanBiPhut: 10 })[0]!.du).toBe(true);
    // cặp TRỰC không trừ chuẩn bị: vào 13:50 cho trực 13:45 vẫn kịp (dung sai 5′)
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:50"), den: p("17:35") }], dungSai: DS, chuanBiPhut: 10 })[0]!.du).toBe(true);
  });
  it("[CO-12] khoảng mở (chưa ra) ⇒ THIEU_RA; ra sớm quá dung sai ⇒ RA_SOM; không lượt nào ⇒ thiếu cả hai", () => {
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:40"), den: null }], dungSai: DS, chuanBiPhut: 10 })[0]!.lyDo).toEqual(["THIEU_RA"]);
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:40"), den: p("17:20") }], dungSai: DS, chuanBiPhut: 10 })[0]!.lyDo).toEqual(["RA_SOM"]);
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("08:00"), den: p("10:00") }], dungSai: DS, chuanBiPhut: 10 })[0]!.lyDo).toEqual(["THIEU_VAO", "THIEU_RA"]);
  });
  it("[CO-13] hai khoảng trong một cặp (ra giữa giờ rồi vào lại) ⇒ vào sớm nhất, ra muộn nhất", () => {
    expect(danhGiaCap({ cap: [TRUC_C], khoang: [{ tu: p("13:40"), den: p("15:00") }, { tu: p("15:10"), den: p("17:40") }], dungSai: DS, chuanBiPhut: 10 })[0]!.du).toBe(true);
  });
});

describe("trangThaiO", () => {
  const o = (ma: string, x: Partial<{ coTrial: boolean; coTrungGio: boolean }> = {}) => ({ ma: ma as never, coTrial: false, coTrungGio: false, ...x });
  it("[CO-20] ô X không Trial ⇒ không có việc; X có Trial ⇒ vẫn phải xét", () => {
    expect(trangThaiO({ ca: "C", o: o("X"), cap: [], danhGia: [] }).trangThai).toBe("KHONG_CO_VIEC");
    expect(trangThaiO({ ca: "C", o: o("X", { coTrial: true }), cap: [], danhGia: [] })).toEqual({ trangThai: "CAN_XEM", lyDo: ["KHONG_CO_CAP"] });
  });
  it("[CO-21] mọi cặp phủ ô đủ ⇒ TỰ ĐỘNG; một cặp thiếu ⇒ CẦN XEM kèm lý do", () => {
    expect(trangThaiO({ ca: "C", o: o("T"), cap: [TRUC_C], danhGia: [{ ma: "TRUC_C", du: true, lyDo: [] }] })).toEqual({ trangThai: "TU_DONG", lyDo: [] });
    expect(trangThaiO({ ca: "C", o: o("T"), cap: [TRUC_C], danhGia: [{ ma: "TRUC_C", du: false, lyDo: ["RA_SOM"] }] })).toEqual({ trangThai: "CAN_XEM", lyDo: ["RA_SOM"] });
  });
  it("[CO-22] cặp KHÔNG phủ ô thì không ảnh hưởng ô (cặp tối thiếu không làm ô chiều phải xem)", () => {
    expect(trangThaiO({ ca: "C", o: o("T"), cap: [TRUC_C, DAY_T], danhGia: [{ ma: "TRUC_C", du: true, lyDo: [] }, { ma: "DAY_T", du: false, lyDo: ["THIEU_VAO"] }] }).trangThai).toBe("TU_DONG");
  });
  it("[CO-23] cờ trùng giờ ⇒ luôn CẦN XEM kể cả quét đủ", () => {
    expect(trangThaiO({ ca: "C", o: o("D2", { coTrungGio: true }), cap: [TRUC_C], danhGia: [{ ma: "TRUC_C", du: true, lyDo: [] }] })).toEqual({ trangThai: "CAN_XEM", lyDo: ["TRUNG_GIO"] });
  });
  it("[CO-24] chưa có đánh giá cho cặp phủ ô ⇒ coi như thiếu (không cho qua mù)", () => {
    expect(trangThaiO({ ca: "C", o: o("T"), cap: [TRUC_C], danhGia: [] }).trangThai).toBe("CAN_XEM");
  });
});
