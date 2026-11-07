// PORT từ repo hodacphuchtc/DISC · tests/kiem-hop-le.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { NGUONG_HOP_LE } from "@/lib/disc/engine-goc/config/disc-nguong";
import { MA_TRUC, type BoDe, type CauHoi } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { napBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import {
  chuoiCungDapAnDaiNhat,
  coMucGiua,
  doMauThuanThuanDao,
  kiemHopLe,
  tyLeTraLoiPhang,
} from "@/lib/disc/engine-goc/modules/report/kiem-hop-le";

const THCS = napBoDe("THCS"); // 24 câu, thang 5, mức giữa = 3

/**
 * Bộ đề giả với số câu chia hết cho 100, để kiểm ngưỡng phần trăm ĐÚNG ĐẾN TỪNG PHẦN TRĂM.
 * Bộ thật có 24 câu nên không đặt được tỷ lệ 41% hay 39%.
 */
function boGia(soCauMoiTruc: number, mucToiDa: number): BoDe {
  const cau: CauHoi[] = [];
  for (let i = 0; i < soCauMoiTruc; i += 1) {
    for (const t of MA_TRUC) {
      cau.push({ ma: `G-${t}${i + 1}`, truc: t, dao: i === 0, noiDung: `Câu giả ${t}${i + 1}` });
    }
  }
  return {
    ma: "THCS",
    ten: "Bộ giả",
    aiTraLoi: "-",
    veAi: "-",
    loaiThang: "dong-y",
    mucToiDa,
    cauMoiMan: 5,
    cauDan: "-",
    thang: Array.from({ length: mucToiDa }, (_, i) => ({ giaTri: i + 1, nhan: `M${i + 1}` })),
    cau,
  };
}

/** Đặt `soCauGiua` câu đầu về mức giữa, phần còn lại chia đều hai bên để khỏi lệch khác. */
function traLoiVoiSoCauGiua(boDe: BoDe, soCauGiua: number): Record<string, number> {
  const giua = (boDe.mucToiDa + 1) / 2;
  const ra: Record<string, number> = {};
  boDe.cau.forEach((c, i) => {
    ra[c.ma] = i < soCauGiua ? giua : i % 2 === 0 ? giua - 1 : giua + 1;
  });
  return ra;
}

describe("HL-5 — bỏ trống", () => {
  it("thiếu một câu ⇒ CHẶN, và chỉ ra đúng câu còn thiếu", () => {
    const ra = traLoiVoiSoCauGiua(THCS, 0);
    const thieu = THCS.cau[11].ma;
    delete ra[thieu];
    expect(kiemHopLe(THCS, ra, 300)).toEqual({ chan: "THIEU_CAU", cauThieu: [thieu] });
  });

  it("giá trị ngoài thang cũng tính là thiếu, không tính là đã trả lời", () => {
    const ra = traLoiVoiSoCauGiua(THCS, 0);
    ra[THCS.cau[0].ma] = 0;
    ra[THCS.cau[1].ma] = 99;
    const kq = kiemHopLe(THCS, ra, 300);
    expect(kq.chan).toBe("THIEU_CAU");
  });

  it("bỏ trống được kiểm TRƯỚC trả lời phẳng — báo đúng nguyên nhân gần nhất", () => {
    const ra = traLoiVoiSoCauGiua(THCS, 24);
    delete ra[THCS.cau[0].ma];
    expect(kiemHopLe(THCS, ra, 300).chan).toBe("THIEU_CAU");
  });
});

describe("HL-1 — trả lời phẳng", () => {
  const bo100 = boGia(25, 5); // 100 câu

  it("41% câu ở mức giữa ⇒ KHÔNG hợp lệ", () => {
    expect(tyLeTraLoiPhang(bo100, traLoiVoiSoCauGiua(bo100, 41))).toBeCloseTo(0.41, 5);
    expect(kiemHopLe(bo100, traLoiVoiSoCauGiua(bo100, 41), 300).chan).toBe("PHANG");
  });

  it("39% câu ở mức giữa ⇒ hợp lệ", () => {
    expect(tyLeTraLoiPhang(bo100, traLoiVoiSoCauGiua(bo100, 39))).toBeCloseTo(0.39, 5);
    expect(kiemHopLe(bo100, traLoiVoiSoCauGiua(bo100, 39), 300).chan).toBeNull();
  });

  it("đúng 40% — bằng ngưỡng — vẫn hợp lệ, chỉ VƯỢT mới chặn", () => {
    expect(kiemHopLe(bo100, traLoiVoiSoCauGiua(bo100, 40), 300).chan).toBeNull();
    expect(NGUONG_HOP_LE.tyLePhangToiDa).toBe(0.4);
  });

  it("chọn toàn mức giữa cho cả bài ⇒ chặn — đây là ca mà DEMO 4 bấm thử", () => {
    const toanGiua: Record<string, number> = {};
    for (const c of THCS.cau) toanGiua[c.ma] = 3;
    expect(kiemHopLe(THCS, toanGiua, 300).chan).toBe("PHANG");
  });

  it("thang CHẴN không có mức giữa ⇒ HL-1 tự tắt, không chạy vào khoảng trống", () => {
    const bo4 = boGia(5, 4);
    expect(coMucGiua(4)).toBe(false);
    const ra: Record<string, number> = {};
    for (const c of bo4.cau) ra[c.ma] = 2;
    expect(tyLeTraLoiPhang(bo4, ra)).toBe(0);
    expect(kiemHopLe(bo4, ra, 300).chan).toBeNull();
  });
});

describe("HL-2 — tick một cột", () => {
  /** Đặt `soLienTiep` câu ĐẦU cùng một đáp án, phần sau xen kẽ để không dính HL-1. */
  function traLoiChuoi(boDe: BoDe, soLienTiep: number, giaTri: number) {
    const ra: Record<string, number> = {};
    boDe.cau.forEach((c, i) => {
      ra[c.ma] = i < soLienTiep ? giaTri : i % 2 === 0 ? 1 : 5;
    });
    return ra;
  }

  it("8 câu liên tiếp cùng đáp án ⇒ CẢNH BÁO", () => {
    const ra = traLoiChuoi(THCS, 8, 4);
    expect(chuoiCungDapAnDaiNhat(THCS, ra)).toBeGreaterThanOrEqual(8);
    const kq = kiemHopLe(THCS, ra, 300);
    expect(kq.chan).toBeNull();
    if (kq.chan === null) expect(kq.canhBao).toContain("MOT_COT");
  });

  it("7 câu liên tiếp ⇒ KHÔNG cảnh báo", () => {
    const ra = traLoiChuoi(THCS, 7, 4);
    expect(chuoiCungDapAnDaiNhat(THCS, ra)).toBe(7);
    const kq = kiemHopLe(THCS, ra, 300);
    if (kq.chan === null) expect(kq.canhBao).not.toContain("MOT_COT");
  });

  it("đếm theo THỨ TỰ HIỂN THỊ, không theo thứ tự khai trong bảng", () => {
    // 9 câu ĐẦU THEO THỨ TỰ HIỂN THỊ cùng đáp án; phần sau xen kẽ để không tạo chuỗi khác.
    const ra: Record<string, number> = {};
    THCS.cau.forEach((c, i) => (ra[c.ma] = i < 9 ? 4 : i % 2 === 0 ? 1 : 5));
    expect(chuoiCungDapAnDaiNhat(THCS, ra)).toBe(9);

    // Cũng chính bộ trả lời đó, nhưng đếm theo thứ tự KHAI TRONG BẢNG thì ra khác —
    // đó là lý do phải nạp bộ đề qua napBoDe chứ đừng đọc thẳng NGAN_HANG.
    const theoBang = { ...THCS, cau: [...THCS.cau].sort((a, b) => a.ma.localeCompare(b.ma)) };
    expect(chuoiCungDapAnDaiNhat(theoBang, ra)).not.toBe(9);
  });

  it("trả về chuỗi DÀI NHẤT trong cả bài, không phải chuỗi đầu tiên", () => {
    const ra: Record<string, number> = {};
    THCS.cau.forEach((c, i) => (ra[c.ma] = i < 3 ? 4 : 2));
    expect(chuoiCungDapAnDaiNhat(THCS, ra)).toBe(21);
  });
});

describe("HL-3 — mâu thuẫn thuận/đảo", () => {
  it("trả lời nhất quán ⇒ độ mâu thuẫn thấp, không cảnh báo", () => {
    const ra: Record<string, number> = {};
    for (const c of THCS.cau) ra[c.ma] = c.dao ? 2 : 4;
    expect(doMauThuanThuanDao(THCS, ra)).toBeLessThanOrEqual(0.5);
    const kq = kiemHopLe(THCS, ra, 300);
    if (kq.chan === null) expect(kq.canhBao).not.toContain("MAU_THUAN");
  });

  it("trả lời ngược nhau giữa câu thuận và câu đảo ⇒ CẢNH BÁO", () => {
    const ra: Record<string, number> = {};
    for (const c of THCS.cau) ra[c.ma] = c.dao ? 5 : 5; // đồng ý cả hai chiều
    const kq = kiemHopLe(THCS, ra, 300);
    if (kq.chan === null) expect(kq.canhBao).toContain("MAU_THUAN");
  });

  it("ngưỡng khác nhau theo thang: thang 3 chặt hơn thang 5", () => {
    expect(NGUONG_HOP_LE.nguongMauThuanTheoThang[3]).toBeLessThan(
      NGUONG_HOP_LE.nguongMauThuanTheoThang[5],
    );
  });
});

describe("HL-4 — bấm bừa", () => {
  const raTot = () => {
    const ra: Record<string, number> = {};
    for (const c of THCS.cau) ra[c.ma] = c.dao ? 2 : 4;
    return ra;
  };

  it("dưới 2,5 giây mỗi câu ⇒ CẢNH BÁO", () => {
    const kq = kiemHopLe(THCS, raTot(), 24 * 2 - 1);
    if (kq.chan === null) expect(kq.canhBao).toContain("BAM_BUA");
  });

  it("từ 2,5 giây mỗi câu trở lên ⇒ không cảnh báo", () => {
    const kq = kiemHopLe(THCS, raTot(), 24 * 2.5);
    if (kq.chan === null) expect(kq.canhBao).not.toContain("BAM_BUA");
  });

  it("không đo được thời gian (null) ⇒ bỏ qua, không báo bừa", () => {
    const kq = kiemHopLe(THCS, raTot(), null);
    if (kq.chan === null) expect(kq.canhBao).not.toContain("BAM_BUA");
  });
});
