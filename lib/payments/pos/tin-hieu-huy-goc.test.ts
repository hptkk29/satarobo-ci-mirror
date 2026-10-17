// [THG-*] — `tinHieuHuyCuaGoc`: gốc đã bị hủy/hoàn tới đâu. THUẦN.
//
// Hai lượt (đóng cảnh báo · gỡ gắn) hỏi CÙNG hàm này — ca ở đây là hợp đồng chung của chúng.
import { describe, it, expect } from "vitest";
import type { DongHuyPos } from "./kieu";
import { DUOI_CHAN_HOAN_MOT_PHAN, LY_DO_CHAN_HOAN_MOT_PHAN } from "./phan-loai-pos";
import {
  LY_DO_HUY_TOAN_PHAN_THEO_COT,
  ghiChuGiaoDichHuyToanPhan,
  lyDoGocHuyToanPhan,
  noiLyDoPos,
  tinHieuHuyCuaGoc,
} from "./tin-hieu-huy-goc";

const SO_GOC = 6_732_000;
const goc = (p: { trangThaiHoanHuy?: string | null; matchReason?: string | null } = {}) => ({
  soTien: SO_GOC,
  trangThaiHoanHuy: p.trangThaiHoanHuy ?? null,
  matchReason: p.matchReason ?? null,
});
const dong = (p: Partial<DongHuyPos> & { maGiaoDich: string }): DongHuyPos => ({
  loaiGiaoDich: "Hủy",
  trangThai: "Thành công",
  soTien: -SO_GOC,
  maGiaoDichGoc: "GOC0000001",
  trangThaiHoanHuy: null,
  ...p,
});

describe("[THG] tín hiệu hủy/hoàn của giao dịch gốc", () => {
  it("[THG-01] không dòng trỏ vào, cột trống ⇒ không tín hiệu", () => {
    expect(tinHieuHuyCuaGoc({ goc: goc(), dongTroVao: [] })).toEqual({ toanPhan: null, motPhan: false });
  });

  it("[THG-02] dòng Hủy ĐÚNG số gốc ⇒ toàn phần, mang mã dòng hủy", () => {
    expect(tinHieuHuyCuaGoc({ goc: goc(), dongTroVao: [dong({ maGiaoDich: "HUY0000001" })] })).toEqual({
      toanPhan: { maHuy: "HUY0000001" },
      motPhan: false,
    });
  });

  it("[THG-03] dòng Hủy LỆCH số gốc ⇒ một phần (Q-G), KHÔNG toàn phần", () => {
    const th = tinHieuHuyCuaGoc({ goc: goc(), dongTroVao: [dong({ maGiaoDich: "HUY0000002", soTien: -1_000_000 })] });
    expect(th).toEqual({ toanPhan: null, motPhan: true });
  });

  it("[THG-04] dòng 'Hoàn tiền' cột 'Hoàn một phần' ⇒ một phần", () => {
    const th = tinHieuHuyCuaGoc({
      goc: goc(),
      dongTroVao: [dong({ maGiaoDich: "HOAN000001", loaiGiaoDich: "Hoàn tiền", soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" })],
    });
    expect(th).toEqual({ toanPhan: null, motPhan: true });
  });

  it("[THG-05] dòng Hủy THẤT BẠI ⇒ không phải hủy (luật 1)", () => {
    expect(
      tinHieuHuyCuaGoc({ goc: goc(), dongTroVao: [dong({ maGiaoDich: "HUY0000003", trangThai: "Thất bại" })] }),
    ).toEqual({ toanPhan: null, motPhan: false });
  });

  it("[THG-06] CHỈ cột của gốc nói 'Hủy toàn phần' ⇒ toàn phần, maHuy null (luật 3)", () => {
    expect(tinHieuHuyCuaGoc({ goc: goc({ trangThaiHoanHuy: "Hủy toàn phần" }), dongTroVao: [] })).toEqual({
      toanPhan: { maHuy: null },
      motPhan: false,
    });
  });

  it("[THG-07] cột 'Hoàn một phần' / giá trị LẠ ⇒ một phần (fail-closed)", () => {
    expect(tinHieuHuyCuaGoc({ goc: goc({ trangThaiHoanHuy: "Hoàn một phần" }), dongTroVao: [] })).toEqual({
      toanPhan: null,
      motPhan: true,
    });
    expect(tinHieuHuyCuaGoc({ goc: goc({ trangThaiHoanHuy: "Đang tra soát" }), dongTroVao: [] })).toEqual({
      toanPhan: null,
      motPhan: true,
    });
  });

  it("[THG-08] gốc VỐN đã bị chặn vì hoàn một phần (lý do mang đuôi chặn) ⇒ một phần", () => {
    expect(
      tinHieuHuyCuaGoc({ goc: goc({ matchReason: `Khớp phiếu ACDEQ · ${LY_DO_CHAN_HOAN_MOT_PHAN}` }), dongTroVao: [] }),
    ).toEqual({ toanPhan: null, motPhan: true });
    expect(LY_DO_CHAN_HOAN_MOT_PHAN).toContain(DUOI_CHAN_HOAN_MOT_PHAN);
  });

  it("[THG-09] hoàn một phần + hủy toàn phần cùng trỏ vào ⇒ CẢ HAI cờ; maHuy = dòng toàn phần ĐẦU TIÊN theo thứ tự đưa vào", () => {
    const th = tinHieuHuyCuaGoc({
      goc: goc(),
      dongTroVao: [
        dong({ maGiaoDich: "HOAN000002", loaiGiaoDich: "Hoàn tiền", soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" }),
        dong({ maGiaoDich: "HUY0000009" }),
        dong({ maGiaoDich: "HUY0000010" }),
      ],
    });
    expect(th).toEqual({ toanPhan: { maHuy: "HUY0000009" }, motPhan: true });
  });

  it("[THG-10] câu chữ: có mã ⇒ nêu mã; chỉ cột ⇒ nói theo cột; nối lý do không lặp", () => {
    expect(ghiChuGiaoDichHuyToanPhan("HUY0000001")).toBe("Đã bị hủy bởi giao dịch thẻ HUY0000001");
    expect(lyDoGocHuyToanPhan("HUY0000001")).toBe("Đã bị hủy bởi HUY0000001");
    expect(ghiChuGiaoDichHuyToanPhan(null)).toBe(LY_DO_HUY_TOAN_PHAN_THEO_COT);
    expect(lyDoGocHuyToanPhan(null)).toBe(LY_DO_HUY_TOAN_PHAN_THEO_COT);
    expect(noiLyDoPos(null, "b")).toBe("b");
    expect(noiLyDoPos("a", "b")).toBe("a · b");
    expect(noiLyDoPos("a · b", "b")).toBe("a · b");
  });

  it("[THG-11] Q-I: cột của gốc mang giá trị LẠ có chữ 'hủy' ('Hủy thất bại', 'Chờ hủy'…) ⇒ MỘT PHẦN, KHÔNG toàn phần", () => {
    // Mã TRƯỚC bản vá (rà vòng 3): `v.includes("hủy") ⇒ TOAN_PHAN` — mọi chuỗi có chữ "hủy" là toàn
    // phần ⇒ gỡ gắn đưa giao dịch sang IGNORED + dòng gốc BO_QUA im lặng (fail-OPEN, trái Q-I).
    // Q-I đúng chữ 30/09: kể cả "Hủy" / "Hủy giao dịch" trơn trong cột của gốc ⇒ một phần.
    for (const v of ["Hủy thất bại", "Chờ hủy", "Yêu cầu hủy", "Không hủy", "Hủy", "Hủy giao dịch"]) {
      expect(tinHieuHuyCuaGoc({ goc: goc({ trangThaiHoanHuy: v }), dongTroVao: [] }), v).toEqual({ toanPhan: null, motPhan: true });
    }
    // Đối chứng: "Hủy toàn phần" vẫn toàn phần theo cột.
    expect(tinHieuHuyCuaGoc({ goc: goc({ trangThaiHoanHuy: "Hủy toàn phần" }), dongTroVao: [] }).toanPhan).toEqual({ maHuy: null });
  });
});
