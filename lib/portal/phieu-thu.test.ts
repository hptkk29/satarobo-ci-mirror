// lib/portal/phieu-thu.test.ts — Bước 6, tầng THUẦN (chạy trong CI, không cần DB).
//
// Kiểm đúng ba luật hiển thị của Bước 5. Ca quan trọng nhất không phải "xếp đúng thứ tự"
// mà là **dòng gốc không bị đổi số** — vì phụ huynh đang cầm biên lai giấy in số đó.
import { describe, it, expect } from "vitest";
import {
  xepPhieuThuVaDieuChinh,
  tongPhieuThuHienThi,
  soTienCoDau,
} from "./phieu-thu";

type Dong = {
  id: string;
  amount: number;
  paymentType: string;
  adjustmentOfId: string | null;
  confirmedAt: string | null;
};

const goc = (id: string, amount: number, confirmedAt = "2026-09-01T03:00:00.000Z"): Dong => ({
  id,
  amount,
  paymentType: "PAYMENT",
  adjustmentOfId: null,
  confirmedAt,
});
const dc = (id: string, of: string, amount: number, confirmedAt: string): Dong => ({
  id,
  amount,
  paymentType: "ADJUSTMENT",
  adjustmentOfId: of,
  confirmedAt,
});

describe("[BUOC-6] xepPhieuThuVaDieuChinh", () => {
  it("chèn bút toán điều chỉnh NGAY DƯỚI phiếu gốc của nó", () => {
    const ra = xepPhieuThuVaDieuChinh([
      goc("p1", 4_000_000),
      goc("p2", 3_000_000),
      dc("a1", "p1", -1_000_000, "2026-09-05T03:00:00.000Z"),
    ]);
    expect(ra.map((r) => r.id)).toEqual(["p1", "a1", "p2"]);
  });

  it("KHÔNG đổi `amount` của bất kỳ dòng nào", () => {
    const vao: Dong[] = [goc("p1", 4_000_000), dc("a1", "p1", -1_000_000, "2026-09-05T03:00:00.000Z")];
    const ra = xepPhieuThuVaDieuChinh(vao);
    expect(ra.find((r) => r.id === "p1")!.amount).toBe(4_000_000);
    expect(ra.find((r) => r.id === "a1")!.amount).toBe(-1_000_000);
  });

  it("gắn `daBiDieuChinh` cho phiếu gốc, KHÔNG gắn cho dòng điều chỉnh", () => {
    const ra = xepPhieuThuVaDieuChinh([
      goc("p1", 4_000_000),
      goc("p2", 3_000_000),
      dc("a1", "p1", 500_000, "2026-09-05T03:00:00.000Z"),
    ]);
    expect(ra.find((r) => r.id === "p1")!.daBiDieuChinh).toBe(true);
    expect(ra.find((r) => r.id === "a1")!.daBiDieuChinh).toBe(false);
    expect(ra.find((r) => r.id === "p2")!.daBiDieuChinh).toBe(false);
  });

  it("nhiều lần điều chỉnh trên MỘT phiếu xếp theo `confirmedAt` TĂNG DẦN", () => {
    const ra = xepPhieuThuVaDieuChinh([
      goc("p1", 4_000_000),
      dc("a2", "p1", -800_000, "2026-09-06T03:00:00.000Z"),
      dc("a1", "p1", 1_000_000, "2026-09-05T03:00:00.000Z"),
    ]);
    expect(ra.map((r) => r.id)).toEqual(["p1", "a1", "a2"]);
  });

  it("giữ nguyên thứ tự phiếu gốc do caller đưa vào (mới nhất trước)", () => {
    const ra = xepPhieuThuVaDieuChinh([goc("p3", 1), goc("p1", 2), goc("p2", 3)]);
    expect(ra.map((r) => r.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("bút toán MỒ CÔI (không thấy phiếu gốc) vẫn được giữ, rơi xuống cuối", () => {
    // Bỏ đi là tổng hiển thị lệch với ô "Đã thanh toán" — hai con số trên cùng một trang
    // đá nhau mà không ai giải thích được.
    const ra = xepPhieuThuVaDieuChinh([
      goc("p1", 4_000_000),
      dc("a9", "khong-co-trong-danh-sach", -500_000, "2026-09-05T03:00:00.000Z"),
    ]);
    expect(ra.map((r) => r.id)).toEqual(["p1", "a9"]);
    expect(tongPhieuThuHienThi(ra)).toBe(3_500_000);
  });

  it("danh sách rỗng → rỗng", () => {
    expect(xepPhieuThuVaDieuChinh([])).toEqual([]);
  });
});

describe("[BUOC-6] tongPhieuThuHienThi", () => {
  it("cộng cả dòng âm — đó là lý do dòng gốc được giữ số cũ mà tổng vẫn đúng", () => {
    const ra = xepPhieuThuVaDieuChinh([
      goc("p1", 4_000_000),
      dc("a1", "p1", -1_000_000, "2026-09-05T03:00:00.000Z"),
    ]);
    expect(tongPhieuThuHienThi(ra)).toBe(3_000_000);
  });

  it("nhiều lần điều chỉnh chồng nhau vẫn ra số cuối", () => {
    const ra = xepPhieuThuVaDieuChinh([
      goc("p1", 4_000_000),
      dc("a1", "p1", 1_000_000, "2026-09-05T03:00:00.000Z"),
      dc("a2", "p1", -800_000, "2026-09-06T03:00:00.000Z"),
    ]);
    expect(tongPhieuThuHienThi(ra)).toBe(4_200_000);
  });
});

describe("[BUOC-6] soTienCoDau", () => {
  it("số dương mang dấu cộng", () => {
    expect(soTienCoDau(1_000_000)).toBe("+1.000.000 đ");
  });

  it("số âm mang DẤU TRỪ THẬT (U+2212), không phải hyphen", () => {
    const s = soTienCoDau(-1_000_000);
    expect(s).toBe("−1.000.000 đ");
    expect(s.includes("-")).toBe(false);
  });
});
