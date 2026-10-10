import { describe, it, expect } from "vitest";
import { tinhAnhChup, tienHoanTuCap, lamTronXuong1000 } from "@/lib/bao-luu/anh-chup";

// Kịch bản spec §K: khoá 48 buổi, An đã học 20/48, đơn giá thực 250.000đ/buổi ⇒ học phí thực 12.000.000đ.
const AN = { hocPhiThuc: 12_000_000, soBuoiMua: 48, tongBuoiKhoa: 48, soBuoiDaDung: 20 };

describe("[BL6-AC] ảnh chụp quyền lợi tại START (BR-14)", () => {
  it("[BL6-AC-01] TC-17: 48 buổi, học 20 ⇒ còn 28, đơn giá 250.000, hoàn 28 × 250.000 = 7.000.000", () => {
    const a = tinhAnhChup(AN);
    expect(a).toEqual({ snapTuitionNet: 12_000_000, snapSoBuoiMua: 48, snapSoBuoiSuyRa: false, snapSessionsRemaining: 28, snapUnitPrice: 250_000 });
    expect(tienHoanTuCap(a)).toBe(7_000_000);
  });

  it("[BL6-AC-02] lưu CẶP chưa chia: học phí không chia hết ⇒ đơn giá hiển thị làm tròn XUỐNG 1.000đ nhưng tiền hoàn tính từ CẶP (không mất tới còn×999 đồng)", () => {
    const a = tinhAnhChup({ hocPhiThuc: 10_000_000, soBuoiMua: 48, tongBuoiKhoa: 48, soBuoiDaDung: 20 });
    expect(a.snapUnitPrice).toBe(208_000); // 208.333 → 208.000
    expect(a.snapSessionsRemaining).toBe(28);
    // từ cặp: 10.000.000 × 28 / 48 = 5.833.333,33 → làm tròn ĐẾN ĐỒNG ở kết quả cuối = 5.833.333 (K13), KHÔNG phải 5.833.000
    expect(tienHoanTuCap(a)).toBe(5_833_333);
    // cách sai (đơn giá đã làm tròn × còn lại) = 5.824.000 — thấp hơn 9.000đ so với đúng: bằng chứng vì sao không dùng snapUnitPrice cho tiền
    expect((a.snapUnitPrice ?? 0) * (a.snapSessionsRemaining ?? 0)).toBe(5_824_000);
  });

  it("[BL6-AC-03] thiếu số buổi mua ⇒ suy 'mua đủ khoá' và đặt cờ snapSoBuoiSuyRa; khai thì không đặt", () => {
    const suy = tinhAnhChup({ ...AN, soBuoiMua: null });
    expect(suy).toMatchObject({ snapSoBuoiMua: 48, snapSoBuoiSuyRa: true, snapSessionsRemaining: 28 });
    expect(tinhAnhChup({ ...AN, soBuoiMua: 0 })).toMatchObject({ snapSoBuoiMua: 48, snapSoBuoiSuyRa: true });
    expect(tinhAnhChup({ ...AN, soBuoiMua: 24 })).toMatchObject({ snapSoBuoiMua: 24, snapSoBuoiSuyRa: false, snapSessionsRemaining: 4, snapUnitPrice: 500_000 });
  });

  it("[BL6-AC-04] THIẾU GIÁ ⇒ snapUnitPrice NULL, không bao giờ 0 (0 = miễn phí ⇒ refund hiểu thành hoàn 100%)", () => {
    for (const hocPhiThuc of [null, 0]) {
      const a = tinhAnhChup({ ...AN, hocPhiThuc });
      expect(a.snapUnitPrice, `hocPhiThuc=${hocPhiThuc}`).toBeNull();
      expect(a.snapUnitPrice).not.toBe(0);
    }
    expect(tienHoanTuCap(tinhAnhChup({ ...AN, hocPhiThuc: null }))).toBeNull();
    // học phí cực nhỏ chia ra dưới 1.000đ/buổi ⇒ "không dựng được giá", không phải 0
    expect(tinhAnhChup({ hocPhiThuc: 20_000, soBuoiMua: 48, tongBuoiKhoa: 48, soBuoiDaDung: 0 }).snapUnitPrice).toBeNull();
  });

  it("[BL6-AC-05] không biết cả số buổi mua lẫn tổng buổi khoá ⇒ mọi thứ phụ thuộc nó là null (không đoán)", () => {
    const a = tinhAnhChup({ hocPhiThuc: 12_000_000, soBuoiMua: null, tongBuoiKhoa: null, soBuoiDaDung: 5 });
    expect(a).toEqual({ snapTuitionNet: 12_000_000, snapSoBuoiMua: null, snapSoBuoiSuyRa: false, snapSessionsRemaining: null, snapUnitPrice: null });
    expect(tienHoanTuCap(a)).toBeNull();
  });

  it("[BL6-AC-06] đã dùng nhiều hơn đã mua (dữ liệu lệch) ⇒ còn lại kẹp về 0, không âm; hoàn = 0 chứ không âm", () => {
    const a = tinhAnhChup({ ...AN, soBuoiDaDung: 60 });
    expect(a.snapSessionsRemaining).toBe(0);
    expect(tienHoanTuCap(a)).toBe(0);
  });

  it("[BL6-AC-07] lamTronXuong1000: xuống, không lên; bội đúng giữ nguyên", () => {
    expect(lamTronXuong1000(250_000)).toBe(250_000);
    expect(lamTronXuong1000(250_999)).toBe(250_000);
    expect(lamTronXuong1000(999)).toBe(0);
  });
});
