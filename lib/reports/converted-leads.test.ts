// C-03 — bảng "Lead đã chuyển đổi" (9 cột, MỘT DÒNG MỘT HỌC SINH).
//
// Bộ test này canh bốn thứ hỏng CÂM — loại sai vẫn ra một bảng trông hợp lý:
//  1. tiền của từng dòng phải là THỰC THU đã bổ dọc về con (`lib/reports/revenue-by-child`),
//     không phải giá trị hợp đồng;
//  2. phần chưa quy được về con KHÔNG BAO GIỜ bị bỏ — nếu bỏ, tổng bảng này thấp hơn tab
//     Tài chính trên CÙNG màn hình mà không ai giải thích được;
//  3. phần thực thu của con chốt ở KỲ KHÁC cũng phải hiện ra, vì nó cũng nằm trong tổng
//     của tab Tài chính nhưng không có dòng nào trong bảng này mang nó;
//  4. tên phụ huynh / tên học sinh phải đi qua tầng che PII — "báo cáo nội bộ" không phải
//     lý do đọc cột thô.
import { describe, it, expect } from "vitest";
import {
  buildConvertedLeadCenterWhere,
  buildConvertedLeadRows,
  reconcileConvertedRevenue,
  formatDaysToClose,
  formatRevenueShare,
  type ConvertedLeadChildInput,
} from "./converted-leads";

const D = (s: string) => new Date(s);

let seq = 0;
function con(over: Partial<ConvertedLeadChildInput> = {}): ConvertedLeadChildInput {
  seq += 1;
  return {
    leadChildId: `c${seq}`,
    leadId: `lead-${seq}`,
    childName: "Nguyễn Văn An",
    parentName: "Nguyễn Thị Lan",
    courseName: "Lập trình Robot",
    centerId: "cs1",
    assignedToName: "Trần Sale",
    enteredAt: D("2026-08-01T03:00:00.000Z"),
    closedAt: D("2026-08-11T03:00:00.000Z"),
    ...over,
  };
}

describe("[C-03] buildConvertedLeadRows — tiền của từng dòng lấy từ hàm doanh thu đã có", () => {
  it("gắn đúng khoản thực thu đã bổ dọc theo con", () => {
    const rows = buildConvertedLeadRows({
      children: [con({ leadChildId: "c1" }), con({ leadChildId: "c2" })],
      revenueByChild: new Map([
        ["c1", 3_000_000],
        ["c2", 5_000_000],
      ]),
      totalRevenue: 10_000_000,
      canViewPii: true,
    });
    expect(rows.find((r) => r.leadChildId === "c1")?.revenue).toBe(3_000_000);
    expect(rows.find((r) => r.leadChildId === "c2")?.revenue).toBe(5_000_000);
  });

  it("con ĐÃ CHỐT nhưng chưa có khoản nào rơi vào kỳ ⇒ revenue = 0, KHÔNG bỏ dòng", () => {
    // Ca thật: chốt ngày 30, tiền về ngày 02 tháng sau. Bỏ dòng đi là bảng "lead đã
    // chuyển đổi" thiếu đúng người vừa chốt.
    const rows = buildConvertedLeadRows({
      children: [con({ leadChildId: "c9" })],
      revenueByChild: new Map(),
      totalRevenue: 10_000_000,
      canViewPii: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revenue).toBe(0);
  });

  it("không có quyền xem tiền ⇒ revenue và tỷ lệ đều null (không phải 0)", () => {
    // 0 đọc thành "đã thu 0 đồng" — một khẳng định sai. null đọc thành "không hiện".
    const rows = buildConvertedLeadRows({
      children: [con()],
      revenueByChild: null,
      totalRevenue: 0,
      canViewPii: true,
    });
    expect(rows[0]!.revenue).toBeNull();
    expect(rows[0]!.revenueShare).toBeNull();
  });

  it("% trên tổng doanh thu lấy MẪU SỐ là tổng thực thu cùng kỳ + cùng phạm vi", () => {
    const rows = buildConvertedLeadRows({
      children: [con({ leadChildId: "c1" })],
      revenueByChild: new Map([["c1", 2_500_000]]),
      totalRevenue: 10_000_000,
      canViewPii: true,
    });
    expect(rows[0]!.revenueShare).toBeCloseTo(0.25, 6);
  });

  it("mẫu số 0 ⇒ tỷ lệ null, KHÔNG chia cho 0", () => {
    const rows = buildConvertedLeadRows({
      children: [con({ leadChildId: "c1" })],
      revenueByChild: new Map([["c1", 0]]),
      totalRevenue: 0,
      canViewPii: true,
    });
    expect(rows[0]!.revenueShare).toBeNull();
    expect(Number.isNaN(rows[0]!.revenueShare as unknown as number)).toBe(false);
  });
});

describe("[C-03] buildConvertedLeadRows — thời gian chốt", () => {
  it("chốt − vào hệ thống, tính bằng ngày thực", () => {
    const rows = buildConvertedLeadRows({
      children: [
        con({
          enteredAt: D("2026-08-01T00:00:00.000Z"),
          closedAt: D("2026-08-11T12:00:00.000Z"),
        }),
      ],
      revenueByChild: new Map(),
      totalRevenue: 0,
      canViewPii: true,
    });
    expect(rows[0]!.daysToClose).toBeCloseTo(10.5, 6);
  });

  it("chốt TRƯỚC khi vào hệ thống ⇒ daysToClose = null (dữ liệu bẩn), dòng vẫn còn", () => {
    // Im lặng bỏ dòng là giấu mất một thương vụ có tiền thật; im lặng hiện "-3 ngày" là
    // để người đọc tưởng hệ thống tính sai. Giữ dòng + đánh dấu bẩn.
    const rows = buildConvertedLeadRows({
      children: [
        con({
          enteredAt: D("2026-08-11T00:00:00.000Z"),
          closedAt: D("2026-08-01T00:00:00.000Z"),
        }),
      ],
      revenueByChild: new Map(),
      totalRevenue: 0,
      canViewPii: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.daysToClose).toBeNull();
  });

  it("xếp theo thời điểm chốt mới nhất trước", () => {
    const rows = buildConvertedLeadRows({
      children: [
        con({ leadChildId: "cu", closedAt: D("2026-08-02T00:00:00.000Z") }),
        con({ leadChildId: "moi", closedAt: D("2026-08-20T00:00:00.000Z") }),
      ],
      revenueByChild: new Map(),
      totalRevenue: 0,
      canViewPii: true,
    });
    expect(rows.map((r) => r.leadChildId)).toEqual(["moi", "cu"]);
  });
});

describe("[C-03] buildConvertedLeadRows — một PH hai con là HAI dòng", () => {
  it("giữ đủ hai dòng, cùng leadId, tiền tách theo từng con", () => {
    const rows = buildConvertedLeadRows({
      children: [
        con({ leadChildId: "a", leadId: "L1", childName: "An", closedAt: D("2026-08-05T00:00:00.000Z") }),
        con({ leadChildId: "b", leadId: "L1", childName: "Bình", closedAt: D("2026-08-06T00:00:00.000Z") }),
      ],
      revenueByChild: new Map([
        ["a", 4_000_000],
        ["b", 6_000_000],
      ]),
      totalRevenue: 10_000_000,
      canViewPii: true,
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.leadId))).toEqual(new Set(["L1"]));
    expect(rows.reduce((s, r) => s + (r.revenue ?? 0), 0)).toBe(10_000_000);
  });
});

describe("[C-03] buildConvertedLeadRows — che PII", () => {
  it("không có quyền xem PII ⇒ tên PH và tên học sinh đều bị che", () => {
    const rows = buildConvertedLeadRows({
      children: [con({ childName: "Nguyễn Văn An", parentName: "Nguyễn Thị Lan" })],
      revenueByChild: new Map(),
      totalRevenue: 0,
      canViewPii: false,
    });
    expect(rows[0]!.childName).not.toContain("Văn");
    expect(rows[0]!.parentName).not.toContain("Thị");
    expect(rows[0]!.parentName.startsWith("Nguyễn")).toBe(true);
  });

  it("có quyền ⇒ giữ nguyên tên", () => {
    const rows = buildConvertedLeadRows({
      children: [con({ childName: "Nguyễn Văn An", parentName: "Nguyễn Thị Lan" })],
      revenueByChild: new Map(),
      totalRevenue: 0,
      canViewPii: true,
    });
    expect(rows[0]!.childName).toBe("Nguyễn Văn An");
    expect(rows[0]!.parentName).toBe("Nguyễn Thị Lan");
  });
});

describe("[C-03] reconcileConvertedRevenue — tổng bảng phải khớp tab Tài chính", () => {
  it("ba mảnh cộng lại đúng bằng tổng thực thu của kỳ", () => {
    const rows = buildConvertedLeadRows({
      children: [con({ leadChildId: "c1" }), con({ leadChildId: "c2" })],
      revenueByChild: new Map([
        ["c1", 3_000_000],
        ["c2", 2_000_000],
      ]),
      totalRevenue: 10_000_000,
      canViewPii: true,
    });
    const rc = reconcileConvertedRevenue({
      rows,
      totalRevenue: 10_000_000,
      unassignedRevenue: 1_000_000,
    });
    expect(rc.rowsRevenue).toBe(5_000_000);
    expect(rc.unassignedRevenue).toBe(1_000_000);
    // 10tr − 5tr (bảng) − 1tr (chưa quy được) = 4tr của con chốt ở kỳ khác / chưa chốt.
    expect(rc.otherChildRevenue).toBe(4_000_000);
    expect(rc.rowsRevenue + rc.otherChildRevenue + rc.unassignedRevenue).toBe(
      rc.totalRevenue,
    );
  });

  it("khoản chưa quy được về con KHÔNG bị nuốt kể cả khi bảng rỗng", () => {
    const rc = reconcileConvertedRevenue({
      rows: [],
      totalRevenue: 8_000_000,
      unassignedRevenue: 8_000_000,
    });
    expect(rc.rowsRevenue).toBe(0);
    expect(rc.unassignedRevenue).toBe(8_000_000);
    expect(rc.otherChildRevenue).toBe(0);
    expect(rc.totalRevenue).toBe(8_000_000);
  });

  it("quét bút toán bị cắt ⇒ phần dôi dồn vào 'kỳ khác', KHÔNG ra số âm", () => {
    // Khi `getRevenueByLeadChild` cắt ở trần quét, tiền của từng dòng bị THIẾU nhưng
    // tổng vẫn đúng (đi đường aggregate). Phép trừ phải chịu được ca đó.
    const rows = buildConvertedLeadRows({
      children: [con({ leadChildId: "c1" })],
      revenueByChild: new Map([["c1", 20_000_000]]),
      totalRevenue: 5_000_000,
      canViewPii: true,
    });
    const rc = reconcileConvertedRevenue({
      rows,
      totalRevenue: 5_000_000,
      unassignedRevenue: 0,
    });
    expect(rc.otherChildRevenue).toBe(0);
    expect(rc.otherChildRevenue).toBeGreaterThanOrEqual(0);
  });

  it("không có quyền xem tiền ⇒ mọi mảnh về 0, không rò tổng qua phép trừ", () => {
    const rows = buildConvertedLeadRows({
      children: [con()],
      revenueByChild: null,
      totalRevenue: 0,
      canViewPii: true,
    });
    const rc = reconcileConvertedRevenue({ rows, totalRevenue: 0, unassignedRevenue: 0 });
    expect(rc.rowsRevenue).toBe(0);
    expect(rc.totalRevenue).toBe(0);
  });
});

describe("[C-03] buildConvertedLeadCenterWhere — cách ly cơ sở (không có lưới an toàn thứ hai)", () => {
  it("chọn cụ thể vài cơ sở ⇒ CHỈ các cơ sở đó, không kèm nhánh chưa gán", () => {
    const w = buildConvertedLeadCenterWhere({
      centerIds: ["cs1", "cs2"],
      isAllCenters: false,
      canSeeUnassigned: true,
    });
    expect(w).toEqual({ centerId: { in: ["cs1", "cs2"] } });
  });

  it("🔒 quản lý cơ sở bấm 'Tất cả cơ sở' KHÔNG được thấy phiếu chưa gán cơ sở", () => {
    // `LeadChild` không thuộc SCOPED_MODELS ⇒ `scopedDb` là pass-through cho truy vấn
    // này. Mở nhánh `centerId: null` ở đây là rò chéo cơ sở ở đúng bảng doanh số.
    const w = buildConvertedLeadCenterWhere({
      centerIds: ["cs1"],
      isAllCenters: true,
      canSeeUnassigned: false,
    });
    expect(w).toEqual({ centerId: { in: ["cs1"] } });
    expect(JSON.stringify(w)).not.toContain("OR");
  });

  it("người có tầm nhìn toàn hệ thống + 'Tất cả cơ sở' ⇒ gộp cả phiếu chưa gán", () => {
    const w = buildConvertedLeadCenterWhere({
      centerIds: ["cs1", "cs2"],
      isAllCenters: true,
      canSeeUnassigned: true,
    });
    expect(w).toEqual({
      OR: [{ centerId: { in: ["cs1", "cs2"] } }, { centerId: null }],
    });
  });

  it("không mượn mảng gốc của bộ lọc (tránh sửa ngầm `filters.centerIds`)", () => {
    const goc = ["cs1"];
    const w = buildConvertedLeadCenterWhere({
      centerIds: goc,
      isAllCenters: false,
      canSeeUnassigned: false,
    });
    expect((w as { centerId: { in: string[] } }).centerId.in).not.toBe(goc);
  });
});

describe("[C-03] nhãn hiển thị", () => {
  it("formatDaysToClose: dưới 1 ngày nói 'chưa tới 1 ngày', không làm tròn thành 0", () => {
    expect(formatDaysToClose(0)).toBe("< 1 ngày");
    expect(formatDaysToClose(0.4)).toBe("< 1 ngày");
    expect(formatDaysToClose(0.99)).toBe("< 1 ngày");
  });

  it("formatDaysToClose: từ 1 ngày trở lên dùng dấu phẩy thập phân kiểu VN", () => {
    expect(formatDaysToClose(1)).toBe("1,0 ngày");
    expect(formatDaysToClose(10.55)).toBe("10,6 ngày");
  });

  it("formatDaysToClose: dữ liệu bẩn ⇒ nói ra, không hiện gạch trơ", () => {
    expect(formatDaysToClose(null)).toContain("chốt trước");
  });

  it("formatRevenueShare: mẫu số 0 hoặc thiếu quyền ⇒ '—', không phải '0%'", () => {
    expect(formatRevenueShare(null)).toBe("—");
    expect(formatRevenueShare(0)).toBe("0,0%");
    expect(formatRevenueShare(0.2534)).toBe("25,3%");
  });
});
