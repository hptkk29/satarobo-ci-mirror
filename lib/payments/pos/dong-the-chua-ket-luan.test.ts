// lib/payments/pos/dong-the-chua-ket-luan.test.ts — "DÒNG THẺ MANG MÃ MÀ CHƯA THÀNH GIAO DỊCH" (Việc 4 · rà đối kháng 09/10/2026). THUẦN.
//
// Lỗ mà hàm này bịt: `maCoGiaoDichChoTay` chỉ đếm giao dịch UNMATCHED. Dòng thẻ mang mã mà CHƯA ngã ngũ ("Đang xử lý" / chữ lạ)
// được `phanLoaiDongPos` luật (1) cho BO_QUA và KHÔNG sinh `BankTransaction` ⇒ cổng huỷ không thấy nó, trong khi lượt kiểm
// gần nhất (đã lưu TRƯỚC khi dòng về) vẫn nói "chưa thấy". Cổng huỷ phải đọc dữ liệu ĐÃ CÓ, không chỉ tin kết quả lưu.
//
// Vị từ ghép từ CHÍNH các hàm `phan-loai-pos.ts` mà provider (`doc-du-lieu.ts`) dùng — không viết bản thứ hai của luật "treo".
import { describe, expect, it } from "vitest";
import { LY_DO_HUY_TOAN_PHAN } from "./phan-loai-pos";
import { laDongTheChuaKetLuan, type DongTheDeXet } from "./dong-the-chua-ket-luan";

const CODE = "WT9GX";

/** Dòng mốc: thanh toán, trạng thái "Đang xử lý", mang đúng mã, chưa thành giao dịch ⇒ CHƯA KẾT LUẬN. */
function d(p: Partial<DongTheDeXet> = {}): DongTheDeXet {
  return {
    dienGiai: `${CODE} hoc phi`,
    loaiGiaoDich: "Thanh toán",
    trangThai: "Đang xử lý",
    trangThaiHoanHuy: null,
    matchStatus: "BO_QUA",
    matchReason: "Giao dịch Đang xử lý",
    bankTransactionId: null,
    ...p,
  };
}

describe("[HN4-DTK-01] dòng treo mang mã, chưa thành giao dịch ⇒ CHƯA KẾT LUẬN", () => {
  it("mốc: 'Đang xử lý' ⇒ true", () => {
    expect(laDongTheChuaKetLuan(d(), CODE)).toBe(true);
  });
  it("chữ trạng thái LẠ cũng là treo (fail-closed, cùng luật 5 của provider)", () => {
    for (const trangThai of ["Chờ xác nhận", "Pending", "", "???"]) {
      expect(laDongTheChuaKetLuan(d({ trangThai }), CODE), trangThai).toBe(true);
    }
  });
  it("'Thành công' mà chưa thành giao dịch (số ≤ 0 → CAN_XU_LY không tạo giao dịch) ⇒ true: tiền có thể đã trừ", () => {
    expect(laDongTheChuaKetLuan(d({ trangThai: "Thành công", matchStatus: "CAN_XU_LY", matchReason: "Số tiền không dương" }), CODE)).toBe(true);
  });
  it("mã trong ghi chú khớp theo token (D2): 'wt9gx.' khớp, mã dính chữ khác không khớp", () => {
    expect(laDongTheChuaKetLuan(d({ dienGiai: "hoc phi wt9gx." }), CODE)).toBe(true);
    expect(laDongTheChuaKetLuan(d({ dienGiai: "XWT9GXZ" }), CODE)).toBe(false);
    expect(laDongTheChuaKetLuan(d({ dienGiai: "khong co ma nao" }), CODE)).toBe(false);
  });
});

describe("[HN4-DTK-02] ĐỐI CHỨNG DƯƠNG — dòng đã ngã ngũ không chặn huỷ (nếu không, hàm luôn true cũng xanh)", () => {
  it("'Thất bại' ⇒ false (chỉ chữ này là thất bại — luật 5 của provider)", () => {
    expect(laDongTheChuaKetLuan(d({ trangThai: "Thất bại" }), CODE)).toBe(false);
    // NFD của "Thất bại" cũng là thất bại: phép chuẩn hoá là của `maTrangThaiPos`.
    expect(laDongTheChuaKetLuan(d({ trangThai: "Thất bại".normalize("NFD") }), CODE)).toBe(false);
  });
  it("đã HUỶ toàn phần trên máy (cột Hoàn/Hủy) ⇒ false", () => {
    expect(laDongTheChuaKetLuan(d({ trangThai: "Thành công", trangThaiHoanHuy: "Hủy toàn phần" }), CODE)).toBe(false);
  });
  it("đã HUỶ toàn phần theo kết luận đã lưu của tầng nhập lô (BO_QUA + lý do) ⇒ false", () => {
    expect(laDongTheChuaKetLuan(d({ trangThai: "Thành công", matchStatus: "BO_QUA", matchReason: LY_DO_HUY_TOAN_PHAN }), CODE)).toBe(false);
  });
  it("dòng Hủy/Hoàn (loại ≠ Thanh toán) ⇒ false: chính dòng GỐC mới nói về tiền", () => {
    expect(laDongTheChuaKetLuan(d({ loaiGiaoDich: "Hủy", trangThai: "Thành công" }), CODE)).toBe(false);
  });
});

describe("[HN4-DTK-03] ĐÃ thành giao dịch ⇒ KHÔNG chặn (UNMATCHED · MATCHED · IGNORED) — ranh giới đã biết, docs §6.14", () => {
  // UNMATCHED đã là chuyện của `maCoGiaoDichChoTay` (không đếm hai lần); MATCHED ⇒ phiếu gộp đóng (cổng PHIEU_GOP_DA_DONG nói);
  // IGNORED là QUYẾT ĐỊNH của kế toán ("Bỏ qua" — ca DB `[HN4-DB-03]` đối chứng của CO_GIAO_DICH_CHO_TAY đòi phiếu huỷ được sau đó).
  // Hoàn MỘT PHẦN (Q-G) cũng IGNORED + CAN_XU_LY nên KHÔNG phân biệt được với "kế toán bỏ qua" từ chính dòng — CHƯA bao quát.
  const DA_THANH = { trangThai: "Thành công", matchStatus: "CAN_XU_LY", bankTransactionId: "bt1" } as const;
  it("có `bankTransactionId` ⇒ false, dù dòng là CAN_XU_LY", () => {
    expect(laDongTheChuaKetLuan(d(DA_THANH), CODE)).toBe(false);
  });
  it("đối chứng: cùng dòng mà CHƯA thành giao dịch (số ≤ 0) ⇒ true — chính `bankTransactionId` quyết, không phải `matchStatus`", () => {
    expect(laDongTheChuaKetLuan(d({ ...DA_THANH, bankTransactionId: null }), CODE)).toBe(true);
  });
});
