// N-2 — doanh thu quy về TỪNG CON (quyết định B4 24/08/2026 + B3 "thực thu").
//
// Hai thứ bộ test này canh, vì cả hai đều hỏng CÂM:
//  1. khoản chưa quy được về con phải hiện thành MỘT DÒNG, không được biến mất;
//  2. công thức thực thu (hoàn = âm, bản gốc bị điều chỉnh bị loại) phải giữ nguyên khi
//     bổ dọc theo con — nếu không thì tab Kinh doanh và tab Tài chính cùng màn hình mà
//     ra hai con số.
import { describe, it, expect } from "vitest";
import {
  tallyRevenueByChild,
  splitChildRevenueByCenter,
  type ChildRevenueScanRow,
} from "./revenue-by-child";

let seq = 0;
function bt(over: Partial<ChildRevenueScanRow> = {}): ChildRevenueScanRow {
  seq += 1;
  return {
    id: `p${seq}`,
    amount: 1_000_000,
    accountantStatus: "CONFIRMED",
    adjustmentOfId: null,
    centerId: "cs1",
    leadChildId: "c1",
    leadId: "lead-1",
    ...over,
  };
}

describe("[N-2] tallyRevenueByChild — bổ dọc thực thu theo con", () => {
  it("gom nhiều khoản của cùng một con", () => {
    const r = tallyRevenueByChild([
      bt({ amount: 3_000_000 }),
      bt({ amount: 2_000_000 }),
    ]);
    expect(r.byChild.get("c1")).toBe(5_000_000);
    expect(r.total).toBe(5_000_000);
    expect(r.unassigned).toBe(0);
  });

  it("tách được hai con của CÙNG một phụ huynh", () => {
    const r = tallyRevenueByChild([
      bt({ leadChildId: "c1", amount: 3_000_000 }),
      bt({ leadChildId: "c2", amount: 4_000_000 }),
    ]);
    expect(r.byChild.get("c1")).toBe(3_000_000);
    expect(r.byChild.get("c2")).toBe(4_000_000);
    expect(r.total).toBe(7_000_000);
  });

  it("khoản KHÔNG quy được về con vào 'chưa quy được', KHÔNG bị bỏ khỏi tổng", () => {
    const r = tallyRevenueByChild([
      bt({ leadChildId: "c1", amount: 3_000_000 }),
      bt({ leadChildId: null, amount: 5_000_000 }),
    ]);
    expect(r.byChild.get("c1")).toBe(3_000_000);
    expect(r.unassigned).toBe(5_000_000);
    expect(r.total).toBe(8_000_000);
    expect(r.byChild.has("")).toBe(false);
  });

  it("bút toán hoàn (âm) TRỪ ra khỏi doanh thu của đúng con đó", () => {
    const r = tallyRevenueByChild([
      bt({ amount: 5_000_000 }),
      bt({ amount: -2_000_000, accountantStatus: "REFUNDED" }),
    ]);
    expect(r.byChild.get("c1")).toBe(3_000_000);
    expect(r.total).toBe(3_000_000);
  });

  it("điều chỉnh là DELTA — cộng cả gốc lẫn phần chênh, không loại bản nào", () => {
    // 🔴 Đổi 16/09/2026 khi hợp nhất `main`: `ADJUSTED` đã bị bỏ khỏi trạng thái kế
    // toán (07/09, `payment_type_tach_khoi_status`). Bút toán điều chỉnh nay là
    // `paymentType = "ADJUSTMENT"`, trạng thái `CONFIRMED`, mang PHẦN CHÊNH LỆCH.
    // Loại bản gốc như luật cũ bây giờ là ĐẾM THIẾU đúng phần vừa sửa.
    const goc = bt({ id: "goc", amount: 5_000_000 });
    const delta = bt({ id: "delta", amount: -1_000_000, adjustmentOfId: "goc" });
    const r = tallyRevenueByChild([goc, delta]);
    expect(r.byChild.get("c1")).toBe(4_000_000);
    expect(r.total).toBe(4_000_000);
  });

  it("PENDING / REJECTED không phải tiền thật → không vào bất kỳ ô nào", () => {
    const r = tallyRevenueByChild([
      bt({ amount: 9_000_000, accountantStatus: "PENDING" }),
      bt({ amount: 9_000_000, accountantStatus: "REJECTED", leadChildId: null }),
    ]);
    expect(r.byChild.size).toBe(0);
    expect(r.unassigned).toBe(0);
    expect(r.total).toBe(0);
  });

  it("mảng rỗng → ba con số đều 0, không NaN", () => {
    const r = tallyRevenueByChild([]);
    expect(r.total).toBe(0);
    expect(r.unassigned).toBe(0);
    expect(r.byChild.size).toBe(0);
  });
});

describe("[N-2] splitChildRevenueByCenter — công tắc 'Tách theo cơ sở'", () => {
  it("mỗi cơ sở một dòng, cơ sở không có khoản nào vẫn hiện 0", () => {
    const out = splitChildRevenueByCenter(
      [
        bt({ centerId: "cs1", amount: 3_000_000 }),
        bt({ centerId: "cs2", amount: 4_000_000, leadChildId: null }),
      ],
      ["cs1", "cs2", "cs3"],
    );
    expect(out.map((r) => r.centerId)).toEqual(["cs1", "cs2", "cs3"]);
    expect(out[0]!.total).toBe(3_000_000);
    expect(out[0]!.unassigned).toBe(0);
    expect(out[1]!.total).toBe(4_000_000);
    expect(out[1]!.unassigned).toBe(4_000_000);
    expect(out[2]!.total).toBe(0);
  });

  it("tổng các cơ sở = tổng gộp (không rơi khoản nào giữa hai hình dạng)", () => {
    const rows = [
      bt({ centerId: "cs1", amount: 3_000_000 }),
      bt({ centerId: "cs2", amount: 4_000_000, leadChildId: null }),
      bt({ centerId: "cs2", amount: -1_000_000, accountantStatus: "REFUNDED" }),
    ];
    const gop = tallyRevenueByChild(rows);
    const tach = splitChildRevenueByCenter(rows, ["cs1", "cs2"]);
    expect(tach.reduce((s, r) => s + r.total, 0)).toBe(gop.total);
    expect(tach.reduce((s, r) => s + r.unassigned, 0)).toBe(gop.unassigned);
  });

  it("gốc + delta cùng vào một cơ sở, ra đúng số sau điều chỉnh", () => {
    // Mô hình DELTA (xem chú thích ở ca trên): cộng cả hai dòng, không loại bản nào.
    const goc = bt({ id: "g", centerId: "cs1", amount: 5_000_000 });
    const delta = bt({ id: "m", centerId: "cs1", amount: -1_000_000, adjustmentOfId: "g" });
    const out = splitChildRevenueByCenter([goc, delta], ["cs1"]);
    expect(out[0]!.total).toBe(4_000_000);
  });
});
