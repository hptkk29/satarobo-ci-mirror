/**
 * lib/cham-cong/gio-ca.test.ts — chuỗi giờ vào/ra của mã ca.
 *
 * Số giờ trong ca test lấy THẲNG từ `docs/cham-cong/BANG-MA-CA-CHOT.md`, không bịa: ca thật
 * mới phơi ra ranh giới thật (fixture tròn trịa không kiểm được gì).
 */
import { describe, expect, it } from "vitest";
import { dongGioCa, gioTuSegments, locMaCaDaDung, motDongGioCa } from "./gio-ca";

const W = (start: string, end: string) => ({ start, end, kind: "WORK" });
const NGHI_CO_CONG = (start: string, end: string) => ({ start, end, kind: "PAID_BREAK" });

describe("gioTuSegments", () => {
  it("HC: hai đoạn rời nhau, nối bằng dấu chấm giữa", () => {
    expect(gioTuSegments([W("08:00", "11:30"), W("13:30", "17:30")])).toBe(
      "08:00–11:30 · 13:30–17:30",
    );
  });

  it("KHÔNG in đoạn nghỉ-có-tính-công (CT 16:30–17:30)", () => {
    // Người xếp ca hỏi "ca này làm từ mấy giờ tới mấy giờ", không hỏi cấu trúc đoạn. In cả
    // nghỉ vào là biến một câu trả lời thành một bài đọc.
    expect(gioTuSegments([W("13:45", "16:30"), NGHI_CO_CONG("16:30", "17:30"), W("17:30", "21:00")])).toBe(
      "13:45–16:30 · 17:30–21:00",
    );
  });

  it("mã không có đoạn giờ (LD · X · P) ⇒ chuỗi rỗng, KHÔNG ném", () => {
    expect(gioTuSegments([])).toBe("");
    expect(gioTuSegments(null)).toBe("");
    expect(gioTuSegments(undefined)).toBe("");
    // `segments` là cột Json — dữ liệu cũ có thể là object, không phải mảng.
    expect(gioTuSegments({ start: "08:00" })).toBe("");
  });

  it("đoạn thiếu start/end bị bỏ qua, không in 'undefined–undefined'", () => {
    expect(gioTuSegments([W("08:00", "11:30"), { kind: "WORK" }])).toBe("08:00–11:30");
  });
});

describe("motDongGioCa — dòng hiện khi rê chuột vào ô mã ca", () => {
  const hc = dongGioCa([
    { code: "HC", name: "Giờ hành chính", segments: [W("08:00", "11:30"), W("13:30", "17:30")], dayCredit: 1, soCapQuetKyVong: 2 },
  ])[0];

  it("gộp đủ mã · tên · giờ · công · số lần chấm", () => {
    expect(motDongGioCa(hc)).toBe("HC · Giờ hành chính · 08:00–11:30 · 13:30–17:30 · 1 công · 2 lần chấm/ngày");
  });

  it("mã không kiểm số lượt quét (0) ⇒ KHÔNG in phần lần chấm", () => {
    const ld = dongGioCa([
      { code: "LD", name: "Làm từ xa", segments: [], dayCredit: 1, soCapQuetKyVong: 0 },
    ])[0];
    expect(motDongGioCa(ld)).toBe("LD · Làm từ xa · 1 công");
  });

  it("không biết mã ⇒ null, để người gọi ĐỂ TRỐNG tooltip", () => {
    // Một tooltip nói "không rõ" tệ hơn không có tooltip: nó khẳng định hệ thống đã tra và chịu.
    expect(motDongGioCa(undefined)).toBeNull();
  });
});

describe("dongGioCa", () => {
  it("giữ nguyên thứ tự truyền vào (page đã sắp theo displayOrder)", () => {
    const r = dongGioCa([
      { code: "CG", name: "Ca gãy", segments: [W("09:00", "11:30")], dayCredit: 1, soCapQuetKyVong: 1 },
      { code: "S", name: "Ca sáng", segments: [W("07:45", "11:30")], dayCredit: 0.5, soCapQuetKyVong: 1 },
    ]);
    expect(r.map((x) => x.code)).toEqual(["CG", "S"]);
    expect(r[1].cong).toBe(0.5);
  });
});

describe("locMaCaDaDung — chỉ hiện ca CÓ TRONG kỳ đang xem", () => {
  const danhMuc = dongGioCa([
    { code: "HC", name: "Giờ hành chính", segments: [W("08:00", "11:30")], dayCredit: 1, soCapQuetKyVong: 2 },
    { code: "CG", name: "Ca gãy", segments: [W("09:00", "11:30")], dayCredit: 1, soCapQuetKyVong: 1 },
    { code: "ST", name: "Ca sáng + tối", segments: [W("07:45", "11:30")], dayCredit: 1, soCapQuetKyVong: 2 },
  ]);

  it("giữ đúng mã có mặt, bỏ mã danh mục có mà tháng này không ai dùng", () => {
    // Chốt 25/09: danh mục 21 mã, một khối một tháng thường chỉ dùng 4–6. Đổ hết ra là bắt
    // người rà tự lọc bằng mắt đúng lúc họ cần tra nhanh.
    expect(locMaCaDaDung(danhMuc, ["HC", "HC", "CG"]).map((m) => m.code)).toEqual(["HC", "CG"]);
  });

  it("giữ THỨ TỰ của danh mục, không theo thứ tự gặp trong dữ liệu", () => {
    // Danh mục đã sắp theo `displayOrder` — bảng tra phải đọc như danh mục, không như
    // thứ tự tình cờ của ô ca đầu tiên trong tháng.
    expect(locMaCaDaDung(danhMuc, ["ST", "HC"]).map((m) => m.code)).toEqual(["HC", "ST"]);
  });

  it("kỳ rỗng ⇒ rỗng (component tự ẩn), không đổ cả danh mục ra", () => {
    expect(locMaCaDaDung(danhMuc, [])).toEqual([]);
  });

  it("mã đã NGƯNG dùng nhưng còn trong ô ca cũ ⇒ không hiện, vì không có trong danh mục", () => {
    // Danh mục truyền vào đã lọc `isActive: true` ở tầng truy vấn. Ô ca cũ vẫn giữ mã đã ngưng
    // (bản chụp lúc xếp) — giao hai tập là đúng: không bịa dòng cho mã không còn định nghĩa.
    expect(locMaCaDaDung(danhMuc, ["HC", "MA_DA_NGUNG"]).map((m) => m.code)).toEqual(["HC"]);
  });
});
