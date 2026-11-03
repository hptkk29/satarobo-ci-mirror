// @vitest-environment node
// lib/orders/pham-vi/giam-them.test.ts — khoản giảm thêm trên dòng SCOPE: đếm ưu đãi + TRẦN tổng % [20/10/2026]. Phần THUẦN; hành vi trên action ở
// `cong-tao-don.test.ts` [GT-*], trên form ở `order-create-form-pham-vi.test.tsx` [GT-*], trên Postgres ở `tests/nen/tran-giam-pham-vi-co-so.spec.ts`.
//
// Fixture: Sata 3 đủ 48 buổi — niêm yết 10.560.000, chính sách 15% ⇒ 8.976.000 (giảm 1.584.000). Trần 25% = 2.640.000 ⇒ khoản thêm tối đa 1.056.000.
import { describe, expect, it } from "vitest";
import { xetDuyetDon } from "@/lib/orders/nguong-duyet";
import { khoanTrungVanBan, loiTrungVanBan, vanBanDaDungKhac, type MaTheoVanBan } from "@/lib/khuyen-mai/ap-vao-don";
import {
  TOI_DA_CHUONG_TRINH_KHONG_DUYET,
  cauLyDoDuyetKhoa,
  dinhDangPhanTram,
  dongVuotTranPhamVi,
  laDongKhoaHoc,
  loiVuotTranPhamVi,
  uuDaiDongKhoaHoc,
  xetTranDong,
  type DongGiamThem,
  type KhoanDeDem,
} from "./giam-them";

const NIEM_YET = 10_560_000;
const CHINH_SACH = 8_976_000;
const dong = (them: number, o: Partial<DongGiamThem> = {}): DongGiamThem => ({
  niemYet: NIEM_YET,
  thanhTienChinhSach: CHINH_SACH,
  giamThem: them,
  ...o,
});
/** Khoản Sale TỰ GÕ (không `voucherId`). */
const GO = (giaTri = 100_000): KhoanDeDem => ({ giaTri, voucherId: null });
/** Khoản CHỌN TỪ chương trình có sẵn (có `voucherId` do máy chủ tra DB). */
const CT = (giaTri = 100_000, voucherId = "v-24"): KhoanDeDem => ({ giaTri, voucherId });

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
    const d = (them: number): DongGiamThem => ({ niemYet: 11_520_000, thanhTienChinhSach: 8_640_000, giamThem: them });
    expect(xetTranDong(d(0), 25).vuotTran).toBe(false);
    expect(xetTranDong(d(1), 25).vuotTran).toBe(true);
    expect(xetTranDong(d(1), 25).tranThapHonChinhSach).toBe(false);
  });
  it("khoá dòng nào vượt: nhiều dòng, chỉ dòng 2 vượt ⇒ chỉ số [1]", () => {
    expect(dongVuotTranPhamVi([dong(100_000), dong(2_000_000), dong(0)], 25)).toEqual([1]);
    expect(dongVuotTranPhamVi([], 25)).toEqual([]);
  });
  it("niêm yết 0 + có khoản thêm ⇒ vượt (không chia cho 0 rồi lọt)", () => {
    expect(xetTranDong({ niemYet: 0, thanhTienChinhSach: 0, giamThem: 1 }, 25).vuotTran).toBe(true);
    expect(xetTranDong({ niemYet: 0, thanhTienChinhSach: 0, giamThem: 0 }, 25).vuotTran).toBe(false);
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

describe("[GTM-04] đếm khoản giảm dòng KHOÁ HỌC: tự gõ ⇒ duyệt; chương trình có sẵn ⇒ không duyệt TỚI 2, chương trình thứ 3 ⇒ duyệt", () => {
  it("không khoản nào ⇒ không lý do (hành vi của đơn không khoản thêm không đổi)", () => {
    expect(uuDaiDongKhoaHoc([])).toEqual({ soChuongTrinh: 0, soGoRieng: 0, lyDo: [] });
  });
  it("1 khoản TỰ GÕ ⇒ GO_RIENG; 3 khoản tự gõ vẫn chỉ MỘT lý do (không lặp câu)", () => {
    expect(uuDaiDongKhoaHoc([GO()])).toEqual({ soChuongTrinh: 0, soGoRieng: 1, lyDo: ["GO_RIENG"] });
    expect(uuDaiDongKhoaHoc([GO(), GO(), GO()])).toEqual({ soChuongTrinh: 0, soGoRieng: 3, lyDo: ["GO_RIENG"] });
  });
  it("[GTM-04b] CHỈ chọn từ chương trình có sẵn ⇒ KHÔNG lý do, với 1 hoặc 2 chương trình (chủ dự án chốt 26/10/2026)", () => {
    expect(uuDaiDongKhoaHoc([CT()])).toEqual({ soChuongTrinh: 1, soGoRieng: 0, lyDo: [] });
    expect(uuDaiDongKhoaHoc([CT(100_000, "v-24"), CT(50_000, "v-sib")])).toEqual({ soChuongTrinh: 2, soGoRieng: 0, lyDo: [] });
  });
  it("[GTM-04c] chương trình + 1 khoản tự gõ ⇒ GO_RIENG, bất kể thứ tự", () => {
    expect(uuDaiDongKhoaHoc([CT(), GO()]).lyDo).toEqual(["GO_RIENG"]);
    expect(uuDaiDongKhoaHoc([GO(), CT()]).lyDo).toEqual(["GO_RIENG"]);
  });
  it("[GTM-04d] khoản giá trị 0 không tính — kể cả khoản tự gõ 0đ và chương trình 0đ (form lọc giaTri > 0 khi gửi; máy chủ không được đếm khác form)", () => {
    expect(uuDaiDongKhoaHoc([GO(0)]).lyDo).toEqual([]);
    expect(uuDaiDongKhoaHoc([CT(), GO(0)]).lyDo).toEqual([]);
    expect(uuDaiDongKhoaHoc([GO(0), GO(50_000)]).lyDo).toEqual(["GO_RIENG"]);
    // 3 chương trình nhưng một cái 0đ ⇒ chỉ 2 chương trình có giá trị ⇒ không duyệt.
    expect(uuDaiDongKhoaHoc([CT(1, "a"), CT(1, "b"), CT(0, "c")]).lyDo).toEqual([]);
  });
  it("[GTM-04e] voucherId rỗng (\"\") KHÔNG phải chương trình: khoản chưa chọn mã mà có giá trị vẫn là tự gõ", () => {
    expect(uuDaiDongKhoaHoc([{ giaTri: 100_000, voucherId: "" }]).lyDo).toEqual(["GO_RIENG"]);
    expect(uuDaiDongKhoaHoc([{ giaTri: 100_000 }]).lyDo).toEqual(["GO_RIENG"]);
  });
  it("[GTM-04f] CHƯƠNG TRÌNH THỨ 3 ⇒ NHIEU_CHUONG_TRINH (biên: đúng 2 qua, 3 duyệt) — chủ dự án chốt 26/10/2026", () => {
    expect(TOI_DA_CHUONG_TRINH_KHONG_DUYET).toBe(2);
    expect(uuDaiDongKhoaHoc([CT(1, "a"), CT(1, "b")]).lyDo).toEqual([]);
    expect(uuDaiDongKhoaHoc([CT(1, "a"), CT(1, "b"), CT(1, "c")])).toEqual({ soChuongTrinh: 3, soGoRieng: 0, lyDo: ["NHIEU_CHUONG_TRINH"] });
    expect(uuDaiDongKhoaHoc([CT(1, "a"), CT(1, "b"), CT(1, "c"), CT(1, "d")]).lyDo).toEqual(["NHIEU_CHUONG_TRINH"]);
  });
  it("[GTM-04g] vừa quá 2 chương trình vừa có khoản tự gõ ⇒ CẢ HAI lý do, theo thứ tự cố định (nhãn dựng từ danh sách, không mất lý do nào)", () => {
    expect(uuDaiDongKhoaHoc([CT(1, "a"), CT(1, "b"), CT(1, "c"), GO()]).lyDo).toEqual(["GO_RIENG", "NHIEU_CHUONG_TRINH"]);
  });
  it("[GTM-04h] laDongKhoaHoc: COURSE_ENROLLMENT và COURSE_PACKAGE là khoá học; PRODUCT, MAKEUP_FEE, EXAM_REGISTRATION, rỗng thì không", () => {
    expect(laDongKhoaHoc("COURSE_ENROLLMENT")).toBe(true);
    expect(laDongKhoaHoc("COURSE_PACKAGE")).toBe(true);
    for (const t of ["PRODUCT", "MAKEUP_FEE", "EXAM_REGISTRATION", "", null, undefined]) expect(laDongKhoaHoc(t), String(t)).toBe(false);
  });
  it("[GTM-04i] câu lý do: mỗi lý do một câu, gọi đúng tên dòng, nhắc đúng con số 2", () => {
    expect(cauLyDoDuyetKhoa("Bé An", "GO_RIENG")).toBe("Bé An: có khoản giảm Sale tự gõ, không thuộc chương trình có sẵn — cần Quản lý cơ sở duyệt.");
    expect(cauLyDoDuyetKhoa("Bé An", "NHIEU_CHUONG_TRINH")).toBe("Bé An: chọn quá 2 chương trình khuyến mãi trên một dòng — cần Quản lý cơ sở duyệt.");
  });
});

describe("[GTM-05] đi qua xetDuyetDon: tự gõ hoặc chương trình thứ 3 ⇒ CHỜ DUYỆT, câu đúng; ví dụ hai anh em đóng đủ 48 buổi ⇒ KHÔNG duyệt", () => {
  /** Mỗi phần tử = danh sách khoản Sale thêm của MỘT dòng KHOÁ HỌC. */
  const xet = (ds: KhoanDeDem[][], tranUuDai = 1) =>
    xetDuyetDon({
      keHoach: [],
      uuDaiTheoDong: ds.map((giam, i) => ({ soUuDai: 0, lyDoKhoa: uuDaiDongKhoaHoc(giam).lyDo, nhan: `Dòng ${i + 1}` })),
      soBuoiTheoDong: ds.map(() => ({ viPham: false, cau: null })),
      nguong: { tranSoDot: 4, tranUuDaiMoiDong: tranUuDai },
    });
  it("1 khoản TỰ GÕ trên dòng đã giảm 15% ⇒ phan.giamGia + câu 'khoản giảm Sale tự gõ … Quản lý cơ sở duyệt'", () => {
    const k = xet([[GO()]]);
    expect(k.phan).toEqual({ giamGia: true, traGop: false, soBuoi: false });
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo).toHaveLength(1);
    expect(k.lyDo[0]).toBe("Dòng 1: có khoản giảm Sale tự gõ, không thuộc chương trình có sẵn — cần Quản lý cơ sở duyệt.");
  });
  it("[GTM-05b] CHỈ chọn chương trình có sẵn, tới 2 ⇒ KHÔNG duyệt (chủ dự án chốt 26/10/2026) — kể cả ngưỡng ưu đãi thấp nhất", () => {
    for (const giam of [[CT()], [CT(100_000, "v-24"), CT(50_000, "v-sib")]]) {
      const k = xet([giam]);
      expect(k.canDuyet).toBe(false);
      expect(k.phan.giamGia).toBe(false);
    }
  });
  it("[GTM-05c] chương trình + 1 khoản tự gõ ⇒ vẫn CHỜ DUYỆT (khoản tự gõ kéo cả đơn vào hàng chờ)", () => {
    const k = xet([[CT(), GO()]]);
    expect(k.canDuyet).toBe(true);
    expect(k.phan.giamGia).toBe(true);
  });
  it("[GTM-05d] BẮT BUỘC không phụ thuộc ngưỡng: nới `orders.maxDiscountItems` lên 2 hoặc 99 thì khoản tự gõ VẪN chờ duyệt", () => {
    expect(xet([[GO()]], 2).canDuyet).toBe(true);
    expect(xet([[GO()]], 99).canDuyet).toBe(true);
    expect(xet([[CT(), GO()]], 99).canDuyet).toBe(true);
    // Đối chứng dương: chỉ chương trình thì ngưỡng nào cũng không duyệt.
    expect(xet([[CT()]], 1).canDuyet).toBe(false);
    expect(xet([[CT()]], 99).canDuyet).toBe(false);
  });
  it("[GTM-05e] CHƯƠNG TRÌNH THỨ 3 ⇒ chờ duyệt kèm câu 'chọn quá 2 chương trình'; nới ngưỡng 99 KHÔNG cứu được (số 2 là hằng, không phải `orders.maxDiscountItems`)", () => {
    const ba = [CT(1, "a"), CT(1, "b"), CT(1, "c")];
    const k = xet([ba]);
    expect(k.canDuyet).toBe(true);
    expect(k.phan.giamGia).toBe(true);
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo).toEqual(["Dòng 1: chọn quá 2 chương trình khuyến mãi trên một dòng — cần Quản lý cơ sở duyệt."]);
    expect(xet([ba], 99).canDuyet).toBe(true);
  });
  it("[GTM-05f] đủ hai lý do ⇒ hai câu, mỗi lý do một câu, không câu nào bị nuốt", () => {
    const k = xet([[CT(1, "a"), CT(1, "b"), CT(1, "c"), GO()]]);
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo).toEqual([
      "Dòng 1: có khoản giảm Sale tự gõ, không thuộc chương trình có sẵn — cần Quản lý cơ sở duyệt.",
      "Dòng 1: chọn quá 2 chương trình khuyến mãi trên một dòng — cần Quản lý cơ sở duyệt.",
    ]);
  });
  it("hai anh em: hạng 1 giảm 15%, hạng 2 giảm 25% theo CHÍNH SÁCH, không khoản thêm ⇒ KHÔNG duyệt", () => {
    const k = xet([[], []]);
    expect(k.canDuyet).toBe(false);
    expect(k.phan.giamGia).toBe(false);
  });
  it("nhiều dòng: chỉ dòng có khoản tự gõ vào lý do (dòng chỉ-chương-trình không bị nêu)", () => {
    const k = xet([[CT()], [GO()]]);
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo).toEqual(["Dòng 2: có khoản giảm Sale tự gõ, không thuộc chương trình có sẵn — cần Quản lý cơ sở duyệt."]);
  });
  it("dòng KHÔNG phải khoá học vẫn dùng câu cũ và so ngưỡng (đối chứng)", () => {
    const k = xetDuyetDon({
      keHoach: [],
      uuDaiTheoDong: [{ soUuDai: 3, lyDoKhoa: [], nhan: "Dòng 1" }],
      soBuoiTheoDong: [{ viPham: false, cau: null }],
      nguong: { tranSoDot: 4, tranUuDaiMoiDong: 1 },
    });
    if (!k.canDuyet) throw new Error("phải chờ duyệt");
    expect(k.lyDo[0]).toBe("Dòng 1: áp 3 ưu đãi, vượt mức 1 ưu đãi một dòng.");
    // Nới ngưỡng lên 3 ⇒ dòng thường qua; dòng khoá học có khoản tự gõ thì KHÔNG (xem [GTM-05d]).
    expect(
      xetDuyetDon({
        keHoach: [],
        uuDaiTheoDong: [{ soUuDai: 3, lyDoKhoa: [], nhan: "Dòng 1" }],
        soBuoiTheoDong: [{ viPham: false, cau: null }],
        nguong: { tranSoDot: 4, tranUuDaiMoiDong: 3 },
      }).canDuyet,
    ).toBe(false);
  });
});

describe("[GTM-07] MỘT VĂN BẢN CHỈ ÁP MỘT MÃ TRÊN MỘT DÒNG (chủ dự án chốt 26/10/2026)", () => {
  const M = (ma: string, maVanBan: string): MaTheoVanBan => ({ ma, maVanBan });
  const bang = new Map<string, MaTheoVanBan>([
    ["v-full15", M("FULL15", "SR.QD.233")],
    ["v-6thang10", M("SIXMONTH10", "SR.QD.233")],
    ["v-sib", M("ANHEM", "SR.QD.240")],
  ]);
  const K = (voucherId: string | null) => ({ voucherId });
  it("hai mã CÙNG văn bản ⇒ khoản thứ hai bị nêu, kèm khoản đứng trước", () => {
    const t = khoanTrungVanBan([K("v-full15"), K("v-6thang10")], bang);
    expect(t).toHaveLength(1);
    expect(t[0]!.chiSo).toBe(1);
    expect(t[0]!.truoc).toBe(0);
    expect(t[0]!.ma.ma).toBe("SIXMONTH10");
    expect(t[0]!.maTruoc.ma).toBe("FULL15");
  });
  it("đối chứng dương: hai mã KHÁC văn bản (đóng full 15% + anh em) ⇒ không trùng", () => {
    expect(khoanTrungVanBan([K("v-full15"), K("v-sib")], bang)).toEqual([]);
  });
  it("CÙNG một mã chọn hai lần cũng là cùng văn bản ⇒ trùng", () => {
    expect(khoanTrungVanBan([K("v-sib"), K("v-sib")], bang)).toHaveLength(1);
  });
  it("khoản tự gõ, mã không tra được: bỏ qua (cổng mã lạ đứng trước lo); không đẻ trùng giả", () => {
    expect(khoanTrungVanBan([K(null), K(null), K("khong-co"), K("khong-co")], bang)).toEqual([]);
    expect(khoanTrungVanBan([K("v-full15"), K(null), K("v-6thang10")], bang)).toHaveLength(1);
  });
  it("ba mã cùng văn bản ⇒ hai khoản vi phạm (khoản 2 và 3 đều trỏ về khoản 1)", () => {
    const b = new Map(bang).set("v-x", M("X", "SR.QD.233"));
    const t = khoanTrungVanBan([K("v-full15"), K("v-6thang10"), K("v-x")], b);
    expect(t.map((x) => [x.chiSo, x.truoc])).toEqual([[1, 0], [2, 0]]);
  });
  it("vanBanDaDungKhac: bộ chọn của khoản i khoá văn bản đã dùng ở khoản KHÁC, không tự khoá văn bản của chính nó", () => {
    const giam = [K("v-full15"), K("v-sib")];
    expect([...vanBanDaDungKhac(giam, bang, 0).keys()]).toEqual(["SR.QD.240"]);
    expect([...vanBanDaDungKhac(giam, bang, 1).keys()]).toEqual(["SR.QD.233"]);
    expect([...vanBanDaDungKhac([K("v-full15")], bang, 0).keys()]).toEqual([]);
  });
  it("câu từ chối nêu dòng, HAI mã và văn bản", () => {
    const t = khoanTrungVanBan([K("v-full15"), K("v-6thang10")], bang)[0]!;
    const cau = loiTrungVanBan("Dòng 1 (Sata 3)", t);
    expect(cau).toContain("Dòng 1 (Sata 3)");
    expect(cau).toContain("FULL15");
    expect(cau).toContain("SIXMONTH10");
    expect(cau).toContain("SR.QD.233");
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
