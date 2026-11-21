// Đây là chỗ dễ sai nhất của cả tính năng (tiền). Bảng ca dưới phủ đúng các tình
// huống nghiệp vụ đã liệt kê khi chốt thiết kế 03/08.
import { describe, it, expect } from "vitest";
import {
  planAllocation,
  deriveStatus,
  outstandingOf,
  isOrderSettled,
  type AllocTarget,
} from "./allocation";

const req = (over: Partial<AllocTarget> & { id: string }): AllocTarget => ({
  amountDue: 0,
  allocated: 0,
  sortOrder: 0,
  status: "PENDING",
  ...over,
});

/** Đơn 5tr chia 2 đợt: 3tr + 2tr. */
const twoInstallments = (): AllocTarget[] => [
  req({ id: "d1", amountDue: 3_000_000, sortOrder: 1 }),
  req({ id: "d2", amountDue: 2_000_000, sortOrder: 2 }),
];

describe("planAllocation — ca nghiệp vụ", () => {
  it("[1] đóng ĐÚNG đợt 1 → rót trọn đợt 1, không đụng đợt 2, không dư", () => {
    const p = planAllocation(3_000_000, twoInstallments(), "d1");
    expect(p.lines).toEqual([{ paymentRequestId: "d1", amount: 3_000_000, roundingWaived: 0 }]);
    expect(p.credit).toBe(0);
  });

  it("[4] đóng GỘP cả 2 đợt trong 1 lần chuyển → cả hai đủ", () => {
    const p = planAllocation(5_000_000, twoInstallments(), "d1");
    expect(p.lines).toEqual([
      { paymentRequestId: "d1", amount: 3_000_000, roundingWaived: 0 },
      { paymentRequestId: "d2", amount: 2_000_000, roundingWaived: 0 },
    ]);
    expect(p.credit).toBe(0);
  });

  it("[5] đóng DƯ 200k → 2 đợt đủ, phần dư thành tiền thừa (không tự hoàn)", () => {
    const p = planAllocation(5_200_000, twoInstallments(), "d1");
    expect(p.lines.map((l) => l.amount)).toEqual([3_000_000, 2_000_000]);
    expect(p.credit).toBe(200_000);
  });

  it("[6] thiếu 3.000đ + dung sai 5.000đ → coi như đủ, ghi lại phần tha", () => {
    const p = planAllocation(2_997_000, twoInstallments(), "d1", 5_000);
    expect(p.lines).toEqual([
      { paymentRequestId: "d1", amount: 2_997_000, roundingWaived: 3_000 },
    ]);
    expect(deriveStatus(3_000_000, 2_997_000, 3_000)).toBe("PAID");
  });

  it("[7] thiếu 1 TRIỆU → PARTIAL, KHÔNG rơi vào xử lý tay, không hoàn", () => {
    const p = planAllocation(2_000_000, twoInstallments(), "d1", 5_000);
    expect(p.lines).toEqual([
      { paymentRequestId: "d1", amount: 2_000_000, roundingWaived: 0 },
    ]);
    expect(p.credit).toBe(0);
    expect(deriveStatus(3_000_000, 2_000_000)).toBe("PARTIAL");
  });

  it("thiếu VỪA ĐÚNG ngưỡng dung sai → vẫn tha; hơn ngưỡng 1đ → PARTIAL", () => {
    expect(planAllocation(2_995_000, twoInstallments(), "d1", 5_000).lines[0]!.roundingWaived).toBe(5_000);
    expect(planAllocation(2_994_999, twoInstallments(), "d1", 5_000).lines[0]!.roundingWaived).toBe(0);
  });

  it("dung sai KHÔNG áp cho phiếu chưa nhận đồng nào ngoài phần rót (không tha khống)", () => {
    // Rót 0đ thì không có dòng nào — không được sinh PAID từ hư không.
    expect(planAllocation(0, twoInstallments(), "d1", 5_000).lines).toEqual([]);
  });
});

describe("planAllocation — thứ tự rót", () => {
  it("trả tiếp khi đợt 1 đã đóng → tự sang đợt 2", () => {
    const t = twoInstallments();
    t[0]!.allocated = 3_000_000;
    t[0]!.status = "PAID";
    const p = planAllocation(2_000_000, t, "d1");
    expect(p.lines).toEqual([{ paymentRequestId: "d2", amount: 2_000_000, roundingWaived: 0 }]);
  });

  it("rót tiếp phiếu ĐANG PARTIAL đúng phần còn thiếu", () => {
    const t = twoInstallments();
    t[0]!.allocated = 1_000_000;
    t[0]!.status = "PARTIAL";
    const p = planAllocation(2_000_000, t, "d1");
    expect(p.lines).toEqual([{ paymentRequestId: "d1", amount: 2_000_000, roundingWaived: 0 }]);
  });

  it("sale xuất QR ĐỢT 2 (đợt 1 chưa đóng) → tiền vào ĐÚNG đợt 2, không tự nhảy về đợt 1", () => {
    // Bất biến: phiếu đích thắng sortOrder — QR đợt nào thì tiền vào đợt đó.
    const p = planAllocation(2_000_000, twoInstallments(), "d2");
    expect(p.lines).toEqual([{ paymentRequestId: "d2", amount: 2_000_000, roundingWaived: 0 }]);
  });

  it("dư từ phiếu đích tràn về phiếu chưa đóng khác theo sortOrder", () => {
    const p = planAllocation(4_000_000, twoInstallments(), "d2");
    expect(p.lines).toEqual([
      { paymentRequestId: "d2", amount: 2_000_000, roundingWaived: 0 },
      { paymentRequestId: "d1", amount: 2_000_000, roundingWaived: 0 },
    ]);
  });

  it("không truyền phiếu đích → bắt đầu từ phiếu chưa đóng sớm nhất", () => {
    const p = planAllocation(1_000_000, twoInstallments());
    expect(p.lines[0]!.paymentRequestId).toBe("d1");
  });

  it("phiếu VOID bị bỏ qua hoàn toàn", () => {
    const t = twoInstallments();
    t[0]!.status = "VOID";
    const p = planAllocation(5_000_000, t, "d1");
    expect(p.lines).toEqual([{ paymentRequestId: "d2", amount: 2_000_000, roundingWaived: 0 }]);
    expect(p.credit).toBe(3_000_000);
  });

  it("mọi phiếu đã PAID → toàn bộ tiền thành tiền thừa, không rót âm", () => {
    const t = twoInstallments().map((x) => ({ ...x, allocated: x.amountDue, status: "PAID" as const }));
    const p = planAllocation(1_000_000, t, "d1");
    expect(p.lines).toEqual([]);
    expect(p.credit).toBe(1_000_000);
  });

  it("đơn 1 phiếu 'thu toàn đơn' (chưa duyệt trả góp) vẫn chạy bình thường", () => {
    const t = [req({ id: "full", amountDue: 5_000_000, sortOrder: 0 })];
    expect(planAllocation(5_000_000, t, "full").lines[0]!.amount).toBe(5_000_000);
  });
});

describe("deriveStatus / outstandingOf / isOrderSettled", () => {
  it("trạng thái tính từ số đã rót, không phải cờ gán tay", () => {
    expect(deriveStatus(3_000_000, 0)).toBe("PENDING");
    expect(deriveStatus(3_000_000, 1)).toBe("PARTIAL");
    expect(deriveStatus(3_000_000, 3_000_000)).toBe("PAID");
    expect(deriveStatus(3_000_000, 4_000_000)).toBe("PAID"); // rót dư vẫn là đủ
  });

  it("VOID không bị trạng thái tính đè", () => {
    expect(deriveStatus(3_000_000, 3_000_000, 0, "VOID")).toBe("VOID");
  });

  it("outstanding không âm và bỏ qua phiếu VOID", () => {
    expect(outstandingOf(req({ id: "x", amountDue: 100, allocated: 150 }))).toBe(0);
    expect(outstandingOf(req({ id: "x", amountDue: 100, status: "VOID" }))).toBe(0);
  });

  it("đơn đủ khi mọi phiếu sống đều PAID; đơn không có phiếu nào → chưa đủ", () => {
    expect(isOrderSettled(["PAID", "PAID"])).toBe(true);
    expect(isOrderSettled(["PAID", "PARTIAL"])).toBe(false);
    expect(isOrderSettled(["PAID", "VOID"])).toBe(true);
    expect(isOrderSettled([])).toBe(false);
  });
});
