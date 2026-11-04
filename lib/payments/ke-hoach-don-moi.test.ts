// lib/payments/ke-hoach-don-moi.test.ts — kế hoạch thanh toán LẬP NGAY Ở TRANG TẠO ĐƠN.
//
// Chủ dự án 15/09/2026: *"đưa phần kế hoạch thanh toán ra trang tạo đơn hàng luôn đi"*,
// *"lấy số tiền cần thanh toán ở phần khoá học sau khi hoàn thành các tuỳ chọn"*, và
// *"khi sale chưa chọn khoá học thì khối kế hoạch hiện nhưng khoá"*.
//
// ⚠️ Ca [DM-01..04] canh đúng con bug 14/09: kế hoạch mở đầu KHÔNG được tự nhận "đã thu".
// Trên trang tạo đơn nó chắc chắn hơn mọi nơi khác — đơn vừa sinh ra, không trục nào có
// thể đã ghi nhận tiền của nó — nên `daThu: false` ở đây không phải mặc định thận trọng,
// nó là số đúng duy nhất.
//
// ⚠️ Mốc ngày TRUYỀN VÀO, không đọc đồng hồ (luật 19). Mốc dùng xuyên tệp: 20/01/2026.
import { describe, it, expect } from "vitest";
import {
  dotsChoDonMoi,
  khoaKeHoachDonMoi,
  NGAY_NHAC_MAC_DINH,
} from "./ke-hoach-don-moi";
import { kiemKeHoachDot, TRAN_SO_DOT } from "./ke-hoach-dot";

const MOC = new Date("2026-01-20T00:00:00.000Z");
const ngay = (d: Date) => d.toISOString().slice(0, 10);

describe("[DM-01] kế hoạch mở đầu: CHƯA THU ĐỒNG NÀO", () => {
  it("1 đợt — daThu FALSE, không phải 'đã thu cả đơn'", () => {
    const dots = dotsChoDonMoi(10_560_000, MOC);
    expect(dots).toHaveLength(1);
    expect(dots[0]!.daThu).toBe(false);
    expect(dots[0]!.amount).toBe(10_560_000);
  });

  it("mọi số đợt 1..12 đều KHÔNG có đợt nào daThu", () => {
    for (let n = 1; n <= TRAN_SO_DOT; n++) {
      const dots = dotsChoDonMoi(10_560_000, MOC, n);
      expect(dots.filter((d) => d.daThu)).toEqual([]);
    }
  });
});

describe("[DM-02] Σ các đợt === TỔNG ĐƠN SAU GIẢM GIÁ", () => {
  it("chia 4 đợt khoá Sata3 — chẵn tuyệt đối", () => {
    const dots = dotsChoDonMoi(10_560_000, MOC, 4);
    expect(dots.map((d) => d.amount)).toEqual([2_640_000, 2_640_000, 2_640_000, 2_640_000]);
  });

  it("tổng có phần lẻ (giảm giá kiểu SỐ TIỀN) — lẻ dồn đợt CUỐI, Σ vẫn khớp", () => {
    const dots = dotsChoDonMoi(10_000_001, MOC, 3);
    expect(dots.map((d) => d.amount)).toEqual([3_333_333, 3_333_333, 3_333_335]);
    expect(dots.reduce((s, d) => s + d.amount, 0)).toBe(10_000_001);
  });

  it("bất biến Σ giữ ở mọi (tổng × số đợt) trong dải thật", () => {
    for (const tong of [1, 999, 2_500_000, 3_040_000, 10_560_000, 955_563_000]) {
      for (let n = 1; n <= TRAN_SO_DOT; n++) {
        const dots = dotsChoDonMoi(tong, MOC, n);
        expect(dots.reduce((s, d) => s + d.amount, 0)).toBe(tong);
      }
    }
  });
});

describe("[DM-03] MỌI đợt đều có hạn — nút Lưu không được khoá ngay lúc form vừa mở", () => {
  it("đợt 1 đến hạn NGAY mốc, các đợt sau cách 30 ngày", () => {
    const dots = dotsChoDonMoi(10_560_000, MOC, 3);
    expect(dots.map((d) => ngay(d.dueDate))).toEqual(["2026-01-20", "2026-02-19", "2026-03-21"]);
  });

  it("kế hoạch mở đầu ĐI QUA được `kiemKeHoachDot` — cùng cổng mà đường ghi dùng", () => {
    for (let n = 1; n <= 4; n++) {
      const dots = dotsChoDonMoi(10_560_000, MOC, n);
      expect(kiemKeHoachDot(dots, 10_560_000)).toEqual({ ok: true, coDotChuaThu: true });
    }
  });

  it("số ngày nhắc bày sẵn là NGAY_NHAC_MAC_DINH, không phải hằng rời", () => {
    expect(dotsChoDonMoi(10_560_000, MOC, 2).map((d) => d.reminderDays)).toEqual([
      NGAY_NHAC_MAC_DINH,
      NGAY_NHAC_MAC_DINH,
    ]);
  });
});

describe("[DM-04] số đợt xấu bị kẹp, không ném và không trả mảng rỗng", () => {
  it("0 / âm / NaN → 1 đợt", () => {
    for (const n of [0, -3, NaN]) {
      expect(dotsChoDonMoi(10_560_000, MOC, n).map((d) => d.amount)).toEqual([10_560_000]);
    }
  });

  it("vượt trần 12 → đúng 12 đợt", () => {
    expect(dotsChoDonMoi(10_560_000, MOC, 99)).toHaveLength(TRAN_SO_DOT);
  });
});

describe("[DM-05] LÝ DO khoá khối — một chỗ quyết cả điều kiện lẫn câu chữ", () => {
  it("chưa chọn khoá học (tổng 0) → khoá, và lý do nói việc cần làm trước", () => {
    const ly = khoaKeHoachDonMoi(0);
    expect(ly).toBeTypeOf("string");
    expect(ly).toContain("Chọn khoá học");
    // Phải nói cả NGUỒN số tiền — câu hỏi kế tiếp của người bán là "lấy số ở đâu".
    expect(ly).toContain("Tổng đơn sau giảm giá");
  });

  it("tổng âm (không nên xảy ra, nhưng vẫn phải khoá chứ không mở)", () => {
    expect(khoaKeHoachDonMoi(-1)).toBeTypeOf("string");
  });

  it("có tiền → MỞ (null), không trả chuỗi rỗng", () => {
    expect(khoaKeHoachDonMoi(10_560_000)).toBeNull();
    expect(khoaKeHoachDonMoi(1)).toBeNull();
  });

  it("NaN → khoá (fail-closed)", () => {
    expect(khoaKeHoachDonMoi(NaN)).toBeTypeOf("string");
  });
});
