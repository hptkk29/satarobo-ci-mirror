import { describe, expect, it } from "vitest";
import { dongDuTien, type DongDuTienVao, type ThamSoDuTien } from "./dong-du-tien";

// Số tiền mang HÌNH DẠNG THẬT (số lẻ nghìn, không tròn): 9.792.000 × 85% = 8.323.200 là giá 48 buổi con thứ nhất.
const PHAI_THU = 8_323_200;

const dong = (o: Partial<DongDuTienVao> = {}): DongDuTienVao => ({
  loai: "COURSE_ENROLLMENT",
  phaiThu: PHAI_THU,
  daVe: 0,
  daThu: 0,
  ...o,
});
const tham = (o: Partial<ThamSoDuTien> = {}): ThamSoDuTien => ({
  truc: "PAYMENT_PAID",
  dungSai: 0,
  khiPhaiThuBangKhong: "KHONG_DU",
  ...o,
});

describe("[DDT] dongDuTien — vị từ thuần: dòng đơn đã trả ĐỦ chưa (để cấp quyền học)", () => {
  it("[DDT-01] trục PAYMENT_PAID: đủ khi daVe ≥ phải thu; thiếu MỘT đồng thì KHÔNG", () => {
    expect(dongDuTien(dong({ daVe: PHAI_THU }), tham())).toMatchObject({ du: true, lyDo: "DU_TIEN", conThieu: 0 });
    expect(dongDuTien(dong({ daVe: PHAI_THU - 1 }), tham())).toMatchObject({ du: false, lyDo: "THIEU_TIEN", conThieu: 1 });
    expect(dongDuTien(dong({ daVe: PHAI_THU + 1 }), tham())).toMatchObject({ du: true, conThieu: 0 }); // trả thừa: không thiếu, không ÂM
  });

  it("[DDT-02] trục ACCOUNTANT_CONFIRMED: đọc daThu, KHÔNG đọc daVe — tiền về đủ mà kế toán chưa xác nhận thì chưa đủ", () => {
    const daVeDu = dong({ daVe: PHAI_THU, daThu: 0 });
    expect(dongDuTien(daVeDu, tham({ truc: "ACCOUNTANT_CONFIRMED" }))).toMatchObject({ du: false, conThieu: PHAI_THU, soDaTinh: 0 });
    expect(dongDuTien(dong({ daVe: PHAI_THU, daThu: PHAI_THU }), tham({ truc: "ACCOUNTANT_CONFIRMED" })).du).toBe(true);
  });

  it("[DDT-03] đối chứng chiều ngược: trục PAYMENT_PAID không đòi kế toán xác nhận (daThu = 0 vẫn đủ nếu daVe đủ)", () => {
    expect(dongDuTien(dong({ daVe: PHAI_THU, daThu: 0 }), tham({ truc: "PAYMENT_PAID" })).du).toBe(true);
  });

  it("[DDT-04] số đã tính đúng là số của TRỤC được chọn (in ra để người gọi ghi audit)", () => {
    const d = dong({ daVe: 5_000_001, daThu: 3_000_002 });
    expect(dongDuTien(d, tham({ truc: "PAYMENT_PAID" })).soDaTinh).toBe(5_000_001);
    expect(dongDuTien(d, tham({ truc: "ACCOUNTANT_CONFIRMED" })).soDaTinh).toBe(3_000_002);
  });

  it("[DDT-05] dung sai làm tròn: thiếu đúng bằng dung sai thì đủ, thiếu hơn một đồng thì không", () => {
    expect(dongDuTien(dong({ daVe: PHAI_THU - 1000 }), tham({ dungSai: 1000 }))).toMatchObject({ du: true, lyDo: "DU_TIEN", conThieu: 1000 });
    expect(dongDuTien(dong({ daVe: PHAI_THU - 1001 }), tham({ dungSai: 1000 })).du).toBe(false);
    expect(dongDuTien(dong({ daVe: PHAI_THU - 1 }), tham({ dungSai: 0 })).du).toBe(false);
  });

  it("[DDT-06] dung sai KHÔNG biến dòng chưa có đồng nào thành đã đủ (khoản phải thu nhỏ hơn dung sai)", () => {
    expect(dongDuTien(dong({ phaiThu: 500, daVe: 0 }), tham({ dungSai: 1000 })).du).toBe(false);
    expect(dongDuTien(dong({ phaiThu: 500, daVe: -200 }), tham({ dungSai: 1000 })).du).toBe(false);
    // Có tiền thật thì dung sai mới có nghĩa
    expect(dongDuTien(dong({ phaiThu: 500, daVe: 1 }), tham({ dungSai: 1000 })).du).toBe(true);
  });

  it("[DDT-07] chỉ dòng GHI DANH KHOÁ HỌC mới cấp quyền học — sản phẩm, thi, phí học bù, gói khoá không bao giờ, dù đã trả đủ", () => {
    for (const loai of ["PRODUCT", "EXAM_REGISTRATION", "MAKEUP_FEE", "COURSE_PACKAGE"] as const) {
      expect(dongDuTien(dong({ loai, daVe: PHAI_THU, daThu: PHAI_THU }), tham()), loai).toMatchObject({ du: false, lyDo: "DONG_KHONG_PHAI_KHOA_HOC" });
    }
  });

  it("[DDT-08] phải thu = 0 (học bổng 100%, hoặc dòng đã dừng học quyết toán 0đ) là CHÍNH SÁCH — theo tham số bắt buộc, cả hai chiều", () => {
    const khong = dong({ phaiThu: 0, daVe: 0, daThu: 0 });
    expect(dongDuTien(khong, tham({ khiPhaiThuBangKhong: "DU" }))).toMatchObject({ du: true, lyDo: "DU_TIEN" });
    expect(dongDuTien(khong, tham({ khiPhaiThuBangKhong: "KHONG_DU" }))).toMatchObject({ du: false, lyDo: "PHAI_THU_BANG_KHONG" });
    // Tham số chỉ ảnh hưởng dòng phải thu 0: dòng phải thu > 0 thiếu tiền vẫn không đủ
    expect(dongDuTien(dong({ daVe: 0 }), tham({ khiPhaiThuBangKhong: "DU" })).du).toBe(false);
  });

  it("[DDT-09] dòng đã DỪNG HỌC: người gọi truyền phải thu QUYẾT TOÁN (usedValue), không phải học phí gốc", () => {
    // Học phí gốc 8.323.200; đã quyết toán còn 3.240.000 và phụ huynh đã trả đúng số đó.
    expect(dongDuTien(dong({ phaiThu: 3_240_000, daVe: 3_240_000 }), tham()).du).toBe(true);
    expect(dongDuTien(dong({ phaiThu: PHAI_THU, daVe: 3_240_000 }), tham()).du).toBe(false);
  });

  it("[DDT-10] dữ liệu hỏng ⇒ KHÔNG đủ, lý do DU_LIEU_HONG (tiền không được đoán): âm, không nguyên, NaN, vô cực, dung sai âm", () => {
    const hong: [Partial<DongDuTienVao>, Partial<ThamSoDuTien>][] = [
      [{ phaiThu: -1, daVe: 10 }, {}],
      [{ phaiThu: 100.5, daVe: 200 }, {}],
      [{ phaiThu: Number.NaN, daVe: 200 }, {}],
      [{ daVe: Number.NaN }, {}],
      [{ daVe: Number.POSITIVE_INFINITY }, {}],
      [{ daVe: PHAI_THU + 0.5 }, {}],
      [{ daVe: PHAI_THU }, { dungSai: -1 }],
      [{ daVe: PHAI_THU }, { dungSai: 0.5 }],
      // `daThu` hỏng cũng bị từ chối ở trục KHÔNG dùng nó: hai số cùng đến từ một câu lệnh gom, một số hỏng thì nguồn đáng ngờ.
      [{ daVe: PHAI_THU, daThu: Number.NaN }, {}],
      [{ daVe: PHAI_THU, daThu: 0.5 }, {}],
      [{ daVe: Number.NaN, daThu: PHAI_THU }, { truc: "ACCOUNTANT_CONFIRMED" }],
    ];
    for (const [d, t] of hong) {
      expect(dongDuTien(dong(d), tham(t)), JSON.stringify([d, t])).toMatchObject({ du: false, lyDo: "DU_LIEU_HONG" });
    }
  });

  it("[DDT-11] trục lạ (cài đặt hỏng lọt qua) ⇒ KHÔNG đủ, không rơi về trục nào", () => {
    const la = tham({ truc: "KHAC" as never });
    expect(dongDuTien(dong({ daVe: PHAI_THU, daThu: PHAI_THU }), la)).toMatchObject({ du: false, lyDo: "TRUC_LA" });
  });

  it("[DDT-12] tiền ròng ÂM (hoàn nhiều hơn thu) ⇒ không đủ, còn thiếu = phải thu + phần âm", () => {
    expect(dongDuTien(dong({ daVe: -1_000 }), tham())).toMatchObject({ du: false, conThieu: PHAI_THU + 1_000 });
  });

  it("[DDT-13] không đổi đầu vào (đối tượng đóng băng)", () => {
    const d = Object.freeze(dong({ daVe: PHAI_THU }));
    const t = Object.freeze(tham());
    expect(dongDuTien(d, t).du).toBe(true);
  });
});
