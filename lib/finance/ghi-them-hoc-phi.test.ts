// lib/finance/ghi-them-hoc-phi.test.ts — "thiếu thì phải ghi TIẾP cho đến khi đủ".
//
// Báo lỗi: màn /thieu-hoc-phi khoá dòng đã có khoản nhập liệu — Phạm Thuỳ Anh thiếu
// 7.000.000đ (1.000.000 / 8.000.000) mà chỗ nút chỉ còn chữ "Đã có khoản nhập liệu".
//
// Nguyên nhân: `createBackfillOrderPaymentInTx` idempotent theo lead (lib/crm/backfill-order.ts:58)
// nên lượt hai luôn `created: false`; màn khoá nút theo đúng hành vi đó. Cái sai không
// phải cái khoá — mà là THIẾU đường ghi thêm vào ĐƠN ĐÃ CÓ.
//
// Vì sao luật này phải là hàm thuần có test: nó chọn ĐƠN NÀO nhận tiền. Chọn sai đơn là
// tiền vào đơn của khoá khác, và không màn nào hiện ra chỗ lệch.
import { describe, it, expect } from "vitest";
import { chonDonDeGhiThem } from "./ghi-them-hoc-phi";

const don = (o: Partial<Parameters<typeof chonDonDeGhiThem>[0][number]> = {}) => ({
  id: "o1",
  totalAmount: 8_000_000,
  daThu: 1_000_000,
  coKhoanNhapLieu: true,
  taoLuc: 1_000,
  ...o,
});

describe("[GT-01] chọn chế độ ghi", () => {
  it("chưa có đơn nào → tạo đơn mới", () => {
    expect(chonDonDeGhiThem([])).toEqual({ cheDo: "TAO_DON_MOI" });
  });

  it("đơn còn thiếu 7tr → GHI THÊM vào đơn đó, trần đúng 7tr (ca Phạm Thuỳ Anh)", () => {
    expect(chonDonDeGhiThem([don()])).toEqual({
      cheDo: "GHI_THEM",
      orderId: "o1",
      toiDa: 7_000_000,
    });
  });

  it("đã thu đủ → DU_ROI, không mời ghi thêm", () => {
    expect(chonDonDeGhiThem([don({ daThu: 8_000_000 })])).toEqual({ cheDo: "DU_ROI" });
  });

  it("thu VƯỢT tổng đơn → vẫn DU_ROI, không ra trần âm", () => {
    expect(chonDonDeGhiThem([don({ daThu: 9_000_000 })])).toEqual({ cheDo: "DU_ROI" });
  });
});

describe("[GT-02] lead nhiều đơn — chọn đúng đơn", () => {
  it("bỏ qua đơn đã đủ, nhắm đơn còn thiếu", () => {
    const r = chonDonDeGhiThem([
      don({ id: "du", daThu: 8_000_000 }),
      don({ id: "thieu", daThu: 2_000_000, taoLuc: 2_000 }),
    ]);
    expect(r).toEqual({ cheDo: "GHI_THEM", orderId: "thieu", toiDa: 6_000_000 });
  });

  it("hai đơn cùng còn thiếu → ưu tiên đơn DO MÀN NÀY tạo (có khoản nhập liệu)", () => {
    // Đơn nghiệp vụ đang chạy không phải chỗ để nhét tiền cũ vào.
    const r = chonDonDeGhiThem([
      don({ id: "nghiepvu", coKhoanNhapLieu: false, taoLuc: 500 }),
      don({ id: "nhaplieu", coKhoanNhapLieu: true, taoLuc: 9_000 }),
    ]);
    expect(r).toEqual({ cheDo: "GHI_THEM", orderId: "nhaplieu", toiDa: 7_000_000 });
  });

  it("không đơn nào có khoản nhập liệu → chọn đơn tạo SỚM NHẤT (ổn định, không phụ thuộc thứ tự tra)", () => {
    const r = chonDonDeGhiThem([
      don({ id: "moi", coKhoanNhapLieu: false, taoLuc: 9_000 }),
      don({ id: "cu", coKhoanNhapLieu: false, taoLuc: 100 }),
    ]);
    expect(r).toEqual({ cheDo: "GHI_THEM", orderId: "cu", toiDa: 7_000_000 });
  });
});

describe("[GT-03] ca biên", () => {
  it("đơn 0đ → KHÔNG mời ghi thêm (dữ liệu sai cần người xem, đừng nhận tiền vào đó)", () => {
    expect(chonDonDeGhiThem([don({ totalAmount: 0, daThu: 0 })])).toEqual({ cheDo: "DU_ROI" });
  });

  it("số không hữu hạn từ aggregate rỗng → coi như 0, không ném", () => {
    const r = chonDonDeGhiThem([
      don({ totalAmount: Number.NaN, daThu: Number.NaN }),
    ]);
    expect(r).toEqual({ cheDo: "DU_ROI" });
  });

  it("làm tròn về đồng", () => {
    const r = chonDonDeGhiThem([don({ totalAmount: 8_000_000.4, daThu: 999_999.6 })]);
    expect(r).toEqual({ cheDo: "GHI_THEM", orderId: "o1", toiDa: 7_000_000 });
  });
});
