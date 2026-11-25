// C-01 — chỉ tiêu LEAD theo tháng × cơ sở. Test viết TRƯỚC hiện thực (luật cứng #5).
//
// Ba thứ được canh ở đây, đều là loại hỏng CÂM (không ném lỗi, chỉ ra số sai):
//
//  1. Ô nhập chỉ tiêu là SỐ HỌC SINH. `z.coerce.number()` biến chuỗi rỗng thành `0`
//     ⇒ bấm Lưu khi chưa gõ gì sẽ ghi đè chỉ tiêu cũ về 0 mà không một dòng báo lỗi.
//     Đây là bẫy đang nằm sẵn trong bản doanh thu (`doanh-thu/_actions.ts`); C-01 không
//     chép lại nó, nên phải có ca test giữ.
//  2. Màn đặt chỉ được liệt kê chỉ tiêu của cơ sở actor quản. `LeadTarget` nằm trong
//     `SCOPE_EXEMPT` nên `scopedDb` là PASS-THROUGH — không ai lọc giúp.
//  3. Bảng mới có `centerId`/`orgUnitId` mà quên khai vào 2 bảng phân loại thì đối soát
//     đêm lặng lẽ bỏ qua nó ([US-07-IT-08b] bắt, nhưng test đó cần Postgres nên hay skip).
import { describe, it, expect } from "vitest";
import {
  leadTargetInputSchema,
  leadTargetListWhere,
  LEAD_TARGET_COUNT_MAX,
} from "@/lib/reports/lead-target";
import { SCOPE_EXEMPT, SCOPED_MODELS } from "@/lib/db-scope";
import { BACKFILL_SPECS } from "@/lib/org/center-bridge";

const parse = (raw: {
  centerId?: string;
  period?: string;
  targetCount?: string;
  note?: string;
}) => leadTargetInputSchema.safeParse(raw);

describe("C-01 · ô nhập chỉ tiêu lead", () => {
  it("bản hợp lệ: 'ALL' thành null, số về Int, ghi chú được cắt khoảng trắng", () => {
    const r = parse({ centerId: "ALL", period: "2026-08", targetCount: " 40 ", note: " hè " });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({
      centerId: null,
      period: "2026-08",
      targetCount: 40,
      note: "hè",
    });
  });

  it("centerId rỗng / thiếu → null (mục tiêu TOÀN HỆ THỐNG, không phải 'chưa gán')", () => {
    expect(parse({ centerId: "", period: "2026-08", targetCount: "1" }).success).toBe(true);
    const r = parse({ period: "2026-08", targetCount: "1" });
    expect(r.success && r.data.centerId).toBe(null);
  });

  it("ghi chú rỗng/toàn khoảng trắng → null, không lưu chuỗi rỗng", () => {
    const r = parse({ centerId: "cs1", period: "2026-08", targetCount: "5", note: "   " });
    expect(r.success && r.data.note).toBe(null);
  });

  it("🔴 chỉ tiêu bỏ trống KHÔNG được hoá thành 0 — phải báo lỗi", () => {
    const r = parse({ centerId: "cs1", period: "2026-08", targetCount: "" });
    expect(r.success).toBe(false);
    const r2 = parse({ centerId: "cs1", period: "2026-08" });
    expect(r2.success).toBe(false);
  });

  it("chỉ tiêu là SỐ HỌC SINH: số lẻ, số âm, rác đều bị chặn", () => {
    for (const bad of ["12.5", "-1", "40 cháu", "1e3", "١٢", "0x10", "1,5"]) {
      expect(parse({ centerId: "cs1", period: "2026-08", targetCount: bad }).success, bad).toBe(
        false,
      );
    }
  });

  it("0 là giá trị HỢP LỆ (cơ sở mới mở, tháng chưa đặt chỉ tiêu)", () => {
    const r = parse({ centerId: "cs1", period: "2026-08", targetCount: "0" });
    expect(r.success && r.data.targetCount).toBe(0);
  });

  it("chặn số vô lý — gõ nhầm số tiền vào ô đếm người thì phải lộ ra ngay", () => {
    const r = parse({
      centerId: "cs1",
      period: "2026-08",
      targetCount: String(LEAD_TARGET_COUNT_MAX + 1),
    });
    expect(r.success).toBe(false);
    expect(parse({ centerId: "cs1", period: "2026-08", targetCount: "50000000" }).success).toBe(
      false,
    );
  });

  it("kỳ phải đúng dạng YYYY-MM", () => {
    for (const bad of ["2026-8", "2026/08", "08-2026", "2026-13", "2026-00", "", "2026-08-01"]) {
      expect(parse({ centerId: "cs1", period: bad, targetCount: "10" }).success, bad).toBe(false);
    }
    expect(parse({ centerId: "cs1", period: "2026-12", targetCount: "10" }).success).toBe(true);
  });
});

describe("C-01 · dòng chỉ tiêu actor được NHÌN trên màn đặt", () => {
  const qlcs = (ids: string[]) => ({
    isSuperAdmin: false,
    isHoLevel: false,
    visibleCenterIds: ids,
  });

  it("QLCS: chỉ cơ sở mình quản — dòng TOÀN HỆ THỐNG không lọt vào", () => {
    expect(leadTargetListWhere(qlcs(["cs1", "cs3"]))).toEqual({
      centerId: { in: ["cs1", "cs3"] },
    });
  });

  it("QLCS chưa được gán cơ sở nào → rỗng (fail-closed, KHÔNG rơi về 'thấy hết')", () => {
    expect(leadTargetListWhere(qlcs([]))).toEqual({ centerId: { in: [] } });
  });

  it("cấp hội sở / quản trị: thấy cả dòng toàn hệ thống lẫn dòng từng cơ sở", () => {
    expect(
      leadTargetListWhere({ isSuperAdmin: false, isHoLevel: true, visibleCenterIds: ["cs1"] }),
    ).toEqual({});
    expect(
      leadTargetListWhere({ isSuperAdmin: true, isHoLevel: false, visibleCenterIds: [] }),
    ).toEqual({});
  });
});

describe("C-01 · bảng mới phải được khai vào 2 bảng phân loại đơn vị", () => {
  it("LeadTarget ∈ SCOPE_EXEMPT, KHÔNG ∈ SCOPED_MODELS", () => {
    // injectScope chèn `centerId IN (...)` trần ⇒ khai vào SCOPED_MODELS là làm dòng
    // mục tiêu toàn hệ thống (centerId NULL) TÀNG HÌNH với chính người vừa đặt nó.
    expect(SCOPE_EXEMPT.has("LeadTarget")).toBe(true);
    expect(SCOPED_MODELS.has("LeadTarget")).toBe(false);
  });

  it("LeadTarget có mặt trong BACKFILL_SPECS (đối soát đêm nhìn thấy)", () => {
    const spec = BACKFILL_SPECS.find((s) => s.model === "LeadTarget");
    expect(spec).toBeDefined();
    // NULL ở bảng này KHÔNG phải "chưa backfill" — điền cơ sở vào là hỏng nghĩa.
    expect(spec?.nullMeaning).toBe("NULL_TOAN_HE_THONG");
    expect(spec?.scoped).toBe(false);
  });
});
