// B-04 — doanh thu chi tiết theo NGÀY. Bộ test này canh đúng bốn thứ hỏng CÂM, tức
// hỏng mà màn hình vẫn vẽ ra một biểu đồ đẹp và không ai nghi ngờ:
//
//  1. NGÀY TRỐNG BỊ RỤNG DÒNG → đường biểu đồ nối thẳng qua Chủ nhật/ngày nghỉ, trông
//     như doanh thu chảy đều. Range N ngày phải ra ĐÚNG N điểm.
//  2. GOM THEO NGÀY UTC → mọi giao dịch 00:00–07:00 giờ VN rơi về hôm trước, và tiền
//     của đêm muộn nhảy sang hôm sau. Mốc ngày phải là ngày lịch VIỆT NAM.
//  3. CÔNG THỨC THỰC THU BỊ VIẾT LẠI → hoàn tiền không trừ ra, bản gốc đã bị điều
//     chỉnh vẫn được cộng ⇒ tab Tài chính lệch chính nó ở chỗ khác. Phải đi qua đúng
//     `butToanThucThu` của `lib/finance/thuc-thu.ts`, KHÔNG có công thức thứ hai.
//  4. TÁCH THEO CƠ SỞ LÀM MẤT TIỀN → tổng các cột cơ sở phải bằng đúng cột tổng của
//     cùng ngày, và cơ sở không phát sinh vẫn phải có ô 0 (không nhảy số cột).
import { describe, it, expect } from "vitest";
import {
  DAILY_REVENUE_MAX_DAYS,
  buildDailyRevenue,
  dayKeysInRange,
  trimDayRange,
  type DailyRevenueScanRow,
} from "./revenue-daily";

let seq = 0;

/** Bút toán mẫu. `paidDate` nhận CHUỖI ISO có offset để test nói rõ nó là giờ nào. */
function bt(paidDateIso: string, over: Partial<DailyRevenueScanRow> = {}): DailyRevenueScanRow {
  seq += 1;
  return {
    id: `p${seq}`,
    amount: 1_000_000,
    accountantStatus: "CONFIRMED",
    adjustmentOfId: null,
    centerId: "cs1",
    paidDate: new Date(paidDateIso),
    ...over,
  };
}

const GOP = { centerIds: ["cs1"], groupByCenter: false } as const;

describe("[B-04] dayKeysInRange — trục ngày không được thủng", () => {
  it("range 7 ngày trả đúng 7 khoá ngày, hai đầu đều nằm trong", () => {
    const keys = dayKeysInRange("2026-08-01", "2026-08-07");
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-08-01");
    expect(keys[6]).toBe("2026-08-07");
  });

  it("một ngày duy nhất vẫn ra một điểm (không phải rỗng)", () => {
    expect(dayKeysInRange("2026-08-15", "2026-08-15")).toEqual(["2026-08-15"]);
  });

  it("bắc cầu qua giao thừa: 30/12 → 02/01 ra 4 ngày liên tiếp", () => {
    expect(dayKeysInRange("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("bắc cầu 29/02 năm nhuận — không nhảy cóc", () => {
    expect(dayKeysInRange("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });
});

describe("[B-04] trimDayRange — chặn khoảng dài vô hạn, và NÓI RA", () => {
  it("khoảng trong trần thì giữ nguyên, không báo cắt", () => {
    const r = trimDayRange("2026-08-01", "2026-08-31");
    expect(r).toEqual({ fromKey: "2026-08-01", toKey: "2026-08-31", trimmed: false });
  });

  it("khoảng vượt trần: giữ phần GẦN NHẤT, đúng trần ngày, và bật cờ trimmed", () => {
    // `?dateFrom=1900-01-01` gõ tay là ~46.000 ngày — vẽ hết là treo trang.
    const r = trimDayRange("1900-01-01", "2026-08-25");
    expect(r.trimmed).toBe(true);
    expect(r.toKey).toBe("2026-08-25");
    expect(dayKeysInRange(r.fromKey, r.toKey)).toHaveLength(DAILY_REVENUE_MAX_DAYS);
  });
});

describe("[B-04] buildDailyRevenue — ngày trống ra 0, KHÔNG biến mất", () => {
  it("range 7 ngày · 2 ngày có giao dịch ⇒ 7 điểm, 5 điểm giá trị 0", () => {
    const points = buildDailyRevenue(
      [
        bt("2026-08-02T10:00:00+07:00", { amount: 3_000_000 }),
        bt("2026-08-05T10:00:00+07:00", { amount: 4_000_000 }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-07", ...GOP },
    );
    expect(points).toHaveLength(7);
    expect(points.map((p) => p.day)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    expect(points.map((p) => p.revenue)).toEqual([0, 3_000_000, 0, 0, 4_000_000, 0, 0]);
    expect(points.filter((p) => p.revenue === 0)).toHaveLength(5);
  });

  it("không có bút toán nào vẫn trả đủ dòng 0 — bảng rỗng khác biểu đồ rỗng", () => {
    const points = buildDailyRevenue([], {
      fromKey: "2026-08-01",
      toKey: "2026-08-03",
      ...GOP,
    });
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.revenue === 0 && p.txnCount === 0)).toBe(true);
  });

  it("bút toán NGOÀI khoảng lọc không được lén vào điểm nào", () => {
    const points = buildDailyRevenue(
      [
        bt("2026-07-31T23:59:00+07:00", { amount: 9_000_000 }),
        bt("2026-08-08T00:01:00+07:00", { amount: 8_000_000 }),
        bt("2026-08-02T09:00:00+07:00", { amount: 1_000_000 }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-07", ...GOP },
    );
    expect(points.reduce((s, p) => s + p.revenue, 0)).toBe(1_000_000);
  });
});

describe("[B-04] mốc ngày là ngày lịch VIỆT NAM, không phải UTC", () => {
  it("23:30 giờ VN ngày 15 thuộc NGÀY 15 (UTC đang là 16:30 ngày 15 — cùng ngày, dễ lọt)", () => {
    const points = buildDailyRevenue([bt("2026-08-15T23:30:00+07:00", { amount: 2_000_000 })], {
      fromKey: "2026-08-15",
      toKey: "2026-08-16",
      ...GOP,
    });
    expect(points[0]!.revenue).toBe(2_000_000);
    expect(points[1]!.revenue).toBe(0);
  });

  it("🔴 00:30 giờ VN ngày 15 thuộc NGÀY 15, không phải ngày 14 (UTC là 17:30 ngày 14)", () => {
    const points = buildDailyRevenue([bt("2026-08-15T00:30:00+07:00", { amount: 5_000_000 })], {
      fromKey: "2026-08-14",
      toKey: "2026-08-15",
      ...GOP,
    });
    expect(points[0]!.day).toBe("2026-08-14");
    expect(points[0]!.revenue).toBe(0);
    expect(points[1]!.revenue).toBe(5_000_000);
  });

  it("🔴 06:00 giờ VN ngày 15 vẫn là NGÀY 15 — cả cụm 00:00–07:00 giờ VN là chỗ lệch", () => {
    const points = buildDailyRevenue([bt("2026-08-15T06:00:00+07:00")], {
      fromKey: "2026-08-15",
      toKey: "2026-08-15",
      ...GOP,
    });
    expect(points[0]!.revenue).toBe(1_000_000);
  });

  it("nửa đêm đúng 00:00 giờ VN ngày 01 thuộc ngày 01 (cận dưới của khoảng)", () => {
    const points = buildDailyRevenue([bt("2026-08-01T00:00:00+07:00")], {
      fromKey: "2026-08-01",
      toKey: "2026-08-02",
      ...GOP,
    });
    expect(points[0]!.revenue).toBe(1_000_000);
  });
});

describe("[B-04] dùng ĐÚNG công thức thực thu — không viết công thức thứ hai", () => {
  it("hoàn tiền là bút toán ÂM ⇒ ngày hoàn có thể ÂM, và vẫn phải hiện", () => {
    const points = buildDailyRevenue(
      [
        bt("2026-08-01T10:00:00+07:00", { amount: 5_000_000 }),
        bt("2026-08-03T10:00:00+07:00", {
          amount: -5_000_000,
          accountantStatus: "REFUNDED",
          adjustmentOfId: "p-goc",
        }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-03", ...GOP },
    );
    expect(points.map((p) => p.revenue)).toEqual([5_000_000, 0, -5_000_000]);
    // Tổng kỳ về 0 — hoàn tiền trừ đúng, chỉ rơi vào NGÀY HOÀN chứ không lùi về ngày thu.
    expect(points.reduce((s, p) => s + p.revenue, 0)).toBe(0);
  });

  it("PENDING / REJECTED không phải tiền thật ⇒ ngày đó vẫn là 0", () => {
    const points = buildDailyRevenue(
      [
        bt("2026-08-01T10:00:00+07:00", { accountantStatus: "PENDING" }),
        bt("2026-08-01T11:00:00+07:00", { accountantStatus: "REJECTED" }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-01", ...GOP },
    );
    expect(points[0]!.revenue).toBe(0);
    expect(points[0]!.txnCount).toBe(0);
  });

  it("điều chỉnh ở NGÀY KHÁC: delta rơi vào ngày của NÓ, gốc giữ nguyên ngày của gốc", () => {
    // 🔴 Đổi 16/09/2026 khi hợp nhất `main`. Mô hình cũ ("bản mới THAY THẾ bản gốc")
    // buộc phải lọc trên TOÀN mảng trước khi chia ngày, không thì bản gốc nằm một mình
    // trong ngày của nó và sống sót. Mô hình DELTA bỏ hẳn nỗi lo đó: không loại bản nào,
    // mỗi dòng rơi vào ngày của chính nó, và TỔNG mới là con số đúng.
    //
    // Hệ quả phải nhớ khi đọc biểu đồ: một lượt sửa tiền làm ngày CŨ giữ số cũ và ngày
    // SỬA mang phần chênh — chứ không dời cả khoản sang ngày sửa.
    const points = buildDailyRevenue(
      [
        bt("2026-08-01T10:00:00+07:00", { id: "goc", amount: 9_000_000 }),
        bt("2026-08-04T10:00:00+07:00", {
          id: "sua",
          amount: -2_000_000,
          adjustmentOfId: "goc",
        }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-04", ...GOP },
    );
    expect(points.map((p) => p.revenue)).toEqual([9_000_000, 0, 0, -2_000_000]);
    expect(points.reduce((s, p) => s + p.revenue, 0)).toBe(7_000_000);
  });

  it("txnCount đếm bút toán ĐƯỢC TÍNH, không đếm bản đã bị loại", () => {
    const points = buildDailyRevenue(
      [
        bt("2026-08-01T08:00:00+07:00"),
        bt("2026-08-01T09:00:00+07:00"),
        bt("2026-08-01T10:00:00+07:00", { accountantStatus: "PENDING" }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-01", ...GOP },
    );
    expect(points[0]!.txnCount).toBe(2);
    expect(points[0]!.revenue).toBe(2_000_000);
  });
});

describe("[B-04] tách theo cơ sở — tổng cột con phải bằng cột tổng", () => {
  const TACH = { centerIds: ["cs1", "cs2"], groupByCenter: true } as const;

  it("mỗi ngày có ô của MỌI cơ sở đang chọn, cơ sở không phát sinh là 0", () => {
    const points = buildDailyRevenue(
      [bt("2026-08-02T10:00:00+07:00", { centerId: "cs1", amount: 3_000_000 })],
      { fromKey: "2026-08-01", toKey: "2026-08-02", ...TACH },
    );
    expect(points[0]!.byCenter).toEqual({ cs1: 0, cs2: 0 });
    expect(points[1]!.byCenter).toEqual({ cs1: 3_000_000, cs2: 0 });
  });

  it("tổng các cơ sở của một ngày = doanh thu của ngày đó (không rơi mất đồng nào)", () => {
    const points = buildDailyRevenue(
      [
        bt("2026-08-01T10:00:00+07:00", { centerId: "cs1", amount: 3_000_000 }),
        bt("2026-08-01T11:00:00+07:00", { centerId: "cs2", amount: 4_000_000 }),
        bt("2026-08-01T12:00:00+07:00", {
          centerId: "cs2",
          amount: -1_000_000,
          accountantStatus: "REFUNDED",
          adjustmentOfId: "x",
        }),
      ],
      { fromKey: "2026-08-01", toKey: "2026-08-01", ...TACH },
    );
    const p = points[0]!;
    expect(p.revenue).toBe(6_000_000);
    expect(p.byCenter).toEqual({ cs1: 3_000_000, cs2: 3_000_000 });
    const sum = Object.values(p.byCenter!).reduce((s, v) => s + v, 0);
    expect(sum).toBe(p.revenue);
  });

  it("tắt công tắc tách ⇒ byCenter là null, không phải object rỗng gây hiểu nhầm", () => {
    const points = buildDailyRevenue([bt("2026-08-01T10:00:00+07:00")], {
      fromKey: "2026-08-01",
      toKey: "2026-08-01",
      ...GOP,
    });
    expect(points[0]!.byCenter).toBeNull();
  });

  it("bút toán của cơ sở NGOÀI danh sách chọn vẫn vào tổng ngày nhưng không tạo cột lạ", () => {
    // Truy vấn đã lọc `centerId IN centerIds` nên ca này không xảy ra trên đường chạy
    // thật; khoá hành vi ở đây để một lần đổi truy vấn sau này không âm thầm sinh cột.
    const points = buildDailyRevenue(
      [bt("2026-08-01T10:00:00+07:00", { centerId: "cs9", amount: 2_000_000 })],
      { fromKey: "2026-08-01", toKey: "2026-08-01", ...TACH },
    );
    expect(points[0]!.revenue).toBe(2_000_000);
    expect(points[0]!.byCenter).toEqual({ cs1: 0, cs2: 0 });
  });
});
