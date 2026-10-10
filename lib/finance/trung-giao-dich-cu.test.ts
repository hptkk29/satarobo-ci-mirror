// lib/finance/trung-giao-dich-cu.test.ts — CHỐNG NHẬP TRÙNG cho em ĐÃ CÓ TIỀN trong hệ thống.
//
// Chủ dự án: "nhớ bỏ trùng các học viên đã được tạo đơn hàng rồi."
//
// ⚠️ "ĐÃ CÓ ĐƠN HÀNG" KHÔNG PHẢI THƯỚC ĐO ĐÚNG, và đây là chỗ dễ làm sai nhất:
// nhóm học viên cần chữa NHẤT lại chính là nhóm ĐÃ CÓ ĐƠN mà CHƯA CÓ TIỀN — các em
// chốt hàng loạt qua nhánh `allowNoPayment` của bulk-convert: có `Order`, có `Enrollment`,
// nhưng không `Payment` nào, nên cổng phụ huynh hiện nợ nguyên. Bỏ qua theo "có đơn" là
// bỏ sót đúng nhóm đang đi cứu.
//
// Thước đo đúng là TIỀN ĐÃ GHI NHẬN. Nó bắt được cả ca có khoản thu mà không qua đơn nào.
import { describe, it, expect } from "vitest";
import { phanLoaiTrung, MUC_TRUNG } from "./trung-giao-dich-cu";

describe("[TGD-01] chưa có tiền → nhập bình thường", () => {
  it("em có ĐƠN nhưng chưa thu đồng nào → CHUA_CO, vẫn nhập", () => {
    // Đây chính là nhóm chốt hàng loạt không nhập tiền — nhóm cần chữa nhất.
    expect(phanLoaiTrung({ daCoTien: 0, tienTrongFile: 8_640_000, soDon: 1 }).muc).toBe(
      MUC_TRUNG.CHUA_CO,
    );
  });

  it("em chưa có gì cả → CHUA_CO", () => {
    expect(phanLoaiTrung({ daCoTien: 0, tienTrongFile: 5_000_000, soDon: 0 }).muc).toBe(
      MUC_TRUNG.CHUA_CO,
    );
  });
});

describe("[TGD-02] đã có ĐỦ tiền → chắc chắn trùng, KHÔNG nhập", () => {
  it("tiền trong hệ thống bằng tiền trong file → TRUNG_DU", () => {
    const r = phanLoaiTrung({ daCoTien: 8_640_000, tienTrongFile: 8_640_000, soDon: 1 });
    expect(r.muc).toBe(MUC_TRUNG.TRUNG_DU);
    expect(r.nenNhap).toBe(false);
  });

  it("tiền trong hệ thống NHIỀU HƠN file → vẫn TRUNG_DU (file là bản cũ hơn)", () => {
    const r = phanLoaiTrung({ daCoTien: 10_000_000, tienTrongFile: 8_640_000, soDon: 2 });
    expect(r.muc).toBe(MUC_TRUNG.TRUNG_DU);
    expect(r.nenNhap).toBe(false);
  });
});

describe("[TGD-03] đã có MỘT PHẦN → người quyết, không tự nhập", () => {
  it("hệ thống có ít hơn file → TRUNG_MOT_PHAN, nêu rõ phần chênh", () => {
    const r = phanLoaiTrung({ daCoTien: 3_320_000, tienTrongFile: 8_640_000, soDon: 1 });
    expect(r.muc).toBe(MUC_TRUNG.TRUNG_MOT_PHAN);
    expect(r.nenNhap).toBe(false);
    expect(r.chenh).toBe(5_320_000);
  });

  it("KHÔNG tự nhập phần chênh — vì không biết chênh do thiếu đợt hay do lệch số", () => {
    // Cám dỗ: "cứ nhập thêm 5.320.000 cho đủ". Nhưng chênh có thể do đợt 2 đã ghi bằng
    // đường khác với số khác, và nhập bù là tạo ra khoản thu không có thật.
    expect(phanLoaiTrung({ daCoTien: 1, tienTrongFile: 8_640_000, soDon: 1 }).nenNhap).toBe(
      false,
    );
  });
});

describe("[TGD-04] ca biên", () => {
  it("file không có tiền → không nhập gì cả", () => {
    expect(phanLoaiTrung({ daCoTien: 0, tienTrongFile: 0, soDon: 0 }).nenNhap).toBe(false);
  });

  it("số không hữu hạn / âm → coi như 0, không ném", () => {
    const r = phanLoaiTrung({
      daCoTien: Number.NaN,
      tienTrongFile: -5,
      soDon: Number.NaN,
    });
    expect(r.muc).toBe(MUC_TRUNG.CHUA_CO);
    expect(r.nenNhap).toBe(false);
  });

  it("chỉ CHUA_CO mới được nhập tự động — ba mức còn lại đều phải có người bấm", () => {
    const mucTuNhap = [
      phanLoaiTrung({ daCoTien: 0, tienTrongFile: 1_000, soDon: 0 }),
      phanLoaiTrung({ daCoTien: 1_000, tienTrongFile: 1_000, soDon: 1 }),
      phanLoaiTrung({ daCoTien: 500, tienTrongFile: 1_000, soDon: 1 }),
    ].filter((r) => r.nenNhap);
    expect(mucTuNhap).toHaveLength(1);
    expect(mucTuNhap[0]!.muc).toBe(MUC_TRUNG.CHUA_CO);
  });
});
