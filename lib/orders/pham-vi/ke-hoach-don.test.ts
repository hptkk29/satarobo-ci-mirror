// lib/orders/pham-vi/ke-hoach-don.test.ts — KẾ HOẠCH CẢ ĐƠN theo phạm vi học: bảng quyết định LEGACY | SCOPE | REJECT.
// THUẦN (không DB, không đồng hồ thật — luật 19: ngày tuyệt đối, truyền vào).
//
// Số liệu mang hình dạng THẬT (luật đọc số): 10.560.000 / 11.520.000 là giá 48 buổi Sata3 / Sata4 của PL02 (chia hết),
// 10.400.003 là giá lẻ KHÔNG chia hết để ép nhánh `GIA_KHONG_NGUYEN_DONG`. Kỳ vọng tính tay từ bảng PL02
// (A: 12→0 · 24→5 · 36→10; B: sp48 thứ nhất 15 / thứ hai trở đi 25; anh em +0/+10/+15; trần 25).
import { describe, expect, it } from "vitest";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { SO_BUOI_HOP_LE } from "@/lib/orders/so-buoi-hoc-phan";
import { dinhDangDong, keHoachDon, xepHang, type BoiCanhDon, type DongVao, type KetQuaDon } from "./ke-hoach-don";

const NGAY = new Date("2026-10-11T03:00:00Z");

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: NGAY,
  coKeHoachDot: false,
};

/** Dòng khoá 48 buổi hợp lệ, `donGiaKhach` mặc định = số ĐÚNG của Sata3-48 (ca nào cần giá khác tự ghi đè). */
function dong(o: Partial<DongVao> = {}): DongVao {
  return {
    loai: "COURSE_ENROLLMENT",
    tenDong: "Sata 3",
    soLuong: 1,
    donGiaKhach: 8_976_000,
    soKhoanGiam: 0,
    laLopNhom: true,
    tongSoBuoiKhoa: 48,
    soBuoiMua: 48,
    gia48: 10_560_000,
    conKhoa: "con-a",
    ...o,
  };
}

const SATA4_48 = { tenDong: "Sata 4", gia48: 11_520_000, conKhoa: "con-b" } as const;

function scope(k: KetQuaDon) {
  if (k.kieu !== "SCOPE") throw new Error(`mong SCOPE, được ${JSON.stringify(k)}`);
  return k.dong;
}
function tuChoi(k: KetQuaDon): string {
  if (k.kieu !== "REJECT") throw new Error(`mong REJECT, được ${JSON.stringify(k).slice(0, 200)}`);
  return k.thongBao;
}

describe("[ĐSC] kế hoạch đơn theo phạm vi học", () => {
  describe("[ĐSC-01] full course 48 buổi", () => {
    it("một con, Sata3-48: SCOPE FULL, niêm yết 10.560.000, giảm 15% (Bảng B sản phẩm thứ nhất) ⇒ 8.976.000", () => {
      const [d] = scope(keHoachDon([dong()], BOI_CANH));
      expect(d).toMatchObject({ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, thanhTien: 8_976_000 });
      expect(d!.pricingSnapshot).toMatchObject({
        gia48: 10_560_000,
        nguonGia48: "Course.price",
        phanTramNen: 15,
        phanTramCongThem: 0,
        phanTramApDung: 15,
        thuTuCon: 1,
        thuTuSanPham48: 1,
        cheDoMocNgay: "ORDER_CREATED",
        ngayApGia: NGAY.toISOString(),
      });
      // Cửa sổ hiệu lực chụp vào snapshot theo giờ VN: 01/09/2026 00:00 (+07) = 31/08 17:00Z.
      expect(d!.pricingSnapshot.hieuLucChinhSach).toEqual({ tu: "2026-08-31T17:00:00.000Z", den: "2026-12-31T17:00:00.000Z" });
    });

    it("snapshot mang cả niêm yết lẫn số giảm: 10.560.000 − 8.976.000 = 1.584.000 (15% của niêm yết, không làm tròn)", () => {
      const [d] = scope(keHoachDon([dong()], BOI_CANH));
      expect(d!.niemYet - d!.thanhTien).toBe(1_584_000);
      expect(d!.pricingSnapshot.thanhTien).toBe(d!.thanhTien);
      expect(d!.pricingSnapshot.niemYet).toBe(d!.niemYet);
    });
  });

  describe("[ĐSC-02] theo học phần 12 / 24 / 36", () => {
    const BANG: ReadonlyArray<readonly [number, number, number, number]> = [
      // [buổi, niêm yết, % áp, thành tiền] — Sata3, gia48 = 10.560.000, con thứ nhất
      [12, 2_640_000, 0, 2_640_000],
      [24, 5_280_000, 5, 5_016_000],
      [36, 7_920_000, 10, 7_128_000],
    ];
    for (const [n, ny, pct, tt] of BANG) {
      it(`${n} buổi ⇒ MILESTONE, niêm yết ${ny}, giảm ${pct}% ⇒ ${tt}`, () => {
        const [d] = scope(keHoachDon([dong({ soBuoiMua: n, donGiaKhach: tt })], BOI_CANH));
        expect(d).toMatchObject({ soBuoi: n, loaiMua: "MILESTONE", niemYet: ny, thanhTien: tt });
        expect(d!.pricingSnapshot.phanTramApDung).toBe(pct);
        // Số buổi 12/24/36 không tính vào thứ tự sản phẩm 48 nhưng snapshot vẫn mang giá trị mặc định 1.
        expect(d!.pricingSnapshot.thuTuSanPham48).toBe(1);
      });
    }
  });

  describe("[ĐSC-03] số buổi lẻ và các dòng không bán được theo phạm vi", () => {
    it("mọi số buổi ngoài 12/24/36/48 bị từ chối (đợt đầu không bán buổi lẻ — MT-11/Q9), kể cả khi đơn giá khớp niêm yết", () => {
      for (const n of [1, 6, 10, 13, 25, 35, 47, 49, 60]) {
        const k = keHoachDon([dong({ soBuoiMua: n })], BOI_CANH);
        expect(tuChoi(k), `n=${n}`).toContain("không nằm trong các mốc");
      }
    });

    it("đối chứng dương: ĐÚNG các mốc hợp lệ của luật 25/09 đều qua (bảng mốc và planner không lệch nhau)", () => {
      for (const n of SO_BUOI_HOP_LE) {
        const ny = (10_560_000 * n) / 48;
        const pct = n === 12 ? 0 : n === 24 ? 5 : n === 36 ? 10 : 15;
        const tt = (ny * (100 - pct)) / 100;
        expect(keHoachDon([dong({ soBuoiMua: n, donGiaKhach: tt })], BOI_CANH).kieu, `n=${n}`).toBe("SCOPE");
      }
    });

    it("không khai số buổi ⇒ từ chối, KHÔNG suy về 48 (khác luật duyệt 25/09 vốn suy về đủ khoá)", () => {
      expect(tuChoi(keHoachDon([dong({ soBuoiMua: null })], BOI_CANH))).toContain("Chưa chọn số buổi");
    });

    it("số lượng khác 1 · Coach 1-1/1-2/1-4 trên khoá 48 buổi ⇒ từ chối", () => {
      expect(tuChoi(keHoachDon([dong({ soLuong: 2 })], BOI_CANH))).toContain("số lượng 1");
      expect(tuChoi(keHoachDon([dong({ laLopNhom: false })], BOI_CANH))).toContain("Coach");
    });

    it("giá 48 chưa có (khoá không có `price`) ⇒ từ chối fail-closed; giá lẻ không chia hết đồng ⇒ từ chối, không làm tròn", () => {
      expect(tuChoi(keHoachDon([dong({ gia48: null })], BOI_CANH))).toContain("Chưa có giá niêm yết");
      // 10.400.003 × 12 ÷ 48 = 2.600.000,75 — không ra số nguyên đồng.
      expect(tuChoi(keHoachDon([dong({ gia48: 10_400_003, soBuoiMua: 12 })], BOI_CANH))).toContain("không tròn đồng");
      // 48 buổi: niêm yết nguyên nhưng 85% của nó (8.840.002,55) thì không.
      expect(tuChoi(keHoachDon([dong({ gia48: 10_400_003 })], BOI_CANH))).toContain("không tròn đồng");
    });

    it("đơn giá client lệch số máy chủ tính ⇒ từ chối và NÓI RA số đúng (không ghi đè im lặng)", () => {
      const msg = tuChoi(keHoachDon([dong({ donGiaKhach: 10_560_000 })], BOI_CANH)); // giá niêm yết, quên giảm 15%
      expect(msg).toContain("đơn giá phải là 8.976.000đ");
      expect(msg).toContain("Đang nhập 10.560.000đ");
      expect(tuChoi(keHoachDon([dong({ donGiaKhach: 8_975_999 })], BOI_CANH))).toContain("8.976.000đ");
    });

    it("khoá KHÔNG phải 48 buổi (Sata 1 = 11 buổi) · dòng sản phẩm ⇒ LEGACY dù cờ bật", () => {
      expect(keHoachDon([dong({ tongSoBuoiKhoa: 11, soBuoiMua: 11 })], BOI_CANH)).toEqual({ kieu: "LEGACY" });
      expect(keHoachDon([dong({ loai: "PRODUCT", tongSoBuoiKhoa: null, soBuoiMua: null, gia48: null })], BOI_CANH)).toEqual({ kieu: "LEGACY" });
      expect(keHoachDon([], BOI_CANH)).toEqual({ kieu: "LEGACY" });
    });
  });

  describe("[ĐSC-04] nhiều con, nhiều khoá, và đơn trộn", () => {
    it("hai con, hai khoá 48 (Sata3 + Sata4), thấp trước: Sata3 = con 1 · sp48 #1 ⇒ 15%; Sata4 = con 2 · sp48 #2 ⇒ 25% (35% bị cắt trần)", () => {
      const ra = scope(keHoachDon([dong(), dong({ ...SATA4_48, donGiaKhach: 8_640_000 })], BOI_CANH));
      expect(ra[0]).toMatchObject({ thanhTien: 8_976_000 });
      expect(ra[0]!.pricingSnapshot).toMatchObject({ thuTuCon: 1, thuTuSanPham48: 1, phanTramApDung: 15 });
      expect(ra[1]).toMatchObject({ niemYet: 11_520_000, thanhTien: 8_640_000 });
      expect(ra[1]!.pricingSnapshot).toMatchObject({ thuTuCon: 2, thuTuSanPham48: 2, phanTramNen: 25, phanTramCongThem: 10, phanTramApDung: 25, biCatTran: true });
      expect(ra.reduce((s, d) => s + d.thanhTien, 0)).toBe(17_616_000);
    });

    it("cùng đơn đó nhưng KHÔNG phụ thuộc thứ tự dòng: đảo hai dòng thì mỗi con vẫn nhận đúng giá", () => {
      const ra = scope(keHoachDon([dong({ ...SATA4_48, donGiaKhach: 8_640_000 }), dong()], BOI_CANH));
      expect(ra[0]!.thanhTien).toBe(8_640_000); // Sata4 vẫn là con 2
      expect(ra[1]!.thanhTien).toBe(8_976_000); // Sata3 vẫn là con 1
    });

    it("đổi mặc định sang CAO TRƯỚC: Sata4 thành con 1 (15% ⇒ 9.792.000), Sata3 thành con 2 (25% ⇒ 7.920.000)", () => {
      const ra = scope(
        keHoachDon([dong({ donGiaKhach: 7_920_000 }), dong({ ...SATA4_48, donGiaKhach: 9_792_000 })], { ...BOI_CANH, thuTuMacDinh: "HIGHER_VALUE_FIRST" }),
      );
      expect(ra[0]).toMatchObject({ thanhTien: 7_920_000 });
      expect(ra[1]).toMatchObject({ thanhTien: 9_792_000 });
      expect(ra[1]!.pricingSnapshot.thuTuCon).toBe(1);
    });

    it("mỗi dòng mang đúng con của nó: hai dòng CÙNG một con thì chung thứ hạng con, nhưng sp48 vẫn đếm theo từng sản phẩm", () => {
      // Con A mua Sata3-48 và Sata4-48: cùng thứ hạng con 1, sp48 #1 (rẻ hơn) và #2 ⇒ 15% và 25%.
      const ra = scope(keHoachDon([dong(), dong({ tenDong: "Sata 4", gia48: 11_520_000, donGiaKhach: 8_640_000 })], BOI_CANH));
      expect(ra.map((d) => d.pricingSnapshot.thuTuCon)).toEqual([1, 1]);
      expect(ra.map((d) => d.pricingSnapshot.thuTuSanPham48)).toEqual([1, 2]);
      expect(ra.map((d) => d.thanhTien)).toEqual([8_976_000, 8_640_000]);
    });

    it("dòng 12/24/36 không chiếm hạng sản phẩm 48; hạng con theo TỔNG niêm yết của con (thấp trước)", () => {
      // Con A: Sata3-48 (niêm yết 10.560.000). Con B: Sata4-24 (niêm yết 5.760.000) ⇒ B rẻ hơn ⇒ B là con 1, A là con 2.
      const ra = scope(keHoachDon([dong({ donGiaKhach: 7_920_000 }), dong({ ...SATA4_48, soBuoiMua: 24, donGiaKhach: 5_472_000 })], BOI_CANH));
      // A: sp48 #1 (dòng 24 không đếm) ⇒ nền 15% + con 2 +10% = 25% ⇒ 7.920.000.
      expect(ra[0]!.pricingSnapshot).toMatchObject({ thuTuCon: 2, thuTuSanPham48: 1, phanTramNen: 15, phanTramCongThem: 10, phanTramApDung: 25 });
      expect(ra[0]!.thanhTien).toBe(7_920_000);
      // B: bảng A 24 buổi = 5% + con 1 +0% ⇒ 5.472.000.
      expect(ra[1]!.pricingSnapshot).toMatchObject({ thuTuCon: 1, phanTramNen: 5, phanTramCongThem: 0, phanTramApDung: 5 });
      expect(ra[1]!.thanhTien).toBe(5_472_000);
    });

    it("giá 48 mà ở hạng 1 (15%) không tròn đồng nhưng ở hạng THẬT (25%) thì tròn ⇒ vẫn SCOPE (lượt phân loại không được từ chối sớm)", () => {
      // 11.520.004 × 85% = 9.792.003,4 (lẻ) · × 75% = 8.640.003 (tròn). Dòng này là con 2 / sp48 #2 vì đắt hơn.
      const ra = scope(keHoachDon([dong(), dong({ ...SATA4_48, gia48: 11_520_004, donGiaKhach: 8_640_003 })], BOI_CANH));
      expect(ra[1]).toMatchObject({ thanhTien: 8_640_003 });
      expect(ra[1]!.pricingSnapshot).toMatchObject({ thuTuCon: 2, thuTuSanPham48: 2, phanTramApDung: 25 });
      // Đối chứng: cùng dòng đó đứng MỘT MÌNH là hạng 1 (15%) ⇒ lẻ ⇒ từ chối.
      expect(tuChoi(keHoachDon([dong({ ...SATA4_48, gia48: 11_520_004, donGiaKhach: 8_640_003 })], BOI_CANH))).toContain("không tròn đồng");
    });

    it("nhiều dòng mà có dòng không chọn học viên/con ⇒ từ chối (không xếp được con thứ nhất, thứ hai)", () => {
      expect(tuChoi(keHoachDon([dong(), dong({ ...SATA4_48, conKhoa: null })], BOI_CANH))).toContain("chọn rõ học viên/con");
    });

    it("MỘT dòng không chọn con thì vẫn qua (con duy nhất = con thứ nhất)", () => {
      expect(keHoachDon([dong({ conKhoa: null })], BOI_CANH).kieu).toBe("SCOPE");
    });

    it("ĐƠN TRỘN (Q17 chưa chốt): dòng 48 buổi + dòng khoá khác / sản phẩm ⇒ TỪ CHỐI, nói rõ dòng nào, không đoán", () => {
      const sata1 = dong({ tenDong: "Sata 1", tongSoBuoiKhoa: 11, soBuoiMua: 11, conKhoa: "con-b" });
      const msg = tuChoi(keHoachDon([dong(), sata1], BOI_CANH));
      expect(msg).toContain("đơn trộn");
      expect(msg).toContain("Dòng 2 (Sata 1)");
      const kit = dong({ loai: "PRODUCT", tenDong: "Hộp LEGO", tongSoBuoiKhoa: null, soBuoiMua: null, gia48: null });
      expect(tuChoi(keHoachDon([kit, dong()], BOI_CANH))).toContain("Dòng 1 (Hộp LEGO)");
    });

    it("đơn trộn bị từ chối dù dòng không-SCOPE đứng TRƯỚC hay SAU (thứ tự dòng không làm lọt)", () => {
      const sata1 = dong({ tenDong: "Sata 1", tongSoBuoiKhoa: 11, soBuoiMua: 11, conKhoa: "con-b" });
      expect(keHoachDon([sata1, dong()], BOI_CANH).kieu).toBe("REJECT");
      expect(keHoachDon([dong(), sata1], BOI_CANH).kieu).toBe("REJECT");
    });

    it("một dòng 48 hỏng thì cả đơn hỏng, và câu lỗi nói đúng dòng đó", () => {
      const msg = tuChoi(keHoachDon([dong(), dong({ ...SATA4_48, soBuoiMua: 13 })], BOI_CANH));
      expect(msg).toContain("Dòng 2 (Sata 4)");
    });
  });

  describe("[ĐSC-04b] các cổng chưa chốt: từ chối thay vì đoán", () => {
    it("kế hoạch nhiều đợt trên đơn SCOPE ⇒ từ chối", () => {
      expect(tuChoi(keHoachDon([dong()], { ...BOI_CANH, coKeHoachDot: true }))).toContain("không chia kế hoạch nhiều đợt");
    });
    it("[20/10/2026] khoản giảm tay / mã khuyến mãi trên dòng SCOPE KHÔNG còn bị planner từ chối: kết quả y hệt dòng không khoản; đơn giá lệch vẫn bị từ chối và câu chỉ đường 'thêm khoản giảm ở dòng'; dòng LEGACY không bị đụng", () => {
      const khong = keHoachDon([dong()], BOI_CANH);
      expect(khong.kieu).toBe("SCOPE");
      expect(keHoachDon([dong({ soKhoanGiam: 1 })], BOI_CANH)).toEqual(khong);
      expect(keHoachDon([dong({ soKhoanGiam: 3 })], BOI_CANH)).toEqual(khong);
      // Client KHÔNG tự đặt giá: dù có khoản giảm, đơn giá phải bằng thành tiền hệ thống tính — và câu từ chối nói muốn giảm thêm thì làm gì.
      const loi = tuChoi(keHoachDon([dong({ soKhoanGiam: 1, donGiaKhach: 8_000_000 })], BOI_CANH));
      expect(loi).toContain("đơn giá phải là 8.976.000đ");
      expect(loi).toContain("muốn giảm, hãy thêm khoản giảm ở dòng: chọn chương trình khuyến mãi có sẵn");
      expect(loi).toContain("chờ quản lý duyệt");
      expect(keHoachDon([dong({ tongSoBuoiKhoa: 11, soBuoiMua: 11, soKhoanGiam: 2 })], BOI_CANH)).toEqual({ kieu: "LEGACY" });
    });
  });

  describe("[ĐSC-05] cờ và cửa sổ hiệu lực", () => {
    it("cờ TẮT ⇒ LEGACY với MỌI đầu vào, kể cả đầu vào sẽ bị từ chối khi bật", () => {
      const tat = { ...BOI_CANH, phamViBat: false };
      expect(keHoachDon([dong()], tat)).toEqual({ kieu: "LEGACY" });
      expect(keHoachDon([dong({ soBuoiMua: 13, soLuong: 5, gia48: null })], tat)).toEqual({ kieu: "LEGACY" });
      expect(keHoachDon([dong(), dong({ tenDong: "Sata 1", tongSoBuoiKhoa: 11, soBuoiMua: 11 })], { ...tat, coKeHoachDot: true })).toEqual({ kieu: "LEGACY" });
    });

    it("cửa sổ PL02 nửa mở theo giờ VN: 00:00 01/09 (+07) vào được; 23:59:59 31/12 vào được; 00:00 01/01/2027 (+07) thì không", () => {
      const o = (iso: string) => keHoachDon([dong()], { ...BOI_CANH, taoDon: new Date(iso) }).kieu;
      expect(o("2026-08-31T16:59:59Z")).toBe("REJECT");
      expect(o("2026-08-31T17:00:00Z")).toBe("SCOPE");
      expect(o("2026-12-31T16:59:59Z")).toBe("SCOPE");
      expect(o("2026-12-31T17:00:00Z")).toBe("REJECT");
    });

    it("mốc ngày là ngày TIỀN VỀ mà tiền chưa về ⇒ từ chối (không rơi về ngày tạo đơn)", () => {
      expect(tuChoi(keHoachDon([dong()], { ...BOI_CANH, cheDoMocNgay: "PAYMENT_RECEIVED" }))).toContain("ngày tiền về");
    });
  });

  describe("[ĐSC-06] tiện ích", () => {
    it("xepHang ổn định: hoà giữ thứ tự xuất hiện, không đồng hạng", () => {
      expect(xepHang([5, 5, 3], "LOWER_VALUE_FIRST")).toEqual([2, 3, 1]);
      expect(xepHang([5, 5, 3], "HIGHER_VALUE_FIRST")).toEqual([1, 2, 3]);
      expect(xepHang([], "LOWER_VALUE_FIRST")).toEqual([]);
    });
    it("dinhDangDong không phụ thuộc ICU", () => {
      expect(dinhDangDong(8_976_000)).toBe("8.976.000");
      expect(dinhDangDong(999)).toBe("999");
      expect(dinhDangDong(1_000)).toBe("1.000");
    });
  });
});
