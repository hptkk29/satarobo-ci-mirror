// @vitest-environment node
// lib/orders/pham-vi/giam-them.test.ts — khoản giảm thêm trên dòng SCOPE: đếm ưu đãi + TRẦN tổng % [20/10/2026]. Phần THUẦN; hành vi trên action ở
// `cong-tao-don.test.ts` [GT-*], trên form ở `order-create-form-pham-vi.test.tsx` [GT-*], trên Postgres ở `tests/nen/tran-giam-pham-vi-co-so.spec.ts`.
//
// Fixture: Sata 3 đủ 48 buổi — niêm yết 10.560.000, chính sách 15% ⇒ 8.976.000 (giảm 1.584.000). Trần 25% = 2.640.000 ⇒ khoản thêm tối đa 1.056.000.
import { describe, expect, it } from "vitest";
import { xetDuyetDon } from "@/lib/orders/nguong-duyet";
import {
  dinhDangPhanTram,
  dongVuotTranPhamVi,
  loiVuotTranPhamVi,
  uuDaiDongPhamVi,
  xetTranDong,
  type DongGiamThem,
} from "./giam-them";

const NIEM_YET = 10_560_000;
const CHINH_SACH = 8_976_000;
const dong = (them: number, o: Partial<DongGiamThem> = {}): DongGiamThem => ({
  niemYet: NIEM_YET,
  thanhTienChinhSach: CHINH_SACH,
  giamThem: them,
  soKhoanThem: them > 0 ? 1 : 0,
  ...o,
});

describe("[GTM-01] biên trần: so bằng nhân chéo số nguyên, không số thực", () => {
  it("đúng 25,00% QUA; hơn 1 đồng thì 25,01% TỪ CHỐI", () => {
    expect(xetTranDong(dong(1_056_000), 25).vuotTran).toBe(false);
    expect(xetTranDong(dong(1_056_000), 25).phanTramTongX100).toBe(2500);
    const hon = xetTranDong(dong(1_056_001), 25);
    expect(hon.vuotTran).toBe(true);
    expect(hon.phanTramTongX100).toBe(2501); // làm tròn LÊN: 25,0000095% hiện là 25,01%, không rơi về 25,00%
    expect(dinhDangPhanTram(hon.phanTramTongX100)).toBe("25,01");
  });
  it("điểm còn lại tới trần: 0 khi sát/qua trần, số dương khi còn chỗ", () => {
    expect(xetTranDong(dong(100_000), 25).conLaiX100).toBe(2500 - 1595);
    expect(xetTranDong(dong(1_056_000), 25).conLaiX100).toBe(0);
    expect(xetTranDong(dong(1_500_000), 25).conLaiX100).toBe(0);
  });
  it("% tính trên NIÊM YẾT, không trên giá đã giảm: khoản bằng 10% của GIÁ ĐÃ GIẢM (897.600đ) chỉ là 8,5% niêm yết, tổng 23,5%; khoản bằng 10% NIÊM YẾT (1.056.000đ) mới vừa khít trần", () => {
    // 10% của giá đã giảm 8.976.000 = 897.600 đ ⇒ (1.584.000 + 897.600) ÷ 10.560.000 = 23,5%.
    // Nếu tính % trên giá đã giảm ("15% + 10% = 25%") thì khoản này được coi là 10% niêm yết = 1.056.000đ — sai chiều nới trần.
    const k = xetTranDong(dong(897_600), 25);
    expect(dinhDangPhanTram(k.phanTramTongX100)).toBe("23,5");
    expect(k.vuotTran).toBe(false);
    // Khoản 10% của NIÊM YẾT (1.056.000đ) vừa khít trần; 10,01% niêm yết thì vượt.
    expect(xetTranDong(dong(1_056_000), 25).vuotTran).toBe(false);
    expect(xetTranDong(dong(1_056_100), 25).vuotTran).toBe(true);
  });
});

describe("[GTM-02] trần theo cơ sở và trần thấp hơn chính sách", () => {
  it("cùng khoản 600.000đ (20,68%): trần 25 qua, trần 20 vượt", () => {
    expect(xetTranDong(dong(600_000), 25).vuotTran).toBe(false);
    expect(xetTranDong(dong(600_000), 20).vuotTran).toBe(true);
  });
  it("trần 10% < chính sách 15%: KHÔNG khoản thêm ⇒ không vượt (chính sách vẫn áp); thêm 1đ ⇒ vượt và cờ 'trần thấp hơn chính sách' bật", () => {
    const khong = xetTranDong(dong(0), 10);
    expect(khong.vuotTran).toBe(false);
    expect(khong.tranThapHonChinhSach).toBe(false);
    const co = xetTranDong(dong(1), 10);
    expect(co.vuotTran).toBe(true);
    expect(co.tranThapHonChinhSach).toBe(true);
  });
  it("trần đúng bằng chính sách (25% với con hạng 2 được 25%): không khoản thêm qua; thêm bất kỳ khoản nào vượt, nhưng KHÔNG gọi là 'trần thấp hơn chính sách'", () => {
    const d = (them: number): DongGiamThem => ({ niemYet: 11_520_000, thanhTienChinhSach: 8_640_000, giamThem: them, soKhoanThem: them > 0 ? 1 : 0 });
    expect(xetTranDong(d(0), 25).vuotTran).toBe(false);
    expect(xetTranDong(d(1), 25).vuotTran).toBe(true);
    expect(xetTranDong(d(1), 25).tranThapHonChinhSach).toBe(false);
  });
  it("khoá dòng nào vượt: nhiều dòng, chỉ dòng 2 vượt ⇒ chỉ số [1]", () => {
    expect(dongVuotTranPhamVi([dong(100_000), dong(2_000_000), dong(0)], 25)).toEqual([1]);
    expect(dongVuotTranPhamVi([], 25)).toEqual([]);
  });
  it("niêm yết 0 + có khoản thêm ⇒ vượt (không chia cho 0 rồi lọt)", () => {
    expect(xetTranDong({ niemYet: 0, thanhTienChinhSach: 0, giamThem: 1, soKhoanThem: 1 }, 25).vuotTran).toBe(true);
    expect(xetTranDong({ niemYet: 0, thanhTienChinhSach: 0, giamThem: 0, soKhoanThem: 0 }, 25).vuotTran).toBe(false);
  });
});

describe("[GTM-03] câu từ chối nói bằng ngôn ngữ của nguyên nhân", () => {
  it("nêu dòng, tổng %, phần chính sách + thêm, trần, và nơi QLCS chỉnh", () => {
    const d = [{ ...dong(1_056_001), nhan: "Dòng 1 (Sata 3)" }];
    const cau = loiVuotTranPhamVi(d, [0], 25);
    expect(cau).toContain("Dòng 1 (Sata 3): tổng giảm 25,01% giá niêm yết (chính sách 15% + thêm 10,01%), vượt trần 25% của cơ sở này.");
    expect(cau).toContain("Cấu hình vận hành → tab Thanh toán");
  });
  it("trần thấp hơn chính sách ⇒ thêm câu giải thích riêng", () => {
    const cau = loiVuotTranPhamVi([{ ...dong(1_000), nhan: "Dòng 1" }], [0], 10);
    expect(cau).toContain("Trần thấp hơn mức chính sách phạm vi học: chính sách vẫn áp, nhưng không cộng thêm được khoản giảm nào.");
  });
});

describe("[GTM-04] đếm ưu đãi: dòng chính sách (kể cả 0%) là ưu đãi thứ nhất CHỈ khi có khoản thêm", () => {
  it("không khoản thêm ⇒ 0 (hành vi hôm nay của đơn SCOPE không đổi), không 'ngoài chính sách'", () => {
    expect(uuDaiDongPhamVi(dong(0))).toEqual({ soUuDai: 0, ngoaiChinhSach: false });
  });
  it("dòng đã giảm theo chính sách + 1 khoản ⇒ 2, ngoài chính sách", () => {
    expect(uuDaiDongPhamVi(dong(100_000))).toEqual({ soUuDai: 2, ngoaiChinhSach: true });
    expect(uuDaiDongPhamVi({ ...dong(100_000), soKhoanThem: 3 })).toEqual({ soUuDai: 4, ngoaiChinhSach: true });
  });
  it("dòng KHÔNG giảm theo chính sách (mốc 12 buổi 0%) + 1 khoản ⇒ 2, ngoài chính sách (dòng chính sách luôn là ưu đãi thứ nhất — chủ dự án chốt 20/10 vòng 2)", () => {
    const d12: DongGiamThem = { niemYet: 3_000_000, thanhTienChinhSach: 3_000_000, giamThem: 50_000, soKhoanThem: 1 };
    expect(uuDaiDongPhamVi(d12)).toEqual({ soUuDai: 2, ngoaiChinhSach: true });
  });
});

describe("[GTM-05] đi qua xetDuyetDon: chính sách thứ 2 ⇒ CHỜ DUYỆT, câu đúng; ví dụ hai anh em đóng đủ 48 buổi ⇒ KHÔNG duyệt", () => {
  const xet = (ds: DongGiamThem[], tranUuDai = 1) =>
    xetDuyetDon({
      keHoach: [],
      uuDaiTheoDong: ds.map((g, i) => {
        const u = uuDaiDongPhamVi(g);
        return { soUuDai: u.soUuDai, ngoaiChinhSachPhamVi: u.ngoaiChinhSach, nhan: `Dòng ${i + 1}` };
      }),
      soBuoiTheoDong: ds.map(() => ({ viPham: false, cau: null })),
      nguong: { tranSoDot: 4, tranUuDaiMoiDong: tranUuDai },
    });
  it("1 khoản thêm trên dòng đã giảm 15% ⇒ phan.giamGia + câu 'áp thêm chương trình giảm ngoài chính sách phạm vi học'", () => {
    const k = xet([dong(100_000)]);
    expect(k.phan).toEqual({ giamGia: true, traGop: false, soBuoi: false });
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo).toHaveLength(1);
    expect(k.lyDo[0]).toContain("áp thêm chương trình giảm ngoài chính sách phạm vi học");
  });
  it("hai anh em: hạng 1 giảm 15%, hạng 2 giảm 25% theo CHÍNH SÁCH, không khoản thêm ⇒ KHÔNG duyệt", () => {
    const k = xet([dong(0), { niemYet: 11_520_000, thanhTienChinhSach: 8_640_000, giamThem: 0, soKhoanThem: 0 }]);
    expect(k.canDuyet).toBe(false);
    expect(k.phan.giamGia).toBe(false);
  });
  it("nới trần ưu đãi lên 2 (QLCS chỉnh) ⇒ 1 khoản thêm trên dòng đã giảm theo chính sách (= 2 ưu đãi) KHÔNG còn chờ duyệt", () => {
    expect(xet([dong(100_000)], 2).canDuyet).toBe(false);
    expect(xet([{ ...dong(100_000), soKhoanThem: 2 }], 2).canDuyet).toBe(true); // 3 ưu đãi > 2
  });
  it("dòng không thuộc phạm vi vẫn dùng câu cũ (đối chứng)", () => {
    const k = xetDuyetDon({
      keHoach: [],
      uuDaiTheoDong: [{ soUuDai: 3, ngoaiChinhSachPhamVi: false, nhan: "Dòng 1" }],
      soBuoiTheoDong: [{ viPham: false, cau: null }],
      nguong: { tranSoDot: 4, tranUuDaiMoiDong: 1 },
    });
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo[0]).toBe("Dòng 1: áp 3 ưu đãi, vượt mức 1 ưu đãi một dòng.");
  });
});

describe("[GTM-06] dinhDangPhanTram", () => {
  it("không dùng ICU: 1500→15, 250→2,5, 2501→25,01, 905→9,05, 0→0", () => {
    expect(dinhDangPhanTram(1500)).toBe("15");
    expect(dinhDangPhanTram(250)).toBe("2,5");
    expect(dinhDangPhanTram(2501)).toBe("25,01");
    expect(dinhDangPhanTram(905)).toBe("9,05");
    expect(dinhDangPhanTram(0)).toBe("0");
  });
});
