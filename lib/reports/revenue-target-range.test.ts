// B-02 — hàng chỉ số 1 của tab Tài chính (Mục tiêu · Doanh thu · Tỷ lệ hoàn thành).
//
// Bộ test này canh đúng bốn kiểu hỏng CÂM — hỏng mà thẻ vẫn in ra một con số trông
// bình thường và không ai nghi ngờ:
//
//  1. 🔴 MỤC TIÊU NHIỀU CƠ SỞ BỊ ĐÈ. Đây là lỗi ĐÃ ĐO ĐƯỢC trên đường cũ:
//     `buildRevenueTargetReport` (`lib/reports/revenue-target.ts:65`) dùng
//     `targetByPeriod.set(period, amount)` ⇒ hai cơ sở cùng đặt mục tiêu tháng 8 thì
//     dòng sau ĐÈ dòng trước, "mục tiêu" chỉ còn của MỘT cơ sở. Chọn 3 cơ sở ra con số
//     của 1 cơ sở là tỷ lệ hoàn thành phồng gấp ba, và phồng im lặng.
//  2. 🔴 ĐẾM ĐÔI mục tiêu công ty + mục tiêu cơ sở của cùng một kỳ. `@@unique([centerId,
//     period])` với `centerId` nullable cho phép hai dòng cùng tồn tại; cộng cả hai là
//     mẫu số phình gấp đôi ⇒ tỷ lệ hoàn thành tụt một nửa.
//  3. 🔴 CHƯA ĐẶT MỤC TIÊU MÀ RA SỐ. `null` phải đi hết đường ra UI dưới dạng "chưa
//     đặt". Rơi về 0 thì hoặc chia cho 0 (Infinity/NaN), hoặc người đọc hiểu "mục tiêu
//     tháng này bằng không" — hai kết cục đều tệ hơn không hiện gì.
//  4. 🔴 KHOẢNG NGÀY CẮT NGANG THÁNG bị lặng lẽ chia tỷ lệ. Mục tiêu là con số CAM KẾT
//     theo trọn tháng; tự chia cho số ngày rồi in ra như thể đó là cam kết là bịa số.
//     Ở đây mục tiêu LUÔN là trọn tháng, còn phần "so với tiến độ" là một con số RIÊNG,
//     có nhãn riêng — test canh đúng ranh giới đó.
import { describe, it, expect } from "vitest";
import {
  buildRangeTarget,
  buildRevenueTargetCard,
  daysInMonth,
  daysOfMonthInRange,
  formatPeriodVN,
  monthKeysInRange,
  targetScopeMode,
  type RevenueTargetRow,
} from "./revenue-target-range";

function mt(centerId: string | null, period: string, targetAmount: number): RevenueTargetRow {
  return { centerId, period, targetAmount };
}

const CENTERS = { kind: "CENTERS", centerIds: ["cs1", "cs2"] } as const;
const SYSTEM = { kind: "SYSTEM", centerIds: ["cs1", "cs2"] } as const;

describe("[B-02-T1] monthKeysInRange — mọi tháng CHẠM khoảng, không thiếu không thừa", () => {
  it("khoảng nằm gọn trong một tháng → đúng 1 kỳ", () => {
    expect(monthKeysInRange("2026-08-05", "2026-08-20")).toEqual(["2026-08"]);
  });

  it("khoảng cắt ngang hai tháng → đủ CẢ HAI (ca 15/08 → 10/09 của đề bài)", () => {
    expect(monthKeysInRange("2026-08-15", "2026-09-10")).toEqual(["2026-08", "2026-09"]);
  });

  it("vắt qua giao thừa → không nhảy về tháng 13 hay tụt năm", () => {
    expect(monthKeysInRange("2025-12-28", "2026-01-03")).toEqual(["2025-12", "2026-01"]);
  });

  it("một ngày duy nhất → đúng 1 kỳ", () => {
    expect(monthKeysInRange("2026-02-28", "2026-02-28")).toEqual(["2026-02"]);
  });

  it("khoảng đảo ngược (từ > đến) → RỖNG, không lặp vô hạn", () => {
    expect(monthKeysInRange("2026-09-10", "2026-08-15")).toEqual([]);
  });

  it("khoảng dài phi lý vẫn dừng — chốt chặn vòng lặp, không treo server", () => {
    const ks = monthKeysInRange("1900-01-01", "2026-12-31");
    expect(ks.length).toBeLessThanOrEqual(400);
    expect(ks[0]).toBe("1900-01");
  });
});

describe("[B-02-T2] daysInMonth / daysOfMonthInRange — mẫu số của phần 'tiến độ'", () => {
  it("số ngày của tháng: 31 · 30 · 28 · 29 (năm nhuận)", () => {
    expect(daysInMonth("2026-08")).toBe(31);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29);
  });

  it("15/08 → 10/09: tháng 8 góp 17 ngày, tháng 9 góp 10 ngày", () => {
    expect(daysOfMonthInRange("2026-08", "2026-08-15", "2026-09-10")).toBe(17);
    expect(daysOfMonthInRange("2026-09", "2026-08-15", "2026-09-10")).toBe(10);
  });

  it("trọn tháng → đúng số ngày của tháng", () => {
    expect(daysOfMonthInRange("2026-08", "2026-08-01", "2026-08-31")).toBe(31);
  });

  it("tháng không chạm khoảng → 0", () => {
    expect(daysOfMonthInRange("2026-07", "2026-08-15", "2026-09-10")).toBe(0);
  });
});

describe("[B-02-T3] targetScopeMode — ai được dùng dòng mục tiêu TOÀN HỆ THỐNG", () => {
  it("cấp hội sở/quản trị + đang xem tất cả cơ sở → SYSTEM", () => {
    expect(
      targetScopeMode({ isAllCenters: true, isGlobalAllowed: true, centerIds: ["cs1", "cs2"] }),
    ).toEqual({ kind: "SYSTEM", centerIds: ["cs1", "cs2"] });
  });

  it("cấp hội sở nhưng đã THU HẸP về vài cơ sở → CENTERS (mục tiêu công ty không còn đúng phạm vi)", () => {
    expect(
      targetScopeMode({ isAllCenters: false, isGlobalAllowed: true, centerIds: ["cs1"] }),
    ).toEqual({ kind: "CENTERS", centerIds: ["cs1"] });
  });

  it("🔴 QLCS giữ 2 cơ sở, chọn 'tất cả' → vẫn là CENTERS, KHÔNG mượn mục tiêu công ty", () => {
    // "Tất cả" của người này = 2 cơ sở của họ, không phải cả công ty. Lấy dòng
    // centerId=null ở đây là đem mục tiêu của 8 cơ sở làm mẫu số cho doanh thu 2 cơ sở.
    expect(
      targetScopeMode({ isAllCenters: true, isGlobalAllowed: false, centerIds: ["cs1", "cs2"] }),
    ).toEqual({ kind: "CENTERS", centerIds: ["cs1", "cs2"] });
  });
});

describe("[B-02-T4] 🔴 cộng mục tiêu của TẤT CẢ cơ sở đang chọn (lỗi bị đè)", () => {
  const rows = [mt("cs1", "2026-08", 30_000_000), mt("cs2", "2026-08", 20_000_000)];

  it("hai cơ sở cùng kỳ → CỘNG 50tr, không phải 20tr của dòng cuối", () => {
    const s = buildRangeTarget(rows, {
      fromKey: "2026-08-01",
      toKey: "2026-08-31",
      mode: CENTERS,
    });
    expect(s.totalTarget).toBe(50_000_000);
    expect(s.periods[0]!.target).toBe(50_000_000);
    expect(s.periods[0]!.centerCount).toBe(2);
    expect(s.periods[0]!.source).toBe("CENTERS");
  });

  it("ba cơ sở → cộng cả ba", () => {
    const s = buildRangeTarget(
      [...rows, mt("cs3", "2026-08", 10_000_000)],
      {
        fromKey: "2026-08-01",
        toKey: "2026-08-31",
        mode: { kind: "CENTERS", centerIds: ["cs1", "cs2", "cs3"] },
      },
    );
    expect(s.totalTarget).toBe(60_000_000);
  });

  it("cơ sở NGOÀI danh sách đang chọn không được cộng vào", () => {
    const s = buildRangeTarget(
      [...rows, mt("cs9", "2026-08", 999_000_000)],
      { fromKey: "2026-08-01", toKey: "2026-08-31", mode: CENTERS },
    );
    expect(s.totalTarget).toBe(50_000_000);
  });

  it("chế độ CENTERS KHÔNG bao giờ lấy dòng mục tiêu toàn hệ thống", () => {
    const s = buildRangeTarget(
      [...rows, mt(null, "2026-08", 500_000_000)],
      { fromKey: "2026-08-01", toKey: "2026-08-31", mode: CENTERS },
    );
    expect(s.totalTarget).toBe(50_000_000);
  });

  it("nhiều tháng → tổng là tổng của mọi tháng chạm khoảng", () => {
    const s = buildRangeTarget(
      [
        mt("cs1", "2026-08", 30_000_000),
        mt("cs2", "2026-08", 20_000_000),
        mt("cs1", "2026-09", 40_000_000),
        mt("cs2", "2026-09", 10_000_000),
      ],
      { fromKey: "2026-08-15", toKey: "2026-09-10", mode: CENTERS },
    );
    expect(s.totalTarget).toBe(100_000_000);
    expect(s.periods.map((p) => p.period)).toEqual(["2026-08", "2026-09"]);
    // Bất biến: tổng LUÔN bằng tổng các kỳ đã đặt — không có đường nào lệch.
    expect(s.totalTarget).toBe(
      s.periods.reduce((acc, p) => acc + (p.target ?? 0), 0),
    );
  });
});

describe("[B-02-T5] 🔴 không đếm đôi mục tiêu công ty + mục tiêu cơ sở", () => {
  it("SYSTEM + CÓ dòng toàn hệ thống → chỉ dùng dòng đó", () => {
    const s = buildRangeTarget(
      [
        mt(null, "2026-08", 100_000_000),
        mt("cs1", "2026-08", 30_000_000),
        mt("cs2", "2026-08", 20_000_000),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-31", mode: SYSTEM },
    );
    expect(s.totalTarget).toBe(100_000_000);
    expect(s.periods[0]!.source).toBe("SYSTEM");
  });

  it("SYSTEM + KHÔNG có dòng toàn hệ thống → cộng mục tiêu các cơ sở (phần vá lỗi)", () => {
    const s = buildRangeTarget(
      [mt("cs1", "2026-08", 30_000_000), mt("cs2", "2026-08", 20_000_000)],
      { fromKey: "2026-08-01", toKey: "2026-08-31", mode: SYSTEM },
    );
    expect(s.totalTarget).toBe(50_000_000);
    expect(s.periods[0]!.source).toBe("CENTERS");
  });

  it("SYSTEM, hai kỳ khác luật nhau → quyết định TỪNG KỲ, không quyết một lần cho cả khoảng", () => {
    const s = buildRangeTarget(
      [
        mt(null, "2026-08", 100_000_000), // tháng 8 có mục tiêu công ty
        mt("cs1", "2026-08", 30_000_000),
        mt("cs1", "2026-09", 40_000_000), // tháng 9 chỉ có mục tiêu cơ sở
        mt("cs2", "2026-09", 10_000_000),
      ],
      { fromKey: "2026-08-15", toKey: "2026-09-10", mode: SYSTEM },
    );
    expect(s.periods.map((p) => [p.period, p.target, p.source])).toEqual([
      ["2026-08", 100_000_000, "SYSTEM"],
      ["2026-09", 50_000_000, "CENTERS"],
    ]);
    expect(s.totalTarget).toBe(150_000_000);
  });
});

describe("[B-02-T6] 🔴 chưa đặt mục tiêu ⇒ 'chưa đặt', KHÔNG phải 0", () => {
  it("không kỳ nào có mục tiêu → totalTarget null, tỷ lệ null, lý do CHUA_DAT", () => {
    const s = buildRangeTarget([], {
      fromKey: "2026-08-01",
      toKey: "2026-08-31",
      mode: CENTERS,
    });
    expect(s.totalTarget).toBeNull();
    expect(s.periodsMissingTarget).toEqual(["2026-08"]);
    expect(s.fullyTargeted).toBe(false);

    const card = buildRevenueTargetCard(s, 12_000_000);
    expect(card.totalTarget).toBeNull();
    expect(card.achievedRate).toBeNull();
    expect(card.rateBlocked).toBe("CHUA_DAT");
    // Con số 0 không được len vào bất cứ đâu: 0 đọc thành "mục tiêu bằng không".
    expect(card.totalTarget).not.toBe(0);
  });

  it("mục tiêu đặt = 0 → không chia cho 0, ra lý do riêng chứ không phải Infinity", () => {
    const s = buildRangeTarget([mt("cs1", "2026-08", 0)], {
      fromKey: "2026-08-01",
      toKey: "2026-08-31",
      mode: CENTERS,
    });
    const card = buildRevenueTargetCard(s, 12_000_000);
    expect(card.totalTarget).toBe(0);
    expect(card.achievedRate).toBeNull();
    expect(card.rateBlocked).toBe("MUC_TIEU_KHONG_DUONG");
    expect(Number.isFinite(card.achievedRate ?? 0)).toBe(true);
  });

  it("🔴 một trong hai tháng CHƯA đặt → KHÔNG in tỷ lệ (doanh thu 2 tháng / mục tiêu 1 tháng = cao giả)", () => {
    const s = buildRangeTarget([mt("cs1", "2026-08", 30_000_000)], {
      fromKey: "2026-08-15",
      toKey: "2026-09-10",
      mode: CENTERS,
    });
    expect(s.totalTarget).toBe(30_000_000);
    expect(s.periodsWithTarget).toEqual(["2026-08"]);
    expect(s.periodsMissingTarget).toEqual(["2026-09"]);
    expect(s.fullyTargeted).toBe(false);

    const card = buildRevenueTargetCard(s, 45_000_000);
    expect(card.rateBlocked).toBe("THIEU_THANG");
    expect(card.achievedRate).toBeNull();
    expect(card.progressRate).toBeNull();
  });
});

describe("[B-02-T7] 🔴 khoảng cắt ngang tháng: mục tiêu là TRỌN THÁNG, tiến độ là số RIÊNG", () => {
  const rows = [mt("cs1", "2026-08", 30_000_000), mt("cs1", "2026-09", 30_000_000)];

  it("trọn tháng → coverage = 1, không có số 'so với tiến độ' để khỏi nhiễu", () => {
    const s = buildRangeTarget([mt("cs1", "2026-08", 30_000_000)], {
      fromKey: "2026-08-01",
      toKey: "2026-08-31",
      mode: CENTERS,
    });
    expect(s.partialMonths).toBe(false);
    expect(s.coverage).toBe(1);

    const card = buildRevenueTargetCard(s, 15_000_000);
    expect(card.achievedRate).toBeCloseTo(0.5, 6);
    expect(card.progressRate).toBeNull();
  });

  it("15/08 → 10/09: mục tiêu KHÔNG bị chia theo ngày — vẫn là 60tr trọn hai tháng", () => {
    const s = buildRangeTarget(rows, {
      fromKey: "2026-08-15",
      toKey: "2026-09-10",
      mode: CENTERS,
    });
    expect(s.totalTarget).toBe(60_000_000); // KHÔNG phải 60tr × 27/61
    expect(s.partialMonths).toBe(true);
    expect(s.daysInRange).toBe(27); // 17 (tháng 8) + 10 (tháng 9)
    expect(s.daysInMonths).toBe(61); // 31 + 30
    expect(s.coverage).toBeCloseTo(27 / 61, 6);
  });

  it("tỷ lệ THÔ giữ nguyên phép chia thật; 'so với tiến độ' là con số thứ hai, có nhãn", () => {
    const s = buildRangeTarget(rows, {
      fromKey: "2026-08-15",
      toKey: "2026-09-10",
      mode: CENTERS,
    });
    const card = buildRevenueTargetCard(s, 30_000_000);
    expect(card.achievedRate).toBeCloseTo(0.5, 6); // 30tr / 60tr trọn tháng
    expect(card.progressRate).toBeCloseTo(0.5 / (27 / 61), 6);
    // Hai con số PHẢI khác nhau khi khoảng bị cắt — nếu bằng nhau tức là đã lặng lẽ
    // chia tỷ lệ mục tiêu, đúng thứ đề bài cấm.
    expect(card.progressRate).not.toBeCloseTo(card.achievedRate!, 6);
  });

  it("số ngày trong khoảng luôn bằng tổng phần góp của từng tháng (bất biến)", () => {
    const s = buildRangeTarget(rows, {
      fromKey: "2026-08-15",
      toKey: "2026-09-10",
      mode: CENTERS,
    });
    expect(s.daysInRange).toBe(s.periods.reduce((a, p) => a + p.daysInRange, 0));
    expect(s.daysInMonths).toBe(s.periods.reduce((a, p) => a + p.daysInMonth, 0));
  });
});

describe("[B-02-T8] con số mục tiêu tự khai nguồn gốc (thứ màn hình in ra dưới ô Mục tiêu)", () => {
  it("cộng từ 2 cơ sở → contributingCenters = 2, không mượn dòng toàn hệ thống", () => {
    const s = buildRangeTarget(
      [mt("cs1", "2026-08", 30_000_000), mt("cs2", "2026-08", 20_000_000)],
      { fromKey: "2026-08-01", toKey: "2026-08-31", mode: CENTERS },
    );
    expect(s.contributingCenters).toBe(2);
    expect(s.usesSystemTarget).toBe(false);
  });

  it("đếm SỐ CƠ SỞ KHÁC NHAU trên cả khoảng, không phải max theo từng kỳ", () => {
    const s = buildRangeTarget(
      [
        mt("cs1", "2026-08", 30_000_000), // tháng 8 chỉ CS1 đặt
        mt("cs2", "2026-09", 20_000_000), // tháng 9 chỉ CS2 đặt
      ],
      { fromKey: "2026-08-15", toKey: "2026-09-10", mode: CENTERS },
    );
    expect(s.periods.map((p) => p.centerCount)).toEqual([1, 1]);
    expect(s.contributingCenters).toBe(2); // tổng cộng có 2 cơ sở góp tiền vào ô Mục tiêu
  });

  it("dùng dòng toàn hệ thống → usesSystemTarget = true, không đếm cơ sở nào", () => {
    const s = buildRangeTarget(
      [mt(null, "2026-08", 100_000_000), mt("cs1", "2026-08", 30_000_000)],
      { fromKey: "2026-08-01", toKey: "2026-08-31", mode: SYSTEM },
    );
    expect(s.usesSystemTarget).toBe(true);
    expect(s.contributingCenters).toBe(0);
  });

  it("chưa đặt gì → không cơ sở nào góp, không dòng toàn hệ thống nào", () => {
    const s = buildRangeTarget([], {
      fromKey: "2026-08-01",
      toKey: "2026-08-31",
      mode: CENTERS,
    });
    expect(s.contributingCenters).toBe(0);
    expect(s.usesSystemTarget).toBe(false);
  });
});

describe("[B-02-T9] formatPeriodVN — nhãn kỳ đọc được, không lộ dạng máy", () => {
  it("'2026-08' → '08/2026'", () => {
    expect(formatPeriodVN("2026-08")).toBe("08/2026");
  });
});
