// lib/finance/mien-giam.test.ts — MIỄN GIẢM NỢ: cổng thuần. PHIÊN G1 · US-22.
//
// Số lấy từ TS-44: *"QLCS miễn 600.000 → chặn (vượt còn nợ 500.000); miễn 500.000 có lý do
// → Bình còn nợ 0."*
import { describe, expect, it } from "vitest";
import { CHO_GHI, kiemMienGiam } from "./mien-giam";

const kiem = (p: Partial<Parameters<typeof kiemMienGiam>[0]> = {}) =>
  kiemMienGiam({
    soTien: 500_000,
    conNo: 500_000,
    phaiThu: 12_000_000,
    daDungHoc: false,
    lyDo: "Hoàn cảnh gia đình, QLCS duyệt",
    tenCon: "Bé Bình",
    ...p,
  });

describe("[MGN] cổng miễn giảm", () => {
  it("[MGN-01] TS-44: miễn ĐÚNG phần còn nợ ⇒ qua, phải thu tụt đúng số", () => {
    const r = kiem();
    expect(r).toMatchObject({ ok: true, soTien: 500_000, choGhi: CHO_GHI.GIAM_GIA });
    expect((r as { phaiThuMoi: number }).phaiThuMoi).toBe(11_500_000);
  });

  it("[MGN-02] TS-44: miễn 600.000 khi còn nợ 500.000 ⇒ CHẶN, và nói trần đúng", () => {
    const r = kiem({ soTien: 600_000 });
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain("tối đa 500.000đ");
  });

  it("[MGN-03] THIẾU LÝ DO ⇒ chặn, và cổng ấy đứng TRƯỚC cổng trần", () => {
    // ⚠️ Thứ tự có chủ đích: báo "vượt trần" cho một người quên gõ lý do sẽ khiến họ đi sửa
    // nhầm chỗ. Ca này gửi MỘT đầu vào vi phạm CẢ HAI và đòi câu về LÝ DO.
    const r = kiem({ soTien: 9_999_999, lyDo: "   " });
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain("lý do");
  });

  it("[MGN-04] số tiền ≤ 0 hoặc rác ⇒ chặn TRƯỚC mọi phép so khác", () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(kiem({ soTien: v, lyDo: "" })).toMatchObject({
        ok: false,
        loi: "Số tiền miễn giảm phải lớn hơn 0",
      });
    }
  });

  it("[MGN-05] bé KHÔNG CÒN NỢ ⇒ chặn", () => {
    const r = kiem({ conNo: 0 });
    expect((r as { loi: string }).loi).toContain("không còn nợ đồng nào");
  });

  it("[MGN-06] bé ĐANG ĐÓNG THỪA ⇒ chặn, và nói rõ đây KHÔNG phải cách xử lý khoản thừa", () => {
    // Miễn giảm trên một bé đóng thừa là làm khoản thừa to thêm — người bấm phải hiểu là họ
    // đang cầm nhầm công cụ, chứ không phải "số tiền sai".
    const r = kiem({ conNo: -300_000 });
    expect(r.ok).toBe(false);
    const loi = (r as { loi: string }).loi;
    expect(loi).toContain("ĐÓNG THỪA 300.000");
    expect(loi).toContain("chuyển sang bé khác");
  });

  it("[MGN-07] bé ĐÃ DỪNG HỌC ⇒ ghi vào QUYẾT TOÁN, không ghi vào giảm giá", () => {
    // ⚠️ Vế dễ sai nhất của cụm. `phaiThu` của bé đã dừng đọc `usedValue`, nên miễn giảm ghi
    // vào `discountAmount` sẽ KHÔNG làm con số trên màn nhúc nhích — người vận hành bấm lại,
    // rồi lại, và mỗi lượt để lại một dòng nhật ký nói đã miễn.
    expect(kiem({ daDungHoc: true })).toMatchObject({ ok: true, choGhi: CHO_GHI.QUYET_TOAN });
    expect(kiem({ daDungHoc: false })).toMatchObject({ ok: true, choGhi: CHO_GHI.GIAM_GIA });
  });

  it("[MGN-08] phải thu mới không bao giờ ÂM", () => {
    expect(kiem({ soTien: 500_000, phaiThu: 100_000 })).toMatchObject({ phaiThuMoi: 0 });
  });
});
