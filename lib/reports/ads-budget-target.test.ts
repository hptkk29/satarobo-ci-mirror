// D-02 — chỉ tiêu NGÂN SÁCH QUẢNG CÁO theo tháng × cơ sở. Test viết TRƯỚC hiện thực
// (luật cứng #5). Cùng khuôn `lib/reports/lead-target.test.ts` (C-01) và
// `lib/reports/revenue-target-scope.test.ts` (B-01) — ba bảng chỉ tiêu, một khuôn.
//
// Bốn thứ được canh ở đây, đều là loại hỏng CÂM (không ném lỗi, chỉ ra số sai):
//
//  1. Ô nhập là TIỀN. `z.coerce.number()` biến chuỗi rỗng thành `0` ⇒ bấm Lưu khi chưa
//     gõ gì sẽ ghi đè chỉ tiêu cũ về 0 mà không một dòng báo lỗi, và D-03 ("% thực tế /
//     chỉ tiêu") nhảy lên vô cực. Bẫy này đang nằm sẵn trong bản doanh thu
//     (`doanh-thu/_actions.ts` dùng `z.coerce`); D-02 không chép lại nó.
//  2. Trần phải NHỎ HƠN sức chứa của cột. `targetAmount` là `Int` ⇒ Postgres int4, tối
//     đa 2_147_483_647. Không chặn ở cửa vào thì gõ dư vài số 0 sẽ đi tới tận DB rồi
//     chết bằng một thông báo "Lỗi cơ sở dữ liệu" chẳng nói gì cho người nhập.
//  3. Màn đặt chỉ được liệt kê chỉ tiêu của cơ sở actor quản. `AdsBudgetTarget` nằm
//     trong `SCOPE_EXEMPT` nên `scopedDb` là PASS-THROUGH — không ai lọc giúp.
//  4. Bảng mới có `centerId`/`orgUnitId` mà quên khai vào 2 bảng phân loại thì đối soát
//     đơn vị ban đêm lặng lẽ bỏ qua nó ([US-07-IT-08b] bắt, nhưng test đó cần Postgres
//     nên hay bị skip ở local).
import { describe, it, expect } from "vitest";
import {
  adsBudgetTargetInputSchema,
  adsBudgetTargetListWhere,
  ADS_BUDGET_TARGET_AMOUNT_MAX,
} from "@/lib/reports/ads-budget-target";
import { SCOPE_EXEMPT, SCOPED_MODELS } from "@/lib/db-scope";
import { BACKFILL_SPECS } from "@/lib/org/center-bridge";

const parse = (raw: {
  centerId?: string;
  period?: string;
  targetAmount?: string;
  note?: string;
}) => adsBudgetTargetInputSchema.safeParse(raw);

describe("D-02 · ô nhập chỉ tiêu ngân sách quảng cáo", () => {
  it("bản hợp lệ: 'ALL' thành null, số về Int, ghi chú được cắt khoảng trắng", () => {
    const r = parse({
      centerId: "ALL",
      period: "2026-08",
      targetAmount: " 30000000 ",
      note: " đẩy mùa hè ",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({
      centerId: null,
      period: "2026-08",
      targetAmount: 30_000_000,
      note: "đẩy mùa hè",
    });
  });

  it("centerId rỗng / thiếu → null (chỉ tiêu TOÀN HỆ THỐNG, không phải 'chưa gán')", () => {
    expect(parse({ centerId: "", period: "2026-08", targetAmount: "1" }).success).toBe(true);
    const r = parse({ period: "2026-08", targetAmount: "1" });
    expect(r.success && r.data.centerId).toBe(null);
  });

  it("ghi chú rỗng/toàn khoảng trắng → null, không lưu chuỗi rỗng", () => {
    const r = parse({ centerId: "cs1", period: "2026-08", targetAmount: "5", note: "   " });
    expect(r.success && r.data.note).toBe(null);
  });

  it("🔴 ngân sách bỏ trống KHÔNG được hoá thành 0 — phải báo lỗi", () => {
    expect(parse({ centerId: "cs1", period: "2026-08", targetAmount: "" }).success).toBe(false);
    expect(parse({ centerId: "cs1", period: "2026-08" }).success).toBe(false);
  });

  it("là TIỀN ĐỒNG nguyên: số lẻ, số âm, rác, dấu ngăn cách đều bị chặn", () => {
    // "10.000.000" và "10,000,000" bị chặn CÓ CHỦ ĐÍCH: đoán dấu nào là phần nghìn,
    // dấu nào là phần lẻ, là cách chắc chắn nhất để lưu sai 1000 lần con số thật.
    for (const bad of [
      "12.5",
      "-1",
      "30tr",
      "1e7",
      "١٢",
      "0x10",
      "10.000.000",
      "10,000,000",
      "30 000 000",
    ]) {
      expect(parse({ centerId: "cs1", period: "2026-08", targetAmount: bad }).success, bad).toBe(
        false,
      );
    }
  });

  it("0 là giá trị HỢP LỆ (tháng chủ động không chạy quảng cáo cho cơ sở đó)", () => {
    const r = parse({ centerId: "cs1", period: "2026-08", targetAmount: "0" });
    expect(r.success && r.data.targetAmount).toBe(0);
  });

  it("🔴 trần phải NHỎ HƠN sức chứa int4 của cột — chặn ở cửa vào, không để DB chết thay", () => {
    // Postgres int4 max = 2_147_483_647. Trần lớn hơn số này là mời một lỗi DB câm.
    expect(ADS_BUDGET_TARGET_AMOUNT_MAX).toBeLessThanOrEqual(2_147_483_647);
    expect(ADS_BUDGET_TARGET_AMOUNT_MAX).toBeGreaterThan(1_000_000_000);
  });

  it("chặn số vô lý — gõ dư vài số 0 phải lộ ra ngay tại ô nhập", () => {
    expect(
      parse({
        centerId: "cs1",
        period: "2026-08",
        targetAmount: String(ADS_BUDGET_TARGET_AMOUNT_MAX + 1),
      }).success,
    ).toBe(false);
    // 30 triệu gõ dư 3 số 0 = 30 tỷ.
    expect(parse({ centerId: "cs1", period: "2026-08", targetAmount: "30000000000" }).success).toBe(
      false,
    );
    // Đúng trần thì vẫn phải nhận.
    expect(
      parse({
        centerId: "cs1",
        period: "2026-08",
        targetAmount: String(ADS_BUDGET_TARGET_AMOUNT_MAX),
      }).success,
    ).toBe(true);
  });

  it("kỳ phải đúng dạng YYYY-MM", () => {
    for (const bad of ["2026-8", "2026/08", "08-2026", "2026-13", "2026-00", "", "2026-08-01"]) {
      expect(parse({ centerId: "cs1", period: bad, targetAmount: "10" }).success, bad).toBe(false);
    }
    expect(parse({ centerId: "cs1", period: "2026-12", targetAmount: "10" }).success).toBe(true);
  });
});

describe("D-02 · dòng chỉ tiêu actor được NHÌN trên màn đặt", () => {
  const capCoSo = (ids: string[]) => ({
    isSuperAdmin: false,
    isHoLevel: false,
    visibleCenterIds: ids,
  });

  it("vai cấp cơ sở: chỉ cơ sở mình quản — dòng TOÀN HỆ THỐNG không lọt vào", () => {
    expect(adsBudgetTargetListWhere(capCoSo(["cs1", "cs3"]))).toEqual({
      centerId: { in: ["cs1", "cs3"] },
    });
  });

  it("chưa được gán cơ sở nào → rỗng (fail-closed, KHÔNG rơi về 'thấy hết')", () => {
    expect(adsBudgetTargetListWhere(capCoSo([]))).toEqual({ centerId: { in: [] } });
  });

  it("cấp hội sở / quản trị: thấy cả dòng toàn hệ thống lẫn dòng từng cơ sở", () => {
    expect(
      adsBudgetTargetListWhere({
        isSuperAdmin: false,
        isHoLevel: true,
        visibleCenterIds: ["cs1"],
      }),
    ).toEqual({});
    expect(
      adsBudgetTargetListWhere({ isSuperAdmin: true, isHoLevel: false, visibleCenterIds: [] }),
    ).toEqual({});
  });
});

describe("D-02 · bảng mới phải được khai vào 2 bảng phân loại đơn vị", () => {
  it("AdsBudgetTarget ∈ SCOPE_EXEMPT, KHÔNG ∈ SCOPED_MODELS", () => {
    // injectScope chèn `centerId IN (...)` trần ⇒ khai vào SCOPED_MODELS là làm dòng
    // chỉ tiêu toàn hệ thống (centerId NULL) TÀNG HÌNH với chính người vừa đặt nó.
    expect(SCOPE_EXEMPT.has("AdsBudgetTarget")).toBe(true);
    expect(SCOPED_MODELS.has("AdsBudgetTarget")).toBe(false);
  });

  it("AdsBudgetTarget có mặt trong BACKFILL_SPECS (đối soát đêm nhìn thấy)", () => {
    const spec = BACKFILL_SPECS.find((s) => s.model === "AdsBudgetTarget");
    expect(spec).toBeDefined();
    // NULL ở bảng này KHÔNG phải "chưa backfill" — điền cơ sở vào là hỏng nghĩa.
    expect(spec?.nullMeaning).toBe("NULL_TOAN_HE_THONG");
    expect(spec?.scoped).toBe(false);
  });
});
