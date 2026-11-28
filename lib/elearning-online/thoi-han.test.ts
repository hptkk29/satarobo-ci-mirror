// @vitest-environment node
/** [ONL-TH-*] Thời hạn quyền học Online theo THÁNG LỊCH (giờ VN). Test truyền `now` tường minh (luật 19), không đọc đồng hồ thật. */
import { describe, expect, it } from "vitest";
import { congThangLich, laKyHanHopLe, tinhHanMoi } from "./thoi-han";
import { vnParts } from "@/lib/time/vn";

/** Ngày VN dạng "d/m/yyyy" của một thời điểm — để assert không phụ thuộc múi giờ máy chạy test. */
const ngayVn = (d: Date | null) => {
  if (!d) return null;
  const p = vnParts(d);
  return `${p.day}/${p.month + 1}/${p.year}`;
};
/** 12:00 giờ VN của ngày d/m/y. */
const vn = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h - 7, 0, 0));

describe("[ONL-TH-01] cộng tháng lịch, kẹp cuối tháng", () => {
  it("mua 19/11/2026 + 12 tháng = hết ngày 19/11/2027 (23:59:59.999 VN)", () => {
    const h = congThangLich(vn(2026, 11, 19), 12);
    expect(ngayVn(h)).toBe("19/11/2027");
    const p = vnParts(h);
    expect([p.hour, p.minute]).toEqual([23, 59]);
    expect(h.getTime() % 1000).toBe(999);
  });

  it("🔴 31/01 + 1 tháng = 28/02 (năm thường) và 29/02 (năm nhuận) — KHÔNG tràn sang tháng 3", () => {
    expect(ngayVn(congThangLich(vn(2027, 1, 31), 1))).toBe("28/2/2027");
    expect(ngayVn(congThangLich(vn(2028, 1, 31), 1))).toBe("29/2/2028");
  });

  it("ngày 29/30/31 sang tháng có đủ ngày thì GIỮ ngày: 30/01 +2 = 30/03; 31/03 +1 = 30/04; 31/01 +3 = 30/04", () => {
    expect(ngayVn(congThangLich(vn(2027, 1, 30), 2))).toBe("30/3/2027");
    expect(ngayVn(congThangLich(vn(2027, 3, 31), 1))).toBe("30/4/2027");
    expect(ngayVn(congThangLich(vn(2027, 1, 31), 3))).toBe("30/4/2027");
  });

  it("qua năm và qua năm nhuận: 29/02/2028 + 12 tháng = 28/02/2029; + 48 tháng = 29/02/2032", () => {
    expect(ngayVn(congThangLich(vn(2028, 2, 29), 12))).toBe("28/2/2029");
    expect(ngayVn(congThangLich(vn(2028, 2, 29), 48))).toBe("29/2/2032");
  });

  it("🔴 KHÔNG phải nhân 30 ngày: 12 tháng từ 01/01/2027 là 01/01/2028 (365 ngày), không phải 26/12/2027", () => {
    expect(ngayVn(congThangLich(vn(2027, 1, 1), 12))).toBe("1/1/2028");
  });

  it("🔴 múi giờ: 23:30 VN ngày 31/12 (= 16:30Z cùng ngày) cộng 1 tháng ra 31/01, không lệch ngày", () => {
    const muoiBaGioBaMuoi = new Date(Date.UTC(2026, 11, 31, 16, 30, 0)); // 23:30 VN 31/12/2026
    expect(ngayVn(muoiBaGioBaMuoi)).toBe("31/12/2026");
    expect(ngayVn(congThangLich(muoiBaGioBaMuoi, 1))).toBe("31/1/2027");
    // 00:30 VN 01/01 (= 17:30Z 31/12) là NGÀY 01/01 theo VN:
    const khongBaMuoi = new Date(Date.UTC(2026, 11, 31, 17, 30, 0));
    expect(ngayVn(khongBaMuoi)).toBe("1/1/2027");
    expect(ngayVn(congThangLich(khongBaMuoi, 1))).toBe("1/2/2027");
  });

  it("số tháng không hợp lệ ⇒ ném lỗi (0, âm, thập phân, quá trần)", () => {
    for (const x of [0, -1, 1.5, 121, Number.NaN]) expect(() => congThangLich(vn(2027, 1, 1), x), String(x)).toThrow(RangeError);
  });
});

describe("[ONL-TH-02] tinhHanMoi: mua mới · gia hạn · mua lại · trọn đời", () => {
  const ky12 = { loai: "THANG", soThang: 12 } as const;
  const now = vn(2026, 11, 19);

  it("mua mới ⇒ cộng từ ngày mua và nhớ ngày neo", () => {
    const r = tinhHanMoi({ ky: ky12, now });
    expect(ngayVn(r.hetHan)).toBe("19/11/2027");
    expect(r.anchorDay).toBe(19);
  });

  it("🔴 gia hạn KHI CÒN HẠN ⇒ cộng từ hạn hiện tại (không mất ngày còn lại)", () => {
    const hien = congThangLich(vn(2026, 3, 2), 12); // hết 02/03/2027
    const r = tinhHanMoi({ ky: { loai: "THANG", soThang: 6 }, now, hanHienTai: hien, anchorDay: 2 });
    expect(ngayVn(r.hetHan)).toBe("2/9/2027");
  });

  it("🔴 đối chứng: gia hạn KHI ĐÃ HẾT HẠN ⇒ cộng từ NGÀY MUA, không cộng bù khoảng đã hết", () => {
    const hien = congThangLich(vn(2025, 3, 2), 6); // hết 02/09/2025 — đã qua
    const r = tinhHanMoi({ ky: { loai: "THANG", soThang: 6 }, now, hanHienTai: hien });
    expect(ngayVn(r.hetHan)).toBe("19/5/2027");
  });

  it("🔴 gia hạn liên tiếp KHÔNG trôi ngày: neo 31 ⇒ 31/01 → 28/02 → 31/03 → 30/04", () => {
    let r = tinhHanMoi({ ky: { loai: "THANG", soThang: 1 }, now: vn(2027, 1, 31) });
    expect(ngayVn(r.hetHan)).toBe("28/2/2027");
    r = tinhHanMoi({ ky: { loai: "THANG", soThang: 1 }, now: vn(2027, 2, 1), hanHienTai: r.hetHan, anchorDay: r.anchorDay });
    expect(ngayVn(r.hetHan)).toBe("31/3/2027");
    r = tinhHanMoi({ ky: { loai: "THANG", soThang: 1 }, now: vn(2027, 3, 1), hanHienTai: r.hetHan, anchorDay: r.anchorDay });
    expect(ngayVn(r.hetHan)).toBe("30/4/2027");
  });

  it("🔴 trọn đời: kỳ hạn TRON_DOI ⇒ null; quyền đang trọn đời được 'gia hạn' vẫn null", () => {
    expect(tinhHanMoi({ ky: { loai: "TRON_DOI" }, now }).hetHan).toBeNull();
    expect(tinhHanMoi({ ky: ky12, now, hanHienTai: null }).hetHan).toBeNull();
  });

  it("mốc đúng biên: hạn hiện tại = ĐÚNG lúc now ⇒ coi là hết (cộng từ now)", () => {
    const r = tinhHanMoi({ ky: ky12, now, hanHienTai: new Date(now.getTime()) });
    expect(ngayVn(r.hetHan)).toBe("19/11/2027");
  });
});

describe("[ONL-TH-03] laKyHanHopLe", () => {
  it("chấp nhận TRON_DOI và THANG 1..120; từ chối còn lại", () => {
    expect(laKyHanHopLe({ loai: "TRON_DOI" })).toBe(true);
    expect(laKyHanHopLe({ loai: "THANG", soThang: 12 })).toBe(true);
    for (const x of [null, undefined, {}, { loai: "THANG" }, { loai: "THANG", soThang: 0 }, { loai: "THANG", soThang: 121 }, { loai: "NGAY", soNgay: 30 }, "12"]) {
      expect(laKyHanHopLe(x), JSON.stringify(x)).toBe(false);
    }
  });
});
