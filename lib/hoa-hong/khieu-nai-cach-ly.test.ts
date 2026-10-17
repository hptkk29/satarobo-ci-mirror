// @vitest-environment node
/**
 * [NHH-ISO-DSP] — `CommissionDispute` khai đủ BA chỗ của luật Nền #3 (đính chính 27/08): `SCOPED_MODELS` · `getModelPrefixes()` · `BACKFILL_SPECS`, nhất quán.
 *
 * Bảng có `centerId` NOT NULL = cơ sở của GIAO DỊCH bị khiếu nại ⇒ KHÔNG vào `NULL_IS_GLOBAL_MODELS` (centerId không bao giờ là "dùng chung"). Prefix quyền phải gồm
 * `commission_disputes:` (người duyệt có `commission_disputes:review` mà có thể không có `commission:*`) — bỏ trống thì tầm nhìn rơi về diện rộng (lỗi #04).
 *
 * Nửa THUẦN của lưới; hành vi cách ly (HR cơ sở khác không thấy) do `tests/hoa-hong/khieu-nai-doc.spec.ts` giữ trên Postgres thật.
 */
import { describe, it, expect } from "vitest";

import { BACKFILL_SPEC_BY_MODEL, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";
import { NULL_IS_GLOBAL_MODELS, SCOPED_MODELS, getModelPrefixes } from "@/lib/db-scope";

describe("[NHH-ISO-DSP] CommissionDispute — ba chỗ khai nhất quán", () => {
  it("[NHH-ISO-DSP-01] ∈ SCOPED_MODELS, ∉ NULL_IS_GLOBAL_MODELS", () => {
    expect(SCOPED_MODELS.has("CommissionDispute")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("CommissionDispute")).toBe(false);
  });

  it("[NHH-ISO-DSP-02] prefix quyền = [commission_disputes:, commission:] — không rỗng, không rơi về diện rộng", () => {
    expect(getModelPrefixes("CommissionDispute")).toEqual(["commission_disputes:", "commission:"]);
  });

  it("[NHH-ISO-DSP-03] BACKFILL_SPECS: centerId BẮT BUỘC (không có NULL nào để backfill), scoped:true — khớp SCOPED_MODELS; vào DUAL_WRITE_MODELS (ghi kép orgUnitId)", () => {
    const spec = BACKFILL_SPEC_BY_MODEL.get("CommissionDispute");
    expect(spec).toBeDefined();
    expect(spec!.nullMeaning).toBe("BAT_BUOC");
    expect(spec!.scoped).toBe(true);
    expect(DUAL_WRITE_MODELS.has("CommissionDispute")).toBe(true);
  });

  it("[NHH-ISO-DSP-04] đối chứng: một model KHÔNG khiếu nại vẫn đọc ra prefix khác — phép so ở ISO-02 không phải hằng đúng", () => {
    expect(getModelPrefixes("CommissionPeriod")).not.toEqual(getModelPrefixes("CommissionDispute"));
  });
});
