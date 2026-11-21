// PORT từ repo hodacphuchtc/DISC · tests/cham-diem.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { NGUONG_PHA } from "@/lib/disc/engine-goc/config/disc-nguong";
import { MA_TRUC, type BoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { napBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import { cham, chuanHoa, xepHangTruc, xepKieu } from "@/lib/disc/engine-goc/modules/report/cham";
import { daoChieu } from "@/lib/disc/engine-goc/modules/report/kiem-hop-le";

const THCS = napBoDe("THCS"); // 24 câu, thang 5
const TH = napBoDe("TH"); // 20 câu, thang 3

/** Trả lời sao cho `trucCao` đạt điểm tối đa, các trục khác đạt tối thiểu. */
function traLoiDayTruc(boDe: BoDe, trucCao: MaTruc): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const c of boDe.cau) {
    const muonCao = c.truc === trucCao;
    // Câu đảo thì muốn điểm CAO phải chọn mức THẤP.
    ra[c.ma] = muonCao === !c.dao ? boDe.mucToiDa : 1;
  }
  return ra;
}

describe("đảo chiều", () => {
  it("thang 5: 5→1, 4→2, 3→3, 2→4, 1→5", () => {
    expect([1, 2, 3, 4, 5].map((v) => daoChieu(v, true, 5))).toEqual([5, 4, 3, 2, 1]);
  });

  it("thang 3: 3→1, 2→2, 1→3", () => {
    expect([1, 2, 3].map((v) => daoChieu(v, true, 3))).toEqual([3, 2, 1]);
  });

  it("câu thuận thì giữ nguyên ở mọi thang", () => {
    expect([1, 3, 5].map((v) => daoChieu(v, false, 5))).toEqual([1, 3, 5]);
    expect([1, 2, 3].map((v) => daoChieu(v, false, 3))).toEqual([1, 2, 3]);
  });
});

describe("chuẩn hoá 0–100", () => {
  it("tổng thấp nhất (mọi câu mức 1) ⇒ 0 điểm", () => {
    expect(chuanHoa(6, 6, 5)).toBe(0);
    expect(chuanHoa(5, 5, 3)).toBe(0);
  });

  it("tổng cao nhất (mọi câu mức tối đa) ⇒ 100 điểm", () => {
    expect(chuanHoa(6 * 5, 6, 5)).toBe(100);
    expect(chuanHoa(5 * 3, 5, 3)).toBe(100);
  });

  it("ví dụ trong BA doc §7.2: THCS trục D, 6 câu, tổng 21 ⇒ 62,5", () => {
    expect(chuanHoa(21, 6, 5)).toBe(62.5);
  });

  it("làm tròn đúng 1 chữ số thập phân", () => {
    expect(chuanHoa(20, 6, 5)).toBe(58.3);
  });

  it("số câu bằng 0 thì trả 0, không chia cho 0", () => {
    expect(chuanHoa(0, 0, 5)).toBe(0);
  });

  it("hai bộ đề khác số câu và khác thang vẫn quy về cùng một thang so được", () => {
    // Nửa đường của thang 5 với 6 câu, và nửa đường của thang 3 với 5 câu.
    expect(chuanHoa(6 * 3, 6, 5)).toBe(50);
    expect(chuanHoa(5 * 2, 5, 3)).toBe(50);
  });
});

describe("xếp hạng trục", () => {
  it("xếp giảm dần theo điểm", () => {
    expect(xepHangTruc({ D: 10, I: 90, S: 50, C: 70 })).toEqual(["I", "C", "S", "D"]);
  });

  it("bằng điểm thì giữ thứ tự cố định D-I-S-C, không xáo ngẫu nhiên", () => {
    expect(xepHangTruc({ D: 50, I: 50, S: 50, C: 50 })).toEqual([...MA_TRUC]);
    expect(xepHangTruc({ D: 20, I: 80, S: 80, C: 20 })).toEqual(["I", "S", "D", "C"]);
  });
});

describe("xếp kiểu", () => {
  const xep = (d: Record<MaTruc, number>) => xepKieu(d, xepHangTruc(d));

  it("d1−d2 ĐÚNG BẰNG ngưỡng ⇒ kiểu ĐƠN (biên trên thuộc về đơn)", () => {
    const d = { D: 70, I: 70 - NGUONG_PHA, S: 30, C: 20 };
    expect(d.D - d.I).toBe(NGUONG_PHA);
    expect(xep(d)).toEqual({ loai: "don", truc: "D" });
  });

  it("d1−d2 nhỏ hơn ngưỡng dù chỉ 0,1 ⇒ kiểu PHA", () => {
    const d = { D: 70, I: 70 - NGUONG_PHA + 0.1, S: 30, C: 20 };
    expect(xep(d)).toEqual({ loai: "pha", cap: ["D", "I"] });
  });

  it("d1−d4 nhỏ hơn ngưỡng ⇒ PHỔ ĐỀU, KHÔNG ép nhãn", () => {
    expect(xep({ D: 52, I: 50, S: 48, C: 46 })).toEqual({ loai: "deu" });
  });

  it("phổ đều được hỏi TRƯỚC pha — bốn điểm sát nhau không được gán nhãn pha", () => {
    const d = { D: 50, I: 49, S: 48, C: 47 };
    expect(d.D - d.I).toBeLessThan(NGUONG_PHA); // đủ điều kiện "pha"…
    expect(xep(d).loai).toBe("deu"); // …nhưng vẫn phải ra "đều"
  });

  it("cặp pha LUÔN viết theo thứ tự D-I-S-C, dù trục nào cao hơn", () => {
    expect(xep({ D: 60, I: 20, S: 58, C: 10 })).toEqual({ loai: "pha", cap: ["D", "S"] });
    expect(xep({ D: 58, I: 20, S: 60, C: 10 })).toEqual({ loai: "pha", cap: ["D", "S"] });
    expect(xep({ D: 10, I: 20, S: 60, C: 58 })).toEqual({ loai: "pha", cap: ["S", "C"] });
    expect(xep({ D: 10, I: 60, S: 20, C: 58 })).toEqual({ loai: "pha", cap: ["I", "C"] });
  });

  it("chỉ có đúng SÁU cặp pha khả dĩ, không phải mười hai", () => {
    const cap = new Set<string>();
    for (const a of MA_TRUC)
      for (const b of MA_TRUC) {
        if (a === b) continue;
        const d = { D: 10, I: 10, S: 10, C: 10 } as Record<MaTruc, number>;
        d[a] = 70;
        d[b] = 65;
        const k = xep(d);
        if (k.loai === "pha") cap.add(k.cap.join(""));
      }
    expect(cap.size).toBe(6);
    expect([...cap].sort()).toEqual(["DC", "DI", "DS", "IC", "IS", "SC"]);
  });
});

describe("cham — đầu cuối trên bộ đề thật", () => {
  it("trả lời tối đa cho trục D ⇒ D bằng 100, ba trục kia bằng 0", () => {
    const kq = cham(THCS, traLoiDayTruc(THCS, "D"), 300);
    expect(kq.hopLe).toBe(true);
    if (!kq.hopLe) return;
    expect(kq.diem.D).toBe(100);
    expect(kq.diem.I).toBe(0);
    expect(kq.xepHang[0]).toBe("D");
    expect(kq.kieu).toEqual({ loai: "don", truc: "D" });
  });

  it("chạy đúng trên thang 3 mức của bộ Tiểu học", () => {
    const kq = cham(TH, traLoiDayTruc(TH, "S"), 300);
    expect(kq.hopLe).toBe(true);
    if (!kq.hopLe) return;
    expect(kq.diem.S).toBe(100);
    expect(kq.kieu).toEqual({ loai: "don", truc: "S" });
  });

  it("mọi điểm nằm trong khoảng 0–100 với trả lời ngẫu nhiên có kiểm soát", () => {
    const ra: Record<string, number> = {};
    THCS.cau.forEach((c, i) => (ra[c.ma] = (i % 5) + 1));
    const kq = cham(THCS, ra, 300);
    if (!kq.hopLe) return;
    for (const t of MA_TRUC) {
      expect(kq.diem[t]).toBeGreaterThanOrEqual(0);
      expect(kq.diem[t]).toBeLessThanOrEqual(100);
    }
  });

  it("thiếu dù MỘT câu là chặn, không chấm nửa vời", () => {
    const ra = traLoiDayTruc(THCS, "D");
    delete ra[THCS.cau[7].ma];
    const kq = cham(THCS, ra, 300);
    expect(kq).toMatchObject({ hopLe: false, lyDo: "THIEU_CAU" });
    if (!kq.hopLe) expect(kq.cauThieu).toEqual([THCS.cau[7].ma]);
  });

  it("không đo được thời gian (null) thì bỏ qua HL-4 thay vì báo bừa", () => {
    const kq = cham(THCS, traLoiDayTruc(THCS, "D"), null);
    if (!kq.hopLe) throw new Error("phải hợp lệ");
    expect(kq.canhBao).not.toContain("BAM_BUA");
  });
});
