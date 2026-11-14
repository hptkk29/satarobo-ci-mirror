import { describe, expect, it } from "vitest";
import { ORACLE_GIA } from "./tinh-gia-theo-moc.oracle";
import { CHINH_SACH_PL02, tinhGiaTheoMoc, type ChinhSachGia } from "./tinh-gia-theo-moc";
import {
  keHoachDongDon,
  type BoiCanhKeHoach,
  type DongDonVao,
  type KeHoachDongDon,
  type MaTuChoi,
} from "./ke-hoach-dong-don";

// Ngày TUYỆT ĐỐI (luật 19): không test nào đọc đồng hồ thật.
const TU = new Date("2026-08-31T17:00:00Z"); // 00:00 01/09/2026 giờ VN
const DEN = new Date("2026-12-31T17:00:00Z"); // 00:00 01/01/2027 giờ VN — nửa mở: ngày này đã NGOÀI cửa sổ
const GIUA = new Date("2026-10-11T05:00:00Z");

const boiCanh = (o: Partial<BoiCanhKeHoach> = {}): BoiCanhKeHoach => ({
  phamViBat: true,
  gia48: 9_792_000,
  nguonGia48: "BANG_GIA_RIENG:thu-nghiem",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: { tu: TU, den: DEN },
  cheDoMocNgay: "ORDER_CREATED",
  ngay: { taoDon: GIUA },
  ...o,
});

const dong = (o: Partial<DongDonVao> = {}): DongDonVao => ({
  loai: "COURSE_ENROLLMENT",
  soLuong: 1,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 24,
  thuTuCon: 1,
  thuTuSanPham48: 1,
  ...o,
});

function scope(kq: KeHoachDongDon) {
  if (kq.quyetDinh !== "SCOPE") throw new Error(`mong SCOPE, được ${JSON.stringify(kq)}`);
  return kq;
}
function tuChoi(kq: KeHoachDongDon): MaTuChoi {
  if (kq.quyetDinh !== "REJECT") throw new Error(`mong REJECT, được ${JSON.stringify(kq)}`);
  return kq.ma;
}

describe("[KHD] planner dòng đơn theo phạm vi học: LEGACY | SCOPE | REJECT", () => {
  describe("[KHD-A] LEGACY — dòng KHÔNG thuộc mô hình mới thì không bao giờ bị từ chối", () => {
    it("[KHD-A1] cờ TẮT ⇒ LEGACY, kể cả dòng mà nếu cờ bật sẽ bị từ chối (qty 3, Coach, số buổi lẻ, không giá)", () => {
      const xau = dong({ soLuong: 3, laLopNhom: false, soBuoiMua: 17 });
      expect(keHoachDongDon(xau, boiCanh({ phamViBat: false, gia48: null }))).toEqual({ quyetDinh: "LEGACY", lyDo: "CO_TAT" });
      // Đối chứng dương: cùng dòng ấy với cờ BẬT thì bị từ chối — nên ca trên thật sự đo cờ.
      expect(keHoachDongDon(xau, boiCanh({ gia48: null })).quyetDinh).toBe("REJECT");
    });

    it("[KHD-A2] dòng KHÔNG phải ghi danh khoá học (sản phẩm, kit, phí học bù, thi) ⇒ LEGACY dù số lượng 3 — không REJECT", () => {
      for (const loai of ["PRODUCT", "MAKEUP_FEE", "EXAM_REGISTRATION", "COURSE_PACKAGE"] as const) {
        const kq = keHoachDongDon(dong({ loai, soLuong: 3, laLopNhom: false, soBuoiMua: null }), boiCanh({ gia48: null }));
        expect(kq, loai).toEqual({ quyetDinh: "LEGACY", lyDo: "DONG_KHONG_PHAI_KHOA_HOC" });
      }
    });

    it("[KHD-A3] khoá KHÔNG có 48 buổi (12, 11, 23 buổi hoặc không khai) ⇒ LEGACY — kể cả Coach, số lượng 2, số buổi lẻ", () => {
      for (const tong of [9, 11, 12, 23, 47, 49, null]) {
        const kq = keHoachDongDon(dong({ tongSoBuoiKhoa: tong, soLuong: 2, laLopNhom: false, soBuoiMua: 7 }), boiCanh({ gia48: null }));
        expect(kq, String(tong)).toEqual({ quyetDinh: "LEGACY", lyDo: "KHOA_NGOAI_PHAM_VI" });
      }
    });
  });

  describe("[KHD-S] SCOPE — giá khớp ĐÁP ÁN ĐỘC LẬP (không phải chính mã đang kiểm)", () => {
    it("[KHD-S1] toàn bộ 100 ô đáp án độc lập (5 giá × 20 ô): số tiền, niêm yết, % áp dụng, cắt trần", () => {
      expect(ORACLE_GIA.length).toBe(100);
      for (const [gia48, soBuoi, thuTuCon, thuTuSp, niemYet, pt, catTran, thanhTien] of ORACLE_GIA) {
        const kq = scope(keHoachDongDon(dong({ soBuoiMua: soBuoi, thuTuCon, thuTuSanPham48: thuTuSp }), boiCanh({ gia48 })));
        const nhan = `${gia48}/${soBuoi}/con${thuTuCon}/sp${thuTuSp}`;
        expect(kq.baoGia.gia.thanhTien, nhan).toBe(thanhTien);
        expect(kq.baoGia.gia.niemYet, nhan).toBe(niemYet);
        expect(kq.baoGia.gia.phanTramApDung, nhan).toBe(pt);
        expect(kq.baoGia.gia.biCatTran, nhan).toBe(catTran);
      }
    });

    it("[KHD-S2] giá lẻ thật 9.792.000 (204.000 đ/buổi): 12 / 24 / 36 / 48 buổi ra từng đồng, KHÔNG làm tròn", () => {
      const ra = [12, 24, 36, 48].map((n) => {
        const k = scope(keHoachDongDon(dong({ soBuoiMua: n }), boiCanh()));
        return [n, k.baoGia.gia.niemYet, k.baoGia.gia.thanhTien];
      });
      expect(ra).toEqual([
        [12, 2_448_000, 2_448_000],
        [24, 4_896_000, 4_651_200],
        [36, 7_344_000, 6_609_600],
        [48, 9_792_000, 8_323_200],
      ]);
    });

    it("[KHD-S3] con thứ hai + gói trọn sản phẩm thứ hai: cộng dồn rồi cắt trần 25% — ghi nhận cắt trần", () => {
      const k = scope(keHoachDongDon(dong({ soBuoiMua: 48, thuTuCon: 3, thuTuSanPham48: 2 }), boiCanh()));
      expect(k.baoGia.gia).toMatchObject({ phanTramNen: 25, phanTramCongThem: 15, phanTramApDung: 25, biCatTran: true, thanhTien: 7_344_000 });
    });

    it("[KHD-S4] loại mua: 12/24/36 là MILESTONE, 48 là FULL; không bao giờ CUSTOM (số lẻ bị từ chối)", () => {
      const loai = [12, 24, 36, 48].map((n) => scope(keHoachDongDon(dong({ soBuoiMua: n }), boiCanh())).loaiMua);
      expect(loai).toEqual(["MILESTONE", "MILESTONE", "MILESTONE", "FULL"]);
    });

    it("[KHD-S5] snapshot chụp ĐỦ để dựng lại giá sau này: chính sách, thứ tự, ngày áp, nguồn giá 48 và cửa sổ hiệu lực", () => {
      const cs: ChinhSachGia = { ...CHINH_SACH_PL02, tranTong: 30 };
      const k = scope(keHoachDongDon(dong({ soBuoiMua: 24, thuTuCon: 2 }), boiCanh({ chinhSach: cs })));
      expect(k.pricingSnapshot).toMatchObject({
        gia48: 9_792_000,
        soBuoi: 24,
        loai: "MILESTONE",
        thuTuCon: 2,
        thuTuSanPham48: 1,
        quyTacBuoiLe: "TU_CHOI",
        cheDoMocNgay: "ORDER_CREATED",
        ngayApGia: GIUA.toISOString(),
        nguonGia48: "BANG_GIA_RIENG:thu-nghiem",
        hieuLucChinhSach: { tu: TU.toISOString(), den: DEN.toISOString() },
      });
      expect(k.pricingSnapshot.chinhSach).toEqual(cs);
      // Snapshot lấy từ CÙNG báo giá, không phải bản dựng thứ hai.
      expect(k.pricingSnapshot.thanhTien).toBe(k.baoGia.gia.thanhTien);
    });

    it("[KHD-S6] mốc ngày TIỀN VỀ: tạo đơn ngoài cửa sổ nhưng tiền về trong cửa sổ ⇒ SCOPE, ngày áp = ngày tiền về", () => {
      const taoDon = new Date("2026-08-31T16:59:59Z"); // 23:59:59 31/08 VN — NGOÀI cửa sổ
      const tienVe = new Date("2026-09-02T03:00:00Z");
      const kq = keHoachDongDon(dong(), boiCanh({ cheDoMocNgay: "PAYMENT_RECEIVED", ngay: { taoDon, tienVe } }));
      expect(scope(kq).pricingSnapshot.ngayApGia).toBe(tienVe.toISOString());
      expect(tuChoi(keHoachDongDon(dong(), boiCanh({ cheDoMocNgay: "ORDER_CREATED", ngay: { taoDon, tienVe } })))).toBe("NGOAI_CUA_SO_CHINH_SACH");
    });
  });

  describe("[KHD-R] REJECT — mỗi quy tắc một mã", () => {
    it("[KHD-R1] số lượng khác 1 ⇒ SO_LUONG_KHAC_1 (0, 2, 1.5)", () => {
      for (const soLuong of [0, 2, 1.5, -1]) expect(tuChoi(keHoachDongDon(dong({ soLuong }), boiCanh())), String(soLuong)).toBe("SO_LUONG_KHAC_1");
    });

    it("[KHD-R2] Coach (1-1, 1-2, 1-4) trên khoá 48 buổi ⇒ COACH_TREN_KHOA_48", () => {
      expect(tuChoi(keHoachDongDon(dong({ laLopNhom: false }), boiCanh()))).toBe("COACH_TREN_KHOA_48");
    });

    it("[KHD-R3] số buổi KHÔNG khai ⇒ SO_BUOI_CHUA_CHON — KHÔNG suy về 48 như luật duyệt mốc học phần", () => {
      expect(tuChoi(keHoachDongDon(dong({ soBuoiMua: null }), boiCanh()))).toBe("SO_BUOI_CHUA_CHON");
    });

    it("[KHD-R4] số buổi lẻ / không nguyên / ngoài khoá ⇒ SO_BUOI_LE (đợt đầu không định giá được)", () => {
      for (const soBuoiMua of [1, 11, 13, 18, 30, 47, 49, 60, 24.5, Number.NaN]) {
        expect(tuChoi(keHoachDongDon(dong({ soBuoiMua }), boiCanh())), String(soBuoiMua)).toBe("SO_BUOI_LE");
      }
    });

    it("[KHD-R5] chính sách lệch số buổi cả gói so với hằng của luật duyệt ⇒ CHINH_SACH_LECH_SO_BUOI (ba nguồn của '48' không được lệch nhau)", () => {
      const lech: ChinhSachGia = { ...CHINH_SACH_PL02, soBuoiCaGoi: 60 };
      expect(tuChoi(keHoachDongDon(dong(), boiCanh({ chinhSach: lech })))).toBe("CHINH_SACH_LECH_SO_BUOI");
    });

    it("[KHD-R6] không tra được giá 48 ⇒ GIA_48_CHUA_CO (fail-closed, KHÔNG rơi về giá khác)", () => {
      expect(tuChoi(keHoachDongDon(dong(), boiCanh({ gia48: null })))).toBe("GIA_48_CHUA_CO");
    });

    it("[KHD-R7] giá 48 không phải số nguyên đồng dương ⇒ GIA_48_KHONG_HOP_LE", () => {
      for (const gia48 of [0, -9_792_000, 9_792_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(tuChoi(keHoachDongDon(dong(), boiCanh({ gia48 }))), String(gia48)).toBe("GIA_48_KHONG_HOP_LE");
      }
    });

    it("[KHD-R7b] giá 48 bằng 0 bị chặn bởi CHÍNH cổng của planner (thông báo của planner), không chỉ nhờ cổng giá phía sau cùng mã", () => {
      // `taoBaoGiaDong` cũng từ chối 0 và ra cùng mã GIA_48_KHONG_HOP_LE, nên mã một mình không phân biệt hai cổng. Cấy `x >= 0`
      // vào `laSoNguyenDuong` không làm ca [KHD-R7] đỏ; câu thông báo mới là thứ nói cổng nào đã chặn.
      const kq = keHoachDongDon(dong(), boiCanh({ gia48: 0 }));
      expect(tuChoi(kq)).toBe("GIA_48_KHONG_HOP_LE");
      expect(kq.quyetDinh === "REJECT" && kq.thongBao).toContain("số nguyên đồng dương");
    });

    it("[KHD-R8] giá không chia hết thành đồng ⇒ GIA_KHONG_NGUYEN_DONG, không cắt cụt", () => {
      // 9.792.001 × 12 không chia hết cho 48 ⇒ niêm yết 12 buổi không ra số nguyên.
      expect(tuChoi(keHoachDongDon(dong({ soBuoiMua: 12 }), boiCanh({ gia48: 9_792_001 })))).toBe("GIA_KHONG_NGUYEN_DONG");
    });

    it("[KHD-R9] CÙNG một giá 10.000.004: 12 buổi chia hết, 24 buổi (giảm 5%) thì không ⇒ quyết định theo TỪNG số buổi", () => {
      const b = boiCanh({ gia48: 10_000_004 });
      expect(scope(keHoachDongDon(dong({ soBuoiMua: 12 }), b)).baoGia.gia.thanhTien).toBe(2_500_001);
      expect(tuChoi(keHoachDongDon(dong({ soBuoiMua: 24 }), b))).toBe("GIA_KHONG_NGUYEN_DONG");
    });

    it("[KHD-R10] thứ tự con / sản phẩm không hợp lệ ⇒ THU_TU_KHONG_HOP_LE", () => {
      expect(tuChoi(keHoachDongDon(dong({ thuTuCon: 0 }), boiCanh()))).toBe("THU_TU_KHONG_HOP_LE");
      expect(tuChoi(keHoachDongDon(dong({ thuTuSanPham48: 1.5 }), boiCanh()))).toBe("THU_TU_KHONG_HOP_LE");
    });

    it("[KHD-R11] mốc ngày TIỀN VỀ mà tiền chưa về ⇒ CHUA_CO_NGAY_AP_GIA, không rơi về ngày tạo đơn", () => {
      expect(tuChoi(keHoachDongDon(dong(), boiCanh({ cheDoMocNgay: "PAYMENT_RECEIVED", ngay: { taoDon: GIUA, tienVe: null } })))).toBe("CHUA_CO_NGAY_AP_GIA");
      expect(tuChoi(keHoachDongDon(dong(), boiCanh({ cheDoMocNgay: "PAYMENT_RECEIVED", ngay: { taoDon: GIUA } })))).toBe("CHUA_CO_NGAY_AP_GIA");
    });

    it("[KHD-R12] ngoài cửa sổ hiệu lực: cận dưới BAO GỒM, cận trên LOẠI TRỪ (nửa mở); trước, sau, ngày hỏng ⇒ NGOAI_CUA_SO_CHINH_SACH", () => {
      const o = (taoDon: Date) => keHoachDongDon(dong(), boiCanh({ ngay: { taoDon } }));
      expect(o(TU).quyetDinh).toBe("SCOPE");
      expect(o(new Date(DEN.getTime() - 1)).quyetDinh).toBe("SCOPE");
      expect(tuChoi(o(new Date(TU.getTime() - 1)))).toBe("NGOAI_CUA_SO_CHINH_SACH");
      expect(tuChoi(o(DEN))).toBe("NGOAI_CUA_SO_CHINH_SACH");
      expect(tuChoi(o(new Date("2027-03-01T00:00:00Z")))).toBe("NGOAI_CUA_SO_CHINH_SACH");
      expect(tuChoi(o(new Date(Number.NaN)))).toBe("NGOAI_CUA_SO_CHINH_SACH");
    });

    it("[KHD-R13] mọi REJECT mang câu thông báo tiếng Việt khác rỗng, nói bằng ngôn ngữ của nguyên nhân", () => {
      const xau: [Partial<DongDonVao>, Partial<BoiCanhKeHoach>][] = [
        [{ soLuong: 2 }, {}],
        [{ laLopNhom: false }, {}],
        [{ soBuoiMua: null }, {}],
        [{ soBuoiMua: 18 }, {}],
        [{}, { gia48: null }],
        [{}, { gia48: 0 }],
        [{ soBuoiMua: 12 }, { gia48: 9_792_001 }],
        [{ thuTuCon: 0 }, {}],
        [{}, { ngay: { taoDon: DEN } }],
      ];
      for (const [d, b] of xau) {
        const kq = keHoachDongDon(dong(d), boiCanh(b));
        expect(kq.quyetDinh).toBe("REJECT");
        if (kq.quyetDinh === "REJECT") expect(kq.thongBao.trim().length).toBeGreaterThan(20);
      }
      const le = keHoachDongDon(dong({ soBuoiMua: 18 }), boiCanh());
      expect(le.quyetDinh === "REJECT" && le.thongBao).toContain("18");
    });
  });

  describe("[KHD-P] thứ tự ưu tiên khi nhiều quy tắc cùng vi phạm — cố định, một mã", () => {
    it("[KHD-P1] số lượng > Coach > số buổi chưa chọn > số buổi lẻ > giá thiếu", () => {
      const tatCa = dong({ soLuong: 2, laLopNhom: false, soBuoiMua: 18 });
      expect(tuChoi(keHoachDongDon(tatCa, boiCanh({ gia48: null })))).toBe("SO_LUONG_KHAC_1");
      expect(tuChoi(keHoachDongDon({ ...tatCa, soLuong: 1 }, boiCanh({ gia48: null })))).toBe("COACH_TREN_KHOA_48");
      expect(tuChoi(keHoachDongDon({ ...tatCa, soLuong: 1, laLopNhom: true }, boiCanh({ gia48: null })))).toBe("SO_BUOI_LE");
      expect(tuChoi(keHoachDongDon({ ...tatCa, soLuong: 1, laLopNhom: true, soBuoiMua: 24 }, boiCanh({ gia48: null })))).toBe("GIA_48_CHUA_CO");
    });

    it("[KHD-P2] giá thiếu trước ngày ngoài cửa sổ (không tra được giá thì chưa cần xét ngày)", () => {
      expect(tuChoi(keHoachDongDon(dong(), boiCanh({ gia48: null, ngay: { taoDon: DEN } })))).toBe("GIA_48_CHUA_CO");
    });
  });

  describe("[KHD-E] lỗi không phải của luật giá thì KHÔNG bị nuốt thành REJECT", () => {
    it("[KHD-E1] lỗi lập trình (TypeError) trong chính sách được ném lại nguyên vẹn", () => {
      const hong = {
        ...CHINH_SACH_PL02,
        get bangA(): never {
          throw new TypeError("boom");
        },
      } as unknown as ChinhSachGia;
      expect(() => keHoachDongDon(dong(), boiCanh({ chinhSach: hong }))).toThrow(TypeError);
    });
  });

  it("[KHD-X] không đổi đầu vào, và kết quả SCOPE trùng khít tinhGiaTheoMoc gọi thẳng (không thêm bớt đồng nào)", () => {
    const d = Object.freeze(dong({ soBuoiMua: 36, thuTuCon: 2 }));
    const b = Object.freeze(boiCanh());
    const k = scope(keHoachDongDon(d, b));
    expect(k.baoGia.gia).toEqual(tinhGiaTheoMoc({ gia48: 9_792_000, soBuoi: 36, thuTuCon: 2, thuTuSanPham48: 1, quyTacBuoiLe: "TU_CHOI" }));
  });
});
