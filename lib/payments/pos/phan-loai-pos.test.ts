// Phân loại một dòng giao dịch thẻ POS — thứ tự luật 1..6 (docs/pos-the-smartpos.md).
import { describe, it, expect } from "vitest";
import {
  laHuyToanPhanVoiGoc,
  loaiCanhBaoPos,
  LY_DO_CHAN_HOAN_MOT_PHAN,
  phanLoaiDongPos,
  tinHieuHoanHuy,
} from "./phan-loai-pos";
import type { DongPos } from "./kieu";
import { sinhMa } from "@/lib/payments/ma-phieu";

const MA = sinhMa(777);
const MA2 = sinhMa(8888);

const goc: DongPos = {
  maGiaoDich: "FT2609290001",
  loaiGiaoDich: "Thanh toán",
  hinhThuc: "Thẻ",
  trangThai: "Thành công",
  soTien: 1_500_000,
  thoiGian: "2026-09-29T17:31:35+07:00",
  dienGiai: `Kiet 0328545229 ${MA}`,
  maChuanChi: "123456",
  maGiaoDichThe: "RRN1",
  maGiaoDichGoc: null,
  trangThaiHoanHuy: null,
  maDonHang: null,
  maQuay: "Q01",
  maThietBi: "TCBPOS0001",
  soTheMasked: "970436******1234",
  loaiThe: "VISA",
  maHachToan: null,
  phiGiaoDich: null,
};

const ctxOk = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false };
const d = (o: Partial<DongPos>): DongPos => ({ ...goc, ...o });

describe("phanLoaiDongPos", () => {
  it("[POS-P01] Trạng thái ≠ Thành công ⇒ BO_QUA 'Giao dịch <trạng thái>'", () => {
    expect(phanLoaiDongPos(d({ trangThai: "Thất bại" }), ctxOk)).toEqual({
      loai: "BO_QUA",
      lyDo: "Giao dịch Thất bại",
    });
    expect(phanLoaiDongPos(d({ trangThai: " Đang xử lý " }), ctxOk)).toEqual({
      loai: "BO_QUA",
      lyDo: "Giao dịch Đang xử lý",
    });
  });

  it("[POS-P01b] 'Thành công' dạng NFD / thừa khoảng trắng vẫn là Thành công", () => {
    const kq = phanLoaiDongPos(d({ trangThai: " Thành công ".normalize("NFD") }), ctxOk);
    expect(kq).toEqual({ loai: "THU", ma: MA });
  });

  it("[POS-P02] Loại ≠ Thanh toán ⇒ HUY; 'Hủy' ⇒ toanPhan", () => {
    expect(
      phanLoaiDongPos(d({ loaiGiaoDich: "Hủy", soTien: -1_500_000, maGiaoDichGoc: "FT2609290000" }), ctxOk),
    ).toEqual({ loai: "HUY", maGoc: "FT2609290000", toanPhan: true });
    // 'Huỷ' (dấu đặt kiểu cũ) cũng là Hủy
    expect(phanLoaiDongPos(d({ loaiGiaoDich: "Huỷ", maGiaoDichGoc: "X" }), ctxOk)).toMatchObject({
      loai: "HUY",
      toanPhan: true,
    });
  });

  it("[POS-P02b] Hoàn: toanPhan theo 'toàn phần' trong Hoàn/Hủy; mã gốc null vẫn HUY", () => {
    expect(
      phanLoaiDongPos(d({ loaiGiaoDich: "Hoàn tiền", trangThaiHoanHuy: "Hoàn một phần", maGiaoDichGoc: "G1" }), ctxOk),
    ).toEqual({ loai: "HUY", maGoc: "G1", toanPhan: false });
    expect(
      phanLoaiDongPos(d({ loaiGiaoDich: "Hoàn tiền", trangThaiHoanHuy: "Hoàn toàn phần", maGiaoDichGoc: "G1" }), ctxOk),
    ).toEqual({ loai: "HUY", maGoc: "G1", toanPhan: true });
    expect(phanLoaiDongPos(d({ loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: null }), ctxOk)).toEqual({
      loai: "HUY",
      maGoc: null,
      toanPhan: false,
    });
  });

  it("[POS-P02c] dòng loại 'Hủy' mà cột Hoàn/Hủy ghi 'một phần' ⇒ KHÔNG toàn phần (Q-G 30/09)", () => {
    // Mã TRƯỚC bản vá: `toanPhan: loai === HUY || …` ⇒ loại "Hủy" luôn toàn phần, bất kể cột.
    for (const v of ["Hủy một phần", "Huỷ một phần", "Hoàn một phần"]) {
      expect(
        phanLoaiDongPos(d({ loaiGiaoDich: "Hủy", soTien: -500_000, maGiaoDichGoc: "G1", trangThaiHoanHuy: v }), ctxOk),
        v,
      ).toEqual({ loai: "HUY", maGoc: "G1", toanPhan: false });
    }
    // Đối chứng: "Hủy" + cột trống / "Hủy toàn phần" vẫn toàn phần.
    for (const v of [null, "Hủy toàn phần"]) {
      expect(phanLoaiDongPos(d({ loaiGiaoDich: "Hủy", maGiaoDichGoc: "G1", trangThaiHoanHuy: v }), ctxOk)).toMatchObject({
        toanPhan: true,
      });
    }
  });

  it("[POS-P02d] laHuyToanPhanVoiGoc: toàn phần chỉ khi ĐÚNG SỐ gốc — 'Hủy' lệch số là một phần (Q-G)", () => {
    const huy = { loai: "HUY", maGoc: "G1", toanPhan: true } as const;
    expect(laHuyToanPhanVoiGoc(huy, -1_500_000, 1_500_000)).toBe(true);
    expect(laHuyToanPhanVoiGoc(huy, 1_500_000, 1_500_000), "dấu không quan trọng").toBe(true);
    expect(laHuyToanPhanVoiGoc(huy, -1_499_999, 1_500_000), "lệch 1đ ⇒ một phần").toBe(false);
    expect(laHuyToanPhanVoiGoc(huy, -500_000, 1_500_000)).toBe(false);
    expect(laHuyToanPhanVoiGoc({ ...huy, toanPhan: false }, -1_500_000, 1_500_000), "chữ nói một phần thắng số").toBe(false);
  });

  it("[POS-P03] Thanh toán có Hoàn/Hủy ⇒ BO_QUA; bị hủy trong lô ⇒ BO_QUA", () => {
    expect(phanLoaiDongPos(d({ trangThaiHoanHuy: "Hủy toàn phần" }), ctxOk)).toEqual({
      loai: "BO_QUA",
      lyDo: "Giao dịch đã bị hủy/hoàn",
    });
    expect(phanLoaiDongPos(goc, { thietBiDaGan: true, biHuyTrongLo: true, biHoanMotPhan: false })).toEqual({
      loai: "BO_QUA",
      lyDo: "Giao dịch đã bị hủy/hoàn",
    });
    // Hoàn/Hủy chỉ có khoảng trắng = trống
    expect(phanLoaiDongPos(d({ trangThaiHoanHuy: "  " }), ctxOk)).toEqual({ loai: "THU", ma: MA });
  });

  it("[POS-P03c] Thanh toán mang \"Hủy một phần\" ⇒ chặn hoàn một phần (4b), KHÔNG bỏ qua như hủy toàn phần", () => {
    // Mã TRƯỚC bản vá: luật 3 xét `includes("hủy")` TRƯỚC khi xét "một phần" ⇒ BO_QUA như hủy
    // toàn phần (không cảnh báo, không ai biết còn tiền ròng). Từ Q-G 30/09: 4b = CHẶN + cảnh báo.
    for (const v of ["Hủy một phần", "Huỷ một phần", "HỦY MỘT PHẦN"]) {
      expect(phanLoaiDongPos(d({ trangThaiHoanHuy: v }), ctxOk), v).toEqual({
        loai: "CHAN_HOAN_MOT_PHAN",
        lyDo: LY_DO_CHAN_HOAN_MOT_PHAN,
      });
    }
    // Đối chứng: toàn phần vẫn bỏ qua.
    expect(phanLoaiDongPos(d({ trangThaiHoanHuy: "Hủy toàn phần" }), ctxOk).loai).toBe("BO_QUA");
    // Q-I theo đúng chữ (30/09): cột trơn "Hủy" KHÔNG nói toàn phần ⇒ một phần (trước: BO_QUA).
    expect(phanLoaiDongPos(d({ trangThaiHoanHuy: "Hủy" }), ctxOk).loai).toBe("CHAN_HOAN_MOT_PHAN");
  });

  it("[POS-P03b] Hoàn MỘT PHẦN ⇒ CHAN_HOAN_MOT_PHAN (Q-G 30/09: chặn tự động — không BO_QUA im lặng, không hàng chờ)", () => {
    // Lịch sử: bản đầu ⇒ BO_QUA (tiền ròng biến mất im lặng); bản 29/09 ⇒ CAN_XU_LY + giao dịch
    // UNMATCHED (gắn tay bị buộc Σ = số GỘP ⇒ sổ ghi thừa đúng số đã hoàn). Chủ dự án chốt Q-G.
    expect(phanLoaiDongPos(d({ trangThaiHoanHuy: "Hoàn một phần" }), ctxOk)).toEqual({
      loai: "CHAN_HOAN_MOT_PHAN",
      lyDo: LY_DO_CHAN_HOAN_MOT_PHAN,
    });
    // Bị một dòng Hoàn MỘT PHẦN trỏ tới (cột Hoàn/Hủy của gốc trống) ⇒ như trên.
    expect(phanLoaiDongPos(goc, { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: true })).toEqual({
      loai: "CHAN_HOAN_MOT_PHAN",
      lyDo: LY_DO_CHAN_HOAN_MOT_PHAN,
    });
    // Giá trị Hoàn/Hủy lạ (không nói toàn phần) ⇒ cũng chặn (fail-closed), KHÔNG bỏ qua.
    const la = phanLoaiDongPos(d({ trangThaiHoanHuy: "Đã hoàn" }), ctxOk);
    expect(la).toMatchObject({ loai: "CHAN_HOAN_MOT_PHAN" });
    expect(loaiCanhBaoPos(la.loai === "CHAN_HOAN_MOT_PHAN" ? la.lyDo : null)).toBe("HOAN_MOT_PHAN");
    // Toàn phần vẫn BO_QUA. ("Hủy" / "Huỷ giao dịch" trơn trong CỘT từng ở đây — Q-I theo đúng chữ
    // 30/09 đưa chúng sang MỘT PHẦN, xem `[POS-P03e]`.)
    for (const v of ["Hoàn toàn phần", "Hủy toàn phần"]) {
      expect(phanLoaiDongPos(d({ trangThaiHoanHuy: v }), ctxOk), v).toEqual({
        loai: "BO_QUA",
        lyDo: "Giao dịch đã bị hủy/hoàn",
      });
    }
    // Bị hủy toàn phần trong lô thắng hoàn một phần.
    expect(phanLoaiDongPos(goc, { thietBiDaGan: true, biHuyTrongLo: true, biHoanMotPhan: true })).toMatchObject({
      loai: "BO_QUA",
    });
  });

  it("[POS-P03e] Q-I: giá trị LẠ có chữ 'hủy' ('Hủy thất bại', 'Chờ hủy', 'Yêu cầu hủy', 'Không hủy') ⇒ MỘT PHẦN — chặn, KHÔNG bỏ qua im lặng", () => {
    // Mã TRƯỚC bản vá (rà vòng 3): `v.includes(TOAN_PHAN) || v.includes(HUY) ? "TOAN_PHAN"` — mọi
    // chuỗi có chữ "hủy" là toàn phần ⇒ luật 3 BO_QUA im lặng, không cảnh báo (fail-OPEN).
    // Q-I theo ĐÚNG CHỮ (30/09): cả giá trị trơn "Hủy" / "Huỷ giao dịch" trong CỘT cũng là một phần
    // (bản rà vòng 3 giữ chúng toàn phần qua tập `HUY_TRON_DA_BIET` — đã bỏ; file thật 29/09 không
    // có giá trị trơn nào trong cột).
    for (const v of ["Hủy thất bại", "Chờ hủy", "Yêu cầu hủy", "Không hủy", "HUỶ THẤT BẠI", "Hủy", "Huỷ", "Huỷ giao dịch"]) {
      expect(tinHieuHoanHuy(v), v).toBe("MOT_PHAN");
      expect(phanLoaiDongPos(d({ trangThaiHoanHuy: v }), ctxOk), v).toMatchObject({ loai: "CHAN_HOAN_MOT_PHAN" });
      // Dòng loại "Hủy" mang cột lạ ⇒ KHÔNG toàn phần (vế số tiền không cứu được giá trị lạ).
      expect(phanLoaiDongPos(d({ loaiGiaoDich: "Hủy", soTien: -1_500_000, maGiaoDichGoc: "G1", trangThaiHoanHuy: v }), ctxOk), v).toEqual({
        loai: "HUY",
        maGoc: "G1",
        toanPhan: false,
      });
    }
    // Đối chứng dương: các giá trị ĐÃ BIẾT vẫn toàn phần.
    for (const v of ["Hủy toàn phần", "Hoàn toàn phần", "HUỶ TOÀN PHẦN"]) {
      expect(tinHieuHoanHuy(v), v).toBe("TOAN_PHAN");
    }
    // Đối chứng dương cho vế số tiền: dòng loại "Hủy" cột TRỐNG vẫn toàn phần (hình dạng file thật).
    expect(phanLoaiDongPos(d({ loaiGiaoDich: "Hủy", soTien: -1_500_000, maGiaoDichGoc: "G1", trangThaiHoanHuy: null }), ctxOk)).toEqual({
      loai: "HUY",
      maGoc: "G1",
      toanPhan: true,
    });
  });

  it("[POS-P03d] tinHieuHoanHuy + loaiCanhBaoPos", () => {
    expect(tinHieuHoanHuy(null)).toBe("TRONG");
    expect(tinHieuHoanHuy("  ")).toBe("TRONG");
    expect(tinHieuHoanHuy("Hủy toàn phần")).toBe("TOAN_PHAN");
    expect(tinHieuHoanHuy("Huỷ")).toBe("MOT_PHAN"); // Q-I đúng chữ 30/09 (trước: TOAN_PHAN)
    expect(tinHieuHoanHuy("Hủy một phần")).toBe("MOT_PHAN");
    expect(tinHieuHoanHuy("Đã hoàn")).toBe("MOT_PHAN");
    expect(loaiCanhBaoPos(`${LY_DO_CHAN_HOAN_MOT_PHAN} (FT1)`)).toBe("HOAN_MOT_PHAN");
    expect(loaiCanhBaoPos("Khớp phiếu ABCDE · Giao dịch thẻ bị hủy sau khi đã ghi nhận (FT1)")).toBe("HUY_SAU_GHI_NHAN");
    expect(loaiCanhBaoPos(null)).toBe("HUY_SAU_GHI_NHAN");
  });

  it("[POS-P04] số tiền ≤ 0 ⇒ CAN_XU_LY, KHÔNG tạo giao dịch", () => {
    for (const soTien of [0, -1]) {
      const kq = phanLoaiDongPos(d({ soTien }), ctxOk);
      expect(kq).toMatchObject({ loai: "CAN_XU_LY", taoGiaoDich: false });
    }
  });

  it("[POS-P05] thiết bị chưa gán ⇒ CAN_XU_LY 'Thiết bị chưa gán cơ sở', VẪN tạo giao dịch", () => {
    expect(phanLoaiDongPos(goc, { thietBiDaGan: false, biHuyTrongLo: false, biHoanMotPhan: false })).toEqual({
      loai: "CAN_XU_LY",
      lyDo: "Thiết bị chưa gán cơ sở",
      taoGiaoDich: true,
    });
  });

  it("[POS-P06] 0 mã / ≥2 mã ⇒ CAN_XU_LY tạo giao dịch; đúng 1 mã ⇒ THU", () => {
    expect(phanLoaiDongPos(d({ dienGiai: "Kiet 0328545229" }), ctxOk)).toEqual({
      loai: "CAN_XU_LY",
      lyDo: "Không có mã phiếu 5 ký tự trong ghi chú",
      taoGiaoDich: true,
    });
    expect(phanLoaiDongPos(d({ dienGiai: `${MA} ${MA2}` }), ctxOk)).toEqual({
      loai: "CAN_XU_LY",
      lyDo: `Ghi chú có 2 mã phiếu: ${MA}, ${MA2}`,
      taoGiaoDich: true,
    });
    expect(phanLoaiDongPos(goc, ctxOk)).toEqual({ loai: "THU", ma: MA });
  });

  it("[POS-P07] thứ tự ưu tiên", () => {
    const chuaGan = { thietBiDaGan: false, biHuyTrongLo: false, biHoanMotPhan: false };
    // Thất bại + thiết bị chưa gán ⇒ BO_QUA (luật 1 đứng trước luật 5)
    expect(phanLoaiDongPos(d({ trangThai: "Thất bại" }), chuaGan)).toMatchObject({ loai: "BO_QUA" });
    // Thất bại + Hủy ⇒ BO_QUA (luật 1 trước luật 2)
    expect(phanLoaiDongPos(d({ trangThai: "Thất bại", loaiGiaoDich: "Hủy" }), ctxOk)).toMatchObject({
      loai: "BO_QUA",
    });
    // Hủy + thiết bị chưa gán + số âm ⇒ HUY (luật 2 trước 4, 5)
    expect(phanLoaiDongPos(d({ loaiGiaoDich: "Hủy", soTien: -5 }), chuaGan)).toMatchObject({
      loai: "HUY",
      toanPhan: true,
    });
    // bị hủy trong lô + số 0 + chưa gán ⇒ BO_QUA (luật 3 trước 4, 5)
    expect(
      phanLoaiDongPos(d({ soTien: 0 }), { thietBiDaGan: false, biHuyTrongLo: true, biHoanMotPhan: false }),
    ).toMatchObject({ loai: "BO_QUA" });
    // số 0 + chưa gán ⇒ taoGiaoDich:false (luật 4 trước 5)
    expect(phanLoaiDongPos(d({ soTien: 0 }), chuaGan)).toMatchObject({
      loai: "CAN_XU_LY",
      taoGiaoDich: false,
    });
    // chưa gán + có đúng 1 mã ⇒ CAN_XU_LY (luật 5 trước 6)
    expect(phanLoaiDongPos(goc, chuaGan)).toMatchObject({ loai: "CAN_XU_LY", taoGiaoDich: true });
  });
});
