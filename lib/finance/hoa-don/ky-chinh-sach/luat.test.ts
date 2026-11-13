import { describe, expect, it } from "vitest";
import { HAN_MUC_TRONG, kiemBatLai, kiemChinhSach, kiemHanMuc, kiemTamDung, phanTichThayDoiHanMuc, trangThaiKyTuDong, type HanMucKy } from "./luat";

const DU: HanMucKy = { hanMucMoiHoaDon: 10_000_000, hanMucMoiNgay: 50_000_000, soToiDa: 20, cuaSoPhut: 60, nguongTanSuat: 15 };
const TRONG = { tongNgay: 0, soTrongCuaSo: 0 };
const LY_DO = "Cập nhật theo thống kê 90 ngày";

describe("[KCS-01] kiemChinhSach — đầu vào khi lưu", () => {
  it("hợp lệ: đủ hạn mức + lý do ⇒ không lỗi; để trống cả bộ (chưa khai) cũng hợp lệ", () => {
    expect(kiemChinhSach({ ...DU, lyDo: LY_DO })).toEqual([]);
    expect(kiemChinhSach({ ...HAN_MUC_TRONG, lyDo: LY_DO })).toEqual([]);
  });
  it("lý do ngắn / rỗng bị chặn (kể cả khoảng trắng)", () => {
    expect(kiemChinhSach({ ...DU, lyDo: "ngắn" })).not.toEqual([]);
    expect(kiemChinhSach({ ...DU, lyDo: "          " })).not.toEqual([]);
    expect(kiemChinhSach({ ...DU, lyDo: null })).not.toEqual([]);
  });
  it("số âm / 0 / lẻ / quá trần bị chặn", () => {
    for (const v of [0, -1, 1.5, 3_000_000_000]) expect(kiemChinhSach({ ...DU, hanMucMoiHoaDon: v, lyDo: LY_DO })).not.toEqual([]);
  });
  it("số hoá đơn tối đa và cửa sổ đi đôi; ngưỡng tần suất cần cửa sổ; mỗi hoá đơn ≤ mỗi ngày", () => {
    expect(kiemChinhSach({ ...DU, cuaSoPhut: null, lyDo: LY_DO })).not.toEqual([]);
    expect(kiemChinhSach({ ...DU, soToiDa: null, lyDo: LY_DO })).not.toEqual([]);
    expect(kiemChinhSach({ ...HAN_MUC_TRONG, nguongTanSuat: 5, lyDo: LY_DO })).not.toEqual([]);
    expect(kiemChinhSach({ ...DU, hanMucMoiHoaDon: 60_000_000, lyDo: LY_DO })).not.toEqual([]);
    expect(kiemChinhSach({ ...DU, cuaSoPhut: 1441, lyDo: LY_DO })).not.toEqual([]);
  });
});

describe("[KCS-02] tạm dừng / bật lại", () => {
  it("tạm dừng cần lý do ≥ 10 ký tự", () => {
    expect(kiemTamDung("Nghi lộ khoá API VIN")).toEqual([]);
    expect(kiemTamDung("lộ khoá")).not.toEqual([]);
    expect(kiemTamDung(null)).not.toEqual([]);
  });
  it("không đang dừng ⇒ không bật lại được", () => {
    expect(kiemBatLai({ hienTai: null, xacNhanSuCo: true, lyDo: LY_DO })).not.toEqual([]);
    expect(kiemBatLai({ hienTai: { tamDung: false, tamDungSuCo: false }, xacNhanSuCo: true, lyDo: LY_DO })).not.toEqual([]);
  });
  it("dừng thường: bật lại chỉ cần lý do", () => {
    expect(kiemBatLai({ hienTai: { tamDung: true, tamDungSuCo: false }, xacNhanSuCo: undefined, lyDo: LY_DO })).toEqual([]);
    expect(kiemBatLai({ hienTai: { tamDung: true, tamDungSuCo: false }, xacNhanSuCo: undefined, lyDo: "ngắn" })).not.toEqual([]);
  });
  it("dừng vì SỰ CỐ BẢO MẬT: bật lại cần xác nhận riêng đúng `true` (chuỗi 'true', 1, 'on' đều KHÔNG đủ)", () => {
    const h = { tamDung: true, tamDungSuCo: true };
    expect(kiemBatLai({ hienTai: h, xacNhanSuCo: true, lyDo: LY_DO })).toEqual([]);
    for (const v of [false, undefined, "true", 1, "on", null]) expect(kiemBatLai({ hienTai: h, xacNhanSuCo: v, lyDo: LY_DO })).not.toEqual([]);
  });
});

describe("[KCS-03] kiemHanMuc — ký tự động, FAIL-CLOSED", () => {
  it("trong hạn mức ⇒ cho", () => {
    expect(kiemHanMuc({ chinhSach: DU, soTien: 5_000_000, suDung: TRONG })).toEqual({ ok: true, canhBao: null });
  });
  it("chưa có chính sách / thiếu bất kỳ hạn mức bắt buộc ⇒ CHUA_KHAI_HAN_MUC (không có chuyện «chưa khai nên không giới hạn»)", () => {
    for (const cs of [null, HAN_MUC_TRONG, { ...DU, hanMucMoiHoaDon: null }, { ...DU, hanMucMoiNgay: null }, { ...DU, soToiDa: null, cuaSoPhut: null }]) {
      expect(kiemHanMuc({ chinhSach: cs, soTien: 1, suDung: TRONG })).toMatchObject({ ok: false, ma: "CHUA_KHAI_HAN_MUC" });
    }
  });
  it("biên: chạm đúng hạn mức vẫn được, hơn một đồng thì vượt", () => {
    expect(kiemHanMuc({ chinhSach: DU, soTien: 10_000_000, suDung: TRONG }).ok).toBe(true);
    expect(kiemHanMuc({ chinhSach: DU, soTien: 10_000_001, suDung: TRONG })).toMatchObject({ ok: false, ma: "VUOT_MOI_HOA_DON" });
    expect(kiemHanMuc({ chinhSach: DU, soTien: 10_000_000, suDung: { tongNgay: 40_000_000, soTrongCuaSo: 0 } }).ok).toBe(true);
    expect(kiemHanMuc({ chinhSach: DU, soTien: 10_000_000, suDung: { tongNgay: 40_000_001, soTrongCuaSo: 0 } })).toMatchObject({ ok: false, ma: "VUOT_NGAY" });
    expect(kiemHanMuc({ chinhSach: DU, soTien: 1, suDung: { tongNgay: 0, soTrongCuaSo: 19 } }).ok).toBe(true);
    expect(kiemHanMuc({ chinhSach: DU, soTien: 1, suDung: { tongNgay: 0, soTrongCuaSo: 20 } })).toMatchObject({ ok: false, ma: "VUOT_SO_LUONG" });
  });
  it("số tiền không hợp lệ (âm · lẻ · NaN) ⇒ vượt, không đoán", () => {
    for (const t of [-1, 1.5, Number.NaN]) expect(kiemHanMuc({ chinhSach: DU, soTien: t, suDung: TRONG })).toMatchObject({ ok: false, ma: "VUOT_MOI_HOA_DON" });
  });
  it("tần suất bất thường: CẢNH BÁO nhưng vẫn cho (chưa vượt hạn mức); không khai ngưỡng ⇒ không cảnh báo", () => {
    const kq = kiemHanMuc({ chinhSach: DU, soTien: 1, suDung: { tongNgay: 0, soTrongCuaSo: 14 } });
    expect(kq.ok).toBe(true);
    expect(kq.ok && kq.canhBao).toMatch(/tần suất/i);
    expect(kiemHanMuc({ chinhSach: { ...DU, nguongTanSuat: null }, soTien: 1, suDung: { tongNgay: 0, soTrongCuaSo: 14 } })).toEqual({ ok: true, canhBao: null });
  });
});

describe("[KCS-04] phanTichThayDoiHanMuc — cái gì NỚI LỎNG (cần xác nhận riêng)", () => {
  it("chưa có chính sách → khai đủ lần đầu = NỚI (bật khả năng tự ký); khai thiếu (vẫn không tự ký) thì không", () => {
    expect(phanTichThayDoiHanMuc(null, DU)).toMatchObject({ noiLong: true });
    expect(phanTichThayDoiHanMuc({ ...HAN_MUC_TRONG, nguongTanSuat: null }, DU).noiLong).toBe(true);
    expect(phanTichThayDoiHanMuc(null, { ...DU, soToiDa: null, cuaSoPhut: null }).noiLong).toBe(false);
  });
  it("tăng mỗi hoá đơn / mỗi ngày / số hoá đơn, hoặc rút ngắn cửa sổ = NỚI; mỗi trường độc lập", () => {
    for (const noi of [{ hanMucMoiHoaDon: 10_000_001 }, { hanMucMoiNgay: 50_000_001 }, { soToiDa: 21 }, { cuaSoPhut: 59 }]) {
      const pt = phanTichThayDoiHanMuc(DU, { ...DU, ...noi });
      expect(pt.noiLong).toBe(true);
      expect(pt.lyDoNoiLong).toHaveLength(1);
      expect(pt.dong).toHaveLength(1);
    }
  });
  it("giảm / siết chặt / đổi ngưỡng cảnh báo / không đổi = KHÔNG nới (không cần xác nhận thêm)", () => {
    for (const siet of [{ hanMucMoiHoaDon: 9_999_999 }, { hanMucMoiNgay: 40_000_000 }, { soToiDa: 19 }, { cuaSoPhut: 61 }, { nguongTanSuat: 3 }, { nguongTanSuat: null }]) {
      expect(phanTichThayDoiHanMuc(DU, { ...DU, ...siet }).noiLong).toBe(false);
    }
    expect(phanTichThayDoiHanMuc(DU, DU)).toEqual({ dong: [], noiLong: false, lyDoNoiLong: [] });
  });
  it("hỗn hợp: siết một trường nhưng nới trường khác ⇒ vẫn NỚI (không bù trừ)", () => {
    expect(phanTichThayDoiHanMuc(DU, { ...DU, hanMucMoiHoaDon: 5_000_000, soToiDa: 30 }).noiLong).toBe(true);
  });
  it("bảng cũ → mới chỉ liệt kê trường ĐỔI, kèm nhãn đọc được", () => {
    const pt = phanTichThayDoiHanMuc(DU, { ...DU, hanMucMoiNgay: 60_000_000 });
    expect(pt.dong).toEqual([{ truong: "hanMucMoiNgay", nhan: "Tối đa mỗi ngày (VND)", truoc: 50_000_000, sau: 60_000_000 }]);
  });
});

describe("[KCS-05] trangThaiKyTuDong — chỉ để hiển thị, không là cổng", () => {
  it("tạm dừng thắng mọi thứ; chưa khai đủ ⇒ KHÔNG tự ký; đủ ⇒ đủ điều kiện theo chính sách (không hứa đang chạy)", () => {
    expect(trangThaiKyTuDong({ ...DU, tamDung: true }).ma).toBe("TAM_DUNG");
    expect(trangThaiKyTuDong(null).ma).toBe("CHUA_KHAI");
    expect(trangThaiKyTuDong({ ...DU, hanMucMoiNgay: null, tamDung: false }).ma).toBe("CHUA_KHAI");
    const du = trangThaiKyTuDong({ ...DU, tamDung: false });
    expect(du.ma).toBe("SAN_SANG");
    expect(du.nhan).toMatch(/còn tuỳ công tắc/);
  });
});
