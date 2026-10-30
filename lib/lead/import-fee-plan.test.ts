/**
 * Test dùng CHÍNH các dòng thật trong "Satarobo - Danh sách đăng ký.xlsx" (đo 04/08/2026).
 * Dữ liệu thật là bài kiểm tra tốt nhất: mọi ca dưới đây đều đã từng khiến bộ nhập cũ
 * ra kết quả sai (biến công nợ thành giảm giá, hoặc tách 1 em thành 2).
 */
import { describe, it, expect } from "vitest";
import {
  planRowFee,
  detectSameStudent,
  statedDiscountFromNote,
  AUTO_DISCOUNT_MAX_RATIO,
} from "./import-fee-plan";

const SATA3 = 7_920_000;
const SATA4 = 8_640_000;
const COMBO = 3_986_000;

const plan = (o: Partial<Parameters<typeof planRowFee>[0]> & { listPrice: number; paid: number }) =>
  planRowFee({ note: null, payIn2: false, ...o });

describe("planRowFee — dòng THẬT trong file", () => {
  it("thu đúng giá niêm yết → không giảm, không nợ", () => {
    const r = plan({ listPrice: COMBO, paid: COMBO });
    expect(r.treatment).toBe("PAID_FULL");
    expect(r.discountAmount).toBe(0);
    expect(r.remaining).toBe(0);
  });

  // ⚠️ Nhóm nguy hiểm nhất: suy thành giảm giá là MẤT TIỀN PHẢI ĐÒI.
  it.each([
    ["cọc 1tr", 1_000_000, SATA4],
    ["đóng trước 2tr", 2_000_000, SATA4],
    ["cuối tháng full phí", 1_000_000, SATA4],
    ["Cuối tháng 7 thánh toán 4tr còn lại", 4_640_000, SATA4],
  ])('ghi chú "%s" → CÔNG NỢ, tuyệt đối không thành giảm giá', (note, paid, list) => {
    const r = plan({ listPrice: list, paid, note });
    expect(r.treatment).toBe("DEBT");
    expect(r.discountAmount).toBe(0);
    expect(r.totalAmount).toBe(list);
    expect(r.remaining).toBe(list - paid);
  });

  it('"HOÀN PHÍ" → không nhập', () => {
    const r = plan({ listPrice: SATA3, paid: 4_000_000, note: "HOÀN PHÍ" });
    expect(r.treatment).toBe("REFUND");
    expect(r.needsHuman).toBe(true);
  });

  it.each([
    ["được giới thiệu -300.000", 3_686_000],
    ["Giới thiệu học viên -300,000", 3_686_000],
  ])('ghi chú "%s" → giảm giá thật 300.000, nợ 0', (note, paid) => {
    const r = plan({ listPrice: COMBO, paid, note });
    expect(r.treatment).toBe("DISCOUNT_NOTED");
    expect(r.discountAmount).toBe(300_000);
    expect(r.remaining).toBe(0);
  });

  it("ghi chú '-40%' nhưng tiền ứng 29% → LẤY THEO TIỀN và nêu rõ lệch", () => {
    // Chủ dự án chốt 04/08: "tin số tiền nhé".
    const r = plan({ listPrice: COMBO, paid: 2_814_000, note: "-40% học phí con quý đối tác" });
    expect(r.treatment).toBe("DISCOUNT_NOTED");
    expect(r.discountAmount).toBe(COMBO - 2_814_000); // 1.172.000, KHÔNG phải 40%
    expect(r.remaining).toBe(0);
    expect(r.needsHuman).toBe(true);
    expect(r.evidence).toMatch(/lấy theo TIỀN/i);
  });

  it("chênh nhỏ không dấu hiệu gì → suy là giảm giá, có đóng dấu 'suy khi nhập'", () => {
    const r = plan({ listPrice: COMBO, paid: Math.round(COMBO * 0.92) });
    expect(r.treatment).toBe("DISCOUNT_INFERRED");
    expect(r.remaining).toBe(0);
    expect(r.reason).toMatch(/suy khi nhập liệu/i);
  });

  it("chênh LỚN mà ghi chú trống → REVIEW, không tự quyết", () => {
    // Ca "Quân": 4.000.000/8.640.000, ghi chú trống. Máy không được tự cho là giảm 54%.
    const r = plan({ listPrice: SATA4, paid: 4_000_000 });
    expect(r.treatment).toBe("REVIEW");
    expect(r.discountAmount).toBe(0);
    expect(r.needsHuman).toBe(true);
  });

  it("đã tick trả 2 đợt → luôn là CÔNG NỢ dù ghi chú trống", () => {
    const r = plan({ listPrice: SATA4, paid: 4_000_000, payIn2: true });
    expect(r.treatment).toBe("DEBT");
    expect(r.remaining).toBe(SATA4 - 4_000_000);
  });

  it("thu VƯỢT niêm yết → giữ nguyên nhưng bắt người xem", () => {
    // PHAN TRỊNH HỒNH TÂM: 8.976.000 > 7.920.000. Chủ dự án: "tạm cứ cho là đúng".
    const r = plan({ listPrice: SATA3, paid: 8_976_000 });
    expect(r.discountAmount).toBe(0);
    expect(r.remaining).toBe(0);
    expect(r.needsHuman).toBe(true);
  });

  it("người nhập tự điền mức giảm → máy KHÔNG đoán đè", () => {
    const r = plan({
      listPrice: SATA4,
      paid: 1_000_000,
      note: "cọc 1tr", // dù ghi chú nói nợ
      manualDiscountAmount: 640_000,
      manualDiscountReason: "Ưu đãi đã duyệt",
    });
    expect(r.discountAmount).toBe(640_000);
    expect(r.reason).toBe("Ưu đãi đã duyệt");
  });

  it("chưa khớp giá niêm yết → REVIEW chứ không tính bừa", () => {
    expect(plan({ listPrice: 0, paid: 5_000_000 }).treatment).toBe("REVIEW");
  });

  it("khoản giảm không bao giờ vượt quá giá niêm yết", () => {
    const r = plan({ listPrice: COMBO, paid: 0, manualDiscountAmount: 99_000_000 });
    expect(r.discountAmount).toBe(COMBO);
    expect(r.totalAmount).toBe(0);
  });

  it("ngưỡng suy tự động nằm giữa hai cụm dữ liệu thật (10% thật vs 23% giả)", () => {
    expect(AUTO_DISCOUNT_MAX_RATIO).toBeGreaterThan(0.1);
    expect(AUTO_DISCOUNT_MAX_RATIO).toBeLessThan(0.23);
  });
});

describe("statedDiscountFromNote", () => {
  it.each([
    ["được giới thiệu -300.000", { kind: "AMOUNT", value: 300_000 }],
    ["Giới thiệu học viên -300,000", { kind: "AMOUNT", value: 300_000 }],
    ["-40% học phí con quý đối tác", { kind: "PERCENT", value: 40 }],
  ])('đọc "%s"', (note, want) => {
    expect(statedDiscountFromNote(note)).toEqual(want);
  });

  it("ghi chú không có con số → null", () => {
    expect(statedDiscountFromNote("cọc 1tr")).toBeNull();
    expect(statedDiscountFromNote(null)).toBeNull();
  });
});

describe("detectSameStudent — 4 nhóm THẬT trong file", () => {
  it("[Quân] tên lồng nhau + tổng = đúng 1 suất → MỘT em trả 2 đợt", () => {
    const r = detectSameStudent(
      [
        { fullName: "Quân", paid: 4_000_000 },
        { fullName: "Nguyễn Ngọc Quân", paid: 4_640_000 },
      ],
      SATA4,
    );
    expect(r.verdict).toBe("SAME_STUDENT");
  });

  it.each([
    ["PHẠM ĐỨC THỊNH", "HUỲNH BẢO KIM", 3_986_000, 3_686_000, COMBO],
    ["Đoàn Thanh Tra", "Nguyễn Phạm Gia Huy", 2_736_000, 2_736_000, 2_736_000],
  ])("[%s + %s] tên khác hẳn + tổng ≈ 2 suất → HAI em thật", (a, b, pa, pb, list) => {
    const r = detectSameStudent(
      [
        { fullName: a, paid: pa },
        { fullName: b, paid: pb },
      ],
      list,
    );
    expect(r.verdict).toBe("DIFFERENT_STUDENTS");
  });

  it("[Khang + Thạnh] tiền dồn về một dòng → UNSURE, bắt người quyết", () => {
    // Chủ dự án 04/08: "Hoàng Bảo Thạnh merge chung với anh Hoàng Vĩnh Khang nên bị mất".
    const r = detectSameStudent(
      [
        { fullName: "HOÀNG VĨNH KHANG", paid: 9_576_000 },
        { fullName: "HOÀNG BẢO THẠNH", paid: 0 },
      ],
      10_080_000,
    );
    expect(r.verdict).toBe("UNSURE");
  });

  it("một dòng thì không có gì để nghi", () => {
    expect(detectSameStudent([{ fullName: "A", paid: 1 }], COMBO).verdict).toBe("DIFFERENT_STUDENTS");
  });
});
